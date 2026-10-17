//! Pure integer math for a binary fixed-product market maker (FPMM).
//!
//! No Soroban types in here, so `cargo test` exercises it natively and
//! `model/fpmm_model.py` mirrors it line by line for property testing.
//!
//! Conventions
//! - All amounts are non-negative `ii28` in collateral base units
//!   (USDC on Stellar = 7 decimals, so 1 USDC = 10_000_000).
//! - Rounding always favours the pool: fees round up, shares out round down,
//!   shares in round up. This is what keeps the pool invariant `k = r_yes * r_no`
//!   non-decreasing and blocks dust-splitting attacks.
//! - `MAX_SETS` bounds market size so that any product of two quantities
//!   (both <= 1e15) is <= 1e30, far below `i128::MAX` (~1.7e38). Every
//!   multiplication is still `checked_`* as a second line of defence.
//!
//! Headroom for `calc_sell_shares` (see #256-bit / decimals issue):
//! with b = shares_in + r_sold + r_other and every term <= MAX_SETS = 1e15,
//! we have b <= 3e15 and b^2 <= 9e30, so the discriminant
//! D = b^2 - 4*r_other*shares_in fits easily in `u128` (max about 3.4e38).
//! This bound must be revisited if MAX_SETS ever grows or if the calculation
//! moves to wider integers.

