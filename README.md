# pi-realtime

Talk to [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) while you code.

`pi-realtime` adds realtime voice to Pi. You can ask Pi to work on your project, hear short spoken updates, steer the work mid-task, and keep the full details visible in Pi.

> Preview release: `pi-realtime` is usable for local testing, but provider behavior, command names, and install ergonomics may change before `1.0.0`.

## What’s new

`0.2.0` makes OpenAI voice sessions more practical for everyday coding:

- Eco mode routes your speech to Pi while the voice session speaks Pi’s updates back.
- WebRTC is the recommended OpenAI voice path for speaker-safe audio with browser echo cancellation.
- `gpt-realtime-mini` is the recommended eco-mode model for lower-cost voice sessions.
- Spoken updates are more predictable: mini reads Pi updates more literally, and multi-part updates are spoken in order.
- Usage tracking helps you inspect realtime cost while testing.

See the [changelog](CHANGELOG.md) for details.

## Why use it

- Talk to Pi while your hands stay in the editor or terminal.
- Ask for coding work, status checks, summaries, and follow-up tasks by voice.
- Interrupt or steer a task while Pi is working.
- Hear concise spoken updates without losing the detailed text, command output, files, and evidence in Pi.
- Use a WebRTC voice path that is safer for speaker playback than raw microphone/audio loops.

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
- `OPENAI_API_KEY` for OpenAI Realtime sessions, either exported in the shell or set in a local `.env` file.
- A browser for the recommended WebRTC voice path.
- `ffmpeg` and `ffplay` only for lower-level raw microphone/audio troubleshooting.

## Start an OpenAI voice session

Set `OPENAI_API_KEY`:

```bash
export OPENAI_API_KEY=...
```

Or copy `.env.example` to `.env` and replace the placeholder:

```bash
cp .env.example .env
$EDITOR .env
```

Choose mini, then start eco mode:

```text
/realtime openai model gpt-realtime-mini
/realtime start --provider openai --mode eco
```

For eco mode, start with `gpt-realtime-mini`. Pi does the project work; the voice model mainly listens, transcribes, and speaks Pi’s updates back. Mini handles that job well at lower cost. Use `gpt-realtime-2` when you specifically want the realtime model to act more like a reasoning voice agent instead of a lightweight voice link between you and Pi.

## Core commands

Most users only need these commands:

```text
/realtime start --provider openai --mode eco
/realtime openai model [gpt-realtime-mini|gpt-realtime-2]
/realtime status
/realtime usage --details
/realtime stop
```

- `/realtime start --provider openai --mode eco` — start a voice session where speech goes to Pi and the voice speaks Pi updates back.
- `/realtime openai model gpt-realtime-mini|gpt-realtime-2` — choose the default OpenAI realtime model for future sessions.
- `/realtime status` — show active sessions and the current primary session.
- `/realtime usage --details` — inspect tracked usage while testing cost.
- `/realtime stop` — stop the current primary realtime session.

Additional provider/debug commands exist for local development, fake-provider tests, raw microphone/audio experiments, and troubleshooting, but they are not the main user workflow.

## WebRTC voice path

For OpenAI voice sessions, the recommended path is the browser/WebRTC helper. It opens a localhost browser page that owns microphone and speaker media so the browser can apply echo cancellation, noise suppression, and automatic gain control.

To make future OpenAI sessions automatically use the browser/WebRTC voice path, run:

```text
/realtime webrtc on
```

Raw microphone/playback commands still exist for troubleshooting and low-level smoke tests, but they are not the primary workflow.

## Interaction model

The recommended default is **eco mode**:

```text
You speak
   ↓
OpenAI Realtime + browser/WebRTC
live audio, transcription, interruption, playback
   ↓ final transcript
Pi backend
repo work, commands, files, reasoning
   ↓ acknowledgements, status, replies
OpenAI Realtime voice
   ↓
You hear Pi's updates
```

In practice:

1. You speak naturally.
2. OpenAI Realtime handles live audio, transcription, interruption, and playback.
3. Pi receives the final transcript and does the project work.
4. The voice session speaks Pi’s acknowledgements, progress, and final answer back to you.

This is different from a traditional voice-agent setup where the realtime model is also the main agent deciding how to respond, when to call tools, and how much reasoning to do in the voice session.

Eco mode has two practical benefits:

- **Lower cost:** the realtime model does less agent reasoning. Pi does the coding work, and spoken updates can stay concise while the full answer remains visible in Pi.
- **Clearer workflow:** the voice interface stays focused on listening and speaking. Pi remains the source of truth for repository work, file changes, command output, and final task reasoning.

`pi-realtime` also supports `agent` mode as a compatibility mode where the realtime model can decide when to call a request tool for Pi work. It can be useful for more discussion-heavy sessions where you want the voice agent to behave more like a conversational partner, but eco mode is the recommended starting point for normal coding sessions because it is more predictable and cost-efficient.

Live OpenAI testing has validated direct transcript routing and spoken Pi updates, but provider behavior can still vary across models and sessions. Use `/realtime usage --details` when validating cost. For long voice sessions, restart periodically instead of running all the way to the provider session limit, especially before exact wording or release-review work.

## How Pi talks back

Pi communicates back to the voice session deliberately. Instead of letting the voice model invent a response to every backend event, Pi sends the kind of spoken update that fits the moment:

- **Acknowledgements** — short confirmations that Pi heard the request and is starting work.
- **Status updates** — brief progress notes while a longer task is running.
- **Replies** — final answers, summaries, or reports when Pi has completed the work.
- **Status checks** — lightweight checks that tell Pi whether a live voice session is available before trying to speak.

This makes the voice experience feel like a fluid conversation without moving project authority into the voice model. You can ask a question, hear a quick acknowledgement, keep talking or wait while Pi works, then hear the result when it is ready.

If you speak again while Pi is working, the new transcript can steer the active work instead of waiting for a separate typed follow-up. For example, you might ask Pi to clean up a messy git worktree and make focused commits. While Pi is inspecting files and running checks, you can ask, “How’s it going?” and Pi can answer with a short spoken progress update, then continue the cleanup.

## Fake provider for development

The fake provider is for local extension development and deterministic validation without provider credentials, microphones, speakers, or network calls.

```text
/realtime start --provider fake
/realtime fake transcript <text>
/realtime stop
```

Most users do not need the fake provider during normal OpenAI voice use.

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
