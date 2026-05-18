# Realtime Refactor Completion Goal Plan

## Objective

Complete the provider-abstraction refactor without turning the extension into a pile of generic controller files. The goal is a small, coherent Pi extension architecture where:

- provider-specific construction lives inside provider-owned modules;
- `service.ts` remains the domain mutation/application use-case boundary, not a dumping ground;
- local audio/process lifecycle and direct voice tool execution are no longer embedded in `service.ts`;
- existing realtime semantics, barge-in/interruption behavior, usage telemetry, and command compatibility are preserved.

## Current evidence

Checked current state on 2026-05-18:

- `service.ts` is 367 lines and mixes:
  - public command-facing service API;
  - adapter map and provider session lifecycle;
  - local microphone/playback process lifecycle;
  - provider media runtime bridging;
  - usage/debug/status rendering glue;
  - normalized provider event handling;
  - direct voice tool execution (`pi_send_instruction`, citation resolve/list, state snapshot);
  - fake-provider simulation helpers.
- `providers/runtime.ts` is 117 lines and still constructs OpenAI runtime details directly:
  - imports `createOpenAIRealtimeProvider` from `./openai`;
  - imports WebRTC bridge/client-secret helpers from `./openai/...`;
  - owns `createOpenAIProviderRuntime()` and `createOpenAIWebRTCMediaRuntime()`.
- Provider files are now nested under `providers/openai/`, which is good, but the shared runtime file still knows too much about OpenAI runtime construction.
- `commands.ts` still has user-facing OpenAI command spelling. That is acceptable as CLI ergonomics if it routes to generic service operations and does not create provider-specific service methods.

## Non-goals

- Do not alter OpenAI Realtime semantics, VAD, interruption, barge-in, WebRTC signaling, or microphone/playback behavior.
- Do not add prompt-only mitigations, cooldowns, mutes, or behavior restrictions.
- Do not invent a broad controller/dispatcher layer taxonomy.
- Do not split files merely to hit an arbitrary line count.
- Do not overwrite Sentrux baselines to hide regressions.

## Target module responsibilities

### `service.ts`

`service.ts` should remain the public application service and domain mutation boundary. It should coordinate use cases and append domain events, but delegate implementation details.

Keep in `service.ts`:

- public `Service` type and `createService()`;
- `refresh()`, `state()`, `toolSurface()`, `statusText()`;
- session use cases: `startSession()`, `stopSession()`, `setPrimary()`;
- provider preference use cases: `updateProviderPreference()`, `providerPreference()`;
- provider media use cases: `startSessionMedia()`, `stopSessionMedia()`, `mediaStatus()`;
- text/tool result use cases: `sendTextInput()`, `recordToolResult()`;
- normalized provider event entrypoint because it mutates store state;
- shutdown orchestration.

Move out of `service.ts`:

- OpenAI runtime construction: to `providers/openai/runtime.ts`.
- local microphone/playback process maps and status formatting: to `audio-manager.ts`, because it manages active per-session audio resources;
- direct voice tool implementation details: to `tools.ts`.

Do not move persistence/replay out of `events.ts`/`store.ts`; that already matches the Pi extension protocol.

### Provider runtime boundary

Target shape:

```text
providers/
  runtime.ts              # generic runtime interfaces + registry composition only
  fake.ts                 # fake adapter and optionally fake runtime factory
  openai/
    runtime.ts            # OpenAI runtime + OpenAI WebRTC media construction
    index.ts              # raw OpenAI adapter
    webrtc.ts             # ephemeral client secret helper
    webrtc-bridge.ts      # browser helper bridge adapter
    usage.ts
    shared.ts
```

`providers/runtime.ts` may mention provider names only as registry entries. It should not import OpenAI WebRTC bridge/client-secret helpers or define `createOpenAIWebRTCMediaRuntime()`.

Expected imports in shared `providers/runtime.ts` after refactor:

```ts
import { createFakeProviderRuntime } from "./fake";
import { createOpenAIProviderRuntime } from "./openai/runtime";
```

### Audio manager module

Add one focused module with a concrete ownership name:

```text
audio-manager.ts
```

Responsibility:

- manage active mic/playback resources per provider session;
- own `Map<ProviderSessionId, AudioCaptureController>`;
- own `Map<ProviderSessionId, AudioPlaybackController>`;
- start/stop microphone streaming through a supplied `RealtimeProviderAdapter`;
- start/stop audio playback through a supplied `RealtimeProviderAdapter`;
- render microphone/playback status;
- route provider audio chunks to active playback;
- clean up on errors/shutdown;
- surface errors through a small callback, not through direct Pi UI dependencies.

