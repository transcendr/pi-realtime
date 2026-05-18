# Provider Abstraction Refactor Plan

## Trigger

The current realtime extension grew provider-specific command and service methods while debugging OpenAI WebRTC behavior. The immediate symptom called out in review was the bloaty pattern of names such as `startOpenAI`, `stopOpenAI`, `setOpenAIWebRTCEnabled`, and `isOpenAIWebRTCEnabled` in generic command/service code.

This plan removes that pattern by making provider-specific behavior a swappable provider runtime abstraction instead of hard-coded methods in the core service and command layer.

## Problems to fix

1. **Provider-specific method sprawl in generic surfaces**
   - `Service` exposes OpenAI/WebRTC-specific methods even though the service is supposed to coordinate generic realtime sessions.
   - Command handlers encode OpenAI as special flow control instead of routing generic provider intents.

2. **Provider-specific config shape**
   - `RealtimeConfig.openaiWebRTCEnabled` does not scale to future providers or media modes.
   - Adding Gemini/WebRTC/SIP/browser-specific toggles would require more bespoke booleans and methods.

3. **Media lifecycle is not abstracted**
   - Raw mic/playback and browser WebRTC helper are controlled by separate service methods.
   - Provider adapters have `mediaMode`, but there is no first-class media runtime that owns start/stop/status/auto-launch behavior.

4. **Provider factory logic is hard-coded**
   - `startSession()` branches on `input.provider === "fake"` and `input.provider === "openai"`.
   - Adding a provider requires modifying core service imports and branch logic.

5. **Command parsing mixes routing, provider semantics, and lifecycle policy**
   - `/realtime openai` command handlers know how to choose model, stop sessions, and launch WebRTC.
   - This makes new providers likely to copy/paste command blocks.

## Target design

### Core concepts

Introduce provider-neutral primitives:

```ts
type ProviderRuntime = {
  kind: ProviderKind;
  defaultModel(): string;
  credentials(): ProviderCredentialStatus;
  createAdapter(input: ProviderAdapterCreateInput): RealtimeProviderAdapter;
  media?: ProviderMediaRuntime;
};

type ProviderMediaRuntime = {
  modes(): ProviderMediaMode[];
  defaultMode(config: RealtimeConfig): ProviderMediaMode;
  start(input: ProviderMediaStartInput): Promise<ProviderMediaStartResult>;
  stop(input: ProviderMediaStopInput): Promise<void>;
  status(input: ProviderMediaStatusInput): string;
};
```

Core service should depend on a `ProviderRuntimeRegistry`, not individual OpenAI modules.

```ts
type ProviderRuntimeRegistry = {
  get(provider: ProviderKind): ProviderRuntime | undefined;
  list(): ProviderRuntime[];
};
```

### Config shape

Replace provider-specific booleans with provider-scoped preferences:

```ts
type RealtimeConfig = {
  primaryProviderSessionId: ProviderSessionId | null;
  defaultProvider: ProviderKind;
  defaultPersonaId: string;
  providerPreferences: Partial<Record<ProviderKind, ProviderPreferences>>;
};

type ProviderPreferences = {
  autoMediaMode?: ProviderMediaMode;
};

type ProviderMediaMode = "raw" | "webrtc" | "none";
```

For the current OpenAI behavior:

```ts
providerPreferences.openai.autoMediaMode = "webrtc" // equivalent to current WebRTC on
providerPreferences.openai.autoMediaMode = "none"   // equivalent to current WebRTC off
```

### Service API target

Replace explicit OpenAI/WebRTC methods with generic operations:

```ts
type Service = {
  startSession(input: StartSessionInput, ctx: ExtensionContext): Promise<ProviderSessionId>;
  stopSession(providerSessionId: ProviderSessionId, reason?: string): Promise<void>;
  toggleProvider(provider: ProviderKind, ctx: ExtensionContext, input?: ToggleProviderInput): Promise<ToggleProviderResult>;

  updateProviderPreference(provider: ProviderKind, patch: Partial<ProviderPreferences>): string;
  providerPreference(provider: ProviderKind): ProviderPreferences;

  startSessionMedia(providerSessionId: ProviderSessionId, mode?: ProviderMediaMode, ctx?: ExtensionContext): Promise<string>;
  stopSessionMedia(providerSessionId?: ProviderSessionId): Promise<void>;
  mediaStatus(providerSessionId?: ProviderSessionId): string;
};
```

Remove from `Service`:

```ts
setOpenAIWebRTCEnabled
isOpenAIWebRTCEnabled
startWebRTCHelper
stopWebRTCHelper
webRTCHelperStatus
rawEchoWarningText // replace with provider/media warning from runtime
```

If backward command compatibility is needed, keep `/realtime openai webrtc start|stop|status` but route it through generic media operations.

### Command layer target

Command layer should parse intent and call generic service primitives:

```ts
/realtime webrtc on|off
```

becomes:

```ts
service.updateProviderPreference("openai", { autoMediaMode: mode === "on" ? "webrtc" : "none" })
```

```ts
/realtime openai [start|stop]
```

becomes:

```ts
service.toggleProvider("openai", ctx, parsedStartOptions)
```

Provider-specific command spelling may remain as user ergonomics, but it must not create provider-specific service methods.

## Implementation sequence

### Phase 1 — Introduce provider runtime registry

Files:
- `.pi/extensions/pi-realtime/providers/runtime.ts` (new)
- `.pi/extensions/pi-realtime/providers/fake-runtime.ts` (new or folded into fake adapter module cleanly)
- `.pi/extensions/pi-realtime/providers/openai-runtime.ts` (new)
- `.pi/extensions/pi-realtime/service.ts`

