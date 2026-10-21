#!/usr/bin/env -S npx tsx
/**
 * Market Maker agent, one shot: polls signal sources, decides whether a
 * signal is confident enough to seed a market, builds and records a
 * reasoning trace, and (in "live" mode) creates the market through the
 * treasury. Skips markets whose question_hash already exists on-chain, and
 * signals already processed (live state in AGENT_STATE_PATH).
 *
 * A thin wrapper over the runtime's maker task (runtime/tasks/maker.ts), run
 * exactly once under the single-instance lease; `npm run agentd` runs the
 * same task continuously. Defaults to dry-run. Set AGENT_MODE=live and
 * MAKER_SECRET_KEY (or the shared AGENT_SECRET_KEY) to submit real testnet
 * transactions — see .env.example.
 */
import "dotenv/config";
import { EXIT_CONFIG, EXIT_TEMPFAIL, parseAgentMode } from "../runtime/config.js";
import { LeaseHeldError } from "../runtime/lease.js";
import { Runtime } from "../runtime/runtime.js";
import { makerTask } from "../runtime/tasks/maker.js";
import { buildAdapter, createLease, createStateStore, loadDeployments, makerDeps, runtimeOptions } from "../runtime/wiring.js";

async function main() {
  const mode = parseAgentMode(process.env);
  const deployments = loadDeployments();
  const adapter = buildAdapter("maker", mode, process.env, deployments);
  console.log(`[market-maker] mode=${mode}`);
  const runtime = new Runtime({
    tasks: [makerTask(makerDeps(process.env, adapter, deployments), { intervalMs: 0 })],
    state: await createStateStore(mode, process.env, deployments.contracts.treasury),
    lease: createLease(process.env),
    ...runtimeOptions(process.env),
  });
  await runtime.runOnce();
}

main().catch((err) => {
  console.error(err);
  process.exit(err instanceof LeaseHeldError ? EXIT_TEMPFAIL : err?.name === "ConfigError" ? EXIT_CONFIG : 1);
});
