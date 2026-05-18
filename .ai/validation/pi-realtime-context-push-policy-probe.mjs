#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runtime = readFileSync(".pi/extensions/pi-realtime/runtime.ts", "utf8");
const piTools = readFileSync(".pi/extensions/pi-realtime/tools/pi.ts", "utf8");
const realtimeTools = readFileSync(".pi/extensions/pi-realtime/tools/realtime.ts", "utf8");
const service = readFileSync(".pi/extensions/pi-realtime/service.ts", "utf8");
const types = readFileSync(".pi/extensions/pi-realtime/types.ts", "utf8");
const providerTypes = readFileSync(".pi/extensions/pi-realtime/providers/types.ts", "utf8");
const bridge = readFileSync(".pi/extensions/pi-realtime/providers/openai/webrtc-bridge.ts", "utf8");
const raw = readFileSync(".pi/extensions/pi-realtime/providers/openai/index.ts", "utf8");
const fake = readFileSync(".pi/extensions/pi-realtime/providers/fake.ts", "utf8");
const prompt = readFileSync(".pi/extensions/pi-realtime/prompt.ts", "utf8");
const plan = readFileSync(".ai/docs/realtime-voice/pi-to-realtime-context-and-tool-response-policy-goal-plan.md", "utf8");

assert.match(runtime, /registerRealtimeModelTools\(pi, service\)/);
assert.doesNotMatch(runtime, /name: "pi_realtime_send_text"/);
assert.match(piTools, /name: "pi_realtime_send_text"/);
assert.match(piTools, /context_only/);
assert.match(piTools, /request_spoken_response/);
assert.match(piTools, /service\.pushRealtimeContext/);
assert.match(realtimeTools, /executeVoiceTool/);
assert.match(realtimeTools, /pi_send_instruction/);
assert.match(service, /pi_realtime_send_text requires non-empty/);

assert.match(types, /RealtimePushMode = "context_only" \| "request_spoken_response"/);
assert.match(types, /RealtimeContextPushInput/);
assert.match(providerTypes, /RealtimeContextPushRequest/);
assert.match(providerTypes, /ToolResultResponsePolicy = "none" \| "continue" \| "final_ack"/);
assert.match(providerTypes, /pushContext\(input: RealtimeContextPushRequest\)/);

assert.match(service, /pushRealtimeContext/);
assert.match(service, /No active realtime session is available/);
assert.match(service, /pi_realtime_context_push/);
assert.match(service, /responsePolicyForTool/);
assert.match(service, /call\.name === "pi_send_instruction"/);
assert.match(service, /call\.name === "pi_wait_for_update"/);
assert.match(service, /recordToolResult\([^\n]+responsePolicyForTool\(call\)/);

assert.match(bridge, /response_create_suppressed/);
assert.match(bridge, /tool_result_suppressed/);
assert.match(bridge, /context_push_context_only/);
assert.match(bridge, /context_push_response_requested/);
assert.match(bridge, /reason: "pi_context_push"/);
assert.match(bridge, /mode === "request_spoken_response"/);
assert.match(bridge, /role: "system"/);
assert.match(bridge, /\[pi-update source=/);

assert.match(raw, /pushContext/);
assert.match(raw, /reason: "pi_context_push"/);
assert.match(raw, /policy === "none"/);
assert.match(fake, /pushedContexts/);
assert.match(fake, /request_spoken_response/);

assert.match(prompt, /call pi_send_instruction directly/);
assert.match(prompt, /do not inspect Pi state first/);
assert.match(prompt, /do not call pi_wait_for_update unless the user explicitly asks/);
assert.match(prompt, /Use at most one direct tool/);

assert.match(plan, /response-create path matrix before\/after/);
assert.match(plan, /automatic output-transfer decision matrix/);
console.log("PASS pi-realtime context push and tool-response policy probe");
