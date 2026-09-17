import assert from "node:assert/strict";
import test from "node:test";
import { GoldLockRecheck, type GoldLockRow } from "./gold-lock.ts";

function harness(row: GoldLockRow | null, intervalMs = 5_000) {
  const state = { now: 1_000, reads: 0, row };
  const lock = new GoldLockRecheck(
    () => {
      state.reads += 1;
      return Promise.resolve(state.row);
    },
    intervalMs,
    () => state.now,
  );
  return { lock, state };
}

test("locked() throttles D1 reads within the interval", async () => {
  const { lock, state } = harness({ gold_unlocked_until: null, layer: "gold" });
  assert.equal(await lock.locked(), true);
  assert.equal(await lock.locked(), true);
  assert.equal(state.reads, 1);
});

test("locked() picks up promote and unlock expiry after the interval", async () => {
  const { lock, state } = harness({
    gold_unlocked_until: null,
    layer: "bronze",
  });
  assert.equal(await lock.locked(), false);

  // Mid-session promotion to gold: next recheck reports locked.
  state.row = { gold_unlocked_until: null, layer: "gold" };
  state.now += 5_001;
  assert.equal(await lock.locked(), true);
  assert.equal(state.reads, 2);

  // unlock_gold_for_edit opens a window: next recheck reports editable.
  state.row = { gold_unlocked_until: state.now + 60_000, layer: "gold" };
  state.now += 5_001;
  assert.equal(await lock.locked(), false);

  // Window expiry re-locks on the following recheck.
  state.now += 61_000;
  assert.equal(await lock.locked(), true);
});

test("lockedNow() bypasses and refreshes the throttle cache", async () => {
  const { lock, state } = harness({ gold_unlocked_until: null, layer: "gold" });
  assert.equal(await lock.locked(), true);
  assert.equal(state.reads, 1);

  // Fresh read even inside the throttle window.
  state.row = { gold_unlocked_until: state.now + 60_000, layer: "gold" };
  assert.equal(await lock.lockedNow(), false);
  assert.equal(state.reads, 2);

  // The fresh verdict is cached for the throttled path.
  assert.equal(await lock.locked(), false);
  assert.equal(state.reads, 2);
});

test("concurrent locked() calls share a single read", async () => {
  const { lock, state } = harness({ gold_unlocked_until: null, layer: "gold" });
  const [a, b] = await Promise.all([lock.locked(), lock.locked()]);
  assert.equal(a, true);
  assert.equal(b, true);
  assert.equal(state.reads, 1);
});

test("read failure fails open and is not cached", async () => {
  let fail = true;
  let reads = 0;
  const lock = new GoldLockRecheck(() => {
    reads += 1;
    return fail
      ? Promise.reject(new Error("D1 unavailable"))
      : Promise.resolve({ gold_unlocked_until: null, layer: "gold" });
  });
  assert.equal(await lock.locked(), false);
  fail = false;
  assert.equal(await lock.locked(), true);
  assert.equal(reads, 2);
});

test("missing row is treated as unlocked", async () => {
  const { lock } = harness(null);
  assert.equal(await lock.locked(), false);
});
