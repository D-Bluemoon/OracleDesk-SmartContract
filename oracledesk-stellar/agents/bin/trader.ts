#!/usr/bin/env -S npx tsx
/**
 * Trader agent, one shot: reads chain state, compares implied price to a
 * fair-value estimate, and trades the mispricing if the edge clears the
 * configured threshold. Every trade is preceded by a recorded trace.
 *
 * Bounds are never zero: the trade size comes from the strategy, then a
 * fresh `quote_buy` immediately before submission turns into
 * `min_shares_out` (quote minus SLIPPAGE_BPS) and a `limit_price_bps`
 * backstop, plus a `deadline` — so a stale or sandwiched transaction
 * reverts on-chain instead of executing at an arbitrary price.
 *
 * A thin wrapper over the runtime's trader task (runtime/tasks/trader.ts),
 * run exactly once under the single-instance lease; `npm run agentd` runs
 * the same task continuously. Defaults to dry-run. Set AGENT_MODE=live and
 * TRADER_SECRET_KEY (or the shared AGENT_SECRET_KEY) to submit real testnet
 * transactions — see .env.example. Configuration is validated by
 * core/config.ts first; `--print-config` prints it (secret redacted) and
 * exits, `--offline` skips the network probes in dry-run.
 */
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { describeConfig, loadAgentConfig, type Tunables } from "../core/config.js";
import { ConfigError, EXIT_CONFIG, EXIT_TEMPFAIL } from "../runtime/config.js";
import { LeaseHeldError } from "../runtime/lease.js";
import { Runtime } from "../runtime/runtime.js";
import { traderTask } from "../runtime/tasks/trader.js";
import { buildAdapter, createLease, createStateStore, runtimeOptions, traderDeps } from "../runtime/wiring.js";
import type { StellarAdapter } from "../stellar/adapter.js";

/**
 * Exported (and injectable) so tests can drive the whole trade flow with a
 * fake adapter and clock. `now` returns unix seconds. An adapter bound to a
 * deployment reads markets from chain state; one without (a test fake)
 * trades the demo fixture market. `run` is the validated config (or, in
 * tests, `parseTunables(env)`).
 */
export async function main(
  adapter: StellarAdapter,
  run: Tunables,
  now: () => number = () => Math.floor(Date.now() / 1000),
): Promise<void> {
  const deployments = (adapter as Partial<StellarAdapter>).deployments;
  const runtime = new Runtime({
    tasks: [traderTask(traderDeps(run, adapter, deployments, now), { intervalMs: 0 })],
    state: await createStateStore(adapter.mode, run.env, deployments?.contracts.treasury ?? "unbound"),
    lease: createLease(run.env),
    ...runtimeOptions(run.env),
  });
  await runtime.runOnce();
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  loadAgentConfig({ role: "trader" })
    .then((cfg) => {
      if (cfg.printConfig) {
        console.log(JSON.stringify(describeConfig(cfg), null, 2));
        return;
      }
      console.log(`[trader] mode=${cfg.mode} network=${cfg.network}`);
      return main(buildAdapter(cfg), cfg);
    })
    .catch((err) => {
      console.error(err instanceof ConfigError ? err.message : err);
      process.exit(err instanceof LeaseHeldError ? EXIT_TEMPFAIL : err instanceof ConfigError ? EXIT_CONFIG : 1);
    });
}
