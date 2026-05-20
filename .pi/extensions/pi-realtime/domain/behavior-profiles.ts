import type { RealtimeBehaviorProfile, RealtimeBehaviorProfileFragment, RealtimeInteractionModeId } from "../types";

export const DEFAULT_BEHAVIOR_PROFILE: RealtimeBehaviorProfile = {
	backendUpdateSpeech: {
		chunking: {
			enabled: false,
			maxChars: 800,
			splitStrategy: "sentence",
		},
		rendering: {
			systemPromptMode: "strict_verbatim",
			envelope: "speak_this_verbatim",
			defaultMode: "verbatim",
		},
	},
};

export const WEAK_REALTIME_SPEECH_RENDERER_PROFILE: RealtimeBehaviorProfileFragment = {
	backendUpdateSpeech: {
		chunking: {
			enabled: true,
			maxChars: 800,
			splitStrategy: "sentence",
		},
		rendering: {
			systemPromptMode: "strict_verbatim",
			envelope: "json_task",
			defaultMode: "verbatim",
		},
	},
};

export const STRONG_REALTIME_SPEECH_RENDERER_PROFILE: RealtimeBehaviorProfileFragment = {
	backendUpdateSpeech: {
		rendering: {
			systemPromptMode: "per_response_rendering",
			envelope: "speech_source",
			defaultMode: "verbatim",
			longTextThresholdChars: 300,
			longTextMode: "compact_summary",
		},
	},
};

export function resolveRealtimeBehaviorProfile(input: {
	providerProfile?: RealtimeBehaviorProfileFragment;
	interactionMode: RealtimeInteractionModeId;
}): RealtimeBehaviorProfile {
	const speech = input.providerProfile?.backendUpdateSpeech;
	return {
		backendUpdateSpeech: {
			chunking: {
				...DEFAULT_BEHAVIOR_PROFILE.backendUpdateSpeech.chunking,
				...speech?.chunking,
			},
			rendering: {
				...DEFAULT_BEHAVIOR_PROFILE.backendUpdateSpeech.rendering,
				...speech?.rendering,
			},
		},
	};
}
