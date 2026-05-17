import type { ContextPacket, DisconnectReason, NormalizedProviderEvent, ProviderDeliveryReceipt, ProviderKind, ProviderSessionId, VoiceToolResultRecord, VoiceToolSurface } from "../types";

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
};

export type VoiceResponseRequest = {
	reason: "tool_result" | "context_update" | "manual";
	instructions?: string;
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
	sendToolResult(result: VoiceToolResultRecord): Promise<void>;
	sendTextInput(text: string): Promise<ProviderDeliveryReceipt>;
	sendAudioInput(audio: Buffer): Promise<ProviderDeliveryReceipt>;
	setAudioOutputEnabled(enabled: boolean): Promise<ProviderDeliveryReceipt>;
	requestResponse(request: VoiceResponseRequest): Promise<void>;
};
