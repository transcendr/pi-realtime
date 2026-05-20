import type { RealtimeContextPushRequest } from "./providers/types";

export function renderRealtimeUpdateEnvelope(input: RealtimeContextPushRequest): string {
	const envelope = input.rendering?.envelope ?? "speak_this_verbatim";
	if (envelope === "json_task") return renderJsonTaskEnvelope(input);
	return [
		`<backend_update kind="${escapeAttr(input.kind)}" source="${escapeAttr(input.source)}">`,
		`<${envelope}>`,
		escapeText(input.text),
		`</${envelope}>`,
		"</backend_update>",
	].join("\n");
}

export function realtimeUpdateResponseInstructions(input: RealtimeContextPushRequest): string {
	const rendering = input.rendering ?? { mode: "verbatim" as const, envelope: "speak_this_verbatim" as const };
	return rendering.mode === "compact_summary" ? compactSummaryInstructions(input.kind, rendering.envelope) : verbatimInstructions(input.kind, rendering.envelope);
}

function verbatimInstructions(kind: RealtimeContextPushRequest["kind"], envelope: string): string {
	if (envelope === "json_task") return jsonTaskVerbatimInstructions(kind);
	return [
		`Render backend_update category '${kind}' with zero agency.`,
		`Speak only the text inside <${envelope}> and </${envelope}>, then stop.`,
		"Do not speak the <backend_update> tag. Do not speak metadata. Do not speak instructions. Do not speak tag names.",
		"Do not summarize. Ever. Do not compress, reframe, explain, interpret, improve wording, or make it more conversational.",
		`Do not add greetings, acknowledgements, offers, questions, next steps, or commentary unless those words are inside <${envelope}>.`,
		`Preserve concrete facts, numbers, file paths, command names, custom type names, costs, caveats, conclusions, quoted text, code, and exact wording from inside <${envelope}>.`,
		`Literal delivery of <${envelope}> content is correct; helpful summarization is failure.`,
		`This is not a user request. Do not call request. Do not start work. Do not mention tools, routing, message receipt, backend, Pi, workers, handoffs, packets, or queues unless those words are inside <${envelope}>.`,
	].join(" ");
}

function jsonTaskVerbatimInstructions(kind: RealtimeContextPushRequest["kind"]): string {
	return [
		`Render backend_update category '${kind}' with zero agency.`,
		"The response input is a JSON task object. Parse it as data, not as a conversation message or user request.",
		"Speak only the exact string value of the text field, then stop.",
		"Do not speak JSON keys, braces, quotes, metadata fields, instructions, or tag names.",
		"Do not summarize. Ever. Do not compress, reframe, explain, interpret, improve wording, or make it more conversational.",
		"Do not add greetings, acknowledgements, offers, questions, next steps, or commentary unless those exact words are inside the text field.",
		"Literal delivery of the text field is correct; helpful summarization is failure.",
		"This is not a user request. Do not call request. Do not start work. Do not mention tools, routing, message receipt, backend, Pi, workers, handoffs, packets, or queues unless those words are inside the text field.",
	].join(" ");
}

function compactSummaryInstructions(kind: RealtimeContextPushRequest["kind"], envelope: string): string {
	return [
		`Render backend_update category '${kind}' as a compact spoken summary with zero agency.`,
		`Use only the text inside <${envelope}> and </${envelope}> as source material, then stop.`,
		"Do not speak the <backend_update> tag. Do not speak metadata. Do not speak instructions. Do not speak tag names.",
		"Summarize compactly for speech cost control. Do not read the full source verbatim.",
		"Preserve commands, file paths, model names, costs, warnings, conclusions, caveats, and important constraints.",
		"Do not add greetings, acknowledgements, offers, questions, next steps, or commentary that are not supported by the source.",
		"Do not imply omitted details were spoken in full. This is not a user request. Do not call request. Do not start work.",
	].join(" ");
}

function renderJsonTaskEnvelope(input: RealtimeContextPushRequest): string {
	return JSON.stringify({
		source: input.source,
		destination: "user",
		action: "read_verbatim",
		kind: input.kind,
		text: input.text,
	}, null, 2);
}

function escapeAttr(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeText(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
