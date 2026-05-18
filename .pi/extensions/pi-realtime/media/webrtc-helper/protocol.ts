import type { DebugTraceRecorder } from "../../debug-trace";
import type { ContextPacket, NormalizedProviderEvent, ProviderKind, ProviderSessionId, VoiceToolCallRecord, VoiceToolSurface } from "../../types";
import type { UsageObservation, UsageSource } from "../../usage";

export type WebRTCHelperSessionConfig = {
	provider: ProviderKind;
	providerSessionId: ProviderSessionId;
	model: string;
	instructions: string;
	toolSurface: VoiceToolSurface;
	initialContext: ContextPacket;
	debugTracePath?: string;
	resumeOutboxAfter?: number;
};

export type WebRTCHelperRegistrationConfig = WebRTCHelperSessionConfig & {
	createClientSecret(): Promise<unknown>;
	normalizeUsageEvent?(input: { source: UsageSource; realtimeEvent: unknown; providerEventId?: string; at?: number }): UsageObservation | undefined;
	trace?: DebugTraceRecorder;
};

export type WebRTCHelperInboundEvent =
	| { type: "trace"; trace: Record<string, unknown>; providerEventId?: string }
	| { type: "outbox_ack"; outboxId: number; providerEventId?: string }
	| { type: "connected"; providerEventId?: string }
	| { type: "disconnected"; reason: string; providerEventId?: string }
	| { type: "error"; message: string; recoverable?: boolean; providerEventId?: string }
	| { type: "user_transcript"; text: string; final: boolean; providerEventId?: string }
	| { type: "assistant_transcript"; text: string; final: boolean; providerEventId?: string }
	| { type: "turn_signal"; signal: "speech_started" | "speech_stopped" | "waiting_for_input" | "interrupted" | "turn_complete"; providerEventId?: string }
	| { type: "tool_call"; call: Omit<VoiceToolCallRecord, "provider" | "providerSessionId" | "status" | "createdAt">; providerEventId?: string }
	| { type: "usage"; source: UsageSource; realtimeEvent: unknown; providerEventId?: string };

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
