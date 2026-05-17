import type { RealtimeState } from "./types";

export function renderWidget(state: RealtimeState): string[] {
	const sessions = [...state.sessions.values()];
	if (sessions.length === 0) return ["pi-realtime", "No realtime provider sessions."];
	return ["pi-realtime", ...sessions.slice(0, 5).map((session) => `${marker(state.primaryProviderSessionId === session.providerSessionId)} ${session.providerSessionId} ${session.provider}/${session.model} ${session.status}`)];
}

export function statusText(state: RealtimeState): string {
	const sessions = [...state.sessions.values()];
	const active = sessions.filter((session) => session.status === "active" || session.status === "starting");
	return sessions.length === 0 ? "pi-realtime: idle" : `pi-realtime: ${active.length}/${sessions.length} active`;
}

function marker(primary: boolean): string {
	return primary ? "*" : "-";
}
