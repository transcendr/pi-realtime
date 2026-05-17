#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const types = readFileSync(".pi/extensions/pi-realtime/types.ts", "utf8");
const service = readFileSync(".pi/extensions/pi-realtime/service.ts", "utf8");
const packets = readFileSync(".pi/extensions/pi-realtime/state-packets.ts", "utf8");

assert.match(types, /sessions: Map<ProviderSessionId, VoiceSessionRecord>/);
assert.match(types, /pendingToolCalls: Map<VoiceToolCallId, VoiceToolCallRecord>/);
assert.match(types, /contextRevisions: Map<ProviderSessionId/);
assert.match(service, /fakeAdapters = new Map<ProviderSessionId/);
assert.match(packets, /nextContextRevision/);

const state = {
  sessions: new Map(),
  pendingToolCalls: new Map(),
  contextRevisions: new Map(),
};
function start(id, provider) { state.sessions.set(id, { providerSessionId: id, provider, status: "active" }); }
function call(id, session) { state.pendingToolCalls.set(id, { voiceToolCallId: id, providerSessionId: session }); }
function result(id, session) {
  const pending = state.pendingToolCalls.get(id);
  if (!pending) return "missing";
  if (pending.providerSessionId !== session) return "wrong-session";
  state.pendingToolCalls.delete(id);
  return "sent";
}
function nextRev(session, channel) {
  const current = state.contextRevisions.get(session)?.[channel] ?? 0;
  state.contextRevisions.set(session, { ...(state.contextRevisions.get(session) ?? {}), [channel]: current + 1 });
  return current + 1;
}

start("openai_1", "openai");
start("gemini_1", "gemini");
call("call_o", "openai_1");
call("call_g", "gemini_1");
assert.equal(result("call_o", "gemini_1"), "wrong-session");
assert.equal(state.pendingToolCalls.has("call_o"), true);
assert.equal(result("call_o", "openai_1"), "sent");
assert.equal(state.pendingToolCalls.has("call_g"), true);
assert.equal(nextRev("openai_1", "citations"), 1);
assert.equal(nextRev("gemini_1", "citations"), 1);
assert.equal(nextRev("openai_1", "citations"), 2);
assert.equal(state.contextRevisions.get("gemini_1").citations, 1);
console.log("PASS pi-realtime simultaneous-provider litmus probe");
