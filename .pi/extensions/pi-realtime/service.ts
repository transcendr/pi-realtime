import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createMacOSFfmpegAudioCapture, type AudioCaptureController } from "./audio";
import { configChanged, contextPacketSent, nextProviderSessionId, primaryChanged, providerEventObserved, sessionStarted, sessionStopped, usageObserved, usageReset, voiceToolCallReceived, voiceToolResultSent } from "./events";
import { createFfplayAudioPlayback, type AudioPlaybackController } from "./playback";
import { createDebugTraceRegistry, describeProviderEvent } from "./debug-trace";
import { defaultVoiceToolSurface, voiceSystemPrompt } from "./prompt";
import { createWebRTCHelperServer, openHelperUrl, type WebRTCHelperServer } from "./media/webrtc-helper/server";
import { buildCitationPacket, buildStatePacket, buildToolSurfacePacket, nextContextRevision } from "./state-packets";
import type { ControlPlane } from "./control-plane";
import { createFakeRealtimeProvider, type FakeRealtimeProviderAdapter } from "./providers/fake";
import { createOpenAIRealtimeProvider, hasOpenAIRealtimeCredentials } from "./providers/openai";
import { createOpenAIWebRTCBridgeAdapter, createOpenAIWebRTCClientSecret, hasOpenAIWebRTCCredentials } from "./providers/openai-webrtc-runtime";
import type { ProviderEventSink, RealtimeProviderAdapter } from "./providers/types";
import type { CitationDeck, ContextPacket, NormalizedProviderEvent, ProviderKind, ProviderSessionId, RealtimeState, VoiceInstructionInput, VoiceToolCallRecord, VoiceToolName, VoiceToolResultRecord, VoiceToolSurface } from "./types";
import type { Store } from "./store";
import { aggregateUsage, renderUsageSummary } from "./usage";
export type Service = {
	refresh(ctx: ExtensionContext): void;
	state(): RealtimeState;
	toolSurface(): VoiceToolSurface;
	statusText(): string;
	startSession(input: { provider: ProviderKind; model: string; personaId?: string; primary?: boolean }, ctx: ExtensionContext): Promise<ProviderSessionId>;
	stopSession(providerSessionId: ProviderSessionId, reason?: string): Promise<void>;
	setPrimary(providerSessionId: ProviderSessionId | null): void;
	observeCitationDeck(ctx: ExtensionContext): CitationDeck;
	buildPackets(ctx: ExtensionContext, providerSessionId: ProviderSessionId): ContextPacket[];
	recordToolCall(call: VoiceToolCallRecord): void;
	recordToolResult(result: VoiceToolResultRecord): Promise<void>;
	submitInstruction(input: VoiceInstructionInput): Promise<void>;
	sendTextInput(providerSessionId: ProviderSessionId, text: string): Promise<void>;
	startMicrophone(providerSessionId: ProviderSessionId): Promise<void>;
	stopMicrophone(providerSessionId?: ProviderSessionId): Promise<void>;
	microphoneStatus(): string;
	startAudioPlayback(providerSessionId: ProviderSessionId): Promise<void>;
	stopAudioPlayback(providerSessionId?: ProviderSessionId): Promise<void>;
	audioPlaybackStatus(): string;
	usageText(providerSessionId?: ProviderSessionId, details?: boolean): string;
	resetUsage(providerSessionId?: ProviderSessionId): string;
	setOpenAIWebRTCEnabled(enabled: boolean): string;
	isOpenAIWebRTCEnabled(): boolean;
	startWebRTCHelper(providerSessionId: ProviderSessionId, ctx: ExtensionContext): Promise<string>;
	stopWebRTCHelper(providerSessionId?: ProviderSessionId): Promise<void>;
	webRTCHelperStatus(): string;
	debugText(providerSessionId?: ProviderSessionId): string;
	rawEchoWarningText(): string;
	simulateFakeTranscript(providerSessionId: ProviderSessionId, text: string, final?: boolean): void;
	simulateFakeToolCall(providerSessionId: ProviderSessionId, name: VoiceToolName, args?: Record<string, unknown>): Promise<string>;
	shutdown(): Promise<void>;
};
export function createService(store: Store, controlPlane: ControlPlane): Service {
	return new RealtimeService(store, controlPlane);
}

