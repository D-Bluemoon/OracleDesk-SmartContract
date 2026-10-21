#!/usr/bin/env -S npx tsx
/**
 * Trader agent: reads live chain state, compares implied price to a
 * fair-value estimate, and trades the mispricing if the edge clears the
 * configured threshold. Every trade is preceded by a recorded trace.
 *
 * Bounds are never zero: the trade size comes from the strategy, then a
 * fresh `quote_buy` immediately before submission turns into
 * `min_shares_out` (quote minus SLIPPAGE_BPS) and a `limit_price_bps`
 * backstop, plus a `deadline` — so a stale or sandwiched transaction
 * reverts on-chain instead of executing at an arbitrary price.
 *
 * Defaults to dry-run. Set AGENT_MODE=live and TRADER_SECRET_KEY (or the
 * shared AGENT_SECRET_KEY) to submit real testnet transactions — see
 * .env.example.
 */
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { buildTrace, LocalTraceStore } from "../core/trace.js";
import { BPS } from "../core/fpmm.js";
import { decideTrade, type MarketState } from "../core/strategy.js";
import { agentCredentials, loadDeployments, StellarAdapter } from "../stellar/adapter.js";
import { ChainStateReader } from "../core/state/reader.js";
import { SnapshotCache } from "../core/state/cache.js";
import { tradableMarkets, availableCapital } from "../core/state/select.js";
import { toMarketState } from "../core/state/types.js";
import { Server } from "@stellar/stellar-sdk/rpc";

/**
 * Exported (and injectable) so tests can drive the whole trade flow with a
 * fake adapter and clock. `now` returns unix seconds.
 */
export async function main(
  adapter: StellarAdapter,
  env: NodeJS.ProcessEnv = process.env,
  now: () => number = () => Math.floor(Date.now() / 1000),
): Promise<void> {
  const traceStore = new LocalTraceStore(env.TRACE_STORE_DIR ?? "./.traces");
  const deployments = adapter.deployments ?? {};

  const rpcUrl = env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
  const server = new Server(rpcUrl);
  const stateReader = new ChainStateReader({
    marketContractId: deployments.market_contract ?? "",
    portfolioContractId: deployments.portfolio_contract ?? "",
    server,
  });
  const cache = new SnapshotCache();

  console.log(`[trader] mode=${adapter.mode}`);

  const snapshot = await cache.get(() => stateReader.readSnapshot([]));

  if (!snapshot.consistent) {
    console.warn(`[trader] ledger drift ${snapshot.ledgers.max - snapshot.ledgers.min} — snapshot may be inconsistent`);
  }

  const markets = tradableMarkets(snapshot);
  if (markets.length === 0) {
    console.log("[trader] no tradable markets on-chain");
    return;
  }

  const capital = availableCapital(snapshot);
  const tradeSizeStroops = BigInt(env.TRADE_SIZE_STROOPS ?? "100000000");
  if (capital < tradeSizeStroops) {
    console.log(`[trader] insufficient capital: ${capital} < ${tradeSizeStroops}`);
    return;
  }

  for (const chainMarket of markets) {
    const market: MarketState = toMarketState(chainMarket);
    // Fair value: use env override or default to complement of current price
    // (the agent holds no external oracle right now — strategy.ts decides edge)
    const fairValueBps = Number(env.FAIR_VALUE_BPS ?? String(market.yesBps));

    const decision = decideTrade(market, fairValueBps, {
      minEdgeBps: Number(env.MIN_EDGE_BPS ?? 500),
      tradeSizeStroops,
    });
    console.log(`[trader] market=${market.marketId} ${decision.action}: ${decision.reasoning}`);
    if (decision.action === "skip") continue;

    const built = buildTrace({
      agent: "trader",
      marketId: market.marketId,
      action: "buy",
      reasoning: decision.reasoning,
      inputs: { market, fairValueBps, decision },
    });
    const { cid } = await traceStore.put(built.hash, built.json);
    console.log(`[trader] trace ${built.hash} -> ${cid}`);

    const outcome = decision.outcome as "Yes" | "No";
    const collateralInStroops = decision.tradeSizeStroops!;

    const quotedShares = await adapter.quoteBuy({
      market_id: BigInt(market.marketId),
      outcome,
      collateral_in: collateralInStroops,
    });
    const slippageBps = BigInt(env.SLIPPAGE_BPS ?? 50);
    const minSharesOut = (quotedShares * (BPS - slippageBps)) / BPS;
    const limitPriceBps = decision.outcome === "Yes" ? fairValueBps : Number(BPS) - fairValueBps;
    const deadline = BigInt(now() + Number(env.DEADLINE_SECS ?? 60));
    console.log(
      `[trader] quote ${quotedShares} shares -> min_shares_out=${minSharesOut} limit_price_bps=${limitPriceBps} deadline=${deadline}`,
    );

    const result = await adapter.agentBuyV2({
      market_id: BigInt(market.marketId),
      outcome,
      collateral_in: collateralInStroops,
      min_shares_out: minSharesOut,
      limit_price_bps: limitPriceBps,
      deadline,
    });
    console.log("[trader] agent_buy_v2:", result);

    if (!result.dryRun) {
      const traceResult = await adapter.publishTrace({
        agent: adapter.agent,
        market_id: BigInt(market.marketId),
        action: "buy",
        trace_hash: Buffer.from(built.hash, "hex"),
        ipfs_cid: cid,
      });
      console.log("[trader] publish_trace:", traceResult);
    }
  }
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const mode = (process.env.AGENT_MODE as "dry-run" | "live") ?? "dry-run";
  const deployments = loadDeployments();
  const adapter = new StellarAdapter({
    mode,
    networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
    rpcUrl: process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org",
    ...agentCredentials("trader", process.env, deployments),
    deployments,
  });
  main(adapter).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
