# Realtime Usage Instrumentation Goal Plan

Date: 2026-05-17
Status: design ready; implementation not started

## Objective

Implement clean, modular, provider-neutral usage instrumentation for `pi-realtime` so realtime voice cost investigations are based on actual provider usage events rather than wall-clock estimates.

The implementation must be encapsulated enough that OpenAI-specific usage payload parsing does not leak into the core service, and provider-neutral state/commands can later support Gemini Live or other providers.

## Why this goal exists

Observed billing for short `gpt-realtime-2` WebRTC tests appears much higher than expected from elapsed audio time. OpenAI's current Realtime cost docs say:

- Realtime costs accrue when a Response is created.
- `response.done.response.usage` corresponds to billing for that Response.
- VAD should filter empty input audio so empty audio does not count as input tokens unless the client manually adds it as conversation input.
- User audio is documented as roughly 1 audio token per 100ms; assistant audio roughly 1 audio token per 50ms.
- Input transcription, when enabled, is separately billable and reports usage on `conversation.item.input_audio_transcription.completed`.
- Conversation history is included as input for later responses, so previous text/audio can become input on later turns; cached-token accounting matters.

Given those rules, the extension needs to capture actual usage payloads and estimated costs per session/turn.

## Non-goals

- Do not implement push-to-talk as the first cost-control mechanism.
- Do not reduce context quality as a first response to cost concerns.
- Do not remove raw WebSocket mode.
- Do not remove WebRTC helper mode.
- Do not redesign voice-to-Pi steering semantics in this instrumentation goal.
- Do not hardcode usage logic inside `service.ts`, `commands.ts`, or browser helper UI beyond thin event forwarding/display.

## Deliverables

### 1. Provider-neutral usage model

Add a focused module:

```text
.pi/extensions/pi-realtime/usage.ts
```

Responsibilities:

- Define provider-neutral usage record types.
- Normalize usage into a stable internal shape.
- Estimate dollars from model/provider pricing tables.
- Aggregate per provider session.
- Render compact human-readable summaries for `/realtime usage` and helper UI.

Suggested public API:

```ts
export type UsageModality = "text" | "audio" | "image";
export type UsageDirection = "input" | "output" | "cached_input";
export type UsageSource = "response" | "input_transcription";

export type UsageBreakdown = {
  textTokens: number;
  audioTokens: number;
  imageTokens: number;
  cachedTextTokens: number;
  cachedAudioTokens: number;
  cachedImageTokens: number;
};

export type UsageObservation = {
  providerSessionId: ProviderSessionId;
  provider: ProviderKind;
  model: string;
  source: UsageSource;
  providerEventId?: string;
  responseId?: string;
  itemId?: string;
  at: number;
  input: UsageBreakdown;
  output: UsageBreakdown;
  totalTokens: number;
  estimatedCostUsd: number;
  rawUsage?: unknown;
};

export function estimateUsageCost(input: {
  provider: ProviderKind;
  model: string;
  source: UsageSource;
  input: UsageBreakdown;
  output: UsageBreakdown;
}): number;

export function aggregateUsage(observations: readonly UsageObservation[]): UsageSummary;
export function renderUsageSummary(summary: UsageSummary): string;
```

Rules:

- Keep pricing data in `usage.ts` or a dedicated `usage-pricing.ts`, not in provider adapters.
- Make pricing explicit and easy to update.
- Include `gpt-realtime-2`, `gpt-realtime-1.5`, and `gpt-realtime-mini` table entries from the current pricing page.
- Separate conversational response usage from input transcription usage because transcription uses a separate rate card/model.
- If transcription model pricing is unknown, record tokens and mark cost as `unknown`/excluded rather than pretending it is zero.

### 2. Event and replay persistence

Extend `.pi/extensions/pi-realtime/types.ts` and `.pi/extensions/pi-realtime/events.ts` with a durable event:

```ts
| {
    version: typeof EVENT_VERSION;
    kind: "usage_observed";
    eventId: string;
    at: number;
    observation: UsageObservation;
  }
```

Replay requirements:

- `RealtimeState` gains a `usage` collection or a pre-aggregated usage summary.
- `applyEvent()` stores usage observations in state.
- `historyRow()` includes `providerSessionId` for usage rows.
- Usage survives `/reload`, `/tree`, compaction replay, and resume through the existing branch-aware store.

### 3. Provider adapter boundaries

OpenAI-specific normalization belongs near OpenAI provider code, but with a narrow exported function that returns provider-neutral `UsageObservation`.

Suggested files:

```text
.pi/extensions/pi-realtime/providers/openai-usage.ts
```

Responsibilities:

- Parse `response.done.response.usage` into `UsageObservation` with `source: "response"`.
- Parse `conversation.item.input_audio_transcription.completed.usage` into `UsageObservation` with `source: "input_transcription"`.
- Preserve `rawUsage` only if small and safe; otherwise keep normalized fields only.
- Treat missing usage as no observation, not an error.

Raw WebSocket adapter changes:

- In `providers/openai.ts`, when handling `response.done`, emit both:
  - existing `turn_signal` event
  - new `usage` normalized provider event if usage exists
- When handling `conversation.item.input_audio_transcription.completed`, emit existing transcript plus usage if usage exists.

WebRTC helper changes:

- Extend `WebRTCHelperInboundEvent` in `media/webrtc-helper/protocol.ts` with `{ type: "usage"; observation: ... }` or a raw OpenAI usage event shape that the server normalizes.
- Prefer normalizing in TypeScript shared code, not duplicating pricing math in `client.js`.
- In `client.js`, forward `response.done` usage and input transcription usage to the helper server.
- The browser helper may display a simple rolling total, but core accounting must happen in the Pi extension service.

Provider-neutral event shape:

- Extend `NormalizedProviderEvent` with a usage event, for example:

```ts
| (ProviderEventBase & { type: "usage"; observation: UsageObservation })
```

Core service behavior:

- `service.handleProviderEvent()` records usage via `usageObserved(...)`.
- Usage recording must not trigger model responses or Pi instructions.
- Usage events should not spam Pi notifications by default.

### 4. User-facing commands

Add command support in `.pi/extensions/pi-realtime/commands.ts`:

```text
/realtime usage
/realtime usage --session <providerSessionId>
/realtime usage --details
```

Output should include:

- session id, provider, model;
- response count with usage;
- transcription count with usage;
- input text/audio/image tokens;
- cached input text/audio/image tokens;
- output text/audio tokens;
- estimated cost, with unknown/excluded components called out;
- last usage event timestamp;
- short note that dashboard billing is authoritative and estimates use current local pricing constants.

Completions and `/realtime help` must include `usage`.

### 5. WebRTC helper visibility

Update `client.html` / `client.js` lightly:

- log each `response.done` usage event in compact form;
- log each input transcription usage event in compact form;
- show a visible rolling estimated total if the server returns or accepts normalized usage summaries;
- avoid duplicating full pricing logic in browser JS.

If browser display requires too much coupling, defer browser display and keep helper forwarding only; `/realtime usage` is the source of truth.

### 6. Validation probes

Add or extend deterministic probes:

```text
.ai/validation/pi-realtime-usage-probe.mjs
.ai/validation/pi-realtime-openai-webrtc-helper-probe.mjs
.ai/validation/pi-realtime-openai-adapter-probe.mjs
.ai/validation/pi-realtime-state-probe.mjs
```

Probe coverage requirements:

- `usage.ts` has cost calculation tests for:
  - `gpt-realtime-2` text input/output;
  - `gpt-realtime-2` audio input/output;
  - cached text/audio input;
  - unknown transcription pricing path.
