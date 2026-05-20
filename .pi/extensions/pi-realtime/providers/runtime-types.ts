import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ContextPacket, ProviderInteractionConfig, ProviderKind, ProviderMediaMode, ProviderPreferences, ProviderSessionId, VoiceSessionRecord, VoiceToolSurface } from "../types";
import type { ProviderEventSink, RealtimeProviderAdapter } from "./types";

export type ProviderAdapterInput = {
	providerSessionId: ProviderSessionId;
};

export type ProviderMediaStartInput = {
	session: VoiceSessionRecord;
	ctx: ExtensionContext;
	surface: VoiceToolSurface;
	systemPrompt: string;
	interaction: ProviderInteractionConfig;
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
	availableModels?(): readonly string[];
	assertCredentials(): void;
	createAdapter(input: ProviderAdapterInput): RealtimeProviderAdapter;
	media?: Partial<Record<ProviderMediaMode, ProviderMediaRuntime>>;
	warningForPreferences?(preferences: ProviderPreferences): string | undefined;
};

export type ProviderRuntimeRegistry = {
	get(provider: ProviderKind): ProviderRuntime | undefined;
	list(): ProviderRuntime[];
};
