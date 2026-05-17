import OpenAI from "openai";
import type { RealtimeFunctionTool } from "openai/resources/realtime/realtime";
import type { ClientSecretCreateResponse } from "openai/resources/realtime/client-secrets";
import type { VoiceToolName, VoiceToolSurface } from "../types";

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

export function hasOpenAIWebRTCCredentials(env: NodeJS.ProcessEnv = process.env): boolean {
	return typeof env.OPENAI_API_KEY === "string" && env.OPENAI_API_KEY.trim().length > 0;
}

function toOpenAITool(tool: VoiceToolSurface["tools"][number]): RealtimeFunctionTool {
	return { type: "function", name: tool.name, description: tool.description, parameters: toolParameters(tool.name) };
}

function toolParameters(name: VoiceToolName): unknown {
	if (name === "pi_send_instruction") return { type: "object", additionalProperties: false, properties: { instruction: { type: "string" }, urgency: { type: "string", enum: ["normal", "interrupt"] }, userUtteranceSummary: { type: "string" }, citedCitationIds: { type: "array", items: { type: "string" } } }, required: ["instruction"] };
	if (name === "pinotator_citation_resolve") return { type: "object", additionalProperties: false, properties: { ref: { type: "string" }, includeFullText: { type: "boolean" } }, required: ["ref"] };
	if (name === "pinotator_citations_list") return { type: "object", additionalProperties: false, properties: { maxItems: { type: "number" }, includeSnippets: { type: "boolean" } } };
	if (name === "pi_wait_for_update") return { type: "object", additionalProperties: false, properties: { reason: { type: "string" }, expectedNext: { type: "string" } } };
	return { type: "object", additionalProperties: false, properties: {} };
}
