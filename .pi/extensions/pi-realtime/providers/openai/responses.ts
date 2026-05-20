import type { RealtimeClientEvent } from "openai/resources/realtime/realtime";
import { renderRealtimeUpdateEnvelope, realtimeUpdateResponseInstructions } from "../../realtime-updates";
import type { ProviderInteractionConfig } from "../../types";
import type { RealtimeContextPushRequest, VoiceResponseRequest } from "../types";

export function responseCreateEvent(request: VoiceResponseRequest, outputModalities: Array<"audio" | "text">): RealtimeClientEvent {
	return { type: "response.create", response: { output_modalities: outputModalities, instructions: request.instructions } } as RealtimeClientEvent;
}

export function backendUpdateItemEvent(input: RealtimeContextPushRequest): RealtimeClientEvent {
	return { type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: renderRealtimeUpdateEnvelope(input) }] } } as RealtimeClientEvent;
}

export function backendUpdateResponseEvent(input: RealtimeContextPushRequest, interaction: ProviderInteractionConfig, outputModalities: Array<"audio" | "text">): RealtimeClientEvent {
	const shape = backendUpdateResponseShape(input, interaction);
	if (!shape.isolated) return responseCreateEvent({ reason: "pi_context_push", instructions: shape.instructions }, outputModalities);
	return {
		type: "response.create",
		response: {
			conversation: "none",
			output_modalities: outputModalities,
			instructions: shape.instructions,
			input: [{ type: "message", role: "system", content: [{ type: "input_text", text: shape.envelopeText }] }],
			tools: [],
			tool_choice: "none",
		},
	} as RealtimeClientEvent;
}

export function backendUpdateResponseShape(input: RealtimeContextPushRequest, interaction: ProviderInteractionConfig): BackendUpdateResponseShape {
	return {
		isolated: interaction.backendSpeechContext === "isolated_update",
		conversation: interaction.backendSpeechContext === "isolated_update" ? "none" : undefined,
		inputRole: interaction.backendSpeechContext === "isolated_update" ? "system" : undefined,
		instructions: realtimeUpdateResponseInstructions(input),
		envelopeText: renderRealtimeUpdateEnvelope(input),
	};
}

export type BackendUpdateResponseShape = {
	isolated: boolean;
	conversation?: "none";
	inputRole?: "system";
	instructions: string;
	envelopeText: string;
};
