/**
 * Wraps the generated contract bindings (packages/bindings/*) with signing,
 * submission, and a dry-run mode. Every agent action goes through this
 * module rather than touching a Client directly, so dry-run/live is a
 * single switch and every mutating call ends up beside its trace-building.
 *
 * Requires the bindings to have been generated (`make bindings` /
 * `scripts/gen-bindings.sh`) and installed (`npm install` in each
 * packages/bindings/<name> — see README.md's quickstart).
 */

import { Account, Address, Contract, Keypair, TransactionBuilder, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { KeypairSigner } from "@stellar/stellar-sdk/contract";
import { toContractArg, type PriceConfigArg, type SignerConfigArg, type SpecJson } from "../core/spec.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { toTraceAction, type TraceActionType } from "../core/trace.js";
import { assertNever, type AgentMode } from "../runtime/config.js";
import type { StellarSigner } from "./signers/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// HERE is agents/stellar/ — the repo root is two levels up.
const REPO_ROOT = join(HERE, "..", "..");

export interface Deployments {
  deployer: string;
  /** The treasury's constructor agent (all roles). Kept for deployments
   * that predate separate maker/trader identities. */
  agent: string;
  /** Per-role agents registered with the treasury's agent registry by
   * scripts/deploy-testnet.sh (`set_agent`, live after `config_delay`). */
  agents?: { maker: string; trader: string };
  contracts: {
    usdc: string;
    market_core: string;
    resolver: string;
    treasury: string;
    reasoning_registry: string;
  };
}

export function loadDeployments(
  path = process.env.DEPLOYMENTS_PATH ?? join(REPO_ROOT, "deployments", "testnet.json"),
): Deployments {
  return JSON.parse(readFileSync(path, "utf8")) as Deployments;
}

export type AgentRole = "maker" | "trader";

/**
 * Which key and address an agent CLI acts as. Each role prefers its own
 * secret (`MAKER_SECRET_KEY` / `TRADER_SECRET_KEY`) and registered address
 * (`deployments.agents`), falling back to the shared `AGENT_SECRET_KEY` and
 * the constructor agent `deployments.agent`.
 */
export function agentCredentials(
  role: AgentRole,
  env: NodeJS.ProcessEnv,
  deployments: Deployments,
): { agentSecret?: string; agentAddress: string } {
  const roleSecret = role === "maker" ? env.MAKER_SECRET_KEY : env.TRADER_SECRET_KEY;
  return {
    agentSecret: roleSecret || env.AGENT_SECRET_KEY,
    agentAddress: deployments.agents?.[role] ?? deployments.agent,
  };
}

interface CommonAdapterOptions {
  networkPassphrase: string;
  rpcUrl: string;
  /** The acting agent's address for dry-run descriptions (live mode always
   * uses the secret key's public key). Defaults to `deployments.agent`. */
  agentAddress?: string;
  deployments: Deployments;
}

/**
 * "dry-run": builds and logs what would be submitted, never signs or sends,
 * and must not be handed a secret at all. "live": submits real transactions
 * signed with `agentSecret` (`S...`), which it requires.
 */
export type StellarAdapterOptions = CommonAdapterOptions &
  (
    | { mode: "dry-run"; agentSecret?: undefined; signer?: undefined }
    | { mode: "live"; agentSecret?: string; signer?: StellarSigner }
  );

export interface DryRunResult {
  dryRun: true;
  contractId: string;
  method: string;
  args: unknown;
}

/** Real result shape depends on the call; see each wrapper method below. */
export type LiveResult<T> = { dryRun: false; value: T; /** Hash of the submitted transaction, when the SDK reports it. */ txHash?: string };

export type AdapterResult<T> = DryRunResult | LiveResult<T>;

export type Side = "Yes" | "No";

/** The treasury's effective operating mode (`Treasury::mode`, issue #272). */
export type TreasuryMode = "Normal" | "AgentsHalted" | "AdminPaused" | "Emergency";

/** The committed `DisputableSignerConfig` as the watcher reads it. */
export interface DisputableConfigRead {
  signers: string[];
  threshold: number;
  /** Seconds after `proposed_at` during which `dispute` is accepted. */
  disputeWindow: bigint;
  /** Collateral escrowed per dispute, stroops. */
  disputeBond: bigint;
  escalation: "Guardian" | "Committee";
  /** Seconds after a dispute opens before `expire_dispute` may void it. */
  escalationTimeout: bigint;
}

/** A resolver `Dispute` entry. `payee` is undefined while the dispute is open. */
export interface DisputeRead {
  disputer: string;
  bond: bigint;
  /** Collateral token snapshotted when the dispute opened. */
  token: string;
  openedAt: bigint;
  payee?: string;
}

/** Snapshot of a market's read-only state, from `readMarket`. */
export interface MarketRead {
  marketId: number;
  /** IPFS CID / URI of the question metadata (the question text itself is
   * stored off-chain; see docs/frontend-integration.md). */
  metaUri: string;
  closeTime: number;
  reserveYes: bigint;
  reserveNo: bigint;
  /** YES spot price in bps (0..=10_000), from `get_price`. */
  yesBps: number;
  /** YES time-weighted average over the requested `useTwapSecs` window,
   * from `twap`. Present only when `useTwapSecs` was passed. */
  twapBps?: number;
}

/**
 * The call failed before a transaction was submitted (building or
 * simulating it — e.g. a treasury cap rejection), so it certainly has no
 * on-chain effect. Anything else thrown by a live call may or may not have
 * landed.
 */
export class NotSubmittedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "NotSubmittedError";
  }
}

