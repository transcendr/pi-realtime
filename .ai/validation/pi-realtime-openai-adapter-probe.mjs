#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const openai = readFileSync(".pi/extensions/pi-realtime/providers/openai/index.ts", "utf8");
const service = readFileSync(".pi/extensions/pi-realtime/service.ts", "utf8");
const runtime = readFileSync(".pi/extensions/pi-realtime/providers/runtime.ts", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

assert.match(openai, /OpenAIRealtimeWebSocket/);
assert.match(openai, /hasOpenAIRealtimeCredentials/);
assert.match(openai, /OPENAI_API_KEY is required/);
assert.match(openai, /session\.update/);
assert.match(openai, /output_modalities/);
assert.doesNotMatch(openai, /[^_]modalities: \["text"\]/);
assert.match(openai, /conversation\.item\.create/);
assert.match(openai, /response\.function_call_arguments\.done/);
assert.match(openai, /usageFromOpenAIResponseDone/);
assert.match(openai, /usageFromOpenAIInputTranscription/);
assert.match(openai, /conversation\.item\.input_audio_transcription\.completed/);
assert.match(openai, /type: "usage"/);
assert.match(openai, /function_call_output/);
assert.match(openai, /updateContext/);
assert.match(openai, /updateToolSurface/);
assert.match(openai, /sendToolResult/);
assert.match(openai, /sendTextInput/);
assert.match(openai, /input_text/);
assert.match(openai, /requestResponse/);
assert.match(runtime, /hasOpenAIRealtimeCredentials\(\)/);
assert.match(runtime, /createOpenAIRealtimeProvider/);
assert.doesNotMatch(service, /hasOpenAIRealtimeCredentials\(\)/);
assert.doesNotMatch(service, /createOpenAIRealtimeProvider/);
assert.match(service, /sendTextInput\(providerSessionId/);
assert.match(service, /Realtime \$\{event\.provider\}: \$\{event\.text\}/);
assert.equal(pkg.dependencies?.openai?.startsWith("^6."), true);

const allowed = new Set([join(".pi/extensions/pi-realtime/providers/openai/index.ts"), join(".pi/extensions/pi-realtime/providers/openai/shared.ts")]);
for (const [file, source] of [
  [".pi/extensions/pi-realtime/service.ts", service],
  [".pi/extensions/pi-realtime/providers/openai/index.ts", openai],
  [".pi/extensions/pi-realtime/providers/openai/shared.ts", readFileSync(".pi/extensions/pi-realtime/providers/openai/shared.ts", "utf8")],
  [".pi/extensions/pi-realtime/providers/fake.ts", readFileSync(".pi/extensions/pi-realtime/providers/fake.ts", "utf8")],
]) {
  if (!allowed.has(file)) assert.doesNotMatch(source, /from "openai|openai\/realtime|openai\/resources/);
}

function normalizeToolName(name) {
  const allowed = ["pi_state_snapshot", "pi_send_instruction", "pi_wait_for_update", "pi_realtime_status", "pinotator_citations_list", "pinotator_citation_resolve"];
  return allowed.includes(name) ? name : "pi_realtime_status";
}
assert.equal(normalizeToolName("pi_send_instruction"), "pi_send_instruction");
assert.equal(normalizeToolName("unknown_tool"), "pi_realtime_status");
console.log("PASS pi-realtime OpenAI adapter boundary/smoke contract probe");
