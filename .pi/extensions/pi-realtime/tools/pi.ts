import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Service } from "../service";

export function registerRealtimeModelTools(pi: ExtensionAPI, service: Service): void {
	pi.registerTool({
		name: "pi_realtime_send_text",
		label: "Send Text to Realtime",
		description: "Push Pi text, status, or report content into the active realtime voice session context.",
		promptSnippet: "Send explicit Pi updates into the realtime voice agent context.",
		promptGuidelines: [
			"Use pi_realtime_send_text only when the user explicitly wants Pi to update the realtime voice session, or when reporting completion of work that originated from a realtime voice instruction.",
			"Use pi_realtime_send_text with mode context_only for silent context transfer and request_spoken_response only when the realtime agent should speak to the user.",
			"Do not use pi_realtime_send_text to forward arbitrary unrelated transcript content; keep text compact and relevant.",
		],
		parameters: Type.Object({
			text: Type.String({ description: "Non-empty Pi update text/status/report to place into realtime context." }),
			providerSessionId: Type.Optional(Type.String({ description: "Optional realtime provider session id. Defaults to the primary realtime session." })),
			mode: Type.Optional(Type.Union([Type.Literal("context_only"), Type.Literal("request_spoken_response")], { description: "context_only adds context without speech; request_spoken_response also asks realtime to speak once." })),
			summary: Type.Optional(Type.String({ description: "Optional compact trace/UI label for the update." })),
			audience: Type.Optional(Type.Union([Type.Literal("voice_agent"), Type.Literal("user"), Type.Literal("both")], { description: "Intended audience; currently recorded for caller clarity." })),
		}),
		async execute(_toolCallId, params) {
			const message = await service.pushRealtimeContext({ providerSessionId: params.providerSessionId, text: params.text, mode: params.mode ?? "context_only", source: "pi_model_tool", summary: params.summary });
			return { content: [{ type: "text", text: message }], details: { providerSessionId: params.providerSessionId, mode: params.mode ?? "context_only", summary: params.summary, audience: params.audience ?? "voice_agent" } };
		},
	});
}
