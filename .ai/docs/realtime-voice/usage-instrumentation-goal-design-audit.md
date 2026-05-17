# Usage Instrumentation Goal Design Audit

Date: 2026-05-17
Objective audited: `design a goal to implement instrumentation cleanly, modularized and encapsulated logic`.

## Restated deliverables / success criteria

The active goal is a design task, not the implementation itself. It is complete if there is a concrete implementation goal plan that:

1. Defines the instrumentation objective and why it is needed.
2. Specifies clean modular boundaries.
3. Encapsulates provider-specific parsing away from provider-neutral core logic.
4. Includes durable/replay-aware state design.
5. Includes user-facing usage inspection commands.
6. Includes validation and documentation requirements.
7. Avoids repeating already completed raw/WebRTC provider work.
8. Provides completion criteria for the future implementation goal.

## Prompt-to-artifact checklist

| Requirement | Evidence inspected | Status |
| --- | --- | --- |
| Design a goal | `.ai/docs/realtime-voice/usage-instrumentation-goal-plan.md` exists and starts with objective/status. | Met |
| Implement instrumentation | Plan has deliverables for usage event capture, cost estimation, persistence, commands, WebRTC forwarding, docs, and probes. | Met |
| Clean modularized logic | Plan introduces `.pi/extensions/pi-realtime/usage.ts`, optional `usage-pricing.ts`, and `.pi/extensions/pi-realtime/providers/openai-usage.ts`; commands/service/browser stay thin. | Met |
| Encapsulated logic | Plan places provider-specific OpenAI payload parsing in `providers/openai-usage.ts`; provider-neutral aggregation/pricing in `usage.ts`; browser helper only forwards/logs compact usage. | Met |
| Durable/replay-aware state | Plan adds `usage_observed` event, state replay handling, branch-aware persistence through existing store, and `/reload`/`/tree`/resume criteria. | Met |
| User-visible command | Plan specifies `/realtime usage`, `/realtime usage --session <providerSessionId>`, and `/realtime usage --details`, plus help/completion updates. | Met |
| Actual Realtime usage sources | Plan names `response.done.response.usage` and `conversation.item.input_audio_transcription.completed.usage`. | Met |
| Validation coverage | Plan requires deterministic probes for cost math, OpenAI raw adapter, WebRTC helper, state replay, and command/help coverage. | Met |
| Documentation coverage | Plan requires README, openai smoke test doc, and proof matrix updates. | Met |
| Avoid repeating completed work | Plan explicitly lists non-goals: no push-to-talk first, no context reduction first, no raw/WebRTC removal, no steering redesign. | Met |
| Future implementation completion criteria | Plan has a `Completion criteria` section mapping implementation done conditions. | Met |

## Evidence commands

Inspected the generated plan with `read` and verified key anchors with:

```bash
test -f .ai/docs/realtime-voice/usage-instrumentation-goal-plan.md \
  && rg -n "usage\.ts|providers/openai-usage\.ts|/realtime usage|response\.done|input_audio_transcription|Completion criteria|Prompt-to-artifact checklist|Non-goals|Suggested implementation sequence" \
    .ai/docs/realtime-voice/usage-instrumentation-goal-plan.md
```

The command found all required anchors.

## Audit decision

The active design goal is achieved. The implementation itself remains future work and should be started as a separate goal using `.ai/docs/realtime-voice/usage-instrumentation-goal-plan.md` as the execution plan.
