import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Service } from "../service";
import type { RealtimePushSource } from "../types";

const RealtimeSendParams = Type.Object({
	text: Type.String({ description: "Non-empty message to send to the active realtime voice interface." }),
	providerSessionId: Type.Optional(Type.String({ description: "Optional realtime provider session id. Defaults to the realtime session that originated the current request, then the active primary/live session." })),
	summary: Type.Optional(Type.String({ description: "Optional compact trace/UI label for the update." })),
});

const RealtimeStatusParams = Type.Object({
	providerSessionId: Type.Optional(Type.String({ description: "Optional realtime provider session id to check. Defaults to the current realtime send target." })),
});

export function registerRealtimeModelTools(pi: ExtensionAPI, service: Service): void {
	registerRealtimeStatusTool(pi, service);
	registerRealtimeSendTool(pi, service, {
		name: "realtime_send_ack",
		label: "Realtime Ack",
		description: "Send a short, contextually relevant spoken acknowledgement to the active realtime voice interface before requested work is done, phrased as what the unified assistant is doing now.",
		kind: "ack",
		source: "pi_model_tool",
		defaultSummary: "acknowledgement",
	});
	registerRealtimeSendTool(pi, service, {
		name: "realtime_send_status",
		label: "Realtime Status",
		description: "Send a concise progress update to the active realtime voice interface during work: checkpoints, milestones, achievements, failures, successes, approach changes, or useful diversions. Prefer this for long-running implementation or investigation turns.",
		kind: "status",
		source: "pi_model_tool",
		defaultSummary: "status update",
	});
	registerRealtimeSendTool(pi, service, {
		name: "realtime_send_text",
		label: "Realtime Text",
		description: "Send summaries, reports, final answers, or other text context to the active realtime voice interface when ack/status is not the right category. Use for final reports back to a realtime-originated request.",
		kind: "text",
		source: "pi_model_tool",
		defaultSummary: "text update",
	});
}

function registerRealtimeStatusTool(pi: ExtensionAPI, service: Service): void {
	pi.registerTool({
		name: "realtime_status",
		label: "Realtime Status",
		description: "Check whether a realtime voice session is active/live and whether realtime_send_* tools can currently reach it. Use before realtime sends when status is uncertain or after a realtime send reports no active session.",
		promptSnippet: "Check current realtime voice session status and send-tool availability.",
		promptGuidelines: [
			"Use realtime_status to check current realtime voice session status directly when you are unsure whether realtime is active/live.",
			"If realtime_status reports no live realtime send target, continue normally in Pi and do not repeatedly call realtime_send_* tools.",
			"Use realtime_status before choosing a providerSessionId manually unless the realtime request context already gave the exact active session id.",
		],
		parameters: RealtimeStatusParams,
		async execute(_toolCallId, params) {
			const text = service.realtimeStatusText(params.providerSessionId);
			return { content: [{ type: "text", text }], details: { providerSessionId: params.providerSessionId } };
		},
	});
}

function registerRealtimeSendTool(pi: ExtensionAPI, service: Service, input: { name: "realtime_send_ack" | "realtime_send_status" | "realtime_send_text"; label: string; description: string; kind: "ack" | "status" | "text"; source: RealtimePushSource; defaultSummary: string }): void {
	pi.registerTool({
		name: input.name,
		label: input.label,
		description: input.description,
		promptSnippet: input.description,
		promptGuidelines: [
			`Use ${input.name} only to communicate with an active realtime voice session, especially when the current work originated from realtime.`,
			`If ${input.name} reports that no realtime session is active, continue normally in Pi and do not keep retrying the realtime send tools.`,
			`Keep ${input.name} content compact, user-relevant, and free of internal implementation chatter unless the user asked for that detail.`,
		],
		parameters: RealtimeSendParams,
		async execute(_toolCallId, params) {
			const message = await service.pushRealtimeContext({ providerSessionId: params.providerSessionId, text: params.text, mode: "request_spoken_response", source: input.source, kind: input.kind, summary: params.summary ?? input.defaultSummary });
			return { content: [{ type: "text", text: message }], details: { providerSessionId: params.providerSessionId, tool: input.name, summary: params.summary ?? input.defaultSummary } };
		},
	});
}
