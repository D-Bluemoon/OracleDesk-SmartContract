import assert from "node:assert/strict";
import test from "node:test";
import {
  BPS,
  buyWithinLimit,
  calcBuy,
  calcSell,
  calcSellShares,
  collateralOutForShares,
  isqrt,
  priceAfter,
  priceAfterBuy,
  priceAfterSell,
  priceYesBps,
  seedReserves,
  sellWithinLimit,
  settleValue,
} from "./fpmm.js";

// Same worked examples as math.rs's unit tests and model/fpmm_model.py's
// _check_known_values — catches a porting mistake between the three
// languages immediately.
test("calcBuy matches the reference example", () => {
  const q = calcBuy(1000n, 1000n, 100n, 0n);
  assert.equal(q.sharesOut, 190n);
  assert.equal(q.newReserveBought, 910n);
  assert.equal(q.newReserveOther, 1100n);
});

test("calcSell matches the reference example", () => {
  const q = calcSell(1000n, 1000n, 100n, 0n);
  assert.equal(q.sharesIn, 212n);
  assert.equal(q.gross, 100n);
  assert.equal(q.newReserveSold, 1112n);
  assert.equal(q.newReserveOther, 900n);
});

test("seedReserves opens at the requested probability", () => {
  for (const p of [100n, 2500n, 5000n, 7300n, 9900n]) {
    const s = seedReserves(10_000_000_000n, p);
    const price = priceYesBps(s.reserveYes, s.reserveNo);
    const diff = price > p ? price - p : p - price;
    assert.ok(diff <= 1n, `p=${p} price=${price}`);
    assert.ok(s.creatorYes === 0n || s.creatorNo === 0n);
  }
});

test("k never decreases and a round trip never profits", () => {
  // Same small LCG as math.rs's property test, so both suites explore a
  // comparable input space.
  let x = 0x9e3779b97f4a7c15n;
  const mask = (1n << 64n) - 1n;
  const next = () => {
    x = (x * 6364136223846793005n + 1442695040888963407n) & mask;
    return x >> 33n;
  };
  for (let i = 0; i < 2000; i++) {
    const ry = 1_000_000n + (next() % 1_000_000_000n);
    const rn = 1_000_000n + (next() % 1_000_000_000n);
    const amt = 1n + (next() % ((ry < rn ? ry : rn) / 2n));
    const fee = next() % 300n;
    const k0 = ry * rn;
    const q = calcBuy(ry, rn, amt, fee);
    assert.ok(q.newReserveBought * q.newReserveOther >= k0);
    try {
      const s = calcSell(q.newReserveBought, q.newReserveOther, amt, fee);
      assert.ok(s.sharesIn >= q.sharesOut, "free money");
    } catch {
      // insufficient liquidity to sell back out is fine, not what's tested here
    }
  }
});

test("void settlement never overpays", () => {
  assert.equal(settleValue("void", 3n, 4n), 3n);
  assert.ok(settleValue("void", 5n, 5n) <= 5n);
});

test("collateralOutForShares round-trips through calcSell within one unit of rounding", () => {
  // Deterministic pseudo-random inputs (same LCG as above) so this is
  // reproducible without a test-framework property library dependency.
  let x = 12345n;
  const mask = (1n << 64n) - 1n;
  const next = () => {
    x = (x * 6364136223846793005n + 1442695040888963407n) & mask;
    return x >> 33n;
  };
  let checked = 0;
  const trials = 500;
  for (let i = 0; i < trials; i++) {
    const rSold = 1_000_000n + (next() % 1_000_000_000n);
    const rOther = 1_000_000n + (next() % 1_000_000_000n);
    const feeBps = next() % 300n;
    const collateralOut = 1n + (next() % (rOther / 4n || 1n));
    let forward;
    try {
      forward = calcSell(rSold, rOther, collateralOut, feeBps);
    } catch {
      continue;
    }
    let estimatedOut: bigint;
    try {
      estimatedOut = collateralOutForShares(rSold, rOther, forward.sharesIn, feeBps);
    } catch {
      continue;
    }
    if (estimatedOut <= 0n) continue;
    const back = calcSell(rSold, rOther, estimatedOut, feeBps);
    assert.ok(back.sharesIn <= forward.sharesIn + 1n, `forward=${forward.sharesIn} back=${back.sharesIn}`);
    checked++;
  }
  assert.ok(checked > trials / 2, "too many trials skipped, weakens the property check");
});

