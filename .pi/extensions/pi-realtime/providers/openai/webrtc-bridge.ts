import type { DebugTraceRecorder } from "../../debug-trace";
import type { ContextPacket, DisconnectReason, ProviderDeliveryReceipt, ProviderInteractionConfig, ProviderKind, ProviderSessionId, VoiceToolResultRecord, VoiceToolSurface } from "../../types";
import type { ProviderConnectConfig, ProviderEventSink, RealtimeProviderAdapter, RealtimeContextPushRequest, ToolResultResponsePolicy, VoiceResponseRequest } from "../types";
import type { WebRTCHelperServer } from "../../media/webrtc-helper/protocol";
import { backendUpdateItemEvent, backendUpdateResponseEvent, responseCreateEvent } from "./responses";
import { usageFromOpenAIInputTranscription, usageFromOpenAIResponseDone } from "./usage";
import { renderContextPacket } from "./shared";

export class OpenAIWebRTCBridgeAdapter implements RealtimeProviderAdapter {
	readonly provider: ProviderKind = "openai";
	readonly mediaMode = "webrtc" as const;
	private sink: ProviderEventSink | undefined;
	private interaction: ProviderInteractionConfig | undefined;

	constructor(readonly providerSessionId: ProviderSessionId, private readonly helper: WebRTCHelperServer, private readonly createClientSecret: () => Promise<unknown>, private readonly trace?: DebugTraceRecorder) {}

	async connect(config: ProviderConnectConfig, sink: ProviderEventSink): Promise<void> {
		this.sink = sink;
		this.interaction = config.interaction;
		this.helper.registerSession({
			provider: config.provider,
			providerSessionId: config.providerSessionId,
			model: config.model,
			instructions: config.systemPrompt,
			toolSurface: config.toolSurface,
			initialContext: config.initialContext,
			interaction: config.interaction,
			createClientSecret: this.createClientSecret,
			trace: this.trace,
			normalizeUsageEvent: (input) => input.source === "response"
				? usageFromOpenAIResponseDone(input.realtimeEvent, { providerSessionId: this.providerSessionId, model: config.model, providerEventId: input.providerEventId, at: input.at })
				: usageFromOpenAIInputTranscription(input.realtimeEvent, { providerSessionId: this.providerSessionId, model: config.model, providerEventId: input.providerEventId, at: input.at }),
		}, { onProviderEvent: (event) => sink.onProviderEvent(event) });
		sink.onProviderEvent({ type: "connected", provider: "openai", providerSessionId: this.providerSessionId, localSeq: Date.now(), at: Date.now() });
	}

	async disconnect(reason: DisconnectReason): Promise<void> {
		this.helper.unregisterSession(this.providerSessionId, reason);
		this.sink = undefined;
	}

	async updateContext(packet: ContextPacket): Promise<ProviderDeliveryReceipt> {
		this.enqueue({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: renderContextPacket(packet) }] } });
		return { status: "delivered", message: "context queued for WebRTC helper" };
	}

	async updateToolSurface(_surface: VoiceToolSurface): Promise<void> {
		return;
	}

	async sendToolResult(result: VoiceToolResultRecord, policy: ToolResultResponsePolicy = "none"): Promise<void> {
		this.enqueue({ type: "conversation.item.create", item: { type: "function_call_output", call_id: result.voiceToolCallId, output: result.resultText } });
		if (policy === "none") {
			this.trace?.write({ source: "provider_adapter", direction: "response_create_suppressed", reason: "tool_result_suppressed", voiceToolCallId: result.voiceToolCallId });
			return;
		}
		await this.requestResponse({ reason: policy === "final_ack" ? "tool_result_final_ack" : "tool_result_continue" });
	}

	async pushContext(input: RealtimeContextPushRequest): Promise<ProviderDeliveryReceipt> {
		const interaction = this.requireInteraction();
		const wantsResponse = input.mode === "request_spoken_response";
		if (!wantsResponse || interaction.backendSpeechContext !== "isolated_update") this.enqueue(realtimeClientEventRecord(backendUpdateItemEvent(input)));
		this.trace?.write({ source: "provider_adapter", direction: wantsResponse ? "context_push_response_requested" : "context_push_context_only", reason: "pi_context_push", mode: input.mode, updateKind: input.kind, pushSource: input.source, summary: input.summary, textLength: input.text.length });
		if (wantsResponse) this.enqueue(realtimeClientEventRecord(backendUpdateResponseEvent(input, interaction, ["audio"])));
		return { status: "delivered", message: wantsResponse ? "backend update queued and spoken response requested" : "backend update queued without response" };
	}

	async sendTextInput(text: string): Promise<ProviderDeliveryReceipt> {
		this.enqueue({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
		await this.requestResponse({ reason: "manual" });
		return { status: "delivered", message: "text queued for WebRTC helper" };
	}

	async sendAudioInput(_audio: Buffer): Promise<ProviderDeliveryReceipt> {
		return { status: "skipped", message: "WebRTC helper owns microphone capture" };
	}

	async setAudioOutputEnabled(_enabled: boolean): Promise<ProviderDeliveryReceipt> {
		return { status: "skipped", message: "WebRTC helper owns audio playback" };
	}

	async requestResponse(request: VoiceResponseRequest): Promise<void> {
		this.trace?.write({ source: "provider_adapter", direction: "response_create_requested", reason: request.reason });
		this.enqueue(realtimeClientEventRecord(responseCreateEvent(request, ["audio"])));
	}

	private enqueue(event: Record<string, unknown>): void {
		this.helper.enqueue(this.providerSessionId, event);
	}

	private requireInteraction(): ProviderInteractionConfig {
		if (!this.interaction) throw new Error("OpenAI WebRTC bridge is not connected.");
		return this.interaction;
	}
}

export function createOpenAIWebRTCBridgeAdapter(providerSessionId: ProviderSessionId, helper: WebRTCHelperServer, createClientSecret: () => Promise<unknown>, trace?: DebugTraceRecorder): OpenAIWebRTCBridgeAdapter {
	return new OpenAIWebRTCBridgeAdapter(providerSessionId, helper, createClientSecret, trace);
}

function realtimeClientEventRecord(event: object): Record<string, unknown> {
	return event as Record<string, unknown>;
}

