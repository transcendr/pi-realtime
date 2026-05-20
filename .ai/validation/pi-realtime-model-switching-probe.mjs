#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const types = readFileSync(".pi/extensions/pi-realtime/types.ts", "utf8");
const runtimeTypes = readFileSync(".pi/extensions/pi-realtime/providers/runtime-types.ts", "utf8");
const openAIModelProfiles = readFileSync(".pi/extensions/pi-realtime/providers/openai/model-profiles.ts", "utf8");
const openAIRuntime = readFileSync(".pi/extensions/pi-realtime/providers/openai/runtime.ts", "utf8");
const behaviorProfiles = readFileSync(".pi/extensions/pi-realtime/domain/behavior-profiles.ts", "utf8");
const service = readFileSync(".pi/extensions/pi-realtime/service.ts", "utf8");
const commands = readFileSync(".pi/extensions/pi-realtime/commands.ts", "utf8");

assert.match(types, /type ProviderPreferences = \{[\s\S]*autoMediaMode\?: ProviderMediaMode;[\s\S]*defaultModel\?: string;[\s\S]*\}/);
assert.match(runtimeTypes, /availableModels\?\(\): readonly string\[\]/);
assert.match(runtimeTypes, /behaviorProfileForModel\?\(model: string\): RealtimeBehaviorProfileFragment/);
assert.match(openAIModelProfiles, /OPENAI_REALTIME_MODELS = \["gpt-realtime-mini", "gpt-realtime-2"\] as const/);
assert.match(openAIModelProfiles, /function openAIBehaviorProfileForModel\(model: string\): RealtimeBehaviorProfileFragment/);
assert.match(openAIModelProfiles, /import \{ STRONG_REALTIME_SPEECH_RENDERER_PROFILE, WEAK_REALTIME_SPEECH_RENDERER_PROFILE \} from "\.\.\/\.\.\/domain\/behavior-profiles"/);
assert.match(openAIModelProfiles, /model === "gpt-realtime-mini"\) return WEAK_REALTIME_SPEECH_RENDERER_PROFILE/);
assert.match(openAIModelProfiles, /model === "gpt-realtime-2"\) return STRONG_REALTIME_SPEECH_RENDERER_PROFILE/);
assert.match(openAIModelProfiles, /return \{\};/);
assert.match(openAIRuntime, /import \{ OPENAI_REALTIME_MODELS, openAIBehaviorProfileForModel \} from "\.\/model-profiles"/);
assert.match(openAIRuntime, /availableModels\(\) \{ return OPENAI_REALTIME_MODELS; \}/);
assert.match(openAIRuntime, /behaviorProfileForModel: openAIBehaviorProfileForModel/);
assert.match(behaviorProfiles, /DEFAULT_BEHAVIOR_PROFILE: RealtimeBehaviorProfile/);
assert.match(behaviorProfiles, /enabled: false/);
assert.match(behaviorProfiles, /systemPromptMode: "strict_verbatim"/);
assert.match(behaviorProfiles, /envelope: "speak_this_verbatim"/);
assert.match(behaviorProfiles, /defaultMode: "verbatim"/);
assert.match(behaviorProfiles, /WEAK_REALTIME_SPEECH_RENDERER_PROFILE[\s\S]*enabled: true[\s\S]*maxChars: 800[\s\S]*splitStrategy: "sentence"/);
assert.match(behaviorProfiles, /WEAK_REALTIME_SPEECH_RENDERER_PROFILE[\s\S]*envelope: "json_task"/);
assert.match(behaviorProfiles, /STRONG_REALTIME_SPEECH_RENDERER_PROFILE[\s\S]*systemPromptMode: "per_response_rendering"[\s\S]*envelope: "speech_source"[\s\S]*longTextThresholdChars: 300[\s\S]*longTextMode: "compact_summary"/);
assert.match(behaviorProfiles, /resolveRealtimeBehaviorProfile/);
assert.match(behaviorProfiles, /\.\.\.DEFAULT_BEHAVIOR_PROFILE\.backendUpdateSpeech\.chunking/);
assert.match(behaviorProfiles, /\.\.\.DEFAULT_BEHAVIOR_PROFILE\.backendUpdateSpeech\.rendering/);

assert.match(service, /defaultModelFor\(provider: ProviderKind\): string \{ return this\.providerPreference\(provider\)\.defaultModel \?\? this\.requireProviderRuntime\(provider\)\.defaultModel\(\); \}/);
assert.match(service, /availableModelsFor\(provider: ProviderKind\): readonly string\[\]/);
assert.match(service, /setDefaultModel\(provider: ProviderKind, model: string\): string/);
assert.match(service, /if \(!available\.includes\(model\)\) throw new Error/);
assert.match(service, /providerPreferences: \{ \.\.\.this\.store\.state\(\)\.config\.providerPreferences, \[provider\]: \{ \.\.\.this\.providerPreference\(provider\), defaultModel: model \} \}/);
assert.match(service, /New sessions will use this model unless --model overrides it/);

assert.match(commands, /openai model gpt-realtime-mini/);
assert.match(commands, /openai model gpt-realtime-2/);
assert.match(commands, /if \(subcommand === "model"\) return openAIModel\(rest, ctx, service\)/);
assert.match(commands, /function openAIModel\(tokens: string\[], ctx: ExtensionCommandContext, service: Service\): void/);
assert.match(commands, /Current OpenAI realtime default model/);
assert.match(commands, /service\.setDefaultModel\("openai", model\)/);
assert.match(commands, /const model = valueAfter\(tokens, "--model"\) \?\? service\.defaultModelFor\(provider\)/);
assert.doesNotMatch(service, /model === "gpt-realtime-mini"/);

console.log("PASS pi-realtime OpenAI model switching/profile probe");
