import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CUSTOM_EVENT_TYPE, type RealtimeEvent, type RealtimeState } from "./types";
import { isRealtimeEvent, replayEvents } from "./events";

export type Store = {
	hydrate(ctx: ExtensionContext): void;
	append(event: RealtimeEvent): void;
	events(): readonly RealtimeEvent[];
	state(): RealtimeState;
};

export function createStore(pi: ExtensionAPI): Store {
	let persisted: RealtimeEvent[] = [];
	const local = new Map<string, RealtimeEvent>();
	return {
		hydrate(ctx) {
			persisted = readPersisted(ctx);
			for (const event of persisted) local.delete(event.eventId);
		},
		append(event) {
			local.set(event.eventId, event);
			pi.appendEntry(CUSTOM_EVENT_TYPE, event);
		},
		events() {
			return [...persisted, ...local.values()].sort((a, b) => a.at - b.at || a.eventId.localeCompare(b.eventId));
		},
		state() {
			return replayEvents(this.events());
		},
	};
}

function readPersisted(ctx: ExtensionContext): RealtimeEvent[] {
	const events: RealtimeEvent[] = [];
	for (const entry of ctx.sessionManager.getBranch()) {
		if (!isCustomEntry(entry)) continue;
		if (entry.customType !== CUSTOM_EVENT_TYPE) continue;
		if (isRealtimeEvent(entry.data)) events.push(entry.data);
	}
	return events;
}

function isCustomEntry(value: unknown): value is { type: "custom"; customType?: unknown; data?: unknown } {
	return typeof value === "object" && value !== null && "type" in value && value.type === "custom";
}
