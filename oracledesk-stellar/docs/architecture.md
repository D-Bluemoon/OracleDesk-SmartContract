# Architecture

See the top-level diagram in [README.md](../README.md#architecture) for the
system at a glance. This doc goes one level deeper into each contract's
responsibilities and the invariants that hold across them.

## Contracts

### market-core

The hub: every binary market lives here as one entry in persistent storage,
keyed by `market_id`. Pricing is a Gnosis-style constant-product FPMM over
internal YES/NO share accounting — no external LP token, no AMM pool
contract per market. `contracts/market-core/src/math.rs` is the entire
pricing engine, pure integer arithmetic, no `Env` dependency, so it's
natively unit-testable and mirrored line-for-line in
[`model/fpmm_model.py`](../model/fpmm_model.py) and
`agents/core/fpmm.ts` for property testing and off-chain quoting.

**Solvency invariant** (holds after every state transition — see the test
suite for the ones exercised): the contract's own SEP-41 token balance for a
market equals `sets_minted + fees_accrued`, and `reserve_yes + Σ(user yes
positions) == sets_minted` (symmetrically for `no`).

**Runtime enforcement.** The invariant is no longer just a test
property. Every collateral movement in market-core goes through a
checked transfer helper that measures the actual balance delta, and a
global locked-collateral counter is updated on every inflow and outflow.
Every market shares one token balance held at the market-core address, so
the contract no longer trusts that every `token.transfer` moved exactly
the requested amount.

#### Runtime solvency accounting

The contract maintains a global counter and a per-market figure:

-  `DataKey::TotalLocked` (instance, `i128`, initialised to `0` in the
    constructor): the sum over all markets of collateral the contract
    still owes (unredeemed claims plus unswept fees).
-  `DataKey::Locked(market_id)` (persistent, `ii128`, same TT\ policy as
    `Market`): the per-market share of that obligation. It is kept in a
    separate entry so the `Market` XDR layout does not change.

Every collateral movement goes through `transfer_in` / `transfer_out`,
which measure the actual balance delta around the transfer:

-  *Inbound* transfers must increase the contract balance by exactly the
    requested amount. Any mismatch reverts with `Error::CollateralMismatch`.
-  *Outbound* transfers must decrease it by exactly the amount (else
    `CollateralMismatch`), and after the decrement of `TotalLocked` the
    global guard checks `token.balance(contract) >= TotalLocked`.
    Otherwise the call reverts with `Error::Insolvent`.

The accounting rules are exactly:

| Site                     | Direction           | `Locked` / `TotalLocked` delta |
|--------------------------|------------------|------------------------------|
| `create_market`          | creator -> contract | `+= seed_amount`                |
| `buy`                     | trader -> contract | `+= collateral_in` (net + fee)      |
| `sell`                    | contract -> trader | `-= collateral_out`                |
| `redeem`                  | contract -> holder | `-= payout`                        |
| `claim_pool_remainder`    | contract -> creator| `-= payout`                       |
| `sweep_fees`              | contract -> recipient| `-= amount`                        |

Notes on the rules:

- `buy` locks `collateral_in = net + fee`, because `net` mints sets and
  `fee` accrues to the protocol/LP shares. The fee remains inside
  `locked` until `sweep_fees` / `claim_lp_fees` / `claim_pool_remainder`
  subtract it — it is never double-counted.
- `sell` burns gross sets and pays out `collateral_out`; the fee
  `gross - out` stays in the market's fee accrual, and the locked delta is
  only the cash actually leaving.
- `claim_pool_remainder` zeroes the reserves and subtracts the payout
  from `locked`. After this claim, `sets_minted`+`$fees_accrued` is no
  longer the correct figure for what the market still owes; the
  solvency report uses `locked` alone in that state.
- `sweep_fees` subtracts the swept amount from `locked`.
- Any negative result returns `Error::Overflow` (with a `debug_assert`
  in debug builds).

The global guard is the only check that can be made against the shared
ledger balance: a per-market figure cannot be verified on-chain because
the balance is shared across markets. Donations (anyone sending tokens
directly to the contract) make `balance > TotalLocked`, which is
normal and must not revert.

**Views.** `solvency_report(market_id)` returns a `SolvencyReport`
with the market's locked collateral, fees accrued, sets minted, and
 outstanding-claims upper bound (`sets_minted + fees_accrued` while
open or unclaimed, derived from `locked` alone after the LP claim),
plus `lp_claimed`. `global_solvency()` returns `(token.balance(contract),
TotalLocked)`. The per-market figure is an audit aid, not an enforced
check; the global guard is the enforced one.

**Misbehaving collateral.** A fee-on-transfer or rebasing SEP-41 token, a
Classic asset whose issuer has `AUTH_CLAWBACK_ENABLED` and claws back
from the contract, or a buggy custom collateral each make the contract hold
less than it owes. The balance-delta checks reject fee-on-transfer
collateral at the first inflow (`CollateralMismatch`). If the issuer claws
back between transactions, the next outbound transfer trips `Insolvent`.
That freezes payouts globally — intentional fail-safe behaviour, so the
shortfall is visible instead of silently draining other markets.

The contract has no upgrade path today (see `scripts/deploy-testnet.sh`), so
this is a new-deployment-only change: a redeployed market-core starts from
`TotalLocked = 0`. There is deliberately no admin setter to backfill the
counter for pre-existing markets, because that would be an obvious
privileged backdoor.

**Fee split and recipient snapshot.** `create_market` snapshots a
`FeeTerms { recipient, protocol_share_bps }` side entry per market, so
`set_treasury` / `set_protocol_fee_share_bps` only affect markets created
after them. Each trade's fee is split once at accrual time
(`math::split_fee`, protocol shares round up so `protocol + lp == fee`
exactly): the protocol portion accumulates in `Market.fees_accrued` and is
swept to the snapshotted recipient by the permissionless `sweep_fees`(old `FeesSwept` event kept for indexers, plus `FeesSweptTo`); the creator
portion accumulates in a `LpFees(market_id)` side entry, claimable any time
(before finality too) via `claim_lp_fees`, and also drained by
`claim_pool_remainder`. Markets created before this change have no
`FeeTerms` entry and fall back to the old behavior: recipient = whatever
`DataKey::Treasury` Holds at sweep time, `protocol_share_bps = 10_000` —
fully backward compatible, no migration transaction needed. The separate
LP balance (rather than adding fees to the reserves) is deliberate: it does
not move `k` or the price and maps directly onto the per-LP fee accumulator
of the future multi-LP design ([wave-issue 02](wave-issues/02-multi-lp-liquidity.md)).

**Trade bounds and circuit breakers.** Two layers of protection beyond the
share-count slippage parameters:

- *Deadline + limit price* (#12): `buy_v2` / `sell_v2` take a
  `deadline` (ledger **timestamp**, unix seconds) checked before anything
  else, and a `limit_price_bps` bounding the **average execution price**
  (`collateral_in / shares_out` for buys, `collateral_out / shares_in` for
  sells, fee included, compared by cross-multiplication). `0` means "no
  limit" for buys; for sells it is trivially satisfied and buys no
  protection. The original `buy` / `sell` remain as thin wrappers for
  backward compatibility (same body, no bounds).
- *Per-market breakers* (#10): `BreakerConfig { max_impact_bps, band_bps }`
  is snapshotted per market from an admin default (`set_default_breaker`,
  which rejects `band_bps < max_impact_bps` because that makes one trade
  cover the whole band). `max_impact_bps` bounds a single trade's
  |post − pre| YES-price move (`>` — a trade moving exactly the cap
  passes); `band_bps` bounds |post − ledger-open price|, with the reference
  stored in short-TTL **temporary** storage keyed by ledger sequence, so it
  resets by itself every ledger. 0 disables either check; legacy markets
  have no config and are unaffected. Breaker trips revert with
  `PriceImpactTooHigh` / `PriceBandExceeded` and — because Soroban rolls
  back an invocation's events on `Err` — emit **no** event (the error codes
  and the `would_trip`` / `breaker_config` / `breaker_state` views are the
  observability path; see the comment on `check_breakers`).

  *Worst-case lock cost.* The band cannot be ratcheted: the reference is
  the ledger-open price, so an attacker who pushes the price to the band
  edge only blocks further trades for the rest of that ledger (~5 s) —
  and pays the trading fee plus price impact to do it, which are both
  retained by the pool.

**Resolution and payouts.** `resolve(market_id, outcome)` sets the
final outcome once. `redeem` pays `payout` for a winning position and
burns it; `lp_claimed` gates `claim_pool_remainder`, which pays the
creator the residual value of the reserves and zeroes them. Both payouts
 are subject to the checked transfer and global solvency guard.
