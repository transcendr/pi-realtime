# Changelog

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
