import type { ContextPacket, DisconnectReason, ProviderDeliveryReceipt, ProviderKind, ProviderSessionId, VoiceToolResultRecord, VoiceToolSurface } from "../types";
import type { ProviderConnectConfig, ProviderEventSink, RealtimeProviderAdapter, VoiceResponseRequest } from "./types";
import type { WebRTCHelperServer } from "../media/webrtc-helper/protocol";
import { usageFromOpenAIInputTranscription, usageFromOpenAIResponseDone } from "./openai-usage";
import { renderContextPacket } from "./shared";

export class OpenAIWebRTCBridgeAdapter implements RealtimeProviderAdapter {
	readonly provider: ProviderKind = "openai";
	readonly mediaMode = "webrtc" as const;
	private sink: ProviderEventSink | undefined;

	constructor(readonly providerSessionId: ProviderSessionId, private readonly helper: WebRTCHelperServer, private readonly createClientSecret: () => Promise<unknown>) {}

	async connect(config: ProviderConnectConfig, sink: ProviderEventSink): Promise<void> {
		this.sink = sink;
		this.helper.registerSession({ provider: config.provider, providerSessionId: config.providerSessionId, model: config.model, instructions: config.systemPrompt, toolSurface: config.toolSurface, initialContext: config.initialContext, createClientSecret: this.createClientSecret, normalizeUsageEvent: (input) => input.source === "response" ? usageFromOpenAIResponseDone(input.realtimeEvent, { providerSessionId: this.providerSessionId, model: config.model, providerEventId: input.providerEventId, at: input.at }) : usageFromOpenAIInputTranscription(input.realtimeEvent, { providerSessionId: this.providerSessionId, model: config.model, providerEventId: input.providerEventId, at: input.at }) }, { onProviderEvent: (event) => sink.onProviderEvent(event) });
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

	async sendToolResult(result: VoiceToolResultRecord): Promise<void> {
		this.enqueue({ type: "conversation.item.create", item: { type: "function_call_output", call_id: result.voiceToolCallId, output: result.resultText } });
		await this.requestResponse({ reason: "tool_result" });
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
		this.enqueue({ type: "response.create", response: { output_modalities: ["audio"], instructions: request.instructions } });
	}

	private enqueue(event: Record<string, unknown>): void {
		this.helper.enqueue(this.providerSessionId, event);
	}
}

export function createOpenAIWebRTCBridgeAdapter(providerSessionId: ProviderSessionId, helper: WebRTCHelperServer, createClientSecret: () => Promise<unknown>): OpenAIWebRTCBridgeAdapter {
	return new OpenAIWebRTCBridgeAdapter(providerSessionId, helper, createClientSecret);
}

