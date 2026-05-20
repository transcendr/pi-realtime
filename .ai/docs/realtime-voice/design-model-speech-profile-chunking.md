# pi-realtime Model Switching, Model Speech Profiles, and Backend-Update Chunking

Status: final technical design draft
Date: 2026-05-20

## 1. Executive summary

This design adds two related capabilities to `pi-realtime`:

1. **OpenAI realtime model switching by slash command** as a prerequisite: users can quickly set the default OpenAI realtime model to `gpt-realtime-mini` or `gpt-realtime-2` without editing configuration manually.
2. **Model-specific backend-update speech behavior profiles** with sentence-aware chunking as the first concrete behavior: `gpt-realtime-mini` can chunk long backend updates to reduce the live-observed tendency to summarize long spoken payloads, while future models such as `gpt-realtime-2` can opt out or use different limits without service-level model branches.

The architecture follows the same policy-projection approach used for eco mode: identity is resolved once at a provider/model edge, then core service logic consumes behavior values. Provider-specific model names remain under provider runtime/model profile modules. Service/domain code stays provider-neutral and testable.

## 2. Problem statement and evidence

Live eco-mode testing showed that OpenAI `gpt-realtime-mini` behaves differently by payload length:

- short backend updates are often spoken literally enough;
- long backend updates can be summarized, reframed, truncated, or followed by unsolicited conversational text even when the session prompt and per-response instructions say to speak literally.

The concrete failure that motivated this design: Pi sent a long architecture/style alignment report; realtime spoke a much shorter summary and added an offer. Smaller payloads immediately before and after were much more faithful.

This suggests chunking long backend updates may reduce the model's tendency to summarize. The fix should not be hardcoded as `if (model === "gpt-realtime-mini")` in service, and it should not be tied to eco mode. Some future OpenAI model such as `gpt-realtime-2` may not need chunking.

## 3. Goals

- Add a small slash-command surface for switching the default OpenAI realtime model between `gpt-realtime-mini` and `gpt-realtime-2`.
- Treat model switching as a prerequisite because model choice determines the speech behavior profile used by new sessions.
- Introduce a `RealtimeBehaviorProfile` abstraction that can express backend-update speech behavior per provider/model.
- Implement sentence-aware backend-update chunking as the first profile-backed behavior.
- Keep model-specific declarations provider-owned.
- Keep service/domain logic provider-neutral and behavior-driven.
- Preserve exact payload text; chunking must not summarize, rewrite, or drop content.
- Validate deterministically with fake provider and pure chunk/profile probes.
- Preserve live OpenAI/WebRTC semantics; do not disable barge-in, interruption, streaming, or provider VAD.

## 4. Non-goals

- No live-session hot model swap. Model switching affects the provider default used for future sessions unless `--model` explicitly overrides it.
- No user-facing chunk-size command in the first implementation.
- No prompt/instruction profile fields in the first implementation.
- No separate deterministic TTS path in this design.
- No fix for the separate `Stop.` transcript-routing leak.
- No phrase blacklist or arbitrary word-specific filtering.
- No claim that local gates prove live OpenAI speech behavior.

## 5. Current architecture constraints

Relevant files and ownership:

- `.pi/extensions/pi-realtime/domain/interaction-modes.ts`
  - maps interaction mode identity to behavior values.
- `.pi/extensions/pi-realtime/providers/runtime-types.ts`
  - provider runtime contract.
- `.pi/extensions/pi-realtime/providers/openai/runtime.ts`
  - OpenAI default model, credentials, WebRTC runtime wiring.
- `.pi/extensions/pi-realtime/commands.ts`
  - slash command parsing; delegates to service.
- `.pi/extensions/pi-realtime/service.ts`
  - provider-neutral orchestration and state mutation.
- `.pi/extensions/pi-realtime/events.ts` and `store.ts`
  - branch-aware persistence/replay through `config_changed` events.
- `.pi/extensions/pi-realtime/providers/types.ts`
  - provider adapter contracts including `RealtimeContextPushRequest`.
- `.pi/extensions/pi-realtime/providers/openai/responses.ts`
  - OpenAI-specific payload construction.
- `.pi/extensions/pi-realtime/realtime-updates.ts`
  - backend-update envelope and per-response speech instructions.

Design-guide constraints:

- Service/domain should route and mutate state, not build provider SDK payloads.
- Provider-specific model names belong at provider-specific edges.
- Browser helper owns media/WebRTC plumbing only.
- Prompt text is not an authority boundary.
- Prefer central policy projection over scattered identity checks.
- If state matters after reload, persist through config/session events.

## 6. Design overview

### 6.1 Flow