Relationship to existing files:

```text
audio.ts          # low-level mic capture primitive
playback.ts       # low-level playback primitive
audio-manager.ts  # owns active per-session audio resources
```

It may import `audio.ts` and `playback.ts`. It must not import provider SDKs or `ControlPlane`.

### Tools module

Use the canonical Pi extension module name:

```text
tools.ts
```

Responsibility:

- execute direct voice tools from `VoiceToolCallRecord`;
- implement `pi_wait_for_update`, `pi_realtime_status`, `pi_state_snapshot`, `pinotator_citations_list`, `pinotator_citation_resolve`, and `pi_send_instruction`;
- preserve the current empty-instruction rejection text;
- return result text only; let `service.ts` append/send `voiceToolResultSent()`.

It may depend on `ControlPlane`, `ExtensionContext`, state packet builders, and a state/status renderer. It must not own provider adapters or audio resources.

## Implementation plan

### Phase 1 — Move OpenAI runtime construction behind `providers/openai/runtime.ts`

Files:

- create `.pi/extensions/pi-realtime/providers/openai/runtime.ts`
- edit `.pi/extensions/pi-realtime/providers/runtime.ts`
- edit validation probes that inspect provider boundaries

Steps:

1. Move `createOpenAIProviderRuntime()` and `createOpenAIWebRTCMediaRuntime()` from shared `providers/runtime.ts` into `providers/openai/runtime.ts`.
2. Move OpenAI-specific imports with those functions:
   - `createOpenAIRealtimeProvider`
   - `hasOpenAIRealtimeCredentials`
   - `createOpenAIWebRTCBridgeAdapter`
   - `createOpenAIWebRTCClientSecret`
   - `hasOpenAIWebRTCCredentials`
3. Move WebRTC helper server creation/opening into the OpenAI runtime module unless a later provider proves it should be shared.
4. Keep generic runtime types exported from shared `providers/runtime.ts` initially to avoid churn.
5. Make shared `providers/runtime.ts` a small registry factory that imports only provider runtime factory functions.

Acceptance:

- `providers/runtime.ts` does not contain `createOpenAIWebRTCMediaRuntime`, `createOpenAIWebRTCBridgeAdapter`, `createOpenAIWebRTCClientSecret`, or `hasOpenAIWebRTCCredentials`.
- OpenAI runtime construction is provider-owned under `providers/openai/runtime.ts`.
- `service.ts` still imports no OpenAI provider implementation modules.
- `npm run gates:typecheck` and `npm run gates:validation` pass.

Suggested commit:

```text
refactor: move OpenAI runtime construction behind provider boundary
```

### Phase 2 — Extract active audio resource management from `service.ts`

Files:

- create `.pi/extensions/pi-realtime/audio-manager.ts`
- edit `.pi/extensions/pi-realtime/service.ts`
- update validation probes that assert microphone/playback lifecycle strings

Steps:

1. Introduce `createAudioManager()` with methods equivalent to the current service API subset:
   - `startMicrophone(providerSessionId, adapter)`
   - `stopMicrophone(providerSessionId?)`
   - `microphoneStatus()`
   - `startAudioPlayback(providerSessionId, adapter)`
   - `stopAudioPlayback(providerSessionId?)`
   - `audioPlaybackStatus()`
   - `writeProviderAudio(providerSessionId, audio)`
   - `shutdown()`
2. Pass an `onError(providerSessionId, kind, error)` callback into `createAudioManager()` so service remains responsible for UI notification policy.
3. Keep raw echo warning policy in `service.ts` because it depends on provider runtime preferences, not local process mechanics.
4. Replace `audioCaptures`, `audioPlaybacks`, `handleMicrophoneError()`, `handleAudioPlaybackError()`, and `handleProviderAudio()` in `service.ts` with calls into the audio manager.
5. Preserve exact command behavior and status text unless probes require deliberate updates.

Acceptance:

- `service.ts` no longer imports `createMacOSFfmpegAudioCapture`, `AudioCaptureController`, `createFfplayAudioPlayback`, or `AudioPlaybackController`.
- `audio-manager.ts` is the only module that imports both `audio.ts` and `playback.ts`.
- `/realtime mic ...` and `/realtime audio ...` command behavior remains covered by existing probes.
- `npm run gates:typecheck` and `npm run gates:validation` pass.

