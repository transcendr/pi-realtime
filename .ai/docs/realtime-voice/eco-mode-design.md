# pi-realtime Eco Mode — Technical Design

Status: implementation-ready design; live OpenAI/WebRTC probes still required for provider-specific speech isolation and conversation-item deletion.
Date: 2026-05-19

## 1. Summary

Eco mode is a new explicit realtime interaction mode for `pi-realtime`.

In the current `agent` mode, user audio reaches the realtime model, the model decides whether to call the `request` tool, and Pi receives backend work only if the realtime model emits an actual tool call. Live traces showed this is unreliable: mini can answer directly, emit JSON-shaped text instead of a tool call, or create duplicate request loops after backend updates.

Eco mode removes the realtime model from user-intent routing:

```text
user audio
  -> OpenAI Realtime WebRTC/STT/VAD
  -> final transcript event
  -> pi-realtime service/domain routing
  -> existing Pi backend request path
  -> Pi backend work
  -> realtime_send_ack/status/text
  -> realtime model speaks only explicit backend updates
```

The realtime model still exists in eco mode, but only as a speech renderer for Pi-originated updates. It receives no `request` tool and should not receive ordinary user-work turns as model responses.

## 2. Goals

- Add a clean, swappable interaction-mode abstraction with initial modes:
  - `agent`: current model-mediated behavior.
  - `eco`: direct STT transcript to Pi backend; voice model only speaks backend updates.
- Preserve current Pi backend request behavior after a request is delivered.
- Preserve OpenAI Realtime WebRTC media, input-audio transcription, server VAD, and natural barge-in.
- Prevent realtime-model request loops primarily through capability surface control:
  - `tools: []`
  - `tool_choice: "none"`
- Avoid scattered `if (mode === "eco")` checks. Mode identity maps centrally to behavior values; call sites consume behavior values.
- Keep provider code provider-owned and Pi/backend routing service/domain-owned.
- Add deterministic validation plus live OpenAI/WebRTC proof for behavior that cannot be proven statically.

## 3. Non-goals

- Do not replace OpenAI Realtime input-audio transcription with a separate STT endpoint in the first implementation.
- Do not disable WebRTC, VAD, interruption, or barge-in semantics.
- Do not change how Pi handles a delivered `VoiceInstructionInput` / `pi-realtime.request`.
- Do not implement future modes (`confirm`, `dictation`, `listen-only`, `command-only`, `interrupt-only`) in the first pass.
- Do not make `/realtime text` a default Pi-backend routing path. It remains provider/debug-oriented; typed backend input should be typed directly into Pi.
- Do not claim cost savings or isolated OpenAI speech behavior without live trace evidence.

## 4. Design principles

### 4.1 Two bridges only

The clean implementation has exactly two conceptual bridges:

1. **Provider-to-domain bridge**: providers emit normalized events such as `user_transcript`, `tool_call`, usage, assistant transcript, and turn signals.
2. **Domain-to-Pi bridge**: service/domain routing turns allowed normalized events into `VoiceInstructionInput` and submits them through `controlPlane.instructionSink`.

Everything else is configuration, rendering, or provider-specific speech output. A patch violates this design if:

- provider code calls Pi/control-plane APIs;
- browser helper code knows backend/Pi semantics;
- service/domain code constructs OpenAI-specific payloads;
- prompt text becomes the routing control plane.

### 4.2 Identity maps to behavior once

Mode should map centrally to behavior values. Avoid this pattern at every STT/provider touch point:

```ts
if (mode === "eco") { ... }
```

Prefer a central policy table that turns mode identity into behavior values:

```ts
const agent = {
  transcriptHandling: { response: "model", retention: "retain", backendRoute: "none" },
  toolSurface: requestToolSurface,
  toolChoice: "auto",
  backendSpeechContext: "default_conversation",
};

const eco = {
  transcriptHandling: { response: "suppress", retention: "delete_after_transcript", backendRoute: "submit_instruction" },
  toolSurface: emptyToolSurface,
  toolChoice: "none",
  backendSpeechContext: "isolated_update",
};
```

Boundary code may branch on behavior values, for example:

```ts
if (interaction.transcriptHandling.response === "suppress") {
  traceSuppressedTranscriptResponse(...);
  return;
}
requestResponse(...);
```

That is acceptable because the call site consumes behavior, not mode identity.

## 5. Proposed types

Add shared mode/policy types in `types.ts` or small domain modules.

