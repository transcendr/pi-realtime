# OpenAI VAD/cost-control live probe — second pass — 2026-05-18

Trace inspected:

```text
/var/folders/8j/f35z086s553cjd2cbqzj94hw0000gn/T/pi-realtime-traces/openai_6f4bb2da-116e-4a2b-bb8b-b7e3d212eb87-1779120416147.jsonl
```

Config evidence from trace:

```json
{"vadMode":"server_vad","createResponse":false,"interruptResponse":true,"noiseReduction":"near_field","serverVadThreshold":0.7,"serverVadSilenceDurationMs":700}
```

Live behavior observed:

- Intentional hello was detected and transcribed as `Halo.`; helper sent `response.create` and assistant responded.
- Throat clear was apparently ignored during the user's manual test report.
- A very slight `hmm` was still detected by OpenAI server VAD and transcribed as `음.`.
- Because the helper still accepted any non-empty transcript, it sent `response.create`.
- The realtime model then used residual citation context and called `pinotator_citation_resolve` followed by `pi_send_instruction`, producing a nonsense Pi instruction.

Conclusion:

- Official OpenAI controls improved the throat-clear case but did not prevent non-empty low-information vocalizations from creating turns.
- The remaining problem is not OpenAI auto-response; `create_response=false` is working.
- The weak point is the helper's local acceptance policy: non-empty transcript was treated as actionable.

Follow-up implemented after this probe:

- Added a generic low-information transcript gate before local `response.create`.
- The gate is not a filler/backchannel word list. It strips whitespace, punctuation, and symbols and requires at least 4 lexical characters before asking the realtime model to respond.
- Expected effect for this trace's bad case: `음.` has lexical length 1 and would be suppressed with reason `low_information_transcript`.
- The raw OpenAI adapter now uses the same generic `isOpenAITranscriptActionable` helper.

Known tradeoff:

- Very short legitimate utterances such as `yes`, `no`, or `hi` may be suppressed unless captured with enough lexical content. This is an explicit conservative cost/safety tradeoff for the current voice-debugging phase and should be revisited after more official-provider signal options are investigated.
