# pi-realtime

Pi extension project for realtime voice control-plane interfaces to Pi agents.

The extension is being built around a provider-neutral core: realtime voice providers such as OpenAI Realtime and Google Gemini Live should adapt to one shared Pi control-plane model instead of embedding Pi logic in provider-specific code. The current implementation includes the provider-neutral foundation, a fake/no-network provider for deterministic development, and an OpenAI Realtime prototype with text, microphone input, and audio playback paths.

## Project layout

```text
.pi/extensions/pi-realtime/
  index.ts                 # Pi extension entrypoint
  runtime.ts               # Pi lifecycle/command/UI wiring
  commands.ts              # /realtime parser
  audio.ts                 # ffmpeg/AVFoundation microphone capture
  playback.ts              # ffplay PCM response playback
  control-plane.ts         # Pi instruction sink and citation observation bridge
  events.ts                # durable event constructors/replay helpers
  store.ts                 # branch-aware session custom-entry replay
  service.ts               # provider-neutral orchestration
  state-packets.ts         # compact Pi/citation/tool context packets
  prompt.ts                # voice-agent policy/tool-surface prompt
  types.ts                 # versioned event/state/provider packet types
  view.ts                  # status/widget rendering
  providers/
    types.ts               # normalized provider adapter contract
    fake.ts                # deterministic no-network provider adapter
    openai.ts              # OpenAI Realtime WebSocket adapter
  .sentrux/rules.toml      # structural constraints
.ai/validation/
  pi-realtime-*.mjs        # deterministic probes
```

## Development

```bash
npm install
npm run gates:quality
```

Useful individual gates:

```bash
npm run gates:structure
npm run gates:deslop
npm run gates:typecheck
npm run gates:validation
npm run scans:deslop
```

`gates:*` scripts are blocking. `scans:*` scripts are advisory sensors; findings are leads for semantic review, not automatic failures.

## Pi loading

```bash
pi install -l /Users/bryan/dev/personal/experiments/pi-realtime
pi --offline --no-session --no-tools -e .pi/extensions/pi-realtime/index.ts --list-models
```

## Current commands

```text
/realtime status
/realtime start --provider fake
/realtime start --provider openai --model gpt-realtime-2   # requires OPENAI_API_KEY
/realtime text <message>
/realtime openai text <message>
/realtime openai mic start
/realtime openai mic stop
/realtime openai audio start
/realtime openai audio stop
/realtime mic status
/realtime audio status
/realtime fake transcript <text>
/realtime fake tool <tool_name> <json>
/realtime citations
/realtime primary <providerSessionId>
/realtime stop [--session <providerSessionId>]
```

The fake provider exercises transcript events, context packet delivery, direct voice tool calls, Pinotator citation lookup shape, voice-derived Pi instruction submission, provider-scoped tool result routing, and shutdown cleanup without API keys, microphone access, or network.

The OpenAI adapter currently covers text/context/tool-call, microphone input, and audio playback. It is guarded by `OPENAI_API_KEY`; use `/realtime openai text <message>` for text smoke tests, `/realtime openai mic start` to stream the macOS default microphone through `ffmpeg`/AVFoundation, and `/realtime openai audio start` to play model responses through `ffplay`. Visible transcript notifications remain enabled while audio is playing.

## Planning docs

- `.ai/docs/realtime-voice/initial-brief.md`
- `.ai/docs/realtime-voice/architecture.md`
- `.ai/docs/realtime-voice/input-injection-decision.md`

Future provider work should keep OpenAI/Gemini SDK imports isolated to `providers/openai.ts` and `providers/gemini.ts`.
