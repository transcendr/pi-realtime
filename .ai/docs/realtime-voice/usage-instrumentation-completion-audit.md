# Usage Instrumentation Completion Audit

Date: 2026-05-17
Objective: complete `.ai/docs/realtime-voice/usage-instrumentation-goal-plan.md`, audit, stage, and commit.

## Success criteria and evidence

| Requirement | Evidence | Status |
| --- | --- | --- |
| Provider-neutral usage model | `.pi/extensions/pi-realtime/usage.ts` defines `UsageObservation`, `UsageBreakdown`, cost estimation, aggregation, and rendering. Pricing constants cover `gpt-realtime-2`, `gpt-realtime-1.5`, and `gpt-realtime-mini`. | Met |
| Separate response vs input transcription usage | `UsageSource` is `"response" | "input_transcription"`; `costExcludedReason()` marks input transcription as tracked but excluded from local estimate when transcription rate card is not configured. | Met |
| Durable replay-aware state | `types.ts` adds `usage_observed`; `events.ts` adds `usageObserved()`, stores observations in `RealtimeState.usage`, includes usage in `isRealtimeEvent()`, and maps usage history rows by provider session. | Met |
| Provider-neutral event path | `NormalizedProviderEvent` includes `{ type: "usage"; observation: UsageObservation }`; `service.handleProviderEvent()` records usage via `usageObserved(event.observation)` without notifications or model responses. | Met |
| OpenAI-specific parsing isolated | `.pi/extensions/pi-realtime/providers/openai-usage.ts` parses OpenAI `response.done.response.usage` and `conversation.item.input_audio_transcription.completed.usage` into provider-neutral observations. | Met |
| Raw OpenAI WebSocket captures usage | `providers/openai.ts` calls `usageFromOpenAIResponseDone()` on `response.done` and `usageFromOpenAIInputTranscription()` on transcription completion, then emits `type: "usage"`. | Met |
| WebRTC helper forwards usage | `client.js` posts usage events for `response.done` and input transcription completion; `protocol.ts` accepts usage inbound events; `server.ts` normalizes via injected `normalizeUsageEvent`; `openai-webrtc-bridge.ts` injects OpenAI usage normalization. | Met |
| `/realtime usage` command | `commands.ts` routes `usage`, completions include `usage` and `usage --details`, help documents `/realtime usage [--session <id>] [--details]`; `service.usageText()` renders summaries from replayed state. | Met |
| User output includes session/model context | `service.usageText()` prefixes session-specific output with `session: <id> <provider>/<model> <status>` or lists sessions for aggregate output. | Met |
| Browser does not get API key | Existing WebRTC auth remains ephemeral client secret only; usage forwarding adds no `OPENAI_API_KEY` client exposure. Covered by WebRTC helper probe. | Met |
| Documentation updated | `README.md`, `.ai/docs/realtime-voice/openai-smoke-test.md`, and `.ai/docs/realtime-voice/proof-matrix.md` describe usage telemetry, `/realtime usage`, response vs transcription usage, local estimates, and dashboard authority. | Met |
| Deterministic probes | Added `.ai/validation/pi-realtime-usage-probe.mjs`; updated OpenAI adapter, WebRTC helper, and state probes for usage capture/replay/commands. | Met |
| Sentrux coupling regression remains fixed | `npm run gates:quality` ran `sentrux gate` and `sentrux check`; quality improved `6306 -> 6397`, coupling stayed `0.29 -> 0.29`, cycles `0 -> 0`. | Met |
| Quality gates and audit pass | `npm run gates:quality` passed; `node ~/.codex/skills/pi-extension-dev/scripts/audit-pi-extension.mjs .` passed with 34 checks and 0 warnings; `npm run scans:deslop` passed with 0 findings after review fixes. | Met |

## Validation evidence

Commands run after implementation:

```bash
npm run gates:typecheck
npm run gates:validation
sentrux gate .pi/extensions/pi-realtime
sentrux check .pi/extensions/pi-realtime
npm run gates:quality
node ~/.codex/skills/pi-extension-dev/scripts/audit-pi-extension.mjs .
npm run scans:deslop
```

Final results:

- `npm run gates:quality`: pass
- Sentrux gate/check inside quality: pass, no degradation
- `audit-pi-extension.mjs .`: pass, 34 checks, 0 warnings
- `npm run scans:deslop`: pass, 0 findings

## Audit decision

All implementation, documentation, deterministic validation, and structural requirements in `.ai/docs/realtime-voice/usage-instrumentation-goal-plan.md` are met. Live comparison against the OpenAI billing dashboard remains a manual smoke step using `/realtime usage --details`, as planned.