```text
/realtime openai model gpt-realtime-2
  -> commands.ts parses provider-scoped model command
  -> service validates model against provider runtime
  -> service persists providerPreferences.openai.defaultModel

/realtime openai start --mode eco
  -> service.defaultModelFor("openai") uses persisted default unless --model overrides
  -> session_started persists actual model on VoiceSessionRecord

realtime_send_text(long payload)
  -> service resolves target provider session
  -> service asks provider runtime for model profile fragment
  -> domain resolver merges fragment into complete RealtimeBehaviorProfile
  -> domain chunker splits eligible backend update into sentence-aware chunks
  -> service calls adapter.pushContext(...) once per chunk
  -> provider adapter renders each chunk through existing backend-update response path
```

### 6.2 Key architectural decision

Model switching is **provider preference state**. Backend-update chunking is **model behavior profile policy**. They are related through the persisted session model, but they are not the same abstraction.

This separation keeps responsibilities clear:

- provider runtime knows which model ids are allowed and which model profile fragment applies;
- service persists the selected default model and applies behavior values;
- domain chunker knows nothing about OpenAI;
- OpenAI adapter only translates chunked backend updates into OpenAI events.

## 7. Model switching design

### 7.1 State

Extend `ProviderPreferences`:

```ts
export type ProviderPreferences = {
	autoMediaMode?: ProviderMediaMode;
	defaultModel?: string;
};
```

`defaultModelFor(provider)` changes from runtime-only to preference-aware:

```ts
defaultModelFor(provider: ProviderKind): string {
	return this.providerPreference(provider).defaultModel
		?? this.requireProviderRuntime(provider).defaultModel();
}
```

Persist through existing `config_changed` event with `providerPreferences`. No new event kind is needed.

### 7.2 Provider runtime model metadata

Extend `ProviderRuntime`:

```ts
export type ProviderRuntime = {
	provider: ProviderKind;
	defaultModel(): string;
	availableModels?(): readonly string[];
	behaviorProfileForModel?(model: string): RealtimeBehaviorProfileFragment;
	// existing fields...
};
```

OpenAI runtime:

```ts
const OPENAI_REALTIME_MODELS = ["gpt-realtime-mini", "gpt-realtime-2"] as const;

availableModels() {
	return OPENAI_REALTIME_MODELS;
}
```

### 7.3 Service API

Add to `Service`:

```ts
availableModelsFor(provider: ProviderKind): readonly string[];
defaultModelFor(provider: ProviderKind): string;
setDefaultModel(provider: ProviderKind, model: string): string;
```

`setDefaultModel(...)`:

1. gets provider runtime;
2. checks `availableModels?.()` if present;
3. rejects model not in allowed list;
4. persists `providerPreferences[provider].defaultModel` while preserving existing provider preferences such as `autoMediaMode`;
5. returns a concise user-facing confirmation.

### 7.4 Commands

Add OpenAI-scoped command:

```text
/realtime openai model
/realtime openai model gpt-realtime-mini
/realtime openai model gpt-realtime-2
```

Behavior:

- no arg: show current OpenAI default and allowed models;
- valid arg: persist default;
- invalid arg: show allowed models and do not mutate state.

Do not add generic provider model command yet. OpenAI is the only implemented provider with real model choices here, and the allowed set is provider-specific.

### 7.5 Start command interaction

Existing `--model` remains highest precedence:

```text
/realtime openai start --model gpt-realtime-mini
```

If `--model` is absent, `startProvider(...)` uses `service.defaultModelFor("openai")`, which now respects the persisted provider default.

## 8. Model behavior profile design

### 8.1 Types

Add shared behavior types:

```ts
export type SpeechChunkSplitStrategy = "sentence";

export type BackendUpdateSpeechChunkingPolicy = {
	enabled: boolean;
	maxChars: number;
	splitStrategy: SpeechChunkSplitStrategy;
};

export type BackendUpdateSpeechPolicy = {
	chunking: BackendUpdateSpeechChunkingPolicy;
};

export type RealtimeBehaviorProfile = {
	backendUpdateSpeech: BackendUpdateSpeechPolicy;
};

export type RealtimeBehaviorProfileFragment = {
	backendUpdateSpeech?: {
		chunking?: Partial<BackendUpdateSpeechChunkingPolicy>;
	};
};
```

Do not add speculative prompt/instruction/sequencing fields yet. The broad profile name is intentional; new fields should be added only when backed by concrete provider/model evidence.

### 8.2 Shared resolver

Add:

```text
.pi/extensions/pi-realtime/domain/behavior-profiles.ts
```

```ts
const DEFAULT_BEHAVIOR_PROFILE: RealtimeBehaviorProfile = {
	backendUpdateSpeech: {
		chunking: { enabled: false, maxChars: 800, splitStrategy: "sentence" },
	},
};

export function resolveRealtimeBehaviorProfile(input: {
	providerProfile?: RealtimeBehaviorProfileFragment;
	interactionMode: RealtimeInteractionModeId;
}): RealtimeBehaviorProfile {
	return {
		backendUpdateSpeech: {
			chunking: {
				...DEFAULT_BEHAVIOR_PROFILE.backendUpdateSpeech.chunking,
				...input.providerProfile?.backendUpdateSpeech?.chunking,
			},
		},
	};
}
```

