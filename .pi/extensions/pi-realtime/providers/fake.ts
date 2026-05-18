import { randomUUID } from "node:crypto";
import type { ContextPacket, DisconnectReason, NormalizedProviderEvent, ProviderDeliveryReceipt, ProviderKind, ProviderSessionId, VoiceToolName, VoiceToolResultRecord, VoiceToolSurface } from "../types";
import type { ProviderConnectConfig, ProviderEventSink, RealtimeProviderAdapter, VoiceResponseRequest } from "./types";

export class FakeRealtimeProviderAdapter implements RealtimeProviderAdapter {
	readonly provider: ProviderKind = "fake";
	readonly mediaMode = "fake" as const;
	readonly providerSessionId: ProviderSessionId;
	private sink: ProviderEventSink | undefined;
	private seq = 0;
	private connected = false;
	readonly deliveredPackets: ContextPacket[] = [];
	readonly toolResults: VoiceToolResultRecord[] = [];

	constructor(providerSessionId: ProviderSessionId) {
		this.providerSessionId = providerSessionId;
	}

	async connect(_config: ProviderConnectConfig, sink: ProviderEventSink): Promise<void> {
		this.sink = sink;
		this.connected = true;
		this.emit({ type: "connected" });
	}

	async disconnect(reason: DisconnectReason): Promise<void> {
		if (!this.connected) return;
		this.connected = false;
		this.emit({ type: "disconnected", reason });
	}

	async updateContext(packet: ContextPacket): Promise<ProviderDeliveryReceipt> {
		this.deliveredPackets.push(packet);
		this.emit({ type: "context_delivery", packetId: packet.packetId, revision: packet.revision, status: "delivered" });
		return { status: "delivered", message: "fake provider stored context packet" };
	}

	async updateToolSurface(_surface: VoiceToolSurface): Promise<void> {
		return undefined;
	}

	async sendToolResult(result: VoiceToolResultRecord): Promise<void> {
		this.toolResults.push(result);
	}

	async sendTextInput(text: string): Promise<ProviderDeliveryReceipt> {
		this.simulateTranscript(text, true);
		return { status: "delivered", message: "fake provider emitted transcript" };
	}

	async sendAudioInput(_audio: Buffer): Promise<ProviderDeliveryReceipt> {
		return { status: "skipped", message: "fake provider does not consume raw audio" };
	}

	async setAudioOutputEnabled(_enabled: boolean): Promise<ProviderDeliveryReceipt> {
		return { status: "skipped", message: "fake provider does not produce audio" };
	}

	async requestResponse(_request: VoiceResponseRequest): Promise<void> {
		this.emit({ type: "turn_signal", signal: "turn_complete" });
	}

	simulateTranscript(text: string, final = true): void {
		this.emit({ type: "user_transcript", text, final });
	}

	simulateToolCall(name: VoiceToolName, args: Record<string, unknown> = {}): string {
		const voiceToolCallId = `fake_call_${randomUUID()}`;
		this.emit({
			type: "tool_call",
			call: { voiceToolCallId, provider: "fake", providerSessionId: this.providerSessionId, providerToolCallId: voiceToolCallId, name, arguments: args, status: "pending", createdAt: Date.now() },
		});
		return voiceToolCallId;
	}

	private emit(event: Record<string, unknown> & { type: NormalizedProviderEvent["type"] }): void {
		this.sink?.onProviderEvent({ ...event, provider: "fake", providerSessionId: this.providerSessionId, localSeq: ++this.seq, at: Date.now() } as NormalizedProviderEvent);
	}
}

export function createFakeRealtimeProvider(providerSessionId: ProviderSessionId): FakeRealtimeProviderAdapter {
	return new FakeRealtimeProviderAdapter(providerSessionId);
}

export function createFakeProviderRuntime() {
	return {
		provider: "fake" as const,
		defaultModel() { return "fake-realtime"; },
		assertCredentials() { return; },
		createAdapter(input: { providerSessionId: ProviderSessionId }) { return createFakeRealtimeProvider(input.providerSessionId); },
	};
}