class RealtimeService implements Service {
	private currentCtx: ExtensionContext | undefined;
	private readonly surface = defaultVoiceToolSurface();
	private readonly adapters = new Map<ProviderSessionId, RealtimeProviderAdapter>();
	private readonly fakeAdapters = new Map<ProviderSessionId, FakeRealtimeProviderAdapter>();
	private readonly audioCaptures = new Map<ProviderSessionId, AudioCaptureController>();
	private readonly audioPlaybacks = new Map<ProviderSessionId, AudioPlaybackController>();
	private readonly rawEchoWarnings = new Set<ProviderSessionId>();
	private readonly debugTraces = createDebugTraceRegistry();
	private readonly webrtcHelper: WebRTCHelperServer = createWebRTCHelperServer();
	private readonly providerSink: ProviderEventSink = { onProviderEvent: (event) => void this.handleProviderEvent(event), onProviderAudio: (chunk) => this.handleProviderAudio(chunk) };
	constructor(private readonly store: Store, private readonly controlPlane: ControlPlane) {}
	refresh(ctx: ExtensionContext): void { this.currentCtx = ctx; this.store.hydrate(ctx); }
	state(): RealtimeState { return this.store.state(); }
	toolSurface(): VoiceToolSurface { return this.surface; }
	statusText(): string { return status(this.store.state()); }
	setPrimary(providerSessionId: ProviderSessionId | null): void { this.store.append(primaryChanged(providerSessionId)); }
	observeCitationDeck(ctx: ExtensionContext): CitationDeck { return this.controlPlane.observeCitations(ctx); }
	recordToolCall(call: VoiceToolCallRecord): void { this.store.append(voiceToolCallReceived(call)); }
	submitInstruction(input: VoiceInstructionInput): Promise<void> { return this.controlPlane.instructionSink.sendInstruction(input).then(() => undefined); }
	async sendTextInput(providerSessionId: ProviderSessionId, text: string): Promise<void> {
		const adapter = this.adapters.get(providerSessionId);
		if (!adapter) throw new Error(`No live provider adapter for ${providerSessionId}`);
		await adapter.sendTextInput(text);
	}
	async startMicrophone(providerSessionId: ProviderSessionId): Promise<void> {
		const adapter = this.adapters.get(providerSessionId);
		if (!adapter) throw new Error(`No live provider adapter for ${providerSessionId}`);
		this.warnIfRawEchoRisk(providerSessionId, adapter);
		if (this.audioCaptures.has(providerSessionId)) throw new Error(`Microphone is already running for ${providerSessionId}`);
		const capture = createMacOSFfmpegAudioCapture();
		this.audioCaptures.set(providerSessionId, capture);
		await capture.start((chunk) => adapter.sendAudioInput(chunk).then(() => undefined), (error) => this.handleMicrophoneError(providerSessionId, error));
	}
	async stopMicrophone(providerSessionId?: ProviderSessionId): Promise<void> {
		const ids = providerSessionId ? [providerSessionId] : [...this.audioCaptures.keys()];
		for (const id of ids) {
			const capture = this.audioCaptures.get(id);
			if (!capture) continue;
			await capture.stop();
			this.audioCaptures.delete(id);
		}
	}

	microphoneStatus(): string {
		if (this.audioCaptures.size === 0) return "microphone: idle";
		return ["microphone:", ...[...this.audioCaptures].map(([id, capture]) => `- ${id} ${capture.status}`)].join("\n");
	}

	async startAudioPlayback(providerSessionId: ProviderSessionId): Promise<void> {
		const adapter = this.adapters.get(providerSessionId);
		if (!adapter) throw new Error(`No live provider adapter for ${providerSessionId}`);
		this.warnIfRawEchoRisk(providerSessionId, adapter);
		if (this.audioPlaybacks.has(providerSessionId)) return;
		const playback = createFfplayAudioPlayback();
		this.audioPlaybacks.set(providerSessionId, playback);
		await playback.start((error) => this.handleAudioPlaybackError(providerSessionId, error));
		await adapter.setAudioOutputEnabled(true);
	}