test("isqrt is exact for boundaries", () => {
  // Mirrors math.rs's isqrt_exact_for_boundaries.
  const cases: Array<[bigint, bigint]> = [
    [0n, 0n],
    [1n, 1n],
    [2n, 1n],
    [3n, 1n],
    [4n, 2n],
    [8n, 2n],
    [9n, 3n],
    [15n, 3n],
    [16n, 4n],
    [99n, 9n],
    [100n, 10n],
    [10_000n, 100n],
    [9_000_000_000_000_000_000_000_000_000_000n, 3_000_000_000_000_000n],
  ];
  for (const [n, want] of cases) {
    const got = isqrt(n);
    assert.equal(got, want, `isqrt(${n})`);
    assert.ok(got * got <= n, `isqrt(${n})^2 <= n`);
    assert.ok((got + 1n) * (got + 1n) > n, `(isqrt(${n})+1)^2 > n`);
  }
});

test("calcSellShares matches Rust/Python known values", () => {
  // Shared fixture table with math.rs's sell_shares_example_matches_model
  // and model/fpmm_model.py's _check_sell_shares_known_values. The 1000/1000
  // pool selling 212 shares must give gross 100 under the pool-favoring
  // correction rule.
  const fixtures: Array<{
    rSold: bigint;
    rOther: bigint;
    sharesIn: bigint;
    feeBps: bigint;
    gross: bigint;
    collateralOut: bigint;
    newSold: bigint;
    newOther: bigint;
  }> = [
    {
      rSold: 1000n,
      rOther: 1000n,
      sharesIn: 212n,
      feeBps: 0n,
      gross: 100n,
      collateralOut: 100n,
      newSold: 1112n,
      newOther: 900n,
    },
    {
      rSold: 1_000_000_000n,
      rOther: 1_000_000_000n,
      sharesIn: 100_000_000n,
      feeBps: 100n,
      gross: 52_631_578n,
      collateralOut: 52_105_262n,
      newSold: 1_047_368_422n,
      newOther: 947_368_422n,
    },
  ];
  for (const f of fixtures) {
    const q = calcSellShares(f.rSold, f.rOther, f.sharesIn, f.feeBps);
    assert.equal(q.gross, f.gross, `gross for ${JSON.stringify(f)}`);
    assert.equal(q.collateralOut, f.collateralOut, `collateralOut for ${JSON.stringify(f)}`);
    assert.equal(q.newReserveSold, f.newSold, `newSold for ${JSON.stringify(f)}`);
    assert.equal(q.newReserveOther, f.newOther, `newOther for ${JSON.stringify(f)}`);
  }
});

test("calcSellShares never decreases k", () => {
  // Same LCG as the other property tests so all three languages explore a
  // comparable input space.
  let x = 0xdeadbeefcafebaben;
  const mask = (1n << 64n) - 1n;
  const next = () => {
    x = (x * 6364136223846793005n + 1442695040888963407n) & mask;
    return x >> 33n;
  };
  let checked = 0;
  for (let i = 0; i < 2000; i++) {
    const rSold = 1_000_000n + (next() % 1_000_000_000n);
    const rOther = 1_000_000n + (next() % 1_000_000_000n);
    const sharesIn = 1n + (next() % (rSold / 2n || 1n));
    const feeBps = next() % 1000n;
    const k0 = rSold * rOther;
    let q;
    try {
      q = calcSellShares(rSold, rOther, sharesIn, feeBps);
    } catch {
      continue;
    }
    assert.ok(
      q.newReserveSold * q.newReserveOther >= k0,
      `k decreased: rSold=${rSold} rOther=${rOther} sharesIn=${sharesIn} feeBps=${feeBps}`,
    );
    checked++;
  }
  assert.ok(checked > 1000, "too many trials skipped, weakens the property check");
});

