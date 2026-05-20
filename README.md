# pi-realtime

Realtime voice sessions for [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent).

`pi-realtime` adds a Pi-native realtime voice control plane: start a voice session, speak to Pi, receive spoken acknowledgements/progress/final answers, and keep provider-specific media behavior isolated behind a shared extension model.

> Preview release: `pi-realtime` is usable for local preview testing, but provider behavior, command names, and install ergonomics may change before `1.0.0`.

## What’s new

`0.1.0` is the first preview release.

It includes a provider-neutral realtime session core, deterministic fake-provider testing, OpenAI Realtime support, browser/WebRTC media helper support, usage telemetry, explicit agent/eco interaction modes, and Pi-facing realtime send tools for acknowledgements, progress updates, and final responses.

See the [changelog](CHANGELOG.md) for details.

## Features

- `/realtime` command for starting, inspecting, and stopping realtime voice sessions.
- Provider-neutral session model for fake, OpenAI, and future realtime providers.
- Deterministic fake provider for local development without API keys, microphones, speakers, or network calls.
- OpenAI Realtime adapter for text, tool calls, raw microphone input, raw audio playback, and response usage telemetry.
- Optional localhost browser/WebRTC helper for speaker-safe media with browser echo cancellation, noise suppression, and automatic gain control.
- Pi-to-realtime communication tools for spoken acknowledgements, progress updates, final answers, and active-session status checks.
- Interaction modes: `agent` for the model-mediated request-tool flow, and `eco` for direct final transcript routing to Pi with no realtime request tools exposed.
- OpenAI realtime model preference commands for switching future sessions between `gpt-realtime-mini` and `gpt-realtime-2`.
- Model-profiled backend-update speech chunking for long Pi-to-realtime text updates.
- Durable branch-aware replay of realtime session observations, context packets, tool calls, citation decks, and usage observations.
- Compact status/widget rendering for active realtime sessions.
- Provider-scoped tool result routing so concurrent sessions do not receive each other’s responses.

## Install

Install globally for your Pi environment:

```bash
pi install npm:pi-realtime
```

Install project-locally:

```bash
pi install -l npm:pi-realtime
```

For local development from this checkout:

```bash
npm install
npm run gates:quality
pi install -l .
```

## Requirements

- Pi `^0.74.0`.
- Node.js compatible with the checked-in TypeScript/tooling stack.
- `OPENAI_API_KEY` for OpenAI Realtime sessions, either exported in the shell or set in a local `.env` file.
- `ffmpeg` and `ffplay` only when using raw microphone/audio commands.
- A browser for the optional WebRTC helper flow.

## `/realtime` command

Use `/realtime` to manage realtime sessions from Pi.

```text
/realtime status
/realtime start --provider fake [--mode agent|eco]
/realtime start --provider openai [--mode agent|eco]
/realtime openai model [gpt-realtime-mini|gpt-realtime-2]
/realtime mode agent|eco
/realtime text <message>
/realtime usage [--session <providerSessionId>] [--details]
/realtime stop [--session <providerSessionId>]
```

Common commands:

- `/realtime status` — show active sessions and current primary session.
- `/realtime start --provider fake` — start the deterministic local fake provider.
- `/realtime start --provider openai` — start an OpenAI Realtime session using `OPENAI_API_KEY`.
- `/realtime start --provider openai --mode eco` — start eco mode: final voice transcripts route directly to Pi; the realtime model only speaks explicit Pi updates.
- `/realtime openai model` — show the current and available OpenAI realtime default models.
- `/realtime openai model gpt-realtime-mini|gpt-realtime-2` — set the OpenAI realtime default model for future sessions; explicit `--model` start flags still override it.
- `/realtime mode agent|eco` — set the default interaction mode for future sessions.
- `/realtime text <message>` — send provider/debug text to the current primary realtime session; this is not converted into a Pi backend request.
- `/realtime usage --details` — inspect tracked usage observations.
- `/realtime primary <providerSessionId>` — choose the primary realtime session.
- `/realtime stop [--session <providerSessionId>]` — stop one session, or the primary session when no session id is provided.
- `/realtime citations` — show the currently observed citation deck summary.
- `/realtime help` — show command help.

