import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createAudioManager, type AudioManager, type AudioManagerErrorKind } from "./audio-manager";
import { configChanged, contextPacketSent, nextProviderSessionId, primaryChanged, providerEventObserved, sessionStarted, sessionStopped, usageObserved, usageReset, voiceToolCallReceived, voiceToolResultSent } from "./events";
import { createDebugTraceRegistry, describeProviderEvent } from "./debug-trace";
import { defaultVoiceToolSurface, voiceSystemPrompt } from "./prompt";
import { buildCitationPacket, buildStatePacket, buildToolSurfacePacket, nextContextRevision } from "./state-packets";
import type { ControlPlane } from "./control-plane";
import type { FakeRealtimeProviderAdapter } from "./providers/fake";
import { createDefaultProviderRuntimeRegistry, type ProviderRuntimeRegistry } from "./providers/runtime";
import type { ProviderEventSink, RealtimeProviderAdapter, ToolResultResponsePolicy } from "./providers/types";
import type { CitationDeck, ContextPacket, NormalizedProviderEvent, ProviderKind, ProviderMediaMode, ProviderPreferences, ProviderSessionId, RealtimeContextPushInput, RealtimeState, VoiceInstructionInput, VoiceToolCallRecord, VoiceToolName, VoiceToolResultRecord, VoiceToolSurface } from "./types";
import type { Store } from "./store";
import { executeVoiceTool } from "./tools/realtime";
import { aggregateUsage, renderUsageSummary } from "./usage";
import { renderStatusText } from "./view";
export type Service = {
	refresh(ctx: ExtensionContext): void;
	state(): RealtimeState;
	toolSurface(): VoiceToolSurface;
	statusText(): string;
	realtimeStatusText(providerSessionId?: ProviderSessionId): string;
	defaultModelFor(provider: ProviderKind): string;
	startSession(input: { provider: ProviderKind; model: string; personaId?: string; primary?: boolean }, ctx: ExtensionContext): Promise<ProviderSessionId>;
	stopSession(providerSessionId: ProviderSessionId, reason?: string): Promise<void>;
	setPrimary(providerSessionId: ProviderSessionId | null): void;
	observeCitationDeck(ctx: ExtensionContext): CitationDeck;
	buildPackets(ctx: ExtensionContext, providerSessionId: ProviderSessionId): ContextPacket[];
	recordToolCall(call: VoiceToolCallRecord): void;
	recordToolResult(result: VoiceToolResultRecord, policy?: ToolResultResponsePolicy): Promise<void>;
	submitInstruction(input: VoiceInstructionInput): Promise<void>;
	sendTextInput(providerSessionId: ProviderSessionId, text: string): Promise<void>;
	pushRealtimeContext(input: RealtimeContextPushInput): Promise<string>;
	startMicrophone(providerSessionId: ProviderSessionId): Promise<void>;
	stopMicrophone(providerSessionId?: ProviderSessionId): Promise<void>;
	microphoneStatus(): string;
	startAudioPlayback(providerSessionId: ProviderSessionId): Promise<void>;
	stopAudioPlayback(providerSessionId?: ProviderSessionId): Promise<void>;
	audioPlaybackStatus(): string;
	usageText(providerSessionId?: ProviderSessionId, details?: boolean): string;
	resetUsage(providerSessionId?: ProviderSessionId): string;
	updateProviderPreference(provider: ProviderKind, patch: Partial<ProviderPreferences>): string;
	providerPreference(provider: ProviderKind): ProviderPreferences;
	startSessionMedia(providerSessionId: ProviderSessionId, mode: ProviderMediaMode, ctx: ExtensionContext): Promise<string>;
	stopSessionMedia(providerSessionId?: ProviderSessionId): Promise<void>;
	mediaStatus(providerSessionId?: ProviderSessionId): string;
	debugText(providerSessionId?: ProviderSessionId): string;
	providerWarning(provider: ProviderKind): string | undefined;
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
	private readonly audioManager: AudioManager = createAudioManager((providerSessionId, kind, error) => this.handleAudioError(providerSessionId, kind, error));
	private readonly rawEchoWarnings = new Set<ProviderSessionId>();
	private readonly debugTraces = createDebugTraceRegistry();
	private readonly providers: ProviderRuntimeRegistry = createDefaultProviderRuntimeRegistry(this.debugTraces);
	private readonly providerSink: ProviderEventSink = { onProviderEvent: (event) => void this.handleProviderEvent(event), onProviderAudio: (chunk) => this.handleProviderAudio(chunk) };
	constructor(private readonly store: Store, private readonly controlPlane: ControlPlane) {}
	refresh(ctx: ExtensionContext): void { this.currentCtx = ctx; this.store.hydrate(ctx); }
	state(): RealtimeState { return this.store.state(); }
	toolSurface(): VoiceToolSurface { return this.surface; }
	statusText(): string { return renderStatusText(this.store.state()); }
	realtimeStatusText(providerSessionId?: ProviderSessionId): string {
		const state = this.store.state();
		const activeCount = [...state.sessions.values()].filter((session) => session.status === "active" || session.status === "starting").length;
		const target = providerSessionId ?? this.defaultRealtimePushTarget();
		const live = target ? this.adapters.has(target) : false;
		return [
			renderStatusText(state),
			activeCount === 0 ? "Realtime is not currently active: 0 active provider sessions means do not use realtime_send_* tools." : `Realtime active session count: ${activeCount}`,
			`realtime_send target: ${target ?? "none"}`,
			`target live: ${live ? "yes" : "no"}`,
			live ? "Pi can use realtime_send_ack, realtime_send_status, or realtime_send_text for this target." : "No live realtime send target is available; continue normally in Pi and do not retry realtime_send_* tools until a new realtime active-session context message or realtime_status reports target live: yes.",
		].join("\n");
	}
	defaultModelFor(provider: ProviderKind): string { return this.requireProviderRuntime(provider).defaultModel(); }
	setPrimary(providerSessionId: ProviderSessionId | null): void { this.store.append(primaryChanged(providerSessionId)); }
	observeCitationDeck(ctx: ExtensionContext): CitationDeck { return this.controlPlane.observeCitations(ctx); }
	recordToolCall(call: VoiceToolCallRecord): void { this.store.append(voiceToolCallReceived(call)); }
	submitInstruction(input: VoiceInstructionInput): Promise<void> { return this.controlPlane.instructionSink.sendInstruction(input).then(() => undefined); }
	async sendTextInput(providerSessionId: ProviderSessionId, text: string): Promise<void> {
		const adapter = this.adapters.get(providerSessionId);
		if (!adapter) throw new Error(`No live provider adapter for ${providerSessionId}`);
		await adapter.sendTextInput(text);
	}

	async pushRealtimeContext(input: RealtimeContextPushInput): Promise<string> {
		const text = input.text.trim();
		if (!text) throw new Error("realtime_send_* requires non-empty text.");
		const providerSessionId = input.providerSessionId ?? this.defaultRealtimePushTarget();
		if (!providerSessionId) return "No active realtime session is available; the realtime update was not sent. Realtime is not currently active, so do not retry realtime_send_* tools until a new realtime active-session context message arrives or realtime_status reports target live: yes.";
		const adapter = this.adapters.get(providerSessionId);
		if (!adapter) return `Realtime session ${providerSessionId} is not currently live; the realtime update was not sent. Do not retry realtime_send_* tools for this target until a new realtime active-session context message arrives or realtime_status reports target live: yes.`;
		const receipt = await adapter.pushContext({ text, mode: input.mode, source: input.source, kind: input.kind, summary: input.summary });
		this.debugTraces.recorderFor(providerSessionId)?.write({ source: "service", direction: "pi_realtime_context_push", providerSessionId, mode: input.mode, updateKind: input.kind, pushSource: input.source, summary: input.summary, textLength: text.length, responseRequested: input.mode === "request_spoken_response", receiptStatus: receipt.status });
		return `${receipt.message ?? "Realtime context push accepted"} (${providerSessionId}).`;
	}
	async startMicrophone(providerSessionId: ProviderSessionId): Promise<void> {
		const adapter = this.adapters.get(providerSessionId);
		if (!adapter) throw new Error(`No live provider adapter for ${providerSessionId}`);
		this.warnIfRawEchoRisk(providerSessionId, adapter);
		await this.audioManager.startMicrophone(providerSessionId, adapter);
	}
	async stopMicrophone(providerSessionId?: ProviderSessionId): Promise<void> {
		await this.audioManager.stopMicrophone(providerSessionId);
	}

	microphoneStatus(): string {
		return this.audioManager.microphoneStatus();
	}

	async startAudioPlayback(providerSessionId: ProviderSessionId): Promise<void> {
		const adapter = this.adapters.get(providerSessionId);
		if (!adapter) throw new Error(`No live provider adapter for ${providerSessionId}`);
		this.warnIfRawEchoRisk(providerSessionId, adapter);
		await this.audioManager.startAudioPlayback(providerSessionId, adapter);
	}

	async stopAudioPlayback(providerSessionId?: ProviderSessionId): Promise<void> {
		await this.audioManager.stopAudioPlayback(providerSessionId, (id) => this.adapters.get(id));
	}

	audioPlaybackStatus(): string {
		return this.audioManager.audioPlaybackStatus();
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

	updateProviderPreference(provider: ProviderKind, patch: Partial<ProviderPreferences>): string {
		this.store.append(configChanged({ providerPreferences: { ...this.store.state().config.providerPreferences, [provider]: { ...this.providerPreference(provider), ...patch } } }));
		return `${provider} media preference updated.`;
	}

	providerPreference(provider: ProviderKind): ProviderPreferences {
		return this.store.state().config.providerPreferences[provider] ?? {};
	}

	async startSessionMedia(providerSessionId: ProviderSessionId, mode: ProviderMediaMode, ctx: ExtensionContext): Promise<string> {
		const session = this.requireSession(providerSessionId);
		const media = this.providers.get(session.provider)?.media?.[mode];
		if (!media) throw new Error(`${session.provider} does not support ${mode} media.`);
		const packets = this.buildPackets(ctx, providerSessionId);
		return media.start({ session, ctx, surface: this.surface, sink: this.providerSink, packets, currentAdapter: this.adapters.get(providerSessionId), setAdapter: (adapter) => this.setAdapter(providerSessionId, adapter), stopLocalMedia: (id) => this.stopLocalMedia(id), recordContext: (packet, adapter) => this.recordContextPacket(providerSessionId, packet, adapter) });
	}

	async stopSessionMedia(providerSessionId?: ProviderSessionId): Promise<void> {
		const ids = providerSessionId ? [providerSessionId] : [...this.adapters].filter(([, adapter]) => adapter.mediaMode === "webrtc").map(([id]) => id);
		for (const id of ids) {
			const adapter = this.adapters.get(id);
			if (adapter?.mediaMode !== "webrtc") continue;
			await adapter.disconnect("user");
			this.adapters.delete(id);
		}
		const stopSharedRuntime = !providerSessionId || ![...this.adapters.values()].some((adapter) => adapter.mediaMode === "webrtc");
		for (const runtime of this.providers.list()) await runtime.media?.webrtc?.stop(stopSharedRuntime ? undefined : providerSessionId);
	}

	mediaStatus(providerSessionId?: ProviderSessionId): string {
		const session = providerSessionId ? this.store.state().sessions.get(providerSessionId) : undefined;
		if (session) return this.providers.get(session.provider)?.media?.webrtc?.status() ?? `${session.provider} has no WebRTC media runtime.`;
		return this.providers.get("openai")?.media?.webrtc?.status() ?? "webrtc media: unavailable";
	}

	debugText(providerSessionId?: ProviderSessionId): string {
		return this.debugTraces.render(this.store.state(), providerSessionId);
	}

	providerWarning(provider: ProviderKind): string | undefined {
		return this.providers.get(provider)?.warningForPreferences?.(this.providerPreference(provider));
	}

	async startSession(input: { provider: ProviderKind; model: string; personaId?: string; primary?: boolean }, ctx: ExtensionContext): Promise<ProviderSessionId> {
		const runtime = this.requireProviderRuntime(input.provider);
		runtime.assertCredentials();
		const providerSessionId = nextProviderSessionId(input.provider);
		this.store.append(sessionStarted({ providerSessionId, provider: input.provider, model: input.model, personaId: input.personaId ?? "default" }));
		if (input.primary ?? true) this.store.append(primaryChanged(providerSessionId));
		const packets = this.buildPackets(ctx, providerSessionId);
		const adapter = runtime.createAdapter({ providerSessionId });
		this.setAdapter(providerSessionId, adapter);
		await adapter.connect({ providerSessionId, provider: input.provider, model: input.model, personaId: input.personaId ?? "default", systemPrompt: systemPromptFor(this.surface), toolSurface: this.surface, initialContext: packets[0], capabilities: { preferPassiveContext: input.provider === "fake", preferSemanticVad: input.provider !== "fake" } }, this.providerSink);
		for (const packet of input.provider === "fake" ? packets : packets.slice(1)) await this.recordContextPacket(providerSessionId, packet, adapter);
		const session = this.store.state().sessions.get(providerSessionId);
		if (session) this.controlPlane.sendSessionAwareness(session, true);
		return providerSessionId;
	}

	async stopSession(providerSessionId: ProviderSessionId, reason = "user"): Promise<void> {
		await this.stopLocalMedia(providerSessionId);
		const adapter = this.adapters.get(providerSessionId);
		if (adapter?.mediaMode === "webrtc") await this.stopSessionMedia(providerSessionId);
		else await adapter?.disconnect(reason === "shutdown" ? "shutdown" : "user");
		this.adapters.delete(providerSessionId);
		this.fakeAdapters.delete(providerSessionId);
		this.store.append(sessionStopped(providerSessionId, reason));
		const session = this.store.state().sessions.get(providerSessionId);
		if (session) this.controlPlane.sendSessionAwareness(session, false);
	}

	buildPackets(ctx: ExtensionContext, providerSessionId: ProviderSessionId): ContextPacket[] {
		const state = this.store.state();
		const target = this.controlPlane.currentTarget(ctx);
		const citationDeck = this.controlPlane.observeCitations(ctx);
		return [buildToolSurfacePacket(this.surface, target), buildStatePacket(state, target, nextContextRevision(state, providerSessionId, "pi_state")), buildCitationPacket(citationDeck, target)];
	}

	async recordToolResult(result: VoiceToolResultRecord, policy: ToolResultResponsePolicy = "none"): Promise<void> {
		this.store.append(voiceToolResultSent(result));
		await this.adapters.get(result.providerSessionId)?.sendToolResult(result, policy);
	}

	simulateFakeTranscript(providerSessionId: ProviderSessionId, text: string, final = true): void {
		const adapter = this.requireFakeAdapter(providerSessionId);
		adapter.simulateTranscript(text, final);
	}

	async simulateFakeToolCall(providerSessionId: ProviderSessionId, name: VoiceToolName, args: Record<string, unknown> = {}): Promise<string> {
		return this.requireFakeAdapter(providerSessionId).simulateToolCall(name, args);
	}

	async shutdown(): Promise<void> {
		await this.audioManager.shutdown((providerSessionId) => this.adapters.get(providerSessionId));
		await this.stopSessionMedia();
		for (const session of this.store.state().sessions.values()) if (session.status === "active" || session.status === "starting") await this.stopSession(session.providerSessionId, "shutdown");
		this.currentCtx = undefined;
	}

	private requireProviderRuntime(provider: ProviderKind) {
		const runtime = this.providers.get(provider);
		if (!runtime) throw new Error(`Provider adapter not implemented yet: ${provider}`);
		return runtime;
	}

	private requireSession(providerSessionId: ProviderSessionId) {
		const session = this.store.state().sessions.get(providerSessionId);
		if (!session) throw new Error(`No realtime session found for ${providerSessionId}`);
		return session;
	}

	private setAdapter(providerSessionId: ProviderSessionId, adapter: RealtimeProviderAdapter): void {
		this.adapters.set(providerSessionId, adapter);
		if (adapter.provider === "fake") this.fakeAdapters.set(providerSessionId, adapter as FakeRealtimeProviderAdapter);
	}

	private defaultRealtimePushTarget(): ProviderSessionId | null {
		const state = this.store.state();
		const lastInstructionTarget = state.lastInstruction?.providerSessionId;
		if (lastInstructionTarget && this.adapters.has(lastInstructionTarget)) return lastInstructionTarget;
		if (state.primaryProviderSessionId && this.adapters.has(state.primaryProviderSessionId)) return state.primaryProviderSessionId;
		const ids = [...this.adapters.keys()];
		for (let index = ids.length - 1; index >= 0; index -= 1) {
			const id = ids[index] as ProviderSessionId;
			const session = state.sessions.get(id);
			if (session?.status === "active" || session?.status === "starting") return id;
		}
		return null;
	}

	private async stopLocalMedia(providerSessionId: ProviderSessionId): Promise<void> {
		await this.stopMicrophone(providerSessionId);
		await this.stopAudioPlayback(providerSessionId);
	}

	private async recordContextPacket(providerSessionId: ProviderSessionId, packet: ContextPacket, adapter: RealtimeProviderAdapter): Promise<void> {
		this.store.append(contextPacketSent(providerSessionId, packet, await adapter.updateContext(packet)));
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
		if (adapter.mediaMode !== "raw" || this.rawEchoWarnings.has(providerSessionId)) return;
		const warning = this.providerWarning(adapter.provider);
		if (!warning) return;
		this.rawEchoWarnings.add(providerSessionId);
		this.currentCtx?.ui.notify(warning, "warning");
	}

	private handleAudioError(providerSessionId: ProviderSessionId, kind: AudioManagerErrorKind, error: Error): void {
		const label = kind === "microphone" ? "microphone" : "audio playback";
		this.currentCtx?.ui.notify(`Realtime ${label} error for ${providerSessionId}: ${error.message}`, "warning");
	}

	private handleProviderAudio(chunk: { providerSessionId: ProviderSessionId; audio: Buffer }): void {
		this.audioManager.writeProviderAudio(chunk.providerSessionId, chunk.audio);
	}

	private async executeDirectTool(call: VoiceToolCallRecord): Promise<void> {
		const resultText = await executeVoiceTool({ call, ctx: this.currentCtx, state: this.store.state(), controlPlane: this.controlPlane });
		await this.recordToolResult({ voiceToolCallId: call.voiceToolCallId, providerSessionId: call.providerSessionId, status: "sent", resultText, at: Date.now() }, responsePolicyForTool(call));
	}

	private requireFakeAdapter(providerSessionId: ProviderSessionId): FakeRealtimeProviderAdapter {
		const adapter = this.fakeAdapters.get(providerSessionId);
		if (!adapter) throw new Error(`No live fake provider adapter for ${providerSessionId}`);
		return adapter;
	}
}

function responsePolicyForTool(_call: VoiceToolCallRecord): ToolResultResponsePolicy {
	return "none";
}

export function systemPromptFor(surface: VoiceToolSurface = defaultVoiceToolSurface()): string {
	return voiceSystemPrompt(surface);
}
