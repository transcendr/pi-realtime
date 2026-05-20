#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(".pi/extensions/pi-realtime/domain/interaction-modes.ts", "utf8");
const providerTypes = readFileSync(".pi/extensions/pi-realtime/providers/types.ts", "utf8");
const promptSource = readFileSync(".pi/extensions/pi-realtime/prompt.ts", "utf8");

assert.match(source, /RealtimeInteractionModeId/);
assert.match(source, /const AGENT_MODE: RealtimeInteractionMode/);
assert.match(source, /const ECO_MODE: RealtimeInteractionMode/);
assert.match(source, /id: "agent"[\s\S]*acceptModelToolCalls: true[\s\S]*toolChoice: "auto"[\s\S]*response: "model"/);
assert.match(source, /id: "eco"[\s\S]*acceptModelToolCalls: false[\s\S]*tools: \[\][\s\S]*toolChoice: "none"[\s\S]*response: "suppress"[\s\S]*backendRoute: "submit_instruction"/);
assert.match(source, /backendSpeechContext: "isolated_update"/);
assert.match(source, /function interactionMode/);
assert.match(source, /function providerInteractionFor/);
assert.match(source, /function toolSurfaceFor/);
assert.match(providerTypes, /interaction: ProviderInteractionConfig/);
assert.match(promptSource, /function voiceSpeechRendererPrompt/);
assert.match(promptSource, /No direct tools are available in this interaction mode/);

console.log("PASS pi-realtime interaction mode policy probe");