## Fake provider

The fake provider is the safest way to validate Pi integration without provider credentials or media devices.

```text
/realtime start --provider fake
/realtime fake transcript <text>
/realtime fake tool request {"request":"summarize the current repo"}
/realtime stop
```

It exercises transcript events, context packet delivery, voice-derived Pi instruction submission, provider-scoped tool result routing, citation lookup shape, and shutdown cleanup.

## Interaction modes

`pi-realtime` supports two initial interaction modes:

- `agent` — default compatibility mode. User audio reaches the realtime model, and the model can call the `request` tool to ask Pi to do backend work.
- `eco` — direct transcript mode. OpenAI Realtime still owns WebRTC media, server VAD, barge-in, and input-audio transcription, but final actionable transcripts are routed directly to Pi. The realtime model receives no request tools (`tools: []`, `tool_choice: "none"`) and only speaks explicit Pi updates sent with `realtime_send_ack`, `realtime_send_status`, or `realtime_send_text`.

Eco mode still requires live provider validation for provider-specific speech isolation details such as `response.create` with `conversation: "none"` and provider-side conversation item deletion. Deterministic gates prove local routing and capability-surface contracts only.

## OpenAI Realtime

Set `OPENAI_API_KEY`, then start an OpenAI session. You can export it in the shell:

```bash
export OPENAI_API_KEY=...
```

Or copy `.env.example` to `.env` and replace the placeholder:

```bash
cp .env.example .env
$EDITOR .env
```

```text
/realtime start --provider openai
/realtime openai model gpt-realtime-2
/realtime openai text hello
/realtime usage --details
```

Raw microphone and playback commands are available for local smoke tests:

```text
/realtime openai mic start
/realtime openai audio start
/realtime openai mic stop
/realtime openai audio stop
```

Raw local microphone plus speaker playback does not provide acoustic echo cancellation. Use headphones, or prefer the WebRTC helper for speaker-safe testing.

## WebRTC helper

The WebRTC helper opens a localhost browser page that owns microphone and speaker media so the browser can apply echo cancellation, noise suppression, and automatic gain control.

```text
/realtime openai webrtc start
/realtime openai webrtc status
/realtime openai webrtc stop
```

You can also enable or disable OpenAI auto WebRTC preference:

```text
/realtime webrtc on
/realtime webrtc off
```

## Agent-facing realtime tools

When a realtime session is active, Pi agents can communicate back to the voice interface through explicit tools:

- `realtime_status` — check whether a live realtime send target exists.
- `realtime_send_ack` — send a short spoken acknowledgement before work is done.
- `realtime_send_status` — send concise progress or checkpoint updates during work.
- `realtime_send_text` — send summaries, reports, final answers, or other text responses.

These tools are intended to make realtime voice feel like one coherent assistant while keeping Pi responsible for backend work and evidence gathering.

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

## Project layout

```text
.pi/extensions/pi-realtime/
  index.ts                 # Pi extension entrypoint
  runtime.ts               # Pi lifecycle/command/UI wiring
  commands.ts              # /realtime parser
  service.ts               # provider-neutral orchestration
  store.ts                 # branch-aware session custom-entry replay
  events.ts                # durable event constructors/replay helpers
  control-plane.ts         # Pi instruction sink and citation observation bridge
  realtime-updates.ts      # Pi-to-realtime spoken update delivery
  prompt.ts                # voice-agent and speech-renderer prompts
  domain/                  # pure mode policy and transcript routing helpers
  state-packets.ts         # compact Pi/citation/tool context packets
  usage.ts                 # usage observation and formatting helpers
  view.ts                  # status/widget rendering
  providers/               # provider adapter contracts and implementations
  media/webrtc-helper/     # localhost browser/WebRTC helper
.ai/validation/
  pi-realtime-*.mjs        # deterministic probes
```
