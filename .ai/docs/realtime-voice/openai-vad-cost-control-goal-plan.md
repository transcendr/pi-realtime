# Goal plan: OpenAI Realtime VAD/cost control without slop

## Objective

Stop OpenAI Realtime from producing random/duplicate assistant speech and unnecessary token burn after false-positive or empty audio turns, while preserving realtime semantics such as barge-in/interruption and avoiding prompt-only hacks.

Immediate target: exhaust official OpenAI/server-side controls before adding custom browser/client VAD gates. The one intentional control-plane change is to stop automatic response creation on audio VAD stops and explicitly request a response only after an acceptable user turn is observed.

## Evidence from current trace

Trace inspected:

```text
/var/folders/8j/f35z086s553cjd2cbqzj94hw0000gn/T/pi-realtime-traces/openai_1b44f2ce-8ae9-4233-8b7f-7fef343cfe72-1779107842880.jsonl
```

Observed pattern around the reported repeat:

```text
input_audio_buffer.speech_started
input_audio_buffer.speech_stopped
input_audio_buffer.committed
conversation.item.input_audio_transcription.completed transcriptText=""
response.created
assistant speaks anyway
```

Session-level summary from the same trace:

- `response.done`: 103
- input audio transcripts: 83
- empty transcripts: 13
- observed response usage: ~830k total tokens
- responses shortly after empty transcripts: ~17 responses, ~248k observed tokens

This points to false/empty VAD-triggered turns causing model responses. Do not treat this as a prompt problem.

## Current code anchors

OpenAI WebRTC client secret session config:

```text
.pi/extensions/pi-realtime/providers/openai/webrtc.ts
```

Currently uses semantic VAD with automatic response creation:

```ts
turn_detection: { type: "semantic_vad", create_response: true, interrupt_response: true }
```

Raw OpenAI session config:

```text
.pi/extensions/pi-realtime/providers/openai/index.ts
```

WebRTC response creation path:

```text
.pi/extensions/pi-realtime/providers/openai/webrtc-bridge.ts
.pi/extensions/pi-realtime/media/webrtc-helper/client.js
.pi/extensions/pi-realtime/media/webrtc-helper/server.ts
```

Trace/usage normalization:

```text
.pi/extensions/pi-realtime/debug-trace.ts
.pi/extensions/pi-realtime/providers/openai/usage.ts
```

## Official OpenAI controls to use first

### 1. Disable automatic response creation from VAD stops

Change OpenAI turn detection to keep VAD events and interruption behavior, but prevent automatic model responses on VAD stop:

```ts
turn_detection: {
  type: "semantic_vad",
  create_response: false,
  interrupt_response: true,
}
```

Then explicitly send `response.create` only after our control plane decides the turn is valid.

This is not a custom audio gate. It is official OpenAI turn-detection configuration plus explicit response control.

### 2. Enable official input audio noise reduction

Use OpenAI's server-side audio noise reduction before VAD/model processing:

```ts
input_audio_noise_reduction: { type: "near_field" | "far_field" }
```

Default proposal:

- use `near_field` when the browser confirms headset/close mic assumptions or no explicit mode is configured;
- allow `far_field` as a configurable option for laptop/speaker-style capture.

### 3. Keep semantic VAD eagerness unchanged initially

Do **not** set `semantic_vad.eagerness = "low"` in the first implementation. It may affect latency/turn-taking and should be tested only after the response-control and noise-reduction changes are measured.

### 4. Optional later official fallback: server VAD tuning

If semantic VAD plus explicit response control still produces bad turns, add an explicit OpenAI VAD mode option:

```ts
turn_detection: {
  type: "server_vad",
  threshold: 0.6,              // configurable; higher means louder activation
  silence_duration_ms: 500,
  prefix_padding_ms: 300,
  create_response: false,
  interrupt_response: true,
  idle_timeout_ms: null,
}
```

This should be a second-stage setting, not the first change, because switching VAD mode changes turn-taking semantics more than disabling automatic response creation.

## Design

### Add a provider-specific OpenAI turn/audio config module

Create:

```text
.pi/extensions/pi-realtime/providers/openai/session-config.ts
```

Responsibilities:

- own OpenAI-specific realtime session audio/turn-detection config;
- expose a small typed builder used by both raw WebSocket and WebRTC client-secret paths;
- keep provider-specific knobs out of `service.ts` and generic provider runtime files.

Example API shape:

```ts
type OpenAITurnControlMode = "manual_response_after_turn" | "auto_response";
type OpenAINoiseReductionMode = "near_field" | "far_field" | "off";

function buildOpenAIRealtimeAudioConfig(input: {
  turnControl: OpenAITurnControlMode;
  noiseReduction: OpenAINoiseReductionMode;
  vadMode: "semantic" | "server";
}): RealtimeAudioConfig;
```

MVP defaults:

```ts
turnControl: "manual_response_after_turn"
noiseReduction: "near_field"
vadMode: "semantic"
semantic eagerness: omitted/default
```

### Manual response policy for WebRTC helper

When `create_response: false`, OpenAI should still emit speech events, commits, and transcription events. The helper/client must decide when to call `response.create`.

Policy for MVP:

1. On `conversation.item.input_audio_transcription.completed`:
   - if transcript trimmed length is > 0: send `response.create`;
   - if transcript is empty: suppress response and record why.
2. Preserve explicit response creation for:
   - tool result output;
   - `/realtime text` / future `pi_realtime_send_text`;
   - system/context push paths that intentionally request a response.
3. Do not suppress barge-in/interruption events. `interrupt_response: true` remains enabled.

