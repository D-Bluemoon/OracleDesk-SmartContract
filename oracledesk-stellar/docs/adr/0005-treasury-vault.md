# ADR 0005: Share-based treasury vault with a conservative NAV

## Status

Accepted.

## Context

`Treasury::deposit(from, amount)` used to accept collateral from anyone and
record nothing: no shares, no receipt, no way back out. Only the admin could
move funds out, through `withdraw(to, amount)`. A deposit from anyone other
than the operator was a donation to the admin key, so outside funders could
not back an agent and share in its results.

Turning the treasury into a vault needs a net asset value (NAV) to price
shares. The treasury holds positions across many markets, and the obvious
valuation, the FPMM spot price, can be moved by anyone who trades. If NAV
followed spot, a depositor could push prices up, withdraw at the inflated
NAV, and leave the loss with everyone else. Vaults also have a well-known
first-depositor attack: deposit 1 unit, donate a large amount straight to the
contract, and round the next depositor's shares down to almost nothing.

## Decision

### Valuation: settled-plus-floor

```
nav = idle
    + Σ over the open-market index of
        open market:  min(pos.yes, pos.no)                      complete sets
                    + min(reserve_yes, reserve_no) if LP role    unclaimed LP
        final market: settle_value(position) + settle_value(LP reserves)
    - queue_reserved
```

- `idle` is the treasury's collateral balance.
- Complete sets redeem 1:1 whatever the outcome, so `min(yes, no)` is value
  the treasury gets back for certain.
- For an LP role that has not been claimed, `min(reserve_yes, reserve_no)` is
  the least the pool remainder can pay out.
- A final market counts exactly what market-core's `settle_value` pays
  (`Yes → yes`, `No → no`, `Void → (yes + no) / 2`).
- `queue_reserved` is collateral already owed to burned shares (see
  "Withdrawals"). Subtracting it stops that collateral being counted twice.

The directional part of a position (`|yes - no|`) is valued at **zero**. Spot
and TWAP valuations were rejected: spot can be manipulated within a single
transaction, and no TWAP exists yet.

**Trade-off, worked example.** The treasury holds 1,000 USDC idle and 150 YES
/ 40 NO shares in an open market where YES trades at 70%. Mark-to-market
would value the position at about 150 × 0.7 + 40 × 0.3 = 117. The floor is
`min(150, 40) = 40`, so NAV is 1,040, not 1,117. While the position is open,
a new depositor's shares are slightly cheap and a withdrawing shareholder's
are slightly expensive. Once the market resolves YES, the position is worth
exactly 150, NAV rises to 1,150, and every shareholder gains pro rata. The
bias always favours the shareholders who stay in the vault over those
entering or leaving. Under-valuation is the price of a NAV that third-party
trades cannot push up.

### Open-market index

NAV needs the list of markets where the treasury holds capital, and nothing
on-chain gave that list. The treasury keeps an index:
`OpenMarketAt(0..count) -> { core, market_id }` plus a reverse
`OpenMarketSlot(core, id)` for swap-and-pop removal.

- A market joins the index on its first buy or creation.
- It leaves once the treasury holds nothing in it: no shares and no unclaimed
  LP role. This is checked after `redeem`, `claim_pool_remainder` and their
  `legacy_*` variants. `migrate_market` also removes it.
- Each entry records its market-core, so positions left in a market-core the
  treasury has since switched away from (see "Timelocked configuration" in
  `docs/architecture.md`) keep counting.

The index is capped at `MAX_OPEN_MARKETS = 12`. A buy or creation in a 13th
market fails with `TooManyOpenMarkets`. Each entry costs two cross-contract
reads, and each read instantiates market-core at about 2.5 MB of memory.
Measured with the test host's per-invocation limit checks:

| Open markets | Call | Memory | Limit |
| ---: | --- | ---: | ---: |
| 32 | `nav()` alone | ~81 MB | 40 MiB |
| 16 | `deposit` | ~40.4 MB | 40 MiB |
| 12 | `deposit` / `request_withdraw` | ~30.3 MB, ~15M instructions | 40 MiB |

The 12-market case is pinned by `nav_budget_within_limits_at_max_open_markets`.

### Shares

Shares are internal balances (`Shares(owner)`, `TotalShares`), not a SEP-41
token. A transferable share token can wrap them later. Keeping them internal
avoids a second contract, a cross-contract call per transfer, and the
question of what a share transfer means for the withdrawal queue while the
economics are still settling.

```
shares_for_deposit(amount) = amount × (supply + 1_000) / (nav + 1)     floor
assets_for_shares(shares)  = shares × (nav + 1) / (supply + 1_000)     floor
```

Both directions round down, in favour of the vault. A deposit followed
immediately by a withdrawal never returns more than was put in. This is
checked by a randomized property test (1,000 cases) and end to end.