Steps:
1. Add `ProviderRuntime`, `ProviderRuntimeRegistry`, and related input/result types.
2. Implement a registry with current fake and OpenAI runtimes.
3. Move OpenAI adapter creation and credential check behind `openaiRuntime.createAdapter()`.
4. Move fake adapter creation behind `fakeRuntime.createAdapter()`.
5. Replace `if provider === ...` adapter creation in `startSession()` with registry lookup.
6. Keep fake adapter test helpers in service only if needed by validation, but isolate them as test/simulation helpers rather than provider lifecycle.

Acceptance:
- `service.ts` no longer imports `createOpenAIRealtimeProvider`, `hasOpenAIRealtimeCredentials`, `createOpenAIWebRTCBridgeAdapter`, or OpenAI WebRTC client secret helpers directly.
- Adding a new provider requires registering a runtime, not modifying core start branching.

### Phase 2 — Generalize provider preferences

Files:
- `.pi/extensions/pi-realtime/types.ts`
- `.pi/extensions/pi-realtime/events.ts`
- `.pi/extensions/pi-realtime/service.ts`
- validation probes

Steps:
1. Replace `openaiWebRTCEnabled` with `providerPreferences`.
2. Add helpers such as `providerPreference(state, provider)` and `withProviderPreferencePatch()` if useful.
3. Preserve replay compatibility: if older `config_changed` events contain `openaiWebRTCEnabled`, normalize/apply them into `providerPreferences.openai.autoMediaMode` during replay.
4. Update commands and probes.

Acceptance:
- No `openaiWebRTCEnabled` in public/core config type after compatibility handling is in place.
- Preference access is provider-keyed and extensible.

### Phase 3 — Abstract media runtime

Files:
- `.pi/extensions/pi-realtime/media/runtime.ts` (new if useful)
- `.pi/extensions/pi-realtime/providers/openai-runtime.ts`
- `.pi/extensions/pi-realtime/service.ts`
- `.pi/extensions/pi-realtime/media/webrtc-helper/*`

Steps:
1. Define `ProviderMediaRuntime` operations for start/stop/status.
2. Move OpenAI WebRTC helper construction, client secret creation, Chrome-preferred opening, and debug trace creation behind OpenAI media runtime.
3. Replace service `startWebRTCHelper`, `stopWebRTCHelper`, and `webRTCHelperStatus` with generic `startSessionMedia`, `stopSessionMedia`, `mediaStatus`.
4. Keep raw mic/playback as generic media utilities or a `raw` media runtime if feasible without broad churn.

Acceptance:
- Core service does not know OpenAI WebRTC client secret details.
- Core service does not mention Chrome, WebRTC helper server internals, or OpenAI media construction.
- `/realtime openai webrtc start|stop|status` still works through the generic media API.

### Phase 4 — Generic provider command routing

Files:
- `.pi/extensions/pi-realtime/commands.ts`
- optional `.pi/extensions/pi-realtime/command-intents.ts` (new)

Steps:
1. Introduce command intent helpers:
   - `parseProviderToggleIntent()`
   - `parseProviderMediaPreferenceIntent()`
   - `parseProviderMediaCommandIntent()`
2. Replace `startOpenAI` / `stopOpenAI` with provider-neutral helpers:
   - `toggleProvider("openai", ...)`
   - `startProvider("openai", ...)`
   - `stopProvider("openai", ...)`
3. Keep command strings user-friendly while keeping implementation generic.
4. Ensure `/realtime openai` still toggles and `/realtime openai start|stop` still works.

Acceptance:
- No `startOpenAI` or `stopOpenAI` functions.
- OpenAI is passed as data to generic command helpers rather than encoded in helper names.

### Phase 5 — Tests and quality gates

Update probes to assert against the anti-pattern explicitly:

- `service.ts` must not contain:
  - `setOpenAIWebRTCEnabled`
  - `isOpenAIWebRTCEnabled`
  - `startOpenAI`
  - direct OpenAI WebRTC runtime imports
- provider-specific behavior must appear under provider runtime modules.
- commands may contain `/realtime openai` strings but should route through generic helper names.

Run:

```bash
npm run gates:quality
```

Also run a live smoke if feasible:

```text
/realtime webrtc on
/realtime openai
/realtime openai
/realtime usage reset
/realtime openai start
/realtime openai stop
```

## Non-goals

- Do not change OpenAI Realtime semantics, VAD, interruption, or barge-in behavior.
- Do not remove provider-specific adapter code; move it behind provider runtime boundaries.
- Do not make prompt-only mitigations for Safari feedback.
- Do not rewrite unrelated UI or usage estimation logic beyond the minimum needed to support provider preferences.

## Commit plan for execution

1. `refactor: add provider runtime registry`
   - provider runtime interfaces and fake/OpenAI adapter creation moved behind registry.
2. `refactor: generalize realtime provider preferences`
   - config migration from OpenAI-specific WebRTC boolean to provider preferences.
3. `refactor: move WebRTC helper behind media runtime`
   - generic media service APIs and OpenAI WebRTC media runtime.
4. `refactor: route provider commands through generic intents`
   - command handler cleanup and removal of `startOpenAI`/`stopOpenAI` helper pattern.
5. `test: guard realtime provider abstraction boundaries`
   - validation probes that catch service API bloat and provider-specific leakage.

If a phase is small, adjacent phase commits may be combined only if the staged diff remains coherent and reviewable.
