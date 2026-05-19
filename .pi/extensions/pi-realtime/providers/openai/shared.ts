import type { RealtimeFunctionTool } from "openai/resources/realtime/realtime";
import { loadProjectEnv } from "../../env";
import type { ContextPacket, VoiceToolName, VoiceToolSurface } from "../../types";

export function hasOpenAIRealtimeCredentials(env: NodeJS.ProcessEnv = process.env): boolean {
	loadProjectEnv(env);
	return typeof env.OPENAI_API_KEY === "string" && env.OPENAI_API_KEY.trim().length > 0;
}

export function renderContextPacket(packet: ContextPacket): string {
	return [`[pi-realtime:${packet.channel}:rev-${packet.revision}] ${packet.summary}`, ...packet.sections.map((section) => `${section.title}\n${section.text}`)].join("\n\n");
}

export function toOpenAITool(tool: VoiceToolSurface["tools"][number]): RealtimeFunctionTool {
	return { type: "function", name: tool.name, description: tool.description, parameters: toolParameters(tool.name) };
}

function toolParameters(name: VoiceToolName): unknown {
	if (name === "request") return { type: "object", additionalProperties: false, properties: { request: { type: "string", description: "Concise system request capturing the user's intent, constraints, urgency, and relevant context. Use for work, status, history, log, worktree, current-state, project design/configuration, implementation planning, 'where were we / what did we do last', and 'send it to the backend' requests." }, deliveryHint: { type: "string", enum: ["work", "progress"], description: "Use progress when the user is asking for current status/progress during an active task; those requests should steer the active turn. Use work for new work, design/config/history/status lookups outside an active task, or ordinary questions." }, urgency: { type: "string", enum: ["normal", "interrupt"] }, userUtteranceSummary: { type: "string" }, citedCitationIds: { type: "array", items: { type: "string" } } }, required: ["request"] };
	if (name === "pi_send_instruction") return { type: "object", additionalProperties: false, properties: { instruction: { type: "string" }, urgency: { type: "string", enum: ["normal", "interrupt"] }, userUtteranceSummary: { type: "string" }, citedCitationIds: { type: "array", items: { type: "string" } } }, required: ["instruction"] };
	if (name === "pinotator_citation_resolve") return { type: "object", additionalProperties: false, properties: { ref: { type: "string" }, includeFullText: { type: "boolean" } }, required: ["ref"] };
	if (name === "pinotator_citations_list") return { type: "object", additionalProperties: false, properties: { maxItems: { type: "number" }, includeSnippets: { type: "boolean" } } };
	if (name === "pi_wait_for_update") return { type: "object", additionalProperties: false, properties: { reason: { type: "string" }, expectedNext: { type: "string" } } };
	return { type: "object", additionalProperties: false, properties: {} };
}
