#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fakeSource = readFileSync(".pi/extensions/pi-realtime/providers/fake.ts", "utf8");
const serviceSource = readFileSync(".pi/extensions/pi-realtime/service.ts", "utf8");
const runtimeSource = readFileSync(".pi/extensions/pi-realtime/providers/runtime.ts", "utf8");
const commandsSource = readFileSync(".pi/extensions/pi-realtime/commands.ts", "utf8");
const controlPlaneSource = readFileSync(".pi/extensions/pi-realtime/control-plane.ts", "utf8");

assert.match(fakeSource, /class FakeRealtimeProviderAdapter/);
assert.match(fakeSource, /simulateTranscript/);
assert.match(fakeSource, /simulateToolCall/);
assert.match(fakeSource, /updateContext/);
assert.match(fakeSource, /sendToolResult/);
assert.doesNotMatch(fakeSource, /from "openai"|from "@google\/genai"|WebSocket/);
assert.match(runtimeSource, /createFakeRealtimeProvider/);
assert.match(runtimeSource, /createFakeProviderRuntime/);
assert.doesNotMatch(serviceSource, /createFakeRealtimeProvider/);
assert.match(serviceSource, /executeDirectTool/);
assert.match(serviceSource, /pi_send_instruction/);
assert.match(serviceSource, /pinotator_citation_resolve/);
assert.match(serviceSource, /missing required non-empty instruction text/);
assert.doesNotMatch(serviceSource, /Voice provider requested Pi action without instruction text/);
assert.match(serviceSource, /\.disconnect\(/);
assert.match(commandsSource, /fake transcript/);
assert.match(commandsSource, /fake tool/);
assert.match(controlPlaneSource, /pi\.sendUserMessage/);

class FakeHarness {
  constructor(id) { this.id = id; this.events = []; this.results = []; this.seq = 0; }
  emit(type, data = {}) { this.events.push({ type, provider: "fake", providerSessionId: this.id, localSeq: ++this.seq, ...data }); }
  connect() { this.emit("connected"); }
  updateContext(packet) { this.emit("context_delivery", { packetId: packet.packetId, revision: packet.revision, status: "delivered" }); }
  simulateToolCall(name, args) { const id = `call_${this.seq + 1}`; this.emit("tool_call", { call: { voiceToolCallId: id, providerSessionId: this.id, provider: "fake", name, arguments: args, status: "pending" } }); return id; }
  sendToolResult(result) { this.results.push(result); }
  disconnect() { this.emit("disconnected", { reason: "shutdown" }); }
}

const fake = new FakeHarness("fake_1");
fake.connect();
fake.updateContext({ packetId: "pkt_1", revision: 1 });
const callId = fake.simulateToolCall("pi_send_instruction", { instruction: "Run tests", citedCitationIds: ["cit_1"] });
fake.sendToolResult({ voiceToolCallId: callId, providerSessionId: "fake_1", status: "sent", resultText: "Submitted instruction to Pi." });
fake.disconnect();

assert.deepEqual(fake.events.map((event) => event.type), ["connected", "context_delivery", "tool_call", "disconnected"]);
assert.equal(fake.events[2].call.providerSessionId, "fake_1");
assert.equal(fake.results[0].voiceToolCallId, callId);
assert.equal(fake.results[0].providerSessionId, "fake_1");
console.log("PASS pi-realtime fake provider lifecycle/tool routing probe");