	async stopAudioPlayback(providerSessionId?: ProviderSessionId): Promise<void> {
		const ids = providerSessionId ? [providerSessionId] : [...this.audioPlaybacks.keys()];
		for (const id of ids) {
			await this.adapters.get(id)?.setAudioOutputEnabled(false);
			const playback = this.audioPlaybacks.get(id);
			if (!playback) continue;
			await playback.stop();
			this.audioPlaybacks.delete(id);
		}
	}

	audioPlaybackStatus(): string {
		if (this.audioPlaybacks.size === 0) return "audio playback: idle";
		return ["audio playback:", ...[...this.audioPlaybacks].map(([id, playback]) => `- ${id} ${playback.status}`)].join("\n");
	}

	usageText(providerSessionId?: ProviderSessionId, details = false): string {
		const state = this.store.state();
		const summary = renderUsageSummary(aggregateUsage(state.usage, providerSessionId, state.usageResets), details);
		if (providerSessionId) {
			const session = state.sessions.get(providerSessionId);
			return session ? [`session: ${session.providerSessionId} ${session.provider}/${session.model} ${session.status}`, summary].join("\n") : summary;
		}
		const sessions = [...state.sessions.values()].map((session) => `- ${session.providerSessionId} ${session.provider}/${session.model} ${session.status}`);
		return sessions.length > 0 ? [summary, "sessions:", ...sessions].join("\n") : summary;
	}

	resetUsage(providerSessionId?: ProviderSessionId): string {
		this.store.append(usageReset(providerSessionId));
		return providerSessionId ? `Reset realtime usage counters for ${providerSessionId}. Historical usage events were preserved.` : "Reset realtime usage counters. Historical usage events were preserved.";
	}

	setOpenAIWebRTCEnabled(enabled: boolean): string {
		this.store.append(configChanged({ openaiWebRTCEnabled: enabled }));
		return `OpenAI WebRTC auto-launch is ${enabled ? "on" : "off"}.`;
	}

	isOpenAIWebRTCEnabled(): boolean {
		return this.store.state().config.openaiWebRTCEnabled;
	}

	async startWebRTCHelper(providerSessionId: ProviderSessionId, ctx: ExtensionContext): Promise<string> {
		const session = this.store.state().sessions.get(providerSessionId);
		if (!session || session.provider !== "openai") throw new Error(`No OpenAI realtime session found for ${providerSessionId}`);
		if (!hasOpenAIWebRTCCredentials()) throw new Error("OPENAI_API_KEY is required to start an OpenAI WebRTC helper session.");
		await this.stopMicrophone(providerSessionId);
		await this.stopAudioPlayback(providerSessionId);
		await this.adapters.get(providerSessionId)?.disconnect("user");
		await this.webrtcHelper.start();
		const trace = this.debugTraces.create(providerSessionId);
		trace.write({ source: "service", direction: "start_webrtc_helper", model: session.model });
		const adapter = createOpenAIWebRTCBridgeAdapter(providerSessionId, this.webrtcHelper, () => createOpenAIWebRTCClientSecret({ model: session.model, instructions: systemPromptFor(this.surface), toolSurface: this.surface }), trace);
		this.adapters.set(providerSessionId, adapter);
		const packets = this.buildPackets(ctx, providerSessionId);
		await adapter.connect({ providerSessionId, provider: "openai", model: session.model, personaId: session.personaId, systemPrompt: systemPromptFor(this.surface), toolSurface: this.surface, initialContext: packets[0], capabilities: { preferPassiveContext: false, preferSemanticVad: true } }, this.providerSink);
		for (const packet of packets.slice(1)) this.store.append(contextPacketSent(providerSessionId, packet, await adapter.updateContext(packet)));
		const url = this.webrtcHelper.urlFor(providerSessionId);
		openHelperUrl(url);
		return url;
	}

