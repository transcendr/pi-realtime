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
	if (interaction.backendSpeechContext !== "isolated_update") return responseCreateEvent({ reason: "pi_context_push", instructions: realtimeUpdateResponseInstructions(input) }, outputModalities);
	return {
		type: "response.create",
		response: {
			conversation: "none",
			output_modalities: outputModalities,
			instructions: realtimeUpdateResponseInstructions(input),
			input: [{ type: "message", role: "system", content: [{ type: "input_text", text: renderRealtimeUpdateEnvelope(input) }] }],
			tools: [],
			tool_choice: "none",
		},
	} as RealtimeClientEvent;
}
