# Goal plan: expose Pi-to-realtime text context tool

## Objective

Expose a custom Pi model tool that lets the Pi assistant send concise text back into an active realtime voice-agent session. This closes the basic communication loop for instruction acceptance acknowledgements, status updates, and final reports without requiring the user to manually type `/realtime text ...`.

Current gap: `/realtime text` already reaches `service.sendTextInput(...)`, but that path is only an extension command. It is not available as a callable Pi model tool, so the assistant cannot invoke it during normal tool execution.

Priority scope for the next implementation task: build the smallest reliable version of arbitrary Pi-to-realtime text delivery. Do not block this MVP on lifecycle correlation, semantic task completion, or backend-specific integrations. The first success condition is simply: after a voice instruction reaches Pi, the Pi assistant can call a model tool to send an acknowledgement, status line, or report back into the active realtime agent context.

## Current code anchors

- Command path: `.pi/extensions/pi-realtime/commands.ts`
  - `text(...)` parses `/realtime text`, resolves `--session` or primary session, then calls `service.sendTextInput(...)`.
- Service path: `.pi/extensions/pi-realtime/service.ts`
  - `sendTextInput(providerSessionId, text)` resolves the live adapter and calls `adapter.sendTextInput(text)`.
- Provider interface: `.pi/extensions/pi-realtime/providers/types.ts`
  - `RealtimeProviderAdapter.sendTextInput(text)` already exists.
- OpenAI raw adapter: `.pi/extensions/pi-realtime/providers/openai/index.ts`
  - sends `conversation.item.create` with role `user`, then `response.create`.
- OpenAI WebRTC bridge: `.pi/extensions/pi-realtime/providers/openai/webrtc-bridge.ts`
  - enqueues the same conversation item and response request through the helper outbox.