	async stopWebRTCHelper(providerSessionId?: ProviderSessionId): Promise<void> {
		const ids = providerSessionId ? [providerSessionId] : [...this.adapters].filter(([, adapter]) => adapter.mediaMode === "webrtc").map(([id]) => id);
		for (const id of ids) {
			const adapter = this.adapters.get(id);
			if (adapter?.mediaMode !== "webrtc") continue;
			await adapter.disconnect("user");
			this.adapters.delete(id);
		}
		if (!providerSessionId || ![...this.adapters.values()].some((adapter) => adapter.mediaMode === "webrtc")) await this.webrtcHelper.stop();
	}

	webRTCHelperStatus(): string {
		return this.webrtcHelper.status();
	}

	debugText(providerSessionId?: ProviderSessionId): string {
		return this.debugTraces.render(this.store.state(), providerSessionId);
	}

	rawEchoWarningText(): string {
		return rawEchoWarningText();
	}

	async startSession(input: { provider: ProviderKind; model: string; personaId?: string; primary?: boolean }, ctx: ExtensionContext): Promise<ProviderSessionId> {
		const providerSessionId = nextProviderSessionId(input.provider);
		this.store.append(sessionStarted({ providerSessionId, provider: input.provider, model: input.model, personaId: input.personaId ?? "default" }));
		if (input.primary ?? true) this.store.append(primaryChanged(providerSessionId));
		const packets = this.buildPackets(ctx, providerSessionId);
		if (input.provider === "fake") await this.startFakeAdapter(providerSessionId, input, packets);
		else if (input.provider === "openai") await this.startOpenAIAdapter(providerSessionId, input, packets);
		else this.markPacketsSkipped(providerSessionId, packets, "Provider adapter not implemented yet.");
		return providerSessionId;
	}

	async stopSession(providerSessionId: ProviderSessionId, reason = "user"): Promise<void> {
		await this.stopMicrophone(providerSessionId);
		await this.stopAudioPlayback(providerSessionId);
		const adapter = this.adapters.get(providerSessionId);
		if (adapter?.mediaMode === "webrtc") await this.stopWebRTCHelper(providerSessionId);
		else await adapter?.disconnect(reason === "shutdown" ? "shutdown" : "user");
		this.adapters.delete(providerSessionId);
		this.fakeAdapters.delete(providerSessionId);
		this.store.append(sessionStopped(providerSessionId, reason));
	}

	buildPackets(ctx: ExtensionContext, providerSessionId: ProviderSessionId): ContextPacket[] {
		const state = this.store.state();
		const target = this.controlPlane.currentTarget(ctx);
		const citationDeck = this.controlPlane.observeCitations(ctx);
		return [buildToolSurfacePacket(this.surface, target), buildStatePacket(state, target, nextContextRevision(state, providerSessionId, "pi_state")), buildCitationPacket(citationDeck, target)];
	}

	async recordToolResult(result: VoiceToolResultRecord): Promise<void> {
		this.store.append(voiceToolResultSent(result));
		await this.adapters.get(result.providerSessionId)?.sendToolResult(result);
	}

	simulateFakeTranscript(providerSessionId: ProviderSessionId, text: string, final = true): void {
		const adapter = this.requireFakeAdapter(providerSessionId);
		adapter.simulateTranscript(text, final);
	}

	async simulateFakeToolCall(providerSessionId: ProviderSessionId, name: VoiceToolName, args: Record<string, unknown> = {}): Promise<string> {
		return this.requireFakeAdapter(providerSessionId).simulateToolCall(name, args);
	}

	async shutdown(): Promise<void> {
		await this.stopMicrophone();
		await this.stopAudioPlayback();
		await this.stopWebRTCHelper();
		for (const session of this.store.state().sessions.values()) if (session.status === "active" || session.status === "starting") await this.stopSession(session.providerSessionId, "shutdown");
		this.currentCtx = undefined;
	}

	private async startFakeAdapter(providerSessionId: ProviderSessionId, input: { model: string; personaId?: string }, packets: ContextPacket[]): Promise<void> {
		const adapter = createFakeRealtimeProvider(providerSessionId);
		this.adapters.set(providerSessionId, adapter);
		this.fakeAdapters.set(providerSessionId, adapter);
		await adapter.connect({ providerSessionId, provider: "fake", model: input.model, personaId: input.personaId ?? "default", systemPrompt: systemPromptFor(this.surface), toolSurface: this.surface, initialContext: packets[0], capabilities: { preferPassiveContext: true, preferSemanticVad: false } }, this.providerSink);
		for (const packet of packets) this.store.append(contextPacketSent(providerSessionId, packet, await adapter.updateContext(packet)));
	}

