import type { DebugTraceRegistry } from "../../debug-trace";
import { createWebRTCHelperServer, openHelperUrl, type WebRTCHelperServer } from "../../media/webrtc-helper/server";
import { voiceSystemPrompt } from "../../prompt";
import { createOpenAIRealtimeProvider, hasOpenAIRealtimeCredentials } from "./index";
import { summarizeOpenAIRealtimeAudioConfig } from "./session-config";
import { createOpenAIWebRTCClientSecret, hasOpenAIWebRTCCredentials } from "./webrtc";
import { createOpenAIWebRTCBridgeAdapter } from "./webrtc-bridge";
import type { ProviderMediaRuntime, ProviderRuntime } from "../runtime-types";

export function createOpenAIProviderRuntime(debugTraces: DebugTraceRegistry): ProviderRuntime {
	const webrtcHelper = createWebRTCHelperServer();
	return {
		provider: "openai",
		defaultModel() { return "gpt-realtime-mini"; },
		assertCredentials() {
			if (!hasOpenAIRealtimeCredentials()) throw new Error("OPENAI_API_KEY is required to start an OpenAI realtime session.");
		},
		createAdapter(input) { return createOpenAIRealtimeProvider(input.providerSessionId); },
		media: { webrtc: createOpenAIWebRTCMediaRuntime({ debugTraces, webrtcHelper }) },
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
			trace.write({ source: "provider_runtime", direction: "start_webrtc_helper", model: input.session.model, audioConfig: summarizeOpenAIRealtimeAudioConfig() });
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
