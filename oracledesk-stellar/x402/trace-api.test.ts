import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import {
  createTraceApi,
  type TraceListPage,
  type TraceListRepository,
  type TraceRepository,
} from "./trace-api.js";

// A valid-looking `G...` address; the payment middleware only needs the shape
// at construction time, and the listing routes below never reach it.
const PAY_TO = "GCM7WU3RADBCIKBLGPPAEYV5WHASWMEQX6BU524QR3QFWSE7BIWCXAIF";

const emptyRepository: TraceRepository = {
  async get() {
    return undefined;
  },
};

function listingRepository(page: TraceListPage): TraceListRepository {
  return {
    async listByAgent() {
      return page;
    },
    async listByMarketAction() {
      return page;
    },
  };
}

async function withServer<T>(
  app: ReturnType<typeof createTraceApi>,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function buildApp(listRepository?: TraceListRepository) {
  return createTraceApi({
    repository: emptyRepository,
    listRepository,
    ipfsGateway: "https://ipfs.example/ipfs",
    price: "0.01",
    networks: [
      {
        network: "stellar:testnet",
        payTo: PAY_TO,
        facilitatorUrl: "http://127.0.0.1:9",
      },
    ],
    fetchImpl: async () => {
      throw new Error("no IPFS fetch expected on a listing route");
    },
  });
}

test("agent listing is served without payment and never includes a CID", async () => {
  const page: TraceListPage = {
    items: [
      {
        traceId: "0",
        traceHash: "ab".repeat(32),
        marketId: "7",
        agent: "GAGENT",
        action: "buy",
        publishedAt: "1",
      },
    ],
    next: "1",
    total: "1",
  };

  await withServer(buildApp(listingRepository(page)), async (baseUrl) => {
    // No `X-PAYMENT`/`PAYMENT-SIGNATURE` header at all.
    const response = await fetch(`${baseUrl}/agents/GAGENT/traces`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as TraceListPage;
    assert.deepEqual(body, page);
    assert.equal("ipfsCid" in body.items[0], false);
  });
});

test("market/action listing requires an action and is unpaid", async () => {
  await withServer(buildApp(listingRepository({ items: [], next: "0", total: "0" })), async (baseUrl) => {
    const missingAction = await fetch(`${baseUrl}/markets/7/traces`);
    assert.equal(missingAction.status, 400);

    const response = await fetch(`${baseUrl}/markets/7/traces?action=buy&limit=10`);
    assert.equal(response.status, 200);
  });
});

test("listing routes are absent when no listing repository is configured", async () => {
  await withServer(buildApp(undefined), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/agents/GAGENT/traces`);
    assert.equal(response.status, 404);
  });
});