	private async startOpenAIAdapter(providerSessionId: ProviderSessionId, input: { model: string; personaId?: string }, packets: ContextPacket[]): Promise<void> {
		if (!hasOpenAIRealtimeCredentials()) throw new Error("OPENAI_API_KEY is required to start an OpenAI realtime session.");
		const adapter = createOpenAIRealtimeProvider(providerSessionId);
		this.adapters.set(providerSessionId, adapter);
		await adapter.connect({ providerSessionId, provider: "openai", model: input.model, personaId: input.personaId ?? "default", systemPrompt: systemPromptFor(this.surface), toolSurface: this.surface, initialContext: packets[0], capabilities: { preferPassiveContext: false, preferSemanticVad: true } }, this.providerSink);
		for (const packet of packets.slice(1)) this.store.append(contextPacketSent(providerSessionId, packet, await adapter.updateContext(packet)));
	}

	private markPacketsSkipped(providerSessionId: ProviderSessionId, packets: ContextPacket[], message: string): void {
		for (const packet of packets) this.store.append(contextPacketSent(providerSessionId, packet, { status: "skipped", message }));
	}

	private async handleProviderEvent(event: NormalizedProviderEvent): Promise<void> {
		this.traceProviderEvent(event);
		this.store.append(providerEventObserved(event));
		if (event.type === "usage") this.store.append(usageObserved(event.observation));
		this.notifyProviderEvent(event);
		if (event.type !== "tool_call") return;
		this.store.append(voiceToolCallReceived(event.call));
		await this.executeDirectTool(event.call);
	}

	private traceProviderEvent(event: NormalizedProviderEvent): void {
		this.debugTraces.recorderFor(event.providerSessionId)?.write({ source: "service", direction: "provider_event", ...describeProviderEvent(event) });
	}

	private notifyProviderEvent(event: NormalizedProviderEvent): void {
		const notify = this.currentCtx?.ui.notify;
		if (!notify) return;
		if (event.type === "assistant_transcript" && event.final) notify(`Realtime ${event.provider}: ${event.text}`);
		else if (event.type === "tool_call") notify(`Realtime ${event.provider} tool call: ${event.call.name}`);
		else if (event.type === "error") notify(`Realtime ${event.provider} error: ${event.message}`, "warning");
	}

	private warnIfRawEchoRisk(providerSessionId: ProviderSessionId, adapter: RealtimeProviderAdapter): void {
		if (adapter.provider !== "openai" || adapter.mediaMode !== "raw" || this.rawEchoWarnings.has(providerSessionId)) return;
		this.rawEchoWarnings.add(providerSessionId);
		this.currentCtx?.ui.notify(rawEchoWarningText(), "warning");
	}

	private handleMicrophoneError(providerSessionId: ProviderSessionId, error: Error): void {
		this.audioCaptures.delete(providerSessionId);
		this.currentCtx?.ui.notify(`Realtime microphone error for ${providerSessionId}: ${error.message}`, "warning");
	}

	private handleProviderAudio(chunk: { providerSessionId: ProviderSessionId; audio: Buffer }): void {
		this.audioPlaybacks.get(chunk.providerSessionId)?.write(chunk.audio);
	}

	private handleAudioPlaybackError(providerSessionId: ProviderSessionId, error: Error): void {
		this.audioPlaybacks.delete(providerSessionId);
		this.currentCtx?.ui.notify(`Realtime audio playback error for ${providerSessionId}: ${error.message}`, "warning");
	}

	private async executeDirectTool(call: VoiceToolCallRecord): Promise<void> {
		const resultText = await this.directToolResult(call, this.currentCtx);
		await this.recordToolResult({ voiceToolCallId: call.voiceToolCallId, providerSessionId: call.providerSessionId, status: "sent", resultText, at: Date.now() });
	}

