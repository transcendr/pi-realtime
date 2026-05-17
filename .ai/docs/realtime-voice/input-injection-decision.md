# pi-realtime input injection decision

Date: 2026-05-17
Status: decided for fake-provider prototype

## Decision

Use a **hybrid instruction sink**:

1. **Primary Pi instruction path:** `pi.sendUserMessage()`.
2. **Durable metadata path:** `pi.appendEntry("pi-realtime.events.v1", event)` with a `voice_instruction_submitted` event before/around the user-message send.
3. **Supplemental model-context path:** `pi.sendMessage()` and/or `before_agent_start` only for compact context packets, state/citation deck updates, stale steering cleanup, or non-user-instruction metadata.

Default delivery behavior:

- If Pi is idle: call `pi.sendUserMessage(renderedInstruction)` with no delivery option.
- If Pi is streaming/busy and the voice request is normal priority: call `pi.sendUserMessage(renderedInstruction, { deliverAs: "followUp" })`.
- If Pi is streaming/busy and the voice request is explicitly urgent/interruption-class: call `pi.sendUserMessage(renderedInstruction, { deliverAs: "steer" })`.
- Do not use `steer` as the default for ordinary voice input; natural voice should not constantly interrupt the worker agent.

This best matches the original UX: when the voice agent has determined that the next best action is to involve Pi, the real Pi agent should receive a natural, context-rich user instruction as if the user had typed it, while the realtime extension separately preserves provider/citation/session metadata for replay and audit.

## Why this is closest to the target UX

The target system is not a relay bot and not an autonomous voice worker. It is a voice control-plane interface that eventually sends high-quality user intent into the real Pi agent. `sendUserMessage()` is the only inspected mechanism that:

- creates an actual user-message turn;
- triggers the agent when idle;
- can queue a turn while streaming;
- persists in Pi's normal user/assistant session tree;
- is naturally understood by Pi as user intent, not extension steering;
- marks source as `extension`, which lets `input` handlers avoid reprocessing it as typed input.

The metadata event makes this robust without polluting the user-visible message with every internal detail. Provider session id, provider kind, voice tool call id, citation ids, deck revision, urgency, and original utterance summary remain durable in custom entries.

## Mechanism comparison

### `pi.sendUserMessage()`

Evidence:

- Official docs: sends an actual user message to the agent and always triggers a turn.
- Type definitions: accepts `string | (TextContent | ImageContent)[]` and optional `{ deliverAs: "steer" | "followUp" }` when streaming.
- Runtime implementation calls `prompt(..., { expandPromptTemplates: false, source: "extension" })`, so it skips slash command/template expansion and is identifiable as extension-origin.
- Official `send-user-message.ts` example uses it for `/ask`, `/steer`, and `/followup`.

Pros:

- Best semantic match for voice-derived user intent.
- Preserves normal Pi conversation/tree behavior.
- Supports idle, steer, and follow-up delivery.
- Avoids requiring an existing user turn.
- Lets the main Pi agent decide which normal tools to use.

Cons/risks:

- It creates a real user message, so the rendered instruction must be clean and concise.
- If called too often, the voice agent can spam Pi turns.
- Source metadata is not itself visible in the user message unless included or separately persisted.
- Streaming delivery mode must be chosen deliberately.

Decision: use as primary instruction path.

### `pi.sendMessage()` custom message

Evidence:

- Official docs: injects custom messages into the session; `triggerTurn: true` can start an LLM response; `deliverAs` supports `steer`, `followUp`, and `nextTurn`.
- Session format: custom messages participate in LLM context and include `customType`, `content`, `display`, and `details`.
- `pi-goals` uses hidden `sendMessage()` steering for continuations, queue handoff, and budget wrap-up.
- `pinotator` uses `before_agent_start` to return a custom message containing citations.

Pros:

- Excellent for structured extension context and hidden steering.
- `details` can carry metadata not sent to the model.
- Can be displayed or hidden.
- Can trigger/steer/follow up a turn.

Cons/risks:

- The model sees extension-injected context, not a user message.
- Overuse can make the voice UX feel like steering/relay infrastructure.
- Requires stale-context filtering after `/tree`, compaction, and session changes.

Decision: reserve for context packets, citation decks, instruction receipts, and stale-steering cleanup; do not use as primary user-intent injection.

### `before_agent_start`

Evidence:

- Official docs: fires after user submits prompt and before agent loop; can inject a persistent custom message and/or modify system prompt.
- Pinotator uses it to attach active citations to the model turn and mark them sent.

Pros:

- Best for attaching current state/citation context to an already-starting turn.
- Strong hook for model-facing context packets.
- Can inspect system prompt options and compose with other extension handlers.

Cons/risks:

- Does not start a turn by itself.
- Only runs after a user/extension turn is already underway.
- Not suitable as the primary bridge from voice to Pi when the user expects the voice agent to kick off work now.

Decision: use to attach latest critical context/citation packets to turns that are already starting; not primary instruction injection.

### `input` event

Evidence:

- Official docs: fires after extension slash commands and before skill/template expansion; can transform, handle, or continue raw input.
- It sees source `interactive`, `rpc`, or `extension`.
- `sendUserMessage()` uses source `extension`.

Pros:

- Useful for recognizing or skipping extension-origin messages.
- Good for typed input transformations.

Cons/risks:

- It is not an injection API; it is an interception/transformation hook.
- Using it as a backdoor voice queue would blur typed user input and provider-origin events.

Decision: use the input event only defensively, e.g. to avoid reprocessing extension-origin user messages if needed.

### Slash-command/session APIs

Evidence:

- `ExtensionCommandContext` exposes session navigation/reload/newSession APIs only in user-initiated command handlers.
- Replacement session contexts expose fresh `sendMessage()` and `sendUserMessage()` helpers.

Pros:

- Correct place for `/realtime start/status/stop/resume` user management layer.
- Safe for explicit user session navigation.

Cons/risks:

- Voice provider callbacks should not hold stale command contexts across reload/session replacement.
- Session APIs are for management, not ongoing provider event delivery.

Decision: commands manage realtime sessions and may trigger initial setup, but provider callbacks use the service-owned instruction sink and fresh runtime state, not captured command contexts.

## Selected instruction rendering format

The `PiInstructionSink` should render voice-derived instructions as clean user messages with explicit provenance and citations, but not excessive provider internals.

Recommended first format:

```text
Voice instruction from realtime session <providerSessionId> (<provider>):

<instruction>
{natural-language instruction composed by the voice agent}
</instruction>

Context:
- User voice summary: ...
- Cited Pinotator citations: cit_... ([1]), cit_... (@p2)
- Realtime deck revision: 7
- Urgency: normal|interrupt
```

For normal cases, keep this compact. If there are no citations, omit the citation lines. If provider/session ids are too noisy in user-visible transcripts, keep only a short prefix in the user message and rely on the durable custom event for full metadata.

## Durable event contract

Before or immediately after sending the user message, append a `voice_instruction_submitted` event:

```ts
type VoiceInstructionSubmittedEvent = {
  version: 1;
  kind: "voice_instruction_submitted";
  eventId: string;
  at: number;
  instruction: {
    instructionId: string;
    provider: "fake" | "openai" | "gemini";
    providerSessionId: string;
    voiceToolCallId?: string;
    providerToolCallId?: string;
    target: PiTargetRef;
    delivery: "immediate" | "followUp" | "steer";
    urgency: "normal" | "interrupt";
    instructionText: string;
    userUtteranceSummary?: string;
    citedCitationIds: string[];
    citationDeckRevision?: number;
  };
  receipt: {
    status: "submitted" | "failed";
    message?: string;
  };
};
```

If a future implementation can retrieve the appended user-message entry id from Pi, add it to `receipt`. Current public `pi.sendUserMessage()` returns `void`, so deterministic probes should not depend on an entry id.

## Delivery policy

