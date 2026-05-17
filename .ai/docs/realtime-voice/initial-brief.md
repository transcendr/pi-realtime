# pi-realtime voice control-plane brief

Date: 2026-05-17

## User intent, restated

Build a Pi extension for realtime voice APIs, supporting both OpenAI Realtime and Google Gemini Live.

The voice model is not the primary worker. It is a natural voice interface/control-plane adapter for one or more running Pi agents. The voice agent should feel like a direct one-on-one conversation with the real agent, but under the hood it mostly calls narrowly scoped tools, observes Pi state/output, and injects context-aware input into the Pi agent surface.

Core UX requirement: the user should not feel like they are in a relay conversation. The voice agent may LARP as the active processing agent, speaking naturally as if it is the agent doing the work, while actually delegating durable work to Pi.

## Interaction model

There are two separate input/control layers:

1. User management layer
   - Pi slash commands such as `/realtime`, `/realtime resume`, `/realtime stop`, provider/model selection, status, debugging, etc.
   - These are outside the voice session's natural conversation scope and manage the realtime system.

2. Voice/model mediation layer
   - The realtime voice model receives speech/text/multimodal input.
   - It may build conversational context over several user-agent voice turns before deciding what to do.
   - It should not relay every utterance immediately into Pi.
   - When ready, it transforms the conversation into context-aware natural-language instructions for the Pi agent, or calls a small allowlisted set of direct tools when direct access is clearly more efficient than routing through Pi.

The voice agent should do as little actual work as possible. Direct tools should be limited to unambiguous, efficient operations such as reading current state, sending user intent to Pi, resuming/stopping the realtime session, or acknowledging/waiting for updates. Most domain/tool work remains with the Pi agent and Pi-registered model tools.

## Pi integration requirements

The extension should be tightly integrated with Pi internals:

- Durable state should be preserved through Pi's session/tree model, likely with custom session message types via `pi.appendEntry()` and possibly hidden/displayed custom messages via `pi.sendMessage()`.
- State replay must be branch-aware using `ctx.sessionManager.getBranch()`.
- Voice session lifecycle must handle startup, resume, reload, session tree switching, compaction, and shutdown.
- Voice-origin user turns, voice-agent decisions, direct tool calls, state packets, transcript snippets, and Pi-agent injection events should be represented as typed events so they survive reload/tree/compaction.
- The Pi agent should receive clean, relevant, context-laden natural-language instructions, not raw noisy transcripts unless intentionally preserved for audit/debug.

## Provider research snapshot

### OpenAI Realtime

Local package research against `openai@6.38.0` found:

- Node SDK exposes `OpenAIRealtimeWebSocket` from `openai/realtime/websocket`.
- Realtime supports low-latency multimodal text/audio input and output plus function calling over WebSocket.
- Current realtime session types include models such as `gpt-realtime`, `gpt-realtime-1.5`, `gpt-realtime-2`, `gpt-realtime-mini`, and historical `gpt-4o-realtime-preview` variants.
- Session config supports instructions, tools, tool choice, audio formats, input audio transcription, noise reduction, tracing, response modalities, voice, temperature, max output tokens, and turn detection.
- Turn detection supports `server_vad` and `semantic_vad`; semantic VAD is specifically relevant to natural voice UX because it can wait longer when the user is likely not done.
- Client events include conversation item creation/deletion/retrieval/truncation, input audio buffer append/commit/clear, response create/cancel, and session update.
- Realtime responses can be out-of-band (`conversation: "none"`) or attached to the default conversation, which may matter for streaming state packets without polluting conversational memory.
- Function call outputs are represented as conversation items with `type: "function_call_output"` and `call_id`.

### Google Gemini Live

Local package research against `@google/genai@2.3.0` and Google Live docs/types found:

- SDK exposes `ai.live.connect({ model, config, callbacks })` returning a live `Session`.
- Example models include `gemini-live-2.5-flash-preview` and Vertex-specific live preview models.
- Live supports `responseModalities`, system instructions, tools, realtime input config, session resumption, context window compression, input/output audio transcription, proactivity, explicit VAD, and safety settings.
- Client messages separate:
  - `clientContent`: appends content to conversation history and can set `turnComplete` to trigger generation.
  - `realtimeInput`: continuous realtime audio/video/text input, processed incrementally, with end-of-turn inferred from user activity.
  - `toolResponse`: responses to server tool calls.
