import { randomUUID } from "node:crypto";
import type { CitationDeck, CitationPacketItem, ContextPacket, ContextPacketChannel, PiTargetRef, RealtimeState, VoiceToolSurface } from "./types";

export function buildStatePacket(state: RealtimeState, target: PiTargetRef, revision: number, now = Date.now()): ContextPacket {
	const active = [...state.sessions.values()].filter((session) => session.status === "active" || session.status === "starting");
	return {
		packetId: packetId("pi_state"),
		revision,
		channel: "pi_state",
		priority: "normal",
		createdAt: now,
		target,
		summary: active.length === 0 ? "No active realtime provider sessions." : `${active.length} realtime provider session${active.length === 1 ? "" : "s"} active.`,
		sections: [
			{ kind: "status", title: "Realtime status", text: active.length === 0 ? "idle" : active.map((session) => `${session.providerSessionId}: ${session.provider}/${session.model} ${session.status}`).join("\n") },
		],
		refs: active.map((session) => ({ kind: "provider_session", id: session.providerSessionId, label: session.provider })),
	};
}

export function buildCitationPacket(deck: CitationDeck, target: PiTargetRef): ContextPacket {
	return {
		packetId: packetId("citations"),
		revision: deck.revision,
		channel: "citations",
		priority: "critical",
		createdAt: deck.observedAt,
		target,
		summary: deck.active.length === 0 ? "No active Pinotator citations." : `${deck.active.length} active Pinotator citation${deck.active.length === 1 ? "" : "s"}.`,
		sections: [{ kind: "citations", title: "Current Pinotator citation deck", text: renderCitationDeck(deck) }],
		refs: deck.active.map((item) => ({ kind: "citation", id: item.citationId, label: item.displayRef })),
	};
}

export function buildToolSurfacePacket(surface: VoiceToolSurface, target: PiTargetRef, now = Date.now()): ContextPacket {
	return {
		packetId: packetId("tool_surface"),
		revision: surface.revision,
		channel: "tool_surface",
		priority: "critical",
		createdAt: now,
		target,
		summary: `${surface.tools.length} direct voice tool${surface.tools.length === 1 ? "" : "s"} available.`,
		sections: [{ kind: "tool_hint", title: "Direct voice tool allowlist", text: surface.tools.map((tool) => `- ${tool.name}: ${tool.description}`).join("\n") }],
		refs: [],
	};
}

export function nextContextRevision(state: RealtimeState, providerSessionId: string, channel: ContextPacketChannel): number {
	return (state.contextRevisions.get(providerSessionId)?.[channel] ?? 0) + 1;
}

export function buildCitationDeckFromBranch(entries: readonly unknown[], now = Date.now()): CitationDeck {
	const active = findLatestPinotatorContent(entries).flatMap(parsePinotatorCitationRefs);
	return { revision: revisionFor(active), source: "pinotator", observedAt: now, active };
}

export function renderCitationDeck(deck: CitationDeck): string {
	if (deck.active.length === 0) return "No active Pinotator citations.";
	return [
		`Current Pinotator citation deck revision: ${deck.revision}`,
		"When the user says a citation number, resolve it to the durable citation id.",
		...deck.active.map((item) => `<pinotator_citation_ref display_ref="${escapeAttr(item.displayRef)}" alias="${escapeAttr(item.alias)}" id="${escapeAttr(item.citationId)}" source="${escapeAttr(item.source)}">\n${escapeText(item.snippet)}\n</pinotator_citation_ref>`),
	].join("\n");
}

function parsePinotatorCitationRefs(content: string): CitationPacketItem[] {
	const regex = /<pinotator_citation\s+([^>]*)>([\s\S]*?)<\/pinotator_citation>/g;
	const items: CitationPacketItem[] = [];
	let match: RegExpExecArray | null;
	while ((match = regex.exec(content)) !== null) {
		const attrs = parseAttrs(match[1] ?? "");
		const text = unescapeText(match[2] ?? "").trim();
		const displayRef = attrs.display_ref ?? `[${items.length + 1}]`;
		items.push({ displayRef, alias: attrs.alias ?? `@p${items.length + 1}`, citationId: attrs.id ?? `unknown-${items.length + 1}`, origin: parseOrigin(attrs.origin), source: attrs.source ?? "pinotator", snippet: snippet(text), fullTextAvailable: text.length > 0 });
	}
	return items;
}

function findLatestPinotatorContent(entries: readonly unknown[]): string[] {
	const contents: string[] = [];
	for (const entry of entries) {
		if (typeof entry !== "object" || entry === null) continue;
		const raw = entry as Record<string, unknown>;
		if (raw.type !== "custom_message" || raw.customType !== "pinotator.citations" || typeof raw.content !== "string") continue;
		contents.push(raw.content);
	}
	return contents.slice(-1);
}

function revisionFor(items: readonly CitationPacketItem[]): number {
	let hash = 0;
	for (const item of items) for (const ch of item.citationId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
	return hash || 1;
}

function parseAttrs(input: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	const regex = /([a-zA-Z_:-]+)="([^"]*)"/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(input)) !== null) attrs[match[1] ?? ""] = unescapeText(match[2] ?? "");
	return attrs;
}

function parseOrigin(value: string | undefined): CitationPacketItem["origin"] {
	return value === "transcript" || value === "manual" ? value : "unknown";
}

function snippet(value: string): string {
	return value.length > 240 ? `${value.slice(0, 237)}...` : value;
}

function packetId(channel: string): string {
	return `${channel}_${randomUUID()}`;
}

function escapeAttr(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeText(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function unescapeText(value: string): string {
	return value.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
