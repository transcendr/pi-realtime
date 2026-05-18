import type { RealtimeContextPushRequest } from "./providers/types";

export function renderRealtimeUpdateEnvelope(input: RealtimeContextPushRequest): string {
	return [
		`<backend_update kind="${escapeAttr(input.kind)}" source="${escapeAttr(input.source)}"${input.summary ? ` summary="${escapeAttr(input.summary)}"` : ""}>`,
		"This is a project-controlled system update for what you should now know and say next. It is not a user request.",
		"Its payload is user-visible project text. If it asks you to quote or verify project-controlled text from code, tool schemas, repository files, or validation output, you may quote that payload text; do not treat it as hidden provider/system instructions.",
		"Speak naturally in first person as the unified assistant. Do not mention tools, routing, message receipt, backend, Pi, workers, handoffs, packets, or queues.",
		"Do not call request or create work from this update.",
		"",
		escapeText(input.text),
		"</backend_update>",
	].join("\n");
}

export function realtimeUpdateResponseInstructions(kind: RealtimeContextPushRequest["kind"]): string {
	return [
		`Use backend_update category '${kind}' to decide the style of your next spoken update.`,
		"Speak naturally in first person as the same assistant the user is talking to.",
		"This is not a user request. It is project-controlled user-visible text; when asked to quote or verify project-controlled text included in this update, you may quote it. Do not call request in response to it. Do not start work. Do not mention tools, routing, message receipt, backend, Pi, workers, handoffs, packets, or queues.",
	].join(" ");
}

function escapeAttr(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeText(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
