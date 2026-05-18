# Implementation audit: realtime frontend / Pi backend communication model

Date: 2026-05-18

Goal plan: `.ai/docs/realtime-voice/pi-to-realtime-context-and-tool-response-policy-goal-plan.md`

## Current status

Implemented and ready for live validation. Per the goal workflow, pause before final completion so the user can validate realtime behavior.

## Refined interaction model implemented

The architecture now follows the user's stated model:

```text
Realtime = voice frontend / interface
Pi       = backend worker / main agent
```

Realtime should only do shallow interaction work: listen, clarify, and communicate user intent. Pi performs backend work and reports back through explicit realtime-send tools.

## Prompt-to-artifact checklist

| Requirement | Evidence |
|---|---|
| Realtime gets one tool named/described as generic `request` | `.pi/extensions/pi-realtime/prompt.ts` exposes only `request` in `defaultVoiceToolSurface()` |
| Existing realtime tools are not deleted | `.pi/extensions/pi-realtime/tools/realtime.ts` still supports `pi_state_snapshot`, citation tools, `pi_wait_for_update`, `pi_realtime_status`, and legacy `pi_send_instruction` |
| Existing realtime tools are not exposed to the realtime model | `defaultVoiceToolSurface()` returns only `{ name: "request" ... }`; validation asserts old names are absent from prompt surface |
| `pi_send_instruction` renamed for exposed realtime use | exposed tool is `request`; OpenAI tool params use `request`; raw adapter unknown tool fallback is `request` |
| Realtime system prompt reinforces frontend/backend model | `.pi/extensions/pi-realtime/prompt.ts`: says realtime is frontend/interface, not main coding worker, should use `request` for backend work, should not reveal backend split |
| Realtime should not do multi-step processing/tool loops | Prompt forbids backend reasoning/tool chains; provider tool-result policy returns `none`; only one exposed tool exists |
| Pi gets `realtime_send_ack` | `.pi/extensions/pi-realtime/tools/pi.ts` registers tool with ack-specific description |
| Pi gets `realtime_send_status` | `.pi/extensions/pi-realtime/tools/pi.ts` registers tool with progress/checkpoint-specific description |
| Pi gets `realtime_send_text` | `.pi/extensions/pi-realtime/tools/pi.ts` registers tool for summaries/reports/final answers |
| Realtime send tools say no active session if inactive | `Service.pushRealtimeContext()` returns clear no-active/not-live messages instead of targeting stale primary blindly |
| Default realtime-send target is originating realtime session | `Service.defaultRealtimePushTarget()` prefers `state.lastInstruction.providerSessionId`, then primary live adapter, then latest live adapter |
| Start realtime session injects Pi context without triggering turn | `RealtimeService.startSession()` calls `controlPlane.sendSessionAwareness(session, true)`; control plane uses `pi.sendMessage()` without `triggerTurn` |
| Stop realtime session injects Pi context without triggering turn | `RealtimeService.stopSession()` calls `controlPlane.sendSessionAwareness(session, false)` |
| Realtime request into Pi uses custom message, not regular user message | `control-plane.ts` uses `pi.sendMessage(...)` with `REALTIME_REQUEST_MESSAGE_TYPE` and `triggerTurn: true`; no longer uses `pi.sendUserMessage()` |
| Custom realtime request message is visible in TUI and rendered yellow | `.pi/extensions/pi-realtime/messages.ts` registers renderer using `theme.fg("warning", ...)` and request messages set `display: true` |
| Custom request message includes model-facing guidance for Pi | `renderRealtimeRequestMessage()` tells Pi to treat request as user work delivered through realtime and use `realtime_send_ack/status/text` |
| Provider-neutral architecture preserved | Pi model tools delegate to `Service.pushRealtimeContext`; OpenAI-specific delivery remains in OpenAI adapters/helper |
| Browser reconnect stale replay hardening preserved | Pi pushes continue through existing WebRTC helper outbox/ack path |
| Quality gate passes | `npm run gates:quality` passed on 2026-05-18 |

## Response-create path matrix

| Path | Current behavior |
|---|---|
| Accepted user transcript | Browser helper sends one `response.create` reason `valid_transcript` after transcript actionability gate |
| Low-information/empty transcript | Suppressed with trace reason `low_information_transcript` or `empty_transcript` |
| Realtime `request` tool result | Function output is sent; no automatic `response.create` continuation |
| Legacy direct realtime tools | Still executable for tests/compatibility, but not exposed in prompt/tool surface |
| Pi `realtime_send_ack/status/text` | Pushes `[pi-update ...]` context and requests one spoken realtime response |
| Pi session start/stop awareness | `pi.sendMessage()` context injection only; does not trigger a turn |

## Explicit Pi tool schema

All three tools share:

```json
{
  "text": "string, required",
  "providerSessionId": "string, optional",
  "summary": "string, optional"
}
```

Tool intent:

- `realtime_send_ack`: short acknowledgement before work is complete.
- `realtime_send_status`: progress updates for checkpoints, milestones, failures, successes, approach changes, and long-running turns.
- `realtime_send_text`: summaries, reports, final answers, or other text context.

## Automatic transfer decision

Current default remains explicit-only except session awareness and realtime request injection:

| Candidate | Implemented default |
|---|---|
| Every Pi assistant message | Off |
| Final Pi assistant message for voice-originated request | Not yet automatic; use `realtime_send_text` explicitly |
| Progress updates | Explicit via `realtime_send_status` |
| Initial acknowledgement | Explicit via `realtime_send_ack` |
| Realtime session active/stopped | Automatic custom context message, no turn |
| Realtime user request | Automatic custom message, triggers turn |

Further automatic transfer should wait for live validation of this simpler model.

## Validation evidence

Commands run:

```text
npm run gates:typecheck
npm run gates:validation
npm run gates:quality
```

Result: pass.

New/updated deterministic coverage includes:

- `.ai/validation/pi-realtime-context-push-policy-probe.mjs`
- updated fake provider, provider isolation, packet, state, and OpenAI adapter probes

## Live validation checklist

Before marking the goal complete, validate:

1. Reload/start OpenAI WebRTC realtime session.
2. Confirm realtime prompt/tool surface exposes only `request`.
3. Say: `tell Pi to check the latest logs`.
   - Expected: realtime calls only `request`.
   - Expected: Pi receives yellow custom `pi-realtime.request` message, not ordinary user message wrapper.
   - Expected: no `pi_state_snapshot` / citation / wait tool chain.
4. During Pi work, call `realtime_send_ack`, `realtime_send_status`, and `realtime_send_text`.
   - Expected: each targets originating live realtime session by default.
   - Expected: exactly one realtime response per explicit send.
5. Stop realtime session and call a realtime-send tool.
   - Expected: tool result says no active/live realtime session and does not retry.
6. Inspect usage/log trace.
   - Expected: no repeated tool-result response cascade.

## Known caveat

The current active Pi process may still expose previously loaded tool names until `/reload` or a new Pi process reloads the extension. Live validation should start from a reloaded extension state.
