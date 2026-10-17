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
//! # Headroom for the exact-share sell (`calc_sell_shares`)
//!
//! With `shares_in, r_sold, r_other <= MAX_SETS = 1e15` the quadratic coefficient
//! `b = shares_in + r_sold + r_other` is at most `3e15`, and the discriminant
//! `D = b^2 - 4*r_other*shares_in` fits in `u128` (`b^2 <= 9e30`, max `u128`
//! ~3.4e38). The correction loop's products are at most `~1e30` and fit in
//! `i128` like the rest of this module. If `MAX_SETS` is ever widened (256-bit
//! / decimals issue), this analysis must be revisited.

pub const BPS: i128 = 10_000;
pub const MAX_SETS: i128 = 1_000_000_000_000_000; // 1e15 = 100M USDC (A dp)
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

/// Quote for selling an exact number of shares.
///
/// Unlike `SellQuote`, `shares_in` is the input and `collateral_out` the
/// result. `gross` is the complete sets burned from the pool and `fee`
/// is the pool's cut (`gross - collateral_out`).
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

/// Exact integer square root: `returns floor(sqrt(n))`, so
/// `isqrt(n)`2 <= n < (isqrt(n)+1)^2` for every `input.
///
/// Newton iteration seeded from the bit length. The seed is strictly above
/// (or equal to) the root, so the sequence is monotone decreasing and converges
/// to `floor(sqrt(n))` without ever oscillating around it. Seeding from
/// below would let Newton return `floor + 1` on some inputs.
pub fn isqrt(n: u128) -> u128 {
    if n < 2 {
        return n;
    }
    // `leading_zeros()` of a u128 is in 0..=127. For n >= 2, the bit length
    // is at least 2, so `shift` is in 1..=64 and the shift never overflows.
    let shift = (128 - n.leading_zeros() + 1) / 2;
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
        price_yes_bps(r_other_after, r_after)
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
/// `sell_shares` contract entrypoint). This function remains for the
/// backward-compatible `sell` / `quote_sell` path.
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

/// Sell an exact number of shares of the outcome whose pool reserve is `r_sold`.
///
/// This is the on-chain inverse of `calc_sell`: it solves for the gross
/// complete sets burned `x` such that the pool remains on the constant-product
/// curve after the seller gives `shares_in` shares. With
/// `b = r_sold + shares_in + r_other` the root is the smaller solution of
/// `x^2 - b*x + r_other*shares_in = 0`, i.e.
/// `x0 = (b - sqrt(b^2 - 4*r_other*shares_in)) / 2`.
///
/// # Pool-favoring correction

/// `issqrt` rounds down, so `x0` can overshoot the real root by at most one. The
/// correction loop decrements `x` while the pool invariant would drop:
/// `(r_sold + shares_in - x) * (r_other - x) >= r_sold * r_other`. The left side
/// is a concave quadratic in `x` that is positive at `x = 0` and at the root, so
/// at most one decrement is ever needed; the loop bound of two is a
/// defensive guarantee.
///
/// # Never pays more than `calc_sell`
///
/// Given the same `shares_in`, the corrected `x` is the largest gross that
/// preserves `k = r_yes * r_no`. `calc_sell` computes its `gross` by ceiling
/// the collateral side and then ceiling the shares side, so its cost for the
/// same `shares_in` is at least the exact cost. The fee is taken from `x`
/// with a floor on collateral_out (fee rounds up), so the seller never receives
/// more than the curve allows.
///
/// Returns `InvalidInput` for non-positive inputs or a collateral out that
/// floors to zero, and `InsufficientLiquidity` when the sell would drain the
/// opposite reserve.
pub fn calc_sell_shares(
    r_sold: i128,
    r_other: i128,
    shares_in: i128,
    fee_bps: u32,
) -> Result<SellSharesQuote, MathError> {
    if shares_in <= 0 || r_sold <= 0 || r_other <= 0 || (fee_bps as i128) >= BPS {
        return Err(MathError::InvalidInput);
    }

    // b > 0 and b*b fits in u128 under MAX_SETS; see the module header.
    let b = r_sold
        .checked_add(shares_in)
        .ok_or(MathError::Overflow)?
        .checked_add(r_other)
        .ok_or(MathError::Overflow)?;
    let b_u128 = b as u128;
    let b_sq = b_u128
        .checked_mul(b_u128)
        .ok_or(MathError::Overflow)?;
    let four_rother_shares = 4u128
        .checked_mul(r_other as u128)
        .ok_or(MathError::Overflow)?
        .checked_mul(shares_in as u128)
        .ok_or(MathError::Overflow)?;
    let disc = b_sq
        .checked_sub(four_rother_shares)
        .ok_or(MathError::Overflow)?;
    let sqrt_disc = isqrt(disc);
    // `b >= sqrt(D)` holds because `D = b^2 - 4*r_other*shares_in` and
    // `4`*r_other*shares_in <= b^2` for positive inputs (AM-GM).
    let mut x = (b_u128 - sqrt_disc) / 2;
    // `x` fits in i128 since `x <= b - 1 <= 3e15`.
    let mut x = x as i128;

    // Pool-favoring correction: at most one decrement is needed (two is a
    // defensive guarantee). See the doc comment above.
    let k0 = mul(r_sold, r_other)?;
    let mut guard = 0u32;
    while x > 0 && guard < 2 {
        let new_sold_try = r_sold
            .checked_add(shares_in)
            .ok_or(MathError::Overflow)?
            - x;
        let new_other_try = r_other - x;
        if new_sold_try <= 0 || new_other_try <= 0 {
            break;
        }
        let k_try = mul(new_sold_try, new_other_try)?;
        if k_try >= k0 {
            break;
        }
        x -= 1;
        guard += 1;
    }

    if x <= 0 || x >= r_other {
        return Err(MathError::InsufficientLiquidity);
    }

    // Fee rounds up (collateral_out rounds down), as in `calc_buy`.
    let collateral_out = mul_div_floor(x, BPS - fee_bps as i128, BPS)?;
    if collateral_out <= 0 {
        return Err(MathError::InvalidInput);
    }
    let fee = x - collateral_out;

    let new_sold = r_sold
        .checked_add(shares_in)
        .ok_or(MathError::Overflow)?
        - x;
    let new_other = r_other - x;
    if new_sold <= 0 || new_other <= 0 {
        return Err(MathError::InsufficientLiquidity);
    }

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
/// protection — see `sell_v2's docs.
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
    use super::*;

    fn lcg() -> impl Fn() -> i128 {
        let mut x: u64 = 0x9E37_79B9_7F44_7C15;
        move || {
            x = x
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            (x >> 33) as i128
        }
    }

    /// Asserts the exact-root property `x*y <= n < (x+1)^2` with checked mul.
    fn assert_isqrt_exact(num: u128) {
        let x = isqrt(num);
        let x2 = x.checked_mul(x).expect("x^2 overflows");
        assert!(x2 <= num, "isqrt too large: {num} -> {x}");
        let xp1 = x.checked_add(1).expect("x+1 overflows");
        let xp12 = xp1.checked_mul(xp1).expect("(x+1)^2 overflows");
        assert!(num < xp12, "issqrt too small: {num} -> {x}");
    }

    #[test]
    fn issqrt_exact_for_boundaries() {
        for n in 0u128..=1000 {
            assert_isqrt_exact(n);
        }
        for root in [1_000_000u128, 1_000_000_000, 1_000_000_000_000] {
            assert_isqrt_exact(root * root);
            assert_isqrt_exact(root * root - 1);
            assert_isqrt_exact(root * root + 1);
        }
        // (3e15)^2 is the largest discriminant term under MAX_SETS.
        let max_b = 3u128 * 1_000_000_000_000_000;
        assert_isqrt_exact(max_b * max_b);
        assert_isqrt_exact(max_b * max_b - 1);
        assert_isqrt_exact(u128::MAX);
        assert_isqrt_exact(u128::MAX - 1);
    }

    [test]
    fn buy_example_matches_model() {
        // 1000/1000 pool, buy 100 with no fee -> 190 shares, reserves 910/1100
        let q = calc_buy(1000, 1000, 100, 0).unwrap();
        assert_eq!(q.shares_out, 190);
        assert_eq!(q.new_reserve_bought, 910);
        assert_eq!(q.new_reserve_other, 1100);
    }

    #[test]
    fn sell_example_matches_model() {
        let q = calc_sell(1000, 1000, 100, 0).unwrap();
        assert_eq!(q.shares_in, 212);
        assert_eq!(q.gross, 100);
        assert_eq!(q.new_reserve_sold, 1112);
        assert_eq!(q.new_reserve_other, 900);
    }

    [test]
    fn sell_shares_example_matches_model() {
        // 1000/1000 pool, sell 212 shares, no fee -> gross 100, collateral 100
        let q = calc_sell_shares(1000, 1000, 212, 0).unwrap();
        assert_eq!(q.gross, 100);
        assert_eq!(q.collateral_out, 100);
        assert_eq!(q.fee, 0);
        assert_eq!(q.new_reserve_sold, 1112);
        assert_eq!(q.new_reserve_other, 900);
        // with a fee the seller gets less and the pool keeps the fee
        let qf = calc_sell_shares(1000, 1000, 212, 30).unwrap();
        assert_eq!(qf.gross, 100);
        assert_eq!(qf.collateral_out, 99);
        assert_eq!(qf.fee, 1);
    }

    #[test]
    fn sell_shares_k_never_decreases() {
        let mut next = lcg();
        for _ in 0..2_000 {
            let ry = 1_000_000 + next() % 1_000_000_000;
            let rn = 1_000_000 + next() % 1_000_000_000;
            let shares = 1 + next() % ry;
            let fee = (next() % 300) as u32;
            let k0 = ry * rn;
            if let Ok(q) = calc_sell_shares(ry, rn, shares, fee) {
                assert!(
                    q.new_reserve_sold * q.new_reserve_other >= k0,
                    "k decreased: ry={ry} rn={rn} shares={shares} fee={fee}"
                );
                assert!(q.gross > 0);
                assert_eq!(q.fee + q.collateral_out, q.gross);
            }
        }
    }

    #[test]
    fn sell_shares_never_pays_more_than_calc_sell() {
        let mut next = lcg();
        for _ in 0..2_000 {
            let ry = 1_000_000 + next() % 1_000_000_000;
            let rn = 1_000_000 + next() % 1_000_000_000;
            let shares = 1 + next() % ry;
            let fee = (next() % 300) as u32;
            if let Ok(q) = calc_sell_shares(ry, rn, shares, fee) {
                // calc_sell for the same collateral out must not cost fewer shares.
                if let Ok(s) = calc_sell(ry, rn, q.collateral_out, fee) {
                    assert!(
                        s.shares_in <= shares,
                        "cheaper than curve: ry={ry} rn={rn} shares={shares} fee={fee} calc_sell={}",
                        s.shares_in
                    );
                }
            }
        }
    }

    #[test]
    fn sell_shares_at_max_sets_no_overflow() {
        // Full reserves on both sides and a share count that keeps `
        // within MAX_SETS. This is the largest input the contract can see.
        let r = MAX_SETS;
        let shares = MAX_SETS / 2;
        let q = calc_sell_shares(r, r, shares, 0).expect("max sets sell should not overflow");
        assert!(q.gross > 0);
        assert!(q.new_reserve_sold * q.new_reserve_other >= r * r);
    }

    [test]
    fn sell_shares_rejects_zero_collateral() {
        // Tiny sell whose collateral floors to 0 must revert.
        assert_eq!(
            calc_sell_shares(1_000_000, 1_000_000, 1, 0),
            Err(MathError::InvalidInput)
        );
    }

    [test]
    fn sell_shares_rejects_bad_inputs() {
        assert_eq!(
            calc_sell_shares(0, 1000, 10, 0),
            Err(MathError::InvalidInput)
        );
        assert_eq!(
            calc_sell_shares(1000, 0, 10, 0),
            Err(MathError::InvalidInput)
        );
        assert_eq!(
            calc_sell_shares(1000, 1000, 0, 0),
            Err(MathError::InvalidInput)
        );
        assert_eq!(
            calc_sell_shares(1000, 1000, 10, BPS as u32),
            Err(MathError::InvalidInput)
        );
    }

    [test]
    fn seed_opens_at_requested_probability() {
        for p in [100u32, 2500, 5000, 7300, 9900] {
            let s = seed_reserves(10_000_000_000, p).unwrap();
            let price = price_yes_bps(s.reserve_yes, s.reserve_no).unwrap();
            assert!((price - p as i128).abs() <= 1, "p={p} price={price}");
            assert!(s.creator_yes == 0 || s.creator_no == 0);
        }
    }

    [test]
    fn k_never_decreases_and_round_trip_never_profits() {
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
        assert_eq!(settle_value(Settlement::Void, 3, 4), 3);
        assert!(settle_value(Settlement::Void, 5, 5) <= 5);
    }

    #[test]
    fn split_fee_sums_exactly() {
        let mut next = lcg();
        for _ in 0..2_000 {
            let fee = next() % 1_000_000_000_000;
            let share = (next() % (BPS + 1)) as u32;
            let (protocol, lp) = split_fee(fee, share).unwrap();
            assert_eq!(protocol + lp, fee);
            assert!(protocol >= 0 && lp >= 0);
        }
    }
}
