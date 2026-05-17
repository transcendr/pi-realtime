# pi-realtime architecture plan

Date: 2026-05-17
Status: implementation-ready architecture for provider-neutral foundation and fake-provider prototype

## 1. Objective

`pi-realtime` is a Pi extension that turns realtime voice providers into natural voice control-plane interfaces for one or more running Pi agents.

The realtime voice model is not the primary worker. It should speak naturally as if it is the active Pi agent, but its durable responsibilities are limited to:

- maintaining a natural spoken interaction with the user;
- gathering enough conversational context before acting;
- reading compact Pi state packets;
- resolving user references such as Pinotator citations;
- calling a small allowlist of direct control-plane tools;
- sending context-aware instructions into Pi when the next best action requires the real Pi agent.

The core design target is provider neutrality. OpenAI Realtime, Gemini Live, and the deterministic fake provider must all consume the same normalized control-plane capabilities. Provider-specific code must be thin transport/capability mapping only.

## 2. Non-goals for the first prototype

- No microphone capture or audio playback in the provider-neutral/fake prototype.
- No provider SDK imports outside `providers/*`.
- No attempt to expose every Pi model tool directly to the realtime voice model.
- No autonomous domain work by the voice provider.
- No multi-agent orchestration beyond a single active Pi target shape; multi-target support is represented in types so it can be added without rework.
- No final choice of Pi input injection mechanism in this document. Goal 2 chooses the concrete implementation behind the `PiInstructionSink` boundary defined here.

## 3. Module layout

```text
.pi/extensions/pi-realtime/
  index.ts
  runtime.ts              # Pi lifecycle events, command/tool registration, UI sync
  commands.ts             # /realtime parser and command intents
  config.ts               # provider defaults, tool allowlists, env/config reads
  types.ts                # core ids, state, events, packets, tool schemas
  events.ts               # event constructors, guards, replay helpers
  store.ts                # branch-aware replay from ctx.sessionManager.getBranch()
  service.ts              # provider-neutral orchestration and lifecycle decisions
  control-plane.ts        # Pi state/instruction bridge; no provider SDK imports
  state-packets.ts        # compact Pi/Pino/citation packet builders
  prompt.ts               # provider-neutral voice system policy
  tools.ts                # Pi custom tools exposed to the main Pi agent if needed
  view.ts                 # status/widget rendering
  providers/
    types.ts              # normalized adapter contract
    registry.ts           # provider factory registry; no SDK imports except factories
    fake.ts               # deterministic no-network adapter
    openai.ts             # OpenAI Realtime adapter
    gemini.ts             # Gemini Live adapter
```

Hard boundary: `runtime.ts`, `commands.ts`, `service.ts`, `control-plane.ts`, `state-packets.ts`, `events.ts`, `store.ts`, `prompt.ts`, `tools.ts`, and `view.ts` must not import `openai`, `@google/genai`, or provider-specific event types. Only `providers/openai.ts` and `providers/gemini.ts` may import their SDKs.

## 4. Architectural layers

### 4.1 Pi runtime layer

Owned by `runtime.ts`:

- register `/realtime` command;
- register optional Pi model-facing tools if later needed;
- register lifecycle handlers;
- hydrate branch state on `session_start`, `session_tree`, and `session_compact`;
- disconnect or pause active provider resources on `session_shutdown`;
- sync compact status/widget UI;
- call service methods only through provider-neutral inputs.

### 4.2 Durable state layer

Owned by `store.ts` and `events.ts`:

- append-only event log through `pi.appendEntry(CUSTOM_EVENT_TYPE, event)`;
- branch-aware replay from `ctx.sessionManager.getBranch()`;
- schema guards for old/future events;
- replay result is authoritative; runtime caches are disposable.

### 4.3 Orchestration layer

Owned by `service.ts`:

- create/stop/resume provider sessions;
- choose primary provider session for user commands;
- route provider events to durable events and control-plane actions;
- keep context packet revisions monotonic;
- keep tool call/result routing provider-scoped;
- decide when stale provider state must be refreshed after replay/tree/compact.

### 4.4 Pi control-plane layer

Owned by `control-plane.ts`:

- build snapshots of current Pi state suitable for voice context;
- bridge voice-derived instructions into Pi through `PiInstructionSink`;
- read currently active Pinotator citations when available;
- resolve citation references to durable citation ids;
- define but not provider-map the direct voice tool surface.

The concrete Pi instruction injection mechanism is intentionally abstracted:

```ts
type PiInstructionSink = {
  sendInstruction(input: VoiceInstructionInput): Promise<VoiceInstructionReceipt>;
};
```

Goal 2 selects the implementation strategy behind this boundary (`sendUserMessage`, `sendMessage`, `before_agent_start`, `input`, or a hybrid), without changing provider or state architecture.

### 4.5 Provider adapter layer

Owned by `providers/*`:

- connect/disconnect/reconnect transport;
- encode provider session config;
- map provider context capabilities to normalized context packets;
- encode provider tool/function declarations;
- decode provider tool calls;
- encode tool responses;
- send/receive audio/text streams;
- translate provider errors and lifecycle events to normalized events.

Provider adapters do not read Pi session state directly and do not decide domain policy.

## 5. Provider-neutral adapter contract

`providers/types.ts` should define a minimal adapter shape:

```ts
export type ProviderKind = "fake" | "openai" | "gemini";
export type ProviderSessionId = string;

export type ProviderConnectConfig = {
  providerSessionId: ProviderSessionId;
  provider: ProviderKind;
  model: string;
  voice?: string;
  personaId: string;
  systemPrompt: string;
  toolSurface: VoiceToolSurface;
  initialContext: ContextPacket;
  capabilities: ProviderCapabilityPreferences;
};

export type RealtimeProviderAdapter = {
  readonly provider: ProviderKind;
  readonly providerSessionId: ProviderSessionId;
  connect(config: ProviderConnectConfig, sink: ProviderEventSink): Promise<void>;
  disconnect(reason: DisconnectReason): Promise<void>;
  updateContext(packet: ContextPacket): Promise<ProviderDeliveryReceipt>;
  updateToolSurface(surface: VoiceToolSurface): Promise<void>;
  sendToolResult(result: VoiceToolResult): Promise<void>;
  requestResponse(request: VoiceResponseRequest): Promise<void>;
};

export type ProviderEventSink = {
  onProviderEvent(event: NormalizedProviderEvent): void;
};
```

Adapters emit only `NormalizedProviderEvent` values:

```ts
export type NormalizedProviderEvent =
  | ProviderConnectedEvent
  | ProviderDisconnectedEvent
  | ProviderErrorEvent
  | ProviderUserTranscriptEvent
  | ProviderAssistantTranscriptEvent
  | ProviderToolCallEvent
  | ProviderTurnSignalEvent
  | ProviderContextDeliveryEvent;
```

Required routing fields on every provider-origin event:

```ts
type ProviderEventBase = {
  provider: ProviderKind;
  providerSessionId: ProviderSessionId;
  providerEventId?: string;
  localSeq: number;
  at: number;
};
```

This makes simultaneous-provider routing deterministic and prevents a tool result intended for OpenAI session A from being sent to Gemini session B.

## 6. Provider capability model

The core should describe desired behavior as capabilities, not provider APIs:

```ts
type ProviderCapabilities = {
  contextDelivery: Array<"sessionInstructions" | "conversationItem" | "responseInput" | "realtimeText" | "toolLookupOnly">;
  supportsPassiveContextStream: boolean;
  supportsToolCalls: boolean;
  supportsAudioInput: boolean;
  supportsAudioOutput: boolean;
  supportsInputTranscription: boolean;
  supportsOutputTranscription: boolean;
  supportsSemanticVad: boolean;
  supportsServerVad: boolean;
  supportsSessionResumption: boolean;
  supportsContextCompression: boolean;
  maxPracticalContextChars: number;
};
```

