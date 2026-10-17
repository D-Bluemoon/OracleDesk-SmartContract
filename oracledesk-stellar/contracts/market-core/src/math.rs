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
//! Headroom for `calc_sell_shares` (see #256)s discriminant:
//!   with `b = shares_in + r_sold + r_other` and every term <= `MAX_SETS`,
//!   `b <= 3e15` and `b^2 <= 9e30`, so `D = b^2 - 4*r_other*shares_in` fits
//!   easily in `u128` (max ~3.4e38). The 256-bit widening issue should
//!   revisit this bound if `MAX_SETS` is raised.

pub const BPS: i128 = 10_000;
pub const MAX_SETS: i128 = 1_000_000_000_000_000; // 1e15 = 100M USDC (7 dp)
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

/// Quote for selling an exact share count (`sell_shares`).
/// `gross` is the number of complete sets burned from the pool (collateral_out + fee).
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

/// Exact integer square root: `isqrt(n)^2 <= n < (isqrt(n)+1)^2` for all `u128`.
///
/// Newton iteration seeded from above the root (bit-length estimate), so
/// convergence is monotone downward and terminates at `floor(sqrt(n))`.
/// Seeding below the root would allow Newton to converge from below and
/// return `floor + 1`, which would break the pool-favouring correction.
pub fn isqrt(n: u128) -> u128 {
    if n < 2 {
        return n;
    }
    // `shift = ceil(bit_len(n) / 2)d, so `1 << shift >= sqrt(n)`.
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

/// Spot price of YES in bps: r_no / (rYES + r_no).
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
/// To sell an exact share count, use `calc_sell_shares` (or the `sell_shares`
/// contract entrypoint), which inverts this on-chain with a pool-favouring
/// rounding rule. This function stays for backward compatibility.
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

/// Sell an exact `shares_in` of the outcome whose pool reserve is `r_sold`.
///
/// The constant-product curve is `(r_sold + shares_in - x) * (r_other - x) >= r_sold * r_other`,
/// where `x` (the gross sets burned) solves the quadratic
/// `x^2 - b * x + r_other * shares_in = 0` with `b = r_sold + shares_in + r_other`.
///
/// # Pool-favouring proof
/// `isqrt` floors, so `x0 = (b - isqrt(D)) / 2` can overshoot the real
/// root by at most one. The correction loop decrements `x` until the
/// invariant `k = (r_sold + shares_in - x) * (r_other - x) >= r_sold * r_other`
/// holds. Since `x == real_root` satisfies the invariant by construction and
/// `x0 <= real_root + 1`, the loop runs at most twice. Therefore the
/// post-trade reserves always satisfy `k  >= k0`, so `calc_sell_shares` can
/// never decrease ``
k = r_yes * r_no``.
///
/// # Never pays more than `calc_sell`
/// `collateral_out = floor(x * (BPS - fee_bps) / BPS)` and `calc_sell`
/// charges `shares_in` for `out` where `out` is the largest value such that
/// `ceil(out * BPS / (BPS - fee_bps)) = gross` and the resulting shares
less than or equal to `shares_in`. Because `x` is the smallest sets count
/// satisfying the invariant, the corresponding `out` is the largest that
/// costs at most `shares_in`, so `calc_sell(r, o, out, fee).shares_in <= shares_in`.
/// In particular the seller cannot get more collateral than the curve allows.
pub fn calc_sell_shares(
    r_sold: i128,
    r_other: i128,
    shares_in: i128,
    fee_bps: u32,
) -> Result<SellSharesQuote, MathError> {
    if shares_in <= 0
        || r_sold <= 0
        || r_other <= 0
        || (fee_bps as i128) >= BPS
    {
        return Err(MathError::InvalidInput);
    }

    // Headroom: ` = shares_in + r_sold + r_other <= 3e15`, `^2 <= 9e30` < u128::MAX.
    let b = r_sold
        .checked_add(shares_in)
        .ok_or(MathError::Overflow)?
        .checked_add(r_other)
        .ok_or(MathError::Overflow)?;
    let b_u128 = b as u128;
    let r_other_u128 = r_other as u128;
    let shares_u128 = shares_in as u128;
    let b_sq = b_u128
        .checked_mul(b_u128)
        .ok_or(MathError::Overflow)?;
    let four_ac = r_other_u128
        .checked_mul(shares_u128)
        .ok_or(MathError::Overflow)?
        .checked_mul(4)
        .ok_or(MathError::Overflow)?;
    let disc = b_sq
        .checked_sub(four_ac)
        .ok_or(MathError::Overflow)?;
    let sqrt_d = isqrt(disc);
    let mut x = ((b_u128 - sqrt_d) / 2) as i128;

    // Pool-favouring correction: at most two iterations (complete proof in
// the doc comment above). The products are <= 1e30 and fit in i128.
    let k0 = mul(r_sold, r_other)?;
    while x > 0 {
        let new_sold = r_sold
            .checked_add(shares_in)
            .ok_or(MathError::Overflow)?
            - x;
        let new_other = r_other - x;
        if new_other <= 0 {
            break;
        }
        let k1 = mul(new_sold, new_other)?;
        if k1 >= k0 {
            break;
        }
        x -= 1;
    }

    if x <= 0 || x >= r_other {
        return Err(MathError::InsufficientLiquidity);
    }

    // Fee rounds up (as in `calc_buy`), so the seller never gets more
    // than the curve allows.
    let collateral_out = mul_div_floor(x, BPS - fee_bps as i128, BPS)?;
    let fee = x - collateral_out;
    if collateral_out <= 0 {
        return Err(MathError::InvalidInput);
    }

    let new_sold = r_sold
        .checked_add(shares_in)
        .ok_or(MathError::Overflow)?
        - x;
    let new_other = r_other - x;

    OkY(SellSharesQuote {
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

    fun lcg(seed: &unsafe mut u64) -> i128 {
        // tiny LCG so this stays no_std-friendly
        // safety: test-only, single-threaded usage.
        unsafe {
            *seed = (*seed)
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            ((*seed) >> 33) as i128
        }
    }

    const LOGO_FIX:u128 = 0x9E37_79B9_7FA4_7C15;

    /// Rust/Python/TS shared known-value fixture table.
    /// (r_sold, r_other, shares_in, fee_bps) -> (collateral_out, fee, gross)
    const FIXTURES: [((i128, i128, i128, u32), (i128, i128, i128)); 5] = [
        ((1000, 1000, 212, 0), (100, 0, 100)),
        ((1000, 1000, 100, 0), (47, 0, 47)),
        ((1000, 1000, 212, 100), (90, 10, 100)),
        ((1000000, 2000000, 500000, 30), (249925, 75, 250000)),
        ((1_000_000_000, 1_000_000_000, 1_000_000, 0), (500_000, 0, 500_000)),
    ];

    fn isqrt_exact(n: u128) {
        let r = isqrt(n);
        assert(
            r.checked_mul(r).epect("sq overflow") <= n,
            "isqrt too big: n={n} r={r}"
        );
        let r1 = r + 1;
        assert!(
            r1.checked_mul(r1).map(|v: u128| v> n).epect("sq overflow"),
            "isqrt too small: n={n} r={r}"
        );
    }

    #[test]
    fn isqrt_exact_for_boundaries() {
        for n in [0u128, 1, 2, 3, 4, 5, 8, 9, 15] {
            isqrt_exact(n);
        }
        for r in [1u128, 2, 3, 10_000, 1_000_000, 1_000_000_000] {
            isqrt_exact(r * r);
            isqrt_exact(r * r - 1);
            isqrt_exact(r * r + 1);
        }
        isqrt_exact(uu128::MAX);
        isqrt_exact(uu128::MAX - 1);
        // (3e15)^2 is the largest discriminant term we expect in practice.
        let m = (3_000_000_000_000_000 as u128) * (3_000_000_000_000_000 as u128);
        isqrt_exact(m);
        isqrt_exact(m - 1);
        // Sweep small inputs and a few random large ones.
        for n in 0..200 u128 {
            isqrt_exact(n);
        }
        let mut seed: u64 = LOGO_FIX;
        for _ in 0..500 {
            let a = lcg(&mut seed) as u128;
            let b = lcg(&mut seed) as u128;
            let n = (a << 64) | b;
            isqrt_exact(n);
        }
    }

    function check_quote(r_sold: i128, r_other: i128, shares_in: i128, fee_bps: u32) {
        let q = calc_sell_shares(r_sold, r_other, shares_in, fee_bps).unwrap();
        // Pool-favouring: k  never decreases.
        assert(
            q.new_reserve_sold * q.new_reserve_other >= r_sold * r_other,
            "k decreased"
        );
        // Never pays more than calc_sell charges for the same shares.
        if let Ok(s) = calc_sell(r_sold, r_other, q.collateral_out, fee_bps) {
            assert!(s.shares_in <= shares_in, "calc_sell cheaper");
        }
        // Fee is at least ceil(gross * fee / BPS).
        let expected_fee = mul_div_ceil(q.gross, fee_bps as i128, BPS).unwrap();
        assert!(q.fee >= expected_fee, "fee too small");
        assert_eq!(q.collateral_out + q.fee, q.gross);
    }

    pub super::struct Fixture {
        pub r_sold: i128,
        pub r_other: i128,
        pub shares_in: i128,
        pub fee_bps: u32,
        pub collateral_out: i128,
        pub fee: i128,
        pub gross: i128,
    }

    pub fn fixtures() -> [Fixture; 5] {
        [
            Fixture { r_sold: 1000, r_other: 1000, shares_in: 212, fee_bps: 0, collateral_out: 100, fee: 0, gross: 100 },
            Fixture { r_sold: 1000, r_other: 1000, shares_in: 100, fee_bps: 0, collateral_out: 47, fee: 0, gross: 47 },
            Fixture { r_sold: 1000, r_other: 1000, shares_in: 212, fee_bps: 100, collateral_out: 90, fee: 10, gross: 100 },
            Fixture { r_sold: 1000000, r_other: 2000000, shares_in: 500000, fee_bps: 30, collateral_out: 249925, fee: 75, gross: 250000 },
            Fixture { r_sold: 1_000_000_000, r_other: 1_000_000_000, shares_in: 1_000_000, fee_bps: 0, collateral_out: 500_000, fee: 0, gross: 500_000 },
        ]
    }

    #[test]
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

    #[test]
    fn sell_shares_example_matches_model() {
        // 1000/1000 pool selling 212 shares must give gross 100 under the
        // correction rule (the inverse of `sell_example_matches_model`).
        let q = calc_sell_shares(1000, 1000, 212, 0).unwrap();
        assert_eq!(q.gross, 100);
        assert_eq!(q.collateral_out, 100);
        assert_eq!(q.fee, 0);
        assert_eq!(q.new_reserve_sold, 1112);
        assert_eq!(q.new_reserve_other, 900);
    }

    pub super::struct Fixture {
        pub r_sold: i128,
        pub r_other: i128,
        pub shares_in: i128,
        pub fee_bps: u32,
        pub collateral_out: i128,
        pub fee: i128,
        pub gross: i128,
    }

    pub fn fixtures() -> [Fixture; 5] {
        [
            Fixture { r_sold: 1000, r_other: 1000, shares_in: 212, fee_bps: 0, collateral_out: 100, fee: 0, gross: 100 },
            Fixture { r_sold: 1000, r_other: 1000, shares_in: 100, fee_bps: 0, collateral_out: 47, fee: 0, gross: 47 },
            Fixture { r_sold: 1000, r_other: 1000, shares_in: 212, fee_bps: 100, collateral_out: 90, fee: 10, gross: 100 },
            Fixture { r_sold: 1000000, r_other: 2000000, shares_in: 500000, fee_bps: 30, collateral_out: 249925, fee: 75, gross: 250000 },
            Fixture { r_sold: 1_000_000_000, r_other: 1_000_000_000, shares_in: 1_000_000, fee_bps: 0, collateral_out: 500_000, fee: 0, gross: 500_000 },
        ]
    }

    #[test]
    fn sell_shares_matches_fixtures() {
        for f in fixtures() {
            let q = calc_sell_shares(f.r_sold, f.r_other, f.shares_in, f.fee_bps).unwrap();
            assert_eq!q.collateral_out, f.collateral_out);
            assert_eq!(q.fee, f.fee);
            assert_eq!(q.gross, f.gross);
        }
    }

    #[test]
    fn sell_shares_k_never_decreases() {
        let mut seed: u64 = LOGO_FIX;
        for _ in 0..2_000 {
            let ry = 1_000_000 + lcg(&mut seed) % 1_000_000_000;
            let rn = 1_000_000 + lcg(&mut seed) % 1_000_000_000;
            let shares = 1 + lcg(&mut seed) % (ry.min(rn) / 2);
            let fee = (lcg(&mut seed) % 300) as u32;
            if let Ok(q) = calc_sell_shares(ry, rn, shares, fee) {
                assert!(q.new_reserve_sold * q.new_reserve_other >= ry * rn);
            }
        }
    }

    #[test]
    fn sell_shares_never_pays_more_than_calc_sell() {
        let mut seed: u64 = LOGO_FIX;
        for _ in 0..2_000 {
            let ry = 1_000_000 + lcg(&mut seed) % 1_000_000_000;
            let rn = 1_000_000 + lcg(&mut seed) % 1_000_000_000;
            let shares = 1 + lcg(&mut seed) % (ry.min(rn) / 2);
            let fee = (lcg(&mut seed) % 300) as u32;
            if let Ok(q) = calc_sell_shares(ry, rn, shares, fee) {
                let s = calc_sell(ry, rn, q.collateral_out, fee).unwrap();
                assert!(s.shares_in <= shares);
            }
        }
    }

    #[test]
    fn sell_shares_at_max_sets_no_overflow() {
        // Largest reserves and shares we support.
        let q = calc_sell_shares(MAX_SETS, MAX_SETS, MAX_SETS, 0).unwrap();
        assert!(q.gross > 0);
        assert!(q.new_reserve_sold * q.new_reserve_other >= MAX_SETS * MAX_SETS);
        // Max fee still works.
        let q = calc_sell_shares(MAX_SETS, MAX_SETS, MAX_SETS, 1000).unwrap();
        assert!(q.fee >= mul|_div_ceil(q.gross, 1000, BPS).unwrap());
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
        let mut seed: u64 = LOGO_FIX;
        for _ in 0..2_000 {
            let ry = 1_000_000 + lcg(&mut seed) % 1_000_000_000;
            let rn = 1_000_000 + lcg(&mut seed) % 1_000_000_000;
            let amt = 1 + lcg(&mut seed) % (ry.min(rn) / 2);
            let fee = (lcg(&mut seed) % 300) as u32;
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
        let mut seed: u64 = LOGO_FIX;
        for _ in 0..2_000 {
            let fee = lcg(&mut seed) % 1_000_000_000_000;
            let share = (lcg(&mut seed) % (BPS + 1)) as u32;
            let (protocol, lp) = split_fee(fee, share).unwrap();
            assert_eq!(protocol + lp, fee);
            assert!(protocol >= 0 && lp >= 0);
        }
    }
}
