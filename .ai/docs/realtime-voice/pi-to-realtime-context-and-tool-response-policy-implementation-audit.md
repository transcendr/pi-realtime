# Implementation audit: Pi-to-realtime context push and tool-response policy

Date: 2026-05-18

Goal plan: `.ai/docs/realtime-voice/pi-to-realtime-context-and-tool-response-policy-goal-plan.md`

## Current status

Implementation is ready for live validation. Per the goal workflow, the session is paused at this point instead of marking complete so the user can validate the live realtime behavior.

## Concrete deliverables / success criteria

- Explicit Pi model tool for pushing text/status/report content into realtime context.
- At least two push modes: `context_only` and `request_spoken_response`.
- Empty or invalid pushes rejected clearly.
- Tool-result handling no longer blindly creates `response.create` after every direct voice tool result.
- Common proxy command `tell Pi to X` should avoid the previous `pi_state_snapshot` + `pi_wait_for_update` fan-out.
- Traces identify response intent/reason and suppression decisions.
- Browser reconnect should not replay stale pushed text or stale response requests.
- Document automatic Pi output transfer decisions.
- `npm run gates:quality` passes.

## Response-create path matrix

| Path | Before | After | Evidence |
|---|---|---|---|
| Valid transcript | Helper/client sent `response.create` after accepted transcript | Still sends exactly for accepted transcript with reason `valid_transcript`; low-info transcript gate unchanged | `.pi/extensions/pi-realtime/media/webrtc-helper/client.js`, VAD probe |
| Manual `/realtime text` / provider text input | Sends user message and `response.create` | unchanged; still intentionally user-facing | `sendTextInput` in OpenAI adapters |
| Context packet update | Sends `conversation.item.create` context only | unchanged; no response requested by `updateContext` | `updateContext` in OpenAI adapters |
| Tool result | Always enqueued function output and requested `response.create` reason `tool_result` | Function output is enqueued, but response is suppressed by default and traced as `tool_result_suppressed`; policy can opt into `tool_result_continue` or `tool_result_final_ack` | `sendToolResult(..., policy)` in provider interface and OpenAI adapters |
| Pi explicit text push | did not exist | `context_only` enqueues context without response; `request_spoken_response` also requests one response reason `pi_context_push` | `pi_realtime_send_text`, `pushRealtimeContext`, OpenAI `pushContext` |
| Outbox reconnect/replay | stale replay previously possible | existing cursor/ack outbox hardening preserved; Pi pushes use same outbox path and one-shot response semantics | WebRTC helper outbox ack/cursor probes and code |

## Explicit Pi push tool schema and examples

Tool registered in `.pi/extensions/pi-realtime/runtime.ts`:

```text
pi_realtime_send_text
```

Parameters:

```json
{
  "text": "string, required, non-empty after trim",
  "providerSessionId": "string, optional; defaults to primary realtime session",
  "mode": "context_only | request_spoken_response, optional default context_only",
  "summary": "string, optional compact trace/UI label",
  "audience": "voice_agent | user | both, optional caller clarity"
}
```

Examples:

```json
{"text":"Started checking the latest logs.","mode":"context_only","summary":"log check started"}
```

```json
{"text":"Final report: low-information VAD suppression is working; remaining issue was tool fan-out.","mode":"request_spoken_response","summary":"final log report","audience":"both"}
```

Safety:

- empty text rejected by `pushRealtimeContext` with `pi_realtime_send_text requires non-empty text.`
- no provider secrets exposed;
- provider-neutral service API delegates provider delivery to adapters;
- trace records mode, source, summary, text length, and response request status.

## Automatic Pi output transfer decision matrix

| Candidate source | Default | Payload form | Mechanism | Notes |
|---|---:|---|---|---|
| Every Pi assistant message | off | n/a | n/a | Too broad; privacy/cost risk; explicitly not implemented. |
| Final Pi assistant message satisfying a voice-originated instruction | future opt-in | compact tagged summary, status, details | `pi_realtime_send_text`-equivalent internal call, likely `context_only` first | Best first automatic transfer after explicit tool is live validated. |
| Tool result summaries from long-running user-requested work | off initially | summary with correlation id | future automatic push | Needs correlation and dedupe. |
| Goal completion/status transitions | off initially | compact status packet | future automatic push | Useful but should be opt-in and scoped. |
| `/realtime` command outputs | explicit only | command result text or summary | explicit tool/manual path | Avoid hidden automatic chatter. |
| Realtime extension errors | possible future opt-in | short error + recovery status | context-only or spoken if user-facing | Needs severity thresholds. |

Initial policy remains explicit-only. Automatic transfer is intentionally not implemented until live validation confirms explicit push and response policy behavior.

## Deterministic validation evidence

New probe:

```text
.ai/validation/pi-realtime-context-push-policy-probe.mjs
```

Covers:

- `pi_realtime_send_text` registration;
- `context_only` and `request_spoken_response` modes;
- service-level empty text rejection;
- provider-neutral push types;
- OpenAI WebRTC and raw adapter `pushContext` implementation;
- fake adapter support;
- tool-result response suppression tracing;
- prompt guidance against unnecessary `pi_state_snapshot` / `pi_wait_for_update` fan-out.

Command run:

```text
npm run gates:quality
```

Result: pass.

The quality gate included:

- Sentrux structure gate/check;
- blocking deslop scan;
- TypeScript typecheck;
- deterministic validation probes;
- Pi offline extension load smoke.

## Live validation still required

The goal explicitly requests pausing at the end for validation. Before marking complete, run live probes:

1. Say: `tell Pi to check the latest logs`.
   - Expected: no `pi_state_snapshot` + `pi_wait_for_update` cascade.
   - Expected: at most one model/tool turn beyond the user transcript.
2. Call `pi_realtime_send_text` with `context_only`.
   - Expected: context item delivered, no spontaneous speech / no `response.create`.
3. Call `pi_realtime_send_text` with `request_spoken_response`.
   - Expected: exactly one `response.create` and one spoken response.
4. Reload/reconnect the browser helper.
   - Expected: no stale Pi-pushed text or stale response replay.
5. Inspect usage.
   - Expected: no repeated cascade of identical cached audio-token accounting from tool-result loops.

## Known implementation tradeoff to validate

Direct voice tool results are now response-suppressed by default. This should stop the costly tool-loop cascade, but live testing must confirm the realtime user experience is acceptable when `pi_send_instruction` is terminally handled without an extra realtime continuation turn.