`interactionMode` is accepted for future mode-specific profile fragments, but the initial implementation does not add mode-specific chunking rules.

### 8.3 OpenAI provider profile

Add:

```text
.pi/extensions/pi-realtime/providers/openai/model-profiles.ts
```

```ts
export const OPENAI_REALTIME_MODELS = ["gpt-realtime-mini", "gpt-realtime-2"] as const;

export function openAIBehaviorProfileForModel(model: string): RealtimeBehaviorProfileFragment {
	if (model === "gpt-realtime-mini") return {
		backendUpdateSpeech: {
			chunking: { enabled: true, maxChars: 800, splitStrategy: "sentence" },
		},
	};
	return {};
}
```

Initial interpretation:

- `gpt-realtime-mini`: chunking enabled because live evidence showed long payload summarization.
- `gpt-realtime-2`: default profile, chunking disabled until live evidence says otherwise.
- unknown model: default profile, chunking disabled unless later added.

Wire through OpenAI provider runtime:

```ts
availableModels() { return OPENAI_REALTIME_MODELS; }
behaviorProfileForModel: openAIBehaviorProfileForModel,
```

## 9. Sentence-aware chunking design

Add:

```text
.pi/extensions/pi-realtime/domain/speech-chunking.ts
```

Public API:

```ts
export type SpeechChunk = {
	text: string;
	index: number;
	count: number;
	originalTextLength: number;
};

export function chunkBackendUpdateSpeech(input: {
	text: string;
	policy: BackendUpdateSpeechChunkingPolicy;
}): SpeechChunk[];
```

Rules:

1. Use the already-trimmed text from `pushRealtimeContext(...)`.
2. If disabled or `text.length <= maxChars`, return one chunk.
3. Split by fenced code/log-ish blocks, blank-line paragraphs, and list items first.
4. For prose paragraphs, split by sentence boundaries using protected-token handling; do not use a naive `text.split(".")`.
5. Protect common technical punctuation before sentence splitting, including decimals, versions, file extensions, file paths, URLs, common abbreviations such as `e.g.`/`i.e.`/`vs.`/`approx.`, and dollar/usage values such as `$0.079741`.
6. Pack as many complete units as fit under `maxChars`.
7. Enforce `maxChars` for non-sentence content too. If a block or unit exceeds `maxChars`, split by line boundaries, then syntax delimiters such as semicolon/comma where safe, then hard character split as last resort.
8. Preserve text order and content. No summary, rewrite, or dropped text.
9. Do not add spoken labels like “part 1 of N.” Chunk metadata is trace-only.

Important invariant:

```text
normalize(join(chunks)) === normalize(original)
```

The normalization should be minimal: trim outer whitespace and normalize chunk join separators only.

## 10. Push request metadata

Extend provider push request:

```ts
export type RealtimeContextPushChunk = {
	index: number;
	count: number;
	originalTextLength: number;
};

export type RealtimeContextPushRequest = {
	text: string;
	mode: RealtimePushMode;
	source: RealtimePushSource;
	kind: RealtimeUpdateKind;
	summary?: string;
	chunk?: RealtimeContextPushChunk;
};
```

Contract:

- `text` is the exact text for this speech response or chunk;
- `chunk` is metadata for trace/debug only;
- provider adapters must not make chunk metadata speakable;
- OpenAI response payloads continue to wrap only `text` in `<speak_this_verbatim>`.

## 11. Service orchestration

Update `pushRealtimeContext(...)` after target/live checks:

```ts
const session = this.requireSession(providerSessionId);
const runtime = this.requireProviderRuntime(session.provider);
const profile = resolveRealtimeBehaviorProfile({
	providerProfile: runtime.behaviorProfileForModel?.(session.model),
	interactionMode: session.interactionMode,
});
const chunks = speechChunksForPush({ push: input, text, profile });

for (const chunk of chunks) {
	const receipt = await adapter.pushContext(chunkRequest(input, chunk));
	this.traceRealtimePushChunk({ input, providerSessionId, text, chunk, receipt });
}
```

Eligibility helper:

```ts
function shouldChunkPush(input: RealtimeContextPushInput, profile: RealtimeBehaviorProfile): boolean {
	return input.mode === "request_spoken_response"
		&& input.kind === "text"
		&& profile.backendUpdateSpeech.chunking.enabled;
}
```

Only `text` backend updates are chunked initially. `ack` and `status` should remain short by convention.

Return messages:

- one chunk: preserve existing behavior as much as possible;
- multiple chunks: return a compact message like:

```text
backend update queued as 4 speech chunks (openai_...).
```

The custom `realtime_send_*` tool renderer should continue to show the original full payload sent by the model, not individual chunks.

## 12. Failure handling

If a later chunk fails after earlier chunks were queued:

- trace every successful chunk before the failure;
- throw or return a clear failure including failed chunk index and total chunk count;
- do not automatically replay earlier chunks;
- do not silently continue after a failed chunk.

