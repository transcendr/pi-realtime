import { OpenAIRealtimeWebSocket } from "openai/realtime/websocket";
import type { RealtimeClientEvent, RealtimeServerEvent } from "openai/resources/realtime/realtime";
import type { ContextPacket, DisconnectReason, NormalizedProviderEvent, ProviderDeliveryReceipt, ProviderInteractionConfig, ProviderKind, ProviderSessionId, VoiceToolName, VoiceToolResultRecord, VoiceToolSurface } from "../../types";
import type { ProviderConnectConfig, ProviderEventSink, RealtimeProviderAdapter, RealtimeContextPushRequest, ToolResultResponsePolicy, VoiceResponseRequest } from "../types";
import { backendUpdateItemEvent, backendUpdateResponseEvent, responseCreateEvent } from "./responses";
import { usageFromOpenAIInputTranscription, usageFromOpenAIResponseDone } from "./usage";
import { providerInteractionFor } from "../../domain/interaction-modes";
import { buildOpenAIRealtimeAudioConfig, isOpenAITranscriptActionable } from "./session-config";
import { hasOpenAIRealtimeCredentials, renderContextPacket, toOpenAITool } from "./shared";

export { hasOpenAIRealtimeCredentials };

const OPENAI_WS_CONNECT_TIMEOUT_MS = 15_000;

export class OpenAIRealtimeProviderAdapter implements RealtimeProviderAdapter {
	readonly provider: ProviderKind = "openai";
	readonly mediaMode = "raw" as const;
	readonly providerSessionId: ProviderSessionId;
	private socket: OpenAIRealtimeWebSocket | undefined;
	private sink: ProviderEventSink | undefined;
	private seq = 0;
	private model = "gpt-realtime-2";
	private audioOutputEnabled = false;
	private toolSurface: VoiceToolSurface | undefined;
	private instructions: string | undefined;
	private interaction: ProviderInteractionConfig = providerInteractionFor("agent");

	constructor(providerSessionId: ProviderSessionId) {
		this.providerSessionId = providerSessionId;
	}

	async connect(config: ProviderConnectConfig, sink: ProviderEventSink): Promise<void> {
		if (!hasOpenAIRealtimeCredentials()) throw new Error("OPENAI_API_KEY is required to start an OpenAI realtime session.");
		this.sink = sink;
		this.model = config.model;
		this.interaction = config.interaction;
		const rt = new OpenAIRealtimeWebSocket({ model: config.model });
		this.socket = rt;
		rt.on("event", (event) => this.handleServerEvent(event));
		rt.on("error", (error) => this.emit({ type: "error", message: error.message, recoverable: true }));
		await this.awaitOpen(rt);
		this.emit({ type: "connected" });
		rt.socket.addEventListener("close", () => this.emit({ type: "disconnected", reason: "socket closed" }));
		await this.updateToolSurface(config.toolSurface, config.systemPrompt);
		await this.updateContext(config.initialContext);
	}

	async disconnect(reason: DisconnectReason): Promise<void> {
		this.socket?.close({ code: 1000, reason });
		this.socket = undefined;
		this.emit({ type: "disconnected", reason });
	}

