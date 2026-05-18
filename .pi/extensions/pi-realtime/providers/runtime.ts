import type { DebugTraceRegistry } from "../debug-trace";
import type { ProviderKind } from "../types";
import { createFakeProviderRuntime } from "./fake";
import { createOpenAIProviderRuntime } from "./openai/runtime";
import type { ProviderRuntime, ProviderRuntimeRegistry } from "./runtime-types";

export type { ProviderAdapterInput, ProviderMediaRuntime, ProviderMediaStartInput, ProviderRuntime, ProviderRuntimeRegistry } from "./runtime-types";

export function createDefaultProviderRuntimeRegistry(debugTraces: DebugTraceRegistry): ProviderRuntimeRegistry {
	const runtimes = new Map<ProviderKind, ProviderRuntime>([
		["fake", createFakeProviderRuntime()],
		["openai", createOpenAIProviderRuntime(debugTraces)],
		["gemini", createUnavailableProviderRuntime("gemini", "gemini-live-2.5-flash-preview")],
	]);
	return {
		get(provider) { return runtimes.get(provider); },
		list() { return [...runtimes.values()]; },
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
