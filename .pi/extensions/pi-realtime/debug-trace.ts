import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NormalizedProviderEvent, ProviderSessionId, RealtimeState } from "./types";

const EMPTY_POLL_TRACE_INTERVAL = 40;

export type DebugTraceRecorder = {
	path: string;
	createdAt: number;
	write(record: Record<string, unknown>): void;
};

export type DebugTraceRegistry = {
	create(providerSessionId: ProviderSessionId): DebugTraceRecorder;
	recorderFor(providerSessionId: ProviderSessionId): DebugTraceRecorder | undefined;
	render(state: RealtimeState, providerSessionId?: ProviderSessionId): string;
};

type DebugTraceSession = {
	providerSessionId: ProviderSessionId;
	recorder: DebugTraceRecorder;
	path: string;
	createdAt: number;
};

export type OutboxPollTraceState = {
	emptyCount: number;
	emptySinceAt?: number;
};

export function createDebugTraceRecorder(providerSessionId: ProviderSessionId, createdAt = Date.now()): DebugTraceRecorder {
	const dir = join(tmpdir(), "pi-realtime-traces");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, `${safeSegment(providerSessionId)}-${createdAt}.jsonl`);
	return {
		path,
		createdAt,
		write(record) {
			appendFileSync(path, `${JSON.stringify({ at: Date.now(), providerSessionId, ...record })}\n`, "utf8");
		},
	};
}

export function createDebugTraceRegistry(): DebugTraceRegistry {
	const traces = new Map<ProviderSessionId, DebugTraceSession>();
	return {
		create(providerSessionId) {
			const recorder = createDebugTraceRecorder(providerSessionId);
			traces.set(providerSessionId, { providerSessionId, recorder, path: recorder.path, createdAt: recorder.createdAt });
			return recorder;
		},
		recorderFor(providerSessionId) {
			return traces.get(providerSessionId)?.recorder;
		},
		render(state, providerSessionId) {
			const entries = (providerSessionId ? [...traces.values()].filter((trace) => trace.providerSessionId === providerSessionId) : [...traces.values()]).sort((a, b) => b.createdAt - a.createdAt);
			if (entries.length === 0) return providerSessionId ? `No realtime debug trace recorded for ${providerSessionId}.` : "No realtime debug traces recorded yet.";
			return ["realtime debug traces:", ...entries.map((trace) => renderTraceRow(trace, state))].join("\n");
		},
	};
}

export function createOutboxPollTraceState(): OutboxPollTraceState {
	return { emptyCount: 0 };
}

export function nextOutboxPollTrace(state: OutboxPollTraceState, after: number, returnedIds: readonly number[], now = Date.now()): Record<string, unknown> | undefined {
	if (returnedIds.length > 0) {
		const emptyPollsBeforeResult = state.emptyCount;
		const emptySinceAt = state.emptySinceAt;
		state.emptyCount = 0;
		state.emptySinceAt = undefined;
		return { direction: "outbox_poll", after, returnedIds, emptyPollsBeforeResult, emptySinceAt };
	}
	state.emptySinceAt ??= now;
	state.emptyCount += 1;
	if (state.emptyCount !== 1 && state.emptyCount % EMPTY_POLL_TRACE_INTERVAL !== 0) return undefined;
	return { direction: "outbox_poll_idle", after, emptyPolls: state.emptyCount, emptySinceAt: state.emptySinceAt, lastAt: now };
}

export function describeRealtimePayload(value: unknown): Record<string, unknown> {
	const description: Record<string, unknown> = { summary: summarizeRealtimePayload(value) };
	if (!isRecord(value)) return description;
	addTextDetails(description, "content", contentText(value));
	addTextDetails(description, "transcript", transcriptText(value));
	addTextDetails(description, "text", outputText(value));
	addTextDetails(description, "functionArguments", stringValue(value.arguments));
	const message = isRecord(value.error) ? stringValue(value.error.message) : stringValue(value.message);
	if (message !== undefined) description.message = message;
	return description;
}

