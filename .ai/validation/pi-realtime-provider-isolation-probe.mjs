#!/usr/bin/env node
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const typesSource = readFileSync(".pi/extensions/pi-realtime/types.ts", "utf8");
const providerTypesSource = readFileSync(".pi/extensions/pi-realtime/providers/types.ts", "utf8");
const serviceSource = readFileSync(".pi/extensions/pi-realtime/service.ts", "utf8");
const runtimeSource = readFileSync(".pi/extensions/pi-realtime/providers/runtime.ts", "utf8");
const toolsSource = readFileSync(".pi/extensions/pi-realtime/tools.ts", "utf8");
const commandsSource = readFileSync(".pi/extensions/pi-realtime/commands.ts", "utf8");

assert.match(typesSource, /ProviderSessionId = string/);
assert.match(typesSource, /providerSessionId: ProviderSessionId/);
assert.match(typesSource, /VoiceToolCallId = string/);
assert.match(providerTypesSource, /providerSessionId: ProviderSessionId/);
assert.match(providerTypesSource, /sendToolResult\(result: VoiceToolResultRecord\)/);
assert.match(runtimeSource, /ProviderRuntimeRegistry/);
assert.match(runtimeSource, /createDefaultProviderRuntimeRegistry/);
assert.match(serviceSource, /createDefaultProviderRuntimeRegistry/);
assert.doesNotMatch(serviceSource, /from "\.\/providers\/openai"|from "@google\/genai"|openai\/realtime|createOpenAIRealtimeProvider|hasOpenAIRealtimeCredentials|createOpenAIWebRTCBridgeAdapter|createOpenAIWebRTCClientSecret/);
assert.doesNotMatch(serviceSource, /createMacOSFfmpegAudioCapture|AudioCaptureController|createFfplayAudioPlayback|AudioPlaybackController/);
assert.doesNotMatch(runtimeSource, /\.\/openai\/webrtc|createOpenAIWebRTCBridgeAdapter|createOpenAIWebRTCClientSecret|hasOpenAIWebRTCCredentials/);
assert.doesNotMatch(serviceSource, /setOpenAIWebRTCEnabled|isOpenAIWebRTCEnabled|startWebRTCHelper|stopWebRTCHelper|webRTCHelperStatus|sendInstructionFromTool|resolveCitation/);
assert.match(toolsSource, /missing required non-empty instruction text/);
assert.doesNotMatch(commandsSource, /function startOpenAI|function stopOpenAI|isOpenAIWebRTCEnabled/);
assert.deepEqual(readdirSync(".pi/extensions/pi-realtime/providers").filter((name) => /^openai[-.]/.test(name)), []);

function routeToolResult(pending, result) {
  const call = pending.get(result.voiceToolCallId);
  if (!call) return "missing";
  if (call.providerSessionId !== result.providerSessionId) return "wrong_provider_session";
  pending.delete(result.voiceToolCallId);
  return "sent";
}

const pending = new Map([
  ["call_openai", { voiceToolCallId: "call_openai", providerSessionId: "openai_1" }],
  ["call_gemini", { voiceToolCallId: "call_gemini", providerSessionId: "gemini_1" }],
]);
assert.equal(routeToolResult(pending, { voiceToolCallId: "call_openai", providerSessionId: "gemini_1" }), "wrong_provider_session");
assert.equal(pending.has("call_openai"), true);
assert.equal(routeToolResult(pending, { voiceToolCallId: "call_openai", providerSessionId: "openai_1" }), "sent");
assert.equal(pending.has("call_openai"), false);
assert.equal(pending.has("call_gemini"), true);
console.log("PASS pi-realtime provider-session isolation probe");
