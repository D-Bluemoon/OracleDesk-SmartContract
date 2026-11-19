#![no_std]

//! Stateless compound-flow router (#64).
//!
//! Creating a resolvable market takes two transactions today: `create_market`
//! on market-core (or `agent_create_market` on the treasury) followed by a
//! `register_*_spec` reveal on the resolver. A crash between them (or a
//! placeholder commitment) leaves a market that trades but can never be
//! resolved — the only escape is `guardian_void_market`.
//!
//! This contract runs those flows atomically in a single invocation. It is
//! deliberately **not** a privileged intermediary:
//!
//! * no admin, no roles;
//! * holds no funds between calls — collateral moves directly from the creator
//!   or agent to market-core;
//! * every downstream action is authorized by the end user's own signature, so
//!   the auth tree is exactly what the user signed (the router is named as an
//!   intermediate invoker, never as an authority).
//!
//! The primary flow, [`Router::create_and_reveal_signers`] /
//! [`Router::create_and_reveal_price`], computes the reveal's commitment hash
//! **before** calling market-core and passes that same hash as the commitment,
//! so a malformed reveal can never create an unresolvable market.
//! [`Router::trade_and_publish_trace`] trades through `buy_v2`/`sell_v2` and
//! records a reasoning trace in the same transaction, so a trace can't be
//! skipped after a trade; [`Router::agent_trade_and_publish_trace`] does the
//! same with the treasury's capital. [`Router::buy_and_publish_trace`] is a
//! deprecated wrapper for the direct buy path.

#[cfg(test)]
extern crate std;

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, xdr::ToXdr, Address, Bytes,
    BytesN, Env, IntoVal, String, Symbol, Val, Vec as SorobanVec,
};

// market-core, resolver, treasury and reasoning-registry are imported from
// their compiled wasm rather than as Cargo path dependencies: a direct
// dependency would merge their `#[no_mangle]` entrypoints into this crate's
// wasm and collide on the shared `__constructor` symbol. `contractimport!`
// only reads the interface spec. See docs/adr/0002-cross-contract-calls.md.
#[allow(clippy::too_many_arguments)]
mod market_core {
    soroban_sdk::contractimport!(file = "market_core.wasm");
}
use market_core::{Category, Client as MarketCoreClient, Outcome};

#[allow(clippy::too_many_arguments)]
mod resolver {
    soroban_sdk::contractimport!(file = "resolver.wasm");
}
use resolver::{Client as ResolverClient, ResolutionSpec, ResolutionSpecV2};

#[allow(clippy::too_many_arguments)]
mod treasury {
    soroban_sdk::contractimport!(file = "treasury.wasm");
}
use treasury::Client as TreasuryClient;

// The vendored registry wasm predates the typed `TraceAction` publish API.
// Only its `WASM` constant (used by the tests) is taken from the import: every
// publish call is made dynamically below so this crate does not encode the
// stale `String`-action interface at compile time.
#[allow(dead_code)]
#[allow(clippy::too_many_arguments)]
mod reasoning_registry {
    soroban_sdk::contractimport!(file = "reasoning_registry.wasm");
}

