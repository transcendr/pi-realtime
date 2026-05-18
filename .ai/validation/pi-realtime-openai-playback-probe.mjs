#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const playback = readFileSync(".pi/extensions/pi-realtime/playback.ts", "utf8");
const openai = readFileSync(".pi/extensions/pi-realtime/providers/openai/index.ts", "utf8");
const sessionConfig = readFileSync(".pi/extensions/pi-realtime/providers/openai/session-config.ts", "utf8");
const service = readFileSync(".pi/extensions/pi-realtime/service.ts", "utf8");
const audioManager = readFileSync(".pi/extensions/pi-realtime/audio-manager.ts", "utf8");
const commands = readFileSync(".pi/extensions/pi-realtime/commands.ts", "utf8");
const providerTypes = readFileSync(".pi/extensions/pi-realtime/providers/types.ts", "utf8");

assert.match(playback, /spawn\("ffplay"/);
assert.match(playback, /s16le/);
assert.match(playback, /24_000/);
assert.match(playback, /ch_layout/);
assert.doesNotMatch(playback, /"-ac"/);
assert.match(playback, /proc\.stdin\.write\(chunk\)/);
assert.match(playback, /wasStopping/);
assert.doesNotMatch(playback, /throw error/);

assert.match(providerTypes, /onProviderAudio/);
assert.match(providerTypes, /setAudioOutputEnabled\(enabled: boolean\)/);
assert.match(openai, /response\.output_audio\.delta/);
assert.match(openai, /Buffer\.from\(event\.delta, "base64"\)/);
assert.match(openai, /response\.output_audio_transcript\.done/);
assert.match(sessionConfig, /voice: input\.voice \?\? "marin"/);

assert.match(service, /startAudioPlayback/);
assert.match(service, /stopAudioPlayback/);
assert.match(service, /handleProviderAudio/);
assert.match(service, /audioManager\.writeProviderAudio/);
assert.match(audioManager, /stopAudioPlayback/);
assert.match(audioManager, /setAudioOutputEnabled\(false\)/);

assert.match(commands, /openai audio start\|stop\|status/);
assert.match(commands, /\/realtime audio start\|stop\|status/);
console.log("PASS pi-realtime OpenAI audio playback probe");
