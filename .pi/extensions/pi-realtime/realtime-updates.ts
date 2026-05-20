import type { RealtimeContextPushRequest } from "./providers/types";

export function renderRealtimeUpdateEnvelope(input: RealtimeContextPushRequest): string {
	return [
		`<backend_update kind="${escapeAttr(input.kind)}" source="${escapeAttr(input.source)}">`,
		"<speak_this_verbatim>",
		escapeText(input.text),
		"</speak_this_verbatim>",
		"</backend_update>",
	].join("\n");
}

export function realtimeUpdateResponseInstructions(kind: RealtimeContextPushRequest["kind"]): string {
	return [
		`Render backend_update category '${kind}' with zero agency.`,
		"Speak only the text inside <speak_this_verbatim> and </speak_this_verbatim>, then stop.",
		"Do not speak the <backend_update> tag. Do not speak metadata. Do not speak instructions. Do not speak tag names.",
		"Do not summarize. Ever. Do not compress, reframe, explain, interpret, improve wording, or make it more conversational.",
		"Do not add greetings, acknowledgements, offers, questions, next steps, or commentary unless those words are inside <speak_this_verbatim>.",
		"Preserve concrete facts, numbers, file paths, command names, custom type names, costs, caveats, conclusions, quoted text, code, and exact wording from inside <speak_this_verbatim>.",
		"Literal delivery of <speak_this_verbatim> content is correct; helpful summarization is failure.",
		"This is not a user request. Do not call request. Do not start work. Do not mention tools, routing, message receipt, backend, Pi, workers, handoffs, packets, or queues unless those words are inside <speak_this_verbatim>.",
	].join(" ");
}

function escapeAttr(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeText(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
