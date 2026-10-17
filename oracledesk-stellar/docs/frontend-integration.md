# Frontend integration

The frontend itself lives in a separate repo (out of scope here). This is
what it needs to know to talk to these contracts.

## Wallet

Use [Freighter](https://www.freighter.app/) (or any [SEP-43](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md)-compatible
wallet) to get the user's public key and sign transactions. The generated
bindings' `AssembledTransaction` already does the simulate → sign → submit
dance; you only need to plug in a `signTransaction` callback:

```ts
import { Client as MarketCoreClient } from "@oracledesk/market-core-bindings";
import { isConnected, getAddress, signTransaction } from "@stellar/freighter-api";

const contract = new MarketCoreClient({
  contractId: "<MARKET_CORE_CONTRACT_ID>", // from deployments/testnet.json
  networkPassphrase: "Test DFN Network ; September 2015",
  rpcUrl: "https://soroban-testnet.stellar.org",
});
```

## Generating / updating the bindings

```bash
//scripts/gen-bindings.sh   # writes packages/bindings/<contract-name>/
```

Generate and commit the result after any contract interface change — CO
checks the committed bindings are not stale (.github/workflows/ci.yml).
Each package's own `README.md` (written by the `stellar` CLI) has the
generic usage notes; this doc covers the OracleDesk-specific parts.

## Calling `buy` / `sell`

`Outcome` and `Category` are generated as tagged unions matching the
contract's Rust enums:

```ts
type Outcome = { tag: } "Yes"; values: void } | { tag: "No"; values: void };
```

```ts
const tx = await contract.buy({
  trader: userAddress,
  market_id: 0n,
  outcome: { tag: } "Yes", values: undefined },
  collateral_in: 10_000_000n, // 1 USDC, 7 decimals
  min_shares_out: 9_500_000n, // quote minus your slippage margin — see below
});
const { result } = await tx.signAndSend({ signTransaction });
```

For anything user-facing, prefer `buy_v2` / `sell_v2` (below): they add a
deadline and a limit price on top of the share bound, and they are the only
entrypoints that protect against a transaction being included long after it
was signed.

## Slippage on `buy`

