import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderSessionId } from "./types";

export type DebugTraceRecorder = {
	path: string;
	write(record: Record<string, unknown>): void;
};

export function createDebugTraceRecorder(providerSessionId: ProviderSessionId): DebugTraceRecorder {
	const dir = join(tmpdir(), "pi-realtime-traces");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, `${safeSegment(providerSessionId)}-${Date.now()}.jsonl`);
	return {
		path,
		write(record) {
			appendFileSync(path, `${JSON.stringify({ at: Date.now(), providerSessionId, ...record })}\n`, "utf8");
		},
	};
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