Known initial mapping:

| Capability | OpenAI Realtime | Gemini Live | Fake |
| --- | --- | --- | --- |
| Tool calls | yes | yes | yes, simulated |
| Passive-ish context packets | conversation/system/response input hybrid | `realtimeInput.text` / `clientContent` | in-memory receipt |
| Semantic waiting/listening | semantic/server VAD | activity/proactivity/waiting signals | scripted |
| Session resumption | adapter-specific reconnect posture first | Live session resumption available | deterministic replay |
| Context compression | not core assumption | Live context compression available | deterministic truncation |

The provider adapter chooses the best delivery method for each `ContextPacket`; the core only asks for `updateContext(packet)`.

## 7. Durable event schema

Custom event type:

```ts
export const CUSTOM_EVENT_TYPE = "pi-realtime.events.v1";
export const EVENT_VERSION = 1;
```

Event union:

```ts
type RealtimeEvent =
  | { version: 1; kind: "session_started"; eventId: string; at: number; session: VoiceSessionRecord }
  | { version: 1; kind: "session_stopped"; eventId: string; at: number; providerSessionId: string; reason: string }
  | { version: 1; kind: "session_primary_changed"; eventId: string; at: number; providerSessionId: string | null }
  | { version: 1; kind: "provider_event"; eventId: string; at: number; providerEvent: NormalizedProviderEvent }
  | { version: 1; kind: "context_packet_sent"; eventId: string; at: number; providerSessionId: string; packet: ContextPacketSummary; receipt: ProviderDeliveryReceipt }
  | { version: 1; kind: "voice_tool_call_received"; eventId: string; at: number; call: VoiceToolCallRecord }
  | { version: 1; kind: "voice_tool_result_sent"; eventId: string; at: number; result: VoiceToolResultRecord }
  | { version: 1; kind: "voice_instruction_submitted"; eventId: string; at: number; instruction: VoiceInstructionRecord; receipt: VoiceInstructionReceipt }
  | { version: 1; kind: "citation_deck_observed"; eventId: string; at: number; deck: CitationDeckSummary }
  | { version: 1; kind: "config_changed"; eventId: string; at: number; patch: Partial<RealtimeConfig> };
```

Replay rules:

- `session_started` creates or replaces a provider session record by `providerSessionId`.
- `session_stopped` marks that provider session stopped; it does not delete history.
- `session_primary_changed` sets command default target.
- `provider_event` is retained for audit/debug summaries; large provider payloads must be summarized or externalized, not appended verbatim by default.
- `context_packet_sent` updates last delivered revision per provider session and packet channel.
- `voice_tool_call_received` records the normalized call before execution.
- `voice_tool_result_sent` records the result after execution and before provider delivery acknowledgement when available.
- `voice_instruction_submitted` records the exact instruction sent to Pi plus source metadata.
- `citation_deck_observed` records deck revision metadata, not necessarily full citation text, unless debug mode is enabled.

## 8. Replayed state shape

```ts
type RealtimeState = {
  config: RealtimeConfig;
  sessions: Map<ProviderSessionId, VoiceSessionState>;
  primaryProviderSessionId: ProviderSessionId | null;
  pendingToolCalls: Map<VoiceToolCallId, VoiceToolCallRecord>;
  contextRevisions: Map<ProviderSessionId, ProviderContextRevisionState>;
  citationDeck: CitationDeckState | null;
  lastInstruction?: VoiceInstructionRecord;
  history: RealtimeHistorySummary[];
};
```

`VoiceSessionState`:

```ts
type VoiceSessionState = {
  providerSessionId: ProviderSessionId;
  provider: ProviderKind;
  model: string;
  personaId: string;
  status: "starting" | "active" | "stopping" | "stopped" | "error";
  startedAt: number;
  stoppedAt?: number;
  lastProviderEventAt?: number;
  lastError?: string;
};
```

