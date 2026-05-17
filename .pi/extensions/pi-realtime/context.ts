import type { ContextEvent } from "@earendil-works/pi-coding-agent";
import { CUSTOM_MESSAGE_TYPE, type RealtimeState } from "./types";
import { isRecord } from "./events";

export function filterRealtimeContextMessages(event: ContextEvent, state: RealtimeState): { messages: ContextEvent["messages"] } | undefined {
	const messages = event.messages.filter((message) => !isStaleRealtimeMessage(message, state));
	return messages.length === event.messages.length ? undefined : { messages };
}

function isStaleRealtimeMessage(message: unknown, state: RealtimeState): boolean {
	if (!isRecord(message) || message.role !== "custom" || message.customType !== CUSTOM_MESSAGE_TYPE) return false;
	const details = isRecord(message.details) ? message.details : {};
	const providerSessionId = typeof details.providerSessionId === "string" ? details.providerSessionId : undefined;
	const instructionId = typeof details.instructionId === "string" ? details.instructionId : undefined;
	if (providerSessionId && !isActiveProviderSession(state, providerSessionId)) return true;
	if (instructionId && state.lastInstruction && state.lastInstruction.instructionId !== instructionId) return true;
	return false;
}

function isActiveProviderSession(state: RealtimeState, providerSessionId: string): boolean {
	const session = state.sessions.get(providerSessionId);
	return session?.status === "active" || session?.status === "starting";
}
