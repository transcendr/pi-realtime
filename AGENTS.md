# pi-realtime Agent Guidance

This repository is a Pi extension project. Use the `pi-extension-dev` skill for setup, implementation, validation, and review work.

## Required protocol

- Follow `~/.codex/skills/pi-extension-dev/references/standard-repo-protocol.md`.
- Keep Pi API wiring in `.pi/extensions/pi-realtime/runtime.ts`.
- Keep domain mutations in `service.ts`, persistence/replay in `store.ts` or `events.ts`, types in `types.ts`, and rendering in `view.ts`.
- If state matters after reload, `/tree`, compaction, or resume, persist it with branch-aware replay from `ctx.sessionManager.getBranch()`.
- Stop timers, watchers, processes, and connections on `session_shutdown`.
- Do not vendor reusable scanner source into this repo; use `d3sl0p` through npm scripts.

## Quality gates

Before closeout of development changes, run:

```bash
npm run gates:quality
```

Use advisory scans separately:

```bash
npm run scans:deslop
```

`gates:*` are hard/blocking. `scans:*` are advisory leads requiring semantic review.

## Artifact hygiene

Do not commit runtime artifacts or local reference clones:

- `node_modules/`
- `.pi/npm/node_modules/`
- `.pi/goal-monitor/`
- `.pi/sessions/`
- `references/`
- `*.log`

Keep deterministic validation under `.ai/validation/`. Put substantial proof matrices or design notes under `.ai/docs/<workstream>/`.
