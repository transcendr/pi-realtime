# pi-realtime setup proof matrix

Date: 2026-05-17

This repo has been initialized as a Pi extension development project following `pi-extension-dev`.

## Setup artifacts

| Requirement | Evidence |
| --- | --- |
| Pi extension entrypoint | `.pi/extensions/pi-realtime/index.ts` |
| Package manifest | `package.json` declares `pi.extensions: [".pi/extensions/pi-realtime/index.ts"]` |
| TypeScript config | `tsconfig.json` uses ES2022, strict, noEmit |
| Sentrux rules | `.pi/extensions/pi-realtime/.sentrux/rules.toml` |
| Deterministic probes | `.ai/validation/pi-realtime-structure-probe.mjs`, `.ai/validation/pi-realtime-state-probe.mjs` |
| Repo hygiene | `.gitignore` excludes runtime/local artifacts and `references/` |
| Developer guidance | `README.md`, `AGENTS.md` |

## Validation evidence

| Gate | Command | Result |
| --- | --- | --- |
| Hard quality gate | `npm run gates:quality` | pass |
| Static pi-extension-dev audit | `node ~/.codex/skills/pi-extension-dev/scripts/audit-pi-extension.mjs .` | pass; TOON decoded |
| Advisory deslop scan | `npm run scans:deslop` | pass, 0 findings |
| Package load probe | `pi --offline --no-session --no-tools -e . --list-models` | pass; output captured in `/tmp/pi-realtime-package-load.txt` |

## Realtime voice planning evidence

| Artifact | Status |
| --- | --- |
| `.ai/docs/realtime-voice/initial-brief.md` | Captures user intent, provider research snapshot, and provider-neutral constraints |
| `.ai/docs/realtime-voice/architecture.md` | Defines implementation-ready provider-neutral architecture, event schema, context/citation packets, tool allowlist, lifecycle posture, multi-provider routing, and validation criteria |
| `.ai/docs/realtime-voice/input-injection-decision.md` | Locks `pi.sendUserMessage()` as the primary voice-derived instruction sink with custom-event metadata, context-message supplements, fallback strategy, and validation plan |
| Provider-neutral core foundation | Implemented durable realtime event/state model, context/citation packets, direct voice tool surface, command parser, control-plane instruction sink, provider adapter types, and validation probes |
| Fake/no-network provider prototype | Implemented `providers/fake.ts`, `/realtime fake transcript`, `/realtime fake tool`, provider-scoped tool result routing, voice-derived instruction submission, citation resolution path, and shutdown cleanup |
| Goal 5 hardening/proof matrix | Added `.pi/extensions/pi-realtime/context.ts`, expanded validation probes for lifecycle/context cleanup, simultaneous-provider isolation, command parsing, citation deck revisions, and wrote `.ai/docs/realtime-voice/proof-matrix.md` |
| Goal 6 OpenAI smoke path | Added `providers/openai.ts`, `openai` dependency, API-key guard, text/context/tool-call adapter path, OpenAI validation probe, and `.ai/docs/realtime-voice/openai-smoke-test.md` |

## Notes for future implementation

The current extension command is a scaffold used to prove state and UI wiring:

```text
/pi-realtime
/pi-realtime add <text>
/pi-realtime clear
```

Future feature work should preserve the module boundaries and add focused probes for any new parser, model-facing payload, background watcher, realtime connection, or UI renderer.
