import type { RequestHandler } from "express";
import express, { type Express, type Request, type Response } from "express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import {
  parseTraceLocator,
  checkCidAgainstTraceHash,
  gatewayUrl,
  verifyTraceHash,
  type TraceRecord,
} from "./trace-verification.js";

export type { TraceRecord };

export interface TraceRepository {
  get(traceId: string): Promise<TraceRecord | undefined>;
  getFull?(traceId: string): Promise<(TraceRecord & { marketId?: bigint; agent?: string }) | undefined>;
  market_trace_count?(args: { market_id: bigint }): Promise<bigint>;
  market_trace_at?(args: { market_id: bigint; index: bigint }): Promise<bigint | null>;
  trace_count?(): Promise<bigint>;
}

/**
 * A trace row as returned by the reasoning-registry's paginated secondary
 * indexes (#57). Unlike {@link TraceRecord} it is metadata only: the IPFS
 * body is fetched and hash-verified only by the *paid* `GET /traces/:traceId`.
 *
 * Deliberately carries **no `ipfsCid`**: the listing routes are unpaid, and
 * returning the CID would let a caller fetch the content straight from the
 * gateway and bypass the paywall.
 */
export interface TraceListEntry {
  traceId: string;
  traceHash: string;
  marketId: string;
  agent: string;
  action: string;
  publishedAt: string;
}

export interface TraceListPage {
  items: TraceListEntry[];
  /** Index of the first entry the next page would return. */
  next: string;
  total: string;
}

/**
 * Optional listing surface backed by the reasoning-registry's #57 indexes:
 * "everything agent X published" and "every Buy decision on market 7".
 */
export interface TraceListRepository {
  listByAgent(agent: string, cursor?: string, limit?: number): Promise<TraceListPage>;
  listByMarketAction(
    marketId: string,
    action: string,
    cursor?: string,
    limit?: number,
  ): Promise<TraceListPage>;
}

export interface TracePaymentNetwork {
  network: "stellar:testnet" | "stellar:pubnet";
  payTo: string;
  facilitatorUrl: string;
  facilitatorApiKey?: string;
}

export interface TraceApiOptions {
  repository: TraceRepository;
  /** Present only when the deployment has a reasoning-registry configured. */
  listRepository?: TraceListRepository;
  ipfsGateway: string;
  price: string;
  networks: TracePaymentNetwork[];
  fetchImpl?: typeof fetch;
  /**
   * Test-harness hook: skip the x402 payment middleware entirely. The local
   * E2E harness verifies the registry lookup and on-chain hash path without a
   * facilitator. Never set this in a paid deployment.
   */
  paymentsDisabled?: boolean;
}

export class MapTraceRepository implements TraceRepository {
  public constructor(private readonly records: ReadonlyMap<string, TraceRecord>) {}

  public async get(traceId: string): Promise<TraceRecord | undefined> {
    return this.records.get(traceId);
  }
}

