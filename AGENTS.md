# pi-realtime Agent Guidance

## ZERO-TOLERANCE PROJECT RULE: WE ARE NOT VIBE CODING

- I AM NOT A VIBE CODER. DO NOT OPERATE LIKE ONE.
- This repo is for careful engineering, not “ship a hack and hope.”
- Do not respond to realtime audio bugs, feedback loops, cost surprises, hallucinated tool calls, provider weirdness, or user safety issues by immediately changing behavior.
- First investigate root cause with evidence: event logs, provider events, helper logs, session state, exact reproduction steps, and code-path tracing.
- Do not paper over symptoms by disabling core realtime features such as barge-in, interruption, streaming, WebRTC behavior, or provider semantics unless the user explicitly approves that tradeoff.
- Do not add prompt-only fixes, cooldowns, mutes, heuristics, or rejection guards as a substitute for root-cause analysis.
- If a mitigation is proposed, label it as a mitigation, explain what root cause it does and does not address, and ask before implementation when it changes product behavior.
- Do not treat green gates as proof of live OpenAI/WebRTC/microphone behavior unless the gate actually tests that live behavior.
- Preserve provider-neutral architecture and realtime interaction semantics unless the user explicitly chooses a different design.

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