export function describeProviderEvent(event: NormalizedProviderEvent): Record<string, unknown> {
	const description: Record<string, unknown> = { eventType: event.type, providerEventId: event.providerEventId, localSeq: event.localSeq };
	if (event.type === "user_transcript" || event.type === "assistant_transcript") {
		description.final = event.final;
		addTextDetails(description, "transcript", event.text);
	} else if (event.type === "tool_call") {
		description.toolName = event.call.name;
		description.toolArguments = event.call.arguments;
	} else if (event.type === "turn_signal") {
		description.signal = event.signal;
	} else if (event.type === "error") {
		description.message = event.message;
		description.recoverable = event.recoverable;
	} else if (event.type === "disconnected") {
		description.reason = event.reason;
	} else if (event.type === "usage") {
		description.usageSource = event.observation.source;
		description.totalTokens = event.observation.totalTokens;
		description.responseId = event.observation.responseId;
		description.itemId = event.observation.itemId;
		description.inputTextTokens = event.observation.input.textTokens;
		description.inputAudioTokens = event.observation.input.audioTokens;
		description.cachedInputTextTokens = event.observation.input.cachedTextTokens;
		description.cachedInputAudioTokens = event.observation.input.cachedAudioTokens;
		description.outputTextTokens = event.observation.output.textTokens;
		description.outputAudioTokens = event.observation.output.audioTokens;
	}
	return description;
}

export function summarizeRealtimePayload(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) return { valueType: typeof value };
	return {
		type: stringValue(value.type),
		eventId: stringValue(value.event_id),
		responseId: idFrom(value.response) ?? stringValue(value.response_id),
		itemId: idFrom(value.item) ?? stringValue(value.item_id),
		callId: stringValue(value.call_id),
		name: stringValue(value.name),
		role: isRecord(value.item) ? stringValue(value.item.role) : undefined,
		itemType: isRecord(value.item) ? stringValue(value.item.type) : undefined,
		contentTypes: contentTypes(value),
	};
}

function renderTraceRow(trace: DebugTraceSession, state: RealtimeState): string {
	const session = state.sessions.get(trace.providerSessionId);
	const provider = session ? `${session.provider}/${session.model}` : "unknown-provider";
	return `- [${activityForStatus(session?.status)}] ${trace.providerSessionId} ${provider} status=${session?.status ?? "unknown"} started=${new Date(trace.createdAt).toISOString()} path=${trace.path}`;
}

function activityForStatus(status: string | undefined): "active" | "stopped" | "unknown" {
	if (!status) return "unknown";
	return status === "active" || status === "starting" ? "active" : "stopped";
}

function addTextDetails(target: Record<string, unknown>, prefix: string, text: string | undefined): void {
	if (text === undefined) return;
	target[`${prefix}Text`] = text;
	target[`${prefix}TextLength`] = text.length;
	target[`${prefix}TextSha256`] = createHash("sha256").update(text).digest("hex");
}

function outputText(value: Record<string, unknown>): string | undefined {
	if (value.type === "response.output_text.done") return stringValue(value.text);
	return undefined;
}

function transcriptText(value: Record<string, unknown>): string | undefined {
	if (value.type === "conversation.item.input_audio_transcription.completed") return stringValue(value.transcript);
	if (value.type === "response.output_audio_transcript.done") return stringValue(value.transcript);
	return undefined;
}

function contentText(value: Record<string, unknown>): string | undefined {
	const item = isRecord(value.item) ? value.item : undefined;
	const content = Array.isArray(item?.content) ? item.content : undefined;
	const parts = content?.flatMap(textParts) ?? [];
	return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function textParts(part: unknown): string[] {
	if (!isRecord(part)) return [];
	const text = stringValue(part.text) ?? stringValue(part.transcript);
	return text === undefined ? [] : [text];
}

function contentTypes(value: Record<string, unknown>): string[] | undefined {
	const item = isRecord(value.item) ? value.item : undefined;
	const content = Array.isArray(item?.content) ? item.content : undefined;
	return content?.map((part) => isRecord(part) ? stringValue(part.type) : undefined).filter((type): type is string => Boolean(type));
}

function idFrom(value: unknown): string | undefined {
	return isRecord(value) ? stringValue(value.id) : undefined;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function safeSegment(value: string): string {
	return value.replace(/[^A-Za-z0-9_.-]/g, "_");
}