	private async directToolResult(call: VoiceToolCallRecord, ctx: ExtensionContext | undefined): Promise<string> {
		if (call.name === "pi_wait_for_update") return "Acknowledged. Waiting for more user input or Pi state changes.";
		if (call.name === "pi_realtime_status") return status(this.store.state());
		if (!ctx) return "No active Pi context is available for this fake provider event.";
		if (call.name === "pi_state_snapshot") return JSON.stringify(buildStatePacket(this.store.state(), this.controlPlane.currentTarget(ctx), nextContextRevision(this.store.state(), call.providerSessionId, "pi_state")));
		if (call.name === "pinotator_citations_list") return JSON.stringify(this.controlPlane.observeCitations(ctx));
		if (call.name === "pinotator_citation_resolve") return JSON.stringify(resolveCitation(this.controlPlane.observeCitations(ctx), stringArg(call.arguments.ref)));
		if (call.name === "pi_send_instruction") return this.sendInstructionFromTool(call, ctx);
		return `Unsupported direct voice tool: ${call.name}`;
	}

	private async sendInstructionFromTool(call: VoiceToolCallRecord, ctx: ExtensionContext): Promise<string> {
		const instructionText = stringArg(call.arguments.instruction) || stringArg(call.arguments.text);
		if (!instructionText) return "Rejected pi_send_instruction: missing required non-empty instruction text. Ask the user for clarification or call pi_send_instruction again with the exact Pi action requested.";
		const deck = this.controlPlane.observeCitations(ctx);
		await this.controlPlane.instructionSink.sendInstruction({ instructionId: call.voiceToolCallId, provider: call.provider, providerSessionId: call.providerSessionId, voiceToolCallId: call.voiceToolCallId, providerToolCallId: call.providerToolCallId, target: this.controlPlane.currentTarget(ctx), urgency: call.arguments.urgency === "interrupt" ? "interrupt" : "normal", instructionText, userUtteranceSummary: stringArg(call.arguments.userUtteranceSummary), citedCitationIds: stringArrayArg(call.arguments.citedCitationIds), citationDeckRevision: deck.revision });
		return "Submitted instruction to Pi.";
	}

	private requireFakeAdapter(providerSessionId: ProviderSessionId): FakeRealtimeProviderAdapter {
		const adapter = this.fakeAdapters.get(providerSessionId);
		if (!adapter) throw new Error(`No live fake provider adapter for ${providerSessionId}`);
		return adapter;
	}
}

export function defaultModelFor(provider: ProviderKind): string {
	if (provider === "openai") return "gpt-realtime-2";
	if (provider === "gemini") return "gemini-live-2.5-flash-preview";
	return "fake-realtime";
}

export function systemPromptFor(surface: VoiceToolSurface = defaultVoiceToolSurface()): string {
	return voiceSystemPrompt(surface);
}

export function rawEchoWarningText(): string {
	return "Raw OpenAI audio mode does not provide local acoustic echo cancellation. Use headphones, or run /realtime openai webrtc start for speaker-safe browser/WebRTC audio.";
}

function status(state: RealtimeState): string {
	const MAX_VISIBLE_SESSIONS = 6;
	const sessions = [...state.sessions.values()];
	if (sessions.length === 0) return "pi-realtime: no provider sessions";
	const active = sessions.filter((session) => session.status === "active" || session.status === "starting");
	const header = `pi-realtime: ${active.length}/${sessions.length} active provider session${sessions.length === 1 ? "" : "s"}`;
	const details = sessions.slice(-MAX_VISIBLE_SESSIONS).map((session) => `${state.primaryProviderSessionId === session.providerSessionId ? "*" : "-"} ${session.providerSessionId} ${session.provider}/${session.model} ${session.status}${session.lastError ? ` error=${session.lastError}` : ""}`);
	return [header, ...details].join("\n");
}

function resolveCitation(deck: CitationDeck, ref: string): unknown {
	return deck.active.find((item) => item.displayRef === ref || item.alias === ref || item.citationId === ref || item.displayRef === `[${ref}]`) ?? { error: `Citation not found: ${ref}`, deckRevision: deck.revision };
}

function stringArg(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function stringArrayArg(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