test("calcSellShares never pays more than calcSell charges for the same shares", () => {
  // The pool-favoring rounding guarantee: for any shares_in, the exact
  // share sell must not return more collateral than calcSell would charge
  // to buy back that same share count.
  let x = 0x0123456789abcdefn;
  const mask = (1n << 64n) - 1n;
  const next = () => {
    x = (x * 6364136223846793005n + 1442695040888963407n) & mask;
    return x >> 33n;
  };
  let checked = 0;
  for (let i = 0; i < 1000; i++) {
    const rSold = 1_000_000n + (next() % 1_000_000_000n);
    const rOther = 1_000_000n + (next() % 1_000_000_000n);
    const sharesIn = 1n + (next() % (rSold / 2n || 1n));
    const feeBps = next() % 1000n;
    let q;
    try {
      q = calcSellShares(rSold, rOther, sharesIn, feeBps);
    } catch {
      continue;
    }
    let back;
    try {
      back = calcSell(rSold, rOther, q.collateralOut, feeBps);
    } catch {
      continue;
    }
    assert.ok(
      back.sharesIn <= sharesIn,
      `calcSell charged ${back.sharesIn} for ${q.collateralOut}, more than ${sharesIn}`,
    );
    checked++;
  }
  assert.ok(checked > 500, "too many trials skipped, weakens the property check");
});

test("BPS matches the contract's basis-point scale", () => {
  assert.equal(BPS, 10_000n);
});

test("priceAfter maps both outcomes to the same YES price", () => {
  assert.equal(priceAfter(true, 1000n, 1000n), 5000n);
  assert.equal(priceAfter(false, 1000n, 1000n), 5000n);
  assert.equal(priceAfter(true, 910n, 1100n), priceYesBps(910n, 1100n));
  assert.equal(priceAfter(false, 910n, 1100n), priceYesBps(1100n, 910n));
});

test("priceAfterBuy matches the reference example shared with math.rs and the Python model", () => {
  // Buying 10 USDC of YES in a 100-sets pool at 50% with a 1% fee moves
  // YES from 5000 to 5470 bps.
  const q = calcBuy(1_000_000_000n, 1_000_000_000n, 100_000_000n, 100n);
  assert.equal(priceYesBps(1_000_000_000n, 1_000_000_000n), 5000n);
  assert.equal(priceAfterBuy(true, q), 5470n);
  // Selling right back must land below the pre-trade price (two fees).
  const s = calcSell(q.newReserveBought, q.newReserveOther, 100_000_000n, 100n);
  assert.ok(priceAfterSell(true, s) < 5000n);
});

test("buyWithinLimit and sellWithinLimit mirror the on-chain boundaries", () => {
  // Exact equality passes, one unit over fails, in both directions.
  assert.equal(buyWithinLimit(100n, 100n, 10_000n), true);
  assert.equal(buyWithinLimit(100n, 101n, 10_000n), true);
  assert.equal(buyWithinLimit(101n, 100n, 10_000n), false);
  assert.equal(buyWithinLimit(100n, 200n, 5_000n), true);
  assert.equal(buyWithinLimit(101n, 200n, 5_000n), false);
  assert.equal(sellWithinLimit(100n, 100n, 10_000n), true);
  assert.equal(sellWithinLimit(99n, 100n, 10_000n), false);
  assert.equal(sellWithinLimit(100n, 200n, 5_000n), true);
  assert.equal(sellWithinLimit(100n, 201n, 5_000n), false);
  // A zero limit is trivially satisfied for sells and binds a buy only at
  // a zero average price.
  assert.equal(sellWithinLimit(0n, 1n, 0n), true);
  assert.equal(buyWithinLimit(1n, 1n, 0n), false);
});
