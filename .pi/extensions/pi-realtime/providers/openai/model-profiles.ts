import type { RealtimeBehaviorProfileFragment } from "../../types";

export const OPENAI_REALTIME_MODELS = ["gpt-realtime-mini", "gpt-realtime-2"] as const;

export function openAIBehaviorProfileForModel(model: string): RealtimeBehaviorProfileFragment {
	if (model === "gpt-realtime-mini") {
		return {
			backendUpdateSpeech: {
				chunking: {
					enabled: true,
					maxChars: 800,
					splitStrategy: "sentence",
				},
			},
		};
	}
	return {};
}