**Inflation protection.** The virtual offset (1,000 virtual shares, 1
virtual stroop; the ERC-4626 mitigation) is what defeats the donation
attack. The attacker's donation is shared with the virtual shares, so
inflating the price enough to round a victim's deposit to zero costs the
attacker about 1,000 times what it takes from the victim. Two further
measures support it:

- The first mint withholds 1,000 dead shares that no one owns.
- Deposits must be at least `MIN_DEPOSIT = 10 USDC`.

`donation_attack_does_not_steal_from_second_depositor` shows a victim losing
at most rounding dust after a 1,000 USDC donation.

NAV is computed before the deposit's own transfer, so a deposit never prices
itself.

### Withdrawals

`request_withdraw(owner, shares)`:

1. Computes `assets` at the current NAV and burns the shares immediately,
   which locks in the price.
2. Pays `min(assets, idle - queue_reserved)` now.
3. Records any remainder as a FIFO `WithdrawTicket { owner, remaining,
   created_at }` and adds it to `queue_reserved`.

Agents can never spend reserved collateral. `agent_buy` and
`agent_create_market` fail with `CapitalReserved` unless
`idle - amount >= queue_reserved`.

`claim_withdraw(ticket_id)` pays the head ticket as far as idle collateral
allows. Anyone can call it, but the money always goes to the ticket's owner.
Tickets wait while capital stays deployed, which is bounded by the close
times of the open markets. UIs can read `queue_reserved()`,
`queue_bounds()` and `withdraw_ticket(id)`.

### Operating modes and the gate table (#272)

Before #272 the treasury tracked four booleans (`Paused`, `AdminPaused`,
`DrawdownTripped`, `DrawdownAcknowledged`) and each entrypoint read a different
combination of them. The most serious result: a drawdown trip (the agents lost
money) set `Paused`, and `emergency_withdraw` checked only `Paused`, so an
ordinary risk event opened the exit meant for "market-core is broken". Whoever
left first took their share of idle collateral and forfeited their share of open
positions to the stayers, so a trip started a run.

The treasury now stores each *reason* it is not running normally on its own
(`ModeState`), and derives one effective `Mode` with the priority
`Emergency > AdminPaused > AgentsHalted > Normal`:

