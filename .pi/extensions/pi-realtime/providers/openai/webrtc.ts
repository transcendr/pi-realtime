import OpenAI from "openai";
import type { ClientSecretCreateResponse } from "openai/resources/realtime/client-secrets";
import type { ProviderInteractionConfig } from "../../types";
import { buildOpenAIRealtimeAudioConfig } from "./session-config";
import { hasOpenAIRealtimeCredentials, toOpenAITool } from "./shared";

/** @deprecated Use hasOpenAIRealtimeCredentials from ./shared instead. */
export const hasOpenAIWebRTCCredentials = hasOpenAIRealtimeCredentials;

export async function createOpenAIWebRTCClientSecret(input: { model: string; instructions: string; interaction: ProviderInteractionConfig }): Promise<ClientSecretCreateResponse> {
	const client = new OpenAI();
	return client.realtime.clientSecrets.create({
		expires_after: { anchor: "created_at", seconds: 600 },
		session: {
			type: "realtime",
			model: input.model,
			instructions: input.instructions,
			output_modalities: ["audio"],
			audio: buildOpenAIRealtimeAudioConfig(),
			tools: input.interaction.tools.map(toOpenAITool),
			tool_choice: input.interaction.toolChoice,
		},
	});
}
