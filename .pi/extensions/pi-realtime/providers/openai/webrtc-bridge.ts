import { createHash } from "node:crypto";
import type { DebugTraceRecorder } from "../../debug-trace";
import type { ContextPacket, DisconnectReason, NormalizedProviderEvent, ProviderDeliveryReceipt, ProviderInteractionConfig, ProviderKind, ProviderSessionId, VoiceToolResultRecord, VoiceToolSurface } from "../../types";
import type { ProviderConnectConfig, ProviderEventSink, RealtimeProviderAdapter, RealtimeContextPushRequest, ToolResultResponsePolicy, VoiceResponseRequest } from "../types";
import type { WebRTCHelperServer } from "../../media/webrtc-helper/protocol";
import { backendUpdateItemEvent, backendUpdateResponseEvent, backendUpdateResponseShape, responseCreateEvent } from "./responses";
import { usageFromOpenAIInputTranscription, usageFromOpenAIResponseDone } from "./usage";
import { renderContextPacket } from "./shared";

export class OpenAIWebRTCBridgeAdapter implements RealtimeProviderAdapter {
	readonly provider: ProviderKind = "openai";
	readonly mediaMode = "webrtc" as const;
	private sink: ProviderEventSink | undefined;
	private interaction: ProviderInteractionConfig | undefined;
	private orderedPushChain: Promise<void> = Promise.resolve();
	private pendingChunkCompletion: PendingChunkCompletion | undefined;

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
		}, { onProviderEvent: (event) => this.handleProviderEvent(event) });
		sink.onProviderEvent({ type: "connected", provider: "openai", providerSessionId: this.providerSessionId, localSeq: Date.now(), at: Date.now() });
	}

	async disconnect(reason: DisconnectReason): Promise<void> {
		this.helper.unregisterSession(this.providerSessionId, reason);
		this.resolvePendingChunkCompletion("disconnect");
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
		this.trace?.write({
			source: "provider_adapter",
			direction: wantsResponse ? "context_push_response_requested" : "context_push_context_only",
			reason: "pi_context_push",
			mode: input.mode,
			updateKind: input.kind,
			pushSource: input.source,
			summary: input.summary,
			textLength: input.text.length,
			sourceTextLength: input.text.length,
			renderingMode: input.rendering?.mode,
			renderingEnvelope: input.rendering?.envelope,
			chunkIndex: input.chunk?.index,
			chunkCount: input.chunk?.count,
			originalTextLength: input.chunk?.originalTextLength ?? input.text.length,
		});
		if (wantsResponse) this.enqueueOrderedBackendUpdateResponse(input, interaction);
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

	private handleProviderEvent(event: NormalizedProviderEvent): void {
		this.resolveChunkCompletionFromEvent(event);
		this.sink?.onProviderEvent(event);
	}

	private enqueueOrderedBackendUpdateResponse(input: RealtimeContextPushRequest, interaction: ProviderInteractionConfig): void {
		this.orderedPushChain = this.orderedPushChain
			.catch((error: unknown) => this.trace?.write({ source: "provider_adapter", direction: "ordered_chunk_dispatch_recovered", message: errorMessage(error) }))
			.then(() => this.dispatchOrderedBackendUpdateResponse(input, interaction));
	}

	private async dispatchOrderedBackendUpdateResponse(input: RealtimeContextPushRequest, interaction: ProviderInteractionConfig): Promise<void> {
		this.trace?.write({ source: "provider_adapter", direction: "ordered_chunk_dispatch_start", chunkIndex: input.chunk?.index, chunkCount: input.chunk?.count, originalTextLength: input.chunk?.originalTextLength });
		const completion = this.waitForChunkResponseDone(input);
		this.enqueueBackendUpdateResponse(input, interaction);
		await completion;
	}

	private enqueueBackendUpdateResponse(input: RealtimeContextPushRequest, interaction: ProviderInteractionConfig): void {
		this.traceBackendUpdateResponseCreate(input, interaction);
		this.enqueue(realtimeClientEventRecord(backendUpdateResponseEvent(input, interaction, ["audio"])));
	}

	private waitForChunkResponseDone(input: RealtimeContextPushRequest): Promise<void> {
		return new Promise((resolve) => {
			const timeout = setTimeout(() => {
				this.trace?.write({ source: "provider_adapter", direction: "ordered_chunk_dispatch_timeout", chunkIndex: input.chunk?.index, chunkCount: input.chunk?.count, originalTextLength: input.chunk?.originalTextLength });
				this.resolvePendingChunkCompletion("timeout");
			}, 60_000);
			this.pendingChunkCompletion = { chunk: input.chunk, resolve, timeout };
		});
	}

	private resolveChunkCompletionFromEvent(event: NormalizedProviderEvent): void {
		if (event.type !== "usage" || event.observation.source !== "response") return;
		this.resolvePendingChunkCompletion("response_done", event.observation.responseId);
	}

	private resolvePendingChunkCompletion(reason: OrderedChunkCompletionReason, responseId?: string): void {
		const pending = this.pendingChunkCompletion;
		if (!pending) return;
		clearTimeout(pending.timeout);
		this.pendingChunkCompletion = undefined;
		this.trace?.write({ source: "provider_adapter", direction: "ordered_chunk_dispatch_done", reason, responseId, chunkIndex: pending.chunk?.index, chunkCount: pending.chunk?.count, originalTextLength: pending.chunk?.originalTextLength });
		pending.resolve();
	}

	private traceBackendUpdateResponseCreate(input: RealtimeContextPushRequest, interaction: ProviderInteractionConfig): void {
		const shape = backendUpdateResponseShape(input, interaction);
		this.trace?.write({
			source: "provider_adapter",
			direction: "backend_update_response_create_shape",
			reason: "pi_context_push",
			mode: input.mode,
			updateKind: input.kind,
			pushSource: input.source,
			summary: input.summary,
			renderingMode: input.rendering?.mode,
			renderingEnvelope: input.rendering?.envelope,
			conversation: shape.conversation,
			isolated: shape.isolated,
			inputRole: shape.inputRole,
			instructionsTextLength: shape.instructions.length,
			instructionsTextSha256: sha256(shape.instructions),
			instructionsTextPreview: preview(shape.instructions),
			envelopeTextLength: shape.envelopeText.length,
			envelopeTextSha256: sha256(shape.envelopeText),
			envelopeTextPreview: preview(shape.envelopeText),
		});
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

type PendingChunkCompletion = {
	chunk: RealtimeContextPushRequest["chunk"];
	resolve(): void;
	timeout: NodeJS.Timeout;
};

type OrderedChunkCompletionReason = "response_done" | "timeout" | "disconnect";

function realtimeClientEventRecord(event: object): Record<string, unknown> {
	return event as Record<string, unknown>;
}

function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function preview(text: string): string {
	return text.length <= 240 ? text : `${text.slice(0, 240)}…`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