async function loadVerifiedTrace(
  repository: TraceRepository,
  gateway: string,
  traceId: string,
  fetchImpl: typeof fetch,
): Promise<{ record: TraceRecord; content: unknown; verification: object } | undefined> {
  const record = await repository.get(traceId);
  if (!record) return undefined;

  const locator = parseTraceLocator(record.ipfsCid);
  if (locator.kind === "unsupported") {
    throw new Error(`Unsupported trace locator: ${locator.reason}`);
  }

  let url: string;
  if (locator.kind === "ipfs") {
    url = gatewayUrl(gateway, locator.cid, locator.path);
  } else {
    throw new Error("Local traces not supported in this context");
  }

  const cidCheck = checkCidAgainstTraceHash(locator, record.traceHash);

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`IPFS gateway returned HTTP ${response.status}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!verifyTraceHash(bytes, record.traceHash)) {
    throw new Error(`Trace ${traceId} failed on-chain hash verification`);
  }

  try {
    return {
      record,
      content: JSON.parse(new TextDecoder().decode(bytes)),
      verification: {
        traceHash: true,
        cid: cidCheck.level,
      },
    };
  } catch {
    throw new Error(`Trace ${traceId} is not valid JSON`);
  }
}

export function createVerdictPrePaymentMiddleware(options: TraceApiOptions): RequestHandler {
  return async (req: Request, res: Response, next) => {
    const verdictPolicy = options.verdictPolicy ?? "refuse";
    if (verdictPolicy === "refuse") {
      try {
        const traceId = Array.isArray(req.params.traceId)
          ? req.params.traceId[0]
          : req.params.traceId;
        const record = await options.repository.get(traceId);
        if (record && record.verdict && record.verdict.tag !== "Valid") {
          res.status(410).json({ error: "Trace verdict is not valid", verdict: record.verdict });
          return;
        }
      } catch {
        // Continue to payment handler on lookup error
      }
    }
    next();
  };
}

export function createTraceRouteHandler(
  options: TraceApiOptions,
  fetchImpl: typeof fetch = options.fetchImpl ?? fetch,
): RequestHandler {
  return async (req: Request, res: Response) => {
    try {
      const traceId = Array.isArray(req.params.traceId)
        ? req.params.traceId[0]
        : req.params.traceId;
      const result = await loadVerifiedTrace(
        options.repository,
        options.ipfsGateway,
        traceId,
        fetchImpl,
      );
      if (!result) {
        res.status(404).json({ error: "Trace not found" });
        return;
      }
      const responseData: Record<string, unknown> = {
        traceId: result.record.traceId,
        traceHash: result.record.traceHash,
        content: result.content,
      };
      if (options.verdictPolicy === "label" && result.record.verdict) {
        responseData.verdict = result.record.verdict;
      }
      res.json(responseData);
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : "Trace retrieval failed",
      });
    }
  };
}

function createPaymentHandler(config: TracePaymentNetwork, options: TraceApiOptions): RequestHandler {
  const facilitator = new HTTPFacilitatorClient({
    url: config.facilitatorUrl,
    createAuthHeaders: config.facilitatorApiKey
      ? async () => {
          const headers = { Authorization: `Bearer ${config.facilitatorApiKey}` };
          return { verify: headers, settle: headers, supported: headers };
        }
      : undefined,
  });
  const x402Server = new x402ResourceServer(facilitator).register(
    config.network,
    new ExactStellarScheme(),
  );

  const accepts = [{
    scheme: "exact",
    price: options.price,
    network: config.network,
    payTo: config.payTo,
  }];
  return paymentMiddleware(
    {
      // Only the content route is paid. The #57 listing routes below are
      // intentionally absent from this map: the middleware matches per route
      // key, so unlisted paths pass through unpaid. Listings expose metadata
      // only (no CID, no content), so there is nothing to paywall.
      "GET /traces/:traceId": {
        accepts,
        description: "Paid access to an OracleDesk reasoning trace",
      },
    },
    x402Server,
  );
}

export function createTraceApi(options: TraceApiOptions): Express {
  if (options.networks.length === 0 && !options.paymentsDisabled) {
    throw new Error("At least one x402 Stellar payment network is required");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const app = express();

  if (!options.paymentsDisabled) {
    for (const network of options.networks) {
      app.use(createPaymentHandler(network, options));
    }
  } else {
    console.warn("OracleDesk x402: payment middleware disabled (test harness only)");
  }

  app.get("/traces/:traceId/meta", async (req: Request, res: Response) => {
    try {
      const traceId = Array.isArray(req.params.traceId)
        ? req.params.traceId[0]
        : req.params.traceId;

      const record = await options.repository.get(traceId);
      if (!record) {
        res.status(404).json({ error: "Trace not found" });
        return;
      }

      res.set("Cache-Control", "public, max-age=300");
      res.json({
        traceId,
        ipfsCid: record.ipfsCid,
        traceHash: record.traceHash,
        price: options.price,
        verification: { status: "pending" },
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Metadata retrieval failed",
      });
    }
  });

  app.get("/.well-known/x402", (req: Request, res: Response) => {
    const manifest = {
      version: 1,
      resources: [
        {
          path: "/traces/:traceId",
          method: "GET",
          price: options.price,
          description: "Access to a single reasoning trace",
          networks: options.networks.map((n) => ({
            network: n.network,
            payTo: n.payTo,
          })),
        },
      ],
      discovery: {
        meta: "/traces/:traceId/meta",
      },
    };
    res.set("Cache-Control", "public, max-age=3600");
    res.json(manifest);
  });

  app.get("/traces/:traceId", async (req: Request, res: Response) => {
    try {
      const traceId = Array.isArray(req.params.traceId)
        ? req.params.traceId[0]
        : req.params.traceId;

      const result = await loadVerifiedTrace(
        options.repository,
        options.ipfsGateway,
        traceId,
        fetchImpl,
      );
      if (!result) {
        res.status(404).json({ error: "Trace not found" });
        return;
      }
      res.json({
        traceId: result.record.traceId,
        traceHash: result.record.traceHash,
        content: result.content,
        verification: result.verification,
      });
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : "Trace retrieval failed",
      });
    }
  });

  // #57: unpaid paginated listings over the registry's agent and
  // (market, action) indexes. Metadata only (never a CID or content), so no
  // IPFS fetch and no payment; each page is one simulation. These routes are
  // not in the payment middleware's route map, so they pass through unpaid.
  const listRepository = options.listRepository;
  if (listRepository) {
    const parsePaging = (
      req: Request,
    ): { cursor: string; limit: number } | { error: string } => {
      const cursor =
        typeof req.query.cursor === "string" && req.query.cursor !== "" ? req.query.cursor : "0";
      const rawLimit = typeof req.query.limit === "string" ? req.query.limit : "25";
      const limit = Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
        return { error: "limit must be an integer between 1 and 25" };
      }
      if (!/^\d+$/.test(cursor)) {
        return { error: "cursor must be a non-negative integer" };
      }
      return { cursor, limit };
    };

    app.get("/agents/:agent/traces", async (req: Request, res: Response) => {
      const paging = parsePaging(req);
      if ("error" in paging) {
        res.status(400).json({ error: paging.error });
        return;
      }
      const agent = Array.isArray(req.params.agent) ? req.params.agent[0] : req.params.agent;
      try {
        res.json(await listRepository.listByAgent(agent, paging.cursor, paging.limit));
      } catch (error) {
        res.status(502).json({
          error: error instanceof Error ? error.message : "Trace listing failed",
        });
      }
    });

    app.get("/markets/:marketId/traces", async (req: Request, res: Response) => {
      const action = typeof req.query.action === "string" ? req.query.action : "";
      if (action === "") {
        res.status(400).json({ error: "action query parameter is required" });
        return;
      }
      const paging = parsePaging(req);
      if ("error" in paging) {
        res.status(400).json({ error: paging.error });
        return;
      }
      const marketId = Array.isArray(req.params.marketId)
        ? req.params.marketId[0]
        : req.params.marketId;
      if (!/^\d+$/.test(marketId)) {
        res.status(400).json({ error: "marketId must be a non-negative integer" });
        return;
      }
      try {
        res.json(
          await listRepository.listByMarketAction(marketId, action, paging.cursor, paging.limit),
        );
      } catch (error) {
        res.status(502).json({
          error: error instanceof Error ? error.message : "Trace listing failed",
        });
      }
    });
  }

  return app;
}