The replay result is the source of truth after reload/tree/compact. Live adapter objects are runtime resources and must be recreated or left disconnected based on replayed state and command intent.

## 9. Context packet model

Context packets are provider-neutral, compact, revisioned records delivered to voice providers.

```ts
type ContextPacket = {
  packetId: string;
  revision: number;
  channel: "session" | "pi_state" | "citations" | "tool_surface" | "instruction_result";
  priority: "critical" | "normal" | "background";
  ttlTurns?: number;
  createdAt: number;
  target: PiTargetRef;
  summary: string;
  sections: ContextPacketSection[];
  refs: ContextRef[];
  staleAfterRevision?: number;
};
```

Packet sections:

```ts
type ContextPacketSection = {
  kind: "status" | "recent_output" | "active_goal" | "citations" | "tool_hint" | "instruction_receipt" | "debug";
  title: string;
  text: string;
  tokensEstimate?: number;
};
```

Rules:

- Packets must be deterministic from replayed Pi state plus current runtime state.
- Packets must prefer concise status and durable ids over raw transcript dumps.
- Every packet has a monotonically increasing `revision` per target/channel.
- Providers may ignore duplicate revisions.
- Critical packets include the current direct tool surface, target identity, safety policy, and citation deck revision.
- Background packets may be dropped or compressed if provider context is constrained.

## 10. Pinotator citation packet model

Pinotator is a first-class context source. The realtime extension should consume Pinotator state either by direct module/service integration if available in-process, by replaying `pinotator.events.v1` custom entries, or by parsing active `pinotator.citations` custom messages as a fallback.

Normalized citation deck:

```ts
type CitationDeck = {
  revision: number;
  source: "pinotator";
  observedAt: number;
  active: CitationPacketItem[];
};

type CitationPacketItem = {
  displayRef: string;      // "[1]"
  alias: string;           // "@p1"
  citationId: string;      // "cit_..."
  origin: "transcript" | "manual" | "unknown";
  source: string;
  snippet: string;         // compact, width-safe, escaped text
  fullTextAvailable: boolean;
};
```

Provider-facing citation packet text should use explicit records:

```text
Current Pinotator citation deck revision: 7
When the user says "citation one", "[1]", or "@p1", resolve to the durable citation id.
If the requested ref is absent or stale, call pinotator_citation_resolve.

<pinotator_citation_ref display_ref="[1]" alias="@p1" id="cit_..." source="assistant/message/raw_exact">
short escaped snippet...
</pinotator_citation_ref>
```

Resolution rules:

- Spoken numbers map to current `displayRef` only within the current deck revision.
- Any Pi instruction that cites a source must include durable `citationId`, not only display ref.
- If the provider is unsure which citation the user means, it should ask a clarification or call `pinotator_citation_resolve`.
- If a branch change changes deck revision, adapters must receive a fresh citation context packet.

## 11. Direct voice tool allowlist

Only these provider-direct tools should exist in the first prototype:

### `pi_state_snapshot`

Purpose: read compact current state.

Input:

```ts
{ include?: Array<"status" | "recent_output" | "citations" | "active_goal"> }
```

Output: latest `ContextPacket` summary and relevant revisions.

### `pi_send_instruction`

Purpose: send a carefully composed instruction to the real Pi agent.

Input:

```ts
{
  instruction: string;
  rationale: string;
  userUtteranceSummary?: string;
  citedCitationIds?: string[];
  urgency?: "normal" | "interrupt";
}
```

Output: `VoiceInstructionReceipt` from the `PiInstructionSink`.

Policy: use only when the voice agent has enough context to produce a useful Pi instruction. Do not call for every user utterance.

### `pi_wait_for_update`

Purpose: declare that no Pi action is needed yet and the voice agent is waiting/listening.

Input:

```ts
{ reason: string; expectedNext?: "user_more_input" | "pi_state_change" | "clarification" }
```