```ts
export type RealtimeInteractionModeId = "agent" | "eco";

export type TranscriptResponsePolicy = "model" | "suppress";
export type TranscriptBackendRoute = "none" | "submit_instruction";
export type TranscriptRetentionPolicy = "retain" | "delete_after_transcript";
export type ToolChoicePolicy = "auto" | "none";
export type BackendSpeechContext = "default_conversation" | "isolated_update";
export type VoiceInstructionSource = "model_tool" | "direct_transcript" | "manual_text";

export type TranscriptHandlingPolicy = {
  response: TranscriptResponsePolicy;
  backendRoute: TranscriptBackendRoute;
  retention: TranscriptRetentionPolicy;
};

export type ProviderInteractionConfig = {
  mode: RealtimeInteractionModeId;
  tools: VoiceToolDefinition[];
  toolChoice: ToolChoicePolicy;
  transcriptHandling: TranscriptHandlingPolicy;
  backendSpeechContext: BackendSpeechContext;
};

export type RealtimeInteractionMode = {
  id: RealtimeInteractionModeId;
  toolSurface: VoiceToolSurface;
  systemPrompt(surface: VoiceToolSurface): string;
  acceptModelToolCalls: boolean;
  initialContextPolicy: "full" | "minimal";
  providerInteraction: ProviderInteractionConfig;
};
```

Persist both a default and a per-session selected mode:

```ts
export type RealtimeConfig = {
  primaryProviderSessionId: ProviderSessionId | null;
  defaultProvider: ProviderKind;
  defaultPersonaId: string;
  defaultInteractionMode: RealtimeInteractionModeId;
  providerPreferences: Partial<Record<ProviderKind, ProviderPreferences>>;
};

export type VoiceSessionRecord = {
  providerSessionId: ProviderSessionId;
  provider: ProviderKind;
  model: string;
  personaId: string;
  interactionMode: RealtimeInteractionModeId;
  status: "starting" | "active" | "stopping" | "stopped" | "error";
  startedAt: number;
  stoppedAt?: number;
  lastProviderEventAt?: number;
  lastError?: string;
};
```

Replay compatibility:

- Missing `defaultInteractionMode` defaults to `"agent"`.
- Missing `VoiceSessionRecord.interactionMode` defaults to `"agent"`.
- Do not mutate an active session's interaction mode in the first implementation. Start a new session or restart media instead.

## 6. New modules and ownership

Use focused modules rather than adding large branches to `service.ts`.

| File | Ownership |
| --- | --- |
| `.pi/extensions/pi-realtime/domain/interaction-modes.ts` | Pure mode policy table, mode lookup, tool surfaces, provider interaction projection. No provider/Pi imports. |
| `.pi/extensions/pi-realtime/domain/transcript-routing.ts` | Pure transcript filter and transcript-to-`VoiceInstructionInput` decision. No provider/Pi imports. |
| `.pi/extensions/pi-realtime/prompt.ts` | Stateless prompt builders: agent prompt and speech-renderer prompt. No mode policy imports. |
| `.pi/extensions/pi-realtime/service.ts` | Orchestration: resolve session/mode, call domain routing, execute decisions, trace. |
| `.pi/extensions/pi-realtime/providers/types.ts` | Provider adapter contract; add `interaction: ProviderInteractionConfig` to `ProviderConnectConfig`. |
| `.pi/extensions/pi-realtime/providers/openai/responses.ts` | OpenAI-specific response/session payload helpers, including isolated backend speech candidate. |
| `.pi/extensions/pi-realtime/media/webrtc-helper/*` | Browser/WebRTC transport, transcript postback, outbox. No Pi/backend semantics. |

Dependency rules:

- `domain/*` may import `../types`, `../prompt`, and standard library only.
- `domain/*` must not import `service`, `control-plane`, `providers/*`, Pi API packages, or OpenAI SDK packages.
- Providers receive `ProviderInteractionConfig` through `ProviderConnectConfig`; they should not call `interactionMode()` themselves.
- OpenAI payload construction belongs under `providers/openai/*`, not in service/domain.

## 7. Mode policy

Initial policy table:

| Mode | Tools | Tool choice | Transcript response | Transcript backend route | Transcript retention | Backend speech context | Tool calls |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `agent` | request tool surface | `auto` | `model` | `none` | `retain` | `default_conversation` | accepted |
| `eco` | empty surface | `none` | `suppress` | `submit_instruction` | `delete_after_transcript` best-effort | `isolated_update` desired | rejected/traced |

