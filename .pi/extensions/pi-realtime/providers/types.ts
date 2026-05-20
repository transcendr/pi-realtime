import type { ContextPacket, DisconnectReason, NormalizedProviderEvent, ProviderDeliveryReceipt, ProviderInteractionConfig, ProviderKind, ProviderSessionId, RealtimePushMode, RealtimePushSource, RealtimeUpdateKind, VoiceToolResultRecord, VoiceToolSurface } from "../types";

export type ProviderCapabilityPreferences = {
	preferPassiveContext: boolean;
	preferSemanticVad: boolean;
};

export type ProviderConnectConfig = {
	providerSessionId: ProviderSessionId;
	provider: ProviderKind;
	model: string;
	voice?: string;
	personaId: string;
	systemPrompt: string;
	toolSurface: VoiceToolSurface;
	initialContext: ContextPacket;
	capabilities: ProviderCapabilityPreferences;
	interaction: ProviderInteractionConfig;
};

export type VoiceResponseRequest = {
	reason: "tool_result" | "tool_result_continue" | "tool_result_final_ack" | "context_update" | "manual" | "valid_transcript" | "pi_context_push";
	instructions?: string;
};

export type ToolResultResponsePolicy = "none" | "continue" | "final_ack";

export type RealtimeContextPushChunk = {
	index: number;
	count: number;
	originalTextLength: number;
};

export type RealtimeContextPushRequest = {
	text: string;
	mode: RealtimePushMode;
	source: RealtimePushSource;
	kind: RealtimeUpdateKind;
	summary?: string;
	chunk?: RealtimeContextPushChunk;
};

export type ProviderEventSink = {
	onProviderEvent(event: NormalizedProviderEvent): void;
	onProviderAudio?(chunk: { providerSessionId: ProviderSessionId; provider: ProviderKind; audio: Buffer; providerEventId?: string }): void;
};

export type RealtimeProviderAdapter = {
	readonly provider: ProviderKind;
	readonly providerSessionId: ProviderSessionId;
	readonly mediaMode?: "raw" | "webrtc" | "fake";
	connect(config: ProviderConnectConfig, sink: ProviderEventSink): Promise<void>;
	disconnect(reason: DisconnectReason): Promise<void>;
	updateContext(packet: ContextPacket): Promise<ProviderDeliveryReceipt>;
	updateToolSurface(surface: VoiceToolSurface): Promise<void>;
	sendToolResult(result: VoiceToolResultRecord, policy?: ToolResultResponsePolicy): Promise<void>;
	sendTextInput(text: string): Promise<ProviderDeliveryReceipt>;
	pushContext(input: RealtimeContextPushRequest): Promise<ProviderDeliveryReceipt>;
	sendAudioInput(audio: Buffer): Promise<ProviderDeliveryReceipt>;
	setAudioOutputEnabled(enabled: boolean): Promise<ProviderDeliveryReceipt>;
	requestResponse(request: VoiceResponseRequest): Promise<void>;
};