Rationale: duplicate spoken chunks are worse than a visible partial-delivery failure.

If barge-in happens during a queued chunk burst, initial implementation relies on live-tested provider behavior. If provider semantics do not cancel queued chunks on interruption, the follow-up sequencing/cancellation policy described in section 13.3 becomes required.

## 13. Provider behavior

### 13.1 OpenAI raw and WebRTC adapters

Both raw OpenAI and WebRTC bridge adapters already consume `RealtimeContextPushRequest`. They should receive one request per chunk and continue using the existing response creation path:

```text
backendUpdateResponseEvent(input, interaction, outputModalities)
```

`providers/openai/responses.ts` remains responsible for OpenAI-specific SDK event shape. It should not decide whether to chunk.

### 13.2 Envelope

Each chunk is wrapped independently:

```text
<backend_update kind="text" source="pi_model_tool">
<speak_this_verbatim>
chunk text
</speak_this_verbatim>
</backend_update>
```

Per-response instructions continue to say:

- speak only text inside `<speak_this_verbatim>`;
- do not speak tags, metadata, or instructions;
- do not summarize ever.

### 13.3 Queueing and barge-in

Initial implementation queues chunks in order through repeated `adapter.pushContext(...)` calls. This relies on observed WebRTC behavior that queued backend speech updates play in order. That observation is enough to avoid assuming a sequencing bug up front, but it is not enough to prove multi-chunk burst behavior or interruption behavior.

Required live tests:

- burst queueing: send a long update that creates several chunks and verify the chunks play in order without overlap or dropped output;
- barge-in during queued chunks: speak while chunk 2 or later is playing and verify whether queued future chunks are cancelled, suppressed, or still spoken.

If live testing shows overlap, dropped chunks, or queued chunks continuing after user barge-in, add a follow-up sequencing/cancellation policy before shipping broadly:

```ts
backendUpdateSpeech: {
	chunking: ...,
	sequencing: "enqueue" | "wait_for_response_done",
	cancelPendingOnSpeechStarted: boolean,
}
```

Potential implementation for that follow-up would keep a per-provider-session pending speech sequence owned by service or adapter, clear unsent chunks on `turn_signal: "speech_started"`, and only send the next chunk after `turn_complete` for the previous one. Do not implement this extra coordinator until live evidence requires it.

## 14. Cost and token trade-off

Chunking increases the number of independent `response.create` calls for a long backend update. In eco isolated-update mode, each chunk repeats per-response instructions and the small backend-update envelope, so input text tokens scale roughly with chunk count.

This is acceptable for the first implementation because the repeated overhead is text input, not audio output. The expensive failure mode we are avoiding is long audio generation that summarizes, invents, or requires repeated correction. Still, the design should keep chunk count reasonable:

- use the largest `maxChars` that live testing shows is reliable;
- chunk only `kind: "text"` backend updates initially;
- keep `ack` and `status` short and unchunked by convention;
- record usage before/after live tests so the cost trade-off remains visible.

If later usage shows chunking overhead is material, tune the profile's `maxChars` per model rather than disabling the provider-neutral abstraction.

## 15. Validation plan

### 15.1 Deterministic probes

Add `.ai/validation/pi-realtime-model-switching-probe.mjs`:

- `ProviderPreferences` supports `defaultModel`;
- OpenAI runtime exposes `availableModels()` with `gpt-realtime-mini` and `gpt-realtime-2`;
- `defaultModelFor("openai")` honors persisted override;
- invalid model is rejected;
- start command uses default model when `--model` is absent;
- explicit `--model` still wins.

Add `.ai/validation/pi-realtime-speech-chunking-probe.mjs`:

- short text returns one chunk;
- complete sentences are packed under `maxChars`;
- bullets and paragraphs remain ordered;
- protected technical tokens are not split incorrectly, including `v0.1.0`, `.pi/extensions/foo.ts`, `e.g.`, `i.e.`, `src/main.ts`, and `$0.079741`;
- logs, stack-trace-like lines, JSON-ish blocks, and no-period text still respect `maxChars` through line/syntax/hard-split fallback;
- one overlong sentence falls back without dropping text;
- joining chunks recreates normalized original;
- fake provider receives multiple chunked `pushedContexts` in order;
- `gpt-realtime-mini` profile enables chunking;
- `gpt-realtime-2` profile/default disables chunking;
- service source has no `model === "gpt-realtime-mini"` checks.

Update existing probes:

- context-push probe asserts optional chunk metadata;
- interaction/profile probe asserts behavior profile resolver and provider runtime hook;
- state probe asserts default model preference replay if added to `RealtimeConfig` typing.

### 15.2 Gates

Run:

```bash
npm run gates:typecheck
npm run gates:validation
npm run gates:quality
```

Do not use `sentrux gate --save` to bypass failures. If structure fails, remediate code until the existing baseline passes.

### 15.3 Live proof

1. Set model to mini:

```text
/realtime openai model gpt-realtime-mini
/realtime openai start --mode eco
```