- `realtimeInput.text` and media/audio/video streams can be sent continuously; this maps well to efficient Pi state packets alongside user speech, but ordering/mixing between `clientContent` and `realtimeInput` is not guaranteed.
- Server content can signal `waitingForInput`, `interrupted`, `generationComplete`, `turnComplete`, plus input/output transcriptions.

## Proposed architecture

```text
.pi/extensions/pi-realtime/
  index.ts
  runtime.ts          # Pi commands/events/lifecycle wiring
  config.ts           # provider/model/tool exposure config
  types.ts            # session/event/provider types
  events.ts           # append-only event constructors/replay guards
  store.ts            # branch-aware replay from custom entries
  service.ts          # provider-agnostic realtime session orchestration
  control-plane.ts    # Pi input/output bridge; no provider SDK imports
  state-packets.ts    # compact Pi state summaries for voice context
  prompt.ts           # voice-agent system instructions
  tools.ts            # Pi custom tools exposed to main Pi agent
  commands.ts         # /realtime parsing
  view.ts             # status/widget rendering
  providers/
    types.ts          # normalized provider adapter contract
    openai.ts         # OpenAI Realtime adapter
    gemini.ts         # Gemini Live adapter
    fake.ts           # deterministic no-network test adapter
```

Provider adapters should normalize:

- connect/disconnect/resume where supported;
- update instructions/session config;
- send state packet;
- receive user transcript/voice turn signals;
- handle provider tool calls;
- send tool responses;
- emit provider-neutral events to the service.

## Provider abstraction requirement

Provider-specific logic must be minimized and isolated. The core extension should model system capabilities once, then adapt those capabilities to each selected provider through thin provider adapters.

Design rule: `service.ts`, `control-plane.ts`, `state-packets.ts`, `events.ts`, `store.ts`, `prompt.ts`, and Pi command/tool handling must not import OpenAI or Gemini SDKs. Only files under `providers/` may import provider SDKs or know provider event names.

The adapter boundary should expose provider-neutral capabilities, for example:

```ts
type RealtimeProviderAdapter = {
  id: ProviderSessionId;
  provider: "openai" | "gemini" | "fake";
  connect(config: ProviderConnectConfig): Promise<void>;
  disconnect(reason: string): Promise<void>;
  updateContext(packet: ContextPacket): Promise<void>;
  updateToolSurface(surface: VoiceToolSurface): Promise<void>;
  sendToolResult(result: VoiceToolResult): Promise<void>;
  requestResponse(request: VoiceResponseRequest): Promise<void>;
};
```

The core should own semantic concepts such as:

- voice session identity and lifecycle;
- active Pi target selection;
- context packet revisions;
- Pinotator citation deck revisions;
- direct voice tool allowlist;
- voice-derived Pi instruction events;
- natural conversation policy: wait/listen vs ask clarification vs send Pi instruction vs direct tool call.

Each provider adapter should own only transport and provider capability mapping, such as:

- how context packets are delivered (`realtimeInput.text`, `conversation.item.create`, `session.update.instructions`, response input, etc.);
- how function/tool declarations are encoded;
- how tool calls and tool results are represented;
- how turn detection/interruption is configured;
- how audio chunks are sent/received;
- how reconnect/session resumption works if supported.

The abstraction should be strong enough that two providers can run simultaneously against the same Pi control plane. This is not the primary UX, but it is a design litmus test: if OpenAI and Gemini can both receive the same normalized context packets, expose the same normalized direct tools, and emit comparable provider-neutral events without corrupting durable Pi state, the architecture is probably clean.

Simultaneous-provider implications:

- Every provider connection gets a durable `providerSessionId` and optional `voicePersonaId`.
- Provider-origin events include `provider`, `providerSessionId`, provider event id when available, and local monotonic sequence.
- Context packets are revisioned and idempotent per provider session.
- Tool calls include a normalized `voiceToolCallId` plus provider call id; results are routed back only to the originating provider session.
- Voice-derived Pi instructions include source provider/session metadata but share one Pi target routing path.
- UI/status can show multiple active providers, while command defaults target the current primary provider unless specified.

## First prototype recommendation

Prototype in two stages:

1. No-mic deterministic prototype
   - Use a fake provider adapter and/or provider text input path.
   - Implement `/realtime start --provider fake`, `/realtime status`, `/realtime stop`.
   - Persist voice session events to Pi custom entries.
   - Add a tool path for `voice_send_instruction` that appends a hidden/visible Pi message or otherwise injects input into the next Pi agent turn.
   - Add `voice_read_state` packets from current Pi branch and status.
   - Validate branch replay, shutdown cleanup, and context filtering without external API keys or audio.

2. OpenAI-first real provider smoke path
   - User decision: implement OpenAI before Gemini for the first real provider prototype.
   - Add an OpenAI Realtime WebSocket adapter first.
   - Start with realtime text plus tool calls before microphone/audio playback.
   - Then add audio streaming and interruption/turn-detection behavior, especially semantic VAD.

Gemini remains a planned second provider. Its explicit simultaneous realtime text/media paths, context compression, proactivity, and session resumption primitives should inform the provider-neutral adapter design even before the Gemini adapter is implemented.

## Initial tool exposure concept

Direct voice-provider tools should be small and allowlisted, for example:

- `pi_state_snapshot`: read current Pi/realtime session state, active goal/status, recent assistant/tool output summaries.
- `pi_send_instruction`: send a natural-language instruction to the Pi agent with voice-context metadata.
- `pi_wait_for_update`: explicitly defer while waiting for Pi output/state change.
- `pi_realtime_status`: report/recover the realtime session state.
- `pinotator_citations_list`: read current Pinotator citation refs, aliases, ids, sources, and compact snippets.
- `pinotator_citation_resolve`: resolve spoken or textual refs such as `[1]`, `@p1`, or `cit_...` to durable citation ids and full citation text when needed.

Tools not given directly to the voice provider should remain available only to the Pi agent through normal Pi tool selection.

## Pinotator citation context integration

Pinotator integration should be treated as a first-class context-feed case, not an afterthought. Pinotator already emits explicit model-facing records such as:

```text
<pinotator_citation display_ref="[1]" alias="@p1" id="cit_..." origin="transcript" source="...">
...
</pinotator_citation>
```

The voice agent should receive a compact current citation deck so the user can naturally say things like "use citation one" or "that @p1 item" while speaking. The realtime extension should preserve the durable Pinotator citation id in any voice-derived Pi instruction so branch changes or renumbering do not silently point at the wrong source.

Provider-specific context strategy:

- Gemini Live can likely receive compact citation packets through `realtimeInput.text` or `clientContent`; this is close to a passive context feed, though ordering with other realtime streams is not guaranteed.
- OpenAI Realtime can receive text/system context via `conversation.item.create`, `session.update.instructions`, or response input, but it does not appear to expose the same explicit continuous passive text side-channel as Gemini Live. For OpenAI, prefer a hybrid: push a short citation index when it changes, and give the voice model explicit citation-list/resolve tools for authoritative lookup.
- For both providers, use revisioned packets: `citationDeckRevision`, display refs, aliases, ids, short snippets, and a tool hint saying to call resolve if the user references a citation not present or potentially stale.

## Risks and design questions

- How exactly to inject a voice-derived instruction into Pi: raw input event interception, `pi.sendMessage()`, synthetic user message, command context method, or model-facing custom message before next turn.
- How to represent the voice agent's conversational memory durably without flooding Pi model context.
- How to summarize Pi state into small rolling packets for provider context windows.
- How to avoid stale voice steering after `/tree`, compaction, resume, reload, or provider reconnect.
- How to handle multiple running Pi agents: one active target first, then target registry/selection.
- How to make the voice agent natural without letting it perform substantial independent work.
- How much of provider transcript/audio should be retained by default versus debug-only.