/// Domain tag prepended to a V2 spec before hashing. Must match the resolver's
/// `SPEC_DOMAIN` so a locally-computed commitment equals the one the resolver
/// would accept. See `docs/adr/0004-spec-versioning.md`.
const SPEC_DOMAIN: &[u8] = b"oracledesk:resolution-spec";
const SPEC_V2_VERSION: u32 = 2;
const MAX_CID_LEN: u32 = 128;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    /// A `price`/`signers` config failed the resolver's own validation rules.
    InvalidConfig = 2,
    /// The envelope named a different network or market-core.
    DomainMismatch = 3,
    /// Empty or over-long trace content.
    InvalidTrace = 4,
    /// The router was asked to reveal a rule variant it does not support.
    UnsupportedRule = 5,
    /// `TraceArgs.action` does not match the trade side.
    ActionMismatch = 6,
    /// The downstream trade returned no positive shares.
    InvalidTradeResult = 7,
    /// The supplied treasury is not wired to this router's market-core.
    TreasuryMismatch = 8,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketCreatedAndRevealed {
    #[topic]
    pub market_id: u64,
    pub creator: Address,
    pub spec_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TradeTraced {
    #[topic]
    pub market_id: u64,
    pub trader: Address,
    pub side: Side,
    pub shares: i128,
    pub trace_id: u64,
    pub chain_seq: Option<u64>,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Side {
    Buy,
    Sell,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TradeBounds {
    /// `collateral_in` for a buy, `collateral_out` for a sell.
    pub amount: i128,
    /// `min_shares_out` for a buy, `max_shares_in` for a sell.
    pub limit_shares: i128,
    pub limit_price_bps: u32,
    pub deadline: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChainArgs {
    pub expected_seq: u64,
    pub prev_trace_hash: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SigArgs {
    pub signing_key: BytesN<32>,
    pub signature: BytesN<64>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TraceArgs {
    pub action: TraceAction,
    pub trace_hash: BytesN<32>,
    pub ipfs_cid: String,
    pub chain: Option<ChainArgs>,
    pub sig: Option<SigArgs>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TradeTraceResult {
    pub shares: i128,
    pub trace_id: u64,
    pub chain_seq: Option<u64>,
}

/// Local copy of the registry's chain-head shape: used only to decode the
/// result of the dynamic `agent_chain_head` call, and kept here so no stale
/// generated registry type leaks into this crate's spec.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChainHead {
    pub seq: u64,
    pub head_hash: BytesN<32>,
    pub head_trace_id: Option<u64>,
}

/// Mirrors reasoning-registry's `TraceAction`. The enum is defined locally so
/// the router can pass a typed action without depending on the stale vendored
/// registry interface; its XDR shape is identical to the registry's.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TraceAction {
    CreateMarket,
    ProposeMarket,
    Buy,
    Sell,
    Skip,
    Redeem,
    ClaimRemainder,
    Resolve,
    Other(Symbol),
}

/// The address book the router calls into. Without it, every entrypoint would
/// have to take the downstream contract addresses from the caller, letting
/// anyone point the router at a hostile "resolver". With it, the router is
/// stateless apart from this one instance value.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RouterConfig {
    pub market_core: Address,
    pub resolver: Address,
    pub reasoning_registry: Option<Address>,
}

#[contracttype]
enum DataKey {
    Config,
}

#[contract]
pub struct Router;

#[contractimpl]
impl Router {
    /// Stores the address book once, at deploy time. There is no privileged
    /// role and the values never change, so this is not admin-gated.
    pub fn __constructor(
        env: Env,
        market_core: Address,
        resolver: Address,
        reasoning_registry: Option<Address>,
    ) {
        env.storage().instance().set(
            &DataKey::Config,
            &RouterConfig {
                market_core,
                resolver,
                reasoning_registry,
            },
        );
        env.storage()
            .instance()
            .extend_ttl(30 * 17_280, 60 * 17_280);
    }

    /// Creates a market and reveals its signer-mode rule in one transaction.
    /// The commitment is computed from `spec_v2` locally and passed to
    /// market-core, so the reveal necessarily matches.
    #[allow(clippy::too_many_arguments)]
    pub fn create_and_reveal_signers(
        env: Env,
        creator: Address,
        question_hash: BytesN<32>,
        meta_uri: String,
        category: Category,
        close_time: u64,
        seed_amount: i128,
        initial_yes_bps: u32,
        spec_v2: ResolutionSpecV2,
    ) -> Result<u64, Error> {
        Self::create_and_reveal(
            &env,
            creator,
            question_hash,
            meta_uri,
            category,
            close_time,
            seed_amount,
            initial_yes_bps,
            &spec_v2,
        )
    }

    /// See [`Router::create_and_reveal_signers`] — same flow, price rule.
    #[allow(clippy::too_many_arguments)]
    pub fn create_and_reveal_price(
        env: Env,
        creator: Address,
        question_hash: BytesN<32>,
        meta_uri: String,
        category: Category,
        close_time: u64,
        seed_amount: i128,
        initial_yes_bps: u32,
        spec_v2: ResolutionSpecV2,
    ) -> Result<u64, Error> {
        Self::create_and_reveal(
            &env,
            creator,
            question_hash,
            meta_uri,
            category,
            close_time,
            seed_amount,
            initial_yes_bps,
            &spec_v2,
        )
    }

    /// Reveals a spec the creator committed to in a previous transaction
    /// (ADR 0001's commit-now/reveal-later path). Kept here so a creator can
    /// use one contract for both the atomic and the deferred flows.
    pub fn reveal_spec(env: Env, market_id: u64, spec_v2: ResolutionSpecV2) -> Result<(), Error> {
        let cfg = Self::load_config(&env)?;
        Self::verify_envelope(&env, &cfg, &spec_v2)?;
        Self::validate_rule(&spec_v2.rule)?;
        ResolverClient::new(&env, &cfg.resolver).register_spec_v2(&market_id, &spec_v2);
        Ok(())
    }

    /// Trades `outcome` shares through market-core's `buy_v2`/`sell_v2` and
    /// publishes a typed reasoning trace through the registry in the same
    /// transaction. Optional chain and signature arguments select one of the
    /// registry's four publish entrypoints. Emits `TradeTraced`.
    #[allow(clippy::too_many_arguments)]
    pub fn trade_and_publish_trace(
        env: Env,
        trader: Address,
        market_id: u64,
        outcome: Outcome,
        side: Side,
        bounds: TradeBounds,
        trace: TraceArgs,
    ) -> Result<TradeTraceResult, Error> {
        Self::validate_trace(&trace, &side)?;
        let cfg = Self::load_config(&env)?;
        let registry = cfg
            .reasoning_registry
            .clone()
            .ok_or(Error::NotInitialized)?;

        // Root authorization: market-core and the registry both call
        // `require_auth` for `trader` deeper in the tree, so the trader's
        // signature must be anchored at the router (the root).
        trader.require_auth();

        let core = MarketCoreClient::new(&env, &cfg.market_core);
        let shares = match &side {
            Side::Buy => core.buy_v2(
                &trader,
                &market_id,
                &outcome,
                &bounds.amount,
                &bounds.limit_shares,
                &bounds.limit_price_bps,
                &bounds.deadline,
            ),
            Side::Sell => core.sell_v2(
                &trader,
                &market_id,
                &outcome,
                &bounds.amount,
                &bounds.limit_shares,
                &bounds.limit_price_bps,
                &bounds.deadline,
            ),
        };
        if shares <= 0 {
            return Err(Error::InvalidTradeResult);
        }

        let trace_id = Self::publish(&env, &registry, &trader, market_id, &trace);
        let chain_seq = Self::chain_seq(&env, &registry, &trader, &trace.chain);
        TradeTraced {
            market_id,
            trader,
            side,
            shares,
            trace_id,
            chain_seq,
        }
        .publish(&env);
        Ok(TradeTraceResult {
            shares,
            trace_id,
            chain_seq,
        })
    }

    /// Same atomic trade+trace flow, but the trade runs through the caller's
    /// treasury (`agent_buy_v2`/`agent_sell_v2`) and the agent is the trace
    /// author. The treasury is caller-supplied, so it is checked against the
    /// router's market-core both ways before any call is made: a hostile
    /// treasury could otherwise make the router publish a trace for a trade
    /// that never happened.
    #[allow(clippy::too_many_arguments)]
    pub fn agent_trade_and_publish_trace(
        env: Env,
        treasury: Address,
        agent: Address,
        market_id: u64,
        outcome: Outcome,
        side: Side,
        bounds: TradeBounds,
        trace: TraceArgs,
    ) -> Result<TradeTraceResult, Error> {
        Self::validate_trace(&trace, &side)?;
        let cfg = Self::load_config(&env)?;
        let registry = cfg
            .reasoning_registry
            .clone()
            .ok_or(Error::NotInitialized)?;
        Self::verify_treasury(&env, &cfg, &treasury)?;

        agent.require_auth();
        let treasury_client = TreasuryClient::new(&env, &treasury);
        let shares = match &side {
            Side::Buy => treasury_client.agent_buy_v2(
                &agent,
                &market_id,
                &outcome,
                &bounds.amount,
                &bounds.limit_shares,
                &bounds.limit_price_bps,
                &bounds.deadline,
            ),
            Side::Sell => treasury_client.agent_sell_v2(
                &agent,
                &market_id,
                &outcome,
                &bounds.amount,
                &bounds.limit_shares,
                &bounds.limit_price_bps,
                &bounds.deadline,
            ),
        };
        if shares <= 0 {
            return Err(Error::InvalidTradeResult);
        }

        let trace_id = Self::publish(&env, &registry, &agent, market_id, &trace);
        let chain_seq = Self::chain_seq(&env, &registry, &agent, &trace.chain);
        TradeTraced {
            market_id,
            trader: agent,
            side,
            shares,
            trace_id,
            chain_seq,
        }
        .publish(&env);
        Ok(TradeTraceResult {
            shares,
            trace_id,
            chain_seq,
        })
    }

    /// Deprecated one-release compatibility wrapper for the direct buy path.
    /// New callers should use `trade_and_publish_trace` with explicit bounds,
    /// a typed action and optional chain/signature arguments.
    #[allow(clippy::too_many_arguments)]
    pub fn buy_and_publish_trace(
        env: Env,
        trader: Address,
        market_id: u64,
        outcome: Outcome,
        collateral_in: i128,
        min_shares_out: i128,
        trace_hash: BytesN<32>,
        ipfs_cid: String,
    ) -> Result<TradeTraceResult, Error> {
        let deadline = env.ledger().timestamp();
        Self::trade_and_publish_trace(
            env,
            trader,
            market_id,
            outcome,
            Side::Buy,
            TradeBounds {
                amount: collateral_in,
                limit_shares: min_shares_out,
                limit_price_bps: 10_000,
                deadline,
            },
            TraceArgs {
                action: TraceAction::Buy,
                trace_hash,
                ipfs_cid,
                chain: None,
                sig: None,
            },
        )
    }

    // ----- views ----------------------------------------------------------

    pub fn config(env: Env) -> Result<RouterConfig, Error> {
        Self::load_config(&env)
    }

    // ----- internals ------------------------------------------------------

    #[allow(clippy::too_many_arguments)]
    fn create_and_reveal(
        env: &Env,
        creator: Address,
        question_hash: BytesN<32>,
        meta_uri: String,
        category: Category,
        close_time: u64,
        seed_amount: i128,
        initial_yes_bps: u32,
        spec_v2: &ResolutionSpecV2,
    ) -> Result<u64, Error> {
        let cfg = Self::load_config(env)?;
        Self::verify_envelope(env, &cfg, spec_v2)?;
        Self::validate_rule(&spec_v2.rule)?;

        // Establish the creator's authorization at the router (the root
        // invocation). market-core's `create_market` calls `require_auth`
        // further down the call tree, which alone would be a non-root auth and
        // be rejected; requiring it here ties the whole tree to the creator's
        // signature.
        creator.require_auth();

        // The commitment is derived from the exact reveal we will register, so
        // the two can never disagree. Computing it locally (rather than trusting
        // a caller-supplied hash) is what makes the reveal authoritative.
        let resolution_hash = spec_v2_hash(env, spec_v2);

        let market_id = MarketCoreClient::new(env, &cfg.market_core).create_market(
            &creator,
            &question_hash,
            &resolution_hash,
            &meta_uri,
            &category,
            &close_time,
            &seed_amount,
            &initial_yes_bps,
        );

        ResolverClient::new(env, &cfg.resolver).register_spec_v2(&market_id, spec_v2);

        MarketCreatedAndRevealed {
            market_id,
            creator,
            spec_hash: resolution_hash,
        }
        .publish(env);
        Ok(market_id)
    }

    fn validate_trace(trace: &TraceArgs, side: &Side) -> Result<(), Error> {
        let action_matches = matches!(
            (side, &trace.action),
            (Side::Buy, TraceAction::Buy) | (Side::Sell, TraceAction::Sell)
        );
        if !action_matches {
            return Err(Error::ActionMismatch);
        }
        if trace.ipfs_cid.is_empty() || trace.ipfs_cid.len() > MAX_CID_LEN {
            return Err(Error::InvalidTrace);
        }
        Ok(())
    }

    fn verify_treasury(env: &Env, cfg: &RouterConfig, treasury: &Address) -> Result<(), Error> {
        let global = TreasuryClient::new(env, treasury).get_global();
        let core = MarketCoreClient::new(env, &cfg.market_core).get_config();
        if global.market_core != cfg.market_core || core.treasury != *treasury {
            return Err(Error::TreasuryMismatch);
        }
        Ok(())
    }

    fn invoke_publish(env: &Env, registry: &Address, function: &str, args: SorobanVec<Val>) -> u64 {
        env.invoke_contract::<u64>(registry, &Symbol::new(env, function), args)
    }

    /// Dispatches to the registry publish entrypoint selected by the optional
    /// chain and signature arguments. Calls are made by name so the router does
    /// not embed the stale vendored registry's generated `String` API.
    fn publish(
        env: &Env,
        registry: &Address,
        author: &Address,
        market_id: u64,
        trace: &TraceArgs,
    ) -> u64 {
        let mut args: SorobanVec<Val> = soroban_sdk::vec![
            env,
            author.clone().into_val(env),
            market_id.into_val(env),
            trace.action.clone().into_val(env),
            trace.trace_hash.clone().into_val(env),
            trace.ipfs_cid.clone().into_val(env),
        ];
        match (&trace.chain, &trace.sig) {
            (None, None) => Self::invoke_publish(env, registry, "publish_trace", args),
            (Some(chain), None) => {
                args.push_back(chain.expected_seq.into_val(env));
                args.push_back(chain.prev_trace_hash.clone().into_val(env));
                Self::invoke_publish(env, registry, "publish_chained_trace", args)
            }
            (None, Some(sig)) => {
                args.push_back(sig.signing_key.clone().into_val(env));
                args.push_back(sig.signature.clone().into_val(env));
                Self::invoke_publish(env, registry, "publish_trace_signed", args)
            }
            (Some(chain), Some(sig)) => {
                args.push_back(chain.expected_seq.into_val(env));
                args.push_back(chain.prev_trace_hash.clone().into_val(env));
                args.push_back(sig.signing_key.clone().into_val(env));
                args.push_back(sig.signature.clone().into_val(env));
                Self::invoke_publish(env, registry, "publish_chained_trace_signed", args)
            }
        }
    }

    /// Reads the authoritative chain head after a chained publish. A concurrent
    /// publish by the same agent makes the registry reject the whole call with
    /// `ChainHeadMismatch`, so a successful read cannot describe a different
    /// publish than the one this invocation just made.
    fn chain_seq(
        env: &Env,
        registry: &Address,
        author: &Address,
        chain: &Option<ChainArgs>,
    ) -> Option<u64> {
        if chain.is_none() {
            return None;
        }
        let head: ChainHead = env.invoke_contract(
            registry,
            &Symbol::new(env, "agent_chain_head"),
            soroban_sdk::vec![env, author.clone().into_val(env)],
        );
        Some(head.seq)
    }

    fn verify_envelope(
        env: &Env,
        cfg: &RouterConfig,
        spec: &ResolutionSpecV2,
    ) -> Result<(), Error> {
        if spec.version != SPEC_V2_VERSION || spec.salt == BytesN::from_array(env, &[0; 32]) {
            return Err(Error::InvalidConfig);
        }
        if spec.network_id != env.ledger().network_id() || spec.market_core != cfg.market_core {
            return Err(Error::DomainMismatch);
        }
        Ok(())
    }

    fn validate_rule(rule: &ResolutionSpec) -> Result<(), Error> {
        let ok = match rule {
            ResolutionSpec::Price(cfg) => cfg.threshold >= 0 && cfg.max_staleness != 0,
            ResolutionSpec::Signers(cfg) => {
                !cfg.signers.is_empty()
                    && cfg.threshold != 0
                    && cfg.threshold <= cfg.signers.len()
                    && cfg.dispute_window != 0
            }
            // The router only runs the two primary flows; the resolver still
            // accepts the other variants through its own entrypoints.
            _ => return Err(Error::UnsupportedRule),
        };
        if ok {
            Ok(())
        } else {
            Err(Error::InvalidConfig)
        }
    }

    fn load_config(env: &Env) -> Result<RouterConfig, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)
    }
}

/// Hash a V2 commitment is checked against: `sha256(SPEC_DOMAIN || XDR(spec))`.
/// Mirrors `resolver::spec_v2_hash` (which is a plain fn, not a contract
/// entrypoint, so it is not part of the imported interface spec).
fn spec_v2_hash(env: &Env, spec: &ResolutionSpecV2) -> BytesN<32> {
    let mut preimage = Bytes::from_slice(env, SPEC_DOMAIN);
    preimage.append(&spec.clone().to_xdr(env));
    env.crypto().sha256(&preimage).into()
}

#[cfg(test)]
mod test;