Sketch:

```ts
const AGENT_MODE: RealtimeInteractionMode = {
  id: "agent",
  toolSurface: requestToolSurface,
  systemPrompt: voiceAgentPrompt,
  acceptModelToolCalls: true,
  initialContextPolicy: "full",
  providerInteraction: {
    mode: "agent",
    tools: requestToolSurface.tools,
    toolChoice: "auto",
    transcriptHandling: { response: "model", backendRoute: "none", retention: "retain" },
    backendSpeechContext: "default_conversation",
  },
};

const ECO_MODE: RealtimeInteractionMode = {
  id: "eco",
  toolSurface: { revision: 1, tools: [] },
  systemPrompt: voiceSpeechRendererPrompt,
  acceptModelToolCalls: false,
  initialContextPolicy: "minimal",
  providerInteraction: {
    mode: "eco",
    tools: [],
    toolChoice: "none",
    transcriptHandling: { response: "suppress", backendRoute: "submit_instruction", retention: "delete_after_transcript" },
    backendSpeechContext: "isolated_update",
  },
};
```

First implementation supports only `agent` and `eco`. Future modes should add policy rows and domain decisions, not new realtime-agent personalities.

## 8. Exact transcript ingress seams

| Path | File/function | Current behavior | Eco behavior |
| --- | --- | --- | --- |
| OpenAI WebRTC browser | `media/webrtc-helper/client.js` `handleInputAudioTranscription(event)` | Posts usage and `user_transcript`, filters empty/low-info, then calls `requestResponse("valid_transcript", event.event_id)` | Continue posting usage/transcript and filtering. If `config.interaction.transcriptHandling.response === "suppress"`, trace `response_suppressed` with `eco_direct_backend_transcript` and return before `requestResponse`. If retention asks for deletion, enqueue/send provider item deletion best-effort after transcript capture. |
| WebRTC helper server | `media/webrtc-helper/server.ts` `handleInboundEvent()` → `normalize()` | Converts browser `user_transcript` inbound into `NormalizedProviderEvent` and calls `session.sink.onProviderEvent(event)` | Keep transport normalization unchanged. Add interaction config only. Do not construct backend requests in helper server. |
| OpenAI raw WebSocket | `providers/openai/index.ts` `handleServerEvent(event)` branch `conversation.item.input_audio_transcription.completed` | Emits usage, emits `user_transcript`, then if actionable calls `requestResponse({ reason: "valid_transcript" })` | Continue emitting usage/transcript. Gate response creation on `interaction.transcriptHandling.response`. Apply provider item deletion best-effort if configured and live-proven. |
| Fake provider | `providers/fake.ts` `simulateTranscript(text, final)` | Emits `user_transcript` for deterministic tests | No provider-specific backend logic. Service routing should make fake eco transcript submit a backend request. |

Important: eco mode still uses OpenAI Realtime input-audio transcription (`gpt-4o-mini-transcribe` inside current audio config), not a separate STT endpoint. It does **not** mean audio bypasses OpenAI entirely. Audio still reaches the Realtime session for WebRTC, VAD, interruption, transcription, and output audio integration. Eco mode suppresses model responses to those transcripts and routes actionable final transcripts to Pi.

## 9. Transcript routing domain logic

`domain/transcript-routing.ts` owns direct transcript request construction.

```ts
export type TranscriptRouteDecision =
  | { action: "ignore"; reason: "mode_uses_model" | "non_final" | "empty" | "low_information" }
  | { action: "submit_instruction"; input: VoiceInstructionInput };

export function routeTranscriptToInstruction(input: {
  event: Extract<NormalizedProviderEvent, { type: "user_transcript" }>;
  session: VoiceSessionRecord;
  mode: RealtimeInteractionMode;
  target: PiTargetRef;
  citationDeckRevision?: number;
  newInstructionId?: () => InstructionId;
}): TranscriptRouteDecision {
  if (mode.providerInteraction.transcriptHandling.backendRoute !== "submit_instruction") {
    return { action: "ignore", reason: "mode_uses_model" };
  }
  if (!input.event.final) return { action: "ignore", reason: "non_final" };

  const text = input.event.text.trim();
  if (!text) return { action: "ignore", reason: "empty" };
  if (!isActionableTranscript(text)) return { action: "ignore", reason: "low_information" };

  return {
    action: "submit_instruction",
    input: {
      instructionId: input.event.providerEventId ? `transcript_${input.event.providerEventId}` : input.newInstructionId?.() ?? `transcript_${randomUUID()}`,
      source: "direct_transcript",
      provider: input.event.provider,
      providerSessionId: input.event.providerSessionId,
      target: input.target,
      urgency: "normal",
      deliveryHint: "work",
      instructionText: text,
      userUtteranceSummary: text,
      citedCitationIds: [],
      citationDeckRevision: input.citationDeckRevision,
    },
  };
}
```