2. Send the previously failing long architecture/style payload.
3. Verify trace:
   - service emitted N chunk traces;
   - helper outbox received N ordered `response.create` events;
   - spoken transcript contains all chunks in order;
   - no summary tail;
   - no spoken tags/metadata.
4. Live-test barge-in during a multi-chunk response. Speak during chunk 2 or later and verify whether queued future chunks continue speaking. This behavior is not assumed; it requires live evidence. If future chunks continue after barge-in, add a follow-up design for sequence cancellation or provider-level response sequencing before shipping chunking broadly.
5. Set model to realtime-2:

```text
/realtime openai model gpt-realtime-2
/realtime openai start --mode eco
```

6. Verify the session model is `gpt-realtime-2` and profile does not chunk unless later configured.

## 16. Precise implementation path sequence

Implement in this exact order. Do not start the next phase until the stated local validation for the current phase passes.

### Phase 0 — preflight and baseline

1. Inspect current worktree with `git status --short` and avoid overwriting unrelated user changes.
2. Re-read this design section and the project architecture/code style guides.
3. Run the current deterministic baseline:
   ```bash
   npm run gates:typecheck
   npm run gates:validation
   ```
4. If baseline fails before edits, stop and investigate before implementing.

### Phase A — prerequisite OpenAI model switching

1. Update `.pi/extensions/pi-realtime/types.ts`:
   - extend `ProviderPreferences` with `defaultModel?: string`.
2. Update `.pi/extensions/pi-realtime/providers/runtime-types.ts`:
   - add `availableModels?(): readonly string[]` to `ProviderRuntime`.
3. Add `.pi/extensions/pi-realtime/providers/openai/model-profiles.ts` with:
   - `OPENAI_REALTIME_MODELS = ["gpt-realtime-mini", "gpt-realtime-2"] as const`.
4. Update `.pi/extensions/pi-realtime/providers/openai/runtime.ts`:
   - import `OPENAI_REALTIME_MODELS`;
   - expose `availableModels() { return OPENAI_REALTIME_MODELS; }`.
5. Update `.pi/extensions/pi-realtime/service.ts` service type and class:
   - make `defaultModelFor(provider)` return `providerPreference(provider).defaultModel ?? runtime.defaultModel()`;
   - add `availableModelsFor(provider)`;
   - add `setDefaultModel(provider, model)` that validates against `availableModelsFor`, preserves existing provider preferences, appends `configChanged`, and returns a concise confirmation.
6. Update `.pi/extensions/pi-realtime/commands.ts`:
   - add `/realtime openai model [model]` dispatch before active-session-only OpenAI subcommands;
   - no arg shows current default and allowed models;
   - valid arg persists default;
   - invalid arg reports allowed models;
   - update completions and help text.
7. Update deterministic validation:
   - add or extend a probe to assert `defaultModel` preference typing, OpenAI available models, service default override behavior, invalid model rejection, command help/completion, and `--model` precedence.
8. Run:
   ```bash
   npm run gates:typecheck
   npm run gates:validation
   ```
9. Fix failures before Phase B.

### Phase B — provider-owned behavior profiles

1. Update `.pi/extensions/pi-realtime/types.ts` with:
   - `SpeechChunkSplitStrategy`;
   - `BackendUpdateSpeechChunkingPolicy`;
   - `BackendUpdateSpeechPolicy`;
   - `RealtimeBehaviorProfile`;
   - `RealtimeBehaviorProfileFragment`.
2. Add `.pi/extensions/pi-realtime/domain/behavior-profiles.ts`:
   - define `DEFAULT_BEHAVIOR_PROFILE` with chunking disabled;
   - export `resolveRealtimeBehaviorProfile({ providerProfile, interactionMode })`;
   - merge nested fragment fields explicitly so returned profiles are complete.
3. Update `.pi/extensions/pi-realtime/providers/runtime-types.ts`:
   - add `behaviorProfileForModel?(model: string): RealtimeBehaviorProfileFragment` to `ProviderRuntime`.
4. Update `.pi/extensions/pi-realtime/providers/openai/model-profiles.ts`:
   - add `openAIBehaviorProfileForModel(model)`;
   - return chunking enabled with `maxChars: 800` for `gpt-realtime-mini`;
   - return `{}` for `gpt-realtime-2` and unknown models.
5. Update `.pi/extensions/pi-realtime/providers/openai/runtime.ts`:
   - expose `behaviorProfileForModel: openAIBehaviorProfileForModel`.
6. Update validation:
   - assert provider runtime hook exists;
   - assert mini profile enables chunking;
   - assert realtime-2/default profile disables chunking;
   - assert service source does not contain model-specific checks.
7. Run:
   ```bash
   npm run gates:typecheck
   npm run gates:validation
   ```
8. Fix failures before Phase C.

### Phase C — sentence-aware chunking domain module

