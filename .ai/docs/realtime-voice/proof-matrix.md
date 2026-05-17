# pi-realtime realtime voice proof matrix

Date: 2026-05-17

## Scope

This matrix covers the provider-neutral and fake/no-network realtime voice system through goal 5/6. Real OpenAI/Gemini network paths remain deferred.

## Artifacts

| Area | Evidence |
| --- | --- |
| Architecture | `.ai/docs/realtime-voice/architecture.md` |
| Input injection decision | `.ai/docs/realtime-voice/input-injection-decision.md` |
| Durable state/replay | `.pi/extensions/pi-realtime/events.ts`, `.pi/extensions/pi-realtime/store.ts` |
| Provider-neutral packets | `.pi/extensions/pi-realtime/state-packets.ts` |
| Control-plane instruction sink | `.pi/extensions/pi-realtime/control-plane.ts` |
| Fake provider | `.pi/extensions/pi-realtime/providers/fake.ts` |
| Lifecycle/context hardening | `.pi/extensions/pi-realtime/runtime.ts`, `.pi/extensions/pi-realtime/context.ts` |
| Commands | `.pi/extensions/pi-realtime/commands.ts` |
| OpenAI adapter | `.pi/extensions/pi-realtime/providers/openai.ts`, `.ai/docs/realtime-voice/openai-smoke-test.md` |

## Deterministic probes

| Probe | Coverage |
| --- | --- |
| `.ai/validation/pi-realtime-structure-probe.mjs` | Required lifecycle hooks, append-entry persistence, branch replay source |
| `.ai/validation/pi-realtime-state-probe.mjs` | Event schema source contract, replay behavior, instruction sink source contract |
| `.ai/validation/pi-realtime-provider-isolation-probe.mjs` | Provider-session scoped tool result routing |
| `.ai/validation/pi-realtime-packets-probe.mjs` | Context packet revision behavior and direct tool surface/citation contract |
| `.ai/validation/pi-realtime-fake-provider-probe.mjs` | Fake adapter lifecycle, transcript/tool-call/result path, no provider SDK imports |
| `.ai/validation/pi-realtime-hardening-probe.mjs` | `session_tree`/`session_compact`/`context`/`session_shutdown`, stale custom-message filtering, non-interactive command safety |
| `.ai/validation/pi-realtime-simultaneous-litmus-probe.mjs` | Simultaneous-provider isolation for sessions, tool calls, and context revisions |
| `.ai/validation/pi-realtime-citation-deck-probe.mjs` | Pinotator citation deck parsing, ref resolution, revision changes |
| `.ai/validation/pi-realtime-openai-adapter-probe.mjs` | OpenAI adapter boundary, API-key guard, context/tool/function-call/result smoke contract, SDK import isolation |

## Commands run

| Command | Result |
| --- | --- |
| `sentrux gate --save .pi/extensions/pi-realtime` | pass; baseline updated for hardened fake-provider system |
| `npm run gates:quality` | pass |
| `node ~/.codex/skills/pi-extension-dev/scripts/audit-pi-extension.mjs .` | pass; TOON decoded |
| `npm run scans:deslop` | pass, 0 advisory findings |

## Remaining planned proof

Goal 6 added OpenAI-specific smoke-test documentation and kept all fake/offline gates passing. Real provider live validation remains API-key guarded and must not make normal quality gates depend on network availability.