Use the same provider-neutral low-information rule as current VAD/cost-control filtering: lexical length after stripping whitespace/punctuation/symbols must be at least 4. Do not add phrase blacklists for `stop`, `OK`, `wait`, etc. If short utterances during backend speech need special handling, design a future generic interrupt-only policy based on timing/context, not words.

## 10. Service integration

`service.ts` remains the orchestration boundary.

```ts
private async handleProviderEvent(event: NormalizedProviderEvent): Promise<void> {
  this.traceProviderEvent(event);
  this.store.append(providerEventObserved(event));
  if (event.type === "usage") this.store.append(usageObserved(event.observation));
  this.notifyProviderEvent(event);

  if (event.type === "user_transcript") return this.routeTranscriptEvent(event);
  if (event.type === "tool_call") return this.routeToolCallEvent(event.call);
}
```

Transcript path:

```ts
private async routeTranscriptEvent(event: Extract<NormalizedProviderEvent, { type: "user_transcript" }>): Promise<void> {
  const session = this.store.state().sessions.get(event.providerSessionId);
  if (!session) return this.traceTranscriptRoute(event, { action: "ignore", reason: "missing_session" });

  const mode = interactionMode(session.interactionMode ?? "agent");
  if (!this.currentCtx) return this.traceTranscriptRoute(event, { action: "ignore", reason: "missing_context" });

  const deck = this.controlPlane.observeCitations(this.currentCtx);
  const decision = routeTranscriptToInstruction({
    event,
    session,
    mode,
    target: this.controlPlane.currentTarget(this.currentCtx),
    citationDeckRevision: deck.revision,
  });

  this.traceTranscriptRoute(event, decision);
  if (decision.action === "submit_instruction") {
    const receipt = await this.controlPlane.instructionSink.sendInstruction(decision.input);
    this.traceInstructionSubmission(decision.input, receipt);
  }
}
```

Tool-call path:

```ts
private async routeToolCallEvent(call: VoiceToolCallRecord): Promise<void> {
  const session = this.store.state().sessions.get(call.providerSessionId);
  const mode = interactionMode(session?.interactionMode ?? "agent");

  if (!mode.acceptModelToolCalls) {
    this.traceRejectedToolCall(call, mode.id);
    // If provider protocol requires a function output to settle an impossible call,
    // send a terse result with response policy none, but do not execute the tool.
    await this.recordToolResult({
      voiceToolCallId: call.voiceToolCallId,
      providerSessionId: call.providerSessionId,
      status: "failed",
      resultText: "Tool calls are not available in this realtime interaction mode.",
      at: Date.now(),
    }, "none");
    return;
  }

  this.store.append(voiceToolCallReceived(call));
  await this.executeDirectTool(call);
}
```

This keeps the backend ingress unchanged: eco transcript requests still become `VoiceInstructionInput` and go through `controlPlane.instructionSink.sendInstruction(...)`, which renders the existing `pi-realtime.request` custom message and appends `voice_instruction_submitted`. That preserves `defaultRealtimePushTarget()` behavior for later `realtime_send_*` replies.

## 11. Provider integration

Add interaction config to provider connect config:

```ts
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
  interaction: ProviderInteractionConfig;
};
```

Service start path:

- Resolve requested/default interaction mode.
- Persist `interactionMode` in `sessionStarted(...)`.
- Build mode-specific tool surface and prompt.
- Pass `providerInteractionFor(mode)` to adapter connect.
- `startSessionMedia(...)` must use the persisted session mode, not whatever the current default is later.

Provider responsibilities:

- Map `interaction.tools` and `interaction.toolChoice` to provider session config.
- Suppress realtime model response creation when `interaction.transcriptHandling.response === "suppress"`.
- Apply provider conversation retention best-effort when `interaction.transcriptHandling.retention === "delete_after_transcript"` and live proof supports it.
- Render backend updates according to `interaction.backendSpeechContext`.
- Never submit Pi backend work directly.

