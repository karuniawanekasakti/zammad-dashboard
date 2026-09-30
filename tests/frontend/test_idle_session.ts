import assert from "node:assert/strict";
import { ACTIVITY_EVENTS, IDLE_CHECK_INTERVAL_MS, IDLE_TIMEOUT_MS, REFRESH_THROTTLE_MS, SHARED_ACTIVITY_WRITE_MS, createIdleSession } from "../../src/lib/idle-session.ts";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness(refresh: () => Promise<void> = async () => undefined) {
  let now = 0;
  const calls = { refresh: 0, idle: 0 };
  // Stands in for the localStorage entry that every tab shares.
  const shared = { value: null as number | null, writes: [] as number[] };
  const session = createIdleSession({
    now: () => now,
    refresh: async () => {
      calls.refresh += 1;
      await refresh();
    },
    onIdle: () => {
      calls.idle += 1;
    },
    shared: {
      read: () => shared.value,
      write: (at) => {
        shared.value = at;
        shared.writes.push(at);
      },
    },
  });
  return {
    session,
    calls,
    shared,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

// The decisions the design rests on.
assert.equal(IDLE_TIMEOUT_MS, 60 * MINUTE);
assert.equal(REFRESH_THROTTLE_MS, 5 * MINUTE);
assert.ok(IDLE_CHECK_INTERVAL_MS < REFRESH_THROTTLE_MS);
// Real input only: background polling must never count as activity.
assert.deepEqual([...ACTIVITY_EVENTS], ["mousemove", "keydown", "click", "scroll"]);

// Activity inside the throttle window does not refresh the token.
{
  const { session, calls, advance } = harness();
  advance(4 * MINUTE);
  session.activity();
  await tick();
  assert.equal(calls.refresh, 0);
}

// Activity after the window refreshes once; the window restarts from the successful refresh.
{
  const { session, calls, advance } = harness();
  advance(5 * MINUTE);
  session.activity();
  await tick();
  assert.equal(calls.refresh, 1);
  advance(1 * MINUTE);
  session.activity();
  await tick();
  assert.equal(calls.refresh, 1);
  advance(5 * MINUTE);
  session.activity();
  await tick();
  assert.equal(calls.refresh, 2);
}

// An in-flight refresh is not duplicated by more activity.
{
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { session, calls, advance } = harness(() => gate);
  advance(5 * MINUTE);
  session.activity();
  session.activity();
  assert.equal(calls.refresh, 1);
  release();
  await tick();
}

// A failed refresh is retried on the next activity instead of waiting out the window.
{
  const { session, calls, advance } = harness(async () => {
    throw new Error("network");
  });
  advance(5 * MINUTE);
  session.activity();
  await tick();
  session.activity();
  await tick();
  assert.equal(calls.refresh, 2);
}

// Idle fires once, exactly at the limit.
{
  const { session, calls, advance } = harness();
  advance(IDLE_TIMEOUT_MS - SECOND);
  session.check();
  assert.equal(calls.idle, 0);
  advance(SECOND);
  session.check();
  session.check();
  assert.equal(calls.idle, 1);
}

// Activity postpones idle.
{
  const { session, calls, advance } = harness();
  advance(59 * MINUTE);
  session.activity();
  advance(59 * MINUTE);
  session.check();
  assert.equal(calls.idle, 0);
  advance(MINUTE);
  session.check();
  assert.equal(calls.idle, 1);
}

// Activity that arrives after the limit cannot resurrect the session.
{
  const { session, calls, advance } = harness();
  advance(61 * MINUTE);
  session.activity();
  session.activity();
  session.check();
  await tick();
  assert.equal(calls.idle, 1);
  assert.equal(calls.refresh, 0);
}

// Activity in another tab keeps this tab signed in.
{
  const { session, calls, shared, advance } = harness();
  advance(59 * MINUTE);
  shared.value = 59 * MINUTE; // the other tab was active here
  advance(2 * MINUTE);
  session.check();
  assert.equal(calls.idle, 0);
  advance(58 * MINUTE);
  session.check();
  assert.equal(calls.idle, 1);
}

// Shared activity is written at most once per interval, not on every mousemove.
{
  const { session, shared, advance } = harness();
  advance(SECOND);
  session.activity();
  advance(SECOND);
  session.activity();
  assert.equal(shared.writes.length, 1);
  advance(SHARED_ACTIVITY_WRITE_MS);
  session.activity();
  assert.equal(shared.writes.length, 2);
  await tick();
}

console.log("Idle session OK");
