#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const usage = readFileSync(".pi/extensions/pi-realtime/usage.ts", "utf8");
const openaiUsage = readFileSync(".pi/extensions/pi-realtime/providers/openai/usage.ts", "utf8");
const types = readFileSync(".pi/extensions/pi-realtime/types.ts", "utf8");
const events = readFileSync(".pi/extensions/pi-realtime/events.ts", "utf8");
const service = readFileSync(".pi/extensions/pi-realtime/service.ts", "utf8");
const commands = readFileSync(".pi/extensions/pi-realtime/commands.ts", "utf8");

assert.match(usage, /UsageObservation/);
assert.match(usage, /gpt-realtime-2/);
assert.match(usage, /audio: \{ input: 32, cachedInput: 0\.4, output: 64 \}/);
assert.match(usage, /text: \{ input: 4, cachedInput: 0\.4, output: 24 \}/);
assert.match(usage, /gpt-realtime-mini/);
assert.match(usage, /input_transcription uses a separate transcription model\/rate card|Input transcription uses a separate transcription model\/rate card/);
assert.match(usage, /aggregateUsage/);
assert.match(usage, /renderUsageSummary/);

assert.match(openaiUsage, /usageFromOpenAIResponseDone/);
assert.match(openaiUsage, /response\?\.usage/);
assert.match(openaiUsage, /usageFromOpenAIInputTranscription/);
assert.match(openaiUsage, /input_transcription/);
assert.match(openaiUsage, /cached_tokens_details/);

assert.match(types, /type: "usage"; observation: UsageObservation/);
assert.match(types, /kind: "usage_observed"/);
assert.match(types, /kind: "usage_reset"/);
assert.match(types, /usage: UsageObservation\[\]/);
assert.match(types, /usageResets: UsageReset\[\]/);
assert.match(events, /usageObserved/);
assert.match(events, /usageReset/);
assert.match(events, /event\.kind === "usage_observed"/);
assert.match(events, /state\.usage\.push/);
assert.match(events, /state\.usageResets\.push/);
assert.match(events, /event\.observation\.providerSessionId/);
assert.match(service, /usageObserved\(event\.observation\)/);
assert.match(service, /usageText/);
assert.match(service, /resetUsage/);
assert.match(commands, /usage,/);
assert.match(commands, /usage --details/);
assert.match(commands, /usage reset/);
assert.match(commands, /service\.usageText/);
assert.match(commands, /service\.resetUsage/);

function dollars(total, cached, input, cachedInput) { return ((total - cached) * input + cached * cachedInput) / 1_000_000; }
assert.equal(dollars(1000, 0, 4, 0.4), 0.004);
assert.equal(dollars(1000, 500, 4, 0.4), 0.0022);
assert.equal(dollars(600, 0, 32, 0.4), 0.0192);
assert.equal((1200 * 64) / 1_000_000, 0.0768);

console.log("PASS pi-realtime usage instrumentation probe");