## 12. OpenAI-specific implementation

### 12.1 Session/client secret

Raw OpenAI `sendSessionUpdate()` and WebRTC client-secret creation should consume policy-derived fields:

```ts
const tools = this.interaction.tools.map(toOpenAITool);
const tool_choice = this.interaction.toolChoice;

session: {
  type: "realtime",
  model,
  instructions,
  output_modalities: ["audio"],
  audio: buildOpenAIRealtimeAudioConfig(),
  tools,
  tool_choice,
}
```

For eco this becomes:

```ts
tools: []
tool_choice: "none"
```

### 12.2 Transcript response suppression

Raw adapter:

```ts
if (event.type === "conversation.item.input_audio_transcription.completed") {
  emitUsage(...);
  emit({ type: "user_transcript", text: event.transcript, final: true, providerEventId: event.event_id });

  if (isOpenAITranscriptActionable(event.transcript) && this.interaction.transcriptHandling.response === "model") {
    void this.requestResponse({ reason: "valid_transcript" }).catch(...);
  } else {
    trace response_suppressed;
  }

  maybeDeleteProviderConversationItem(event.item_id);
  return;
}
```

WebRTC browser helper:

```js
if (!isTranscriptActionable(transcript)) return;
if (config.interaction.transcriptHandling.response === "suppress") {
  trace("response_suppressed", { reason: "eco_direct_backend_transcript", providerEventId: event.event_id, itemId: event.item_id });
  maybeDeleteConversationItem(event.item_id);
  return;
}
requestResponse("valid_transcript", event.event_id);
```

The browser helper should know only transport/provider behavior values. It should not know that Pi/backend routing exists.

### 12.3 Provider conversation item deletion

OpenAI SDK exposes `conversation.item.delete`. Eco mode may use this to delete the provider-side Realtime conversation item for the user input audio after final transcript capture/routing.

This means deleting an OpenAI Realtime conversation item, not deleting a local Pi audio file. Pi should not store audio files for this feature.

Policy value:

```ts
providerConversationRetention: "retain" | "delete_user_item_after_transcript"
```

First implementation stance:

- Implement deletion behind a provider behavior flag only after targeted live proof.
- Failure to delete must degrade safely:
  - trace warning/error;
  - continue safe routing;
  - rely on isolated backend speech to avoid stale transcript context influencing spoken backend updates.

Live proof needed:

- transcript is still delivered before deletion;
- barge-in/interruption still works;
- usage reporting still arrives;
- no provider errors destabilize session;
- later backend-update responses stop carrying prior input audio tokens, if measurable.

### 12.4 Backend update speech

Eco mode should prefer update-only isolated speech so the model does not use accumulated user transcript/audio context while speaking Pi updates.

SDK-backed candidate:

```ts
export function backendUpdateResponseEvent(input: RealtimeContextPushRequest, interaction: ProviderInteractionConfig): RealtimeClientEvent {
  const envelope = renderRealtimeUpdateEnvelope(input);

  if (interaction.backendSpeechContext === "isolated_update") {
    return {
      type: "response.create",
      response: {
        conversation: "none",
        output_modalities: ["audio"],
        instructions: realtimeUpdateResponseInstructions(input.kind),
        input: [{
          type: "message",
          role: "system",
          content: [{ type: "input_text", text: envelope }],
        }],
        tools: [],
        tool_choice: "none",
      },
    } as RealtimeClientEvent;
  }

  return defaultConversationBackendUpdateResponse(input);
}
```

This is supported by SDK typings/comments, but must be live-probed over WebRTC `/realtime/calls` before treating it as proven. If WebRTC rejects this exact response-level shape, adjust inside OpenAI helper code only; keep provider-neutral mode abstractions unchanged.

## 13. Commands and UX

Add mode selection without confusing interaction mode with media mode:

```text
/realtime start --provider openai --mode eco
/realtime start --provider openai --mode agent
/realtime openai start --mode eco
/realtime mode eco        # default for future sessions only
/realtime mode agent
/realtime status          # includes mode per session
```

Default first implementation: keep `agent` as default for compatibility unless the user later explicitly chooses eco as default after live validation.

`/realtime text` remains provider/debug behavior. In eco mode it should not silently become a Pi backend request. If a debug escape hatch is needed, make it explicit, for example `/realtime text --to-model ...` or retain current provider text behavior with clear docs.