- OpenAI raw adapter recognizes `response.done.response.usage`.
- OpenAI raw adapter recognizes `conversation.item.input_audio_transcription.completed.usage`.
- WebRTC helper client forwards usage on `response.done`.
- WebRTC helper client forwards usage on input transcription completed.
- Server protocol accepts usage events without browser API keys.
- State replay retains usage observations.
- `/realtime usage` and help/completions mention the command.

All probes must be offline and deterministic; no OpenAI network call, browser automation, or audio hardware should be required.

### 7. Documentation

Update:

```text
README.md
.ai/docs/realtime-voice/openai-smoke-test.md
.ai/docs/realtime-voice/proof-matrix.md
```

Docs should explain:

- usage telemetry source events;
- difference between response usage and input transcription usage;
- what is estimated locally vs authoritative billing dashboard;
- why wall-clock audio estimates are insufficient;
- how to run `/realtime usage` during live tests;
- how to compare telemetry before/after cost-control changes.

## Suggested implementation sequence

1. Add `usage.ts` pure domain module and deterministic cost/aggregation probe.
2. Extend types/events/state replay with `usage_observed`.
3. Add `/realtime usage` command using only replayed state.
4. Add OpenAI raw usage normalization in `providers/openai-usage.ts` and raw adapter event emission.
5. Extend WebRTC protocol/server/client to forward usage events.
6. Add docs and proof matrix rows.
7. Run hard gates:

```bash
npm run gates:typecheck
npm run gates:validation
npm run gates:quality
node ~/.codex/skills/pi-extension-dev/scripts/audit-pi-extension.mjs .
```

8. Live smoke with billing investigation:

```text
/reload
/realtime start --provider openai --model gpt-realtime-2
/realtime openai webrtc start
# short voice exchange
/realtime usage --details
```

## Completion criteria

The instrumentation implementation goal is complete only when all of the following are true:

- Usage events from raw OpenAI WebSocket and WebRTC helper are captured.
- Response usage and input transcription usage are distinguishable.
- Usage observations are durable and branch-aware through the existing store.
- `/realtime usage` reports per-session totals and estimated cost.
- Browser helper forwards usage without learning or holding `OPENAI_API_KEY`.
- Pricing math is isolated in a usage module and covered by deterministic probes.
- Core service remains provider-neutral; OpenAI-specific shape parsing is isolated.
- Quality gates and pi-extension audit pass.
- A live smoke can compare `/realtime usage --details` to the observed billing dashboard delta.

## Design risks and mitigations

| Risk | Mitigation |
| --- | --- |
| OpenAI usage payload evolves | Keep parser tolerant; ignore missing fields; preserve provider event id and source. |
| Transcription pricing unclear | Track transcription token usage separately and mark cost excluded/unknown until pricing is confirmed. |
| Browser JS duplicates domain logic | Browser forwards raw/compact usage only; `usage.ts` owns math. |
| Service grows too large | `service.ts` only records usage events and renders command output via `usage.ts`. |
| Usage spam in transcript | Do not notify on every usage event; expose via command/status/helper log. |
| False confidence from estimates | Output states dashboard billing is authoritative and local estimates are best-effort. |

## Prompt-to-artifact checklist for this design goal

| Requested requirement | Artifact/evidence |
| --- | --- |
| Design a goal | This document defines a future implementation goal with objective, deliverables, sequence, and completion criteria. |
| Implement instrumentation | Deliverables specify usage event capture, cost estimation, persistence, commands, WebRTC forwarding, and docs/probes. |
| Clean modularization | Design introduces `usage.ts`, optional `usage-pricing.ts`, and `providers/openai-usage.ts`, keeping service/commands thin. |
| Encapsulated logic | Provider-specific parsing stays in OpenAI module; cost/aggregation stays in usage module; browser only forwards/displays. |
| Avoid repeating completed work | Design builds on existing raw/WebRTC/session/store architecture without redoing adapter setup or WebRTC signaling. |