pub const BPS: i128 = 10_000;
pub const MAX_SETS: i128 = 1_000_000_000_000_000_000; // 1e15 = 100M USDC (7 dp)
pub const MIN_PROB_BPS: u32 = 100; // 1%
pub const MAX_PROB_BPS: u32 = 9_900; // 99%

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum MathError {
    Overflow,
    InvalidInput,
    InsufficientLiquidity,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Settlement {
    Yes,
    No,
    Void,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub struct BuyQuote {
    pub shares_out: i128,
    pub fee: i128,
    /// Collateral that actually mints complete sets (`collateral_in - fee`).
    pub net: i128,
    pub new_reserve_bought: i128,
    pub new_reserve_other: i128,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub struct SellQuote {
    pub shares_in: i128,
    pub fee: i128,
    /// Complete sets burned from the pool (`collateral_out + fee`).
    pub gross: i128,
    pub new_reserve_sold: i128,
    pub new_reserve_other: i128,
}

/// Quote for selling an exact share count (`calc_sell_shares`).
/// `gross` is the number of complete sets burned from the pool, and
/// `collateral_out` is what the seller receives after the fee.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub struct SellSharesQuote {
    pub collateral_out: i128,
    pub fee: i128,
    pub gross: i128,
    pub new_reserve_sold: i128,
    pub new_reserve_other: i128,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub struct SeedReserves {
    pub reserve_yes: i128,
    pub reserve_no: i128,
    /// Outcome shares handed back to the market creator so the pool opens at
    /// the requested probability (only one of these is non-zero).
    pub creator_yes: i128,
    pub creator_no: i128,
}

fn mul(a: i128, b: i128) -> Result<i128, MathError> {
    a.checked_mul(b).ok_or(MathError::Overflow)
}

/// floor(a * b / c)
pub fn mul_div_floor(a: i128, b: i128, c: i128) -> Result<i128, MathError> {
    if a < 0 || b < 0 || c <= 0 {
        return Err(MathError::InvalidInput);
    }
    Ok(mul(a, b)? / c)
}

/// ceil(a * b / c), written to avoid overflowing on `p + c - 1`.
pub fn mul_div_ceil(a: i128, b: i128, c: i128) -> Result<i128, MathError> {
    if a < 0 || b < 0 || c <= 0 {
        return Err(MathError::InvalidInput);
    }
    let p = mul(a, b)?;
    let q = p / c;
    Ok(if p % c != 0 { q + 1 } else { q })
}

/// Exact integer square root: `isqrt(n)^2 <= n < (isqrt(n)+1)^2` for all `n`.
///
/// Newton iteration seeded from above the root (bit-length estimate), so
/// convergence is monotone decreasing and terminates at `floor(sqrt(n))`.
/// Seeding below the root would let Newton converge from below and return
/// `floor + 1`, which would break the pool-favouring correction in `sell_shares`.
/// The loop is bounded by the bit length of `u128` (at most ~128 iterations,
/// in practice much fewer for the ranges we care about).
pub fn isqrt(n: u128) -> u128 {
    if n < 2 {
        return n;
    }
    // `shift` is chosen so that `1 << shift` >= sqrt(n); adding 1 before
    // the division by 2 guarantees that even for perfect squares the seed
    // is at least the root.
    let bits = 128 - n.leading_zeros();
    let shift = (bits + 1) / 2;
    let mut x = 1u128 << shift; // x >= sqrt(n)
    loop {
        let y = (x + n / x) >> 1;
        if y >= x {
            return x;
        }
        x = y;
    }
}

/// Spot price of YES in bps: r_no / (rYyes + r_no).
pub fn price_yes_bps(reserve_yes: i128, reserve_no: i128) -> Result<i128, MathError> {
    let sum = reserve_yes
        .checked_add(reserve_no)
        .ok_or(MathError::Overflow)?;
    if sum <= 0 {
        return Err(MathError::InsufficientLiquidity);
    }
    mul_div_floor(reserve_no, BPS, sum)
}

/// YES price in bps of the pool **after** applying an outcome-relative
/// reserve update (the `new_reserve_*` pair of a `BuyQuote`/`SellQuote`).
/// Follows `reserves_for`'s convention: pass `outcome_is_yes = false` for a
/// NO trade, where `r_after` is the NO reserve.
pub fn price_after(
    outcome_is_yes: bool,
    r_after: i128,
    r_other_after: i128,
) -> Result<i128, MathError> {
    if outcome_is_yes {
        price_yes_bps(r_after, r_other_after)
    } else {
        price_yes_bps(rother_after, r_after)
    }
}

/// Pool opens at `yes_bps` probability with `seed` complete sets minted.
/// The pool keeps fewer of the *likelier* outcome; the creator keeps the rest.
pub fn seed_reserves(seed: i128, yes_bps: u32) -> Result<SeedReserves, MathError> {
    if seed <= 0 || !(MIN_PROB_BPS..=MAX_PROB_BPS).contains(&yes_bps) {
        return Err(MathError::InvalidInput);
    }
    let p = yes_bps as i128;
    let (reserve_yes, reserve_no) = if p >= BPS / 2 {
        (mul_div_floor(seed, BPS - p, p)?, seed)
    } else {
        (seed, mul_div_floor(seed, p, BPS - p)?)
    };
    if reserve_yes <= 0 || reserve_no <= 0 {
        return Err(MathError::InvalidInput);
    }
    Ok(SeedReserves {
        reserve_yes,
        reserve_no,
        creator_yes: seed - reserve_yes,
        creator_no: seed - reserve_no,
    })
}

/// Buy `collateral_in` worth of the outcome whose pool reserve is `r_bought`.
///
/// 1. fee = ceil(in * fee_bps / BPS); net = in - fee
/// 2. mint `net` complete sets into the pool: r_other += net
/// 3. pool keeps r_bought' = ceil(r_bought * r_other / r_other')  (k preserved)
/// 4. buyer receives r_bought + net - r_bought'
pub fn calc_buy(
    r_bought: i128,
    r_other: i128,
    collateral_in: i128,
    fee_bps: u32,
) -> Result<BuyQuote, MathError> {
    if collateral_in <= 0 || r_bought <= 0 || r_other <= 0 {
        return Err(MathError::InvalidInput);
    }
    let fee = mul_div_ceil(collateral_in, fee_bps as i128, BPS)?;
    let net = collateral_in - fee;
    if net <= 0 {
        return Err(MathError::InvalidInput);
    }
    let new_other = r_other.checked_add(net).ok_or(MathError::Overflow)?;
    let new_bought = mul_div_ceil(r_bought, r_other, new_other)?;
    let shares_out = r_bought.checked_add(net).ok_or(MathError::Overflow)? - new_bought;
    if shares_out <= 0 {
        return Err(MathError::InvalidInput);
    }
    Ok(BuyQuote {
        shares_out,
        fee,
        net,
        new_reserve_bought: new_bought,
        new_reserve_other: new_other,
    })
}

/// Sell shares of the outcome with pool reserve `r_sold` for an exact
/// `collateral_out` (Gnosis-style, so no square root on-chain).
///
/// 1. gross = ceil(out * BPS / (BPS - fee_bps)); fee = gross - out
/// 2. burn `gross` complete sets from the pool: r_other -= gross
/// 3. pool must end at r_sold' = ceil(r_sold * r_other / r_other')
/// 4. seller gives r_sold' + gross - r_sold shares
///
/// To sell an exact share count on-chain, use `calc_sell_shares` (and the
/// `MarketCore::sell_shares` entrypoint). The off-chain inverse
/// (`quadratic`, see `model/fpmm_model.py::gross_for_shares`) is no longer
/// required for correctness, only for backward compatibility with clients.
pub fn calc_sell(
    r_sold: i128,
    r_other: i128,
    collateral_out: i128,
    fee_bps: u32,
) -> Result<SellQuote, MathError> {
    if collateral_out <= 0 || r_sold <= 0 || r_other <= 0 || (fee_bps as i128) >= BPS {
        return Err(MathError::InvalidInput);
    }
    let gross = mul_div_ceil(collateral_out, BPS, BPS - fee_bps as i128)?;
    let fee = gross - collateral_out;
    if gross >= r_other {
        return Err(MathError::InsufficientLiquidity);
    }
    let new_other = r_other - gross;
    let new_sold = mul_div_ceil(r_sold, r_other, new_other)?;
    let shares_in = new_sold.checked_add(gross).ok_or(MathError::Overflow)? - r_sold;
    if shares_in <= 0 {
        return Err(MathError::InvalidInput);
    }
    Ok(SellQuote {
        shares_in,
        fee,
        gross,
        new_reserve_sold: new_sold,
        new_reserve_other: new_other,
    })
}

/// Sell an exact `shares_in` count of the outcome whose pool reserve is
/// `r_sold`, returning the collateral paid out. This is the on-chain inverse
/// of `calc_sell`; it does the square root here so clients do not have to.
///
/// Derivation. Let `x` be the number of complete sets burned from the pool
/// (`trade.gross`). The pool ends at `r_sold + shares_in - x` and
/// `r_other - x`, and the invariant `r_sold'* r_other' >= `r_sold*r_other`
/// gives the quadratic
///
///   (r_sold + shares_in - x) * (r_other - x) >= r_sold * r_other
///
/// whose smallest pool-favouring root is the largest integer `x` satisfying it.
/// With `b = r_sold + shares_in + r_other` and `D = b^2 - 4*r_other*shares_in`,
/// the real root is `(k - sqrt(D)) / 2` where `h = r_sold + shares_in`. Since
/// `isqrt` rounds down, `x0 = (b - isqrt(D)) / 2` can overshoot the root by
/// at most one; the correction loop decrements until the invariant holds.
///
/// Pool-favouring proof (correction loop bound). Let fx) = (r_sold +
/// shares_in - x) * (r_other - x). This is a concave upward parabola in `x;
/// the real root r_real satisfies f(r_real) = r_sold * r_other and the
/// integer solution is `floor(r_real)` (because fx) is increasing on
/// [0, min]). `x0 = (b - isqrt(D)) / 2` is the floor of the root of the
/// quadratic with the floored sqrt root, so `x0 >= floor(r_real)` and
/// `x0 - floor(r_real) <= 1`. Therefore the loop runs at most twice (once
/// for the possible one-unit overshoot, once more to confirm fx) >= k).
///
/// Pool-favouring proof (never pays more than `calc_sell`). `calc_sell`
/// computes `gross = ceil(out * BPS / (BPS - fee_bps))` and then the same
/// invariant `f(sell_quote.gross) >= k`. Our `x` is the largest integer
/// satisfying that invariant, so `x >= calc_sell.gross`. Since `collateral_out`
/// is monotone in `x` (`collateral_out = floor(x * (BPS - fee) / BPS)`),
/// the seller receives at least what `calc_sell` would charge for the same
/// shares. Equality holds when the client rounds the same way.
///
/// Errors: `InvalidInput` for non-positive inputs, out-of-range fees, or a
/// sell that floors to zero; `InsufficientLiquidity` when the pool cannot
/// absorb the burn (`x == 0` or `x >= r_other`); `Overflow` on arithmetic
/// failure (not reachable under `MAX_SETS`).
pub fn calc_sell_shares(
    r_sold: i128,
    r_other: i128,
    shares_in: i128,
    fee_bps: u32,
) -> Result<SellSharesQuote, MathError> {
    if shares_in <= 0 || r_sold <= 0 || r_other <= 0 || (fee_bps as i128) >= BPS {
        return Err(MathError::InvalidInput);
    }

    // b = r_sold + shares_in + r_other <= 3e15, b2 <= 9e30.
    let b = r_sold
        .checked_add(shares_in)
        .ok_or(MathError::Overflow)?
        .checked_add(r_other)
        .ok_or(MathError::Overflow)?;
    // D = b^2 - 4*r_other*shares_in. The subtraction is non-negative by the
    // AM-3M inequality because the quadratic has real roots for the
    // physically reachable inputs.
    let b2 = mul(b, b)?;
    let four_r_shares = mul(
        mul(4, i128)?.checked_mul(r_other).ok_or(MathError::Overflow)?,
        shares_in,
    )?;
    let d = b2
        .checked_sub(four_r_shares)
        .ok_or(MathError::Overflow)?;
    if d < 0 {
        return Err(MathError::InvalidInput);
    }
    let sqrt_d = isqrt(d as u128) as i128;
    let mut x = (b - sqrt_d) / 2;

    // Pool-favouring correction: `x` may overshoot by at most one because
    // `isqrt` floors. See the proof in the doc comment above.
    let k = mul(r_sold, r_other)?;
    loop {
        if x <= 0 {
            break;
        }
        let new_sold = r_sold
            .checked_add(shares_in)
            .ok_or(MathError::Overflow)?
            .checked_sub(x)
            .ok_or(MathError::Overflow)?;
        let new_other = r_other.checked_sub(x).ok_or(MathError::Overflow)?;
        if new_other <= 0 {
            // Over-burned the other reserve; decrement and retry.
            x -= 1;
            continue;
        }
        let new_k = mul(new_sold, new_other)?;
        if new_k >= k {
            break;
        }
        x -= 1;
    }

    if x <= 0 || x >= r_other {
        return Err(MathError::InsufficientLiquidity);
    }

    // Fee rounds up (as in calc_buy): collateral_out rounds down.
    let collateral_out = mul_div_floor(x, BPS - fee_bps as i128, BPS)?;
    let fee = x - collateral_out;
    if collateral_out <= 0 {
        // Tiny sell that floors to zero: reject rather than burn shares for nothing.
        return Err(MathError::InvalidInput);
    }

    let new_sold = r_sold
        .checked_add(shares_in)
        .ok_or(MathError::Overflow)?
        .checked_sub(x)
        .ok_or(MathError::Overflow)?;
    let new_other = r_other.checked_sub(x).ok_or(MathError::Overflow)?;

    Ok(SellSharesQuote {
        collateral_out,
        fee,
        gross: x,
        new_reserve_sold: new_sold,
        new_reserve_other: new_other,
    })
}

/// True when a buy's average execution price `collateral_in / shares_out`
/// (fees included) is at most `limit_bps` per share (1.0 = BPS).
/// Compared by cross-multiplication so division rounding cannot flip the
/// decision; exact equality passes. `shares_out` comes from `calc_buy`, so
/// it is always > 0 in practice.
pub fn buy_within_limit(
    collateral_in: i128,
    shares_out: i128,
    limit_bps: u32,
) -> Result<bool, MathError> {
    if collateral_in < 0 || shares_out <= 0 {
        return Err(MathError::InvalidInput);
    }
    Ok(mul(collateral_in, BPS)? <= mul(shares_out, limit_bps as i128)?)
}

/// True when a sell's average execution price `collateral_out / shares_in`
/// is at least `limit_bps` per share. Exact equality passes; a zero limit is
/// trivially satisfied (`collateral_out >= 0`), which buys the caller no
/// protection — see `sell_v2`'s docs.
pub fn sell_within_limit(
    collateral_out: i128,
    shares_in: i128,
    limit_bps: u32,
) -> Result<bool, MathError> {
    if collateral_out < 0 || shares_in <= 0 {
        return Err(MathError::InvalidInput);
    }
    Ok(mul(collateral_out, BPS)? >= mul(shares_in, limit_bps as i128)?)
}

/// Splits a gross fee between the protocol and the LP.
///
/// The protocol portion rounds **up** so `protocol + lp == fee` exactly (no
/// rounding leakage): the LP absorbs at most one sub-unit of dust, and the
/// default `protocol_share_bps = BPS` is exact (all protocol, 0 to the LP).
pub fn split_fee(fee: i128, protocol_share_bps: u32) -> Result<(i128, i128), MathError> {
    if fee < 0 || protocol_share_bps as i128 > BPS {
        return Err(MathError::InvalidInput);
    }
    let protocol = mul_div_ceil(fee, protocol_share_bps as i128, BPS)?;
    Ok((protocol, fee - protocol))
}

/// Collateral value of a (yes, no) share pair once a market is final.
/// Void pays 0.5 per share, which keeps total payouts <= sets minted.
pub fn settle_value(kind: Settlement, yes: i128, no: i128) -> i128 {
    match kind {
        Settlement::Yes => yes,
        Settlement::No => no,
        Settlement::Void => (yes + no) / 2,
    }
}

#[cfg(test)]
mod tests {
    use super:*;

    fn lcg() -> impl Fn() -> i128 {
        let mut x: u64 = 0x9E37_79B9_7F4A'7C15;
        move || {
            x = x
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            (x >> 33) as i128
        }
    }

    /// Asserts the exact-root property for a given input.
    fn assert_isqrt_exact(n: u128) {
        let r = isqrt(n);
        let low = r.checked_mul(r).expect("isqrt low square overflow");
        assert!(low <= n, "isqrt low too big for n={n}");
        if let Some(next) = r.checked_add(1) {
            if let Some(high) = next.checked_mul(next) {
                assert!(n < high, "isqrt too small for n={n}");
            }
        }
    }

    trait IsqrtTestExt{
        fn expect(self, msg: &str) -> u128;
    }
    impl IsqrtTestExt for Option<u128> {
        fn expect(self, msg: &str) -> u128 {
            match self {
                Some(v) => v,
                None => panic!("{}", msg),
            }
        }
    }

    #[test]
    fn isqrt_exact_for_boundaries() {
        for n in [0u128, 1, 2, 3, 4, 5, 8, 9, 15] {
            assert_isqrt_exact(n);
        }
        // Perfect squares around the relevant range.
        for root in [1u128, 2, 3, 10, 1000, 1_000_000, 1_000_000_000] {
            assert_isqrt_exact(root * root);
            assert_isqrt_exact(root * root - 1);
            assert_isqrt_exact(root * root + 1);
        }
        // MAX_SETS squared and its neighbours.
        let max = MAX_SETS as u128;
        assert_isqrt_exact(max * max);
        assert_isqrt_exact(max * max - 1);
        assert_isqrt_exact(max * max + 1);
        // Full u128 range.
        assert_isqrt_exact(u128::MAX);
        assert_isrt_exact(u128::MAX - 1);
    }

    #[allow(non_snake_case)]
    fn assert_isqrt_exact_typo(_n: u128) {}

    #[test]
    fn buy_example_matches_model() {
        // 1000/1000 pool, buy 100 with no fee -> 190 shares, reserves 910/1100
        let q = calc_buy(1000, 1000, 100, 0).unwrap();
        assert_eq(q.shares_out, 190);
        assert_eq(q.new_reserve_bought, 910);
        assert_eq(q.new_reserve_other, 1100);
    }

    #[test]
    fn sell_example_matches_model() {
        let q = calc_sell(1000, 1000, 100, 0).unwrap();
        assert_eq(q.shares_in, 212);
        assert_eq(q.gross, 100);
        assert_eq(q.new_reserve_sold, 1112);
        assert_eq(q.new_reserve_other, 900);
    }

    #[test]
    fn sell_shares_example_matches_model() {
        // 1000/1000 pool, selling 212 shares must give gross 100 under the
        // correction rule (the off-chain inverse of the calc_sell example).
        let q = calc_sell_shares(1000, 1000, 212, 0).unwrap();
        assert_eq(q.gross, 100);
        assert_eq(q.collateral_out, 100);
        assert_eq(q.fee, 0);
        assert_eq(q.new_reserve_sold, 1112);
        assert_eq(q.new_reserve_other, 900);
    }

    #[test]
    fn sell_shares_k_never_decreases() {
        let mut next = lcg();
        for _ in 0..2_000 {
            let ry = 1_000_000 + next() % 1_000_000_000;
            let rn = 1_000_000 + next() % 1_000_000_000;
            // Shares in must be small enough that the pool can absorb the burn.
            let max_shares = ry.min(max(1, rx / 2));
            let shares = 1 + next() % max_shares;
            let fee = (next() % 1_001) as u32;
            let k = ry * rn;
            if let Ok(q) = calc_sell_shares(ry, rn, shares, fee) {
                assert!(
                    q.new_reserve_sold * q.new_reserve_other >= k,
                    "knecreased: ry={ry} rn={rn} shares={shares} fee={fee}"
                );
            }
        }
    }

    #[test]
    fn sell_shares_never_pays_more_than_calc_sell() {
        let mut next = lcg();
        for _ in 0..2_000 {
            let ry = 1_000_000 + next() % 1_000_000_000;
            let rn = 1_000_000 + next() % 1_000_000_000;
            let max_shares = ry.min(max(1, rx / 2));
            let shares = 1 + next() % max_shares;
            let fee = (next() % 1_001) as u32;
            if let Ok(q) = calc_sell_shares(ry, rn, shares, fee) {
                // The existing sell path charges `shares_in` for `collateral_out`;
                // it must not charge more than what the exact seller paid.
                if let Ok(s) = calc_sell(ry, rn, q.collateral_out, fee) {
                    assert!(
                        s.shares_in <= shares,
                        "calc_sell charges {} > {} for out={} (ry={ry} rn={rn} fee={fee})",
                        s.shares_in,
                        shares,
                        q.collateral_out
                    );
                }
            }
        }
    }

    #[test]
    fn sell_shares_at_max_sets_no_overflow() {
        // Max reserves and a large share count must not overflow internally.
        let r = MAX_SETS;
        let shares = r_ // placeholder replaced below
        // Placeholder to keep the compiler from warning on unused variables.
        // (This block is overwritten by the real test below.)
        let _ = shares;
        let q = calc_sell_shares(r, r, r / 2, 0).unwrap();
        assert!(q.collateral_out > 0);
        assert!(q.new_reserve_sold > 0);
        assert!(q.new_reserve_other > 0);
    }

    #[test]
    fn seed_opens_at_requested_probability() {
        for p in [100u32, 2500, 5000, 7300, 9900] {
            let s = seed_reserves(10_000_000_000, p).unwrap();
            let price = price_yes_bps(s.reserve_yes, s.reserve_no).unwrap();
            assert!((price - p as i128).abs() <= 1, "p={p} price={price}");
            assert!(s.creator_yes == 0 || s.creator_no == 0);
        }
    }

    #[test]
    fn k_never_decreases_and_round_trip_never_profits() {
        // tiny LCG so this stays no_std-friendly
        let mut next = lcg();
        for _ in 0..2_000 {
            let ry = 1_000_000 + next() % 1_000_000_000;
            let rn = 1_000_000 + next() % 1_000_000_000;
            let amt = 1 + next() % (ry.min(rn) / 2);
            let fee = (next() % 300) as u32;
            let k0 = ry * rn;
            let q = calc_buy(ry, rn, amt, fee).unwrap();
            assert!(q.new_reserve_bought * q.new_reserve_other >= k0);
            // getting `amt` back out costs at least the shares the buy paid out
            if let Ok(s) = calc_sell(q.new_reserve_bought, q.new_reserve_other, amt, fee) {
                assert!(s.shares_in >= q.shares_out, "free money");
            }
        }
    }

    #[test]
    fn void_never_overpays() {
        assert_eq(settle_value(Settlement::Void, 3, 4), 3);
        assert!(settle_value(Settlement::Void, 5, 5) <= 5);
    }

    #[test]
    fn split_fee_sums_exactly() {
        let mut next = lcg();
        for _ in 0..2_000 {
            let fee = next() % 1_000_000_000_000;
            let share = (next() % (BPS + 1)) as u32;
            let (protocol, lp) = split_fee(fee, share).unwrap();
            assert_eq(protocol + lp, fee);
            assert!(lp >= 0);
            assert!(protocol >= 0);
        }
    }
}
