import type { RealtimeState } from "./types";

export function renderWidget(state: RealtimeState): string[] {
	const sessions = [...state.sessions.values()];
	if (sessions.length === 0) return ["pi-realtime", "No realtime provider sessions."];
	return ["pi-realtime", ...sessions.slice(0, 5).map((session) => `${marker(state.primaryProviderSessionId === session.providerSessionId)} ${session.providerSessionId} ${session.provider}/${session.model} mode=${session.interactionMode} ${session.status}`)];
}

export function statusText(state: RealtimeState): string {
	const sessions = [...state.sessions.values()];
	const active = sessions.filter((session) => session.status === "active" || session.status === "starting");
	return sessions.length === 0 ? "pi-realtime: idle" : `pi-realtime: ${active.length}/${sessions.length} active`;
}

export function renderStatusText(state: RealtimeState): string {
	const MAX_VISIBLE_SESSIONS = 6;
	const sessions = [...state.sessions.values()];
	if (sessions.length === 0) return "pi-realtime: no provider sessions";
	const active = sessions.filter((session) => session.status === "active" || session.status === "starting");
	const header = `pi-realtime: ${active.length}/${sessions.length} active provider session${sessions.length === 1 ? "" : "s"}`;
	const details = sessions.slice(-MAX_VISIBLE_SESSIONS).map((session) => `${state.primaryProviderSessionId === session.providerSessionId ? "*" : "-"} ${session.providerSessionId} ${session.provider}/${session.model} mode=${session.interactionMode} ${session.status}${session.lastError ? ` error=${session.lastError}` : ""}`);
	return [header, ...details].join("\n");
}

function marker(primary: boolean): string {
	return primary ? "*" : "-";
}