```ts
function chooseDelivery(ctx: ExtensionContext, urgency: "normal" | "interrupt") {
  if (ctx.isIdle()) return { mode: "immediate" as const, options: undefined };
  if (urgency === "interrupt") return { mode: "steer" as const, options: { deliverAs: "steer" } };
  return { mode: "followUp" as const, options: { deliverAs: "followUp" } };
}
```

Additional guardrails:

- The voice provider should call `pi_send_instruction` only after it has enough conversational context.
- Use `pi_wait_for_update` or ask a spoken clarification instead of sending low-confidence instructions.
- Rate-limit or deduplicate semantically identical instructions by `instructionId`/provider tool call id.
- Do not send a second instruction while one from the same provider session is pending unless the user clearly changed/extended intent.

## Context and citation strategy

Use `sendUserMessage()` for the work instruction itself. Use separate context mechanisms for state/citation packets:

- `before_agent_start`: attach latest critical `pi-realtime` context packet and active Pinotator citation deck when a turn begins, if not already visible through Pinotator.
- `pi.sendMessage(..., { deliverAs: "nextTurn" })`: optional future path for low-priority next-turn context.
- `context` event: remove stale `pi-realtime` custom messages if provider session id, instruction id, or citation deck revision is no longer current.

For the fake prototype, it is sufficient to persist citation ids/deck revision in custom events and include cited ids in the rendered user message. Later provider adapters can also push citation deck packets to the voice provider before `pi_send_instruction` is called.

## Fallback strategy

If `sendUserMessage()` fails or proves unsuitable in validation:

1. For idle turns, fallback to `pi.sendMessage({ customType: "pi-realtime.instruction", ... }, { triggerTurn: true, deliverAs: "followUp" })`.
2. For busy turns, fallback to `pi.sendMessage(..., { deliverAs: "followUp" })` for normal priority or `{ deliverAs: "steer" }` for interrupt priority.
3. Add a visible warning/status that the instruction was injected as extension steering rather than a user message.
4. Keep the same `voice_instruction_submitted` event schema, with receipt status/details showing fallback mode.

Do not fallback to raw `input` event interception. It is not an injection mechanism.

## Validation plan

Deterministic probes for the fake-provider/core goals should verify:

1. The instruction sink chooses immediate delivery when `ctx.isIdle()` is true.
2. The instruction sink chooses `followUp` when busy and urgency is normal.
3. The instruction sink chooses `steer` when busy and urgency is interrupt.
4. Rendered instruction includes instruction text, provider/session metadata, cited durable citation ids, and citation deck revision when present.
5. `voice_instruction_submitted` event is appended with provider/session/tool-call metadata and delivery mode.
6. The fake provider `pi_send_instruction` tool path calls the instruction sink exactly once per normalized tool call id.
7. Duplicate provider tool call ids are idempotently rejected or no-oped.
8. Extension-origin user messages are not transformed by any `input` handler added by pi-realtime.
9. Stale custom context packets are filterable by provider session id and instruction id if `sendMessage()`/`before_agent_start` context is used.
10. `npm run gates:quality` and `node ~/.codex/skills/pi-extension-dev/scripts/audit-pi-extension.mjs .` pass.

## Implementation implications for goal 3

Add these provider-neutral interfaces:

```ts
type VoiceInstructionInput = {
  instructionId: string;
  provider: ProviderKind;
  providerSessionId: ProviderSessionId;
  voiceToolCallId?: string;
  providerToolCallId?: string;
  target: PiTargetRef;
  urgency: "normal" | "interrupt";
  instructionText: string;
  userUtteranceSummary?: string;
  citedCitationIds: string[];
  citationDeckRevision?: number;
};

type VoiceInstructionReceipt = {
  status: "submitted" | "failed";
  delivery: "immediate" | "followUp" | "steer";
  fallbackUsed?: boolean;
  message?: string;
};

type PiInstructionSink = {
  sendInstruction(input: VoiceInstructionInput): Promise<VoiceInstructionReceipt>;
};
```

`control-plane.ts` should own the `PiInstructionSink` implementation. `service.ts` should call it through the interface. Provider adapters must never call `pi.sendUserMessage()` directly.
