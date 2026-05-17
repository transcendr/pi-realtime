import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NormalizedProviderEvent, ProviderSessionId, ProviderKind } from "../../types";
import type { WebRTCHelperInboundEvent, WebRTCHelperOutboundEvent, WebRTCHelperRegistrationConfig, WebRTCHelperServer, WebRTCHelperSessionConfig, WebRTCHelperSink } from "./protocol";

const HOST = "127.0.0.1";
const CLIENT_HTML = ".pi/extensions/pi-realtime/media/webrtc-helper/client.html";
const CLIENT_JS = ".pi/extensions/pi-realtime/media/webrtc-helper/client.js";

type HelperSession = {
	config: WebRTCHelperSessionConfig;
	createClientSecret(): Promise<unknown>;
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
		const { createClientSecret, ...sessionConfig } = config;
		this.sessions.set(config.providerSessionId, { config: sessionConfig, createClientSecret, sink, outbox: [], seq: 0, lastSeenAt: Date.now() });
	}

	unregisterSession(providerSessionId: ProviderSessionId, reason: string): void {
		const session = this.sessions.get(providerSessionId);
		this.sessions.delete(providerSessionId);
		session?.sink.onProviderEvent(this.normalize(providerSessionId, "openai", { type: "disconnected", reason }));
	}

	enqueue(providerSessionId: ProviderSessionId, event: Record<string, unknown>): void {
		const session = this.requireSession(providerSessionId);
		session.outbox.push({ id: ++session.seq, event });
		session.outbox = session.outbox.slice(-200);
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
			if (req.method === "GET" && /^\/pi-realtime\/openai\/[^/]+$/.test(url.pathname)) return this.serveFile(res, CLIENT_HTML, "text/html; charset=utf-8");
			if (req.method === "GET" && url.pathname === "/pi-realtime/webrtc/client.js") return this.serveFile(res, CLIENT_JS, "text/javascript; charset=utf-8");
			const match = /^\/pi-realtime\/openai\/([^/]+)\/(config|client-secret|event|outbox)$/.exec(url.pathname);
			if (!match) return this.respond(res, 404, { error: "not_found" });
			const providerSessionId = decodeURIComponent(match[1] ?? "");
			const action = match[2];
			const session = this.requireSession(providerSessionId);
			session.lastSeenAt = Date.now();
			if (req.method === "GET" && action === "config") return this.respond(res, 200, session.config);
			if (req.method === "POST" && action === "client-secret") return this.respond(res, 200, await session.createClientSecret());
			if (req.method === "POST" && action === "event") {
				const inbound = await readJson<WebRTCHelperInboundEvent>(req);
				session.sink.onProviderEvent(this.normalize(providerSessionId, session.config.provider, inbound));
				return this.respond(res, 200, { ok: true });
			}
			if (req.method === "GET" && action === "outbox") {
				const after = Number(url.searchParams.get("after") ?? "0");
				return this.respond(res, 200, { events: session.outbox.filter((event) => event.id > after) });
			}
			return this.respond(res, 405, { error: "method_not_allowed" });
		} catch (error) {
			this.respond(res, 500, { error: error instanceof Error ? error.message : String(error) });
		}
	}

	private normalize(providerSessionId: ProviderSessionId, provider: ProviderKind, inbound: WebRTCHelperInboundEvent): NormalizedProviderEvent {
		const base = { provider, providerSessionId, providerEventId: inbound.providerEventId, localSeq: Date.now(), at: Date.now() };
		if (inbound.type === "tool_call") return { ...base, type: "tool_call", call: { ...inbound.call, provider, providerSessionId, status: "pending", createdAt: Date.now() } };
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