Suggested commit:

```text
refactor: isolate local realtime media lifecycle
```

### Phase 3 — Extract direct voice tool execution from `service.ts`

Files:

- create `.pi/extensions/pi-realtime/tools.ts`
- edit `.pi/extensions/pi-realtime/service.ts`
- update validation probes that inspect tool routing strings

Steps:

1. Move these private helpers to `tools.ts`:
   - `directToolResult()`
   - `sendInstructionFromTool()`
   - `resolveCitation()`
   - `stringArg()`
   - `stringArrayArg()`
2. Export a single focused function, for example:

   ```ts
   executeVoiceTool(input: {
     call: VoiceToolCallRecord;
     ctx: ExtensionContext | undefined;
     state: RealtimeState;
     controlPlane: ControlPlane;
   }): Promise<string>;
   ```

3. Keep `executeDirectTool()` in `service.ts` only as orchestration:
   - call `executeVoiceTool()`;
   - append/send `VoiceToolResultRecord` through existing `recordToolResult()`.
4. Preserve exact empty-instruction rejection text.
5. Keep provider event observation and `voiceToolCallReceived()` append in `service.ts`.

Acceptance:

- `service.ts` no longer contains direct implementations of citation resolving, string argument parsing, or instruction payload construction.
- `tools.ts` contains direct voice tool behavior and no provider adapter/audio resource state.
- Existing fake provider/direct tool probes pass unchanged or with only path/assertion updates.
- `npm run gates:typecheck` and `npm run gates:validation` pass.

Suggested commit:

```text
refactor: isolate direct voice tool execution
```

### Phase 4 — Tighten service surface and boundary probes

Files:

- `.pi/extensions/pi-realtime/service.ts`
- `.ai/validation/pi-realtime-provider-isolation-probe.mjs`
- possibly `.ai/validation/pi-realtime-structure-probe.mjs`

Steps:

1. Review exported `Service` methods and remove any method not used by `commands.ts`, `runtime.ts`, or validation-only fake harnesses.
2. If fake simulation helpers stay, make their purpose explicit in naming/comments or keep them grouped at the bottom of the service type.
3. Add/adjust probes for the desired boundaries:
   - `service.ts` must not import OpenAI implementation modules;
   - `service.ts` must not import local process constructors;
   - `providers/runtime.ts` must not import `./openai/webrtc*` or OpenAI credential/client-secret helpers;
   - root `providers/` must not contain `openai-*` filename sprawl;
   - `tools.ts` must contain the empty-instruction rejection path.
4. Do not enforce arbitrary line-count gates, but use the current `service.ts` size as a review signal. Expected result after Phases 2-3 is materially smaller and easier to scan.

Acceptance:

- Boundary probes fail for the specific slop patterns that triggered this refactor.
- Service remains command-facing and domain-mutating, not implementation-heavy.
- `npm run gates:quality` passes.

Suggested commit:

```text
test: guard realtime refactor boundaries
```

## Completion checklist

The refactor is complete when all of these are true:

- [ ] `providers/openai/runtime.ts` owns OpenAI runtime construction.
- [ ] shared `providers/runtime.ts` imports provider runtime factories only, not OpenAI WebRTC/client-secret helpers.
- [ ] `service.ts` does not import OpenAI provider implementation modules.
- [ ] `service.ts` does not import local audio process constructors or controller types.
- [ ] local microphone/playback resource maps live outside `service.ts`.
- [ ] direct voice tool implementation lives outside `service.ts`.
- [ ] `service.ts` still owns store mutations for session lifecycle, config changes, provider event observation, usage observation, and tool result sending.
- [ ] `/realtime openai ...`, `/realtime webrtc on|off`, `/realtime mic ...`, `/realtime audio ...`, `/realtime usage ...`, and fake-provider validation behavior are preserved.
- [ ] No root-level repeated provider-prefixed implementation files such as `providers/openai-*.ts` are present.
- [ ] `npm run gates:quality` passes.

## Validation commands

Run during implementation:

```bash
npm run gates:typecheck
npm run gates:validation
```

Run before final commit/closeout:

```bash
npm run gates:quality
```

Optional advisory pass after the mechanical moves:

```bash
npm run scans:deslop
```

Treat advisory findings as leads, not automatic instructions.
