# pi-realtime realtime voice proof matrix

Date: 2026-05-17

## Scope

This matrix covers the provider-neutral realtime voice system, fake/no-network provider, raw OpenAI WebSocket path, and opt-in OpenAI WebRTC helper scaffolding. Real OpenAI/Gemini network paths remain API-key guarded and are not required for offline gates.

## Artifacts

| Area | Evidence |
| --- | --- |
| Architecture | `.ai/docs/realtime-voice/architecture.md` |
| Input injection decision | `.ai/docs/realtime-voice/input-injection-decision.md` |
| Durable state/replay | `.pi/extensions/pi-realtime/events.ts`, `.pi/extensions/pi-realtime/store.ts` |
| Provider-neutral packets | `.pi/extensions/pi-realtime/state-packets.ts` |
| Control-plane instruction sink | `.pi/extensions/pi-realtime/control-plane.ts` |
| Fake provider | `.pi/extensions/pi-realtime/providers/fake.ts` |
| Lifecycle/context hardening | `.pi/extensions/pi-realtime/runtime.ts`, `.pi/extensions/pi-realtime/context.ts` |
| Commands | `.pi/extensions/pi-realtime/commands.ts` |
| OpenAI raw adapter | `.pi/extensions/pi-realtime/providers/openai.ts`, `.pi/extensions/pi-realtime/audio.ts`, `.pi/extensions/pi-realtime/playback.ts`, `.ai/docs/realtime-voice/openai-smoke-test.md` |
| OpenAI WebRTC helper | `.pi/extensions/pi-realtime/providers/openai-webrtc.ts`, `.pi/extensions/pi-realtime/providers/openai-webrtc-bridge.ts`, `.pi/extensions/pi-realtime/media/webrtc-helper/*`, `.ai/docs/realtime-voice/webrtc-helper-goal-plan.md` |
| Usage instrumentation | `.pi/extensions/pi-realtime/usage.ts`, `.pi/extensions/pi-realtime/providers/openai-usage.ts`, `/realtime usage`, `.ai/docs/realtime-voice/usage-instrumentation-goal-plan.md` |

## Deterministic probes

| Probe | Coverage |
| --- | --- |
| `.ai/validation/pi-realtime-structure-probe.mjs` | Required lifecycle hooks, append-entry persistence, branch replay source |
| `.ai/validation/pi-realtime-state-probe.mjs` | Event schema source contract, replay behavior, instruction sink source contract |
| `.ai/validation/pi-realtime-provider-isolation-probe.mjs` | Provider-session scoped tool result routing |
| `.ai/validation/pi-realtime-packets-probe.mjs` | Context packet revision behavior and direct tool surface/citation contract |
| `.ai/validation/pi-realtime-fake-provider-probe.mjs` | Fake adapter lifecycle, transcript/tool-call/result path, no provider SDK imports |
| `.ai/validation/pi-realtime-hardening-probe.mjs` | `session_tree`/`session_compact`/`context`/`session_shutdown`, stale custom-message filtering, non-interactive command safety |
| `.ai/validation/pi-realtime-simultaneous-litmus-probe.mjs` | Simultaneous-provider isolation for sessions, tool calls, and context revisions |
| `.ai/validation/pi-realtime-citation-deck-probe.mjs` | Pinotator citation deck parsing, ref resolution, revision changes |
| `.ai/validation/pi-realtime-openai-adapter-probe.mjs` | OpenAI adapter boundary, API-key guard, context/tool/function-call/result smoke contract, SDK import isolation |
| `.ai/validation/pi-realtime-openai-mic-probe.mjs` | Raw ffmpeg mic capture, PCM chunking, Realtime audio append contract, shutdown cleanup |
| `.ai/validation/pi-realtime-openai-playback-probe.mjs` | Raw ffplay audio playback, Realtime output audio event handling, transcript preservation, shutdown cleanup |
| `.ai/validation/pi-realtime-openai-webrtc-helper-probe.mjs` | WebRTC helper commands, raw-mode AEC warning, browser helper assets, browser-safe auth shape, helper lifecycle, usage forwarding, no API-key exposure in client assets |
| `.ai/validation/pi-realtime-usage-probe.mjs` | Usage pricing constants, response/transcription normalization boundary, durable usage events, `/realtime usage` command surface |

## Commands run

| Command | Result |
| --- | --- |
| `sentrux gate --save .pi/extensions/pi-realtime` | pass; baseline updated for hardened fake-provider system |
| `npm run gates:quality` | pass |
| `node ~/.codex/skills/pi-extension-dev/scripts/audit-pi-extension.mjs .` | pass; TOON decoded |
| `npm run scans:deslop` | pass, 0 advisory findings |
| `npm run gates:typecheck` | pass after WebRTC helper implementation |
| `npm run gates:validation` | pass after WebRTC helper and usage instrumentation implementation |

## Remaining planned proof

OpenAI raw text/mic/audio live validation is API-key guarded and manual. The WebRTC helper has deterministic offline coverage for structure, commands, auth boundary, and bridge shape; live browser/WebRTC smoke remains manual because it depends on browser permissions, OpenAI network access, and local audio hardware.