/**
 * Thin, mode-aware wrapper. Each method builds the same call regardless of
 * mode; in dry-run it stops after simulate/describe and never signs, so a
 * misconfigured agent can never accidentally submit a real transaction.
 */
export class StellarAdapter {
  private readonly signer?: StellarSigner;
  private readonly publicKey?: string;

  constructor(private readonly opts: StellarAdapterOptions) {
    switch (opts.mode) {
      case "dry-run":
        if (opts.agentSecret !== undefined || opts.signer !== undefined) {
          throw new Error("dry-run mode must not be given a signer or agentSecret");
        }
        break;
      case "live": {
        if (opts.signer && opts.agentSecret) {
          throw new Error("live mode accepts either signer or agentSecret, not both");
        }
        if (opts.signer) {
          this.signer = opts.signer;
          this.publicKey = opts.signer.address;
        } else if (opts.agentSecret) {
          const keypair = Keypair.fromSecret(opts.agentSecret);
          this.signer = new KeypairSigner(keypair, opts.networkPassphrase);
          this.publicKey = keypair.publicKey();
        } else {
          throw new Error("live mode requires signer or agentSecret");
        }
        const expectedAddress = opts.agentAddress ?? opts.deployments.agent;
        if (this.publicKey !== expectedAddress) {
          throw new Error("signer address does not match the configured agent address");
        }
        break;
      }
      default:
        // Only the mode is printed: opts may carry a secret.
        assertNever(opts, "mode", (opts as { mode?: unknown }).mode);
    }
  }

  get mode(): AgentMode {
    return this.opts.mode;
  }

  /** The address every treasury agent entrypoint is called as (its first
   * `agent` argument), and the agent traces are published for. */
  get agent(): string {
    return this.publicKey ?? this.opts.agentAddress ?? this.opts.deployments.agent;
  }

  /** The deployment this adapter is bound to. */
  get deployments(): Deployments {
    return this.opts.deployments;
  }

  /**
   * Loads a generated Client for one of the four contracts. Imported
   * dynamically so `mode: "dry-run"` usage (e.g. unit tests) never requires
   * the bindings packages to be installed.
   */
  private async client<T>(pkg: keyof Deployments["contracts"], moduleName: string): Promise<T> {
    const contractId = this.opts.deployments.contracts[pkg];
    const mod = (await import(moduleName)) as { Client: { from: (o: unknown) => Promise<T> } };
    return mod.Client.from({
      contractId,
      networkPassphrase: this.opts.networkPassphrase,
      rpcUrl: this.opts.rpcUrl,
      // A local network (http://localhost:8000/soroban/rpc) has no TLS.
      allowHttp: this.opts.rpcUrl.startsWith("http://"),
      publicKey: this.publicKey,
      signTransaction: this.signer,
    });
  }

