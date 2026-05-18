# Goal plan: Pi-to-realtime context push and efficient tool-response policy

## Objective

Close the Pi ↔ realtime control loop without unnecessary OpenAI realtime model turns.

Build two related capabilities:

1. Let the Pi agent explicitly push arbitrary text/status/reports back into the realtime model context through a Pi model tool call.
2. Replace the current eager tool-result `response.create` behavior with a deliberate response policy so a single voice instruction does not fan out into multiple costly realtime responses.

After the explicit push path works, decide which Pi agent outputs should be automatically transferred into the realtime context, in what shape, and by what mechanism.

## Current evidence / problem

Trace inspected:

```text
/var/folders/8j/f35z086s553cjd2cbqzj94hw0000gn/T/pi-realtime-traces/openai_ce2b7365-e587-4244-85b1-12fbd797dc2e-1779121974892.jsonl
```

The user said roughly: `tell Pi to check the latest logs`.

The realtime system produced multiple model turns:

```text
user transcript
response.create
assistant speech + pi_state_snapshot
response.create after tool result
pi_send_instruction
response.create after tool result
pi_wait_for_update
response.create after tool result
assistant final status
```

Usage evidence from the Web UI/logs showed repeated input audio accounting across these turns:

```text
response: input audio=399 cached audio=192
response: input audio=485 cached audio=448
response: input audio=485 cached audio=448
response: input audio=485 cached audio=448
```

This is not a duplicate logging issue. It is multiple real OpenAI response turns over the same conversation/audio context. Most repeated audio was cached, but the pattern is still inefficient and can become expensive.

## Constraints

- Preserve provider-neutral architecture.
- Keep OpenAI-specific behavior under `providers/openai/` and WebRTC helper boundaries.
- Keep Pi API wiring in `.pi/extensions/pi-realtime/runtime.ts`.
- Keep domain mutation/orchestration in `service.ts`; avoid turning it into a provider/tool dump.
- Do not disable realtime semantics or barge-in as a cost workaround.
- Do not solve tool overuse with prompt-only hacks alone.
- Residual context packets/citations/transcripts are context only; the realtime agent must not take arbitrary actions from them without current user instruction or confirmation.
- Browser helper must continue using ephemeral OpenAI Realtime client secrets only.

## Desired behavior

### Direct voice instruction

When the user says: `tell Pi to check the latest logs`, the realtime agent should normally perform:

```text
user transcript
response.create
pi_send_instruction
short spoken acknowledgement, or no extra model turn if the tool result can be terminally surfaced
```

It should not normally call `pi_state_snapshot` first, and should not call `pi_wait_for_update` unless explicitly requested or unless a real Pi-to-realtime update channel is active.

### Pi explicit push

Pi should be able to call a model tool such as:

```text
pi_realtime_send_text(text, mode?, targetSessionId?, responseHint?)
```

or equivalent, to place arbitrary text/status/report content into the active realtime session context.

Example uses:

- `I started checking the logs.`
- `Found one OpenAI active-response error at 18:07:34.`
- `Final report: low-information VAD suppressions are working; remaining issue is tool turn fan-out.`

The push must be provider-neutral at the service/control-plane boundary. OpenAI/WebRTC delivery can be provider-specific internally.

## Design phases

### Phase 1 — audit current response-create paths

Map every current source of `response.create`:

- valid transcript acceptance;
- manual `/realtime text` or equivalent;
- context packet pushes;
- tool result handling from helper server/provider adapter;
- reconnect/outbox replay paths.

For each path, record:

- why a response is requested;
- whether it is user-facing or intermediate;
- whether it should be audio, text-only, or no immediate response;
- whether it can occur after a tool result.

Deliverable: short matrix in the implementation notes or completion audit.

### Phase 2 — introduce response intent / continuation policy

Add a provider-neutral response policy type near the control-plane/provider boundary, for example:

```ts
type RealtimeResponseIntent =
  | "none"
  | "speak_ack"
  | "continue_tool_loop"
  | "speak_final"
  | "text_context_only";
```

Exact naming can differ, but the implementation must distinguish:

- no response after intermediate tool output;
- a single final spoken acknowledgement;
- deliberate tool-loop continuation;
- silent/context-only Pi updates;
- explicit user-facing speech.

Rules for MVP:

- `pi_state_snapshot` and citation lookup tool results should not automatically request another response unless the original user request clearly required a spoken answer from that data.
- `pi_send_instruction` should be treated as terminal for common proxy-mode commands: return a final acknowledgement and avoid `pi_wait_for_update` by default.
- `pi_wait_for_update` should not be auto-encouraged until Pi-to-realtime push is implemented and tested.
- Tool-result `response.create` should include a trace reason more specific than generic `tool_result`, e.g. `tool_result_final_ack`, `tool_result_continue`, or `tool_result_suppressed`.

### Phase 3 — implement explicit Pi model tool for realtime text push

Register a Pi model tool, likely in `.pi/extensions/pi-realtime/runtime.ts` with implementation delegated to service/control-plane modules.

Candidate tool name:

```text
pi_realtime_send_text
```

Candidate schema:

```json
{
  "text": "string, required",
  "targetSessionId": "string, optional; defaults to active realtime session",
  "mode": "context_only | request_spoken_response | request_text_response",
  "summary": "string, optional compact label for trace/UI",
  "audience": "voice_agent | user | both"
}
```

MVP semantics:

- `context_only`: create a realtime context/message item but do not request a model response.
- `request_spoken_response`: create the context item and request a response intended for audio output.
- `request_text_response`: optional if OpenAI/WebRTC can support it cleanly; otherwise document as future work.

Safety requirements:

- Reject empty text.
- Trace sender, target session, mode, summary, and whether a response was requested.
- Do not expose provider secrets.
- Do not replay stale pushed text after browser reconnect.
- Preserve append-only trace/event behavior.

### Phase 4 — provider delivery implementation

At the provider-neutral layer, add a method or event such as:

```ts
pushRealtimeContext(input: {
  providerSessionId?: string;
  text: string;
  mode: "context_only" | "request_spoken_response";
  source: "pi_model_tool" | "automatic_agent_output" | "manual";
  summary?: string;
}): Promise<...>
```

OpenAI/WebRTC delivery should likely use existing outbox mechanics:

- send `conversation.item.create` with a compact system/developer-style context packet or user-visible message, depending on mode;
- optionally enqueue `response.create` only when mode requests it;
- use outbox ack/cursor behavior so reconnect does not replay stale one-shot pushes.

Open questions to resolve during implementation:

- Whether OpenAI Realtime accepts the desired role/content combination for post-session context best as `system`, `user`, or another supported item shape.
- Whether pushed Pi reports should be tagged with a stable prefix such as `[pi-update]` for traceability.
- Whether `request_spoken_response` should use audio-only output or allow text+audio based on current provider capabilities.

### Phase 5 — automatic Pi output transfer design

Only after the explicit tool works, decide automatic transfer policy.

Candidate sources:

1. Last assistant message on Pi agent turn end.
2. Tool result summaries for long-running user-requested work.
3. Goal completion/status transitions.
4. Explicit `/realtime` command outputs.
5. Error reports from the realtime extension itself.

For each candidate, decide:

- default on/off;
- full text vs summary;
- max size and truncation policy;
- context-only vs spoken response request;
- whether user consent or an active proxy-mode request is required;
- deduplication key;
- branch/session scoping;
- privacy risks.

Initial recommended default:

- Do **not** automatically push every assistant message.
- Start with explicit tool calls only.
- Add opt-in automatic context-only push for the final Pi assistant message that directly satisfies a voice-originated `pi_send_instruction`.
- Keep automatic pushed content compact and tagged as Pi output, e.g.:

```text
[pi-agent-output instruction_id=...]
Summary: ...
Status: complete|blocked|needs_input
Details: ...
```

### Phase 6 — validation and live probes

Deterministic probes:

- `pi_realtime_send_text` rejects empty text.
- `context_only` push creates/delivers context without `response.create`.
- `request_spoken_response` creates context and exactly one response request.
- Browser reconnect does not replay stale pushed text or response request.
- `pi_send_instruction` common path no longer causes `pi_state_snapshot` + `pi_wait_for_update` fan-out.
- Tool-result policy traces suppression/continuation reasons.

Live validation:

1. Say: `tell Pi to check the latest logs`.
   - Expected: one direct instruction and at most one concise acknowledgement.
2. Have Pi call `pi_realtime_send_text` with `context_only`.
   - Expected: realtime model receives context; no spontaneous speech.
3. Have Pi call `pi_realtime_send_text` with `request_spoken_response`.
   - Expected: exactly one spoken response.
4. Reconnect browser helper.
   - Expected: no stale Pi-pushed text or stale response replay.
5. Inspect usage.
   - Expected: no repeated cascade of audio-context accounting from tool-result loops.

## Acceptance criteria

- Pi exposes an explicit model tool for pushing text/status/report content into realtime context.
- The explicit tool supports at least context-only and spoken-response modes.
- Empty or invalid pushes are rejected with clear errors.
- Tool-result handling no longer blindly creates a response after every tool result.
- Common proxy command `tell Pi to X` avoids unnecessary `pi_state_snapshot` and `pi_wait_for_update` fan-out.
- Traces identify response intent/reason and suppression decisions.
- Browser reconnect does not replay stale pushed text or stale response requests.
- A documented decision exists for automatic Pi output transfer candidates, defaults, payload form, and mechanism.
- `npm run gates:quality` passes.

## Non-goals

- Do not build a broad autonomous task-completion engine.
- Do not couple core design to Solo or scratchpad-specific semantics.
- Do not automatically feed all Pi transcript content to realtime by default.
- Do not rely only on prompt wording to control tool loops.
- Do not disable realtime interruption/barge-in to reduce cost.

## Completion audit requirements

Before marking this future goal complete, produce a completion audit that includes:

- response-create path matrix before/after;
- explicit Pi push tool schema and examples;
- automatic output-transfer decision matrix;
- deterministic validation results;
- live trace evidence for direct voice instruction and Pi push modes;
- usage comparison showing reduced response fan-out for a representative `tell Pi to X` command.
