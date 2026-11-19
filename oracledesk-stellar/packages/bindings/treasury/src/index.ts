import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




export type Outcome = {tag: "Yes", values: void} | {tag: "No", values: void};

export type Category = {tag: "Crypto", values: void} | {tag: "Macro", values: void} | {tag: "Geopolitics", values: void} | {tag: "Sports", values: void} | {tag: "Culture", values: void} | {tag: "Other", values: void};


export interface BatchItem {
  market_id: u64;
  payout: i128;
  status: BatchStatus;
}

export type Escalation = {tag: "Guardian", values: void} | {tag: "Committee", values: readonly [Array<string>, u32]};

export type SkipReason = {tag: "NotFound", values: void} | {tag: "NotFinal", values: void} | {tag: "NothingToRedeem", values: void} | {tag: "AlreadyClaimed", values: void} | {tag: "NotCreator", values: void} | {tag: "Duplicate", values: void};


export interface BatchResult {
  items: Array<BatchItem>;
  total: i128;
}

export type BatchStatus = {tag: "Settled", values: void} | {tag: "Skipped", values: readonly [SkipReason]};

export type OracleAsset = {tag: "Stellar", values: readonly [string]} | {tag: "Other", values: readonly [string]};


export interface PriceConfig {
  asset: OracleAsset;
  direction: PriceDirection;
  max_staleness: u64;
  reflector: string;
  threshold: i128;
}


export interface WeightedKey {
  pubkey: Buffer;
  weight: u32;
}


export interface CommitteeRef {
  committee_id: u64;
  dispute_window: u64;
  max_rotation_delta: u32;
  min_epoch: u32;
}


export interface HybridConfig {
  fallback: SignerConfig;
  fallback_after: u64;
  price: PriceConfig;
}


export interface SignerConfig {
  dispute_window: u64;
  signers: Array<string>;
  threshold: u32;
}

export type PriceDirection = {tag: "Above", values: void} | {tag: "AtOrAbove", values: void} | {tag: "Below", values: void} | {tag: "AtOrBelow", values: void};

export type ResolutionSpec = {tag: "Price", values: readonly [PriceConfig]} | {tag: "Signers", values: readonly [SignerConfig]} | {tag: "WeightedKeys", values: readonly [WeightedKeyConfig]} | {tag: "SignersDisputable", values: readonly [DisputableSignerConfig]} | {tag: "Committee", values: readonly [CommitteeRef]} | {tag: "Hybrid", values: readonly [HybridConfig]};


export interface ResolutionSpecV2 {
  market_core: string;
  network_id: Buffer;
  rule: ResolutionSpec;
  salt: Buffer;
  version: u32;
}


export interface WeightedKeyConfig {
  dispute_window: u64;
  signers: Array<WeightedKey>;
  weight_threshold: u32;
}


export interface DisputableSignerConfig {
  dispute_bond: i128;
  dispute_window: u64;
  escalation: Escalation;
  escalation_timeout: u64;
  signers: Array<string>;
  threshold: u32;
}

export type Mode = {tag: "Normal", values: void} | {tag: "Unwinding", values: void} | {tag: "Paused", values: void};

export const Errors = {
  1: {message:"NotInitialized"},
  2: {message:"Unauthorized"},
  3: {message:"InvalidConfig"},
  4: {message:"InvalidAmount"},
  5: {message:"TradeCapExceeded"},
  6: {message:"MarketCapExceeded"},
  7: {message:"DailyCapExceeded"},
  8: {message:"MarketNotOpen"},
  9: {message:"InsufficientBalance"},
  10: {message:"Paused"},
  11: {message:"NoSuccessor"},
  12: {message:"NetExposureExceeded"},
  13: {message:"AgentDailyCapExceeded"},
  14: {message:"ProposalPending"},
  15: {message:"TimelockActive"},
  16: {message:"NoPendingConfig"},
  17: {message:"LegacyCoreUnknown"},
  18: {message:"TooManyOpenMarkets"},
  19: {message:"CapitalReserved"},
  20: {message:"DepositTooSmall"},
  21: {message:"InsufficientShares"},
  22: {message:"TicketNotFound"},
  23: {message:"NothingToPay"},
  24: {message:"PriceOutOfBand"},
  25: {message:"PriceImpactExceeded"},
  26: {message:"InvalidPricePolicy"},
  27: {message:"SlippageExceeded"},
  28: {message:"NotPaused"},
  29: {message:"MarketCoreMarketNotFound"},
  30: {message:"MarketCoreNotFinal"},
  31: {message:"MarketCoreMarketNotOpen"},
  32: {message:"MarketCoreMarketClosed"},
  33: {message:"MarketCoreInsufficientLiquidity"},
  34: {message:"MarketCoreInsufficientShares"},
  35: {message:"MarketCoreAlreadyClaimed"},
  36: {message:"MarketCoreNothingToRedeem"},
  37: {message:"MarketCoreInvalidAmount"},
  38: {message:"MarketCoreOverflow"},
  39: {message:"MarketCoreSlippageExceeded"},
  40: {message:"MarketCoreCallFailed"},
  44: {message:"MarketNotFinal"},
  45: {message:"MarketCoreError"},
  46: {message:"DrawdownTripped"},
  47: {message:"InvalidDrawdownConfig"},
  48: {message:"NotAcknowledged"},
  49: {message:"SeedCapExceeded"},
  50: {message:"CreationRateExceeded"},
  51: {message:"CloseTimeTooSoon"},
  52: {message:"CloseTimeTooFar"},
  53: {message:"CategoryNotAllowed"},
  54: {message:"PolicyLoosening"},
  55: {message:"YieldDisabled"},
  56: {message:"YieldCapExceeded"},
  57: {message:"YieldWithdrawFailed"},
  58: {message:"VenueHasPrincipal"},
  59: {message:"CategoryCapExceeded"},
  60: {message:"BucketCapExceeded"},
  61: {message:"NoPendingAdmin"},
  62: {message:"PendingAdminExpired"},
  63: {message:"InvalidResolution"},
  64: {message:"OpNotReady"},
  65: {message:"OpExpired"},
  66: {message:"NoPendingOp"},
  67: {message:"BelowExitFloor"},
  68: {message:"InvalidExitFloor"},
  69: {message:"CollateralNotAllowed"}
}

export type AdminOp = {tag: "SetYieldVenue", values: readonly [string, i128]} | {tag: "AllocateToYield", values: readonly [i128]} | {tag: "SetSuccessor", values: readonly [string]} | {tag: "MigrateMarkets", values: readonly [Array<u64>]} | {tag: "SetDrawdownConfig", values: readonly [i128, u32]} | {tag: "ResetPnlWindow", values: void} | {tag: "SetCreationPolicy", values: readonly [CreationPolicy]} | {tag: "SetCorrelationCaps", values: readonly [CorrelationCaps]};


export interface Realized {
  lp_proceeds: i128;
  position_proceeds: i128;
  settled: boolean;
}


export interface MarketPnl {
  cost: i128;
  proceeds: i128;
  realized: boolean;
}


export interface TokenCaps {
  max_daily: i128;
  max_market: i128;
  max_trade: i128;
}


export interface Valuation {
  at_risk: i128;
  cost_basis: i128;
  floor_value: i128;
  spot_value: i128;
}



export interface DailyUsage {
  amount: i128;
  day_start: u64;
}


export interface OpenMarket {
  core: string;
  market_id: u64;
}


export interface RiskConfig {
  agent: string;
  collateral: string;
  market_core: string;
  max_daily: i128;
  max_market: i128;
  max_trade: i128;
}



export interface AgentPolicy {
  active: boolean;
  max_daily: i128;
  max_trade: i128;
  roles: u32;
}


export interface NetPosition {
  collateral_in: i128;
  collateral_out: i128;
}


export interface PricePolicy {
  max_buy_price_bps: u32;
  max_impact_bps: u32;
  max_slippage_bps: u32;
  min_sell_price_bps: u32;
}


export interface UsageWindow {
  amounts: Array<i128>;
  head_hour: u64;
  head_idx: u32;
}




export interface GlobalConfig {
  collateral: string;
  market_core: string;
  max_daily: i128;
  max_market: i128;
  max_net_exposure: i128;
  max_trade: i128;
}


export interface PendingAgent {
  executable_at: u64;
  policy: AgentPolicy;
  proposed_at: u64;
}






export interface PendingConfig {
  config: GlobalConfig;
  executable_at: u64;
  proposed_at: u64;
}







export interface CreationPolicy {
  allowed_categories: u32;
  creation_window_secs: u64;
  max_close_horizon: u64;
  max_markets_per_window: u32;
  max_seed: i128;
  min_close_horizon: u64;
}


export interface DrawdownStatus {
  max_drawdown: i128;
  tripped: boolean;
  window_pnl: i128;
}


export interface PendingAdminOp {
  executable_at: u64;
  expires_at: u64;
  op: AdminOp;
  proposed_at: u64;
}


export interface WithdrawTicket {
  created_at: u64;
  owner: string;
  remaining: i128;
}












export interface CorrelationCaps {
  bucket_secs: u64;
  max_per_bucket: i128;
  max_per_category: Array<i128>;
}






export interface CapitalBreakdown {
  liquid: i128;
  yield_principal: i128;
  yield_value: i128;
}


export interface SettlementReport {
  already_settled: boolean;
  lp_claimed: i128;
  redeemed: i128;
}





export interface PendingCorrelation {
  caps: CorrelationCaps;
  executable_at: u64;
  proposed_at: u64;
}


export interface PendingPricePolicy {
  executable_at: u64;
  policy: PricePolicy;
  proposed_at: u64;
}












