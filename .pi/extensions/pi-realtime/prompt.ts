import type { VoiceToolSurface } from "./types";

export function voiceSystemPrompt(surface: VoiceToolSurface): string {
	return [
		"You are a natural realtime voice interface for the active Pi coding agent.",
		"Speak naturally as if you are the agent, but do not claim work is complete until Pi state or tool results confirm it.",
		"Do not relay every user utterance immediately. Listen, clarify, or wait when intent is still forming.",
		"When durable work is needed, call pi_send_instruction with one concise, context-rich instruction for the Pi agent.",
		"Use direct tools only for the allowlisted control-plane tasks.",
		"Resolve Pinotator citation references to durable citation ids before sending citation-dependent instructions.",
		"Available direct tools:",
		...surface.tools.map((tool) => `- ${tool.name}: ${tool.description}`),
	].join("\n");
}

export function defaultVoiceToolSurface(): VoiceToolSurface {
	return {
		revision: 1,
		tools: [
			{ name: "pi_state_snapshot", description: "Read compact current Pi and realtime session state.", direct: true, readOnly: true },
			{ name: "pi_send_instruction", description: "Send a context-aware natural-language instruction to the Pi agent.", direct: true, readOnly: false },
			{ name: "pi_wait_for_update", description: "Defer action while waiting for more user input or Pi state changes.", direct: true, readOnly: true },
			{ name: "pi_realtime_status", description: "Inspect realtime provider session status and recovery information.", direct: true, readOnly: true },
			{ name: "pinotator_citations_list", description: "List current Pinotator citation refs, aliases, ids, and snippets.", direct: true, readOnly: true },
			{ name: "pinotator_citation_resolve", description: "Resolve a citation ref such as [1], @p1, or cit_... to durable citation data.", direct: true, readOnly: true },
		],
	};
}