## 14. Barge-in, low-information transcripts, and short utterances

Eco mode preserves OpenAI server-side VAD and WebRTC barge-in because audio still reaches the same Realtime session.

Transcript handling sequence:

1. VAD can interrupt active speech immediately.
2. Final transcript arrives.
3. Provider-neutral transcript gate classifies it.
4. Low-information transcripts are dropped after interruption.
5. Actionable transcripts route to Pi backend.
6. No transcript creates a realtime-model user response in eco mode.

Do not add arbitrary word/phrase lists for one-word interruptors like `stop`, `OK`, or `wait`. If enough lexical content passes the current gate but should be interruption-only, design a future generic policy based on timing/context, such as “short utterance during assistant playback,” and live-observe before implementing.

## 15. Cost-control posture

Eco mode may reduce cost through:

- suppressing realtime model responses to user transcripts;
- no tool-call generation loops;
- isolated backend update speech that avoids carrying prior user audio/text context;
- optional provider conversation item deletion after transcript capture.

Cost proof is best-effort and not a blocker for safe routing. Instrument usage enough to compare:

- `input_audio_tokens`
- `cached_input_audio_tokens`
- input text tokens
- output audio tokens
- total response tokens/cost estimate

Deletion/isolation should be measured live, but initial implementation should prioritize loop-safety and correct routing even if cost effects are inconclusive.

## 16. Future extensibility

Future modes are Pi/session policies, not alternate realtime-agent personalities.

Potential future policies:

- `confirm`: Pi receives voice intent but requires confirmation before processing/execution.
- `dictation`: transcripts route to a defined Pi-owned storage target.
- `listen-only`: transcripts are visible/audited according to a defined policy, no backend work.
- `command-only`: only mode/control commands become Pi instructions.
- `interrupt-only`: user voice steers/interruption state but does not become work.

These should extend domain policy/route decisions, not provider-specific personalities or prompt branches.

## 17. Closed design forks

The following decisions close the main design forks from interim planning:

| Fork | Decision |
| --- | --- |
| Separate STT endpoint vs Realtime STT | Use existing OpenAI Realtime input-audio transcription first. It preserves WebRTC media, server VAD, barge-in, and output audio integration. |
| Prompt/tool-choice enforcement vs capability removal | Eco loop prevention relies on no tools (`tools: []`, `tool_choice: "none"`) and no user-transcript model responses. Prompt wording is secondary. |
| Mode checks vs behavior values | Central policy maps `agent`/`eco` to behavior values; call sites branch only on behavior values like `transcriptHandling.response`. |
| `/realtime text` routing | Keep `/realtime text` provider/debug-oriented. Typed Pi/backend input should be typed into Pi, not smuggled through realtime text. |
| Future modes in first implementation | Out of scope. The initial implementation supports only `agent` and `eco`, while leaving policy seams for future Pi/session-owned modes. |
| Isolated speech certainty | SDK-backed candidate, not proven. Implement behind provider helper and require live WebRTC proof before claiming it works. |
| Provider conversation item deletion | Best-effort, live-probe-dependent hygiene/cost feature. Safe routing must not depend on deletion success. |
| Short interruptor words | No word blacklist. Preserve VAD interruption and use the generic transcript gate; consider future timing/context-based interrupt-only policy only after live observation. |

### Delivery semantics for direct voice input

Direct transcript requests should be steering-capable when Pi is already working, without abusing `deliveryHint: "progress"`.

Use `VoiceInstructionSource` to keep this explicit:

```ts
export type VoiceInstructionSource = "model_tool" | "direct_transcript" | "manual_text";
```

Then update `control-plane.chooseDelivery(...)` to treat direct transcript input as steerable when the agent is active:

```ts
function chooseDelivery(ctx: ExtensionContext | undefined, input: Pick<VoiceInstructionInput, "urgency" | "deliveryHint" | "source">): VoiceInstructionReceipt["delivery"] {
  if (!ctx || ctx.isIdle()) return "immediate";
  if (input.urgency === "interrupt" || input.deliveryHint === "progress" || input.source === "direct_transcript") return "steer";
  return "followUp";
}
```

This keeps Pi's request path stable while making spoken user input behave like active steering rather than a late follow-up.

## 18. Implementation path

Recommended commit sequence:

1. **State and command surface**
   - Add mode ids, config/session fields, replay defaults.
   - Parse `--mode eco|agent`.
   - Add `/realtime mode eco|agent` for future-session default.
   - Render mode in status/widget/session awareness.

