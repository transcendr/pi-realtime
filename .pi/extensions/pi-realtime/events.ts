import { randomUUID } from "node:crypto";
import { EVENT_VERSION, type CitationDeck, type CitationDeckSummary, type ContextPacket, type ContextPacketSummary, type NormalizedProviderEvent, type ProviderDeliveryReceipt, type ProviderKind, type ProviderSessionId, type RealtimeConfig, type RealtimeEvent, type RealtimeHistorySummary, type RealtimeState, type VoiceInstructionInput, type VoiceInstructionReceipt, type VoiceSessionRecord, type VoiceToolCallRecord, type VoiceToolResultRecord } from "./types";

export const defaultConfig: RealtimeConfig = { primaryProviderSessionId: null, defaultProvider: "fake", defaultPersonaId: "default" };

export function createInitialState(config: RealtimeConfig = defaultConfig): RealtimeState {
	return { config: { ...config }, sessions: new Map(), primaryProviderSessionId: config.primaryProviderSessionId, pendingToolCalls: new Map(), contextRevisions: new Map(), citationDeck: null, history: [] };
}

export function replayEvents(events: readonly RealtimeEvent[], config: RealtimeConfig = defaultConfig): RealtimeState {
	const state = createInitialState(config);
	for (const event of events) applyEvent(state, event);
	return state;
}

export function applyEvent(state: RealtimeState, event: RealtimeEvent): void {
	state.history.push(historyRow(event));
	if (event.kind === "session_started") {
		state.sessions.set(event.session.providerSessionId, { ...event.session });
		state.primaryProviderSessionId = state.primaryProviderSessionId ?? event.session.providerSessionId;
		state.config.primaryProviderSessionId = state.primaryProviderSessionId;
		return;
	}
	if (event.kind === "session_stopped") {
		const existing = state.sessions.get(event.providerSessionId);
		if (existing) state.sessions.set(event.providerSessionId, { ...existing, status: "stopped", stoppedAt: event.at });
		if (state.primaryProviderSessionId === event.providerSessionId) {
			state.primaryProviderSessionId = firstActiveSessionId(state);
			state.config.primaryProviderSessionId = state.primaryProviderSessionId;
		}
		return;
	}
	if (event.kind === "session_primary_changed") {
		state.primaryProviderSessionId = event.providerSessionId;
		state.config.primaryProviderSessionId = event.providerSessionId;
		return;
	}
	if (event.kind === "provider_event") {
		const existing = state.sessions.get(event.providerEvent.providerSessionId);
		if (existing) {
			const status = event.providerEvent.type === "error" ? "error" : event.providerEvent.type === "disconnected" ? "stopped" : event.providerEvent.type === "connected" ? "active" : existing.status;
			state.sessions.set(existing.providerSessionId, { ...existing, status, lastProviderEventAt: event.at, lastError: event.providerEvent.type === "error" ? event.providerEvent.message : existing.lastError });
		}
		return;
	}
	if (event.kind === "context_packet_sent") {
		const revisions = state.contextRevisions.get(event.providerSessionId) ?? {};
		revisions[event.packet.channel] = Math.max(revisions[event.packet.channel] ?? 0, event.packet.revision);
		state.contextRevisions.set(event.providerSessionId, revisions);
		return;
	}
	if (event.kind === "voice_tool_call_received") {
		if (event.call.status === "pending") state.pendingToolCalls.set(event.call.voiceToolCallId, { ...event.call });
		return;
	}
	if (event.kind === "voice_tool_result_sent") {
		state.pendingToolCalls.delete(event.result.voiceToolCallId);
		return;
	}
	if (event.kind === "voice_instruction_submitted") {
		state.lastInstruction = { ...event.instruction };
		return;
	}
	if (event.kind === "citation_deck_observed") {
		const active = event.deck.citationIds.map((citationId, index) => ({ displayRef: `[${index + 1}]`, alias: `@p${index + 1}`, citationId, origin: "unknown" as const, source: "pinotator", snippet: "", fullTextAvailable: true }));
		state.citationDeck = { revision: event.deck.revision, source: "pinotator", observedAt: event.deck.observedAt, active };
		return;
	}
	if (event.kind === "config_changed") {
		state.config = { ...state.config, ...event.patch };
		state.primaryProviderSessionId = state.config.primaryProviderSessionId;
	}
}

