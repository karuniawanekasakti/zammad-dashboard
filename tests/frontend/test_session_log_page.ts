import assert from "node:assert/strict";
import {
  advanceRevealClick,
  beaconDecision,
  deviceLabel,
  sessionStatusLabel,
} from "../../src/lib/session-log.ts";

let state = { count: 0, revealed: false };
for (let click = 0; click < 4; click += 1) {
  state = advanceRevealClick(state.count, state.revealed);
  assert.equal(state.revealed, false);
}
state = advanceRevealClick(state.count, state.revealed);
assert.equal(state.revealed, true);
for (let click = 0; click < 5; click += 1) {
  state = advanceRevealClick(state.count, state.revealed);
}
assert.deepEqual(state, { count: 0, revealed: false });

const first = beaconDecision("/tickets/42", null, 1_000);
assert.deepEqual(first, { send: true, route: "/tickets/42", lastPath: "/tickets/42" });
assert.equal(beaconDecision("/tickets/42", { route: first.route, at: 1_000 }, 5_999).send, false);
assert.equal(beaconDecision("/tickets/42", { route: first.route, at: 1_000 }, 6_000).send, true);
assert.equal(beaconDecision("/login", null, 1_000).send, false);
assert.equal(beaconDecision("/session-log", null, 1_000).send, false);

const session = {
  id: "s1",
  user_id: "42",
  device_label: "Chrome on Windows",
  ip: "127.0.0.1",
  user_agent: "ua",
  created_at: "2026-09-29T00:00:00Z",
  last_seen_at: "2026-09-29T00:00:00Z",
  logout_at: null,
  revoked: false,
};
assert.equal(deviceLabel(session), "Chrome on Windows");
assert.equal(sessionStatusLabel(session), "Open");
assert.equal(sessionStatusLabel({ ...session, logout_at: "2026-09-29T01:00:00Z" }), "Ended");
assert.equal(sessionStatusLabel({ ...session, revoked: true }), "Revoked");

console.log("test_session_log_page: OK");