Output: acknowledgement and latest state revision.

### `pi_realtime_status`

Purpose: inspect/recover realtime extension state.

Input:

```ts
{ providerSessionId?: string }
```

Output: provider session status, primary session, recent errors.

### `pinotator_citations_list`

Purpose: list active current citation refs and snippets.

Input:

```ts
{ maxItems?: number; includeSnippets?: boolean }
```

Output: current `CitationDeck` or empty deck.

### `pinotator_citation_resolve`

Purpose: resolve `[N]`, `@pN`, durable id, or spoken ordinal to full/durable citation data.

Input:

```ts
{ ref: string; deckRevision?: number; includeFullText?: boolean }
```

Output: citation id, display ref, source metadata, and full text when requested and available.

No file mutation, shell execution, code editing, Jira, browser, or general Pi tool access should be direct-provider tools in the first prototype. The real Pi agent decides whether to use those tools after receiving an instruction.

## 12. Voice system policy

`prompt.ts` should generate provider-neutral instructions equivalent to:

- You are a natural voice interface for the active Pi agent.
- Speak as the agent in first person when appropriate; do not describe yourself as a relay.
- Do not pretend work is complete until Pi state or tool results confirm it.
- You may build context over multiple user turns before acting.
- Not every utterance requires a Pi instruction.
- Prefer listening, clarifying, or waiting when the user is still forming intent.
- Use direct tools only for control-plane tasks on the allowlist.
- For durable work, compose one clear instruction for Pi with relevant context and citations.
- Resolve citations by durable id before sending citation-dependent instructions.
- Keep spoken responses concise and natural.

Provider adapters may format this policy differently, but they must not change the semantics.

## 13. Multi-provider/session routing

The system must support multiple simultaneous provider sessions as a design litmus test.

Rules:

- Every provider session has a unique `providerSessionId`.
- Exactly zero or one session is the command default `primaryProviderSessionId`.
- `/realtime start --provider openai` creates a new provider session and can become primary.
- `/realtime start --provider gemini --secondary` creates a non-primary provider session.
- `/realtime status` shows all sessions.
- `/realtime stop` stops primary by default; `--session <id>` targets a specific session.
- Provider tool calls are routed by normalized `voiceToolCallId` and `providerSessionId`.
- Tool results are sent only to the provider session that originated the call.
- Context packets are delivered per provider session with independent delivery receipts.
- Voice-derived Pi instructions share the same Pi target route but include source provider/session metadata.

This prevents cross-provider corruption while allowing both providers to observe the same Pi state and compete only through explicit Pi instructions.

## 14. Slash command contract

First-wave parser support:

```text
/realtime                         show status/help
/realtime status                  show all provider sessions
/realtime start --provider fake   start deterministic provider session
/realtime stop                    stop primary session
/realtime stop --session <id>     stop one session
/realtime primary <id>            set primary provider session
/realtime fake transcript <text>  simulate user transcript event
/realtime fake tool <name> <json> simulate provider tool call
/realtime citations               show current citation deck summary
```

Later commands:

```text
/realtime start --provider openai --model gpt-realtime-2
/realtime start --provider gemini --model gemini-live-2.5-flash-preview
/realtime resume --session <id>
/realtime debug packets
```

Command handlers must be non-interactive by default and safe in non-UI modes.

## 15. Lifecycle posture

### `session_start`

- hydrate replayed state from current branch;
- do not auto-connect real providers unless config explicitly says resume;
- sync status/widget;
- mark previously active runtime connections as needing explicit resume if adapter objects were lost.

### `session_tree`

- hydrate from new branch;
- recompute context and citation deck revisions;
- stop or mark stale provider sessions whose durable state is not active on the new branch;
- send fresh context packets only to live runtime adapters whose replayed session remains active.

### `session_compact`

- hydrate replayed state;
- recompute compact state packets;
- clear stale steering/custom context through the context filter if used;
- send a fresh critical context packet after compaction to any active provider session.

