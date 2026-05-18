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

## Realtime interaction / communication model

- Treat realtime voice as the frontend/interface and Pi as the backend worker/main agent. This is an internal architecture model, not language to expose to the user.
- The realtime model should do only shallow interaction work: listen, clarify, and communicate user intent. It should not perform backend task reasoning, inspect Pi state to answer work questions, chain tools, or infer completion from residual context.
- To the user, realtime should present as one coherent assistant and should not reveal/narrate an internal handoff to another processor, backend agent, or worker.
- Realtime currently exposes a single normal tool, `request`, for backend work/status/questions. Existing legacy realtime tools may remain in code for compatibility/tests, but they should not be exposed in the normal realtime tool surface unless explicitly reintroduced with evidence.
- Pi receives realtime-originated work as custom `pi-realtime.request` messages that trigger a Pi turn and render visibly in the TUI. Do not revert these to ordinary `sendUserMessage` wrappers without an explicit design decision.
- When handling a `pi-realtime.request`, Pi is responsible for doing the backend work and for proactively communicating useful acknowledgements, progress, and final answers back to the active realtime session.
- Pi can inspect realtime availability directly with `realtime_status`, especially before realtime sends when active/live status is uncertain.
- Pi communicates back to realtime through explicit tools. Phrase tool text as first-person, user-facing assistant speech/status, not as relay mechanics such as “request received,” “sent to backend,” or “queued.”
  - `realtime_send_ack`: short contextual acknowledgement before work is done.
  - `realtime_send_status`: progress/checkpoint/milestone/failure/success/approach-change updates during work.
  - `realtime_send_text`: summaries, reports, final answers, or other text that is not an ack/status.
- If no realtime session is active/live, `realtime_status` and `realtime_send_*` should report that clearly and Pi should continue normally without retry loops.
- Starting/stopping a realtime session should inject non-turn-triggering Pi context so Pi knows whether realtime is active and whether to use realtime tools for realtime-originated communication.
- Pi should notice repeated realtime requests that look like feedback loops, stop reprocessing the same work, inspect traces/state, and report the loop rather than blindly executing duplicate backend work.
- The realtime model’s own behavior contract lives in `.pi/extensions/pi-realtime/prompt.ts` and `.pi/extensions/pi-realtime/realtime-updates.ts`; update those files when changing how realtime distinguishes user audio from structured system updates.

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