	async updateContext(packet: ContextPacket): Promise<ProviderDeliveryReceipt> {
		this.send({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: renderContextPacket(packet) }] } } as RealtimeClientEvent);
		this.emit({ type: "context_delivery", packetId: packet.packetId, revision: packet.revision, status: "delivered", message: "context item sent" });
		return { status: "delivered", message: "context item sent" };
	}

	async updateToolSurface(surface: VoiceToolSurface, instructions?: string): Promise<void> {
		this.toolSurface = surface;
		this.instructions = instructions;
		this.sendSessionUpdate();
	}

	async sendToolResult(result: VoiceToolResultRecord, policy: ToolResultResponsePolicy = "none"): Promise<void> {
		this.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: result.voiceToolCallId, output: result.resultText } } as RealtimeClientEvent);
		if (policy === "none") return;
		await this.requestResponse({ reason: policy === "final_ack" ? "tool_result_final_ack" : "tool_result_continue" });
	}

	async pushContext(input: RealtimeContextPushRequest): Promise<ProviderDeliveryReceipt> {
		if (input.mode !== "request_spoken_response" || this.interaction.backendSpeechContext !== "isolated_update") this.send(backendUpdateItemEvent(input));
		if (input.mode === "request_spoken_response") this.send(backendUpdateResponseEvent(input, this.interaction, [this.audioOutputEnabled ? "audio" : "text"]));
		return { status: "delivered", message: input.mode === "request_spoken_response" ? "backend update sent and spoken response requested" : "backend update sent without response" };
	}

	async sendTextInput(text: string): Promise<ProviderDeliveryReceipt> {
		this.send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } } as RealtimeClientEvent);
		await this.requestResponse({ reason: "manual" });
		return { status: "delivered", message: "OpenAI realtime user text item sent" };
	}

	async sendAudioInput(audio: Buffer): Promise<ProviderDeliveryReceipt> {
		this.send({ type: "input_audio_buffer.append", audio: audio.toString("base64") } as RealtimeClientEvent);
		return { status: "delivered", message: "OpenAI realtime audio chunk sent" };
	}

	async setAudioOutputEnabled(enabled: boolean): Promise<ProviderDeliveryReceipt> {
		this.audioOutputEnabled = enabled;
		this.sendSessionUpdate();
		return { status: "delivered", message: enabled ? "OpenAI audio output enabled" : "OpenAI audio output disabled" };
	}

	async requestResponse(request: VoiceResponseRequest): Promise<void> {
		this.send(responseCreateEvent(request, [this.audioOutputEnabled ? "audio" : "text"]));
	}

	private sendSessionUpdate(): void {
		const surface = this.toolSurface;
		if (!surface) return;
		this.send({ type: "session.update", session: { type: "realtime", model: this.model, instructions: this.instructions, output_modalities: [this.audioOutputEnabled ? "audio" : "text"], audio: buildOpenAIRealtimeAudioConfig({ includeRawPcmFormat: true, includeRawPcmOutputFormat: true }), tools: this.interaction.tools.map(toOpenAITool), tool_choice: this.interaction.toolChoice } } as RealtimeClientEvent);
	}

	private awaitOpen(rt: OpenAIRealtimeWebSocket): Promise<void> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("Timed out waiting for OpenAI realtime socket to open.")), OPENAI_WS_CONNECT_TIMEOUT_MS);
			rt.socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
			rt.socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("OpenAI realtime socket error before open.")); }, { once: true });
		});
	}

	private handleServerEvent(event: RealtimeServerEvent): void {
		if (event.type === "response.function_call_arguments.done") return this.emitToolCall(event.name, event.call_id, event.arguments, event.event_id);
		if (event.type === "conversation.item.input_audio_transcription.completed") {
			this.emitUsage(usageFromOpenAIInputTranscription(event, { providerSessionId: this.providerSessionId, model: this.model, providerEventId: event.event_id }));
			this.emit({ type: "user_transcript", text: event.transcript, final: true, providerEventId: event.event_id });
			if (isOpenAITranscriptActionable(event.transcript) && this.interaction.transcriptHandling.response === "model") void this.requestResponse({ reason: "valid_transcript" }).catch((error) => this.emit({ type: "error", message: error.message, recoverable: true, providerEventId: event.event_id }));
			return;
		}
		if (event.type === "response.output_text.done") return this.emit({ type: "assistant_transcript", text: event.text, final: true, providerEventId: event.event_id });
		if (event.type === "response.output_audio_transcript.done") return this.emit({ type: "assistant_transcript", text: event.transcript, final: true, providerEventId: event.event_id });
		if (event.type === "response.output_audio.delta") return this.emitAudio(Buffer.from(event.delta, "base64"), event.event_id);
		if (event.type === "input_audio_buffer.speech_started") return this.emit({ type: "turn_signal", signal: "speech_started", providerEventId: event.event_id });
		if (event.type === "input_audio_buffer.speech_stopped") return this.emit({ type: "turn_signal", signal: "speech_stopped", providerEventId: event.event_id });
		if (event.type === "response.done") {
			this.emitUsage(usageFromOpenAIResponseDone(event, { providerSessionId: this.providerSessionId, model: this.model, providerEventId: event.event_id }));
			return this.emit({ type: "turn_signal", signal: "turn_complete", providerEventId: event.event_id });
		}
	}

	private emitToolCall(name: string, callId: string, rawArgs: string, providerEventId: string): void {
		this.emit({ type: "tool_call", providerEventId, call: { voiceToolCallId: callId, provider: "openai", providerSessionId: this.providerSessionId, providerToolCallId: callId, name: normalizeToolName(name), arguments: parseArgs(rawArgs), status: "pending", createdAt: Date.now() } });
	}

	private emitUsage(observation: ReturnType<typeof usageFromOpenAIResponseDone>): void {
		if (!observation) return;
		this.emit({ type: "usage", observation, providerEventId: observation.providerEventId });
	}

	private emitAudio(audio: Buffer, providerEventId: string): void {
		const sink = this.sink;
		if (!sink?.onProviderAudio) return;
		sink.onProviderAudio({ provider: "openai", providerSessionId: this.providerSessionId, providerEventId, audio });
	}

	private send(event: RealtimeClientEvent): void {
		if (!this.socket) throw new Error("OpenAI realtime socket is not connected.");
		this.socket.send(event);
	}

	private emit(event: Record<string, unknown> & { type: NormalizedProviderEvent["type"] }): void {
		this.sink?.onProviderEvent({ ...event, provider: "openai", providerSessionId: this.providerSessionId, localSeq: ++this.seq, at: Date.now() } as NormalizedProviderEvent);
	}
}

export function createOpenAIRealtimeProvider(providerSessionId: ProviderSessionId): OpenAIRealtimeProviderAdapter {
	return new OpenAIRealtimeProviderAdapter(providerSessionId);
}

function normalizeToolName(name: string): VoiceToolName {
	const allowed: readonly string[] = ["request", "pi_state_snapshot", "pi_send_instruction", "pi_wait_for_update", "pi_realtime_status", "pinotator_citations_list", "pinotator_citation_resolve"];
	return allowed.includes(name) ? (name as VoiceToolName) : "request";
}

function parseArgs(rawArgs: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(rawArgs) as unknown;
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
	} catch {
		return {};
	}
}
