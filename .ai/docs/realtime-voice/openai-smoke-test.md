# OpenAI Realtime smoke-test procedure

Date: 2026-05-17

## Scope

This procedure validates the first OpenAI Realtime provider path for `pi-realtime`: connection config, text/context packet delivery, microphone input, audio playback, direct function/tool declarations, function-call normalization, tool-result routing, and clean disconnect.

## Preconditions

- `npm install` completed.
- `npm run gates:quality` passes without network/API keys.
- `OPENAI_API_KEY` is set only for the real smoke test shell/session.
- Use a model supported by the current OpenAI Realtime account, defaulting to `gpt-realtime-2`.

## Offline guard check

Without an API key, `/realtime start --provider openai` should not attempt a network connection. It should show:

```text
OPENAI_API_KEY is required to start an OpenAI realtime session.
```

The normal repo quality gate must continue to pass without `OPENAI_API_KEY`.

## Manual smoke path

From a Pi session in this repo:

```text
/reload
/realtime status
/realtime start --provider openai --model gpt-realtime-2
/realtime status
/realtime citations
/realtime openai text Say one short sentence, then call pi_realtime_status.
```

Expected:

- Session starts only when `OPENAI_API_KEY` is present.
- Status shows an active OpenAI provider session.
- The adapter sends `session.update` with text modality and the direct voice tool surface.
- The adapter sends context packets via `conversation.item.create` system messages.
- `/realtime openai text ...` sends a user text item and triggers `response.create`.

## Microphone + audio playback smoke

This streams the macOS default microphone via `ffmpeg`/AVFoundation as 24 kHz mono PCM16 input and plays OpenAI output audio through `ffplay`. Visible transcript notifications remain enabled.

```text
/realtime openai audio start
/realtime openai mic start
```

Speak a short sentence, then pause for server VAD. Expected:

- You hear the assistant response.
- Pi also shows a visible `Realtime openai: ...` transcript notification.
- Input audio transcription is enabled with `gpt-4o-mini-transcribe` so Pi can store/debug what the microphone path heard. This is an extra Realtime session feature in addition to the primary `gpt-realtime-2` audio understanding.

Stop capture/playback when done:

```text
/realtime openai mic stop
/realtime openai audio stop
```

If macOS denies microphone access or `ffmpeg` cannot open AVFoundation device `:0`, Pi shows a microphone warning. Grant Terminal/Warp microphone permission in macOS settings and retry. If `ffplay` cannot open the output device, Pi shows an audio playback warning.

## Function-call smoke prompt

Use `/realtime openai text ...` to force a text/tool path:

```text
/realtime openai text Please call pi_realtime_status now and summarize the result briefly.
```

Expected normalized flow:

1. OpenAI emits `response.function_call_arguments.done`.
2. `providers/openai.ts` normalizes it to `NormalizedProviderEvent` with `type: "tool_call"`.
3. `service.ts` records `provider_event` and `voice_tool_call_received`.
4. The direct tool handler returns a compact result.
5. `providers/openai.ts` sends `conversation.item.create` with `type: "function_call_output"` and matching `call_id`.
6. The adapter sends `response.create` to let OpenAI continue.

## Disconnect check

```text
/realtime stop
/realtime status
```

Expected:

- OpenAI socket receives a normal close.
- Durable session is marked stopped.
- Fake/offline gates still pass after the smoke test.

## Validation commands after smoke

```bash
npm run gates:quality
npm run scans:deslop
node ~/.codex/skills/pi-extension-dev/scripts/audit-pi-extension.mjs .
```

Network/API-key smoke testing is intentionally manual and guarded. Do not make CI/offline quality gates depend on real OpenAI connectivity.