Important: this policy intentionally uses transcription as a first MVP accept/reject signal. The docs warn transcription is not authoritative for what the model heard, so this should be validated live. If this loses legitimate non-transcribed speech, refine with OpenAI VAD event metadata or server VAD thresholds before introducing custom audio gates.

### Raw WebSocket parity

Apply the same OpenAI config builder to `.pi/extensions/pi-realtime/providers/openai/index.ts`.

Raw mode has direct `sendAudioInput(...)`; if turn auto-response is disabled, add equivalent response triggering after acceptable transcription events. If raw mode cannot reliably pair transcription completion with an input item yet, document it and keep raw behavior behind a separate compatibility flag until validated.

### Stale outbox replay fix

Current trace showed old outbox events replaying after reconnect/reload. Fix this alongside VAD work because replayed user/context items can create extra responses and cost.

Design options:

- add per-helper connection generation and initialize browser `lastOutboxId` from server state;
- or have `/outbox` support `?after=latest` / initial cursor endpoint;
- or clear delivered one-shot outbox events once acknowledged.

MVP requirement: a browser reconnect must not replay previously delivered `conversation.item.create` user text or old `response.create` events.

Keep context packet delivery intentional: initial context may be resent for a new OpenAI session, but stale manual/user text and stale response requests must not replay accidentally.

### Observability

Extend debug trace records with enough detail to diagnose cost:

- OpenAI VAD mode and knobs at session creation;
- noise reduction setting;
- `create_response` / `interrupt_response` values;
- every local `response.create` reason:
  - `valid_transcript`
  - `empty_transcript_suppressed`
  - `tool_result`
  - `manual_text`
  - `context_update`
- transcript length and empty/non-empty classification;
- per-response usage details where available, not only total tokens:
  - input text tokens;
  - input audio tokens;
  - cached tokens;
  - output text/audio tokens.

Do not dump full audio or large payloads; keep trace token-efficient and privacy-conscious.

## Implementation phases

### Phase 1 — shared OpenAI config builder

1. Add `providers/openai/session-config.ts`.
2. Move the duplicated OpenAI audio/turn config from:
   - `providers/openai/webrtc.ts`
   - `providers/openai/index.ts`
3. Default to:
   - semantic VAD;
   - `create_response: false`;
   - `interrupt_response: true`;
   - input audio noise reduction `near_field`;
   - no semantic `eagerness` override.
4. Add deterministic unit/probe coverage asserting emitted config.

### Phase 2 — explicit response creation after valid transcript

1. In the WebRTC helper client/server boundary, detect final input transcript events.
2. If transcript is non-empty, send `response.create` with reason `valid_transcript`.
3. If transcript is empty, do not send `response.create`; trace `empty_transcript_suppressed`.
4. Preserve existing explicit `response.create` paths for tool results and manual text.
5. Add probes for:
   - empty transcript does not enqueue/send response;
   - non-empty transcript does request response;
   - tool result still requests response.

### Phase 3 — stale outbox replay hardening

1. Make helper outbox delivery connection-aware or cursor-safe.
2. Ensure reconnect starts after the latest already-delivered item, or only receives fresh queued events.
3. Add probe simulating browser reconnect:
   - deliver outbox ids 1..N;
   - reconnect with browser cursor reset;
   - assert old user text/response events are not redelivered.

### Phase 4 — richer usage/cost diagnostics

1. Enhance usage normalization and trace output to preserve token breakdowns from OpenAI response usage.
2. Add `/realtime usage --details` output or debug summarizer that can show:
   - total response tokens;
   - tokens after empty transcripts;
   - response count by reason;
   - outbox replay count if any.
3. Validate against the existing trace with an offline analysis probe/script.

### Phase 5 — live validation

Run a live OpenAI WebRTC test with controlled scenarios:

1. Silence for 60 seconds after assistant response:
   - expected: VAD events may occur, but no assistant response to empty transcript.
2. Quiet room noise / keyboard noise:
   - expected: no response unless transcript is non-empty and meaningful enough under current policy.
3. Normal voice turn:
   - expected: response still happens.
4. Barge-in during assistant speech:
   - expected: interruption still works.
5. Browser reconnect/reload:
   - expected: no stale manual text/response replay.

Record proof under `.ai/validation/live-probe/` or `.ai/docs/realtime-voice/`.

## Acceptance criteria

- Empty input transcripts no longer cause assistant speech.
- Official OpenAI controls are used before custom audio gates:
  - `create_response: false`;
  - explicit `response.create` only after accepted turns;
  - `input_audio_noise_reduction` enabled/configured;
  - semantic eagerness left at default initially.
- Barge-in/interruption remains enabled.
- `/realtime text`, tool-result responses, and future Pi-to-realtime text pushes still produce responses intentionally.
- Browser/helper reconnect does not replay stale user text or stale `response.create` events.
- Debug traces explain why a response was created or suppressed.
- `npm run gates:quality` passes.

## Non-goals for this goal

- No custom browser-side VAD/RMS/AudioWorklet gate yet.
- No prompt-only suppression of random speech.
- No muting the microphone as a workaround for unexplained false positives.
- No semantic `eagerness: "low"` change in the MVP.
- No changes that disable barge-in/interruption without explicit user approval.

## Follow-up options if official controls are insufficient

Only after the above is measured:

1. Tune semantic VAD `eagerness` lower, if latency tradeoff is acceptable.
2. Try `server_vad` with higher `threshold` and tuned silence/prefix settings.
3. Add browser-side audio-level diagnostics, then a custom gate if evidence shows server-side controls cannot distinguish local noise/silence.
