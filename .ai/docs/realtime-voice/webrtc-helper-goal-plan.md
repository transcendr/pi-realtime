# Goal Plan: Toggleable WebRTC Media Helper for Speaker-Safe OpenAI Realtime

Date: 2026-05-17
Status: planned; do not start implementation yet

## Planned goal objective

Implement a toggleable OpenAI Realtime WebRTC media-helper mode for `pi-realtime` that preserves the existing raw WebSocket mode as the default/off path, adds a localhost browser page that uses WebRTC/browser audio processing for acoustic echo cancellation, and routes both modes through the same provider-neutral Pi control-plane semantics. Starting a raw speaker-capable session must warn that raw mode has no local acoustic echo cancellation and suggest headphones or the WebRTC helper command.

## Why this is the recommendation

The current raw path is useful but not speaker-safe:

```text
OpenAI audio -> ffplay speakers -> room -> MacBook mic -> ffmpeg raw PCM -> OpenAI
```

This is full-duplex transport, but not correct full-duplex voice I/O. There is no far-end reference signal feeding an acoustic echo canceller, so the model can hear its own output through the room.

The recommended speaker-safe path is to move media ownership into a browser/WebRTC helper:

```text
Pi extension/control-plane <-> localhost helper page <-> OpenAI Realtime WebRTC
                                  |
                                  + getUserMedia({ echoCancellation, noiseSuppression, autoGainControl })
```

The browser/WebRTC stack owns mic capture, speaker output, AEC, AGC, noise suppression, and barge-in media behavior. The Pi extension remains responsible for session state, context packets, tool execution, Pinotator citations, TUI feedback, and future steering semantics.

## Explicit non-goals for this planned goal

- Do not remove the raw WebSocket mode.
- Do not make WebRTC helper mode the default.
- Do not implement the later `pi_send_instruction`/steering semantic redesign in this goal.
- Do not require real OpenAI network calls for offline gates.
- Do not try to make `ffmpeg` + `ffplay` speaker-safe through VAD/noise-reduction tuning alone.

## User-visible behavior

### Default raw mode remains off for WebRTC

Existing-style start continues to use raw WebSocket mode:

```text
/realtime start --provider openai --model gpt-realtime-2
```

If the user starts raw OpenAI mode and later enables mic/audio in a speaker-risk path, Pi should warn:

```text
Warning: raw OpenAI audio mode does not provide local acoustic echo cancellation.
Use headphones, or run /realtime openai webrtc start for speaker-safe browser/WebRTC audio.
```

The warning should be rate-limited per provider session so it is helpful, not noisy.

### WebRTC helper command

Add an explicit opt-in command:

```text
/realtime openai webrtc start
/realtime openai webrtc stop
/realtime openai webrtc status
```

Later config can add:

```text
/realtime config set openai.media webrtc
/realtime config set openai.media raw
```

but the first implementation should keep the behavior explicit and command-driven.

### Expected manual flow

```text
/reload
/realtime start --provider openai --model gpt-realtime-2
/realtime openai webrtc start
```

Expected:

- Pi starts or reuses a localhost media-helper server.
- Pi opens a browser page such as `http://127.0.0.1:<port>/pi-realtime/openai/<sessionId>`.
- Browser requests microphone permission.
- Browser connects to OpenAI Realtime through WebRTC using an ephemeral client secret or equivalent browser-safe auth.
- Browser exposes a data channel/control bridge for realtime events.
- User can speak through MacBook speakers/mic without immediate self-feedback loops.
- Visible transcript notifications remain available in Pi.
- Raw `/realtime openai mic/audio start` remains available for headphones/debug.

## Architecture plan

### Mode split

```text
providers/openai.ts                    raw WebSocket adapter; current fallback/debug path
providers/openai-webrtc.ts             Pi-side adapter for localhost browser helper bridge
media/webrtc-helper/server.ts          local HTTP/WebSocket server lifecycle
media/webrtc-helper/client.html        minimal helper UI shell
media/webrtc-helper/client.ts          browser WebRTC/OpenAI session and data channel logic
media/webrtc-helper/protocol.ts        shared JSON message schema between Pi and page
```

The exact filenames can be adjusted, but the boundaries should remain.

### Shared core remains provider-neutral

The following must remain shared across both raw and WebRTC modes:

- `VoiceToolSurface`
- voice system prompt source
- context packet builders
- Pinotator citation packet shape
- direct tool execution
- tool result routing
- provider event replay
- status/widget rendering
- shutdown cleanup expectations

The media transport changes; Pi control-plane semantics do not.

### Adapter contract impact

Both raw and WebRTC modes should satisfy the same `RealtimeProviderAdapter` contract as much as possible:

```ts
connect(config, sink)
disconnect(reason)
updateContext(packet)
updateToolSurface(surface)
sendTextInput(text)
sendToolResult(result)
requestResponse(request)
```

Audio-specific methods need capability-aware behavior:

```ts
sendAudioInput(audio)              // raw mode only; WebRTC helper owns mic capture
setAudioOutputEnabled(enabled)     // raw mode toggles ffplay/output_modalities; WebRTC helper owns playback
```

For WebRTC mode these should return skipped/no-op receipts with explanatory messages or be replaced by a clearer media-mode capability layer if the implementation gets large.

### Browser helper responsibilities

The browser helper owns:

- `getUserMedia` with `echoCancellation: true`, `noiseSuppression: true`, `autoGainControl: true`;
- speaker playback through the browser/WebRTC media pipeline;
- OpenAI Realtime WebRTC peer connection;
- data channel send/receive for Realtime events;
- permission and connection state UI;
- page-side cleanup on unload/disconnect.

The browser helper must not own:

- durable Pi state;
- Pinotator citation semantics;
- final tool execution policy;
- Pi instruction/steering semantics;
- API keys beyond ephemeral credentials.

### Local server responsibilities

The Pi extension/local server owns:

- serving static helper page assets;
- minting or proxying browser-safe OpenAI ephemeral credentials;
- bridging helper events into the provider sink;
- pushing context packets/tool surfaces to the helper;
- routing tool calls/results through existing service logic;
- shutdown cleanup for server sockets and helper sessions;
- warning when helper page is disconnected/stale.

## Auth/security plan

Do not expose `OPENAI_API_KEY` to the browser page.

Preferred path:

1. Pi-side Node code uses `OPENAI_API_KEY` server-side.
2. It mints an ephemeral OpenAI Realtime client secret for the requested session/model.
3. The helper page receives only the ephemeral credential.
4. The ephemeral credential is short-lived and scoped to the realtime session.

If the SDK lacks a convenient helper, implement a small provider-isolated fetch in `providers/openai-webrtc.ts` or a focused `providers/openai-ephemeral.ts`. No OpenAI SDK imports outside provider/media adapter files.

## Duplication expectations

Expected duplication if designed well: moderate, not severe.

Duplicated or mode-specific:

- session transport setup;
- OpenAI WebRTC signaling vs WebSocket connection;
- browser helper lifecycle;
- audio enable/disable semantics;
- mode-specific smoke docs/probes.

Shared:

- provider-neutral event types;
- context packets;
- tool schema/source of truth;
- tool call/result normalization targets;
- Pi notification/status rendering;
- branch-aware replay;
- direct tool execution;
- future steering semantics.

Avoid duplication by treating WebRTC as a second OpenAI transport adapter, not a second product.

## Implementation phases for the future goal

### Phase 1: Media mode model and raw-mode warning

- Add a media transport/mode concept, probably `raw` vs `webrtc`.
- Keep raw as default.
- Add raw-mode echo warning when mic/audio are used without WebRTC.
- Add command completions/help for WebRTC commands.
- Add validation probe for default-off and warning text.

### Phase 2: Localhost helper server skeleton

- Add server module with start/stop/status lifecycle.
- Serve a static helper page from the extension repo.
- Open helper URL from `/realtime openai webrtc start` if Pi API supports it; otherwise notify/copy URL.
- Stop server/helper resources on `session_shutdown`.
- Add offline validation probes that server assets and cleanup wiring exist.

### Phase 3: Browser WebRTC connection

- Implement helper-side `getUserMedia` with AEC/noise suppression/AGC constraints.
- Implement OpenAI Realtime WebRTC signaling with ephemeral credentials.
- Establish data channel for Realtime events.
- Display helper connection/mic state visibly in page.
- Do not expose the raw API key to browser code.

### Phase 4: Pi bridge adapter

- Add `providers/openai-webrtc.ts` or equivalent bridge adapter.
- Normalize helper data-channel events into existing `NormalizedProviderEvent` values.
- Route tool calls through existing service direct-tool handling.
- Route tool results and context packets back to helper/data channel.
- Preserve visible transcript notifications.

### Phase 5: Smoke tests and docs

- Update `openai-smoke-test.md` with raw/headphones path and WebRTC/speaker-safe path.
- Add deterministic probes for:
  - raw mode remains default;
  - warning exists;
  - WebRTC helper files exist;
  - no API key is exposed in helper bundle/source;
  - helper lifecycle is stopped on shutdown;
  - bridge event schema covers transcript/tool/error/context cases.
- Keep `npm run gates:quality` offline.

## Acceptance criteria

- Raw OpenAI WebSocket mode remains available and default/off for WebRTC.
- Starting raw speaker-risk audio warns about missing local AEC and suggests headphones or `/realtime openai webrtc start`.
- `/realtime openai webrtc start|stop|status` exists and is documented.
- A localhost helper page exists and uses browser media constraints with `echoCancellation`, `noiseSuppression`, and `autoGainControl`.
- Browser helper does not receive `OPENAI_API_KEY`; it uses ephemeral auth or a local bridge that keeps the key server-side.
- WebRTC helper mode can connect to OpenAI Realtime and exchange audio over WebRTC.
- Realtime event/tool/context traffic is bridged back to Pi through the existing provider-neutral service path.
- Existing fake provider and raw OpenAI text/mic/audio paths continue to pass deterministic gates.
- Offline gates do not require OpenAI network access or browser automation.
- Docs explain when to use raw vs WebRTC mode and the known feedback limitation of raw mode.

## Future goal prompt

Use this as the later goal objective when ready to start implementation:

```text
Implement toggleable OpenAI WebRTC media-helper mode for pi-realtime. Keep raw OpenAI WebSocket mode as the default/off path, but warn when raw mic/audio is used without local acoustic echo cancellation and suggest headphones or `/realtime openai webrtc start`. Add a localhost browser helper that owns microphone/speaker media through WebRTC/browser audio processing with echoCancellation/noiseSuppression/autoGainControl, uses browser-safe ephemeral OpenAI Realtime auth, bridges Realtime data-channel events into the existing provider-neutral Pi service, preserves tool/context/transcript routing, cleans up helper/server resources on shutdown, and keeps offline/fake/raw-provider gates passing. Do not redesign voice-to-Pi steering semantics in this goal.
```

## Validation to run when implementing

```bash
npm run gates:typecheck
npm run gates:validation
npm run gates:quality
npm run scans:deslop
node ~/.codex/skills/pi-extension-dev/scripts/audit-pi-extension.mjs .
```

Live WebRTC smoke testing remains manual/API-key/browser dependent and should be documented separately from offline gates.
