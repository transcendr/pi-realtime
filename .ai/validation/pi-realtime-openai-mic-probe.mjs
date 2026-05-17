#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const audio = readFileSync(".pi/extensions/pi-realtime/audio.ts", "utf8");
const openai = readFileSync(".pi/extensions/pi-realtime/providers/openai.ts", "utf8");
const service = readFileSync(".pi/extensions/pi-realtime/service.ts", "utf8");
const commands = readFileSync(".pi/extensions/pi-realtime/commands.ts", "utf8");
const providerTypes = readFileSync(".pi/extensions/pi-realtime/providers/types.ts", "utf8");

assert.match(audio, /spawn\("ffmpeg"/);
assert.match(audio, /avfoundation/);
assert.match(audio, /24_000/);
assert.match(audio, /s16le/);
assert.match(audio, /proc\.on\("error"/);
assert.match(audio, /wasStopping/);
assert.doesNotMatch(audio, /throw error/);

assert.match(providerTypes, /sendAudioInput\(audio: Buffer\)/);
assert.match(openai, /input_audio_buffer\.append/);
assert.match(openai, /audio\.toString\("base64"\)/);
assert.match(openai, /format: \{ type: "audio\/pcm", rate: 24000 \}/);
assert.match(openai, /turn_detection: \{ type: "semantic_vad"/);
assert.match(openai, /output_modalities: \[this\.audioOutputEnabled \? "audio" : "text"\]/);

assert.match(service, /startMicrophone/);
assert.match(service, /stopMicrophone/);
assert.match(service, /await this\.stopMicrophone\(providerSessionId\)/);
assert.match(service, /await this\.stopMicrophone\(\)/);

assert.match(commands, /openai mic start\|stop\|status/);
assert.match(commands, /\/realtime mic start\|stop\|status/);
console.log("PASS pi-realtime OpenAI microphone input probe");