### `session_shutdown`

- disconnect provider sockets and timers/watchers;
- clear runtime adapter registry;
- append shutdown/stopped events only if safe and non-duplicative;
- status/widget should not be required for correctness.

### `context`

If voice steering messages are injected into Pi model context, filter stale ones by:

- current branch state absent;
- provider session id absent/stopped;
- instruction id already superseded;
- multiple valid steering messages, keeping only the latest per target.

## 16. Context and data retention

Default retention should be conservative:

- Store transcript summaries and tool-call records durably.
- Do not store raw audio by default.
- Do not store full provider event payloads by default.
- Store full citation text only if it already exists in Pinotator/session state or debug mode explicitly asks for it.
- Put large debug transcripts under `.ai/validation/live-probe/` or a temp full-output path, not in custom entries.

## 17. Validation criteria

Architecture and fake-provider completion requires deterministic probes under `.ai/validation/` covering:

1. Event schema guard accepts valid v1 events and rejects malformed events.
2. Branch-aware replay uses only `ctx.sessionManager.getBranch()`-style entries.
3. Multiple provider sessions replay without id collisions.
4. Tool call/result routing returns results only to the originating provider session.
5. Context packet revisions are monotonic and idempotent per provider/channel.
6. Pinotator citation deck packets preserve display ref, alias, durable id, source, and snippet.
7. Citation reference resolution maps `[1]`, `@p1`, and durable ids correctly for a fixed deck revision.
8. Fake provider can start, emit transcript, emit tool call, receive result, and stop without network.
9. `/realtime` command parser handles start/status/stop/fake/citations forms.
10. Lifecycle cleanup disconnects runtime adapters on shutdown.
11. Static audit passes: `node ~/.codex/skills/pi-extension-dev/scripts/audit-pi-extension.mjs .`.
12. Quality gate passes: `npm run gates:quality`.

## 18. OpenAI-first implementation path

After the fake provider proves the architecture:

1. Add `providers/openai.ts` importing `OpenAIRealtimeWebSocket` only inside that file.
2. Support text/context/tool-call smoke path first.
3. Use provider-neutral `ContextPacket` delivery via the best OpenAI mapping:
   - critical policy/tool changes: session instructions/session update when safe;
   - citation/state packets: system/conversation item or response input;
   - authoritative lookup: direct citation tools.
4. Normalize OpenAI function calls into `ProviderToolCallEvent`.
5. Route tool results by `call_id` + `providerSessionId`.
6. Keep OpenAI path API-key guarded and skip real-network probes unless explicitly configured.
7. Add audio/VAD after text/tool-call path is validated.

## 19. Gemini follow-on path

Gemini should implement the same adapter contract:

- `clientContent` for deliberate conversation/context appends;
- `realtimeInput.text` for compact state/citation packets where appropriate;
- `toolResponse` for normalized tool results;
- session resumption/context compression/proactivity behind provider capabilities.

Gemini-specific advantages should not leak into core abstractions. Instead, expose them as capabilities that other providers can emulate or ignore.

## 20. Implementation checklist for goals 2-6

Goal 2 input injection decision:

- choose the concrete `PiInstructionSink` strategy;
- document stale-context cleanup behavior;
- add validation plan for instruction receipt and model visibility.

Goal 3 core foundation:

- implement types/events/store/service/control-plane/state-packets/provider types;
- no provider SDK imports outside `providers/*`;
- pass replay/schema/packet probes.

Goal 4 fake provider:

- implement adapter and commands;
- simulate transcript/tool calls/results;
- prove lifecycle and citation flows.

Goal 5 hardening:

- branch/tree/compact assumptions;
- simultaneous-provider litmus probe;
- stale context cleanup;
- command parser probes;
- proof matrix update.

Goal 6 OpenAI smoke path:

- text/context/tool-call only;
- API-key guarded;
- fake/offline gates remain passing;
- documented smoke-test procedure.
