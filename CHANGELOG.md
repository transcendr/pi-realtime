# Changelog

## 0.2.1 - 2026-05-20

### Fixed

- Fixed WebRTC helper asset loading when `pi-realtime` is installed into another project and Pi is launched from that project’s working directory.

## 0.2.0 - 2026-05-20

### Highlights

- Added eco mode so spoken user requests can route directly to Pi while realtime voice focuses on speaking Pi updates back.
- Improved OpenAI spoken backend updates for practical use: mini now reads Pi updates more literally, realtime-2 can summarize long updates compactly, and multi-part updates are spoken in order.

### Added

- Added OpenAI realtime model selection commands for choosing `gpt-realtime-mini` or `gpt-realtime-2` for future sessions.
- Added model-profiled speech behavior for Pi-to-realtime updates, including compact long-form speech for strong models and literal JSON task delivery for weak models.
- Added ordered multi-part speech delivery for OpenAI WebRTC sessions so long spoken updates keep their intended order.
- Added richer trace and usage evidence for auditing spoken update behavior and cost.

### Changed

- Updated the README to focus on the main user workflow: OpenAI eco sessions, model choice, status, usage, and stop commands.
- Made spoken backend updates more predictable across OpenAI realtime models while keeping full Pi responses visible in text.

## 0.1.0 - 2026-05-19

First preview release of `pi-realtime`.

### Added

- Provider-neutral realtime session core for Pi.
- `/realtime` command surface for starting, inspecting, using, and stopping sessions.
- Deterministic fake provider for no-network local validation.
- OpenAI Realtime adapter with text, tool-call, raw microphone, raw playback, and usage telemetry support.
- Optional localhost browser/WebRTC helper for echo-cancelled speaker-safe media.
- Pi-facing realtime tools for active-session status, spoken acknowledgements, progress updates, and final responses.
- Durable branch-aware replay for realtime events, context packets, citation decks, tool calls, and usage observations.
- Compact status/widget rendering for active realtime sessions.
- Deterministic validation probes under `.ai/validation`.

### Changed

- Prepared repository hygiene for preview release: only `.ai/validation` artifacts are tracked from `.ai`.
