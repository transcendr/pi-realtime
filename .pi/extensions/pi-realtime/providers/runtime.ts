import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DebugTraceRegistry } from "../debug-trace";
import { createWebRTCHelperServer, openHelperUrl, type WebRTCHelperServer } from "../media/webrtc-helper/server";
import { voiceSystemPrompt } from "../prompt";
import type { ContextPacket, ProviderKind, ProviderMediaMode, ProviderSessionId, ProviderPreferences, VoiceSessionRecord, VoiceToolSurface } from "../types";
import { createFakeRealtimeProvider } from "./fake";
import { createOpenAIRealtimeProvider, hasOpenAIRealtimeCredentials } from "./openai";
import { createOpenAIWebRTCBridgeAdapter } from "./openai-webrtc-bridge";
import { createOpenAIWebRTCClientSecret, hasOpenAIWebRTCCredentials } from "./openai-webrtc";
import type { ProviderEventSink, RealtimeProviderAdapter } from "./types";

export type ProviderAdapterInput = {
	providerSessionId: ProviderSessionId;
};

export type ProviderMediaStartInput = {
	session: VoiceSessionRecord;
	ctx: ExtensionContext;
	surface: VoiceToolSurface;
	sink: ProviderEventSink;
	packets: ContextPacket[];
	currentAdapter?: RealtimeProviderAdapter;
	setAdapter(adapter: RealtimeProviderAdapter): void;
	stopLocalMedia(providerSessionId: ProviderSessionId): Promise<void>;
	recordContext(packet: ContextPacket, adapter: RealtimeProviderAdapter): Promise<void>;
};

export type ProviderMediaRuntime = {
	start(input: ProviderMediaStartInput): Promise<string>;
	stop(providerSessionId?: ProviderSessionId): Promise<void>;
	status(): string;
};

export type ProviderRuntime = {
	provider: ProviderKind;
	defaultModel(): string;
	assertCredentials(): void;
	createAdapter(input: ProviderAdapterInput): RealtimeProviderAdapter;
	media?: Partial<Record<ProviderMediaMode, ProviderMediaRuntime>>;
	warningForPreferences?(preferences: ProviderPreferences): string | undefined;
};

export type ProviderRuntimeRegistry = {
	get(provider: ProviderKind): ProviderRuntime | undefined;
	list(): ProviderRuntime[];
};

export function createDefaultProviderRuntimeRegistry(debugTraces: DebugTraceRegistry): ProviderRuntimeRegistry {
	const webrtcHelper = createWebRTCHelperServer();
	const runtimes = new Map<ProviderKind, ProviderRuntime>([
		["fake", createFakeProviderRuntime()],
		["openai", createOpenAIProviderRuntime({ debugTraces, webrtcHelper })],
		["gemini", createUnavailableProviderRuntime("gemini", "gemini-live-2.5-flash-preview")],
	]);
	return {
		get(provider) { return runtimes.get(provider); },
		list() { return [...runtimes.values()]; },
	};
}

function createFakeProviderRuntime(): ProviderRuntime {
	return {
		provider: "fake",
		defaultModel() { return "fake-realtime"; },
		assertCredentials() { return; },
		createAdapter(input) { return createFakeRealtimeProvider(input.providerSessionId); },
	};
}

function createUnavailableProviderRuntime(provider: ProviderKind, model: string): ProviderRuntime {
	return {
		provider,
		defaultModel() { return model; },
		assertCredentials() { throw new Error(`Provider adapter not implemented yet: ${provider}`); },
		createAdapter() { throw new Error(`Provider adapter not implemented yet: ${provider}`); },
	};
}

function createOpenAIProviderRuntime(deps: { debugTraces: DebugTraceRegistry; webrtcHelper: WebRTCHelperServer }): ProviderRuntime {
	return {
		provider: "openai",
		defaultModel() { return "gpt-realtime-2"; },
		assertCredentials() {
			if (!hasOpenAIRealtimeCredentials()) throw new Error("OPENAI_API_KEY is required to start an OpenAI realtime session.");
		},
		createAdapter(input) { return createOpenAIRealtimeProvider(input.providerSessionId); },
		media: { webrtc: createOpenAIWebRTCMediaRuntime(deps) },
		warningForPreferences(preferences) { return preferences.autoMediaMode === "webrtc" ? undefined : "Raw OpenAI audio mode does not provide local acoustic echo cancellation. Use headphones, or run /realtime webrtc on for speaker-safe browser/WebRTC audio."; },
	};
}

function createOpenAIWebRTCMediaRuntime(deps: { debugTraces: DebugTraceRegistry; webrtcHelper: WebRTCHelperServer }): ProviderMediaRuntime {
	return {
		async start(input) {
			if (!hasOpenAIWebRTCCredentials()) throw new Error("OPENAI_API_KEY is required to start an OpenAI WebRTC helper session.");
			await input.stopLocalMedia(input.session.providerSessionId);
			await input.currentAdapter?.disconnect("user");
			await deps.webrtcHelper.start();
			const trace = deps.debugTraces.create(input.session.providerSessionId);
			trace.write({ source: "provider_runtime", direction: "start_webrtc_helper", model: input.session.model });
			const systemPrompt = voiceSystemPrompt(input.surface);
			const adapter = createOpenAIWebRTCBridgeAdapter(input.session.providerSessionId, deps.webrtcHelper, () => createOpenAIWebRTCClientSecret({ model: input.session.model, instructions: systemPrompt, toolSurface: input.surface }), trace);
			input.setAdapter(adapter);
			await adapter.connect({ providerSessionId: input.session.providerSessionId, provider: "openai", model: input.session.model, personaId: input.session.personaId, systemPrompt, toolSurface: input.surface, initialContext: input.packets[0], capabilities: { preferPassiveContext: false, preferSemanticVad: true } }, input.sink);
			for (const packet of input.packets.slice(1)) await input.recordContext(packet, adapter);
			const url = deps.webrtcHelper.urlFor(input.session.providerSessionId);
			openHelperUrl(url);
			return url;
		},
		async stop(providerSessionId) {
			// The bridge adapter unregisters per-session state; stopping the helper here
			// is intentionally coarse because the helper owns only OpenAI WebRTC media.
			if (!providerSessionId) await deps.webrtcHelper.stop();
		},
		status() { return deps.webrtcHelper.status(); },
	};
}
