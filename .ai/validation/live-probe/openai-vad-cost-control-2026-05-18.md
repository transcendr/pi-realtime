# OpenAI VAD/cost-control live probe — 2026-05-18

Trace inspected after first implementation pass:

```text
/var/folders/8j/f35z086s553cjd2cbqzj94hw0000gn/T/pi-realtime-traces/openai_2b55afb1-3ff8-4f32-8b98-b250e2dca6b8-1779120073769.jsonl
```

Evidence:

- Session trace confirmed the new config was loaded:
  - `vadMode: semantic_vad`
  - `createResponse: false`
  - `interruptResponse: true`
  - `noiseReduction: near_field`
- The explicit-response gate worked mechanically: OpenAI did not auto-create responses on VAD stop; the helper sent `openai_outbound_response_create` after transcript completion.
- However, official semantic VAD + near-field noise reduction still accepted very small non-command vocalizations as non-empty transcripts:
  - `Why, hello there.` for the intentional hello test.
  - `Mhm.` for a throat-clear/minimal vocalization.
  - `응.` for a slight `hmm` vocalization.
- Because the MVP accepted any non-empty transcript, all three produced assistant responses.

Conclusion:

- `create_response=false` fixed automatic response timing but is not sufficient by itself to prevent nuisance/costly responses to non-command vocalizations.
- The next official-provider-side measure is to switch the default VAD mode from `semantic_vad` to `server_vad` with a higher activation threshold, while keeping `create_response=false`, `interrupt_response=true`, and OpenAI noise reduction enabled.
- This remains within the stated constraint to exhaust official OpenAI/server-side controls before custom browser-side audio gates.

Follow-up implemented after this probe:

- Default OpenAI VAD mode changed to `server_vad`.
- Server VAD threshold set to `0.7`.
- Silence duration set to `700ms`.
- Prefix padding kept at `300ms`.
- Idle timeout remains `null`.
- Semantic eagerness remains unset; no `eagerness: "low"` change was made.
