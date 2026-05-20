#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routingSource = readFileSync(".pi/extensions/pi-realtime/domain/transcript-routing.ts", "utf8");
const serviceSource = readFileSync(".pi/extensions/pi-realtime/service.ts", "utf8");
const controlPlaneSource = readFileSync(".pi/extensions/pi-realtime/control-plane.ts", "utf8");
const fakeSource = readFileSync(".pi/extensions/pi-realtime/providers/fake.ts", "utf8");

assert.match(routingSource, /type TranscriptRouteDecision/);
assert.match(routingSource, /backendRoute !== "submit_instruction"/);
assert.match(routingSource, /reason: "mode_uses_model"/);
assert.match(routingSource, /!input\.event\.final/);
assert.match(routingSource, /reason: "non_final"/);
assert.match(routingSource, /reason: "empty"/);
assert.match(routingSource, /reason: "low_information"/);
assert.match(routingSource, /source: "direct_transcript"/);
assert.match(routingSource, /replace\(\/\[\\s\\p\{P\}\\p\{S\}\]\/gu, ""\)\.length >= 4/);
assert.match(serviceSource, /if \(event\.type === "user_transcript"\) return this\.routeTranscriptEvent\(event\)/);
assert.match(serviceSource, /controlPlane\.instructionSink\.sendInstruction\(decision\.input\)/);
assert.match(serviceSource, /direction: "transcript_route"/);
assert.match(controlPlaneSource, /input\.source === "direct_transcript"/);
assert.match(fakeSource, /simulateTranscript\(text: string, final = true\)/);

console.log("PASS pi-realtime transcript routing probe");