  /**
   * Runs `method(client)` (a call to one of the generated Client's methods,
   * returning its `AssembledTransaction`) either as a dry-run description
   * or a real signed submission, depending on `this.mode`.
   */
  private async run<T>(
    pkg: keyof Deployments["contracts"],
    moduleName: string,
    methodName: string,
    args: unknown,
    call: (client: any) => Promise<{ signAndSend: () => Promise<{ result: T; sendTransactionResponse?: { hash?: string } }> }>,
  ): Promise<AdapterResult<T>> {
    const contractId = this.opts.deployments.contracts[pkg];
    switch (this.opts.mode) {
      case "dry-run":
        return { dryRun: true, contractId, method: methodName, args };
      case "live":
        break;
      default:
        assertNever(this.opts, "mode", (this.opts as { mode?: unknown }).mode);
    }
    let assembled: Awaited<ReturnType<typeof call>>;
    try {
      const client = await this.client<any>(pkg, moduleName);
      assembled = await call(client);
    } catch (err) {
      throw new NotSubmittedError(`${methodName}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    const simulation = (assembled as { simulation?: { error?: string } }).simulation;
    if (simulation?.error) {
      throw new NotSubmittedError(`${methodName} simulation failed: ${simulation.error}`);
    }
    const sent = await assembled.signAndSend();
    const txHash = sent.sendTransactionResponse?.hash;
    return { dryRun: false, value: unwrapContractResult(methodName, sent.result), ...(txHash ? { txHash } : {}) };
  }

  async agentCreateMarket(args: {
    question_hash: Buffer;
    resolution_hash: Buffer;
    meta_uri: string;
    category: { tag: string; values: void };
    close_time: bigint;
    seed_amount: bigint;
    initial_yes_bps: number;
  }): Promise<AdapterResult<bigint>> {
    const call = { agent: this.agent, ...args };
    return this.run("treasury", "@oracledesk/bindings-treasury", "agent_create_market", call, (client) =>
      client.agent_create_market(call),
    );
  }

  async agentBuy(args: {
    market_id: bigint;
    outcome: { tag: "Yes" | "No"; values: void };
    collateral_in: bigint;
    min_shares_out: bigint;
  }): Promise<AdapterResult<bigint>> {
    const call = { agent: this.agent, ...args };
    return this.run("treasury", "@oracledesk/bindings-treasury", "agent_buy", call, (client) =>
      client.agent_buy(call),
    );
  }

  /**
   * `agent_buy` with contract-enforced bounds: the trade reverts past
   * `deadline` (ledger timestamp, unix seconds) or when the average
   * execution price is worse than `limit_price_bps` (fee included; 0 = no
   * limit for buys). On-chain this is the treasury's `agent_buy_v2`.
   */
  async agentBuyV2(args: {
    market_id: bigint;
    outcome: { tag: "Yes" | "No"; values: void };
    collateral_in: bigint;
    min_shares_out: bigint;
    limit_price_bps: number;
    deadline: bigint;
  }): Promise<AdapterResult<bigint>> {
    const call = { agent: this.agent, ...args };
    return this.run("treasury", "@oracledesk/bindings-treasury", "agent_buy_v2", call, (client) =>
      client.agent_buy_v2(call),
    );
  }

  async agentSell(args: {
    market_id: bigint;
    outcome: { tag: "Yes" | "No"; values: void };
    collateral_out: bigint;
    max_shares_in: bigint;
  }): Promise<AdapterResult<bigint>> {
    const call = { agent: this.agent, ...args };
    return this.run("treasury", "@oracledesk/bindings-treasury", "agent_sell", call, (client) =>
      client.agent_sell(call),
    );
  }

  /**
   * `agent_sell` with contract-enforced bounds. For sells a
   * `limit_price_bps` of 0 is trivially satisfied on-chain (no
   * protection) — pass the fair value you are willing to sell at.
   */
  async agentSellV2(args: {
    market_id: bigint;
    outcome: { tag: "Yes" | "No"; values: void };
    collateral_out: bigint;
    max_shares_in: bigint;
    limit_price_bps: number;
    deadline: bigint;
  }): Promise<AdapterResult<bigint>> {
    const call = { agent: this.agent, ...args };
    return this.run("treasury", "@oracledesk/bindings-treasury", "agent_sell_v2", call, (client) =>
      client.agent_sell_v2(call),
    );
  }

  /**
   * Simulates market-core's `quote_buy` (read-only — never signs or
   * submits) and returns the quoted shares. Unlike the mutating wrappers
   * this also runs in dry-run mode, so a dry-run trader can still derive
   * its `min_shares_out` / `limit_price_bps` bounds.
   */
  async quoteBuy(args: {
    market_id: bigint;
    outcome: { tag: "Yes" | "No"; values: void };
    collateral_in: bigint;
  }): Promise<bigint> {
    const client = await this.client<any>("market_core", "@oracledesk/bindings-market-core");
    const { result } = await client.quote_buy(args);
    // quote_buy returns Result<i128, Error>: unwrap it, and surface an Err.
    return BigInt(unwrapContractResult("quote_buy", result) as bigint);
  }

  /**
   * Reveals a signer-mode spec (resolver `register_signer_spec`).
   * Permissionless: the commitment, not the caller, authorizes it.
   */
  async registerSignerSpec(args: { market_id: bigint; spec: SignerConfigArg }): Promise<AdapterResult<void>> {
    return this.run("resolver", "@oracledesk/bindings-resolver", "register_signer_spec", args, (client) =>
      client.register_signer_spec(args),
    );
  }

  /** Reveals a price-mode spec (resolver `register_price_spec`). */
  async registerPriceSpec(args: { market_id: bigint; spec: PriceConfigArg }): Promise<AdapterResult<void>> {
    return this.run("resolver", "@oracledesk/bindings-resolver", "register_price_spec", args, (client) =>
      client.register_price_spec(args),
    );
  }

  /** Reveals `spec` through whichever wrapper its mode needs, in canonical order. */
  async revealSpec(marketId: bigint, spec: SpecJson): Promise<AdapterResult<void>> {
    return spec.mode === "signers"
      ? this.registerSignerSpec({ market_id: marketId, spec: toContractArg(spec) as SignerConfigArg })
      : this.registerPriceSpec({ market_id: marketId, spec: toContractArg(spec) as PriceConfigArg });
  }

  /**
   * The treasury's effective operating mode (read-only simulation; also runs in
   * dry-run). Unit enum variants decode to `[name]`. Agents read it once per
   * tick and skip open-position work unless it is `Normal`, instead of
   * discovering a halt from a failed simulation.
   */
  async treasuryMode(): Promise<TreasuryMode> {
    const r = (await this.simulateRead(this.opts.deployments.contracts.treasury, "mode", [])) as [TreasuryMode] | TreasuryMode;
    return Array.isArray(r) ? r[0] : r;
  }

  /** market-core `market_count` (read-only simulation; also runs in dry-run). */
  async marketCount(): Promise<bigint> {
    const client = await this.client<any>("market_core", "@oracledesk/bindings-market-core");
    const { result } = await client.market_count();
    return BigInt(result);
  }

  /** market-core `get_market` (read-only), or `undefined` if it does not exist. */
  async getMarket(marketId: bigint): Promise<
    | {
        creator: string;
        questionHash: string;
        resolutionHash: string;
        closeTime: bigint;
        status: "Open" | "Resolved" | "Void";
        reserveYes: bigint;
        reserveNo: bigint;
        feeBps: bigint;
      }
    | undefined
  > {
    const client = await this.client<any>("market_core", "@oracledesk/bindings-market-core");
    const { result } = await client.get_market({ market_id: marketId });
    if (result?.isErr?.()) return undefined;
    const m = typeof result?.unwrap === "function" ? result.unwrap() : result;
    return {
      creator: m.creator,
      questionHash: Buffer.from(m.question_hash).toString("hex"),
      resolutionHash: Buffer.from(m.resolution_hash).toString("hex"),
      closeTime: BigInt(m.close_time),
      status: m.status.tag,
      reserveYes: BigInt(m.reserve_yes),
      reserveNo: BigInt(m.reserve_no),
      feeBps: BigInt(m.fee_bps),
    };
  }

  /**
   * The treasury caps that bound this agent: the stricter of the global
   * config and the agent's own policy, plus what it has spent today.
   */
  async riskCaps(): Promise<{
    maxTrade: bigint;
    maxMarket: bigint;
    maxDaily: bigint;
    dailyUsed: bigint;
    dailyHeadroom?: bigint;
  }> {
    const client = await this.client<any>("treasury", "@oracledesk/bindings-treasury");
    const config = unwrapContractResult("get_config", (await client.get_config()).result) as { max_trade: bigint; max_market: bigint; max_daily: bigint };
    const policy = (await client.get_agent({ agent: this.agent })).result as { max_trade: bigint; max_daily: bigint } | undefined;
    const [usageResult, globalHeadroomResult] = await Promise.all([
      client.agent_daily_usage({ agent: this.agent }),
      client.daily_headroom(),
    ]);
    const usage = unwrapContractResult("agent_daily_usage", usageResult.result) as { amount: bigint };
    const min = (a: bigint, b?: bigint) => (b !== undefined && BigInt(b) < BigInt(a) ? BigInt(b) : BigInt(a));
    const maxDaily = min(config.max_daily, policy?.max_daily);
    const agentHeadroom = max0(maxDaily - BigInt(usage.amount));
    return {
      maxTrade: min(config.max_trade, policy?.max_trade),
      maxMarket: BigInt(config.max_market),
      maxDaily,
      dailyUsed: BigInt(usage.amount),
      dailyHeadroom: min(BigInt(unwrapContractResult("daily_headroom", globalHeadroomResult.result) as bigint), agentHeadroom),
    };
  }

  /** Cumulative treasury spend for this market; sells and close_trade do not erase it. */
  async marketExposure(marketId: bigint): Promise<bigint> {
    const key = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: new Address(this.opts.deployments.contracts.treasury).toScAddress(),
        key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Market"), xdr.ScVal.scvU64(xdr.Uint64.fromString(String(marketId)))]),
        durability: xdr.ContractDataDurability.persistent(),
      }),
    );
    const { entries } = await this.rpcServer().getLedgerEntries(key);
    const entry = entries[0];
    if (!entry) return 0n;
    const data = entry.val.contractData()?.val();
    const amount = data?.map()?.find((item) => item.key().sym?.().toString() === "amount")?.val()?.i128()?.toString();
    if (amount === undefined) throw new Error(`treasury market exposure ${marketId} has an invalid ledger entry`);
    return BigInt(amount);
  }

  /** What the treasury has committed to `marketId` (its cost basis). */
  async marketSpent(marketId: bigint): Promise<bigint> {
    const client = await this.client<any>("treasury", "@oracledesk/bindings-treasury");
    const v = unwrapContractResult("market_valuation", (await client.market_valuation({ market_id: marketId })).result) as { cost_basis: bigint };
    return BigInt(v.cost_basis);
  }

  /** An RPC client for this adapter's network (event polling, ledger reads). */
  rpcServer(): rpc.Server {
    return new rpc.Server(this.opts.rpcUrl, { allowHttp: this.opts.rpcUrl.startsWith("http://") });
  }

  /** The deployment's contract ids. A copy: callers cannot rebind the adapter. */
  contractIds(): Deployments["contracts"] {
    return { ...this.opts.deployments.contracts };
  }

  /** The treasury's YES/NO shares in `marketId` (zero when it holds none). */
  async treasuryPosition(marketId: bigint): Promise<{ yes: bigint; no: bigint }> {
    const client = await this.client<any>("market_core", "@oracledesk/bindings-market-core");
    const { result } = await client.get_position({ market_id: marketId, holder: this.opts.deployments.contracts.treasury });
    return { yes: BigInt(result.yes), no: BigInt(result.no) };
  }

  /** The resolver's state tag for `marketId`, e.g. "SignersPending". */
  async resolutionState(marketId: bigint): Promise<string> {
    const client = await this.client<any>("resolver", "@oracledesk/bindings-resolver");
    const { result } = await client.state({ market_id: marketId });
    return (result as { tag: string }).tag;
  }

  /**
   * Whether a legacy spec is registered for `marketId`. A signer reveal
   * moves `state()` to SignersPending, but a price reveal leaves it
   * Unconfigured, so the resolver's `Price(market_id)` entry is read too.
   */
  async isSpecRevealed(marketId: bigint): Promise<boolean> {
    const client = await this.client<any>("resolver", "@oracledesk/bindings-resolver");
    const { result } = await client.state({ market_id: marketId });
    if (result?.tag && result.tag !== "Unconfigured") return true;
    const key = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: new Address(this.opts.deployments.contracts.resolver).toScAddress(),
        key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Price"), xdr.ScVal.scvU64(new xdr.Uint64(marketId))]),
        durability: xdr.ContractDataDurability.persistent(),
      }),
    );
    const { entries } = await new rpc.Server(this.opts.rpcUrl, { allowHttp: this.opts.rpcUrl.startsWith("http://") }).getLedgerEntries(key);
    return entries.length > 0;
  }

  // ─── Disputes (resolver) ────────────────────────────────────────────────
  // Used by the proposal watcher. The disputer is always this adapter's own
  // address, so the watcher runs on a dedicated adapter and key.

  /**
   * Challenges the market's pending signer proposal with a bond
   * (resolver `dispute`). `alternative` is the outcome the caller claims is
   * correct; `null` claims the market is invalid.
   */
  async dispute(args: { market_id: bigint; alternative: Side | null }): Promise<AdapterResult<void>> {
    const call = {
      market_id: args.market_id,
      disputer: this.agent,
      alternative: args.alternative === null ? undefined : { tag: args.alternative, values: undefined as void },
    };
    return this.run("resolver", "@oracledesk/bindings-resolver", "dispute", call, (client) => client.dispute(call));
  }

  /** Permissionless: voids a dispute that outlived `escalation_timeout` and refunds the bond. */
  async expireDispute(marketId: bigint): Promise<AdapterResult<void>> {
    const call = { market_id: marketId };
    return this.run("resolver", "@oracledesk/bindings-resolver", "expire_dispute", call, (client) => client.expire_dispute(call));
  }

  /** Permissionless: pays a settled dispute's bond to its payee. */
  async claimDisputeBond(marketId: bigint): Promise<AdapterResult<void>> {
    const call = { market_id: marketId };
    return this.run("resolver", "@oracledesk/bindings-resolver", "claim_dispute_bond", call, (client) => client.claim_dispute_bond(call));
  }

  /**
   * A resolver persistent entry, decoded without the binding spec: the
   * generated bindings only carry the types that appear in a function
   * signature, and `Dispute` / `SignerProposalV2` do not. Structs decode to
   * objects, unit enum variants to `[name]`, `None` to null.
   */
  private async resolverEntry<T>(variant: string, marketId: bigint): Promise<T | undefined> {
    const key = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: new Address(this.opts.deployments.contracts.resolver).toScAddress(),
        key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variant), xdr.ScVal.scvU64(xdr.Uint64.fromString(String(marketId)))]),
        durability: xdr.ContractDataDurability.persistent(),
      }),
    );
    const { entries } = await this.rpcServer().getLedgerEntries(key);
    const entry = entries[0];
    if (!entry) return undefined;
    return scValToNative(entry.val.contractData().val()) as T;
  }

  /**
   * The committed `DisputableSignerConfig` (resolver `DataKey::Disputable`),
   * or `undefined` for a market that is not a disputable signer market.
   */
  async disputableConfig(marketId: bigint): Promise<DisputableConfigRead | undefined> {
    const c = await this.resolverEntry<{
      signers: string[];
      threshold: number;
      dispute_window: bigint;
      dispute_bond: bigint;
      escalation: ["Guardian"] | ["Committee", ...unknown[]];
      escalation_timeout: bigint;
    }>("Disputable", marketId);
    if (!c) return undefined;
    return {
      signers: c.signers,
      threshold: c.threshold,
      disputeWindow: BigInt(c.dispute_window),
      disputeBond: BigInt(c.dispute_bond),
      escalation: c.escalation[0],
      escalationTimeout: BigInt(c.escalation_timeout),
    };
  }

  /** The open or settled dispute (resolver `DataKey::Dispute`), if any. */
  async currentDispute(marketId: bigint): Promise<DisputeRead | undefined> {
    const d = await this.resolverEntry<{ disputer: string; bond: bigint; token: string; opened_at: bigint; payee?: string | null }>("Dispute", marketId);
    if (!d) return undefined;
    return { disputer: d.disputer, bond: BigInt(d.bond), token: d.token, openedAt: BigInt(d.opened_at), payee: d.payee ?? undefined };
  }

  /** The pending signer proposal (resolver `DataKey::ProposalV2`), if any. */
  async currentProposal(marketId: bigint): Promise<{ outcome: "Yes" | "No" | "Invalid"; proposedAt: bigint } | undefined> {
    const p = await this.resolverEntry<{ outcome: ["Yes" | "No" | "Invalid"]; proposed_at: bigint }>("ProposalV2", marketId);
    return p ? { outcome: p.outcome[0], proposedAt: BigInt(p.proposed_at) } : undefined;
  }

  /** Close time of the latest ledger, unix seconds: the clock `dispute` is judged against. */
  async ledgerTime(): Promise<bigint> {
    return BigInt((await this.rpcServer().getLatestLedger()).closeTime);
  }

  /** `addr`'s balance of the market-core collateral token, in stroops. */
  async collateralBalance(addr: string): Promise<bigint> {
    const client = await this.client<any>("market_core", "@oracledesk/bindings-market-core");
    const config = unwrapContractResult("get_config", (await client.get_config()).result) as { collateral: string };
    return this.readToken(config.collateral, addr);
  }

  /** SEP-41 `balance(addr)` of `token`, simulated (never signed or submitted). */
  async readToken(token: string, addr: string): Promise<bigint> {
    return BigInt((await this.simulateRead(token, "balance", [new Address(addr).toScVal()])) as bigint);
  }

  /**
   * Simulates `contractId.method(args)` and returns the decoded result.
   * Read-only: used for contracts without generated bindings (Reflector, SAC).
   */
  async simulateRead(contractId: string, method: string, args: xdr.ScVal[]): Promise<unknown> {
    const source = new Account(this.agent, "0");
    const tx = new TransactionBuilder(source, { fee: "100", networkPassphrase: this.opts.networkPassphrase })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(30)
      .build();
    const sim = await this.rpcServer().simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) throw new Error(`${method} simulation failed on ${contractId}`);
    return scValToNative(sim.result.retval);
  }

  /** Reflector (SEP-40) `resolution()`: seconds between records. */
  async reflectorResolution(reflector: string): Promise<number> {
    return Number(await this.simulateRead(reflector, "resolution", []));
  }

  /** Reflector `price(asset, timestamp)`: the record at exactly `timestamp`, if any. */
  async reflectorPrice(
    reflector: string,
    asset: { tag: "Stellar" | "Other"; value: string },
    timestamp: bigint,
  ): Promise<{ price: bigint; timestamp: bigint } | undefined> {
    const assetVal = xdr.ScVal.scvVec([
      xdr.ScVal.scvSymbol(asset.tag),
      asset.tag === "Stellar" ? new Address(asset.value).toScVal() : xdr.ScVal.scvSymbol(asset.value),
    ]);
    const r = (await this.simulateRead(reflector, "price", [assetVal, xdr.ScVal.scvU64(xdr.Uint64.fromString(timestamp.toString()))])) as
      | { price: bigint; timestamp: bigint }
      | null
      | undefined;
    return r ? { price: BigInt(r.price), timestamp: BigInt(r.timestamp) } : undefined;
  }

  /** The attestation-linked evidence citations recorded for `marketId` (resolver `evidence_at`). */
  async attestationEvidence(marketId: bigint): Promise<{ signer: string; outcome: "Yes" | "No" | "Invalid"; traceId: bigint; traceHash: string }[]> {
    const client = await this.client<any>("resolver", "@oracledesk/bindings-resolver");
    const count = Number((await client.evidence_count({ market_id: marketId })).result);
    const out = [];
    for (let index = 0; index < count; index++) {
      const e = unwrapContractResult("evidence_at", (await client.evidence_at({ market_id: marketId, index })).result) as {
        signer: string;
        outcome: { tag: "Yes" | "No" | "Invalid" };
        trace_id: bigint;
        trace_hash: Uint8Array;
      };
      out.push({ signer: e.signer, outcome: e.outcome.tag, traceId: BigInt(e.trace_id), traceHash: Buffer.from(e.trace_hash).toString("hex") });
    }
    return out;
  }

  /** The IPFS CID a registry trace was published with. */
  async traceCid(traceId: bigint): Promise<string> {
    const client = await this.client<any>("reasoning_registry", "@oracledesk/bindings-reasoning-registry");
    const t = unwrapContractResult("get_trace", (await client.get_trace({ trace_id: traceId })).result) as { ipfs_cid: string };
    return t.ipfs_cid;
  }

  async publishTrace(args: {
    agent: string;
    market_id: bigint;
    action: TraceActionType | string;
    trace_hash: Buffer;
    ipfs_cid: string;
  }): Promise<AdapterResult<bigint>> {
    const action = typeof args.action === "string" ? toTraceAction(args.action) : args.action;
    const call = { ...args, action };
    return this.run(
      "reasoning_registry",
      "@oracledesk/bindings-reasoning-registry",
      "publish_trace",
      call,
      (client) => client.publish_trace(call),
    );
  }

  async publishTraceBatch(args: {
    agent: string;
    root: Buffer;
    leaf_count: number;
    manifest_cid: string;
  }): Promise<AdapterResult<bigint>> {
    return this.run(
      "reasoning_registry",
      "@oracledesk/bindings-reasoning-registry",
      "publish_trace_batch",
      args,
      (client) => client.publish_trace_batch(args),
    );
  }

  async addSigningKey(args: {
    agent: string;
    public_key: Buffer;
    proof_sig: Buffer;
  }): Promise<AdapterResult<void>> {
    return this.run(
      "reasoning_registry",
      "@oracledesk/bindings-reasoning-registry",
      "add_signing_key",
      args,
      (client) => client.add_signing_key(args),
    );
  }

  async retireSigningKey(args: {
    agent: string;
    public_key: Buffer;
  }): Promise<AdapterResult<void>> {
    return this.run(
      "reasoning_registry",
      "@oracledesk/bindings-reasoning-registry",
      "retire_signing_key",
      args,
      (client) => client.retire_signing_key(args),
    );
  }

  async publishTraceSigned(args: {
    agent: string;
    market_id: bigint;
    action: TraceActionType | string;
    trace_hash: Buffer;
    ipfs_cid: string;
    signing_key: Buffer;
    signature: Buffer;
  }): Promise<AdapterResult<bigint>> {
    const action = typeof args.action === "string" ? toTraceAction(args.action) : args.action;
    const call = { ...args, action };
    return this.run(
      "reasoning_registry",
      "@oracledesk/bindings-reasoning-registry",
      "publish_trace_signed",
      call,
      (client) => client.publish_trace_signed(call),
    );
  }

  /**
   * Reads a market's price state. Unlike the write wrappers above, a read
   * always queries the network — through the bindings' simulation, which
   * never signs or submits — so it works identically in dry-run and live
   * mode and there is no offline stand-in to return.
   *
   * `useTwapSecs` additionally reads `twap(market_id, useTwapSecs)`: the
   * time-weighted average over that trailing window, which a single
   * transaction cannot move (see market-core's accumulator, issue #11).
   * Prefer it over spot for any automated trading loop.
   */
  async readMarket(
    marketId: bigint,
    opts: { useTwapSecs?: number } = {},
  ): Promise<MarketRead> {
    const client = await this.client<any>("market_core", "@oracledesk/bindings-market-core");
    const marketTx = await client.get_market({ market_id: marketId });
    const market = marketTx.result.unwrap() as {
      meta_uri: string;
      close_time: bigint;
      reserve_yes: bigint;
      reserve_no: bigint;
    };
    const priceTx = await client.get_price({
      market_id: marketId,
      outcome: { tag: "Yes", values: undefined },
    });
    const read: MarketRead = {
      marketId: Number(marketId),
      metaUri: market.meta_uri,
      closeTime: Number(market.close_time), // unix seconds, safe as number
      reserveYes: market.reserve_yes,
      reserveNo: market.reserve_no,
      yesBps: priceTx.result.unwrap() as number,
    };
    if (opts.useTwapSecs !== undefined) {
      const twapTx = await client.twap({
        market_id: marketId,
        window_secs: BigInt(opts.useTwapSecs),
      });
      read.twapBps = twapTx.result.unwrap() as number;
    }
    return read;
  }
}

function max0(value: bigint): bigint {
  return value > 0n ? value : 0n;
}

/**
 * Generated clients return `Result<T>` for fallible contract methods: an
 * `Err` becomes a thrown error carrying the contract error name (e.g.
 * `MarketAlreadyConfigured`), an `Ok` its value; anything else passes through.
 */
function unwrapContractResult<T>(methodName: string, result: T): T {
  const r = result as { isErr?: () => boolean; unwrapErr?: () => { message?: string }; unwrap?: () => unknown };
  if (typeof r?.isErr !== "function") return result;
  if (r.isErr()) {
    const e = r.unwrapErr?.();
    throw new Error(`${methodName} failed: ${e?.message ?? JSON.stringify(e)}`);
  }
  return r.unwrap!() as T;
}
