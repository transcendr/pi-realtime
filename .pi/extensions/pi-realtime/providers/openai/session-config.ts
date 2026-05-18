import type { RealtimeAudioConfig } from "openai/resources/realtime/realtime";

export type OpenAINoiseReductionMode = "near_field" | "far_field" | "off";
export type OpenAITurnControlMode = "manual_response_after_turn" | "auto_response";
export type OpenAIVadMode = "semantic" | "server";

export type OpenAIRealtimeAudioConfigInput = {
	turnControl?: OpenAITurnControlMode;
	noiseReduction?: OpenAINoiseReductionMode;
	vadMode?: OpenAIVadMode;
	includeRawPcmFormat?: boolean;
	includeRawPcmOutputFormat?: boolean;
	voice?: string;
};

const DEFAULT_NOISE_REDUCTION: OpenAINoiseReductionMode = "near_field";
const DEFAULT_TURN_CONTROL: OpenAITurnControlMode = "manual_response_after_turn";
const DEFAULT_VAD_MODE: OpenAIVadMode = "server";
const DEFAULT_SERVER_VAD_THRESHOLD = 0.7;
const DEFAULT_SERVER_VAD_SILENCE_DURATION_MS = 700;
const DEFAULT_SERVER_VAD_PREFIX_PADDING_MS = 300;

export function summarizeOpenAIRealtimeAudioConfig(input: OpenAIRealtimeAudioConfigInput = {}): Record<string, unknown> {
	const audio = buildOpenAIRealtimeAudioConfig(input);
	const turnDetection = audio.input?.turn_detection;
	return {
		vadMode: turnDetection?.type,
		createResponse: isRecord(turnDetection) ? turnDetection.create_response : undefined,
		interruptResponse: isRecord(turnDetection) ? turnDetection.interrupt_response : undefined,
		noiseReduction: audio.input?.noise_reduction?.type ?? "off",
		semanticEagerness: isRecord(turnDetection) ? turnDetection.eagerness : undefined,
		serverVadThreshold: isRecord(turnDetection) ? turnDetection.threshold : undefined,
		serverVadSilenceDurationMs: isRecord(turnDetection) ? turnDetection.silence_duration_ms : undefined,
	};
}

export function buildOpenAIRealtimeAudioConfig(input: OpenAIRealtimeAudioConfigInput = {}): RealtimeAudioConfig {
	const noiseReduction = input.noiseReduction ?? DEFAULT_NOISE_REDUCTION;
	return {
		input: {
			...(input.includeRawPcmFormat ? { format: { type: "audio/pcm", rate: 24000 } } : {}),
			transcription: { model: "gpt-4o-mini-transcribe" },
			...(noiseReduction === "off" ? {} : { noise_reduction: { type: noiseReduction } }),
			turn_detection: turnDetectionConfig(input),
		},
		output: {
			...(input.includeRawPcmOutputFormat ? { format: { type: "audio/pcm", rate: 24000 } } : {}),
			voice: input.voice ?? "marin",
		},
	};
}

export function openAITurnResponseControl(input: OpenAIRealtimeAudioConfigInput = {}): { create_response: boolean; interrupt_response: true } {
	return { create_response: (input.turnControl ?? DEFAULT_TURN_CONTROL) === "auto_response", interrupt_response: true };
}

export function isOpenAITranscriptActionable(transcript: string): boolean {
	return transcript.replace(/[\s\p{P}\p{S}]/gu, "").length >= 4;
}

function turnDetectionConfig(input: OpenAIRealtimeAudioConfigInput): NonNullable<NonNullable<RealtimeAudioConfig["input"]>["turn_detection"]> {
	const responseControl = openAITurnResponseControl(input);
	if ((input.vadMode ?? DEFAULT_VAD_MODE) === "server") {
		return { type: "server_vad", threshold: DEFAULT_SERVER_VAD_THRESHOLD, silence_duration_ms: DEFAULT_SERVER_VAD_SILENCE_DURATION_MS, prefix_padding_ms: DEFAULT_SERVER_VAD_PREFIX_PADDING_MS, idle_timeout_ms: null, ...responseControl };
	}
	return { type: "semantic_vad", ...responseControl };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
