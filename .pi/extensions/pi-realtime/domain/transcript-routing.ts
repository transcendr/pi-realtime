import { randomUUID } from "node:crypto";
import type { CitationId, InstructionId, NormalizedProviderEvent, PiTargetRef, RealtimeInteractionMode, VoiceInstructionInput, VoiceSessionRecord } from "../types";

export type UserTranscriptEvent = Extract<NormalizedProviderEvent, { type: "user_transcript" }>;

export type TranscriptIgnoreReason = "mode_uses_model" | "non_final" | "empty" | "low_information";

export type TranscriptRouteDecision =
	| { action: "ignore"; reason: TranscriptIgnoreReason }
	| { action: "submit_instruction"; input: VoiceInstructionInput };

export type TranscriptRouteInput = {
	event: UserTranscriptEvent;
	session: VoiceSessionRecord;
	mode: RealtimeInteractionMode;
	target: PiTargetRef;
	citationDeckRevision?: number;
	citedCitationIds?: CitationId[];
	newInstructionId?: () => InstructionId;
};

export function routeTranscriptToInstruction(input: TranscriptRouteInput): TranscriptRouteDecision {
	if (input.mode.providerInteraction.transcriptHandling.backendRoute !== "submit_instruction") return { action: "ignore", reason: "mode_uses_model" };
	if (!input.event.final) return { action: "ignore", reason: "non_final" };
	const text = input.event.text.trim();
	if (!text) return { action: "ignore", reason: "empty" };
	if (!isActionableTranscript(text)) return { action: "ignore", reason: "low_information" };
	return { action: "submit_instruction", input: transcriptInstruction(input, text) };
}

export function isActionableTranscript(transcript: string): boolean {
	return transcript.replace(/[\s\p{P}\p{S}]/gu, "").length >= 4;
}

function transcriptInstruction(input: TranscriptRouteInput, instructionText: string): VoiceInstructionInput {
	return {
		instructionId: input.event.providerEventId ? `transcript_${input.event.providerEventId}` : input.newInstructionId?.() ?? `transcript_${randomUUID()}`,
		source: "direct_transcript",
		provider: input.event.provider,
		providerSessionId: input.event.providerSessionId,
		target: input.target,
		urgency: "normal",
		deliveryHint: "work",
		instructionText,
		userUtteranceSummary: instructionText,
		citedCitationIds: input.citedCitationIds ?? [],
		citationDeckRevision: input.citationDeckRevision,
	};
}