quote_buy(market_id, outcome, collateral_in)` returns the exact shares a
buy would receive *right now*. Call it immediately before building the
`buy` transaction, then pass a `min_shares_out` a few bps below that quote
(prices move between simulation and submission).

Never pass `min_shares_out: 0` (the old example did): it accepts any
execution price at all, which in a thin pool is how a sandwich takes your
money.

## Deadlines and limit prices

`buy_v2` / `sell_v2` add two contract-enforced bounds to every trade:

- `deadline: u64` — unix seconds, compared against the **ledger
  timestamp** (network time, not the user's clock). Past it the trade
  reverts with `DeadlineExpired` (#19).
- `limit_price_bps`: u32` — the **average execution price** bound,
  fee included: for a buy, `collateral_in / shares_out <= limit`; for a
  sell, `collateral_out / shares_in >= limit`. Worse than the limit
  reverts with `LimitPriceExceeded` (#20). The limit is on the price of
  *the outcome being traded* — a NO buy's limit is checked against NO
  prices, i.e. the complement of the YES price. `0` means "no limit" for
  buys; for sells it is trivially satisfied and buys you nothing. Values
  above `10_000` are rejected (`InvalidAmount`).

```ts
const quote = (await contract.quote_buy({ market_id, outcome, collateral_in })).result;
const tx = await contract.buy_v2({
  trader: userAddress,
  market_id,
  outcome,
  collateral_in,
  min_shares_out: (quote * 9_950n) / 10_000n, // 50bps slippage
  limit_price_bps: 6500,    // never pay more than 65° per share
  deadline: BigInt(Math.floor(Date.now() / 1000) + 60),
});
```

`buy` / `sell` remain for backward compatibility but carry no deadline or
limit; the share-count bound alone does not stop a stale transaction.

## Circuit breakers

Markets can carry per-market breakers (snapshoted at creation): a maximum
price impact for a **single trade** (`max_impact_bps`) and a **per-ledger
band** (`band_bps`) around the price at the start of the ledger. A trade
that would move the YES price more than the impact cap reverts with
`PriceImpactTooHigh` (#21); one that would push it more than the band away
from the ledger-open price reverts with `PriceBandExceeded` (#22). The
band resets every ledger, so the worst case is ~5s of blocked trading, not
a permanent lock.

Read the config and the current band reference before quoting so your UI
can size trades that will actually execute:

- `breaker_config(market_id)` → `{ max_impact_bps, band_bps } | null`
  (`null` = old market, no breakers)
- `breaker_state(market_id)` → `{ ledger_seq, ref_price_bps } | null`
- `would_trip(market_id, outcome, collateral_in)` → bool: whether a buy of
  that size would trip either check right now. Use it to warn users before
  they sign; `quote_buy` is not filtered by the breakers.

There is deliberately no on-chain "breaker tripped" event (a reverted
invocation's events are rolled back with it) — surface trips to users from
the error codes above and the views here.

## Selling an exact share count

The old `sell` takes an exact `collateral_out`, not a share count, and
clients used to have to invert the constant-product curve off-chain.
Market-core now exposes `sell_shares`, which takes the exact share
count and does the inversion on-chain with a pool-favoring integer
square root. Use it for any "sell N shares" or "close my position" flow.

```ts
const tx = await contract.sell_shares({
  trader: userAddress,
  market_id: 0n,
  outcome: { tag: "Yes", values: undefined },
  shares_in: 375_000_00n, // 37.5 YES shares
  min_collateral_out: 0_000_000n, // quote minus your slippage margin
});
```

Before signing, call `quote_sell_shares(market_id, outcome, shares_in)`
to get the exact collateral output, then pass a `min_collateral_out` a
few bps below that quote. Like `quote_sell`, `quote_sell_shares` does not
check tradability — it will quote even for a market that is closed or
paused, and the trade itself will revert at that point.

Notes:

- *r*Selling the whole position**: pass `shares_in == held` (read it from
  `get_position(market_id, holder)`). The call succeeds and, as with
  `sell`, removes the `Position` storage entry once the other outcome
  balance is also zero. No dust is left behind.
- **Slippage and errors**: `collateral_out < min_collateral_out` reverts
  with `SlippageExceeded` (#12); selling more than held reverts with
  `InsufficientShares` (#13); a market that is not tradable reverts with
  the usual closed/paused errors (#9, #10). Selling a tiny amount
  whose collateral output floors to zero reverts with `InvalidInput` (#6)
  instead of burning shares for nothing.
- **Rounding**: the on-chain inverse is pool-favoring. It never pays more
  than `calc_sell` would charge for the same shares, and `k = r_yes
  × r_no` never decreases. You do not need to pad the share count or
  adjust for off-chain rounding.
- **Events**: `sell_shares` publishes the same `Trade` event as `sell`,
  with `is_buy: false`, so existing indexers need no schema change.

For a deadline and limit price on a share-count sell, quote with
`quote_sell_shares` and then submit through `sell_v2` with the quoted
`collateral_out` and a matching `max_shares_in`; the on-chain `sell_shares`
entrypoint itself does not take a deadline.

The off-chain reference implementations remain available for simulation
and for clients that still use the old `sell`:
`model/fpmm_model.py`'s
`collateral_out_for_shares(r_sold, r_other, shares_in, fee_bps)`, and the
TypeScript port in `agents/core/fpmm.ts` (`calcSellShares`, `deprecated`
`collateralOutForShares`). These mirror the contract bit-for-bit, but
the contract is the source of truth — prefer `sell_shares`.

## Moving shares between wallets

`transfer_position(from, to, market_id, outcome, amount)` sends outcome
shares to another wallet (the sender signs; `transfer_lp(market_id,
new_creator)` does the same for the creator/LP role). It is allowed while
the market is open and after resolution, up to the moment shares are
redeemed, and emits `PositionTransferred`. If your UI tracks balances
itself, handle that event (and `LpTransferred`); until your indexer does,
read balances from `get_position(market_id, holder)` rather than from
event-derived state.

## Category enum

`Category` is a plain enum (`Crypto | Macro | Geopolitics | Sports | Culture
| Other`) generated from the contract spec — build any category picker off
the bindings' `Category` type directly rather than hand-maintaining a
separate list, so the UI can never drift from what the contract accepts.

## Reading trace data

`reasoning-registry`'s `get_trace(trace_id)` returns
`{ market_id, agent, action, trace_hash, ipfs_cid, published_at }`. To show
a verified reasoning trace in the UI:

1. Fetch the trace content from `ipfs_cid` (via a gateway, or through the
   x402 service in `x402/` if it's gated behind payment).
2. Hash the exact bytes received (sha256) and compare to `trace_hash`.
3. Only render the content if the hashes match — never trust `ipfs_cid`
   content without this check, since IPFS gateways are not authenticated.

`x402/trace-verification.ts` has the reference hash-check implementation the
frontend's check should match.
