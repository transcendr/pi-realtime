import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { summarizeRealtimePayload, type DebugTraceRecorder } from "../../debug-trace";
import type { NormalizedProviderEvent, ProviderSessionId, ProviderKind } from "../../types";
import type { WebRTCHelperInboundEvent, WebRTCHelperOutboundEvent, WebRTCHelperRegistrationConfig, WebRTCHelperServer, WebRTCHelperSessionConfig, WebRTCHelperSink } from "./protocol";

export type { WebRTCHelperServer } from "./protocol";

const HOST = "127.0.0.1";
const CLIENT_HTML = ".pi/extensions/pi-realtime/media/webrtc-helper/client.html";
const CLIENT_JS = ".pi/extensions/pi-realtime/media/webrtc-helper/client.js";

type HelperSession = {
	config: WebRTCHelperSessionConfig;
	createClientSecret(): Promise<unknown>;
	normalizeUsageEvent?: WebRTCHelperRegistrationConfig["normalizeUsageEvent"];
	trace?: DebugTraceRecorder;
	sink: WebRTCHelperSink;
	outbox: WebRTCHelperOutboundEvent[];
	seq: number;
	lastSeenAt: number;
};

export function createWebRTCHelperServer(): WebRTCHelperServer {
	return new LocalWebRTCHelperServer();
}

class LocalWebRTCHelperServer implements WebRTCHelperServer {
	private server: Server | undefined;
	private port: number | undefined;
	private readonly sessions = new Map<ProviderSessionId, HelperSession>();