1. Add `.pi/extensions/pi-realtime/domain/speech-chunking.ts`.
2. Implement `chunkBackendUpdateSpeech({ text, policy })` and `SpeechChunk`.
3. Implement unit extraction in this order:
   - fenced code/log-ish blocks;
   - blank-line paragraphs;
   - list/bullet lines;
   - prose sentence units with protected technical punctuation.
4. Protect technical punctuation before sentence splitting:
   - decimals and dollar values such as `$0.079741`;
   - versions such as `v0.1.0`;
   - file paths and file extensions such as `.pi/extensions/foo.ts` and `src/main.ts`;
   - URLs;
   - common abbreviations such as `e.g.`, `i.e.`, `vs.`, `approx.`.
5. Enforce `maxChars` for every chunk:
   - pack complete units under max;
   - split overlong units by line boundaries;
   - then syntax delimiters such as semicolon/comma where safe;
   - then hard character split as last resort.
6. Preserve invariants:
   - no empty chunks;
   - 1-based `index`;
   - accurate `count`;
   - all chunks carry `originalTextLength`;
   - minimal-normalized join equals minimal-normalized original.
7. Add `.ai/validation/pi-realtime-speech-chunking-probe.mjs` for chunker-only cases.
8. Run:
   ```bash
   npm run gates:typecheck
   npm run gates:validation
   ```
9. Fix failures before Phase D.

### Phase D — service chunk fan-out

1. Update `.pi/extensions/pi-realtime/providers/types.ts`:
   - add `RealtimeContextPushChunk` metadata type or import it from shared types;
   - add optional `chunk?: RealtimeContextPushChunk` to `RealtimeContextPushRequest`.
2. Update `.pi/extensions/pi-realtime/service.ts`:
   - after provider target/live lookup, resolve the target session;
   - get provider runtime;
   - resolve behavior profile from `runtime.behaviorProfileForModel?.(session.model)`;
   - chunk only when `input.mode === "request_spoken_response"`, `input.kind === "text"`, and profile chunking is enabled;
   - call `adapter.pushContext(...)` once per chunk, in order;
   - preserve existing single-push behavior for unchunked updates.
3. Add small private helpers in `service.ts` or a focused domain helper:
   - `shouldChunkPush(...)`;
   - `speechChunksForPush(...)`;
   - `chunkRequest(...)`;
   - `renderChunkedPushResult(...)`.
4. Add service trace fields for every chunk:
   - `originalTextLength`;
   - `chunkIndex`;
   - `chunkCount`;
   - per-chunk `textLength`;
   - `receiptStatus`.
5. Failure behavior:
   - if chunk N fails after earlier chunks were queued, trace successes and throw/return a clear failed chunk message;
   - do not replay earlier chunks automatically.
6. Update fake-provider validation to verify multiple `pushedContexts` arrive in order for mini-profile chunked text.
7. Run:
   ```bash
   npm run gates:typecheck
   npm run gates:validation
   ```
8. Fix failures before Phase E.

### Phase E — provider trace visibility and non-speakable metadata

1. Update OpenAI raw and WebRTC trace records only if needed to include chunk metadata.
2. Confirm `providers/openai/responses.ts` still wraps only `input.text` in `<speak_this_verbatim>`.
3. Confirm chunk metadata is not included in `renderRealtimeUpdateEnvelope(...)` speakable text.
4. Update context-push validation to assert:
   - optional chunk metadata exists;
   - OpenAI response path still uses `renderRealtimeUpdateEnvelope`;
   - `conversation: "none"` remains for isolated updates;
   - no chunk metadata is rendered inside `<speak_this_verbatim>`.
5. Run:
   ```bash
   npm run gates:typecheck
   npm run gates:validation
   ```
6. Fix failures before Phase F.

### Phase F — full local quality

1. Run:
   ```bash
   npm run gates:quality
   ```
2. If Sentrux fails, remediate structure. Do not run `sentrux gate --save`.
3. If deslop fails, review semantically and fix real issues.
4. If validation fails, fix behavior or probe assumptions.
5. Do not proceed to live testing until the hard gate passes.

### Phase G — live OpenAI/WebRTC proof

1. Start a fresh eco WebRTC session using mini:
   ```text
   /realtime openai model gpt-realtime-mini
   /realtime openai start --mode eco
   ```
2. Send the known failing long architecture/style payload.
3. Verify trace evidence:
   - service emitted N chunk traces;
   - helper outbox received N ordered `response.create` events;
   - spoken transcript contains chunks in order;
   - no summary tail;
   - no spoken tags or metadata.
4. Live-test burst queueing specifically:
   - ensure chunks sent as one fan-out are spoken in order;
   - record whether any overlap, drop, or reorder occurs.
5. Live-test barge-in during chunk 2 or later:
   - speak while a chunked response is playing;
   - record whether queued future chunks stop or continue;
   - if future chunks continue, do not claim implementation complete for broad use; create follow-up sequencing/cancellation design.
6. Test model switching:
   ```text
   /realtime openai model gpt-realtime-2
   /realtime openai start --mode eco
   ```
   Verify the new session uses `gpt-realtime-2` and does not chunk by default.
