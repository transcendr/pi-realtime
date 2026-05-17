import type { ContextPacket, NormalizedProviderEvent, ProviderKind, ProviderSessionId, VoiceToolCallRecord, VoiceToolSurface } from "../../types";

export type WebRTCHelperSessionConfig = {
	provider: ProviderKind;
	providerSessionId: ProviderSessionId;
	model: string;
	instructions: string;
	toolSurface: VoiceToolSurface;
	initialContext: ContextPacket;
};

export type WebRTCHelperRegistrationConfig = WebRTCHelperSessionConfig & {
	createClientSecret(): Promise<unknown>;
};

export type WebRTCHelperInboundEvent =
	| { type: "connected"; providerEventId?: string }
	| { type: "disconnected"; reason: string; providerEventId?: string }
	| { type: "error"; message: string; recoverable?: boolean; providerEventId?: string }
	| { type: "user_transcript"; text: string; final: boolean; providerEventId?: string }
	| { type: "assistant_transcript"; text: string; final: boolean; providerEventId?: string }
	| { type: "turn_signal"; signal: "speech_started" | "speech_stopped" | "waiting_for_input" | "interrupted" | "turn_complete"; providerEventId?: string }
	| { type: "tool_call"; call: Omit<VoiceToolCallRecord, "provider" | "providerSessionId" | "status" | "createdAt">; providerEventId?: string };

export type WebRTCHelperOutboundEvent = {
	id: number;
	event: Record<string, unknown>;
};

export type WebRTCHelperSink = {
	onProviderEvent(event: NormalizedProviderEvent): void;
};

export type WebRTCHelperServer = {
	start(): Promise<void>;
	stop(): Promise<void>;
	registerSession(config: WebRTCHelperRegistrationConfig, sink: WebRTCHelperSink): void;
	unregisterSession(providerSessionId: ProviderSessionId, reason: string): void;
	enqueue(providerSessionId: ProviderSessionId, event: Record<string, unknown>): void;
	urlFor(providerSessionId: ProviderSessionId): string;
	status(): string;
};