	async start(): Promise<void> {
		if (this.server) return;
		const server = createServer((req, res) => void this.handle(req, res));
		this.server = server;
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, HOST, () => {
				server.off("error", reject);
				const address = server.address();
				if (!address || typeof address === "string") return reject(new Error("Could not bind WebRTC helper server."));
				this.port = address.port;
				resolve();
			});
		});
	}

	async stop(): Promise<void> {
		const server = this.server;
		if (!server) return;
		this.sessions.clear();
		await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		this.server = undefined;
		this.port = undefined;
	}

	registerSession(config: WebRTCHelperRegistrationConfig, sink: WebRTCHelperSink): void {
		const { createClientSecret, normalizeUsageEvent, trace, ...sessionConfig } = config;
		const session = { config: { ...sessionConfig, debugTracePath: trace?.path }, createClientSecret, normalizeUsageEvent, trace, sink, outbox: [], seq: 0, lastSeenAt: Date.now() };
		this.sessions.set(config.providerSessionId, session);
		trace?.write({ source: "helper_server", direction: "lifecycle", action: "registerSession", model: config.model });
	}

	unregisterSession(providerSessionId: ProviderSessionId, reason: string): void {
		const session = this.sessions.get(providerSessionId);
		this.sessions.delete(providerSessionId);
		if (!session) return;
		session.trace?.write({ source: "helper_server", direction: "lifecycle", action: "unregisterSession", reason });
		session.sink.onProviderEvent(this.normalize(session, { type: "disconnected", reason }) as NormalizedProviderEvent);
	}

	enqueue(providerSessionId: ProviderSessionId, event: Record<string, unknown>): void {
		const session = this.requireSession(providerSessionId);
		const id = ++session.seq;
		session.outbox.push({ id, event });
		session.outbox = session.outbox.slice(-200);
		session.trace?.write({ source: "helper_server", direction: "outbox_enqueue", outboxId: id, summary: summarizeRealtimePayload(event) });
	}

	urlFor(providerSessionId: ProviderSessionId): string {
		if (!this.port) throw new Error("WebRTC helper server is not running.");
		return `http://${HOST}:${this.port}/pi-realtime/openai/${encodeURIComponent(providerSessionId)}`;
	}

	status(): string {
		if (!this.server || !this.port) return "webrtc helper: stopped";
		const rows = [...this.sessions.values()].map((session) => `- ${session.config.providerSessionId} ${session.config.model} lastSeen=${Date.now() - session.lastSeenAt}ms outbox=${session.outbox.length}`);
		return [`webrtc helper: http://${HOST}:${this.port}`, ...rows].join("\n");
	}

	private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			const url = new URL(req.url ?? "/", `http://${HOST}`);
			if (this.tryServeStatic(req, res, url)) return;
			const route = this.sessionRoute(url);
			if (!route) return this.respond(res, 404, { error: "not_found" });
			await this.handleSessionRoute(req, res, url, route);
		} catch (error) {
			this.respond(res, 500, { error: error instanceof Error ? error.message : String(error) });
		}
	}

	private tryServeStatic(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
		if (req.method === "GET" && /^\/pi-realtime\/openai\/[^/]+$/.test(url.pathname)) {
			this.serveFile(res, CLIENT_HTML, "text/html; charset=utf-8");
			return true;
		}
		if (req.method === "GET" && url.pathname === "/pi-realtime/webrtc/client.js") {
			this.serveFile(res, CLIENT_JS, "text/javascript; charset=utf-8");
			return true;
		}
		return false;
	}

	private sessionRoute(url: URL): { providerSessionId: ProviderSessionId; action: string } | undefined {
		const match = /^\/pi-realtime\/openai\/([^/]+)\/(config|client-secret|event|outbox)$/.exec(url.pathname);
		return match ? { providerSessionId: decodeURIComponent(match[1] ?? ""), action: match[2] ?? "" } : undefined;
	}

	private async handleSessionRoute(req: IncomingMessage, res: ServerResponse, url: URL, route: { providerSessionId: ProviderSessionId; action: string }): Promise<void> {
		const session = this.requireSession(route.providerSessionId);
		session.lastSeenAt = Date.now();
		if (req.method === "GET" && route.action === "config") return this.respond(res, 200, session.config);
		if (req.method === "POST" && route.action === "client-secret") return this.respond(res, 200, await session.createClientSecret());
		if (req.method === "POST" && route.action === "event") return this.handleInboundEvent(req, res, session);
		if (req.method === "GET" && route.action === "outbox") return this.respondOutbox(res, url, session);
		return this.respond(res, 405, { error: "method_not_allowed" });
	}

	private async handleInboundEvent(req: IncomingMessage, res: ServerResponse, session: HelperSession): Promise<void> {
		const inbound = await readJson<WebRTCHelperInboundEvent>(req);
		if (inbound.type === "trace") {
			session.trace?.write({ source: "browser", ...inbound.trace, providerEventId: inbound.providerEventId });
			return this.respond(res, 200, { ok: true });
		}
		session.trace?.write({ source: "helper_server", direction: "inbound_normalize", inboundType: inbound.type, providerEventId: inbound.providerEventId });
		const event = this.normalize(session, inbound);
		if (event) {
			session.trace?.write({ source: "helper_server", direction: "normalized_event", eventType: event.type, providerEventId: event.providerEventId, localSeq: event.localSeq });
			session.sink.onProviderEvent(event);
		}
		this.respond(res, 200, { ok: true });
	}

	private respondOutbox(res: ServerResponse, url: URL, session: HelperSession): void {
		const after = Number(url.searchParams.get("after") ?? "0");
		const events = session.outbox.filter((event) => event.id > after);
		session.trace?.write({ source: "helper_server", direction: "outbox_poll", after, returnedIds: events.map((event) => event.id) });
		this.respond(res, 200, { events });
	}

	private normalize(session: HelperSession, inbound: WebRTCHelperInboundEvent): NormalizedProviderEvent | undefined {
		const providerSessionId = session.config.providerSessionId;
		const provider = session.config.provider;
		const base = { provider, providerSessionId, providerEventId: inbound.providerEventId, localSeq: Date.now(), at: Date.now() };
		if (inbound.type === "tool_call") return { ...base, type: "tool_call", call: { ...inbound.call, provider, providerSessionId, status: "pending", createdAt: Date.now() } };
		if (inbound.type === "usage") {
			if (!session.normalizeUsageEvent) return undefined;
			const observation = session.normalizeUsageEvent({ source: inbound.source, realtimeEvent: inbound.realtimeEvent, providerEventId: inbound.providerEventId, at: base.at });
			return observation ? { ...base, type: "usage", observation } : undefined;
		}
		return { ...base, ...inbound } as NormalizedProviderEvent;
	}

	private requireSession(providerSessionId: ProviderSessionId): HelperSession {
		const session = this.sessions.get(providerSessionId);
		if (!session) throw new Error(`No WebRTC helper session for ${providerSessionId}`);
		return session;
	}

	private serveFile(res: ServerResponse, path: string, contentType: string): void {
		res.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
		res.end(readFileSync(join(process.cwd(), path)));
	}

	private respond(res: ServerResponse, status: number, body: unknown): void {
		res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "http://127.0.0.1" });
		res.end(JSON.stringify(body));
	}
}

export function openHelperUrl(url: string): void {
	const child = spawn("open", [url], { detached: true, stdio: "ignore" });
	child.unref();
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}
