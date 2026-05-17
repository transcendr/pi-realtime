#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const typesSource = readFileSync(".pi/extensions/pi-realtime/types.ts", "utf8");
const eventsSource = readFileSync(".pi/extensions/pi-realtime/events.ts", "utf8");
const storeSource = readFileSync(".pi/extensions/pi-realtime/store.ts", "utf8");
const controlPlaneSource = readFileSync(".pi/extensions/pi-realtime/control-plane.ts", "utf8");

assert.match(typesSource, /CUSTOM_EVENT_TYPE = "pi-realtime\.events\.v1"/);
assert.match(typesSource, /EVENT_VERSION = 1/);
for (const kind of ["session_started", "session_stopped", "context_packet_sent", "voice_tool_call_received", "voice_instruction_submitted", "usage_observed", "citation_deck_observed"]) assert.match(typesSource, new RegExp(`kind: "${kind}"`));
assert.match(typesSource, /usage: UsageObservation\[\]/);
assert.match(storeSource, /ctx\.sessionManager\.getBranch\(\)/);
assert.match(storeSource, /pi\.appendEntry\(CUSTOM_EVENT_TYPE, event\)/);
assert.match(storeSource, /local\.delete\(event\.eventId\)/);
assert.match(eventsSource, /function replayEvents/);
assert.match(eventsSource, /pendingToolCalls\.set/);
assert.match(eventsSource, /pendingToolCalls\.delete/);
assert.match(controlPlaneSource, /pi\.sendUserMessage/);
assert.match(controlPlaneSource, /voiceInstructionSubmitted/);

function replay(events) {
  const state = { sessions: new Map(), primary: null, pending: new Map(), context: new Map(), usage: [], lastInstruction: null };
  for (const event of events.sort((a, b) => a.at - b.at || a.eventId.localeCompare(b.eventId))) {
    if (event.kind === "session_started") {
      state.sessions.set(event.session.providerSessionId, { ...event.session });
      state.primary ??= event.session.providerSessionId;
    }
    if (event.kind === "session_stopped") {
      const session = state.sessions.get(event.providerSessionId);
      if (session) session.status = "stopped";
      if (state.primary === event.providerSessionId) state.primary = null;
    }
    if (event.kind === "voice_tool_call_received") state.pending.set(event.call.voiceToolCallId, event.call);
    if (event.kind === "voice_tool_result_sent") state.pending.delete(event.result.voiceToolCallId);
    if (event.kind === "context_packet_sent") state.context.set(`${event.providerSessionId}:${event.packet.channel}`, event.packet.revision);
    if (event.kind === "voice_instruction_submitted") state.lastInstruction = event.instruction;
    if (event.kind === "usage_observed") state.usage.push(event.observation);
  }
  return state;
}

const state = replay([
  { version: 1, kind: "session_started", eventId: "evt-1", at: 1, session: { providerSessionId: "fake_a", provider: "fake", model: "fake-realtime", personaId: "default", status: "active", startedAt: 1 } },
  { version: 1, kind: "voice_tool_call_received", eventId: "evt-2", at: 2, call: { voiceToolCallId: "call_1", provider: "fake", providerSessionId: "fake_a", name: "pi_send_instruction", arguments: {}, status: "pending", createdAt: 2 } },
  { version: 1, kind: "context_packet_sent", eventId: "evt-3", at: 3, providerSessionId: "fake_a", packet: { packetId: "pkt_1", revision: 4, channel: "pi_state", priority: "normal", summary: "ok", createdAt: 3 }, receipt: { status: "delivered" } },
  { version: 1, kind: "voice_tool_result_sent", eventId: "evt-4", at: 4, result: { voiceToolCallId: "call_1", providerSessionId: "fake_a", status: "sent", resultText: "ok", at: 4 } },
  { version: 1, kind: "usage_observed", eventId: "evt-5", at: 5, observation: { providerSessionId: "fake_a", provider: "openai", model: "gpt-realtime-2", source: "response", at: 5, input: { textTokens: 1, audioTokens: 2, imageTokens: 0, cachedTextTokens: 0, cachedAudioTokens: 0, cachedImageTokens: 0 }, output: { textTokens: 3, audioTokens: 4, imageTokens: 0, cachedTextTokens: 0, cachedAudioTokens: 0, cachedImageTokens: 0 }, totalTokens: 10, estimatedCostUsd: 0.1 } },
]);

assert.equal(state.sessions.get("fake_a").status, "active");
assert.equal(state.primary, "fake_a");
assert.equal(state.pending.size, 0);
assert.equal(state.context.get("fake_a:pi_state"), 4);
assert.equal(state.usage.length, 1);
assert.equal(state.usage[0].totalTokens, 10);
console.log("PASS pi-realtime durable replay/source contract probe");