2. **Domain policy**
   - Add `domain/interaction-modes.ts`.
   - Split prompt builders into agent prompt and speech-renderer prompt.
   - Keep behavior unchanged for `agent`.

3. **Transcript routing**
   - Add `domain/transcript-routing.ts`.
   - Add service `routeTranscriptEvent` and `routeToolCallEvent`.
   - Add fake-provider deterministic validation.

4. **Provider projection**
   - Add `ProviderConnectConfig.interaction`.
   - Pass interaction config into raw OpenAI, WebRTC bridge/helper, fake provider.
   - In `agent`, behavior remains unchanged.

5. **Eco capability surface and transcript suppression**
   - Eco OpenAI sessions use no tools and `tool_choice: "none"`.
   - Raw/WebRTC suppress `valid_transcript` model responses using behavior values.
   - Unexpected eco tool calls are rejected/traced.

6. **Backend speech isolation**
   - Add OpenAI response helper for isolated backend-update speech.
   - Trace response fields sufficiently.
   - Live-probe WebRTC behavior.

7. **Provider conversation deletion and cost instrumentation**
   - Live-probe `conversation.item.delete` after transcript capture.
   - If reliable, add best-effort deletion under provider retention policy.
   - Compare usage fields before/after.

8. **Docs and quality gates**
   - Update README.
   - Add deterministic probes.
   - Run quality gates.
   - Save live probe artifacts.

## 19. Validation plan

Deterministic probes:

- `pi-realtime-interaction-modes-probe.mjs`
  - `agent` has request tool, `auto`, model response, accepted tools.
  - `eco` has zero tools, `none`, suppressed transcript response, backend route, rejected tools.
- `pi-realtime-transcript-routing-probe.mjs`
  - final actionable eco transcript creates `VoiceInstructionInput`.
  - non-final/empty/low-info ignored.
  - agent transcript route returns `mode_uses_model`.
- Update `pi-realtime-state-probe.mjs`
  - mode replay/default compatibility.
- Update OpenAI adapter/helper probes
  - raw and WebRTC consume provider interaction config.
  - transcript suppression uses behavior values.
  - no tools/tool choice none in eco.
  - isolated backend update helper exists and traces response shape.
- Update context-push policy probe
  - no eco request tools;
  - backend-update speech path is isolated where supported.

Required commands before closeout:

```bash
npm run gates:typecheck
npm run gates:validation
npm run gates:quality
```

Live OpenAI/WebRTC probe is mandatory before claiming this feature fixes live behavior:

1. Start OpenAI WebRTC eco session.
2. Ask: “what was the last commit?”
3. Verify trace:
   - final `user_transcript` exists;
   - no `response.output_text.done` JSON-as-assistant request for that user turn;
   - no `response.function_call_arguments.done` request tool call;
   - service logs direct transcript route decision;
   - Pi receives `pi-realtime.request`.
4. Send `realtime_send_ack/status/text` from Pi.
5. Verify trace:
   - backend update speech occurs;
   - no duplicate `request` tool call after backend update;
   - isolated speech response behavior is as expected.
6. Record session id, trace path, event line summary, usage/cost observations, and pass/fail notes under `.ai/validation/live-probe/`.

## 20. Open questions requiring live proof

- Does OpenAI WebRTC `/realtime/calls` accept and correctly speak `response.create` with `conversation: "none"` and update-only `input`?
- Does response-level update-only input actually isolate speech from default conversation context?
- Does `conversation.item.delete` safely delete provider-side user/input-audio items after transcript capture without breaking transcript delivery, interruption semantics, or usage reporting?
- How much do deletion and isolated speech affect `input_audio_tokens`, cached audio tokens, and total response cost?
- Are short utterances during assistant playback better handled as future generic interrupt-only signals based on timing/context?

## 21. Code review checklist

- No provider imports Pi/control-plane APIs.
- No browser helper code mentions Pi/backend routing.
- No service/domain code builds OpenAI payloads.
- No scattered `if (mode === "eco")` checks at STT/provider touch points.
- Providers consume `ProviderInteractionConfig` behavior values.
- Direct transcript backend routing uses `controlPlane.instructionSink.sendInstruction(...)`.
- `voice_instruction_submitted` is appended so `defaultRealtimePushTarget()` works.
- Eco sessions expose no request tools.
- Eco transcript response suppression is present in both raw OpenAI and WebRTC paths.
- Backend update speech is update-only/isolated where live-proven.
- Live behavior claims are backed by trace artifacts, not TypeScript shape alone.

