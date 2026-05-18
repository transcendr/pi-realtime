import OpenAI from "openai";
import type { ClientSecretCreateResponse } from "openai/resources/realtime/client-secrets";
import type { VoiceToolSurface } from "../types";
import { hasOpenAIRealtimeCredentials, toOpenAITool } from "./shared";

/** @deprecated Use hasOpenAIRealtimeCredentials from ./shared instead. */
export const hasOpenAIWebRTCCredentials = hasOpenAIRealtimeCredentials;

export async function createOpenAIWebRTCClientSecret(input: { model: string; instructions: string; toolSurface: VoiceToolSurface }): Promise<ClientSecretCreateResponse> {
	const client = new OpenAI();
	return client.realtime.clientSecrets.create({
		expires_after: { anchor: "created_at", seconds: 600 },
		session: {
			type: "realtime",
			model: input.model,
			instructions: input.instructions,
			output_modalities: ["audio"],
			audio: {
				input: { transcription: { model: "gpt-4o-mini-transcribe" }, turn_detection: { type: "semantic_vad", create_response: true, interrupt_response: true } },
				output: { voice: "marin" },
			},
			tools: input.toolSurface.tools.map(toOpenAITool),
			tool_choice: "auto",
		},
	});
}
