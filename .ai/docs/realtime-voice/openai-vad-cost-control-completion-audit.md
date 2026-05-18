# Completion audit: OpenAI VAD/cost control

Date: 2026-05-18

Goal plan audited: `.ai/docs/realtime-voice/openai-vad-cost-control-goal-plan.md`

## Verdict

Complete for the current VAD/cost-control objective.

The implementation now prevents empty and low-information transcript turns from creating OpenAI realtime responses, preserves OpenAI interruption semantics, records response/suppression reasons, hardens helper outbox replay, and passes the project quality gate. Live testing showed the previously bad `hmm`/`음.`/`Mhm.` cases being suppressed before `response.create`.

Remaining cost issue discovered after completion is a separate tool-result response-policy problem: one valid voice instruction can create several model responses because each tool result currently triggers another `response.create`. That is intentionally moved to the follow-up goal plan.

## Evidence

### Official OpenAI controls

Implemented in `.pi/extensions/pi-realtime/providers/openai/session-config.ts`:

- `create_response: false`
- `interrupt_response: true`
- default OpenAI noise reduction: `near_field`
- default VAD mode now `server_vad`
- server VAD knobs:
  - threshold `0.7`
  - silence duration `700ms`
  - prefix padding `300ms`
  - `idle_timeout_ms: null`
- no semantic `eagerness: "low"` override

### Explicit response policy

Implemented in:

- `.pi/extensions/pi-realtime/providers/openai/index.ts`
- `.pi/extensions/pi-realtime/media/webrtc-helper/client.js`

Behavior:

- empty transcripts suppress local `response.create` with reason `empty_transcript`
- low-information transcripts suppress local `response.create` with reason `low_information_transcript`
- accepted transcripts request response with reason `valid_transcript`

The low-information gate is generic and not a filler-word blacklist: it strips whitespace, punctuation, and symbols and requires at least four lexical characters.

### Live trace evidence

Current session trace:

```text
/var/folders/8j/f35z086s553cjd2cbqzj94hw0000gn/T/pi-realtime-traces/openai_ce2b7365-e587-4244-85b1-12fbd797dc2e-1779121974892.jsonl
```

Observed suppressions:

- `嗯。` -> `response_suppressed`
- `음.` -> `response_suppressed`
- `Mhm.` -> `response_suppressed`
- empty transcript -> `response_suppressed`

A real longer utterance still produced a response and tool call, confirming the response path remains functional.

Prior live-probe notes:

- `.ai/validation/live-probe/openai-vad-cost-control-2026-05-18.md`
- `.ai/validation/live-probe/openai-vad-cost-control-2026-05-18-second-pass.md`

### Stale outbox replay hardening

Implemented helper outbox replay hardening with cursor/ack behavior so reconnect does not resend stale user text or stale `response.create` events.

Validated by updated WebRTC helper probe coverage.

### Observability

Implemented trace/usage improvements:

- OpenAI session audio config is traced on helper start.
- Local `response.create` reason is traced.
- Suppression reason is traced.
- Usage token breakdowns include input/output text/audio and cached token details where available.

### Gates

Last executed:

```text
npm run gates:quality
```

Result: pass.

The gate included:

- structural gate/check
- deslop scan at blocking threshold
- TypeScript typecheck
- deterministic validation probes
- Pi offline extension load smoke

## Acceptance criteria mapping

- Empty input transcripts no longer cause assistant speech: met.
- Official OpenAI controls used before custom audio gates: met.
- Barge-in/interruption remains enabled: met by config (`interrupt_response: true`) and no disabling change.
- `/realtime text`, tool-result responses, and future Pi-to-realtime text pushes still intentionally produce responses: current explicit response paths preserved; follow-up will refine excessive tool-result responses.
- Browser/helper reconnect does not replay stale user text or stale `response.create`: met by outbox cursor/ack hardening and probe coverage.
- Debug traces explain why a response was created or suppressed: met.
- `npm run gates:quality` passes: met.

## Follow-up required

The latest valid voice instruction exposed a distinct inefficiency: tool chaining produced multiple response turns, each re-accounting cached audio context. That is not a VAD false-positive problem. Track it in the next goal plan for:

- tool-result response policy;
- `pi_realtime_send_text` / Pi-to-realtime model tool capability;
- explicit and automatic Pi output transfer design.
