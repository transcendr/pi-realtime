import type { RealtimeBehaviorProfile, RealtimeBehaviorProfileFragment, RealtimeInteractionModeId } from "../types";

export const DEFAULT_BEHAVIOR_PROFILE: RealtimeBehaviorProfile = {
	backendUpdateSpeech: {
		chunking: {
			enabled: false,
			maxChars: 800,
			splitStrategy: "sentence",
		},
	},
};

export function resolveRealtimeBehaviorProfile(input: {
	providerProfile?: RealtimeBehaviorProfileFragment;
	interactionMode: RealtimeInteractionModeId;
}): RealtimeBehaviorProfile {
	const chunking = input.providerProfile?.backendUpdateSpeech?.chunking;
	return {
		backendUpdateSpeech: {
			chunking: {
				...DEFAULT_BEHAVIOR_PROFILE.backendUpdateSpeech.chunking,
				...chunking,
			},
		},
	};
}