export interface Client {
  /**
   * Construct and simulate a nav transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  nav: (options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a mode transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  mode: (options?: MethodOptions) => Promise<AssembledTransaction<Mode>>

  /**
   * Construct and simulate a redeem transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  redeem: ({agent, market_id}: {agent: string, market_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  deposit: ({from, amount}: {from: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a realize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  realize: ({market_id}: {market_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a unwound transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  unwound: ({market_id}: {market_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a agent_at transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  agent_at: ({i}: {i: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a realized transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  realized: ({market_id}: {market_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Realized>>

  /**
   * Construct and simulate a set_mode transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_mode: ({mode}: {mode: Mode}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a unwinder transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  unwinder: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a agent_buy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  agent_buy: ({agent, market_id, outcome, collateral_in, min_shares_out}: {agent: string, market_id: u64, outcome: Outcome, collateral_in: i128, min_shares_out: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a cancel_op transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  cancel_op: ({kind}: {kind: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_agent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_agent: ({agent}: {agent: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<AgentPolicy>>>

  /**
   * Construct and simulate a set_agent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_agent: ({agent, policy}: {agent: string, policy: AgentPolicy}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a shares_of transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  shares_of: ({owner}: {owner: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a agent_sell transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  agent_sell: ({agent, market_id, outcome, collateral_out, max_shares_in}: {agent: string, market_id: u64, outcome: Outcome, collateral_out: i128, max_shares_in: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a execute_op transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  execute_op: ({kind}: {kind: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a exit_floor transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  exit_floor: ({market_id}: {market_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a get_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_config: (options?: MethodOptions) => Promise<AssembledTransaction<Result<RiskConfig>>>

  /**
   * Construct and simulate a get_global transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_global: (options?: MethodOptions) => Promise<AssembledTransaction<Result<GlobalConfig>>>

  /**
   * Construct and simulate a market_pnl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  market_pnl: ({market_id}: {market_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<MarketPnl>>

  /**
   * Construct and simulate a pending_op transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  pending_op: ({kind}: {kind: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<PendingAdminOp>>>

  /**
   * Construct and simulate a propose_op transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  propose_op: ({op}: {op: AdminOp}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a set_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_paused: ({paused}: {paused: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a token_caps transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  token_caps: ({token}: {token: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<TokenCaps>>>

  /**
   * Construct and simulate a window_pnl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  window_pnl: (options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a agent_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  agent_count: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a close_trade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  close_trade: ({agent, market_id}: {agent: string, market_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a daily_usage transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  daily_usage: (options?: MethodOptions) => Promise<AssembledTransaction<Result<DailyUsage>>>

  /**
   * Construct and simulate a get_net_cap transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_net_cap: (options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a redeem_many transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  redeem_many: ({agent, market_ids}: {agent: string, market_ids: Array<u64>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<BatchResult>>>

  /**
   * Construct and simulate a agent_buy_v2 transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  agent_buy_v2: ({agent, market_id, outcome, collateral_in, min_shares_out, limit_price_bps, deadline}: {agent: string, market_id: u64, outcome: Outcome, collateral_in: i128, min_shares_out: i128, limit_price_bps: u32, deadline: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a cancel_agent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  cancel_agent: ({agent}: {agent: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a config_delay transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  config_delay: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a net_exposure transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  net_exposure: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a net_position transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  net_position: ({market_id}: {market_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<NetPosition>>>

  /**
   * Construct and simulate a queue_bounds transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  queue_bounds: (options?: MethodOptions) => Promise<AssembledTransaction<readonly [u64, u64]>>

  /**
   * Construct and simulate a remove_agent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  remove_agent: ({agent}: {agent: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_unwinder transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_unwinder: ({unwinder}: {unwinder: Option<string>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a total_shares transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  total_shares: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a agent_sell_v2 transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  agent_sell_v2: ({agent, market_id, outcome, collateral_out, max_shares_in, limit_price_bps, deadline}: {agent: string, market_id: u64, outcome: Outcome, collateral_out: i128, max_shares_in: i128, limit_price_bps: u32, deadline: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a cancel_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  cancel_config: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a deposit_token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  deposit_token: ({from, token, amount}: {from: string, token: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a disable_yield transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  disable_yield: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a execute_agent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  execute_agent: ({agent}: {agent: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a legacy_redeem transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  legacy_redeem: ({agent, core, market_id}: {agent: string, core: string, market_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a pending_agent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  pending_agent: ({agent}: {agent: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<PendingAgent>>>

  /**
   * Construct and simulate a set_successor transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_successor: ({successor}: {successor: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a settle_market transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  settle_market: ({caller, market_id}: {caller: string, market_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<SettlementReport>>>

  /**
   * Construct and simulate a claim_withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  claim_withdraw: ({ticket_id}: {ticket_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a creation_usage transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  creation_usage: (options?: MethodOptions) => Promise<AssembledTransaction<Result<u32>>>

  /**
   * Construct and simulate a daily_headroom transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  daily_headroom: (options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a execute_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  execute_config: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a liquid_capital transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  liquid_capital: (options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a open_market_at transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  open_market_at: ({i}: {i: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Option<OpenMarket>>>

  /**
   * Construct and simulate a pending_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  pending_config: (options?: MethodOptions) => Promise<AssembledTransaction<Option<PendingConfig>>>

  /**
   * Construct and simulate a propose_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  propose_config: ({config}: {config: GlobalConfig}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a queue_reserved transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  queue_reserved: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a set_exit_floor transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_exit_floor: ({market_id, price_bps}: {market_id: u64, price_bps: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_token_caps transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_token_caps: ({token, caps}: {token: string, caps: TokenCaps}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a bucket_exposure transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  bucket_exposure: ({core, bucket}: {core: string, bucket: u64}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a drawdown_status transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  drawdown_status: (options?: MethodOptions) => Promise<AssembledTransaction<Result<DrawdownStatus>>>

  /**
   * Construct and simulate a migrate_markets transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  migrate_markets: ({market_ids}: {market_ids: Array<u64>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_yield_venue transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_yield_venue: ({pool, max_allocation}: {pool: string, max_allocation: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a withdraw_ticket transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  withdraw_ticket: ({ticket_id}: {ticket_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Option<WithdrawTicket>>>

  /**
   * Construct and simulate a correlation_caps transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  correlation_caps: (options?: MethodOptions) => Promise<AssembledTransaction<Result<CorrelationCaps>>>

  /**
   * Construct and simulate a get_price_policy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_price_policy: (options?: MethodOptions) => Promise<AssembledTransaction<PricePolicy>>

  /**
   * Construct and simulate a market_valuation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  market_valuation: ({market_id}: {market_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Valuation>>>

  /**
   * Construct and simulate a request_withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  request_withdraw: ({owner, shares}: {owner: string, shares: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<readonly [i128, u64]>>>

  /**
   * Construct and simulate a reset_pnl_window transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  reset_pnl_window: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_config_delay transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_config_delay: ({new_delay}: {new_delay: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_price_policy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_price_policy: ({policy}: {policy: PricePolicy}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a agent_daily_usage transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  agent_daily_usage: ({agent}: {agent: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<DailyUsage>>>

  /**
   * Construct and simulate a allocate_to_yield transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  allocate_to_yield: ({amount}: {amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a available_capital transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  available_capital: (options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a capital_breakdown transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  capital_breakdown: (options?: MethodOptions) => Promise<AssembledTransaction<Result<CapitalBreakdown>>>

  /**
   * Construct and simulate a category_exposure transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  category_exposure: ({core, idx}: {core: string, idx: u32}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a open_market_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  open_market_count: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a recall_from_yield transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  recall_from_yield: ({amount}: {amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a daily_usage_detail transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  daily_usage_detail: (options?: MethodOptions) => Promise<AssembledTransaction<Result<UsageWindow>>>

  /**
   * Construct and simulate a emergency_withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  emergency_withdraw: ({owner, shares}: {owner: string, shares: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a agent_claim_lp_fees transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  agent_claim_lp_fees: ({agent, market_id}: {agent: string, market_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a agent_create_market transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  agent_create_market: ({agent, question_hash, resolution_hash, meta_uri, category, close_time, seed_amount, initial_yes_bps}: {agent: string, question_hash: Buffer, resolution_hash: Buffer, meta_uri: string, category: Category, close_time: u64, seed_amount: i128, initial_yes_bps: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a cancel_price_policy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  cancel_price_policy: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a collect_market_fees transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  collect_market_fees: ({market_id}: {market_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a get_creation_policy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_creation_policy: (options?: MethodOptions) => Promise<AssembledTransaction<Result<CreationPolicy>>>

  /**
   * Construct and simulate a set_creation_policy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_creation_policy: ({new_policy}: {new_policy: CreationPolicy}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_drawdown_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_drawdown_config: ({max_drawdown, window_days}: {max_drawdown: i128, window_days: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a acknowledge_drawdown transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  acknowledge_drawdown: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a available_capital_of transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  available_capital_of: ({token}: {token: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a claim_pool_remainder transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  claim_pool_remainder: ({agent, market_id}: {agent: string, market_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a correlation_headroom transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  correlation_headroom: ({market_id}: {market_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<readonly [i128, i128]>>>

  /**
   * Construct and simulate a execute_price_policy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  execute_price_policy: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a pending_price_policy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  pending_price_policy: (options?: MethodOptions) => Promise<AssembledTransaction<Option<PendingPricePolicy>>>

  /**
   * Construct and simulate a claim_pool_remainders transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  claim_pool_remainders: ({agent, market_ids}: {agent: string, market_ids: Array<u64>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<BatchResult>>>

  /**
   * Construct and simulate a set_default_exit_floor transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_default_exit_floor: ({price_bps}: {price_bps: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a cancel_correlation_caps transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  cancel_correlation_caps: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a execute_correlation_caps transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  execute_correlation_caps: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a pending_correlation_caps transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  pending_correlation_caps: (options?: MethodOptions) => Promise<AssembledTransaction<Option<PendingCorrelation>>>

  /**
   * Construct and simulate a propose_correlation_caps transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  propose_correlation_caps: ({caps}: {caps: CorrelationCaps}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a legacy_claim_pool_remainder transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  legacy_claim_pool_remainder: ({agent, core, market_id}: {agent: string, core: string, market_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a agent_create_market_and_reveal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  agent_create_market_and_reveal: ({agent, resolver, question_hash, meta_uri, category, close_time, seed_amount, initial_yes_bps, spec_v2}: {agent: string, resolver: string, question_hash: Buffer, meta_uri: string, category: Category, close_time: u64, seed_amount: i128, initial_yes_bps: u32, spec_v2: ResolutionSpecV2}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a agent_create_market_collateral transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  agent_create_market_collateral: ({agent, collateral, question_hash, resolution_hash, meta_uri, category, close_time, seed_amount, initial_yes_bps}: {agent: string, collateral: string, question_hash: Buffer, resolution_hash: Buffer, meta_uri: string, category: Category, close_time: u64, seed_amount: i128, initial_yes_bps: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, agent, collateral, market_core, max_trade, max_market, max_daily, max_net_exposure, config_delay, max_drawdown, window_days, creation_policy}: {admin: string, agent: string, collateral: string, market_core: string, max_trade: i128, max_market: i128, max_daily: i128, max_net_exposure: i128, config_delay: u64, max_drawdown: i128, window_days: u32, creation_policy: CreationPolicy},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin, agent, collateral, market_core, max_trade, max_market, max_daily, max_net_exposure, config_delay, max_drawdown, window_days, creation_policy}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAgAAAAAAAAAAAAAAB091dGNvbWUAAAAAAgAAAAAAAAAAAAAAA1llcwAAAAAAAAAAAAAAAAJObwAA",
        "AAAAAgAAAAAAAAAAAAAACENhdGVnb3J5AAAABgAAAAAAAAAAAAAABkNyeXB0bwAAAAAAAAAAAAAAAAAFTWFjcm8AAAAAAAAAAAAAAAAAAAtHZW9wb2xpdGljcwAAAAAAAAAAAAAAAAZTcG9ydHMAAAAAAAAAAAAAAAAAB0N1bHR1cmUAAAAAAAAAAAAAAAAFT3RoZXIAAAA=",
        "AAAAAQAAAAAAAAAAAAAACUJhdGNoSXRlbQAAAAAAAAMAAAAAAAAACW1hcmtldF9pZAAAAAAAAAYAAAAAAAAABnBheW91dAAAAAAACwAAAAAAAAAGc3RhdHVzAAAAAAfQAAAAC0JhdGNoU3RhdHVzAA==",
        "AAAAAgAAAAAAAAAAAAAACkVzY2FsYXRpb24AAAAAAAIAAAAAAAAAAAAAAAhHdWFyZGlhbgAAAAEAAAAAAAAACUNvbW1pdHRlZQAAAAAAAAIAAAPqAAAAEwAAAAQ=",
        "AAAAAgAAAAAAAAAAAAAAClNraXBSZWFzb24AAAAAAAYAAAAAAAAAAAAAAAhOb3RGb3VuZAAAAAAAAAAAAAAACE5vdEZpbmFsAAAAAAAAAAAAAAAPTm90aGluZ1RvUmVkZWVtAAAAAAAAAAAAAAAADkFscmVhZHlDbGFpbWVkAAAAAAAAAAAAAAAAAApOb3RDcmVhdG9yAAAAAAAAAAAAAAAAAAlEdXBsaWNhdGUAAAA=",
        "AAAAAQAAAAAAAAAAAAAAC0JhdGNoUmVzdWx0AAAAAAIAAAAAAAAABWl0ZW1zAAAAAAAD6gAAB9AAAAAJQmF0Y2hJdGVtAAAAAAAAAAAAAAV0b3RhbAAAAAAAAAs=",
        "AAAAAgAAAAAAAAAAAAAAC0JhdGNoU3RhdHVzAAAAAAIAAAAAAAAAAAAAAAdTZXR0bGVkAAAAAAEAAAAAAAAAB1NraXBwZWQAAAAAAQAAB9AAAAAKU2tpcFJlYXNvbgAA",
        "AAAAAgAAAAAAAAAAAAAAC09yYWNsZUFzc2V0AAAAAAIAAAABAAAAAAAAAAdTdGVsbGFyAAAAAAEAAAATAAAAAQAAAAAAAAAFT3RoZXIAAAAAAAABAAAAEQ==",
        "AAAAAQAAAAAAAAAAAAAAC1ByaWNlQ29uZmlnAAAAAAUAAAAAAAAABWFzc2V0AAAAAAAH0AAAAAtPcmFjbGVBc3NldAAAAAAAAAAACWRpcmVjdGlvbgAAAAAAB9AAAAAOUHJpY2VEaXJlY3Rpb24AAAAAAAAAAAANbWF4X3N0YWxlbmVzcwAAAAAAAAYAAAAAAAAACXJlZmxlY3RvcgAAAAAAABMAAAAAAAAACXRocmVzaG9sZAAAAAAAAAs=",
        "AAAAAQAAAAAAAAAAAAAAC1dlaWdodGVkS2V5AAAAAAIAAAAAAAAABnB1YmtleQAAAAAD7gAAACAAAAAAAAAABndlaWdodAAAAAAABA==",
        "AAAAAQAAAAAAAAAAAAAADENvbW1pdHRlZVJlZgAAAAQAAAAAAAAADGNvbW1pdHRlZV9pZAAAAAYAAAAAAAAADmRpc3B1dGVfd2luZG93AAAAAAAGAAAAAAAAABJtYXhfcm90YXRpb25fZGVsdGEAAAAAAAQAAAAAAAAACW1pbl9lcG9jaAAAAAAAAAQ=",
        "AAAAAQAAAAAAAAAAAAAADEh5YnJpZENvbmZpZwAAAAMAAAAAAAAACGZhbGxiYWNrAAAH0AAAAAxTaWduZXJDb25maWcAAAAAAAAADmZhbGxiYWNrX2FmdGVyAAAAAAAGAAAAAAAAAAVwcmljZQAAAAAAB9AAAAALUHJpY2VDb25maWcA",
        "AAAAAQAAAAAAAAAAAAAADFNpZ25lckNvbmZpZwAAAAMAAAAAAAAADmRpc3B1dGVfd2luZG93AAAAAAAGAAAAAAAAAAdzaWduZXJzAAAAA+oAAAATAAAAAAAAAAl0aHJlc2hvbGQAAAAAAAAE",
        "AAAAAgAAAAAAAAAAAAAADlByaWNlRGlyZWN0aW9uAAAAAAAEAAAAAAAAAAAAAAAFQWJvdmUAAAAAAAAAAAAAAAAAAAlBdE9yQWJvdmUAAAAAAAAAAAAAAAAAAAVCZWxvdwAAAAAAAAAAAAAAAAAACUF0T3JCZWxvdwAAAA==",
        "AAAAAgAAAAAAAAAAAAAADlJlc29sdXRpb25TcGVjAAAAAAAGAAAAAQAAAAAAAAAFUHJpY2UAAAAAAAABAAAH0AAAAAtQcmljZUNvbmZpZwAAAAABAAAAAAAAAAdTaWduZXJzAAAAAAEAAAfQAAAADFNpZ25lckNvbmZpZwAAAAEAAAAAAAAADFdlaWdodGVkS2V5cwAAAAEAAAfQAAAAEVdlaWdodGVkS2V5Q29uZmlnAAAAAAAAAQAAAAAAAAARU2lnbmVyc0Rpc3B1dGFibGUAAAAAAAABAAAH0AAAABZEaXNwdXRhYmxlU2lnbmVyQ29uZmlnAAAAAAABAAAAAAAAAAlDb21taXR0ZWUAAAAAAAABAAAH0AAAAAxDb21taXR0ZWVSZWYAAAABAAAAAAAAAAZIeWJyaWQAAAAAAAEAAAfQAAAADEh5YnJpZENvbmZpZw==",
        "AAAAAQAAAAAAAAAAAAAAEFJlc29sdXRpb25TcGVjVjIAAAAFAAAAAAAAAAttYXJrZXRfY29yZQAAAAATAAAAAAAAAApuZXR3b3JrX2lkAAAAAAPuAAAAIAAAAAAAAAAEcnVsZQAAB9AAAAAOUmVzb2x1dGlvblNwZWMAAAAAAAAAAAAEc2FsdAAAA+4AAAAgAAAAAAAAAAd2ZXJzaW9uAAAAAAQ=",
        "AAAAAQAAAAAAAAAAAAAAEVdlaWdodGVkS2V5Q29uZmlnAAAAAAAAAwAAAAAAAAAOZGlzcHV0ZV93aW5kb3cAAAAAAAYAAAAAAAAAB3NpZ25lcnMAAAAD6gAAB9AAAAALV2VpZ2h0ZWRLZXkAAAAAAAAAABB3ZWlnaHRfdGhyZXNob2xkAAAABA==",
        "AAAAAQAAAAAAAAAAAAAAFkRpc3B1dGFibGVTaWduZXJDb25maWcAAAAAAAYAAAAAAAAADGRpc3B1dGVfYm9uZAAAAAsAAAAAAAAADmRpc3B1dGVfd2luZG93AAAAAAAGAAAAAAAAAAplc2NhbGF0aW9uAAAAAAfQAAAACkVzY2FsYXRpb24AAAAAAAAAAAASZXNjYWxhdGlvbl90aW1lb3V0AAAAAAAGAAAAAAAAAAdzaWduZXJzAAAAA+oAAAATAAAAAAAAAAl0aHJlc2hvbGQAAAAAAAAE",
        "AAAAAgAAAAAAAAAAAAAABE1vZGUAAAADAAAAAAAAAAAAAAAGTm9ybWFsAAAAAAAAAAAAAAAAAAlVbndpbmRpbmcAAAAAAAAAAAAAAAAAAAZQYXVzZWQAAA==",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAQgAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAEAAAAAAAAADFVuYXV0aG9yaXplZAAAAAIAAAAAAAAADUludmFsaWRDb25maWcAAAAAAAADAAAAAAAAAA1JbnZhbGlkQW1vdW50AAAAAAAABAAAAAAAAAAQVHJhZGVDYXBFeGNlZWRlZAAAAAUAAAAAAAAAEU1hcmtldENhcEV4Y2VlZGVkAAAAAAAABgAAAAAAAAAQRGFpbHlDYXBFeGNlZWRlZAAAAAcAAAAAAAAADU1hcmtldE5vdE9wZW4AAAAAAAAIAAAAAAAAABNJbnN1ZmZpY2llbnRCYWxhbmNlAAAAAAkAAAAAAAAABlBhdXNlZAAAAAAACgAAAAAAAAALTm9TdWNjZXNzb3IAAAAACwAAAAAAAAATTmV0RXhwb3N1cmVFeGNlZWRlZAAAAAAMAAAAAAAAABVBZ2VudERhaWx5Q2FwRXhjZWVkZWQAAAAAAAANAAAAAAAAAA9Qcm9wb3NhbFBlbmRpbmcAAAAADgAAAAAAAAAOVGltZWxvY2tBY3RpdmUAAAAAAA8AAAAAAAAAD05vUGVuZGluZ0NvbmZpZwAAAAAQAAAAAAAAABFMZWdhY3lDb3JlVW5rbm93bgAAAAAAABEAAAAAAAAAElRvb01hbnlPcGVuTWFya2V0cwAAAAAAEgAAAAAAAAAPQ2FwaXRhbFJlc2VydmVkAAAAABMAAAAAAAAAD0RlcG9zaXRUb29TbWFsbAAAAAAUAAAAAAAAABJJbnN1ZmZpY2llbnRTaGFyZXMAAAAAABUAAAAAAAAADlRpY2tldE5vdEZvdW5kAAAAAAAWAAAAAAAAAAxOb3RoaW5nVG9QYXkAAAAXAAAAAAAAAA5QcmljZU91dE9mQmFuZAAAAAAAGAAAAAAAAAATUHJpY2VJbXBhY3RFeGNlZWRlZAAAAAAZAAAAAAAAABJJbnZhbGlkUHJpY2VQb2xpY3kAAAAAABoAAAAAAAAAEFNsaXBwYWdlRXhjZWVkZWQAAAAbAAAAAAAAAAlOb3RQYXVzZWQAAAAAAAAcAAAAAAAAABhNYXJrZXRDb3JlTWFya2V0Tm90Rm91bmQAAAAdAAAAAAAAABJNYXJrZXRDb3JlTm90RmluYWwAAAAAAB4AAAAAAAAAF01hcmtldENvcmVNYXJrZXROb3RPcGVuAAAAAB8AAAAAAAAAFk1hcmtldENvcmVNYXJrZXRDbG9zZWQAAAAAACAAAAAAAAAAH01hcmtldENvcmVJbnN1ZmZpY2llbnRMaXF1aWRpdHkAAAAAIQAAAAAAAAAcTWFya2V0Q29yZUluc3VmZmljaWVudFNoYXJlcwAAACIAAAAAAAAAGE1hcmtldENvcmVBbHJlYWR5Q2xhaW1lZAAAACMAAAAAAAAAGU1hcmtldENvcmVOb3RoaW5nVG9SZWRlZW0AAAAAAAAkAAAAAAAAABdNYXJrZXRDb3JlSW52YWxpZEFtb3VudAAAAAAlAAAAAAAAABJNYXJrZXRDb3JlT3ZlcmZsb3cAAAAAACYAAAAAAAAAGk1hcmtldENvcmVTbGlwcGFnZUV4Y2VlZGVkAAAAAAAnAAAAAAAAABRNYXJrZXRDb3JlQ2FsbEZhaWxlZAAAACgAAAAAAAAADk1hcmtldE5vdEZpbmFsAAAAAAAsAAAAAAAAAA9NYXJrZXRDb3JlRXJyb3IAAAAALQAAAAAAAAAPRHJhd2Rvd25UcmlwcGVkAAAAAC4AAAAAAAAAFUludmFsaWREcmF3ZG93bkNvbmZpZwAAAAAAAC8AAAAAAAAAD05vdEFja25vd2xlZGdlZAAAAAAwAAAAAAAAAA9TZWVkQ2FwRXhjZWVkZWQAAAAAMQAAAAAAAAAUQ3JlYXRpb25SYXRlRXhjZWVkZWQAAAAyAAAAAAAAABBDbG9zZVRpbWVUb29Tb29uAAAAMwAAAAAAAAAPQ2xvc2VUaW1lVG9vRmFyAAAAADQAAAAAAAAAEkNhdGVnb3J5Tm90QWxsb3dlZAAAAAAANQAAAAAAAAAPUG9saWN5TG9vc2VuaW5nAAAAADYAAAAAAAAADVlpZWxkRGlzYWJsZWQAAAAAAAA3AAAAAAAAABBZaWVsZENhcEV4Y2VlZGVkAAAAOAAAAAAAAAATWWllbGRXaXRoZHJhd0ZhaWxlZAAAAAA5AAAAAAAAABFWZW51ZUhhc1ByaW5jaXBhbAAAAAAAADoAAAAAAAAAE0NhdGVnb3J5Q2FwRXhjZWVkZWQAAAAAOwAAAAAAAAARQnVja2V0Q2FwRXhjZWVkZWQAAAAAAAA8AAAAAAAAAA5Ob1BlbmRpbmdBZG1pbgAAAAAAPQAAAAAAAAATUGVuZGluZ0FkbWluRXhwaXJlZAAAAAA+AAAAAAAAABFJbnZhbGlkUmVzb2x1dGlvbgAAAAAAAD8AAAAAAAAACk9wTm90UmVhZHkAAAAAAEAAAAAAAAAACU9wRXhwaXJlZAAAAAAAAEEAAAAAAAAAC05vUGVuZGluZ09wAAAAAEIAAAAAAAAADkJlbG93RXhpdEZsb29yAAAAAABDAAAAAAAAABBJbnZhbGlkRXhpdEZsb29yAAAARAAAAAAAAAAUQ29sbGF0ZXJhbE5vdEFsbG93ZWQAAABF",
        "AAAAAAAAAAAAAAADbmF2AAAAAAAAAAABAAAD6QAAAAsAAAAD",
        "AAAAAAAAAAAAAAAEbW9kZQAAAAAAAAABAAAH0AAAAARNb2Rl",
        "AAAAAgAAAAAAAAAAAAAAB0FkbWluT3AAAAAACAAAAAEAAAAAAAAADVNldFlpZWxkVmVudWUAAAAAAAACAAAAEwAAAAsAAAABAAAAAAAAAA9BbGxvY2F0ZVRvWWllbGQAAAAAAQAAAAsAAAABAAAAAAAAAAxTZXRTdWNjZXNzb3IAAAABAAAAEwAAAAEAAAAAAAAADk1pZ3JhdGVNYXJrZXRzAAAAAAABAAAD6gAAAAYAAAABAAAAAAAAABFTZXREcmF3ZG93bkNvbmZpZwAAAAAAAAIAAAALAAAABAAAAAAAAAAAAAAADlJlc2V0UG5sV2luZG93AAAAAAABAAAAAAAAABFTZXRDcmVhdGlvblBvbGljeQAAAAAAAAEAAAfQAAAADkNyZWF0aW9uUG9saWN5AAAAAAABAAAAAAAAABJTZXRDb3JyZWxhdGlvbkNhcHMAAAAAAAEAAAfQAAAAD0NvcnJlbGF0aW9uQ2FwcwA=",
        "AAAAAQAAAAAAAAAAAAAACFJlYWxpemVkAAAAAwAAAAAAAAALbHBfcHJvY2VlZHMAAAAACwAAAAAAAAARcG9zaXRpb25fcHJvY2VlZHMAAAAAAAALAAAAAAAAAAdzZXR0bGVkAAAAAAE=",
        "AAAAAAAAAAAAAAAGcmVkZWVtAAAAAAACAAAAAAAAAAVhZ2VudAAAAAAAABMAAAAAAAAACW1hcmtldF9pZAAAAAAAAAYAAAABAAAD6QAAAAsAAAAD",
        "AAAAAQAAAAAAAAAAAAAACU1hcmtldFBubAAAAAAAAAMAAAAAAAAABGNvc3QAAAALAAAAAAAAAAhwcm9jZWVkcwAAAAsAAAAAAAAACHJlYWxpemVkAAAAAQ==",
        "AAAAAQAAAAAAAAAAAAAACVRva2VuQ2FwcwAAAAAAAAMAAAAAAAAACW1heF9kYWlseQAAAAAAAAsAAAAAAAAACm1heF9tYXJrZXQAAAAAAAsAAAAAAAAACW1heF90cmFkZQAAAAAAAAs=",
        "AAAAAQAAAAAAAAAAAAAACVZhbHVhdGlvbgAAAAAAAAQAAAAAAAAAB2F0X3Jpc2sAAAAACwAAAAAAAAAKY29zdF9iYXNpcwAAAAAACwAAAAAAAAALZmxvb3JfdmFsdWUAAAAACwAAAAAAAAAKc3BvdF92YWx1ZQAAAAAACw==",
        "AAAAAAAAAAAAAAAHZGVwb3NpdAAAAAACAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAQAAA+kAAAALAAAAAw==",
        "AAAAAAAAAAAAAAAHcmVhbGl6ZQAAAAABAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAGAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAHdW53b3VuZAAAAAABAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAGAAAAAQAAAAs=",
        "AAAABQAAAAAAAAAAAAAACURlcG9zaXRlZAAAAAAAAAEAAAAJZGVwb3NpdGVkAAAAAAAABAAAAAAAAAAFb3duZXIAAAAAAAATAAAAAQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAAAAAAGc2hhcmVzAAAAAAALAAAAAAAAAAAAAAADbmF2AAAAAAsAAAAAAAAAAg==",
        "AAAAAQAAAAAAAAAAAAAACkRhaWx5VXNhZ2UAAAAAAAIAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAJZGF5X3N0YXJ0AAAAAAAABg==",
        "AAAAAQAAAAAAAAAAAAAACk9wZW5NYXJrZXQAAAAAAAIAAAAAAAAABGNvcmUAAAATAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAG",
        "AAAAAQAAAAAAAAAAAAAAClJpc2tDb25maWcAAAAAAAYAAAAAAAAABWFnZW50AAAAAAAAEwAAAAAAAAAKY29sbGF0ZXJhbAAAAAAAEwAAAAAAAAALbWFya2V0X2NvcmUAAAAAEwAAAAAAAAAJbWF4X2RhaWx5AAAAAAAACwAAAAAAAAAKbWF4X21hcmtldAAAAAAACwAAAAAAAAAJbWF4X3RyYWRlAAAAAAAACw==",
        "AAAAAAAAAAAAAAAIYWdlbnRfYXQAAAABAAAAAAAAAAFpAAAAAAAABAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAAAAAAAAIcmVhbGl6ZWQAAAABAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAGAAAAAQAAB9AAAAAIUmVhbGl6ZWQ=",
        "AAAAAAAAAAAAAAAIc2V0X21vZGUAAAABAAAAAAAAAARtb2RlAAAH0AAAAARNb2RlAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAIdW53aW5kZXIAAAAAAAAAAQAAA+gAAAAT",
        "AAAABQAAAAAAAAAAAAAAClVud2luZFNlbGwAAAAAAAEAAAALdW53aW5kX3NlbGwAAAAABQAAAAAAAAAJbWFya2V0X2lkAAAAAAAABgAAAAEAAAAAAAAAB291dGNvbWUAAAAH0AAAAAdPdXRjb21lAAAAAAAAAAAAAAAADmNvbGxhdGVyYWxfb3V0AAAAAAALAAAAAAAAAAAAAAAJc2hhcmVzX2luAAAAAAAACwAAAAAAAAAAAAAACXByaWNlX2JwcwAAAAAAAAQAAAAAAAAAAg==",
        "AAAAAQAAAAAAAAAAAAAAC0FnZW50UG9saWN5AAAAAAQAAAAAAAAABmFjdGl2ZQAAAAAAAQAAAAAAAAAJbWF4X2RhaWx5AAAAAAAACwAAAAAAAAAJbWF4X3RyYWRlAAAAAAAACwAAAAAAAAAFcm9sZXMAAAAAAAAE",
        "AAAAAQAAAAAAAAAAAAAAC05ldFBvc2l0aW9uAAAAAAIAAAAAAAAADWNvbGxhdGVyYWxfaW4AAAAAAAALAAAAAAAAAA5jb2xsYXRlcmFsX291dAAAAAAACw==",
        "AAAAAQAAAAAAAAAAAAAAC1ByaWNlUG9saWN5AAAAAAQAAAAAAAAAEW1heF9idXlfcHJpY2VfYnBzAAAAAAAABAAAAAAAAAAObWF4X2ltcGFjdF9icHMAAAAAAAQAAAAAAAAAEG1heF9zbGlwcGFnZV9icHMAAAAEAAAAAAAAABJtaW5fc2VsbF9wcmljZV9icHMAAAAAAAQ=",
        "AAAAAQAAAAAAAAAAAAAAC1VzYWdlV2luZG93AAAAAAMAAAAAAAAAB2Ftb3VudHMAAAAD6gAAAAsAAAAAAAAACWhlYWRfaG91cgAAAAAAAAYAAAAAAAAACGhlYWRfaWR4AAAABA==",
        "AAAAAAAAAAAAAAAJYWdlbnRfYnV5AAAAAAAABQAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAGAAAAAAAAAAdvdXRjb21lAAAAB9AAAAAHT3V0Y29tZQAAAAAAAAAADWNvbGxhdGVyYWxfaW4AAAAAAAALAAAAAAAAAA5taW5fc2hhcmVzX291dAAAAAAACwAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAAAAAAAJY2FuY2VsX29wAAAAAAAAAQAAAAAAAAAEa2luZAAAAAQAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAJZ2V0X2FnZW50AAAAAAAAAQAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAQAAA+gAAAfQAAAAC0FnZW50UG9saWN5AA==",
        "AAAAAAAAAAAAAAAJc2V0X2FnZW50AAAAAAAAAgAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAAAAAAZwb2xpY3kAAAAAB9AAAAALQWdlbnRQb2xpY3kAAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAJc2hhcmVzX29mAAAAAAAAAQAAAAAAAAAFb3duZXIAAAAAAAATAAAAAQAAAAs=",
        "AAAABQAAAAAAAAAAAAAAC01vZGVDaGFuZ2VkAAAAAAEAAAAMbW9kZV9jaGFuZ2VkAAAAAgAAAAAAAAADb2xkAAAAB9AAAAAETW9kZQAAAAAAAAAAAAAAA25ldwAAAAfQAAAABE1vZGUAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAC1BubFJlYWxpemVkAAAAAAEAAAAMcG5sX3JlYWxpemVkAAAABAAAAAAAAAAJbWFya2V0X2lkAAAAAAAABgAAAAEAAAAAAAAABGNvc3QAAAALAAAAAAAAAAAAAAAIcHJvY2VlZHMAAAALAAAAAAAAAAAAAAADcG5sAAAAAAsAAAAAAAAAAg==",
        "AAAAAQAAAAAAAAAAAAAADEdsb2JhbENvbmZpZwAAAAYAAAAAAAAACmNvbGxhdGVyYWwAAAAAABMAAAAAAAAAC21hcmtldF9jb3JlAAAAABMAAAAAAAAACW1heF9kYWlseQAAAAAAAAsAAAAAAAAACm1heF9tYXJrZXQAAAAAAAsAAAAAAAAAEG1heF9uZXRfZXhwb3N1cmUAAAALAAAAAAAAAAltYXhfdHJhZGUAAAAAAAAL",
        "AAAAAQAAAAAAAAAAAAAADFBlbmRpbmdBZ2VudAAAAAMAAAAAAAAADWV4ZWN1dGFibGVfYXQAAAAAAAAGAAAAAAAAAAZwb2xpY3kAAAAAB9AAAAALQWdlbnRQb2xpY3kAAAAAAAAAAAtwcm9wb3NlZF9hdAAAAAAG",
        "AAAAAAAAAAAAAAAKYWdlbnRfc2VsbAAAAAAABQAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAGAAAAAAAAAAdvdXRjb21lAAAAB9AAAAAHT3V0Y29tZQAAAAAAAAAADmNvbGxhdGVyYWxfb3V0AAAAAAALAAAAAAAAAA1tYXhfc2hhcmVzX2luAAAAAAAACwAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAAAAAAAKZXhlY3V0ZV9vcAAAAAAAAQAAAAAAAAAEa2luZAAAAAQAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAKZXhpdF9mbG9vcgAAAAAAAQAAAAAAAAAJbWFya2V0X2lkAAAAAAAABgAAAAEAAAAE",
        "AAAAAAAAAAAAAAAKZ2V0X2NvbmZpZwAAAAAAAAAAAAEAAAPpAAAH0AAAAApSaXNrQ29uZmlnAAAAAAAD",
        "AAAAAAAAAAAAAAAKZ2V0X2dsb2JhbAAAAAAAAAAAAAEAAAPpAAAH0AAAAAxHbG9iYWxDb25maWcAAAAD",
        "AAAAAAAAAAAAAAAKbWFya2V0X3BubAAAAAAAAQAAAAAAAAAJbWFya2V0X2lkAAAAAAAABgAAAAEAAAfQAAAACU1hcmtldFBubAAAAA==",
        "AAAAAAAAAAAAAAAKcGVuZGluZ19vcAAAAAAAAQAAAAAAAAAEa2luZAAAAAQAAAABAAAD6AAAB9AAAAAOUGVuZGluZ0FkbWluT3AAAA==",
        "AAAAAAAAAAAAAAAKcHJvcG9zZV9vcAAAAAAAAQAAAAAAAAACb3AAAAAAB9AAAAAHQWRtaW5PcAAAAAABAAAD6QAAAAYAAAAD",
        "AAAAAAAAAAAAAAAKc2V0X3BhdXNlZAAAAAAAAQAAAAAAAAAGcGF1c2VkAAAAAAABAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAKdG9rZW5fY2FwcwAAAAAAAQAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAA+kAAAfQAAAACVRva2VuQ2FwcwAAAAAAAAM=",
        "AAAAAAAAAAAAAAAKd2luZG93X3BubAAAAAAAAAAAAAEAAAPpAAAACwAAAAM=",
        "AAAABQAAAAAAAAAAAAAADEFnZW50UmVtb3ZlZAAAAAEAAAANYWdlbnRfcmVtb3ZlZAAAAAAAAAEAAAAAAAAABWFnZW50AAAAAAAAEwAAAAEAAAAC",
        "AAAABQAAAAAAAAAAAAAADEV4aXRGbG9vclNldAAAAAEAAAAOZXhpdF9mbG9vcl9zZXQAAAAAAAMAAAAAAAAACW1hcmtldF9pZAAAAAAAAAYAAAABAAAAAAAAAAlwcmljZV9icHMAAAAAAAAEAAAAAAAAAAAAAAAKaXNfZGVmYXVsdAAAAAAAAQAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADFN1Y2Nlc3NvclNldAAAAAEAAAANc3VjY2Vzc29yX3NldAAAAAAAAAIAAAAAAAAAA29sZAAAAAPoAAAAEwAAAAAAAAAAAAAAA25ldwAAAAATAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADFdpdGhkcmF3UGFpZAAAAAEAAAANd2l0aGRyYXdfcGFpZAAAAAAAAAIAAAAAAAAACXRpY2tldF9pZAAAAAAAAAYAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAg==",
        "AAAAAQAAAAAAAAAAAAAADVBlbmRpbmdDb25maWcAAAAAAAADAAAAAAAAAAZjb25maWcAAAAAB9AAAAAMR2xvYmFsQ29uZmlnAAAAAAAAAA1leGVjdXRhYmxlX2F0AAAAAAAABgAAAAAAAAALcHJvcG9zZWRfYXQAAAAABg==",
        "AAAAAAAAAAAAAAALYWdlbnRfY291bnQAAAAAAAAAAAEAAAAE",
        "AAAAAAAAAAAAAAALY2xvc2VfdHJhZGUAAAAAAgAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAGAAAAAQAAA+kAAAALAAAAAw==",
        "AAAAAAAAAAAAAAALZGFpbHlfdXNhZ2UAAAAAAAAAAAEAAAPpAAAH0AAAAApEYWlseVVzYWdlAAAAAAAD",
        "AAAAAAAAAAAAAAALZ2V0X25ldF9jYXAAAAAAAAAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAAAAAAALcmVkZWVtX21hbnkAAAAAAgAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAAAAAAptYXJrZXRfaWRzAAAAAAPqAAAABgAAAAEAAAPpAAAH0AAAAAtCYXRjaFJlc3VsdAAAAAAD",
        "AAAABQAAAAAAAAAAAAAADURyYXdkb3duUGF1c2UAAAAAAAABAAAADmRyYXdkb3duX3BhdXNlAAAAAAADAAAAAAAAAA1yZWFsaXplZF9sb3NzAAAAAAAACwAAAAAAAAAAAAAAEHdpbmRvd19zdGFydF9kYXkAAAAGAAAAAAAAAAAAAAATdHJpZ2dlcmVkX2J5X21hcmtldAAAAAAGAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADUZlZXNDb2xsZWN0ZWQAAAAAAAABAAAADmZlZXNfY29sbGVjdGVkAAAAAAACAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAGAAAAAQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADU1hcmtldFNldHRsZWQAAAAAAAABAAAADm1hcmtldF9zZXR0bGVkAAAAAAAEAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAGAAAAAQAAAAAAAAAIcmVkZWVtZWQAAAALAAAAAAAAAAAAAAAKbHBfY2xhaW1lZAAAAAAACwAAAAAAAAAAAAAACnNldHRsZWRfYnkAAAAAABMAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADVlpZWxkUmVjYWxsZWQAAAAAAAABAAAADnlpZWxkX3JlY2FsbGVkAAAAAAAEAAAAAAAAAARwb29sAAAAEwAAAAAAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAAAAAACXByaW5jaXBhbAAAAAAAAAsAAAAAAAAAAAAAAAZyZWFzb24AAAAAABEAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADVlpZWxkVmVudWVTZXQAAAAAAAABAAAAD3lpZWxkX3ZlbnVlX3NldAAAAAACAAAAAAAAAARwb29sAAAAEwAAAAAAAAAAAAAADm1heF9hbGxvY2F0aW9uAAAAAAALAAAAAAAAAAI=",
        "AAAAAQAAAAAAAAAAAAAADkNyZWF0aW9uUG9saWN5AAAAAAAGAAAAAAAAABJhbGxvd2VkX2NhdGVnb3JpZXMAAAAAAAQAAAAAAAAAFGNyZWF0aW9uX3dpbmRvd19zZWNzAAAABgAAAAAAAAARbWF4X2Nsb3NlX2hvcml6b24AAAAAAAAGAAAAAAAAABZtYXhfbWFya2V0c19wZXJfd2luZG93AAAAAAAEAAAAAAAAAAhtYXhfc2VlZAAAAAsAAAAAAAAAEW1pbl9jbG9zZV9ob3Jpem9uAAAAAAAABg==",
        "AAAAAQAAAAAAAAAAAAAADkRyYXdkb3duU3RhdHVzAAAAAAADAAAAAAAAAAxtYXhfZHJhd2Rvd24AAAALAAAAAAAAAAd0cmlwcGVkAAAAAAEAAAAAAAAACndpbmRvd19wbmwAAAAAAAs=",
        "AAAAAQAAAAAAAAAAAAAADlBlbmRpbmdBZG1pbk9wAAAAAAAEAAAAAAAAAA1leGVjdXRhYmxlX2F0AAAAAAAABgAAAAAAAAAKZXhwaXJlc19hdAAAAAAABgAAAAAAAAACb3AAAAAAB9AAAAAHQWRtaW5PcAAAAAAAAAAAC3Byb3Bvc2VkX2F0AAAAAAY=",
        "AAAAAQAAAAAAAAAAAAAADldpdGhkcmF3VGlja2V0AAAAAAADAAAAAAAAAApjcmVhdGVkX2F0AAAAAAAGAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAACXJlbWFpbmluZwAAAAAAAAs=",
        "AAAAAAAAAAAAAAAMYWdlbnRfYnV5X3YyAAAABwAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAGAAAAAAAAAAdvdXRjb21lAAAAB9AAAAAHT3V0Y29tZQAAAAAAAAAADWNvbGxhdGVyYWxfaW4AAAAAAAALAAAAAAAAAA5taW5fc2hhcmVzX291dAAAAAAACwAAAAAAAAAPbGltaXRfcHJpY2VfYnBzAAAAAAQAAAAAAAAACGRlYWRsaW5lAAAABgAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAAAAAAAMY2FuY2VsX2FnZW50AAAAAQAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAMY29uZmlnX2RlbGF5AAAAAAAAAAEAAAAG",
        "AAAAAAAAAAAAAAAMbmV0X2V4cG9zdXJlAAAAAAAAAAEAAAAL",
        "AAAAAAAAAAAAAAAMbmV0X3Bvc2l0aW9uAAAAAQAAAAAAAAAJbWFya2V0X2lkAAAAAAAABgAAAAEAAAPpAAAH0AAAAAtOZXRQb3NpdGlvbgAAAAAD",
        "AAAAAAAAAAAAAAAMcXVldWVfYm91bmRzAAAAAAAAAAEAAAPtAAAAAgAAAAYAAAAG",
        "AAAAAAAAAAAAAAAMcmVtb3ZlX2FnZW50AAAAAQAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAMc2V0X3Vud2luZGVyAAAAAQAAAAAAAAAIdW53aW5kZXIAAAPoAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAMdG90YWxfc2hhcmVzAAAAAAAAAAEAAAAL",
        "AAAABQAAAAAAAAAAAAAADkFnZW50UG9saWN5U2V0AAAAAAABAAAAEGFnZW50X3BvbGljeV9zZXQAAAAEAAAAAAAAAAVhZ2VudAAAAAAAABMAAAABAAAAAAAAAAVyb2xlcwAAAAAAAAQAAAAAAAAAAAAAAAltYXhfdHJhZGUAAAAAAAALAAAAAAAAAAAAAAAJbWF4X2RhaWx5AAAAAAAACwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADkNvbmZpZ0RlbGF5U2V0AAAAAAABAAAAEGNvbmZpZ19kZWxheV9zZXQAAAACAAAAAAAAAANvbGQAAAAABgAAAAAAAAAAAAAAA25ldwAAAAAGAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADkNvbmZpZ0V4ZWN1dGVkAAAAAAABAAAAD2NvbmZpZ19leGVjdXRlZAAAAAADAAAAAAAAAANvbGQAAAAH0AAAAAxHbG9iYWxDb25maWcAAAAAAAAAAAAAAANuZXcAAAAH0AAAAAxHbG9iYWxDb25maWcAAAAAAAAAAAAAAAlpbW1lZGlhdGUAAAAAAAABAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADkNvbmZpZ1Byb3Bvc2VkAAAAAAABAAAAD2NvbmZpZ19wcm9wb3NlZAAAAAADAAAAAAAAAANvbGQAAAAH0AAAAAxHbG9iYWxDb25maWcAAAAAAAAAAAAAAANuZXcAAAAH0AAAAAxHbG9iYWxDb25maWcAAAAAAAAAAAAAAA1leGVjdXRhYmxlX2F0AAAAAAAABgAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADk1hcmtldE1pZ3JhdGVkAAAAAAABAAAAD21hcmtldF9taWdyYXRlZAAAAAAFAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAGAAAAAQAAAAAAAAAJc3VjY2Vzc29yAAAAAAAAEwAAAAEAAAAAAAAAA3llcwAAAAALAAAAAAAAAAAAAAACbm8AAAAAAAsAAAAAAAAAAAAAAAJscAAAAAAAAQAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADlBubFdpbmRvd1Jlc2V0AAAAAAABAAAAEHBubF93aW5kb3dfcmVzZXQAAAABAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADlBvc2l0aW9uQ2xvc2VkAAAAAAABAAAAD3Bvc2l0aW9uX2Nsb3NlZAAAAAACAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAGAAAAAQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADlByaWNlUG9saWN5U2V0AAAAAAABAAAAEHByaWNlX3BvbGljeV9zZXQAAAADAAAAAAAAAANvbGQAAAAH0AAAAAtQcmljZVBvbGljeQAAAAAAAAAAAAAAAANuZXcAAAAH0AAAAAtQcmljZVBvbGljeQAAAAAAAAAAAAAAAAlpbW1lZGlhdGUAAAAAAAABAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADlRva2VuRGVwb3NpdGVkAAAAAAABAAAAD3Rva2VuX2RlcG9zaXRlZAAAAAADAAAAAAAAAAVvd25lcgAAAAAAABMAAAABAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAADllpZWxkQWxsb2NhdGVkAAAAAAABAAAAD3lpZWxkX2FsbG9jYXRlZAAAAAADAAAAAAAAAARwb29sAAAAEwAAAAAAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAAAAAACXByaW5jaXBhbAAAAAAAAAsAAAAAAAAAAg==",
        "AAAAAQAAAAAAAAAAAAAAD0NvcnJlbGF0aW9uQ2FwcwAAAAADAAAAAAAAAAtidWNrZXRfc2VjcwAAAAAGAAAAAAAAAA5tYXhfcGVyX2J1Y2tldAAAAAAACwAAAAAAAAAQbWF4X3Blcl9jYXRlZ29yeQAAA+oAAAAL",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAwAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAAAAAApjb2xsYXRlcmFsAAAAAAATAAAAAAAAAAttYXJrZXRfY29yZQAAAAATAAAAAAAAAAltYXhfdHJhZGUAAAAAAAALAAAAAAAAAAptYXhfbWFya2V0AAAAAAALAAAAAAAAAAltYXhfZGFpbHkAAAAAAAALAAAAAAAAABBtYXhfbmV0X2V4cG9zdXJlAAAACwAAAAAAAAAMY29uZmlnX2RlbGF5AAAABgAAAAAAAAAMbWF4X2RyYXdkb3duAAAACwAAAAAAAAALd2luZG93X2RheXMAAAAABAAAAAAAAAAPY3JlYXRpb25fcG9saWN5AAAAB9AAAAAOQ3JlYXRpb25Qb2xpY3kAAAAAAAA=",
        "AAAAAAAAAAAAAAANYWdlbnRfc2VsbF92MgAAAAAAAAcAAAAAAAAABWFnZW50AAAAAAAAEwAAAAAAAAAJbWFya2V0X2lkAAAAAAAABgAAAAAAAAAHb3V0Y29tZQAAAAfQAAAAB091dGNvbWUAAAAAAAAAAA5jb2xsYXRlcmFsX291dAAAAAAACwAAAAAAAAANbWF4X3NoYXJlc19pbgAAAAAAAAsAAAAAAAAAD2xpbWl0X3ByaWNlX2JwcwAAAAAEAAAAAAAAAAhkZWFkbGluZQAAAAYAAAABAAAD6QAAAAsAAAAD",
        "AAAAAAAAAAAAAAANY2FuY2VsX2NvbmZpZwAAAAAAAAAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAANZGVwb3NpdF90b2tlbgAAAAAAAAMAAAAAAAAABGZyb20AAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAAAAAAANZGlzYWJsZV95aWVsZAAAAAAAAAAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAANZXhlY3V0ZV9hZ2VudAAAAAAAAAEAAAAAAAAABWFnZW50AAAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAANbGVnYWN5X3JlZGVlbQAAAAAAAAMAAAAAAAAABWFnZW50AAAAAAAAEwAAAAAAAAAEY29yZQAAABMAAAAAAAAACW1hcmtldF9pZAAAAAAAAAYAAAABAAAD6QAAAAsAAAAD",
        "AAAAAAAAAAAAAAANcGVuZGluZ19hZ2VudAAAAAAAAAEAAAAAAAAABWFnZW50AAAAAAAAEwAAAAEAAAPoAAAH0AAAAAxQZW5kaW5nQWdlbnQ=",
        "AAAAAAAAAAAAAAANc2V0X3N1Y2Nlc3NvcgAAAAAAAAEAAAAAAAAACXN1Y2Nlc3NvcgAAAAAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAANc2V0dGxlX21hcmtldAAAAAAAAAIAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAJbWFya2V0X2lkAAAAAAAABgAAAAEAAAPpAAAH0AAAABBTZXR0bGVtZW50UmVwb3J0AAAAAw==",
        "AAAABQAAAAAAAAAAAAAAD0FkbWluT3BFeGVjdXRlZAAAAAABAAAAEWFkbWluX29wX2V4ZWN1dGVkAAAAAAAAAgAAAAAAAAAEa2luZAAAAAQAAAAAAAAAAAAAAAJvcAAAAAAH0AAAAAdBZG1pbk9wAAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAD0FkbWluT3BQcm9wb3NlZAAAAAABAAAAEWFkbWluX29wX3Byb3Bvc2VkAAAAAAAAAwAAAAAAAAAEa2luZAAAAAQAAAAAAAAAAAAAAAJvcAAAAAAH0AAAAAdBZG1pbk9wAAAAAAAAAAAAAAAADWV4ZWN1dGFibGVfYXQAAAAAAAAGAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAD0NvbmZpZ0NhbmNlbGxlZAAAAAABAAAAEGNvbmZpZ19jYW5jZWxsZWQAAAABAAAAAAAAAAZjb25maWcAAAAAB9AAAAAMR2xvYmFsQ29uZmlnAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAD1RyYWRlQXV0aG9yaXplZAAAAAABAAAAEHRyYWRlX2F1dGhvcml6ZWQAAAAFAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAGAAAAAQAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAAAAAAMbWFya2V0X3RvdGFsAAAACwAAAAAAAAAAAAAAC2RhaWx5X3RvdGFsAAAAAAsAAAAAAAAAAg==",
        "AAAAAQAAAAAAAAAAAAAAEENhcGl0YWxCcmVha2Rvd24AAAADAAAAAAAAAAZsaXF1aWQAAAAAAAsAAAAAAAAAD3lpZWxkX3ByaW5jaXBhbAAAAAALAAAAAAAAAAt5aWVsZF92YWx1ZQAAAAAL",
        "AAAAAQAAAAAAAAAAAAAAEFNldHRsZW1lbnRSZXBvcnQAAAADAAAAAAAAAA9hbHJlYWR5X3NldHRsZWQAAAAAAQAAAAAAAAAKbHBfY2xhaW1lZAAAAAAACwAAAAAAAAAIcmVkZWVtZWQAAAAL",
        "AAAAAAAAAAAAAAAOY2xhaW1fd2l0aGRyYXcAAAAAAAEAAAAAAAAACXRpY2tldF9pZAAAAAAAAAYAAAABAAAD6QAAAAsAAAAD",
        "AAAAAAAAAAAAAAAOY3JlYXRpb25fdXNhZ2UAAAAAAAAAAAABAAAD6QAAAAQAAAAD",
        "AAAAAAAAAAAAAAAOZGFpbHlfaGVhZHJvb20AAAAAAAAAAAABAAAD6QAAAAsAAAAD",
        "AAAAAAAAAAAAAAAOZXhlY3V0ZV9jb25maWcAAAAAAAAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAObGlxdWlkX2NhcGl0YWwAAAAAAAAAAAABAAAD6QAAAAsAAAAD",
        "AAAAAAAAAAAAAAAOb3Blbl9tYXJrZXRfYXQAAAAAAAEAAAAAAAAAAWkAAAAAAAAEAAAAAQAAA+gAAAfQAAAACk9wZW5NYXJrZXQAAA==",
        "AAAAAAAAAAAAAAAOcGVuZGluZ19jb25maWcAAAAAAAAAAAABAAAD6AAAB9AAAAANUGVuZGluZ0NvbmZpZwAAAA==",
        "AAAAAAAAAAAAAAAOcHJvcG9zZV9jb25maWcAAAAAAAEAAAAAAAAABmNvbmZpZwAAAAAH0AAAAAxHbG9iYWxDb25maWcAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAOcXVldWVfcmVzZXJ2ZWQAAAAAAAAAAAABAAAACw==",
        "AAAAAAAAAAAAAAAOc2V0X2V4aXRfZmxvb3IAAAAAAAIAAAAAAAAACW1hcmtldF9pZAAAAAAAAAYAAAAAAAAACXByaWNlX2JwcwAAAAAAAAQAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAOc2V0X3Rva2VuX2NhcHMAAAAAAAIAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAEY2FwcwAAB9AAAAAJVG9rZW5DYXBzAAAAAAAAAQAAA+kAAAACAAAAAw==",
        "AAAABQAAAAAAAAAAAAAAEEFkbWluT3BDYW5jZWxsZWQAAAABAAAAEmFkbWluX29wX2NhbmNlbGxlZAAAAAAAAQAAAAAAAAAEa2luZAAAAAQAAAAAAAAAAg==",
        "AAAAAAAAAAAAAAAPYnVja2V0X2V4cG9zdXJlAAAAAAIAAAAAAAAABGNvcmUAAAATAAAAAAAAAAZidWNrZXQAAAAAAAYAAAABAAAACw==",
        "AAAAAAAAAAAAAAAPZHJhd2Rvd25fc3RhdHVzAAAAAAAAAAABAAAD6QAAB9AAAAAORHJhd2Rvd25TdGF0dXMAAAAAAAM=",
        "AAAAAAAAAAAAAAAPbWlncmF0ZV9tYXJrZXRzAAAAAAEAAAAAAAAACm1hcmtldF9pZHMAAAAAA+oAAAAGAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAPc2V0X3lpZWxkX3ZlbnVlAAAAAAIAAAAAAAAABHBvb2wAAAATAAAAAAAAAA5tYXhfYWxsb2NhdGlvbgAAAAAACwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAPd2l0aGRyYXdfdGlja2V0AAAAAAEAAAAAAAAACXRpY2tldF9pZAAAAAAAAAYAAAABAAAD6AAAB9AAAAAOV2l0aGRyYXdUaWNrZXQAAA==",
        "AAAABQAAAAAAAAAAAAAAEURyYXdkb3duQ29uZmlnU2V0AAAAAAAAAQAAABNkcmF3ZG93bl9jb25maWdfc2V0AAAAAAUAAAAAAAAAEG9sZF9tYXhfZHJhd2Rvd24AAAALAAAAAAAAAAAAAAAQbmV3X21heF9kcmF3ZG93bgAAAAsAAAAAAAAAAAAAAA9vbGRfd2luZG93X2RheXMAAAAABAAAAAAAAAAAAAAAD25ld193aW5kb3dfZGF5cwAAAAAEAAAAAAAAAAAAAAAJaW1tZWRpYXRlAAAAAAAAAQAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAEVdpdGhkcmF3UmVxdWVzdGVkAAAAAAAAAQAAABJ3aXRoZHJhd19yZXF1ZXN0ZWQAAAAAAAUAAAAAAAAABW93bmVyAAAAAAAAEwAAAAEAAAAAAAAABnNoYXJlcwAAAAAACwAAAAAAAAAAAAAABmFzc2V0cwAAAAAACwAAAAAAAAAAAAAACHBhaWRfbm93AAAACwAAAAAAAAAAAAAACXRpY2tldF9pZAAAAAAAAAYAAAAAAAAAAg==",
        "AAAAAQAAAAAAAAAAAAAAElBlbmRpbmdDb3JyZWxhdGlvbgAAAAAAAwAAAAAAAAAEY2FwcwAAB9AAAAAPQ29ycmVsYXRpb25DYXBzAAAAAAAAAAANZXhlY3V0YWJsZV9hdAAAAAAAAAYAAAAAAAAAC3Byb3Bvc2VkX2F0AAAAAAY=",
        "AAAAAQAAAAAAAAAAAAAAElBlbmRpbmdQcmljZVBvbGljeQAAAAAAAwAAAAAAAAANZXhlY3V0YWJsZV9hdAAAAAAAAAYAAAAAAAAABnBvbGljeQAAAAAH0AAAAAtQcmljZVBvbGljeQAAAAAAAAAAC3Byb3Bvc2VkX2F0AAAAAAY=",
        "AAAAAAAAAAAAAAAQY29ycmVsYXRpb25fY2FwcwAAAAAAAAABAAAD6QAAB9AAAAAPQ29ycmVsYXRpb25DYXBzAAAAAAM=",
        "AAAAAAAAAAAAAAAQZ2V0X3ByaWNlX3BvbGljeQAAAAAAAAABAAAH0AAAAAtQcmljZVBvbGljeQA=",
        "AAAAAAAAAAAAAAAQbWFya2V0X3ZhbHVhdGlvbgAAAAEAAAAAAAAACW1hcmtldF9pZAAAAAAAAAYAAAABAAAD6QAAB9AAAAAJVmFsdWF0aW9uAAAAAAAAAw==",
        "AAAAAAAAAAAAAAAQcmVxdWVzdF93aXRoZHJhdwAAAAIAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAAGc2hhcmVzAAAAAAALAAAAAQAAA+kAAAPtAAAAAgAAAAsAAAAGAAAAAw==",
        "AAAAAAAAAAAAAAAQcmVzZXRfcG5sX3dpbmRvdwAAAAAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAQc2V0X2NvbmZpZ19kZWxheQAAAAEAAAAAAAAACW5ld19kZWxheQAAAAAAAAYAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAQc2V0X3ByaWNlX3BvbGljeQAAAAEAAAAAAAAABnBvbGljeQAAAAAH0AAAAAtQcmljZVBvbGljeQAAAAABAAAD6QAAAAIAAAAD",
        "AAAABQAAAAAAAAAAAAAAEkVtZXJnZW5jeVdpdGhkcmF3bgAAAAAAAQAAABNlbWVyZ2VuY3lfd2l0aGRyYXduAAAAAAMAAAAAAAAABW93bmVyAAAAAAAAEwAAAAEAAAAAAAAABnNoYXJlcwAAAAAACwAAAAAAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAEk5ldEV4cG9zdXJlVXBkYXRlZAAAAAAAAQAAABRuZXRfZXhwb3N1cmVfdXBkYXRlZAAAAAMAAAAAAAAACW1hcmtldF9pZAAAAAAAAAYAAAABAAAAAAAAAApuZXRfbWFya2V0AAAAAAALAAAAAAAAAAAAAAAJbmV0X3RvdGFsAAAAAAAACwAAAAAAAAAC",
        "AAAAAAAAAAAAAAARYWdlbnRfZGFpbHlfdXNhZ2UAAAAAAAABAAAAAAAAAAVhZ2VudAAAAAAAABMAAAABAAAD6QAAB9AAAAAKRGFpbHlVc2FnZQAAAAAAAw==",
        "AAAAAAAAAAAAAAARYWxsb2NhdGVfdG9feWllbGQAAAAAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAARYXZhaWxhYmxlX2NhcGl0YWwAAAAAAAAAAAAAAQAAA+kAAAALAAAAAw==",
        "AAAAAAAAAAAAAAARY2FwaXRhbF9icmVha2Rvd24AAAAAAAAAAAAAAQAAA+kAAAfQAAAAEENhcGl0YWxCcmVha2Rvd24AAAAD",
        "AAAAAAAAAAAAAAARY2F0ZWdvcnlfZXhwb3N1cmUAAAAAAAACAAAAAAAAAARjb3JlAAAAEwAAAAAAAAADaWR4AAAAAAQAAAABAAAACw==",
        "AAAAAAAAAAAAAAARb3Blbl9tYXJrZXRfY291bnQAAAAAAAAAAAAAAQAAAAQ=",
        "AAAAAAAAAAAAAAARcmVjYWxsX2Zyb21feWllbGQAAAAAAAABAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAAAIAAAAD",
        "AAAABQAAAAAAAAAAAAAAE0FnZW50UG9saWN5UHJvcG9zZWQAAAAAAQAAABVhZ2VudF9wb2xpY3lfcHJvcG9zZWQAAAAAAAAFAAAAAAAAAAVhZ2VudAAAAAAAABMAAAABAAAAAAAAAAVyb2xlcwAAAAAAAAQAAAAAAAAAAAAAAAltYXhfdHJhZGUAAAAAAAALAAAAAAAAAAAAAAAJbWF4X2RhaWx5AAAAAAAACwAAAAAAAAAAAAAADWV4ZWN1dGFibGVfYXQAAAAAAAAGAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAE1ByaWNlUG9saWN5UHJvcG9zZWQAAAAAAQAAABVwcmljZV9wb2xpY3lfcHJvcG9zZWQAAAAAAAADAAAAAAAAAANvbGQAAAAH0AAAAAtQcmljZVBvbGljeQAAAAAAAAAAAAAAAANuZXcAAAAH0AAAAAtQcmljZVBvbGljeQAAAAAAAAAAAAAAAA1leGVjdXRhYmxlX2F0AAAAAAAABgAAAAAAAAAC",
        "AAAAAAAAAAAAAAASZGFpbHlfdXNhZ2VfZGV0YWlsAAAAAAAAAAAAAQAAA+kAAAfQAAAAC1VzYWdlV2luZG93AAAAAAM=",
        "AAAAAAAAAAAAAAASZW1lcmdlbmN5X3dpdGhkcmF3AAAAAAACAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAABnNoYXJlcwAAAAAACwAAAAEAAAPpAAAACwAAAAM=",
        "AAAABQAAAAAAAAAAAAAAFEFnZW50UG9saWN5Q2FuY2VsbGVkAAAAAQAAABZhZ2VudF9wb2xpY3lfY2FuY2VsbGVkAAAAAAABAAAAAAAAAAVhZ2VudAAAAAAAABMAAAABAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAFFByaWNlUG9saWN5Q2FuY2VsbGVkAAAAAQAAABZwcmljZV9wb2xpY3lfY2FuY2VsbGVkAAAAAAABAAAAAAAAAAZwb2xpY3kAAAAAB9AAAAALUHJpY2VQb2xpY3kAAAAAAAAAAAI=",
        "AAAAAAAAAAAAAAATYWdlbnRfY2xhaW1fbHBfZmVlcwAAAAACAAAAAAAAAAVhZ2VudAAAAAAAABMAAAAAAAAACW1hcmtldF9pZAAAAAAAAAYAAAABAAAD6QAAAAsAAAAD",
        "AAAAAAAAAAAAAAATYWdlbnRfY3JlYXRlX21hcmtldAAAAAAIAAAAAAAAAAVhZ2VudAAAAAAAABMAAAAAAAAADXF1ZXN0aW9uX2hhc2gAAAAAAAPuAAAAIAAAAAAAAAAPcmVzb2x1dGlvbl9oYXNoAAAAA+4AAAAgAAAAAAAAAAhtZXRhX3VyaQAAABAAAAAAAAAACGNhdGVnb3J5AAAH0AAAAAhDYXRlZ29yeQAAAAAAAAAKY2xvc2VfdGltZQAAAAAABgAAAAAAAAALc2VlZF9hbW91bnQAAAAACwAAAAAAAAAPaW5pdGlhbF95ZXNfYnBzAAAAAAQAAAABAAAD6QAAAAYAAAAD",
        "AAAAAAAAAAAAAAATY2FuY2VsX3ByaWNlX3BvbGljeQAAAAAAAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAATY29sbGVjdF9tYXJrZXRfZmVlcwAAAAABAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAGAAAAAQAAA+kAAAALAAAAAw==",
        "AAAAAAAAAAAAAAATZ2V0X2NyZWF0aW9uX3BvbGljeQAAAAAAAAAAAQAAA+kAAAfQAAAADkNyZWF0aW9uUG9saWN5AAAAAAAD",
        "AAAAAAAAAAAAAAATc2V0X2NyZWF0aW9uX3BvbGljeQAAAAABAAAAAAAAAApuZXdfcG9saWN5AAAAAAfQAAAADkNyZWF0aW9uUG9saWN5AAAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAATc2V0X2RyYXdkb3duX2NvbmZpZwAAAAACAAAAAAAAAAxtYXhfZHJhd2Rvd24AAAALAAAAAAAAAAt3aW5kb3dfZGF5cwAAAAAEAAAAAQAAA+kAAAACAAAAAw==",
        "AAAABQAAAAAAAAAAAAAAFUNyZWF0aW9uUG9saWN5VXBkYXRlZAAAAAAAAAEAAAAXY3JlYXRpb25fcG9saWN5X3VwZGF0ZWQAAAAAAgAAAAAAAAADb2xkAAAAB9AAAAAOQ3JlYXRpb25Qb2xpY3kAAAAAAAAAAAAAAAAAA25ldwAAAAfQAAAADkNyZWF0aW9uUG9saWN5AAAAAAAAAAAAAg==",
        "AAAAAAAAAAAAAAAUYWNrbm93bGVkZ2VfZHJhd2Rvd24AAAAAAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAUYXZhaWxhYmxlX2NhcGl0YWxfb2YAAAABAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAD6QAAAAsAAAAD",
        "AAAAAAAAAAAAAAAUY2xhaW1fcG9vbF9yZW1haW5kZXIAAAACAAAAAAAAAAVhZ2VudAAAAAAAABMAAAAAAAAACW1hcmtldF9pZAAAAAAAAAYAAAABAAAD6QAAAAsAAAAD",
        "AAAAAAAAAAAAAAAUY29ycmVsYXRpb25faGVhZHJvb20AAAABAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAGAAAAAQAAA+kAAAPtAAAAAgAAAAsAAAALAAAAAw==",
        "AAAAAAAAAAAAAAAUZXhlY3V0ZV9wcmljZV9wb2xpY3kAAAAAAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAUcGVuZGluZ19wcmljZV9wb2xpY3kAAAAAAAAAAQAAA+gAAAfQAAAAElBlbmRpbmdQcmljZVBvbGljeQAA",
        "AAAAAAAAAAAAAAAVY2xhaW1fcG9vbF9yZW1haW5kZXJzAAAAAAAAAgAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAAAAAAptYXJrZXRfaWRzAAAAAAPqAAAABgAAAAEAAAPpAAAH0AAAAAtCYXRjaFJlc3VsdAAAAAAD",
        "AAAABQAAAAAAAAAAAAAAF0NvcnJlbGF0aW9uQ2Fwc0V4ZWN1dGVkAAAAAAEAAAAZY29ycmVsYXRpb25fY2Fwc19leGVjdXRlZAAAAAAAAAIAAAAAAAAABGNhcHMAAAfQAAAAD0NvcnJlbGF0aW9uQ2FwcwAAAAAAAAAAAAAAAAlpbW1lZGlhdGUAAAAAAAABAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAF0NvcnJlbGF0aW9uQ2Fwc1Byb3Bvc2VkAAAAAAEAAAAZY29ycmVsYXRpb25fY2Fwc19wcm9wb3NlZAAAAAAAAAIAAAAAAAAABGNhcHMAAAfQAAAAD0NvcnJlbGF0aW9uQ2FwcwAAAAAAAAAAAAAAAA1leGVjdXRhYmxlX2F0AAAAAAAABgAAAAAAAAAC",
        "AAAAAAAAAAAAAAAWc2V0X2RlZmF1bHRfZXhpdF9mbG9vcgAAAAAAAQAAAAAAAAAJcHJpY2VfYnBzAAAAAAAABAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAABQAAAAAAAAAAAAAAGENvcnJlbGF0aW9uQ2Fwc0NhbmNlbGxlZAAAAAEAAAAaY29ycmVsYXRpb25fY2Fwc19jYW5jZWxsZWQAAAAAAAAAAAAC",
        "AAAAAAAAAAAAAAAXY2FuY2VsX2NvcnJlbGF0aW9uX2NhcHMAAAAAAAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAABQAAAAAAAAAAAAAAGUNvcnJlbGF0ZWRFeHBvc3VyZVVwZGF0ZWQAAAAAAAABAAAAG2NvcnJlbGF0ZWRfZXhwb3N1cmVfdXBkYXRlZAAAAAAFAAAAAAAAAARjb3JlAAAAEwAAAAAAAAAAAAAACGNhdGVnb3J5AAAABAAAAAAAAAAAAAAABmJ1Y2tldAAAAAAABgAAAAAAAAAAAAAADmNhdGVnb3J5X3RvdGFsAAAAAAALAAAAAAAAAAAAAAAMYnVja2V0X3RvdGFsAAAACwAAAAAAAAAC",
        "AAAAAAAAAAAAAAAYZXhlY3V0ZV9jb3JyZWxhdGlvbl9jYXBzAAAAAAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAYcGVuZGluZ19jb3JyZWxhdGlvbl9jYXBzAAAAAAAAAAEAAAPoAAAH0AAAABJQZW5kaW5nQ29ycmVsYXRpb24AAA==",
        "AAAAAAAAAAAAAAAYcHJvcG9zZV9jb3JyZWxhdGlvbl9jYXBzAAAAAQAAAAAAAAAEY2FwcwAAB9AAAAAPQ29ycmVsYXRpb25DYXBzAAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAbbGVnYWN5X2NsYWltX3Bvb2xfcmVtYWluZGVyAAAAAAMAAAAAAAAABWFnZW50AAAAAAAAEwAAAAAAAAAEY29yZQAAABMAAAAAAAAACW1hcmtldF9pZAAAAAAAAAYAAAABAAAD6QAAAAsAAAAD",
        "AAAAAAAAAAAAAAAeYWdlbnRfY3JlYXRlX21hcmtldF9hbmRfcmV2ZWFsAAAAAAAJAAAAAAAAAAVhZ2VudAAAAAAAABMAAAAAAAAACHJlc29sdmVyAAAAEwAAAAAAAAANcXVlc3Rpb25faGFzaAAAAAAAA+4AAAAgAAAAAAAAAAhtZXRhX3VyaQAAABAAAAAAAAAACGNhdGVnb3J5AAAH0AAAAAhDYXRlZ29yeQAAAAAAAAAKY2xvc2VfdGltZQAAAAAABgAAAAAAAAALc2VlZF9hbW91bnQAAAAACwAAAAAAAAAPaW5pdGlhbF95ZXNfYnBzAAAAAAQAAAAAAAAAB3NwZWNfdjIAAAAH0AAAABBSZXNvbHV0aW9uU3BlY1YyAAAAAQAAA+kAAAAGAAAAAw==",
        "AAAAAAAAAAAAAAAeYWdlbnRfY3JlYXRlX21hcmtldF9jb2xsYXRlcmFsAAAAAAAJAAAAAAAAAAVhZ2VudAAAAAAAABMAAAAAAAAACmNvbGxhdGVyYWwAAAAAABMAAAAAAAAADXF1ZXN0aW9uX2hhc2gAAAAAAAPuAAAAIAAAAAAAAAAPcmVzb2x1dGlvbl9oYXNoAAAAA+4AAAAgAAAAAAAAAAhtZXRhX3VyaQAAABAAAAAAAAAACGNhdGVnb3J5AAAH0AAAAAhDYXRlZ29yeQAAAAAAAAAKY2xvc2VfdGltZQAAAAAABgAAAAAAAAALc2VlZF9hbW91bnQAAAAACwAAAAAAAAAPaW5pdGlhbF95ZXNfYnBzAAAAAAQAAAABAAAD6QAAAAYAAAAD" ]),
      options
    )
  }
  public readonly fromJSON = {
    nav: this.txFromJSON<Result<i128>>,
        mode: this.txFromJSON<Mode>,
        redeem: this.txFromJSON<Result<i128>>,
        deposit: this.txFromJSON<Result<i128>>,
        realize: this.txFromJSON<Result<void>>,
        unwound: this.txFromJSON<i128>,
        agent_at: this.txFromJSON<Option<string>>,
        realized: this.txFromJSON<Realized>,
        set_mode: this.txFromJSON<Result<void>>,
        unwinder: this.txFromJSON<Option<string>>,
        agent_buy: this.txFromJSON<Result<i128>>,
        cancel_op: this.txFromJSON<Result<void>>,
        get_agent: this.txFromJSON<Option<AgentPolicy>>,
        set_agent: this.txFromJSON<Result<void>>,
        shares_of: this.txFromJSON<i128>,
        agent_sell: this.txFromJSON<Result<i128>>,
        execute_op: this.txFromJSON<Result<void>>,
        exit_floor: this.txFromJSON<u32>,
        get_config: this.txFromJSON<Result<RiskConfig>>,
        get_global: this.txFromJSON<Result<GlobalConfig>>,
        market_pnl: this.txFromJSON<MarketPnl>,
        pending_op: this.txFromJSON<Option<PendingAdminOp>>,
        propose_op: this.txFromJSON<Result<u64>>,
        set_paused: this.txFromJSON<Result<void>>,
        token_caps: this.txFromJSON<Result<TokenCaps>>,
        window_pnl: this.txFromJSON<Result<i128>>,
        agent_count: this.txFromJSON<u32>,
        close_trade: this.txFromJSON<Result<i128>>,
        daily_usage: this.txFromJSON<Result<DailyUsage>>,
        get_net_cap: this.txFromJSON<Result<i128>>,
        redeem_many: this.txFromJSON<Result<BatchResult>>,
        agent_buy_v2: this.txFromJSON<Result<i128>>,
        cancel_agent: this.txFromJSON<Result<void>>,
        config_delay: this.txFromJSON<u64>,
        net_exposure: this.txFromJSON<i128>,
        net_position: this.txFromJSON<Result<NetPosition>>,
        queue_bounds: this.txFromJSON<readonly [u64, u64]>,
        remove_agent: this.txFromJSON<Result<void>>,
        set_unwinder: this.txFromJSON<Result<void>>,
        total_shares: this.txFromJSON<i128>,
        agent_sell_v2: this.txFromJSON<Result<i128>>,
        cancel_config: this.txFromJSON<Result<void>>,
        deposit_token: this.txFromJSON<Result<i128>>,
        disable_yield: this.txFromJSON<Result<void>>,
        execute_agent: this.txFromJSON<Result<void>>,
        legacy_redeem: this.txFromJSON<Result<i128>>,
        pending_agent: this.txFromJSON<Option<PendingAgent>>,
        set_successor: this.txFromJSON<Result<void>>,
        settle_market: this.txFromJSON<Result<SettlementReport>>,
        claim_withdraw: this.txFromJSON<Result<i128>>,
        creation_usage: this.txFromJSON<Result<u32>>,
        daily_headroom: this.txFromJSON<Result<i128>>,
        execute_config: this.txFromJSON<Result<void>>,
        liquid_capital: this.txFromJSON<Result<i128>>,
        open_market_at: this.txFromJSON<Option<OpenMarket>>,
        pending_config: this.txFromJSON<Option<PendingConfig>>,
        propose_config: this.txFromJSON<Result<void>>,
        queue_reserved: this.txFromJSON<i128>,
        set_exit_floor: this.txFromJSON<Result<void>>,
        set_token_caps: this.txFromJSON<Result<void>>,
        bucket_exposure: this.txFromJSON<i128>,
        drawdown_status: this.txFromJSON<Result<DrawdownStatus>>,
        migrate_markets: this.txFromJSON<Result<void>>,
        set_yield_venue: this.txFromJSON<Result<void>>,
        withdraw_ticket: this.txFromJSON<Option<WithdrawTicket>>,
        correlation_caps: this.txFromJSON<Result<CorrelationCaps>>,
        get_price_policy: this.txFromJSON<PricePolicy>,
        market_valuation: this.txFromJSON<Result<Valuation>>,
        request_withdraw: this.txFromJSON<Result<readonly [i128, u64]>>,
        reset_pnl_window: this.txFromJSON<Result<void>>,
        set_config_delay: this.txFromJSON<Result<void>>,
        set_price_policy: this.txFromJSON<Result<void>>,
        agent_daily_usage: this.txFromJSON<Result<DailyUsage>>,
        allocate_to_yield: this.txFromJSON<Result<void>>,
        available_capital: this.txFromJSON<Result<i128>>,
        capital_breakdown: this.txFromJSON<Result<CapitalBreakdown>>,
        category_exposure: this.txFromJSON<i128>,
        open_market_count: this.txFromJSON<u32>,
        recall_from_yield: this.txFromJSON<Result<void>>,
        daily_usage_detail: this.txFromJSON<Result<UsageWindow>>,
        emergency_withdraw: this.txFromJSON<Result<i128>>,
        agent_claim_lp_fees: this.txFromJSON<Result<i128>>,
        agent_create_market: this.txFromJSON<Result<u64>>,
        cancel_price_policy: this.txFromJSON<Result<void>>,
        collect_market_fees: this.txFromJSON<Result<i128>>,
        get_creation_policy: this.txFromJSON<Result<CreationPolicy>>,
        set_creation_policy: this.txFromJSON<Result<void>>,
        set_drawdown_config: this.txFromJSON<Result<void>>,
        acknowledge_drawdown: this.txFromJSON<Result<void>>,
        available_capital_of: this.txFromJSON<Result<i128>>,
        claim_pool_remainder: this.txFromJSON<Result<i128>>,
        correlation_headroom: this.txFromJSON<Result<readonly [i128, i128]>>,
        execute_price_policy: this.txFromJSON<Result<void>>,
        pending_price_policy: this.txFromJSON<Option<PendingPricePolicy>>,
        claim_pool_remainders: this.txFromJSON<Result<BatchResult>>,
        set_default_exit_floor: this.txFromJSON<Result<void>>,
        cancel_correlation_caps: this.txFromJSON<Result<void>>,
        execute_correlation_caps: this.txFromJSON<Result<void>>,
        pending_correlation_caps: this.txFromJSON<Option<PendingCorrelation>>,
        propose_correlation_caps: this.txFromJSON<Result<void>>,
        legacy_claim_pool_remainder: this.txFromJSON<Result<i128>>,
        agent_create_market_and_reveal: this.txFromJSON<Result<u64>>,
        agent_create_market_collateral: this.txFromJSON<Result<u64>>
  }
}