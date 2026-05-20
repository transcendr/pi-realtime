import { defaultVoiceToolSurface, voiceSpeechRendererPrompt, voiceSystemPrompt } from "../prompt";
import type { ProviderInteractionConfig, RealtimeInteractionMode, RealtimeInteractionModeId, VoiceToolSurface } from "../types";

const REQUEST_TOOL_SURFACE = defaultVoiceToolSurface();
const EMPTY_TOOL_SURFACE: VoiceToolSurface = { revision: 1, tools: [] };

const AGENT_MODE: RealtimeInteractionMode = {
	id: "agent",
	toolSurface: REQUEST_TOOL_SURFACE,
	systemPrompt: voiceSystemPrompt,
	acceptModelToolCalls: true,
	initialContextPolicy: "full",
	providerInteraction: {
		mode: "agent",
		tools: REQUEST_TOOL_SURFACE.tools,
		toolChoice: "auto",
		transcriptHandling: { response: "model", backendRoute: "none", retention: "retain" },
		backendSpeechContext: "default_conversation",
	},
};

const ECO_MODE: RealtimeInteractionMode = {
	id: "eco",
	toolSurface: EMPTY_TOOL_SURFACE,
	systemPrompt: voiceSpeechRendererPrompt,
	acceptModelToolCalls: false,
	initialContextPolicy: "minimal",
	providerInteraction: {
		mode: "eco",
		tools: [],
		toolChoice: "none",
		transcriptHandling: { response: "suppress", backendRoute: "submit_instruction", retention: "delete_after_transcript" },
		backendSpeechContext: "isolated_update",
	},
};

const MODES: Record<RealtimeInteractionModeId, RealtimeInteractionMode> = {
	agent: AGENT_MODE,
	eco: ECO_MODE,
};

export function interactionMode(id: RealtimeInteractionModeId | undefined): RealtimeInteractionMode {
	return MODES[id ?? "agent"] ?? AGENT_MODE;
}

export function parseInteractionMode(value: string | undefined): RealtimeInteractionModeId | undefined {
	return value === "agent" || value === "eco" ? value : undefined;
}

export function providerInteractionFor(id: RealtimeInteractionModeId | undefined): ProviderInteractionConfig {
	return interactionMode(id).providerInteraction;
}

export function toolSurfaceFor(id: RealtimeInteractionModeId | undefined): VoiceToolSurface {
	return interactionMode(id).toolSurface;
}