## 22. Implementation ledger

### Iteration 1 — State, mode policy, transcript routing, provider projection, and eco suppression

Interrogate:

1. What must be persisted so replay/resume preserves behavior? Session records now include `interactionMode`; config now includes `defaultInteractionMode`, with replay defaults to `agent` for older events.
2. Where should mode identity be interpreted? Mode identity is centralized in `domain/interaction-modes.ts`; service/provider/browser call sites consume projected behavior values.
3. How does eco create Pi backend work without provider/browser backend knowledge? Providers and browser helper still emit normalized `user_transcript`; service routes final actionable transcripts through `domain/transcript-routing.ts` into the existing instruction sink.
4. How are unexpected model tool calls handled in eco? Service rejects and traces tool calls for modes with `acceptModelToolCalls=false` and returns a failed tool result without executing product work.
5. How is live/provider uncertainty contained? OpenAI payload changes are provider-owned; isolated backend speech is represented by an OpenAI helper but still requires live WebRTC proof before product claims.

Progress:

- Added mode/config/session/source types.
- Added `domain/interaction-modes.ts` and `domain/transcript-routing.ts`.
- Split the voice prompt into agent and speech-renderer prompts.
- Added `/realtime mode agent|eco` and `--mode agent|eco` session startup support.
- Rendered mode in status/widget/session awareness.
- Added direct transcript delivery steering via `source: "direct_transcript"`.
- Passed `ProviderInteractionConfig` into providers and WebRTC helper config.
- Configured eco provider projection to remove tools, use `tool_choice: "none"`, suppress transcript-triggered model responses, and reject unexpected tool calls.
- Added OpenAI response helpers for backend-update item/response creation including the isolated update candidate.

Unexpected outcomes:

- The implementation naturally grouped several planned path steps because provider config and service routing share the same type seam. This was still coherent and avoided half-wired intermediate commits.

Deviations/trade-offs:

- Provider-side `conversation.item.delete` was not implemented in this iteration. The design explicitly requires live proof before relying on deletion; routing safety does not depend on it.
- Backend speech isolation is implemented as a provider helper candidate, but remains live-unproven.

Validation:

- `npm run gates:typecheck` passed.

Review:

- Checked authority boundaries: providers emit events and build provider payloads; service owns routing; browser only consumes behavior config and emits provider events.
- Checked no prompt-only control for eco: eco removes tools and suppresses transcript model response creation.

CLEAN IMPLEMENTATION for the implemented deterministic scope. Remaining live-provider semantics are documented as proof requirements, not claimed complete.

### Iteration 2 — Deterministic validation probes and review hardening

Interrogate:

1. Which deterministic checks prove the new mode seam without live provider access? Static probes now assert the policy table, provider projection fields, transcript route decisions, and direct-transcript steering.
2. Which existing probes became stale because provider payload construction moved? Context-push and packet probes were updated to inspect `providers/openai/responses.ts` and source-aware delivery rather than the old inline payload strings.
3. Is the domain policy over-abstracted? The mode module remains a small typed policy table plus lookup/projection helpers, not a strategy hierarchy.
4. Did the implementation introduce duplicated or speculative surfaces? Removed duplicate `defaultVoiceToolSurface()` construction in the policy module; no future modes were implemented.
5. Are live-provider semantics separated from deterministic proof? Yes. Validation proves local contracts only; isolated OpenAI speech and item deletion remain live-proof items.

Progress:

- Added `pi-realtime-interaction-modes-probe.mjs`.
- Added `pi-realtime-transcript-routing-probe.mjs`.
- Updated state, context-push, and packet probes for mode/source/response-helper seams.
- Re-ran typecheck and validation after probe updates.

Unexpected outcomes:

- Existing static probes intentionally caught moved responsibility from bridge/raw provider files into `providers/openai/responses.ts`. Probe expectations were updated to follow the new ownership rather than re-inline provider payload code.

Deviations/trade-offs:

- No behavioral trade-off. This iteration was validation and cleanup only.

Validation:

- `npm run gates:validation` passed.
- `npm run gates:typecheck` passed.

Review:

- Rechecked deslop concerns around duplicated policy construction and removed it.
- Confirmed the probes assert capability surface and event-routing contracts, not prompt wording alone.

CLEAN IMPLEMENTATION.