- Pi custom tool API guidance:
  - `/Users/bryan/dev/_state/personal/npm-tools/pi/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
  - `/Users/bryan/.pi/agent/.cache/codex-skills/pi-extension-dev/references/pi-api-patterns.md`

## Design

### New Pi model tool

Register a project-local custom tool, tentatively named:

```text
pi_realtime_send_text
```

Purpose: send a short direct text update into the realtime voice agent model/session.

This is a Pi model tool, not a realtime provider tool. It should be callable by the Pi assistant after receiving a voice-originated instruction.

Suggested parameters:

```ts
{
  text: string;                         // required, concise update/report
  providerSessionId?: string;           // optional; defaults to primary active session
  purpose?: "ack" | "status" | "report" | "context" | "manual";
  requestResponse?: boolean;            // default true for ack/status/report/manual
}
```

Initial MVP can route through the existing `sendTextInput` path for parity with `/realtime text`. Later refinement can add a provider-neutral `sendContextUpdate` path that sends status/report packets as system/context items instead of user-role text.

### Module placement

Add a focused module rather than bloating `runtime.ts` or `service.ts`:

```text
.pi/extensions/pi-realtime/model-tools.ts
```

Responsibilities:

- define strict TypeBox schemas;
- register `pi_realtime_send_text`;
- resolve default active session through `service.state().primaryProviderSessionId`;
- validate text is non-empty and reasonably bounded;
- call a service method;
- return a compact receipt with provider session id, delivery status, and limitation notes.

Keep Pi API wiring in `runtime.ts` by calling something like:

```ts
registerRealtimeModelTools(pi, service)
```

### Service/event changes

Add a slightly richer service method instead of using command-oriented naming directly:

```ts
sendModelText(input: {
  providerSessionId?: ProviderSessionId;
  text: string;
  purpose: "ack" | "status" | "report" | "context" | "manual";
  requestResponse: boolean;
}): Promise<ProviderDeliveryReceipt & { providerSessionId: ProviderSessionId }>;
```

For MVP it can delegate to the adapter's existing `sendTextInput(text)`.

Persist a new event so reload/debug/probes can prove the loop:

```ts
kind: "model_text_sent"
```

Suggested record fields:

- `providerSessionId`
- `purpose`
- `textPreview` or `text`
- `receipt`
- `at`

Prefer storing a bounded text preview unless full text is required for continuation. This event should update `state.history` and be replayable from `store.hydrate(ctx)`.

### Provider semantics

MVP behavior:

- Raw OpenAI: existing `sendTextInput` sends a `conversation.item.create` user message and `response.create`.
- WebRTC helper: existing bridge enqueues the same events; receipt means queued to helper outbox, not necessarily consumed by browser/OpenAI yet.
- Fake provider: confirm existing fake adapter behavior or add minimal support so probes can validate without OpenAI.

Follow-up design note: for status/report semantics, user-role text is only a bridge. A better provider-neutral API would distinguish:

- `sendUserText(...)` — user-like input, equivalent to `/realtime text`;
- `sendAgentContext(...)` — Pi-authored context/status packet;
- `requestResponse(...)` — asks the voice agent to speak after receiving the context.

Do not block the MVP on that refinement if the goal is closing the basic loop quickly.

## Implementation phases

### Phase 1 — minimal model tool

1. Add `model-tools.ts` with `pi_realtime_send_text` registration.
2. Wire it from `runtime.ts`.
3. Add `Service.sendModelText(...)`, resolving primary session safely.
4. Delegate to existing adapter `sendTextInput(...)`.
5. Return concise tool output, e.g.:

   ```text
   Sent realtime text update to openai_... for purpose=ack; receipt=delivered.
   ```

6. Throw tool errors for no active session, no live adapter, empty text, or adapter failure.

### Phase 2 — persistence and replay proof

1. Add `model_text_sent` to `RealtimeEvent` in `types.ts`.
2. Add event constructor and replay/history handling in `events.ts`.
3. Append the event in `Service.sendModelText(...)` after adapter delivery.
4. Update any history/debug rendering if useful.

### Phase 3 — validation probes

Add deterministic probes under `.ai/validation/`:

- `pi-realtime-model-tool-probe.mjs`
  - loads/registers the extension offline;
  - asserts `pi_realtime_send_text` is registered with strict schema/guidelines.
- Fake-adapter delivery probe
  - starts fake provider session;
  - invokes `Service.sendModelText(...)` or the registered tool harness;
  - asserts provider received text and state records `model_text_sent`.
- WebRTC bridge/outbox unit probe if practical
  - instantiate helper/bridge boundary;
  - call send path;
  - assert queued event includes `conversation.item.create` and `response.create`.

Update existing probes only if they currently assume the old `RealtimeEvent` union or tool list.

### Phase 4 — docs and command parity

1. Document the new tool in `README.md` and realtime voice docs.
2. Explain distinction from `/realtime text`:
   - command = user/manual TUI operation;
   - tool = Pi assistant status/report path.
3. Add prompt guidance that the Pi assistant should use `pi_realtime_send_text` for concise acknowledgements/status/final reports when responding to voice-originated work.

### Phase 5 — semantic refinement, optional follow-up

After MVP proves the loop, consider replacing user-role text with a provider-neutral context/status packet API:

```ts
adapter.sendAgentContext({ text, purpose, requestResponse })
```

OpenAI implementations would likely use `conversation.item.create` with a system/context-style message plus `response.create` when speech is desired. This keeps acknowledgements and reports from being mistaken for fresh user input.

## Acceptance criteria

- Pi assistant has a callable `pi_realtime_send_text` model tool.
- Tool can target explicit `providerSessionId` or default to the primary active session.
- Tool returns clear success/failure receipts.
- Existing `/realtime text` behavior remains unchanged.
- Raw OpenAI and WebRTC modes still use ephemeral/browser-safe boundaries; no API key is sent to browser.
- Sent updates are replayable/debuggable through a persisted `model_text_sent` event.
- `npm run gates:quality` passes.

## Risks / constraints

- WebRTC helper receipt is queue delivery, not browser/model consumption confirmation.
- Existing `sendTextInput` uses user-role messages; this is acceptable for MVP but semantically imperfect for Pi-authored status/report updates.
- Tool output must be concise; avoid dumping large reports into the realtime model unless explicitly requested.
- This closes the basic communication loop but does not by itself implement automatic lifecycle follow-ups. Automatic follow-ups still require Pi event listeners/correlation for `agent_end`, `tool_result`, etc.