7. Record live evidence under `.ai/validation/live-probe/` or the current proof note.

### Phase H — closeout

1. Update this design doc with implementation deviations and live findings.
2. Update README if the slash command is user-facing enough to document.
3. Run final:
   ```bash
   npm run gates:quality
   ```
4. Review worktree diff for unrelated changes.
5. Commit tracked implementation and validation changes if requested by the active workflow.

## 17. Open design decisions closed

- **Where do model names live?** Provider-owned model profile/runtime modules, not service/domain.
- **Does chunking belong to eco mode?** No. It belongs to backend-update speech model behavior.
- **Does model switching hot-swap live sessions?** No. It sets provider default for future sessions; explicit `--model` still wins.
- **Do we add user chunk config now?** No. Start with provider/model profile values.
- **Do chunks get audible labels?** No. Metadata is trace-only.
- **Do we sequence on `response.done` now?** No. Queue in order first; live-test burst order and barge-in cancellation. Add sequencing/cancellation only if evidence shows queued chunks overlap, drop, or continue after interruption.
- **Do prompt/instruction variants go into the profile now?** No. The profile is broad enough to grow, but first implementation only adds chunking.

## 18. Architecture and code-style audit

- **Encapsulated**: model lists and model-specific profile fragments live under provider runtime/profile files.
- **Provider-neutral**: service consumes `RealtimeBehaviorProfile`; domain chunking is plain text logic.
- **Decoupled**: model switching and chunking use provider runtime/profile hooks instead of scattered identity checks.
- **Testable**: model switching, profile resolution, and chunking can be probed deterministically with fake provider and static source checks.
- **Stateful where needed**: default model choice persists through existing config replay; behavior profile derives from persisted session model.
- **No provider payload leakage**: OpenAI event shape remains under `providers/openai/responses.ts`.
- **No browser semantics leakage**: browser helper remains unaware of model profiles or chunking.
- **No prompt-only fix**: chunking is a structural mitigation for a live model behavior failure; prompts remain secondary.

## 19. Completion criteria

Implementation is complete when:

- `/realtime openai model` shows current/allowed OpenAI realtime models;
- `/realtime openai model gpt-realtime-mini` and `gpt-realtime-2` persist default model choices;
- new OpenAI sessions use the persisted default when `--model` is absent;
- explicit `--model` overrides persisted default;
- behavior profiles are resolved through provider runtime hooks;
- `gpt-realtime-mini` long text backend updates are sentence-chunked;
- `gpt-realtime-2` does not chunk by default;
- deterministic probes cover model switching, profile resolution, and chunking;
- `npm run gates:quality` passes without baseline bypass;
- live testing records whether chunking improves long-payload literal speech;
- live testing records burst queue ordering and barge-in behavior for multi-chunk responses.

## 20. Implementation ledger

### Phase 0 — preflight and baseline

Interrogate:

1. Is the worktree safe to modify? Yes. The dirty-worktree-cleanup snapshot commands returned no staged, unstaged, or untracked tracked-file work.
2. Which document is authoritative for this implementation? `/Users/bryan/dev/personal/experiments/pi-realtime/.ai/docs/realtime-voice/design-model-speech-profile-chunking.md` is the current design/spec/ledger document.
3. Which baseline gates are required before edits? Phase 0 requires `npm run gates:typecheck` and `npm run gates:validation` before implementation; both passed.
4. Which project constraints dominate the implementation? Provider-specific model identity stays under `providers/openai/`; service consumes provider-neutral behavior/profile values; domain modules stay pure; provider/WebRTC live semantics require live evidence.
5. How should ignored `.ai/docs` ledger changes be handled? The active instruction explicitly requires the ledger in this current design doc and stage/commit after verified iterations, so this specific design doc is eligible for force-staging while avoiding unrelated `.ai/docs` files.

Progress notes and unexpected outcomes:

- Removed the mistakenly appended ledger section from `design-eco-mode.md` before restarting the goal.
- Cleared the previous goal and created a new goal whose objective points to this current design doc.
- Re-read the implementation path sequence and re-ran the local deterministic baseline.
- Baseline passed without remediation.

Deviations or trade-offs:

- No implementation deviation. The only operational adjustment is force-staging this ignored design doc because the user explicitly made it the active ledger and commit artifact.

Remaining risks or concerns:

- None for Phase 0. Later phases still require code implementation, phase gates, full quality, and live OpenAI/WebRTC proof for queueing and barge-in semantics.

Validation:

- `npm run gates:typecheck` passed.
- `npm run gates:validation` passed.

CLEAN IMPLEMENTATION.

### Phase A — prerequisite OpenAI model switching

Interrogate:

1. Where should OpenAI model names live? In `providers/openai/model-profiles.ts`, not in service/domain, so core code consumes runtime capabilities instead of model-name branches.
2. How should a persisted default model survive replay and coexist with existing media preferences? Store it as `ProviderPreferences.defaultModel`; `setDefaultModel` preserves the existing provider preference object while replacing only `defaultModel`.
3. How should invalid models be handled? `setDefaultModel` validates against `runtime.availableModels?.()` and throws a clear allowed-model error; the command catches and renders it as a warning.
4. How does explicit `--model` precedence remain intact? Start commands still compute `valueAfter(tokens, "--model") ?? service.defaultModelFor(provider)`, so explicit flags override persisted defaults.
5. How can this be validated without live OpenAI access? A deterministic probe checks types, runtime capabilities, command surface, validation path, persisted preference shape, and start-command precedence by source contract.

Progress notes and unexpected outcomes:

- Added `defaultModel?: string` to `ProviderPreferences`.
- Added `availableModels?()` to `ProviderRuntime`.
- Added `providers/openai/model-profiles.ts` with the OpenAI realtime model list.
- Exposed OpenAI runtime `availableModels()`.
- Updated service default model resolution, available-model listing, and default-model persistence.
- Added `/realtime openai model [model]` command behavior, completions, and help text.
- Added `.ai/validation/pi-realtime-model-switching-probe.mjs`.
- No unexpected type or validation failures occurred.

Deviations or trade-offs:

- The model switching probe is source-contract based, matching the existing validation style in this repo. It avoids requiring live OpenAI credentials or a Pi TUI command harness for this phase.
- `availableModelsFor` falls back to the runtime default when a provider does not expose a model list. This keeps the provider-neutral service method total while OpenAI remains the only user-facing model-switch command.

Remaining risks or concerns:

- This phase does not live-test `gpt-realtime-2` availability. Live proof remains Phase G.
- Generic `/realtime start --provider openai --model <id>` still permits explicit model ids outside the persisted default list; this preserves the existing debug/override behavior and only constrains the persisted slash-command default.

Validation:

- `npm run gates:typecheck` passed.
- `node .ai/validation/pi-realtime-model-switching-probe.mjs` passed.
- `npm run gates:validation` passed.
- Targeted deslop scan found no `as any`, `as unknown as`, `TODO`, `FIXME`, or service-level `model === "gpt-realtime-mini"` checks.

Review:

- Provider-specific model identity is isolated under the OpenAI provider edge.
- Service exposes provider-neutral capability/preference operations.
- Command parsing remains a thin user-facing layer over service methods.

CLEAN IMPLEMENTATION.

### Phase B — provider-owned behavior profiles

Interrogate:

1. Where should behavior-profile defaults live? In a pure domain helper, `domain/behavior-profiles.ts`, so service can later resolve complete behavior values without knowing provider model ids.
2. Where should model-specific profile fragments live? Under `providers/openai/model-profiles.ts`, alongside the OpenAI model list, because `gpt-realtime-mini` and `gpt-realtime-2` are provider-specific identities.
3. How should the provider runtime expose profile behavior? Through optional `behaviorProfileForModel?(model)` on `ProviderRuntime`, matching the existing runtime capability pattern.
4. What should `gpt-realtime-2` do initially? Return the default empty fragment, leaving chunking disabled until live evidence says otherwise.
5. How do we prevent service-level model branching? Validation asserts service does not contain `model === "gpt-realtime-mini"`; only the OpenAI provider profile module contains the model-specific branch.

Progress notes and unexpected outcomes:

- Added behavior profile and fragment types to `types.ts`.
- Added `domain/behavior-profiles.ts` with disabled default chunking and explicit nested fragment merge.
- Added `behaviorProfileForModel?` to `ProviderRuntime`.
- Extended OpenAI model profiles so mini enables sentence chunking at `maxChars: 800`; realtime-2 and unknown models use defaults.
- Wired the OpenAI runtime profile hook.
- Extended the model switching/profile validation probe.
- Removed an unnecessary unused-property marker during review; the resolver keeps `interactionMode` in its input contract for future mode-specific profile layering without adding current mode-specific behavior.

Deviations or trade-offs:

- The default resolver accepts `interactionMode` but does not use it yet. This is intentional because the current design reserves mode-specific profile layering for future behavior while keeping the initial implementation model/provider-driven.
- Profile validation remains deterministic and source-contract based; live model behavior is deferred to Phase G.

Remaining risks or concerns:

- Behavior profiles are not consumed by service until Phase D.
- Mini's `maxChars: 800` is an initial mitigation value and must be live-tuned if evidence shows it is too high or unnecessarily low.

Validation:

- `npm run gates:typecheck` passed.
- `node .ai/validation/pi-realtime-model-switching-probe.mjs` passed.
- `npm run gates:validation` passed.
- Targeted scan found no `as any`, `as unknown as`, `TODO`, or `FIXME` in the touched profile/runtime files.

Review:

- Provider-specific identity remains isolated at the provider edge.
- Domain profile resolution is pure and provider-neutral.
- No service/domain OpenAI SDK or model-name leakage was introduced.

CLEAN IMPLEMENTATION.
