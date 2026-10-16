#![no_std]

mod math;
pub mod ttl;

use math::{MathError, Settlement, BPS, MAX_SETS};
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    Address, BytesN, Env, String,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Fee ceiling: 10%.
const MAX_FEE_BPS: u32 = 1_000;
/// Minimum seed liquidity: 100 USDC (7 decimals). Stops spam markets.
const MIN_SEED: i128 = 100 * 10_000_000;

/// Redemption-window bounds, in seconds. A holder cannot be forced to redeem
/// within weeks of resolution (180-day floor), and a market cannot sit
/// waitable-forever (5-year ceiling). The 365-day default is snapshotted
/// into each market at creation, so an admin change never moves an
/// existing deadline.
const DEFAULT_REDEEM_HORIZON_SECS: u64 = 365 * ttl::DAY_SECS;
const MIN_REDEEM_HORIZON_SECS: u64 = 180 * ttl::DAY_SECS;
const MAX_REDEEM_HORIZON_SECS: u64 = 1_825 * ttl::DAY_SECS;

// ---------------------------------------------------------------------------
// Types shared with the frontend/backend
// ---------------------------------------------------------------------------
// Generate TypeScript bindings straight from the compiled contract
// (`stellar contract bindings typescript`) so enums like `Category` cannot
// drift between the contract, the API and the UI.

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Outcome {
    Yes,
    No,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Category {
    Crypto,
    Macro,
    Geopolitics,
    Sports,
    Culture,
    Other,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MarketStatus {
    /// Trading allowed until `close_time`, then waiting for the resolver.
    Open,
    /// Final. Winning shares redeem 1:1.
    Resolved(Outcome),
    /// Invalid market. Every share redeems at 0.5.
    Void,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Market {
    pub creator: Address,
    /// sha256 of the canonical question JSON stored off-chain (IPFS), so a
    /// client can prove the text it shows is the text that was committed.
    pub question_hash: BytesN<32>,
    /// Commitment to how this market will be resolved, fixed at creation so
    /// the creator cannot pick favorable resolution rules after seeing
    /// trading activity. The resolver contract verifies a revealed spec
    /// against this hash before configuring itself for the market. See
    /// `docs/adr/0001-resolution-commitment.md`.
    pub resolution_hash: BytesN<32>,
    /// IPFS CID / URI of the question metadata.
    pub meta_uri: String,
    pub category: Category,
    /// Unix seconds (ledger timestamp). Trading stops at this time.
    pub close_time: u64,
    /// Snapshot of the fee at creation so later config changes never move it.
    pub fee_bps: u32,
    pub status: MarketStatus,
    pub reserve_yes: i128,
    pub reserve_no: i128,
    /// Complete sets in existence == collateral locked for this market.
    pub sets_minted: i128,
    /// Trading fees waiting for `sweep_fees`.
    pub fees_accrued: i128,
    /// Creator has withdrawn the pool remainder after finality.
    pub lp_claimed: bool,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Position {
    pub yes: i128,
    pub no: i128,
}

/// Per-market settlement bookkeeping (issue #14). Lives in its own entry so
/// the `Market` XDR stays unchanged.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SettleState {
    /// Outcome shares held outside the pool (user positions), still
    /// redeemable. `redeem` decrements the redeeming holder's shares on both
    /// sides, so a losing-side redemption (payout 0) still clears here.
    pub outstanding_yes: i128,
    pub outstanding_no: i128,
    /// Timestamp of `resolve` / `void_market`; 0 while the market is Open.
    pub finalized_at: u64,
    /// Redemption window, snapshotted at creation from the admin default.
    /// `redeem_deadline = finalized_at + horizon_secs`.
    pub horizon_secs: u64,
    /// Collateral already paid to holders and the LP (`redeem` +
    /// `claim_pool_remainder` payouts); tracks what has left the market.
    pub paid_out: i128,
    /// `finalize_market` has swept the market's remaining balance; no
    /// redemption or claim can ever pay out again.
    pub closed: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub collateral: Address,
    pub treasury: Address,
    pub resolver: Address,
    pub default_fee_bps: u32,
    pub paused: bool,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    // instance storage (one entry, shared TTL): global config
    Admin,
    Collateral,
    Treasury,
    Resolver,
    DefaultFeeBps,
    Paused,
    NextId,
    DefaultRedeemHorizon,
    // persistent storage (one entry each, own TTL)
    Market(u64),
    Position(u64, Address),
    Settle(u64),
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    Paused = 2,
    InvalidFee = 3,
    InvalidAmount = 4,
    InvalidProbability = 5,
    InvalidCloseTime = 6,
    MarketNotFound = 7,
    MarketNotOpen = 8,
    MarketClosed = 9,
    NotClosedYet = 10,
    NotFinal = 11,
    SlippageExceeded = 12,
    InsufficientShares = 13,
    InsufficientLiquidity = 14,
    MarketTooLarge = 15,
    NothingToRedeem = 16,
    AlreadyClaimed = 17,
    Overflow = 18,
    // 19 is reserved for the TWAP accumulator's `ObservationTooOld` (#11).
    /// `finalize_market` called before the redemption deadline.
    RedemptionWindowOpen = 20,
    /// Market already closed by `finalize_market`; redemption is over.
    RedemptionClosed = 21,
    /// Legacy market created before `SettleState` existed: outstanding shares
    /// cannot be reconstructed on-chain, so it has no deadline and cannot be
    /// finalized (still fully redeemable).
    NotSupported = 22,
}

impl From<MathError> for Error {
    fn from(e: MathError) -> Self {
        match e {
            MathError::Overflow => Error::Overflow,
            MathError::InvalidInput => Error::InvalidAmount,
            MathError::InsufficientLiquidity => Error::InsufficientLiquidity,
        }
    }
}

// ---------------------------------------------------------------------------
// Events (the backend indexes these into Postgres; RPC keeps only a short
// event window, so do not rely on querying old events live)
// ---------------------------------------------------------------------------

#[contractevent]
pub struct MarketCreated {
    #[topic]
    pub market_id: u64,
    pub creator: Address,
    pub category: Category,
    pub close_time: u64,
    pub seed_amount: i128,
    pub initial_yes_bps: u32,
}

#[contractevent]
pub struct Trade {
    #[topic]
    pub market_id: u64,
    #[topic]
    pub trader: Address,
    pub outcome: Outcome,
    pub is_buy: bool,
    pub collateral: i128,
    pub shares: i128,
    pub fee: i128,
    pub reserve_yes: i128,
    pub reserve_no: i128,
}

#[contractevent]
pub struct MarketResolved {
    #[topic]
    pub market_id: u64,
    /// None means the market was voided.
    pub outcome: Option<Outcome>,
}

#[contractevent]
pub struct Redeemed {
    #[topic]
    pub market_id: u64,
    #[topic]
    pub holder: Address,
    pub payout: i128,
}

#[contractevent]
pub struct FeesSwept {
    #[topic]
    pub market_id: u64,
    pub amount: i128,
}

#[contractevent]
pub struct MarketFinalized {
    #[topic]
    pub market_id: u64,
    /// Everything swept to the treasury: expired user claims, an unclaimed
    /// LP remainder, rounding dust and accrued fees.
    pub swept: i128,
    /// The part of `swept` that was reserved for shares never redeemed.
    pub unclaimed_user: i128,
    /// Rounding left over after per-holder void floors were accounted for.
    pub dust: i128,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct MarketCore;

#[contractimpl]
impl MarketCore {
    /// Runs atomically at deploy time, so nobody can front-run initialization.
    pub fn __constructor(
        env: Env,
        admin: Address,
        collateral: Address,
        treasury: Address,
        resolver: Address,
        default_fee_bps: u32,
    ) {
        if default_fee_bps > MAX_FEE_BPS {
            panic_with_error!(&env, Error::InvalidFee);
        }
        let s = env.storage().instance();
        s.set(&DataKey::Admin, &admin);
        s.set(&DataKey::Collateral, &collateral);
        s.set(&DataKey::Treasury, &treasury);
        s.set(&DataKey::Resolver, &resolver);
        s.set(&DataKey::DefaultFeeBps, &default_fee_bps);
        s.set(&DataKey::Paused, &false);
        s.set(&DataKey::NextId, &0u64);
        s.set(&DataKey::DefaultRedeemHorizon, &DEFAULT_REDEEM_HORIZON_SECS);
    }

    // ----- admin ----------------------------------------------------------

    pub fn set_paused(env: Env, paused: bool) -> Result<(), Error> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&DataKey::Paused, &paused);
        Ok(())
    }

    /// Affects markets created after the call; existing markets keep their fee.
    pub fn set_default_fee_bps(env: Env, fee_bps: u32) -> Result<(), Error> {
        Self::require_admin(&env)?;
        if fee_bps > MAX_FEE_BPS {
            return Err(Error::InvalidFee);
        }
        env.storage()
            .instance()
            .set(&DataKey::DefaultFeeBps, &fee_bps);
        Ok(())
    }

    pub fn set_resolver(env: Env, resolver: Address) -> Result<(), Error> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&DataKey::Resolver, &resolver);
        Ok(())
    }

    pub fn set_treasury(env: Env, treasury: Address) -> Result<(), Error> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&DataKey::Treasury, &treasury);
        Ok(())
    }

    /// Affects markets created after the call; existing markets keep the
    /// horizon snapshotted at their creation. Must be within
    /// [180 days, 1825 days].
    pub fn set_default_redeem_horizon(env: Env, secs: u64) -> Result<(), Error> {
        Self::require_admin(&env)?;
        if !(MIN_REDEEM_HORIZON_SECS..=MAX_REDEEM_HORIZON_SECS).contains(&secs) {
            return Err(Error::InvalidAmount);
        }
        env.storage()
            .instance()
            .set(&DataKey::DefaultRedeemHorizon, &secs);
        Ok(())
    }

    // ----- market lifecycle -----------------------------------------------

    /// Creates a market and seeds the pool. `creator` becomes the sole LP.
    /// `initial_yes_bps` in [100, 9900] sets the opening YES probability;
    /// the creator receives the leftover shares of the likelier outcome.
    #[allow(clippy::too_many_arguments)]
    pub fn create_market(
        env: Env,
        creator: Address,
        question_hash: BytesN<32>,
        resolution_hash: BytesN<32>,
        meta_uri: String,
        category: Category,
        close_time: u64,
        seed_amount: i128,
        initial_yes_bps: u32,
    ) -> Result<u64, Error> {
        Self::assert_not_paused(&env)?;
        creator.require_auth();

        if close_time <= env.ledger().timestamp() {
            return Err(Error::InvalidCloseTime);
        }
        if !(MIN_SEED..=MAX_SETS).contains(&seed_amount) {
            return Err(Error::InvalidAmount);
        }
        if !(math::MIN_PROB_BPS..=math::MAX_PROB_BPS).contains(&initial_yes_bps) {
            return Err(Error::InvalidProbability);
        }
        let seed = math::seed_reserves(seed_amount, initial_yes_bps)?;

        let s = env.storage().instance();
        let id: u64 = s.get(&DataKey::NextId).ok_or(Error::NotInitialized)?;
        s.set(&DataKey::NextId, &(id + 1));
        let fee_bps: u32 = s
            .get(&DataKey::DefaultFeeBps)
            .ok_or(Error::NotInitialized)?;
        let horizon_secs: u64 = s
            .get(&DataKey::DefaultRedeemHorizon)
            .ok_or(Error::NotInitialized)?;

        let market = Market {
            creator: creator.clone(),
            question_hash,
            resolution_hash,
            meta_uri,
            category,
            close_time,
            fee_bps,
            status: MarketStatus::Open,
            reserve_yes: seed.reserve_yes,
            reserve_no: seed.reserve_no,
            sets_minted: seed_amount,
            fees_accrued: 0,
            lp_claimed: false,
        };
        Self::save_market(&env, id, &market);
        if seed.creator_yes > 0 || seed.creator_no > 0 {
            Self::save_position(
                &env,
                id,
                &creator,
                &Position {
                    yes: seed.creator_yes,
                    no: seed.creator_no,
                },
                market.close_time,
            );
        }
        // The creator's seed shares count as *user* outstanding, not pool.
        let settle = SettleState {
            outstanding_yes: seed.creator_yes,
            outstanding_no: seed.creator_no,
            finalized_at: 0,
            horizon_secs,
            paid_out: 0,
            closed: false,
        };
        Self::debug_assert_share_invariant(&market, &settle);
        Self::save_settle(&env, id, &settle);

        Self::token(&env)?.transfer(&creator, env.current_contract_address(), &seed_amount);

        MarketCreated {
            market_id: id,
            creator,
            category,
            close_time,
            seed_amount,
            initial_yes_bps,
        }
        .publish(&env);
        Ok(id)
    }

    // ----- trading --------------------------------------------------------

    /// Spend `collateral_in` to buy `outcome` shares. Returns shares received.
    /// Reverts if fewer than `min_shares_out` would be received.
    pub fn buy(
        env: Env,
        trader: Address,
        market_id: u64,
        outcome: Outcome,
        collateral_in: i128,
        min_shares_out: i128,
    ) -> Result<i128, Error> {
        Self::assert_not_paused(&env)?;
        trader.require_auth();
        let mut m = Self::load_market(&env, market_id)?;
        Self::assert_tradable(&env, &m)?;

        let (r_bought, r_other) = Self::reserves_for(&m, outcome);
        let q = math::calc_buy(r_bought, r_other, collateral_in, m.fee_bps)?;
        if q.shares_out < min_shares_out {
            return Err(Error::SlippageExceeded);
        }
        let new_sets = m.sets_minted.checked_add(q.net).ok_or(Error::Overflow)?;
        if new_sets > MAX_SETS {
            return Err(Error::MarketTooLarge);
        }

        // effects
        Self::set_reserves(&mut m, outcome, q.new_reserve_bought, q.new_reserve_other);
        m.sets_minted = new_sets;
        m.fees_accrued = m.fees_accrued.checked_add(q.fee).ok_or(Error::Overflow)?;
        let mut pos = Self::load_position(&env, market_id, &trader, m.close_time);
        match outcome {
            Outcome::Yes => pos.yes += q.shares_out,
            Outcome::No => pos.no += q.shares_out,
        }
        Self::save_position(&env, market_id, &trader, &pos, m.close_time);
        Self::save_market(&env, market_id, &m);
        // Legacy markets (no `Settle` entry) predate this bookkeeping.
        if let Some(mut settle) = Self::load_settle_opt(&env, market_id) {
            match outcome {
                Outcome::Yes => {
                    settle.outstanding_yes = settle
                        .outstanding_yes
                        .checked_add(q.shares_out)
                        .ok_or(Error::Overflow)?
                }
                Outcome::No => {
                    settle.outstanding_no = settle
                        .outstanding_no
                        .checked_add(q.shares_out)
                        .ok_or(Error::Overflow)?
                }
            }
            Self::debug_assert_share_invariant(&m, &settle);
            Self::save_settle(&env, market_id, &settle);
        }

        // interaction
        Self::token(&env)?.transfer(&trader, env.current_contract_address(), &collateral_in);

        Trade {
            market_id,
            trader,
            outcome,
            is_buy: true,
            collateral: collateral_in,
            shares: q.shares_out,
            fee: q.fee,
            reserve_yes: m.reserve_yes,
            reserve_no: m.reserve_no,
        }
        .publish(&env);
        Ok(q.shares_out)
    }

    /// Receive exactly `collateral_out` by selling `outcome` shares. Returns
    /// shares sold. Reverts if more than `max_shares_in` would be needed.
    /// Clients turn "sell N shares" into `collateral_out` off-chain
    /// (see `math::calc_sell` docs) and add a slippage margin to `max_shares_in`.
    pub fn sell(
        env: Env,
        trader: Address,
        market_id: u64,
        outcome: Outcome,
        collateral_out: i128,
        max_shares_in: i128,
    ) -> Result<i128, Error> {
        Self::assert_not_paused(&env)?;
        trader.require_auth();
        let mut m = Self::load_market(&env, market_id)?;
        Self::assert_tradable(&env, &m)?;

        let (r_sold, r_other) = Self::reserves_for(&m, outcome);
        let q = math::calc_sell(r_sold, r_other, collateral_out, m.fee_bps)?;
        if q.shares_in > max_shares_in {
            return Err(Error::SlippageExceeded);
        }

        let mut pos = Self::load_position(&env, market_id, &trader, m.close_time);
        let held = match outcome {
            Outcome::Yes => pos.yes,
            Outcome::No => pos.no,
        };
        if held < q.shares_in {
            return Err(Error::InsufficientShares);
        }

        // effects
        match outcome {
            Outcome::Yes => pos.yes -= q.shares_in,
            Outcome::No => pos.no -= q.shares_in,
        }
        Self::save_position(&env, market_id, &trader, &pos, m.close_time);
        Self::set_reserves(&mut m, outcome, q.new_reserve_sold, q.new_reserve_other);
        m.sets_minted = m.sets_minted.checked_sub(q.gross).ok_or(Error::Overflow)?;
        m.fees_accrued = m.fees_accrued.checked_add(q.fee).ok_or(Error::Overflow)?;
        Self::save_market(&env, market_id, &m);
        if let Some(mut settle) = Self::load_settle_opt(&env, market_id) {
            match outcome {
                Outcome::Yes => {
                    settle.outstanding_yes = settle
                        .outstanding_yes
                        .checked_sub(q.shares_in)
                        .ok_or(Error::Overflow)?
                }
                Outcome::No => {
                    settle.outstanding_no = settle
                        .outstanding_no
                        .checked_sub(q.shares_in)
                        .ok_or(Error::Overflow)?
                }
            }
            Self::debug_assert_share_invariant(&m, &settle);
            Self::save_settle(&env, market_id, &settle);
        }

        // interaction
        Self::token(&env)?.transfer(&env.current_contract_address(), &trader, &collateral_out);

        Trade {
            market_id,
            trader,
            outcome,
            is_buy: false,
            collateral: collateral_out,
            shares: q.shares_in,
            fee: q.fee,
            reserve_yes: m.reserve_yes,
            reserve_no: m.reserve_no,
        }
        .publish(&env);
        Ok(q.shares_in)
    }

    // ----- resolution -----------------------------------------------------
    // Only the configured resolver contract may call these. When the resolver
    // contract is the direct caller, `require_auth` on its address passes.

    pub fn resolve(env: Env, market_id: u64, outcome: Outcome) -> Result<(), Error> {
        Self::require_resolver(&env)?;
        let mut m = Self::load_market(&env, market_id)?;
        if m.status != MarketStatus::Open {
            return Err(Error::MarketNotOpen);
        }
        if env.ledger().timestamp() < m.close_time {
            return Err(Error::NotClosedYet);
        }
        m.status = MarketStatus::Resolved(outcome);
        Self::save_market(&env, market_id, &m);
        Self::mark_finalized(&env, market_id);
        MarketResolved {
            market_id,
            outcome: Some(outcome),
        }
        .publish(&env);
        Ok(())
    }

    /// Invalid or unresolvable market. Allowed any time before finality.
    pub fn void_market(env: Env, market_id: u64) -> Result<(), Error> {
        Self::require_resolver(&env)?;
        let mut m = Self::load_market(&env, market_id)?;
        if m.status != MarketStatus::Open {
            return Err(Error::MarketNotOpen);
        }
        m.status = MarketStatus::Void;
        Self::save_market(&env, market_id, &m);
        Self::mark_finalized(&env, market_id);
        MarketResolved {
            market_id,
            outcome: None,
        }
        .publish(&env);
        Ok(())
    }

    // ----- settlement -----------------------------------------------------

    /// Pays out `holder`'s position for a final market and clears it.
    /// Losing positions clear with a payout of 0.
    pub fn redeem(env: Env, holder: Address, market_id: u64) -> Result<i128, Error> {
        holder.require_auth();
        let m = Self::load_market(&env, market_id)?;
        let kind = Self::settlement(&m)?;
        if let Some(settle) = Self::load_settle_opt(&env, market_id) {
            if settle.closed {
                return Err(Error::RedemptionClosed);
            }
        }
        let pos = Self::load_position(&env, market_id, &holder, m.close_time);
        if pos.yes == 0 && pos.no == 0 {
            return Err(Error::NothingToRedeem);
        }
        let payout = math::settle_value(kind, pos.yes, pos.no);

        Self::save_position(
            &env,
            market_id,
            &holder,
            &Position { yes: 0, no: 0 },
            m.close_time,
        );
        // Both sides decrement even when only one pays: the shares are no
        // longer outstanding, so a losing-side redemption still clears here.
        if let Some(mut settle) = Self::load_settle_opt(&env, market_id) {
            settle.outstanding_yes = settle
                .outstanding_yes
                .checked_sub(pos.yes)
                .ok_or(Error::Overflow)?;
            settle.outstanding_no = settle
                .outstanding_no
                .checked_sub(pos.no)
                .ok_or(Error::Overflow)?;
            settle.paid_out = settle.paid_out.checked_add(payout).ok_or(Error::Overflow)?;
            Self::save_settle(&env, market_id, &settle);
        }
        if payout > 0 {
            Self::token(&env)?.transfer(&env.current_contract_address(), &holder, &payout);
        }
        Redeemed {
            market_id,
            holder,
            payout,
        }
        .publish(&env);
        Ok(payout)
    }

    /// Creator (the LP) withdraws whatever the pool still holds once final.
    pub fn claim_pool_remainder(env: Env, market_id: u64) -> Result<i128, Error> {
        let mut m = Self::load_market(&env, market_id)?;
        m.creator.require_auth();
        let kind = Self::settlement(&m)?;
        if let Some(settle) = Self::load_settle_opt(&env, market_id) {
            if settle.closed {
                return Err(Error::RedemptionClosed);
            }
        }
        if m.lp_claimed {
            return Err(Error::AlreadyClaimed);
        }
        let payout = math::settle_value(kind, m.reserve_yes, m.reserve_no);
        m.reserve_yes = 0;
        m.reserve_no = 0;
        m.lp_claimed = true;
        let creator = m.creator.clone();
        Self::save_market(&env, market_id, &m);
        if let Some(mut settle) = Self::load_settle_opt(&env, market_id) {
            settle.paid_out = settle.paid_out.checked_add(payout).ok_or(Error::Overflow)?;
            Self::save_settle(&env, market_id, &settle);
        }
        if payout > 0 {
            Self::token(&env)?.transfer(&env.current_contract_address(), &creator, &payout);
        }
        Ok(payout)
    }

    /// Permissionless close-out of a final market after its redemption
    /// deadline. Sweeps the market's entire remaining balance — value
    /// reserved for shares never redeemed, an unclaimed LP remainder,
    /// per-holder rounding dust and accrued fees — to the treasury, and
    /// marks the market closed so nothing can ever pay out again.
    ///
    /// The deadline is `redeem_deadline(market_id)` = `finalized_at +
    /// horizon_secs`, the horizon being snapshotted at creation from the
    /// admin default. Anyone who redeems before the deadline is paid the
    /// exact `settle_value` they would have received without this call;
    /// only shares still unredeemed at the deadline are forfeit, and their
    /// value goes to the treasury rather than the LP so the LP cannot
    /// profit from suppressing redemptions.
    ///
    /// Returns the amount swept. The swept total is exactly the market's
    /// contract balance: sets plus fees minus everything already paid out.
    pub fn finalize_market(env: Env, market_id: u64) -> Result<i128, Error> {
        let mut m = Self::load_market(&env, market_id)?;
        let kind = Self::settlement(&m)?;
        let mut settle = Self::load_settle(&env, market_id)?;
        if settle.closed {
            return Err(Error::RedemptionClosed);
        }
        if env.ledger().timestamp() < settle.finalized_at.saturating_add(settle.horizon_secs) {
            return Err(Error::RedemptionWindowOpen);
        }
        // Upper bound on what the outstanding shares can still claim. For
        // Yes/No this is exact; for Void, `floor((oy + on) / 2)` is at least
        // the sum of per-holder floors (`settle_value` floors each pair), so
        // reserving the aggregate floor never under-reserves.
        let unclaimed_user =
            math::settle_upper(kind, settle.outstanding_yes, settle.outstanding_no);
        let lp_claim = if m.lp_claimed {
            0
        } else {
            math::settle_value(kind, m.reserve_yes, m.reserve_no)
        };
        // Sets are collateralized 1:1 and `paid_out` tracks what already
        // left the market, so remaining claims minus those two figures is
        // non-negative: it is exactly the per-holder void rounding dust
        // (zero for Yes/No markets). checked_sub makes that an assertion.
        let dust = m
            .sets_minted
            .checked_sub(settle.paid_out)
            .and_then(|v| v.checked_sub(unclaimed_user))
            .and_then(|v| v.checked_sub(lp_claim))
            .ok_or(Error::Overflow)?;
        let swept = dust
            .checked_add(unclaimed_user)
            .and_then(|v| v.checked_add(lp_claim))
            .and_then(|v| v.checked_add(m.fees_accrued))
            .ok_or(Error::Overflow)?;

        m.reserve_yes = 0;
        m.reserve_no = 0;
        m.lp_claimed = true;
        m.fees_accrued = 0;
        settle.outstanding_yes = 0;
        settle.outstanding_no = 0;
        settle.closed = true;
        Self::save_market(&env, market_id, &m);
        Self::save_settle(&env, market_id, &settle);
        let treasury: Address = Self::instance_get(&env, &DataKey::Treasury)?;
        Self::token(&env)?.transfer(&env.current_contract_address(), &treasury, &swept);
        MarketFinalized {
            market_id,
            swept,
            unclaimed_user,
            dust,
        }
        .publish(&env);
        Ok(swept)
    }

    /// Anyone can move accrued fees to the treasury.
    pub fn sweep_fees(env: Env, market_id: u64) -> Result<i128, Error> {
        let mut m = Self::load_market(&env, market_id)?;
        let amount = m.fees_accrued;
        if amount <= 0 {
            return Ok(0);
        }
        m.fees_accrued = 0;
        Self::save_market(&env, market_id, &m);
        let treasury: Address = Self::instance_get(&env, &DataKey::Treasury)?;
        Self::token(&env)?.transfer(&env.current_contract_address(), &treasury, &amount);
        FeesSwept { market_id, amount }.publish(&env);
        Ok(amount)
    }

    // ----- views ----------------------------------------------------------

    pub fn get_config(env: Env) -> Result<Config, Error> {
        Ok(Config {
            admin: Self::instance_get(&env, &DataKey::Admin)?,
            collateral: Self::instance_get(&env, &DataKey::Collateral)?,
            treasury: Self::instance_get(&env, &DataKey::Treasury)?,
            resolver: Self::instance_get(&env, &DataKey::Resolver)?,
            default_fee_bps: Self::instance_get(&env, &DataKey::DefaultFeeBps)?,
            paused: Self::instance_get(&env, &DataKey::Paused)?,
        })
    }

    pub fn market_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::NextId).unwrap_or(0)
    }

    pub fn get_market(env: Env, market_id: u64) -> Result<Market, Error> {
        Self::load_market(&env, market_id)
    }

    pub fn get_position(env: Env, market_id: u64, holder: Address) -> Position {
        // The TTL of the position entry tracks the market's close time. With
        // no market to anchor to (a stale id), fall back to the settlement
        // horizon from now so the entry at least keeps that much cover.
        let close_time = match Self::load_market(&env, market_id) {
            Ok(m) => m.close_time,
            Err(_) => env.ledger().timestamp(),
        };
        Self::load_position(&env, market_id, &holder, close_time)
    }

    /// Outstanding-share accounting for a market (issue #14).
    /// `NotSupported` for markets created before this bookkeeping existed.
    pub fn settle_state(env: Env, market_id: u64) -> Result<SettleState, Error> {
        Self::load_market(&env, market_id)?;
        Self::load_settle(&env, market_id)
    }

    /// Timestamp after which unredeemed shares are forfeit (see
    /// `finalize_market`). `None` while the market is still Open — its
    /// deadline is not known yet — and for legacy markets, which have no
    /// deadline and cannot be finalized.
    pub fn redeem_deadline(env: Env, market_id: u64) -> Option<u64> {
        match Self::load_settle_opt(&env, market_id) {
            Some(s) if s.finalized_at > 0 => Some(s.finalized_at.saturating_add(s.horizon_secs)),
            _ => None,
        }
    }

    /// Spot price of `outcome` in bps (0..=10_000). YES + NO ~ 10_000.
    pub fn get_price(env: Env, market_id: u64, outcome: Outcome) -> Result<u32, Error> {
        let m = Self::load_market(&env, market_id)?;
        let yes = math::price_yes_bps(m.reserve_yes, m.reserve_no)?;
        let p = match outcome {
            Outcome::Yes => yes,
            Outcome::No => BPS - yes,
        };
        Ok(p as u32)
    }

    /// Shares a `buy` of `collateral_in` would return right now.
    pub fn quote_buy(
        env: Env,
        market_id: u64,
        outcome: Outcome,
        collateral_in: i128,
    ) -> Result<i128, Error> {
        let m = Self::load_market(&env, market_id)?;
        let (r_bought, r_other) = Self::reserves_for(&m, outcome);
        Ok(math::calc_buy(r_bought, r_other, collateral_in, m.fee_bps)?.shares_out)
    }

    /// Shares a `sell` for exactly `collateral_out` would consume right now.
    pub fn quote_sell(
        env: Env,
        market_id: u64,
        outcome: Outcome,
        collateral_out: i128,
    ) -> Result<i128, Error> {
        let m = Self::load_market(&env, market_id)?;
        let (r_sold, r_other) = Self::reserves_for(&m, outcome);
        Ok(math::calc_sell(r_sold, r_other, collateral_out, m.fee_bps)?.shares_in)
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

impl MarketCore {
    fn instance_get<V: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(
        env: &Env,
        key: &DataKey,
    ) -> Result<V, Error> {
        ttl::bump_instance(env);
        env.storage()
            .instance()
            .get(key)
            .ok_or(Error::NotInitialized)
    }

    fn token(env: &Env) -> Result<token::TokenClient<'_>, Error> {
        let addr: Address = Self::instance_get(env, &DataKey::Collateral)?;
        Ok(token::TokenClient::new(env, &addr))
    }

    fn require_admin(env: &Env) -> Result<(), Error> {
        let admin: Address = Self::instance_get(env, &DataKey::Admin)?;
        admin.require_auth();
        Ok(())
    }

    fn require_resolver(env: &Env) -> Result<(), Error> {
        let resolver: Address = Self::instance_get(env, &DataKey::Resolver)?;
        resolver.require_auth();
        Ok(())
    }

    fn assert_not_paused(env: &Env) -> Result<(), Error> {
        let paused: bool = Self::instance_get(env, &DataKey::Paused)?;
        if paused {
            return Err(Error::Paused);
        }
        Ok(())
    }

    fn assert_tradable(env: &Env, m: &Market) -> Result<(), Error> {
        if m.status != MarketStatus::Open {
            return Err(Error::MarketNotOpen);
        }
        if env.ledger().timestamp() >= m.close_time {
            return Err(Error::MarketClosed);
        }
        Ok(())
    }

    fn settlement(m: &Market) -> Result<Settlement, Error> {
        match m.status {
            MarketStatus::Open => Err(Error::NotFinal),
            MarketStatus::Resolved(Outcome::Yes) => Ok(Settlement::Yes),
            MarketStatus::Resolved(Outcome::No) => Ok(Settlement::No),
            MarketStatus::Void => Ok(Settlement::Void),
        }
    }

    /// (reserve of `outcome`, reserve of the other outcome)
    fn reserves_for(m: &Market, outcome: Outcome) -> (i128, i128) {
        match outcome {
            Outcome::Yes => (m.reserve_yes, m.reserve_no),
            Outcome::No => (m.reserve_no, m.reserve_yes),
        }
    }

    fn set_reserves(m: &mut Market, outcome: Outcome, r_outcome: i128, r_other: i128) {
        match outcome {
            Outcome::Yes => {
                m.reserve_yes = r_outcome;
                m.reserve_no = r_other;
            }
            Outcome::No => {
                m.reserve_no = r_outcome;
                m.reserve_yes = r_other;
            }
        }
    }

    fn load_market(env: &Env, id: u64) -> Result<Market, Error> {
        let key = DataKey::Market(id);
        let m: Market = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::MarketNotFound)?;
        ttl::bump_persistent(env, &key, ttl::market_target(env, m.close_time));
        Ok(m)
    }

    fn save_market(env: &Env, id: u64, m: &Market) {
        let key = DataKey::Market(id);
        env.storage().persistent().set(&key, m);
        ttl::bump_persistent(env, &key, ttl::market_target(env, m.close_time));
    }

    fn load_position(env: &Env, id: u64, holder: &Address, close_time: u64) -> Position {
        let key = DataKey::Position(id, holder.clone());
        match env.storage().persistent().get::<_, Position>(&key) {
            Some(p) => {
                ttl::bump_persistent(env, &key, ttl::market_target(env, close_time));
                p
            }
            None => Position { yes: 0, no: 0 },
        }
    }

    /// Empty positions are removed so storage does not grow with dust entries.
    fn save_position(env: &Env, id: u64, holder: &Address, p: &Position, close_time: u64) {
        let key = DataKey::Position(id, holder.clone());
        if p.yes == 0 && p.no == 0 {
            env.storage().persistent().remove(&key);
        } else {
            env.storage().persistent().set(&key, p);
            ttl::bump_persistent(env, &key, ttl::market_target(env, close_time));
        }
    }

    /// Records the finality timestamp on `resolve` / `void_market` (both
    /// already require status == Open, so it is never overwritten). No-op
    /// for legacy markets without a `Settle` entry.
    fn mark_finalized(env: &Env, id: u64) {
        if let Some(mut settle) = Self::load_settle_opt(env, id) {
            settle.finalized_at = env.ledger().timestamp();
            Self::save_settle(env, id, &settle);
        }
    }

    /// `None` for legacy markets created before `SettleState` existed; their
    /// outstanding shares cannot be reconstructed on-chain, so they have no
    /// deadline and `finalize_market` refuses them (`NotSupported`) while
    /// `redeem` / `claim_pool_remainder` keep working as before.
    fn load_settle_opt(env: &Env, id: u64) -> Option<SettleState> {
        let key = DataKey::Settle(id);
        let settle = env.storage().persistent().get::<_, SettleState>(&key)?;
        // The deadline can be up to 5 years out, past `max_ttl()`; the entry
        // is kept as long as the network allows and then needs a restore or
        // the keeper (docs/wave-issues/14) until the market is finalized.
        ttl::bump_persistent(env, &key, ttl::long_lived_target(env));
        Some(settle)
    }

    fn load_settle(env: &Env, id: u64) -> Result<SettleState, Error> {
        Self::load_settle_opt(env, id).ok_or(Error::NotSupported)
    }

    fn save_settle(env: &Env, id: u64, settle: &SettleState) {
        let key = DataKey::Settle(id);
        env.storage().persistent().set(&key, settle);
        ttl::bump_persistent(env, &key, ttl::long_lived_target(env));
    }

    /// Debug-build check of the share-count invariant
    /// `reserve_<side> + outstanding_<side> == sets_minted`.
    ///
    /// Only valid while no collateral has left the market (`paid_out == 0`
    /// and the LP unclaimed), which is exactly every Open market plus a
    /// final one nobody redeemed from yet: redeeming a losing-side position
    /// (payout 0) burns outstanding shares without a matching payout, so
    /// after the first payout collateral conservation is tracked by
    /// `paid_out` instead and enforced by `finalize_market`'s checked
    /// residual. Exercised on create / buy / sell and in the tests.
    fn debug_assert_share_invariant(m: &Market, settle: &SettleState) {
        if settle.paid_out == 0 && !m.lp_claimed {
            debug_assert_eq!(m.reserve_yes + settle.outstanding_yes, m.sets_minted);
            debug_assert_eq!(m.reserve_no + settle.outstanding_no, m.sets_minted);
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{storage::Persistent as _, Address as _, Ledger, MockAuth, MockAuthInvoke},
        token::StellarAssetClient,
        IntoVal,
    };

    fn setup_market() -> (
        Env,
        MarketCoreClient<'static>,
        Address,
        Address,
        Address,
        Address,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        let resolver = Address::generate(&env);
        let creator = Address::generate(&env);
        let trader = Address::generate(&env);

        let collateral = env.register_stellar_asset_contract_v2(admin.clone());
        let collateral_client = StellarAssetClient::new(&env, &collateral.address());
        collateral_client.mint(&creator, &10_000_000_000_i128);
        collateral_client.mint(&trader, &10_000_000_000_i128);

        let contract_id = env.register(
            MarketCore,
            MarketCoreArgs::__constructor(
                &admin,
                &collateral.address(),
                &treasury,
                &resolver,
                &100u32,
            ),
        );
        let client = MarketCoreClient::new(&env, &contract_id);

        (env, client, creator, trader, resolver, collateral.address())
    }

    #[test]
    fn create_market_sets_initial_price() {
        let (env, client, creator, _, _, _) = setup_market();
        let question_hash = BytesN::from_array(&env, &[1u8; 32]);
        let resolution_hash = BytesN::from_array(&env, &[101u8; 32]);
        let meta_uri = String::from_str(&env, "ipfs://market-1");

        let market_id = client.create_market(
            &creator,
            &question_hash,
            &resolution_hash,
            &meta_uri,
            &Category::Crypto,
            &(env.ledger().timestamp() + 60_000),
            &(100 * 10_000_000_i128),
            &6800u32,
        );

        assert_eq!(market_id, 0);
        assert_eq!(client.market_count(), 1);

        let market = client.get_market(&market_id);
        assert_eq!(market.category, Category::Crypto);
        assert_eq!(market.status, MarketStatus::Open);
        assert!(client.get_price(&market_id, &Outcome::Yes) > 6000);
    }

    #[test]
    fn buy_moves_price_and_redeem_after_resolution() {
        let (env, client, creator, trader, _, _) = setup_market();
        let question_hash = BytesN::from_array(&env, &[2u8; 32]);
        let resolution_hash = BytesN::from_array(&env, &[102u8; 32]);
        let meta_uri = String::from_str(&env, "ipfs://market-2");
        let market_id = client.create_market(
            &creator,
            &question_hash,
            &resolution_hash,
            &meta_uri,
            &Category::Macro,
            &(env.ledger().timestamp() + 60_000),
            &(100 * 10_000_000_i128),
            &5000u32,
        );

        let price_before = client.get_price(&market_id, &Outcome::Yes);
        let shares_out = client.buy(
            &trader,
            &market_id,
            &Outcome::Yes,
            &(10 * 10_000_000_i128),
            &0_i128,
        );
        assert!(shares_out > 0);
        let price_after = client.get_price(&market_id, &Outcome::Yes);
        assert!(price_after > price_before);

        let close_time = client.get_market(&market_id).close_time;
        env.ledger().set_timestamp(close_time + 1);
        client.resolve(&market_id, &Outcome::Yes);

        let payout = client.redeem(&trader, &market_id);
        assert!(payout > 0);
        assert_eq!(client.get_position(&market_id, &trader).yes, 0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn rejects_close_time_in_the_past() {
        let (env, client, creator, _, _, _) = setup_market();
        client.create_market(
            &creator,
            &BytesN::from_array(&env, &[3u8; 32]),
            &BytesN::from_array(&env, &[103u8; 32]),
            &String::from_str(&env, "ipfs://invalid-close"),
            &Category::Other,
            &env.ledger().timestamp(),
            &(100 * 10_000_000_i128),
            &5000u32,
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn rejects_probability_outside_bounds() {
        let (env, client, creator, _, _, _) = setup_market();
        client.create_market(
            &creator,
            &BytesN::from_array(&env, &[4u8; 32]),
            &BytesN::from_array(&env, &[104u8; 32]),
            &String::from_str(&env, "ipfs://invalid-probability"),
            &Category::Other,
            &(env.ledger().timestamp() + 60_000),
            &(100 * 10_000_000_i128),
            &9901u32,
        );
    }

    #[test]
    fn sell_returns_collateral_and_reduces_position() {
        let (env, client, creator, trader, _, collateral) = setup_market();
        let market_id = client.create_market(
            &creator,
            &BytesN::from_array(&env, &[5u8; 32]),
            &BytesN::from_array(&env, &[105u8; 32]),
            &String::from_str(&env, "ipfs://sell"),
            &Category::Crypto,
            &(env.ledger().timestamp() + 60_000),
            &(100 * 10_000_000_i128),
            &5000u32,
        );

        let token = soroban_sdk::token::TokenClient::new(&env, &collateral);
        let balance_before = token.balance(&trader);
        client.buy(
            &trader,
            &market_id,
            &Outcome::Yes,
            &(10 * 10_000_000_i128),
            &0_i128,
        );
        let position_before = client.get_position(&market_id, &trader);

        let shares_sold = client.sell(
            &trader,
            &market_id,
            &Outcome::Yes,
            &(10_000_000_i128),
            &client.quote_sell(&market_id, &Outcome::Yes, &(10_000_000_i128)),
        );

        let position_after = client.get_position(&market_id, &trader);
        assert!(shares_sold > 0);
        assert_eq!(position_before.yes - position_after.yes, shares_sold);
        assert!(token.balance(&trader) > balance_before - 10 * 10_000_000_i128);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #12)")]
    fn sell_rejects_excessive_share_slippage() {
        let (env, client, creator, trader, _, _) = setup_market();
        let market_id = client.create_market(
            &creator,
            &BytesN::from_array(&env, &[6u8; 32]),
            &BytesN::from_array(&env, &[106u8; 32]),
            &String::from_str(&env, "ipfs://sell-slippage"),
            &Category::Crypto,
            &(env.ledger().timestamp() + 60_000),
            &(100 * 10_000_000_i128),
            &5000u32,
        );
        client.buy(
            &trader,
            &market_id,
            &Outcome::Yes,
            &(10 * 10_000_000_i128),
            &0_i128,
        );

        let required = client.quote_sell(&market_id, &Outcome::Yes, &(10_000_000_i128));
        client.sell(
            &trader,
            &market_id,
            &Outcome::Yes,
            &(10_000_000_i128),
            &(required - 1),
        );
    }

    #[test]
    fn void_market_allows_creator_to_claim_pool_remainder() {
        let (env, client, creator, _, _, collateral) = setup_market();
        let market_id = client.create_market(
            &creator,
            &BytesN::from_array(&env, &[7u8; 32]),
            &BytesN::from_array(&env, &[107u8; 32]),
            &String::from_str(&env, "ipfs://void"),
            &Category::Geopolitics,
            &(env.ledger().timestamp() + 60_000),
            &(100 * 10_000_000_i128),
            &5000u32,
        );

        client.void_market(&market_id);
        assert_eq!(client.get_market(&market_id).status, MarketStatus::Void);

        let token = soroban_sdk::token::TokenClient::new(&env, &collateral);
        let before = token.balance(&creator);
        let payout = client.claim_pool_remainder(&market_id);
        assert!(payout > 0);
        assert_eq!(token.balance(&creator), before + payout);
        assert!(client.get_market(&market_id).lp_claimed);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #17)")]
    fn creator_cannot_claim_pool_remainder_twice() {
        let (env, client, creator, _, _, _) = setup_market();
        let market_id = client.create_market(
            &creator,
            &BytesN::from_array(&env, &[8u8; 32]),
            &BytesN::from_array(&env, &[108u8; 32]),
            &String::from_str(&env, "ipfs://claim-once"),
            &Category::Other,
            &(env.ledger().timestamp() + 60_000),
            &(100 * 10_000_000_i128),
            &5000u32,
        );
        client.void_market(&market_id);
        client.claim_pool_remainder(&market_id);
        client.claim_pool_remainder(&market_id);
    }

    #[test]
    fn sweep_fees_transfers_accrued_fees_to_treasury() {
        let (env, client, creator, trader, _, collateral) = setup_market();
        let market_id = client.create_market(
            &creator,
            &BytesN::from_array(&env, &[9u8; 32]),
            &BytesN::from_array(&env, &[109u8; 32]),
            &String::from_str(&env, "ipfs://fees"),
            &Category::Macro,
            &(env.ledger().timestamp() + 60_000),
            &(100 * 10_000_000_i128),
            &5000u32,
        );
        client.buy(
            &trader,
            &market_id,
            &Outcome::Yes,
            &(10 * 10_000_000_i128),
            &0_i128,
        );

        let accrued = client.get_market(&market_id).fees_accrued;
        assert!(accrued > 0);

        let treasury = client.get_config().treasury;
        let token = soroban_sdk::token::TokenClient::new(&env, &collateral);
        let treasury_before = token.balance(&treasury);
        assert_eq!(client.sweep_fees(&market_id), accrued);
        assert_eq!(token.balance(&treasury), treasury_before + accrued);
        assert_eq!(client.get_market(&market_id).fees_accrued, 0);
        assert_eq!(client.sweep_fees(&market_id), 0);
    }

    #[test]
    fn create_market_commits_to_resolution_hash() {
        let (env, client, creator, _, _, _) = setup_market();
        let resolution_hash = BytesN::from_array(&env, &[200u8; 32]);
        let market_id = client.create_market(
            &creator,
            &BytesN::from_array(&env, &[10u8; 32]),
            &resolution_hash,
            &String::from_str(&env, "ipfs://commitment"),
            &Category::Crypto,
            &(env.ledger().timestamp() + 60_000),
            &(100 * 10_000_000_i128),
            &5000u32,
        );
        assert_eq!(
            client.get_market(&market_id).resolution_hash,
            resolution_hash
        );
    }

    #[test]
    fn wrong_caller_cannot_use_admin_functions() {
        let (env, client, _, trader, _, _) = setup_market();
        env.set_auths(&[]);
        assert!(client
            .mock_auths(&[MockAuth {
                address: &trader,
                invoke: &MockAuthInvoke {
                    contract: &client.address,
                    fn_name: "set_paused",
                    args: (true,).into_val(&env),
                    sub_invokes: &[],
                },
            }])
            .try_set_paused(&true)
            .is_err());
        assert!(client
            .mock_auths(&[MockAuth {
                address: &trader,
                invoke: &MockAuthInvoke {
                    contract: &client.address,
                    fn_name: "set_default_fee_bps",
                    args: (200u32,).into_val(&env),
                    sub_invokes: &[],
                },
            }])
            .try_set_default_fee_bps(&200u32)
            .is_err());
    }

    #[test]
    fn wrong_caller_cannot_resolve_market() {
        let (env, client, creator, _, _, _) = setup_market();
        let not_resolver = Address::generate(&env);
        let market_id = client.create_market(
            &creator,
            &BytesN::from_array(&env, &[11u8; 32]),
            &BytesN::from_array(&env, &[111u8; 32]),
            &String::from_str(&env, "ipfs://wrong-resolver"),
            &Category::Other,
            &(env.ledger().timestamp() + 60_000),
            &(100 * 10_000_000_i128),
            &5000u32,
        );
        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 60_001);
        env.set_auths(&[]);
        assert!(client
            .mock_auths(&[MockAuth {
                address: &not_resolver,
                invoke: &MockAuthInvoke {
                    contract: &client.address,
                    fn_name: "resolve",
                    args: (market_id, Outcome::Yes).into_val(&env),
                    sub_invokes: &[],
                },
            }])
            .try_resolve(&market_id, &Outcome::Yes)
            .is_err());
    }

    // ----- TTL policy ------------------------------------------------------

    /// Advances both clocks together, as they move on a real network
    /// (one ledger per `ttl::LEDGER_SECS`).
    fn advance_ledgers(env: &Env, secs: u64) {
        assert_eq!(secs % ttl::LEDGER_SECS, 0);
        env.ledger()
            .set_sequence_number(env.ledger().sequence() + (secs / ttl::LEDGER_SECS) as u32);
        env.ledger().set_timestamp(env.ledger().timestamp() + secs);
    }

    fn persistent_ttl(env: &Env, contract: &Address, key: &DataKey) -> u32 {
        env.as_contract(contract, || env.storage().persistent().get_ttl(key))
    }

    fn create_market_closing_in(
        env: &Env,
        client: &MarketCoreClient,
        creator: &Address,
        secs_from_now: u64,
    ) -> u64 {
        client.create_market(
            creator,
            &BytesN::from_array(env, &[21u8; 32]),
            &BytesN::from_array(env, &[121u8; 32]),
            &String::from_str(env, "ipfs://ttl-policy"),
            &Category::Other,
            &(env.ledger().timestamp() + secs_from_now),
            &(100 * 10_000_000_i128),
            &5000u32,
        )
    }

    #[test]
    fn market_entry_survives_until_close_plus_horizon() {
        let (env, client, creator, _, _, _) = setup_market();
        // Current network limits: persistent entries may live at most 180
        // days; the minimum is deliberately left low so the measured TTL is
        // the contract's own bump, not the network floor.
        env.ledger().set_max_entry_ttl(3_110_400);
        env.ledger().set_min_persistent_entry_ttl(4_096);

        let market_id = create_market_closing_in(&env, &client, &creator, 90 * ttl::DAY_SECS);
        let key = DataKey::Market(market_id);
        // 90 days to close + the 90-day settlement horizon, at the 180-day cap.
        assert!(persistent_ttl(&env, &client.address, &key) >= 3_110_399);

        // The old fixed 60-day bump let the entry die at day 60, twenty days
        // before this market could even close. Lay idle past that, then past
        // close, and resolution must still work.
        advance_ledgers(&env, 80 * ttl::DAY_SECS);
        assert!(persistent_ttl(&env, &client.address, &key) > 0);
        advance_ledgers(&env, 11 * ttl::DAY_SECS);

        client.resolve(&market_id, &Outcome::Yes);
        assert_eq!(
            client.get_market(&market_id).status,
            MarketStatus::Resolved(Outcome::Yes)
        );
    }

    #[test]
    fn position_ttl_tracks_close_time() {
        let (env, client, creator, trader, _, _) = setup_market();
        env.ledger().set_max_entry_ttl(3_110_400);
        env.ledger().set_min_persistent_entry_ttl(4_096);

        let short = create_market_closing_in(&env, &client, &creator, 10 * ttl::DAY_SECS);
        let long = create_market_closing_in(&env, &client, &creator, 100 * ttl::DAY_SECS);
        client.buy(
            &trader,
            &short,
            &Outcome::Yes,
            &(10 * 10_000_000_i128),
            &0_i128,
        );
        client.buy(
            &trader,
            &long,
            &Outcome::Yes,
            &(10 * 10_000_000_i128),
            &0_i128,
        );

        let short_ttl = persistent_ttl(
            &env,
            &client.address,
            &DataKey::Position(short, trader.clone()),
        );
        let long_ttl = persistent_ttl(
            &env,
            &client.address,
            &DataKey::Position(long, trader.clone()),
        );

        // 10 days to close + 90-day horizon = 100 days.
        assert_eq!(short_ttl, 100 * ttl::DAY_IN_LEDGERS);
        // 100 days to close exceeds the 180-day cap only together with the
        // horizon, so the long market is clamped at the maximum.
        assert!(long_ttl >= 3_110_399);
        assert!(long_ttl > short_ttl);
    }

    // ----- Outstanding shares + redemption deadline (#14) ------------------

    fn create_market_with(
        env: &Env,
        client: &MarketCoreClient,
        creator: &Address,
        yes_bps: u32,
        close_in_secs: u64,
    ) -> u64 {
        client.create_market(
            creator,
            &BytesN::from_array(env, &[41u8; 32]),
            &BytesN::from_array(env, &[141u8; 32]),
            &String::from_str(env, "ipfs://settle"),
            &Category::Macro,
            &(env.ledger().timestamp() + close_in_secs),
            &(100 * 10_000_000_i128),
            &yes_bps,
        )
    }

    /// `reserve_<side> + outstanding_<side> == sets_minted`, checked through
    /// the public views. Only meaningful while no payout has left the market
    /// (before any redeem/claim); afterwards collateral conservation is
    /// tracked by `paid_out` and enforced by `finalize_market`'s checked
    /// residual — see the settle tests below.
    fn assert_share_invariant(client: &MarketCoreClient, market_id: u64) {
        let m = client.get_market(&market_id);
        let s = client.settle_state(&market_id);
        assert_eq!(s.paid_out, 0, "payouts must be zero for this assertion");
        assert_eq!(m.reserve_yes + s.outstanding_yes, m.sets_minted);
        assert_eq!(m.reserve_no + s.outstanding_no, m.sets_minted);
    }

    #[test]
    fn invariant_reserve_plus_outstanding_equals_sets() {
        let (env, client, creator, trader, _, _) = setup_market();
        let market_id = create_market_with(&env, &client, &creator, 6800, 60_000);
        assert_share_invariant(&client, market_id);

        client.buy(
            &trader,
            &market_id,
            &Outcome::Yes,
            &(10 * 10_000_000_i128),
            &0_i128,
        );
        assert_share_invariant(&client, market_id);
        client.buy(
            &trader,
            &market_id,
            &Outcome::No,
            &(7 * 10_000_000_i128),
            &0_i128,
        );
        assert_share_invariant(&client, market_id);

        client.sell(
            &trader,
            &market_id,
            &Outcome::Yes,
            &(3 * 10_000_000_i128),
            &i128::MAX,
        );
        assert_share_invariant(&client, market_id);
        client.sell(
            &trader,
            &market_id,
            &Outcome::No,
            &(2 * 10_000_000_i128),
            &i128::MAX,
        );
        assert_share_invariant(&client, market_id);

        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 60_001);
        client.resolve(&market_id, &Outcome::Yes);
        assert_share_invariant(&client, market_id);
    }

    #[test]
    fn outstanding_tracks_buy_sell_redeem() {
        let (env, client, creator, trader, _, _) = setup_market();
        let market_id = create_market_with(&env, &client, &creator, 6800, 60_000);

        let s0 = client.settle_state(&market_id);
        let m0 = client.get_market(&market_id);
        assert_eq!(s0.finalized_at, 0);
        assert_eq!(s0.horizon_secs, DEFAULT_REDEEM_HORIZON_SECS);
        assert_eq!(s0.paid_out, 0);
        assert!(!s0.closed);
        assert_eq!(client.redeem_deadline(&market_id), None);
        // The creator's seed shares count as user outstanding, not pool.
        assert_eq!(s0.outstanding_yes, m0.sets_minted - m0.reserve_yes);
        assert_eq!(s0.outstanding_no, 0);

        let bought = client.buy(
            &trader,
            &market_id,
            &Outcome::Yes,
            &(10 * 10_000_000_i128),
            &0_i128,
        );
        let s1 = client.settle_state(&market_id);
        assert_eq!(s1.outstanding_yes, s0.outstanding_yes + bought);

        let sold = client.sell(
            &trader,
            &market_id,
            &Outcome::Yes,
            &(5 * 10_000_000_i128),
            &i128::MAX,
        );
        let s2 = client.settle_state(&market_id);
        assert_eq!(s2.outstanding_yes, s1.outstanding_yes - sold);

        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 60_001);
        client.resolve(&market_id, &Outcome::Yes);
        let resolved_at = env.ledger().timestamp();
        assert_eq!(
            client.redeem_deadline(&market_id),
            Some(resolved_at + DEFAULT_REDEEM_HORIZON_SECS)
        );

        let trader_pos = client.get_position(&market_id, &trader);
        let creator_pos = client.get_position(&market_id, &creator);
        let trader_payout = client.redeem(&trader, &market_id);
        assert_eq!(trader_payout, trader_pos.yes);
        let s3 = client.settle_state(&market_id);
        assert_eq!(s3.outstanding_yes, s2.outstanding_yes - trader_pos.yes);
        assert_eq!(s3.paid_out, trader_payout);
        assert_eq!(s3.finalized_at, resolved_at);

        let creator_payout = client.redeem(&creator, &market_id);
        assert_eq!(creator_payout, creator_pos.yes);
        let s4 = client.settle_state(&market_id);
        assert_eq!(s4.outstanding_yes, 0);
        assert_eq!(s4.paid_out, trader_payout + creator_payout);

        // The LP remainder still sits in the pool until claimed.
        let before_claim = client.get_market(&market_id);
        let lp_payout = client.claim_pool_remainder(&market_id);
        assert_eq!(lp_payout, before_claim.reserve_yes);
        let s5 = client.settle_state(&market_id);
        assert_eq!(s5.paid_out, s4.paid_out + lp_payout);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #20)")]
    fn finalize_before_deadline_rejected() {
        let (env, client, creator, _, _, _) = setup_market();
        let market_id = create_market_with(&env, &client, &creator, 5000, 60_000);
        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 60_001);
        client.resolve(&market_id, &Outcome::Yes);
        let deadline = client.redeem_deadline(&market_id).unwrap();
        env.ledger().set_timestamp(deadline - 1);
        client.finalize_market(&market_id);
    }

    #[test]
    fn finalize_after_deadline_sweeps_exact_residual() {
        let (env, client, creator, trader, _, collateral) = setup_market();
        let trader2 = Address::generate(&env);
        StellarAssetClient::new(&env, &collateral).mint(&trader2, &10_000_000_000_i128);
        let token = soroban_sdk::token::TokenClient::new(&env, &collateral);

        let market_id = create_market_with(&env, &client, &creator, 6800, 60_000);
        client.buy(
            &trader,
            &market_id,
            &Outcome::Yes,
            &(10 * 10_000_000_i128),
            &0_i128,
        );
        client.buy(
            &trader2,
            &market_id,
            &Outcome::No,
            &(7 * 10_000_000_i128),
            &0_i128,
        );

        // A void with a mix of odd positions: per-holder floors are what
        // leaves rounding dust behind.
        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 60_001);
        client.void_market(&market_id);

        // One holder redeems before the deadline; the other never does.
        let trader_payout = client.redeem(&trader, &market_id);
        let deadline = client.redeem_deadline(&market_id).unwrap();
        env.ledger().set_timestamp(deadline + 1);

        let m_before = client.get_market(&market_id);
        let s_before = client.settle_state(&market_id);
        let expected_unclaimed = (s_before.outstanding_yes + s_before.outstanding_no) / 2;
        let expected_lp = (m_before.reserve_yes + m_before.reserve_no) / 2;
        let expected_dust =
            m_before.sets_minted - s_before.paid_out - expected_unclaimed - expected_lp;
        assert!(expected_dust >= 0);
        let expected_swept =
            expected_dust + expected_unclaimed + expected_lp + m_before.fees_accrued;

        let balance_before = token.balance(&client.address);
        let treasury_before = token.balance(&client.get_config().treasury);
        let swept = client.finalize_market(&market_id);

        // The sweep drains the market's entire balance — nothing stranded.
        assert_eq!(swept, expected_swept);
        assert_eq!(balance_before, swept);
        assert_eq!(token.balance(&client.address), 0);
        assert_eq!(
            token.balance(&client.get_config().treasury),
            treasury_before + swept
        );

        let m_after = client.get_market(&market_id);
        assert!(m_after.lp_claimed);
        assert_eq!(m_after.reserve_yes, 0);
        assert_eq!(m_after.reserve_no, 0);
        assert_eq!(m_after.fees_accrued, 0);
        let s_after = client.settle_state(&market_id);
        assert!(s_after.closed);
        assert_eq!(s_after.outstanding_yes, 0);
        assert_eq!(s_after.outstanding_no, 0);
        // `paid_out` keeps only the holder payouts that ever happened.
        assert_eq!(s_after.paid_out, trader_payout);

        // The never-redeemed holder is forfeit, not unpaid-but-pending.
        assert!(client.try_redeem(&trader2, &market_id).is_err());
    }

    #[test]
    fn redeem_before_deadline_never_underpaid() {
        let (env, client, creator, trader, _, _) = setup_market();
        // Two identical markets: one is finalized after the deadline, the
        // other is finalized too — the redemptions in between must be paid
        // exactly the same in both worlds.
        let a = create_market_with(&env, &client, &creator, 6800, 60_000);
        let b = create_market_with(&env, &client, &creator, 6800, 60_000);
        for id in [a, b] {
            client.buy(
                &trader,
                &id,
                &Outcome::Yes,
                &(10 * 10_000_000_i128),
                &0_i128,
            );
        }
        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 60_001);
        client.resolve(&a, &Outcome::Yes);
        client.resolve(&b, &Outcome::Yes);

        let deadline_a = client.redeem_deadline(&a).unwrap();
        let payout_a = client.redeem(&trader, &a);
        let payout_b = client.redeem(&trader, &b);
        assert_eq!(payout_a, payout_b);
        assert!(payout_a > 0);

        // Now let both deadlines pass and finalize both.
        env.ledger().set_timestamp(deadline_a + 1);
        let swept_b = client.finalize_market(&b);
        let swept_a = client.finalize_market(&a);
        assert_eq!(swept_a, swept_b);
        // The redeemer's payout was never touched by the finalize.
        assert_eq!(client.settle_state(&a).paid_out, payout_a);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #21)")]
    fn redeem_after_close_rejected() {
        let (env, client, creator, trader, _, _) = setup_market();
        let market_id = create_market_with(&env, &client, &creator, 6800, 60_000);
        client.buy(
            &trader,
            &market_id,
            &Outcome::Yes,
            &(10 * 10_000_000_i128),
            &0_i128,
        );
        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 60_001);
        client.resolve(&market_id, &Outcome::Yes);
        let deadline = client.redeem_deadline(&market_id).unwrap();
        env.ledger().set_timestamp(deadline + 1);
        client.finalize_market(&market_id);
        client.redeem(&trader, &market_id);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #21)")]
    fn claim_after_close_rejected() {
        let (env, client, creator, _, _, _) = setup_market();
        let market_id = create_market_with(&env, &client, &creator, 5000, 60_000);
        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 60_001);
        client.resolve(&market_id, &Outcome::Yes);
        let deadline = client.redeem_deadline(&market_id).unwrap();
        env.ledger().set_timestamp(deadline + 1);
        client.finalize_market(&market_id);
        client.claim_pool_remainder(&market_id);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #21)")]
    fn finalize_twice_rejected() {
        let (env, client, creator, _, _, _) = setup_market();
        let market_id = create_market_with(&env, &client, &creator, 5000, 60_000);
        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 60_001);
        client.resolve(&market_id, &Outcome::Yes);
        let deadline = client.redeem_deadline(&market_id).unwrap();
        env.ledger().set_timestamp(deadline + 1);
        client.finalize_market(&market_id);
        client.finalize_market(&market_id);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #22)")]
    fn legacy_market_cannot_finalize() {
        let (env, client, creator, _, _, _) = setup_market();
        let market_id = create_market_with(&env, &client, &creator, 5000, 60_000);
        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 60_001);
        client.resolve(&market_id, &Outcome::Yes);
        // Simulate a market created before `Settle` entries existed.
        env.as_contract(&client.address, || {
            env.storage()
                .persistent()
                .remove(&DataKey::Settle(market_id));
        });
        client.finalize_market(&market_id);
    }

    #[test]
    fn legacy_market_still_redeems_without_deadline() {
        let (env, client, creator, trader, _, _) = setup_market();
        let market_id = create_market_with(&env, &client, &creator, 6800, 60_000);
        client.buy(
            &trader,
            &market_id,
            &Outcome::Yes,
            &(10 * 10_000_000_i128),
            &0_i128,
        );
        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 60_001);
        client.resolve(&market_id, &Outcome::Yes);
        env.as_contract(&client.address, || {
            env.storage()
                .persistent()
                .remove(&DataKey::Settle(market_id));
        });

        // No deadline, no finalize — but the old redemption paths keep working.
        assert_eq!(client.redeem_deadline(&market_id), None);
        assert!(client.try_settle_state(&market_id).is_err());
        let payout = client.redeem(&trader, &market_id);
        assert!(payout > 0);
        assert!(client.claim_pool_remainder(&market_id) > 0);
    }

    #[test]
    fn redeem_horizon_default_snapshot_and_bounds() {
        let (env, client, creator, _, _, _) = setup_market();
        let long_horizon = 200 * ttl::DAY_SECS;
        client.set_default_redeem_horizon(&long_horizon);
        assert!(client
            .try_set_default_redeem_horizon(&(100 * ttl::DAY_SECS))
            .is_err());
        assert!(client
            .try_set_default_redeem_horizon(&(2_000 * ttl::DAY_SECS))
            .is_err());

        let market_id = create_market_with(&env, &client, &creator, 5000, 60_000);
        assert_eq!(client.settle_state(&market_id).horizon_secs, long_horizon);
        assert_eq!(client.redeem_deadline(&market_id), None);

        env.ledger()
            .set_timestamp(env.ledger().timestamp() + 60_001);
        client.resolve(&market_id, &Outcome::Yes);
        let resolved_at = env.ledger().timestamp();
        assert_eq!(
            client.redeem_deadline(&market_id),
            Some(resolved_at + long_horizon)
        );
    }

    #[test]
    fn wrong_caller_cannot_set_default_redeem_horizon() {
        let (env, client, _, trader, _, _) = setup_market();
        env.set_auths(&[]);
        assert!(client
            .mock_auths(&[MockAuth {
                address: &trader,
                invoke: &MockAuthInvoke {
                    contract: &client.address,
                    fn_name: "set_default_redeem_horizon",
                    args: (365 * ttl::DAY_SECS,).into_val(&env),
                    sub_invokes: &[],
                },
            }])
            .try_set_default_redeem_horizon(&(365 * ttl::DAY_SECS))
            .is_err());
    }
}