export function sessionStarted(session: Omit<VoiceSessionRecord, "status" | "startedAt"> & Partial<Pick<VoiceSessionRecord, "status" | "startedAt">>, at = Date.now()): RealtimeEvent {
	return { version: EVENT_VERSION, kind: "session_started", eventId: id("evt"), at, session: { ...session, status: session.status ?? "active", startedAt: session.startedAt ?? at } };
}

export function sessionStopped(providerSessionId: ProviderSessionId, reason: string, at = Date.now()): RealtimeEvent {
	return { version: EVENT_VERSION, kind: "session_stopped", eventId: id("evt"), at, providerSessionId, reason };
}

export function primaryChanged(providerSessionId: ProviderSessionId | null, at = Date.now()): RealtimeEvent {
	return { version: EVENT_VERSION, kind: "session_primary_changed", eventId: id("evt"), at, providerSessionId };
}

export function providerEventObserved(providerEvent: NormalizedProviderEvent, at = Date.now()): RealtimeEvent {
	return { version: EVENT_VERSION, kind: "provider_event", eventId: id("evt"), at, providerEvent };
}

export function contextPacketSent(providerSessionId: ProviderSessionId, packet: ContextPacket, receipt: ProviderDeliveryReceipt, at = Date.now()): RealtimeEvent {
	return { version: EVENT_VERSION, kind: "context_packet_sent", eventId: id("evt"), at, providerSessionId, packet: summarizePacket(packet), receipt };
}

export function voiceToolCallReceived(call: VoiceToolCallRecord, at = Date.now()): RealtimeEvent {
	return { version: EVENT_VERSION, kind: "voice_tool_call_received", eventId: id("evt"), at, call };
}

export function voiceToolResultSent(result: VoiceToolResultRecord, at = Date.now()): RealtimeEvent {
	return { version: EVENT_VERSION, kind: "voice_tool_result_sent", eventId: id("evt"), at, result };
}

export function voiceInstructionSubmitted(input: VoiceInstructionInput, receipt: VoiceInstructionReceipt, at = Date.now()): RealtimeEvent {
	return { version: EVENT_VERSION, kind: "voice_instruction_submitted", eventId: id("evt"), at, instruction: { ...input, submittedAt: at, delivery: receipt.delivery }, receipt };
}

export function citationDeckObserved(deck: CitationDeck, at = Date.now()): RealtimeEvent {
	return { version: EVENT_VERSION, kind: "citation_deck_observed", eventId: id("evt"), at, deck: summarizeDeck(deck) };
}

export function configChanged(patch: Partial<RealtimeConfig>, at = Date.now()): RealtimeEvent {
	return { version: EVENT_VERSION, kind: "config_changed", eventId: id("evt"), at, patch };
}

export function isRealtimeEvent(value: unknown): value is RealtimeEvent {
	if (!isRecord(value)) return false;
	if (value.version !== EVENT_VERSION || typeof value.kind !== "string" || typeof value.eventId !== "string" || typeof value.at !== "number") return false;
	return ["session_started", "session_stopped", "session_primary_changed", "provider_event", "context_packet_sent", "voice_tool_call_received", "voice_tool_result_sent", "voice_instruction_submitted", "citation_deck_observed", "config_changed"].includes(value.kind);
}

export function summarizePacket(packet: ContextPacket): ContextPacketSummary {
	return { packetId: packet.packetId, revision: packet.revision, channel: packet.channel, priority: packet.priority, summary: packet.summary, createdAt: packet.createdAt };
}

export function summarizeDeck(deck: CitationDeck): CitationDeckSummary {
	return { revision: deck.revision, count: deck.active.length, citationIds: deck.active.map((item) => item.citationId), observedAt: deck.observedAt };
}

export function nextProviderSessionId(provider: ProviderKind): ProviderSessionId {
	return `${provider}_${randomUUID()}`;
}

function id(prefix: string): string {
	return `${prefix}_${randomUUID()}`;
}

function firstActiveSessionId(state: RealtimeState): ProviderSessionId | null {
	for (const session of state.sessions.values()) if (session.status === "active" || session.status === "starting") return session.providerSessionId;
	return null;
}

function historyRow(event: RealtimeEvent): RealtimeHistorySummary {
	const providerSessionId = "providerSessionId" in event ? event.providerSessionId : event.kind === "session_started" ? event.session.providerSessionId : undefined;
	return providerSessionId ? { kind: event.kind, eventId: event.eventId, at: event.at, providerSessionId } : { kind: event.kind, eventId: event.eventId, at: event.at };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
