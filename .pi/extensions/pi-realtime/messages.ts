import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { VoiceInstructionInput, VoiceSessionRecord } from "./types";

export const REALTIME_REQUEST_MESSAGE_TYPE = "pi-realtime.request";
export const REALTIME_SESSION_MESSAGE_TYPE = "pi-realtime.session";

export function registerRealtimeMessageRenderers(pi: ExtensionAPI): void {
	pi.registerMessageRenderer(REALTIME_REQUEST_MESSAGE_TYPE, (message, _options, theme) => new Text(theme.fg("warning", `[realtime request] ${plainContent(message.content)}`), 0, 0));
	pi.registerMessageRenderer(REALTIME_SESSION_MESSAGE_TYPE, (message, _options, theme) => new Text(theme.fg("warning", `[realtime] ${plainContent(message.content)}`), 0, 0));
}

export function renderRealtimeRequestMessage(input: VoiceInstructionInput): string {
	const lines = [
		"Realtime voice request from the user.",
		"Treat this as the user's request delivered through the realtime interface. You are the backend worker for this request.",
		"Use realtime_send_ack for a short acknowledgement before work when appropriate, realtime_send_status for meaningful progress updates, and realtime_send_text for summaries/reports/final answers that should reach the realtime interface.",
		"Do not wait for the realtime interface to do backend work; perform the requested work here and report back through the realtime_send_* tools when useful.",
		"",
		"<request>",
		input.instructionText.trim(),
		"</request>",
	];
	const context = realtimeRequestContextLines(input);
	return context.length > 0 ? [...lines, "", "Context:", ...context].join("\n") : lines.join("\n");
}

export function renderRealtimeSessionMessage(session: VoiceSessionRecord, active: boolean): string {
	return active
		? `Realtime voice interface is active for session ${session.providerSessionId} (${session.provider}/${session.model}). This is non-turn-triggering session context for the next real Pi turn. If incoming work is delivered as a realtime request, actively use realtime_send_ack, realtime_send_status, and realtime_send_text as the main communication path back to the voice interface.`
		: `Realtime voice interface stopped for session ${session.providerSessionId} (${session.provider}/${session.model}). This is non-turn-triggering session context for the next real Pi turn. Realtime is not currently active unless another realtime session is explicitly reported active. Do not use realtime_send_* unless realtime_status shows a live target.`;
}

function realtimeRequestContextLines(input: VoiceInstructionInput): string[] {
	const lines: string[] = [];
	if (input.userUtteranceSummary) lines.push(`- User voice summary: ${input.userUtteranceSummary}`);
	if (input.citedCitationIds.length > 0) lines.push(`- Cited Pinotator citation ids: ${input.citedCitationIds.join(", ")}`);
	if (input.citationDeckRevision !== undefined) lines.push(`- Realtime citation deck revision: ${input.citationDeckRevision}`);
	lines.push(`- Realtime provider session id: ${input.providerSessionId}`);
	lines.push(`- Urgency: ${input.urgency}`);
	if (input.deliveryHint) lines.push(`- Delivery hint: ${input.deliveryHint}`);
	if (input.voiceToolCallId) lines.push(`- Realtime request call id: ${input.voiceToolCallId}`);
	return lines;
}

function plainContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) return content.map((part) => typeof part === "object" && part !== null && "text" in part && typeof part.text === "string" ? part.text : "[non-text content]").join(" ");
	return "";
}