| Reason | Set by | Cleared by | Auth |
|---|---|---|---|
| drawdown halt | `check_drawdown` (internal, on realized loss) | `resume_agents()` | admin, and only once the window PnL is back above `-max_drawdown` (or after `reset_pnl_window`) |
| admin pause | `set_paused(true)` / `pause(reason)` | `set_paused(false)` / `unpause()` | admin (the timelock's emergency path calls `set_paused(true)`, ADR 0008) |
| emergency | `declare_emergency(reason)`, only from `AdminPaused` | `end_emergency()` | admin (production: route through `timelock.schedule`) |

Because the reasons are independent, clearing one never clears another:
unpausing during a drawdown leaves the agents halted, and resuming the agents
leaves an admin pause standing. `unpause` is refused while an emergency is
declared. Every change emits `ModeChanged { from, to, reason, at }`, so off-chain
monitors can tell *why* the treasury stopped. `acknowledge_drawdown` is a
deprecated no-op (the error code `NotAcknowledged` stays allocated).

Every state-changing entrypoint asks one function, `gate(Op)`, which is the
exhaustive `mode::allowed(mode, op)` below (a new `Op` does not compile until it
has a cell for every mode). A denied call returns `DrawdownTripped` (agents
halted), `Paused` (admin pause) or `EmergencyMode`; `emergency_withdraw` outside
an emergency returns `NotPaused` when running normally.

| Op (entrypoints) | Normal | AgentsHalted | AdminPaused | Emergency |
|---|---|---|---|---|
| `Deposit` (`deposit`) | yes | no | no | no |
| `RequestWithdraw` (`request_withdraw`) | yes | yes | yes | no |
| `ClaimWithdraw` (`claim_withdraw`) | yes | yes | yes | yes |
| `EmergencyWithdraw` (`emergency_withdraw`) | no | no | no | yes |
| `AgentOpen` (`agent_create_market`, `agent_create_market_and_reveal`, `agent_buy`, `agent_buy_v2`) | yes | no | no | no |
| `AgentReduce` (`agent_sell`, `agent_sell_v2`, `close_trade`) | yes | yes | no | no |
| `AgentSettle` (`redeem`, `claim_pool_remainder`, `legacy_*`, `redeem_many`, `claim_pool_remainders`, `agent_claim_lp_fees`) | yes | yes | yes | yes |
| `PermissionlessSettle` (`settle_market`, `realize`, `collect_market_fees`) | yes | yes | yes | yes |
| `YieldAllocate` (`allocate_to_yield`) | yes | no | no | no |
| `YieldRecall` (`recall_from_yield`) | yes | yes | yes | yes |
| `AdminWithdraw` (`withdraw`) | yes | no | no | no |
| `Migrate` (`migrate_market`) | yes | no | no | yes |

Depositor exit rights, mode by mode:

- **Normal.** Everything runs. A depositor exits through `request_withdraw` (paid
  at NAV, the remainder queued FIFO) and `claim_withdraw`.
- **AgentsHalted** (drawdown). Only *openings* stop: agents cannot create markets
  or buy, and the yield venue takes no new allocation, because a halt means the
  agents lost money and NAV is in doubt. Reductions (`agent_sell`, `close_trade`)
  and every settlement stay open, so positions can be unwound. Deposits close
  (a new depositor would buy in at a NAV nobody trusts yet). The depositor's
  exit is unchanged, and `emergency_withdraw` stays closed: opening the forfeiting
  exit on a risk event is the bug this section fixes, and it would hand the first
  leavers a larger share at the stayers' expense.
- **AdminPaused.** Deposits and all agent trading close (including reductions:
  an admin pause is a "stop touching things" lever). Settlement, recalls from the
  yield venue and queued withdrawals (`request_withdraw`, `claim_withdraw`) stay
  open, because they only bring collateral home or honour what was already
  priced. `emergency_withdraw` is still closed.
- **Emergency.** Entered only from `AdminPaused`, so one admin call cannot flip
  straight into the forfeiting exit (with the timelock as admin the extra step is
  delayed too). `emergency_withdraw` opens: the owner is paid their share of free
  idle collateral (`idle - queue_reserved`, as before, so tickets that already
  exist stay covered) and forfeits their share of open positions. New
  `request_withdraw` closes, because a new request is priced at a NAV that
  `emergency_withdraw` makes meaningless; tickets that already exist stay
  claimable. `migrate_market` is open so positions can be moved to a successor.
- **Settlement is open in every mode.** `settle_market`, `realize`, `redeem`,
  `claim_pool_remainder` and `collect_market_fees` only bring collateral home. In
  particular a drawdown can trip *inside* `settle_market`/`realize`; the halt is
  recorded and the call that tripped it still succeeds.

`mode()`, `mode_state()` and `allowed(op)` are views for agents and frontends to
pre-check (the agent runtime reads `mode()` once per tick and skips open-position
tasks unless it is `Normal`). The pre-#272 flags are read as a fallback when
`ModeState` is absent (`DrawdownTripped` becomes a halt; `AdminPaused`, or a bare
`Paused` from a pre-#46 deployment, becomes an admin pause with reason `legacy`)
and are deleted on the first write; the treasury has no upgrade entrypoint, so
existing deployments move by redeploying.

### Custody migration

- The constructor mints any balance the treasury already holds to `admin` as
  shares.
- A stored pre-vault config is migrated lazily and does the same with the
  balance it finds.
- Admin `withdraw` still exists (idle collateral only, subject to
  `ensure_liquid`), but the admin is otherwise an ordinary shareholder. It is
  closed whenever the treasury is not in `Normal` (see the gate table below).
- `emergency_withdraw(owner, shares)` works only in `Mode::Emergency` (below).
  It pays the owner their pro-rata part of free idle collateral without reading
  market-core, for the case where market-core is what broke. The owner forfeits
  their part of open positions, which stays with the remaining shareholders.

The treasury has no upgrade path, so existing deployments move by
redeploying:

1. Deploy the new treasury.
2. Admin `withdraw` from the old (pre-vault) treasury.
3. `deposit` into the new treasury.
4. Call `market_core.propose_treasury`, then the new treasury's
   `accept_market_core_role` (the `set_treasury` API this ADR predates was
   replaced by the authenticated handshake in ADR 0006).

Positions moved with `migrate_market` are not in the successor's index and
count as zero in its NAV until they are redeemed.

## Consequences

- Outside funders can back an agent. Their claim is enforced on-chain, and
  no trade against a pool can raise the price of their exit.
- Remaining risks, documented rather than solved:
  - **LP floor moved by rebalancing.** `min(reserve_yes, reserve_no)` rises
    when a trade pushes a skewed pool back toward 50/50. An attacker could
    rebalance, withdraw, then trade back. The gain is bounded by the LP
    floor's movement times the attacker's share of the vault, and it costs
    two trading fees plus slippage. It is not free, but it is not zero.
  - **Fee sweeps.** `collect_market_fees` (admin) raises NAV for every
    shareholder at the moment fees arrive. A depositor who knows a sweep is
    imminent gets a slightly better entry. Sweep often.
  - **Admin custody.** `set_successor` + `migrate_market` can move positions
    out of the vault without compensation (SECURITY.md).
  - **Unindexed positions** (pre-migration, or received from a predecessor)
    are valued at zero until redeemed.
- Agent activity is capped at 12 markets with open capital at once.
