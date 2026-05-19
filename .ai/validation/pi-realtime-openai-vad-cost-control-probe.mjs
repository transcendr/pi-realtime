#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sessionConfig = readFileSync(".pi/extensions/pi-realtime/providers/openai/session-config.ts", "utf8");
const openai = readFileSync(".pi/extensions/pi-realtime/providers/openai/index.ts", "utf8");
const webrtc = readFileSync(".pi/extensions/pi-realtime/providers/openai/webrtc.ts", "utf8");
const bridge = readFileSync(".pi/extensions/pi-realtime/providers/openai/webrtc-bridge.ts", "utf8");
const runtime = readFileSync(".pi/extensions/pi-realtime/providers/openai/runtime.ts", "utf8");
const providerTypes = readFileSync(".pi/extensions/pi-realtime/providers/types.ts", "utf8");
const client = readFileSync(".pi/extensions/pi-realtime/media/webrtc-helper/client.js", "utf8");
const server = readFileSync(".pi/extensions/pi-realtime/media/webrtc-helper/server.ts", "utf8");
const protocol = readFileSync(".pi/extensions/pi-realtime/media/webrtc-helper/protocol.ts", "utf8");
const debugTrace = readFileSync(".pi/extensions/pi-realtime/debug-trace.ts", "utf8");

assert.match(sessionConfig, /buildOpenAIRealtimeAudioConfig/);
assert.match(sessionConfig, /DEFAULT_TURN_CONTROL: OpenAITurnControlMode = "manual_response_after_turn"/);
assert.match(sessionConfig, /DEFAULT_NOISE_REDUCTION: OpenAINoiseReductionMode = "near_field"/);
assert.match(sessionConfig, /create_response: \(input\.turnControl \?\? DEFAULT_TURN_CONTROL\) === "auto_response"/);
assert.match(sessionConfig, /interrupt_response: true/);
assert.match(sessionConfig, /noise_reduction: \{ type: noiseReduction \}/);
assert.match(sessionConfig, /DEFAULT_VAD_MODE: OpenAIVadMode = "server"/);
assert.match(sessionConfig, /DEFAULT_SERVER_VAD_THRESHOLD = 0\.7/);
assert.match(sessionConfig, /DEFAULT_SERVER_VAD_SILENCE_DURATION_MS = 700/);
assert.match(sessionConfig, /type: "server_vad"/);
assert.match(sessionConfig, /idle_timeout_ms: null/);
assert.match(sessionConfig, /isOpenAITranscriptActionable/);
assert.match(sessionConfig, /transcript\.replace/);
assert.match(sessionConfig, /\.length >= 4/);
assert.doesNotMatch(sessionConfig, /eagerness: "low"/);

assert.match(openai, /buildOpenAIRealtimeAudioConfig\(\{ includeRawPcmFormat: true, includeRawPcmOutputFormat: true \}\)/);
assert.match(openai, /isOpenAITranscriptActionable\(event\.transcript\)/);
assert.match(openai, /reason: "valid_transcript"/);
assert.match(webrtc, /audio: buildOpenAIRealtimeAudioConfig\(\)/);
assert.match(runtime, /summarizeOpenAIRealtimeAudioConfig/);

assert.match(providerTypes, /"valid_transcript"/);
assert.match(client, /handleInputAudioTranscription/);
assert.match(client, /response_suppressed/);
assert.match(client, /reason: "empty_transcript"/);
assert.match(client, /reason: "low_information_transcript"/);
assert.match(client, /lexicalContentLength\(transcript\) >= 4/);
assert.match(client, /requestResponse\("valid_transcript", event\.event_id\)/);
assert.match(client, /openai_outbound_response_create/);
assert.match(client, /sessionStorage\.setItem\(outboxCursorStorageKey\(\), String\(value\)\)/);
assert.match(client, /resumeOutboxAfter/);
assert.match(client, /type: "outbox_ack"/);

assert.match(bridge, /response_create_requested/);
assert.match(bridge, /reason: request\.reason/);
assert.match(server, /deliveredOutboxId/);
assert.match(server, /resumeOutboxAfter: session\.deliveredOutboxId/);
assert.match(server, /inbound\.type === "outbox_ack"/);
assert.match(server, /session\.deliveredOutboxId = Math\.max\(session\.deliveredOutboxId, inbound\.outboxId\)/);
assert.match(protocol, /resumeOutboxAfter\?: number/);
assert.match(protocol, /type: "outbox_ack"/);

assert.match(debugTrace, /inputTextTokens/);
assert.match(debugTrace, /inputAudioTokens/);
assert.match(debugTrace, /outputAudioTokens/);

console.log("PASS pi-realtime OpenAI VAD/cost control probe");
