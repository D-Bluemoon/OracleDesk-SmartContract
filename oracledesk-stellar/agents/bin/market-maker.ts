#!/usr/bin/env -S npx tsx
/**
 * Market Maker agent: polls signal sources, decides whether a signal is
 * confident enough to seed a market, builds and records a reasoning trace,
 * and (in "live" mode) creates the market through the treasury.
 * Skips markets whose question_hash already exists on-chain.
 *
 * Defaults to dry-run. Set AGENT_MODE=live and MAKER_SECRET_KEY (or the
 * shared AGENT_SECRET_KEY) to submit real testnet transactions — see
 * .env.example.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { buildTrace, canonicalize } from "../core/trace.js";
import { createTraceStore } from "../core/trace-store-factory.js";
import { decideMarketProposal, type MarketSignal, type SignalSource } from "../core/strategy.js";
import { agentCredentials, loadDeployments, StellarAdapter } from "../stellar/adapter.js";
import { ChainStateReader } from "../core/state/reader.js";
import { SnapshotCache } from "../core/state/cache.js";
import { existingQuestionHashes } from "../core/state/select.js";
import { Server } from "@stellar/stellar-sdk/rpc";

/** Placeholder signal source until a real one (news, an oracle feed, a
 * comparable market) is wired in — see docs/wave-issues for that as an
 * open issue. Deterministic so dry-runs are reproducible. */
const demoSignalSource: SignalSource = {
  name: "demo-fixture",
  async poll(): Promise<MarketSignal[]> {
    return [
      {
        summary: "Fixture signal for dry-run demonstration",
        proposedQuestion: "Will the OracleDesk Stellar port pass its testnet demo?",
        fairValueBps: 7500,
        source: "demo-fixture",
        observedAt: Math.floor(Date.now() / 1000),
      },
    ];
  },
};

async function main() {
  const mode = (process.env.AGENT_MODE as "dry-run" | "live") ?? "dry-run";
  const deployments = loadDeployments();
  const adapter = new StellarAdapter({
    mode,
    networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
    rpcUrl: process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org",
    ...agentCredentials("maker", process.env, deployments),
    deployments,
  });
  const { store: traceStore, kind: traceStoreKind } = createTraceStore(process.env, mode);

  // Load chain state to check for duplicate question hashes
  const rpcUrl = process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
  const server = new Server(rpcUrl);
  const stateReader = new ChainStateReader({
    marketContractId: deployments.market_contract ?? "",
    portfolioContractId: deployments.portfolio_contract ?? "",
    server,
  });
  const cache = new SnapshotCache();
  const snapshot = await cache.get(() => stateReader.readSnapshot([]));
  const knownHashes = existingQuestionHashes(snapshot);

  console.log(`[market-maker] mode=${mode}, known markets=${knownHashes.size}`);

  const signals = await demoSignalSource.poll();
  for (const signal of signals) {
    const decision = decideMarketProposal(signal, {
      confidenceThresholdBps: Number(process.env.CONFIDENCE_THRESHOLD_BPS ?? 1000),
      defaultSeedStroops: BigInt(process.env.DEFAULT_SEED_STROOPS ?? "1500000000"),
    });
    console.log(`[market-maker] ${decision.action}: ${decision.reasoning}`);
    if (decision.action === "skip") continue;

    const questionHash = createHash("sha256").update(decision.question!).digest();
    const questionHashHex = questionHash.toString("hex");

    // Skip if this question already has a market on-chain
    if (knownHashes.has(questionHashHex)) {
      console.log(`[market-maker] skipping duplicate question_hash=${questionHashHex}`);
      continue;
    }

    const built = buildTrace({
      agent: "market-maker",
      marketId: null,
      action: "propose_market",
      reasoning: decision.reasoning,
      inputs: { signal, decision },
    });
    const closeTime = BigInt(Math.floor(Date.now() / 1000) + 3600);

    // The trace (and, with the IPFS store, the market metadata) must be
    // pinned and verified before the create: never act without a
    // publishable trace.
    let cid: string;
    let metaUri: string;
    try {
      ({ cid } = await traceStore.put(built.hash, built.json));
      if (traceStoreKind === "ipfs") {
        const metaJson = canonicalize({
          question: decision.question,
          category: "Macro",
          closeTime,
          source: signal.source,
          traceHash: built.hash,
          traceCid: cid,
        });
        const metaHash = createHash("sha256").update(metaJson).digest("hex");
        metaUri = `ipfs://${(await traceStore.put(metaHash, metaJson)).cid}`;
      } else {
        metaUri = `local://${built.hash}`;
      }
    } catch (err) {
      console.error(`[market-maker] skipped: trace ${built.hash} could not be stored:`, err);
      continue;
    }
    console.log(`[market-maker] trace ${built.hash} -> ${cid}, meta_uri=${metaUri}`);

    const placeholderResolutionHash = createHash("sha256").update("unrevealed").digest();

    const result = await adapter.agentCreateMarket({
      question_hash: questionHash,
      resolution_hash: placeholderResolutionHash,
      meta_uri: metaUri,
      category: { tag: "Macro", values: undefined },
      close_time: closeTime,
      seed_amount: decision.seedAmountStroops!,
      initial_yes_bps: decision.initialYesBps!,
    });
    console.log("[market-maker] agent_create_market:", result);

    if (!result.dryRun) {
      const traceResult = await adapter.publishTrace({
        agent: adapter.agent,
        market_id: result.value,
        action: "create_market",
        trace_hash: Buffer.from(built.hash, "hex"),
        ipfs_cid: cid,
      });
      console.log("[market-maker] publish_trace:", traceResult);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
