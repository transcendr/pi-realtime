import { STRONG_REALTIME_SPEECH_RENDERER_PROFILE, WEAK_REALTIME_SPEECH_RENDERER_PROFILE } from "../../domain/behavior-profiles";
import type { RealtimeBehaviorProfileFragment } from "../../types";

export const OPENAI_REALTIME_MODELS = ["gpt-realtime-mini", "gpt-realtime-2"] as const;

export function openAIBehaviorProfileForModel(model: string): RealtimeBehaviorProfileFragment {
	if (model === "gpt-realtime-mini") return WEAK_REALTIME_SPEECH_RENDERER_PROFILE;
	if (model === "gpt-realtime-2") return STRONG_REALTIME_SPEECH_RENDERER_PROFILE;
	return {};
}
