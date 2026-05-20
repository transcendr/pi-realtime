export const EVENT_VERSION = 1;
export const CUSTOM_EVENT_TYPE = "pi-realtime.events.v1";
export const CUSTOM_MESSAGE_TYPE = "pi-realtime.context";

export type ProviderKind = "fake" | "openai" | "gemini";
export type ProviderSessionId = string;
export type VoiceToolCallId = string;
export type InstructionId = string;
export type ContextPacketId = string;
export type CitationId = string;

export type PiTargetRef = {
	kind: "current-session";
	cwd: string;
	sessionId?: string;
};

export type ProviderMediaMode = "raw" | "webrtc" | "none";
export type RealtimeInteractionModeId = "agent" | "eco";
export type TranscriptResponsePolicy = "model" | "suppress";
export type TranscriptBackendRoute = "none" | "submit_instruction";
export type TranscriptRetentionPolicy = "retain" | "delete_after_transcript";
export type ToolChoicePolicy = "auto" | "none";
export type BackendSpeechContext = "default_conversation" | "isolated_update";
export type VoiceInstructionSource = "model_tool" | "direct_transcript" | "manual_text";
export type SpeechChunkSplitStrategy = "sentence";

export type BackendUpdateSpeechChunkingPolicy = {
	enabled: boolean;
	maxChars: number;
	splitStrategy: SpeechChunkSplitStrategy;
};

export type BackendUpdateSpeechPolicy = {
	chunking: BackendUpdateSpeechChunkingPolicy;
};

export type RealtimeBehaviorProfile = {
	backendUpdateSpeech: BackendUpdateSpeechPolicy;
};

export type RealtimeBehaviorProfileFragment = {
	backendUpdateSpeech?: {
		chunking?: Partial<BackendUpdateSpeechChunkingPolicy>;
	};
};

export type TranscriptHandlingPolicy = {
	response: TranscriptResponsePolicy;
	backendRoute: TranscriptBackendRoute;
	retention: TranscriptRetentionPolicy;
};

export type ProviderInteractionConfig = {
	mode: RealtimeInteractionModeId;
	tools: VoiceToolDefinition[];
	toolChoice: ToolChoicePolicy;
	transcriptHandling: TranscriptHandlingPolicy;
	backendSpeechContext: BackendSpeechContext;
};

export type RealtimeInteractionMode = {
	id: RealtimeInteractionModeId;
	toolSurface: VoiceToolSurface;
	systemPrompt(surface: VoiceToolSurface): string;
	acceptModelToolCalls: boolean;
	initialContextPolicy: "full" | "minimal";
	providerInteraction: ProviderInteractionConfig;
};

export type ProviderPreferences = {
	autoMediaMode?: ProviderMediaMode;
	defaultModel?: string;
};

export type RealtimeConfig = {
	primaryProviderSessionId: ProviderSessionId | null;
	defaultProvider: ProviderKind;
	defaultPersonaId: string;
	defaultInteractionMode: RealtimeInteractionModeId;
	providerPreferences: Partial<Record<ProviderKind, ProviderPreferences>>;
};

export type RealtimeConfigPatch = Partial<RealtimeConfig> & {
	/** Replay compatibility for pre-provider-preferences events. */
	openaiWebRTCEnabled?: boolean;
};

export type VoiceSessionRecord = {
	providerSessionId: ProviderSessionId;
	provider: ProviderKind;
	model: string;
	personaId: string;
	interactionMode: RealtimeInteractionModeId;
	status: "starting" | "active" | "stopping" | "stopped" | "error";
	startedAt: number;
	stoppedAt?: number;
	lastProviderEventAt?: number;
	lastError?: string;
};

export type ProviderEventBase = {
	provider: ProviderKind;
	providerSessionId: ProviderSessionId;
	providerEventId?: string;
	localSeq: number;
	at: number;
};

export type UsageSource = "response" | "input_transcription";

export type UsageBreakdown = {
	textTokens: number;
	audioTokens: number;
	imageTokens: number;
	cachedTextTokens: number;
	cachedAudioTokens: number;
	cachedImageTokens: number;
};

export type UsageReset = {
	providerSessionId?: ProviderSessionId;
	at: number;
};

export type UsageObservation = {
	providerSessionId: ProviderSessionId;
	provider: ProviderKind;
	model: string;
	source: UsageSource;
	providerEventId?: string;
	responseId?: string;
	itemId?: string;
	at: number;
	input: UsageBreakdown;
	output: UsageBreakdown;
	totalTokens: number;
	estimatedCostUsd: number;
	costExcludedReason?: string;
};

export type NormalizedProviderEvent =
	| (ProviderEventBase & { type: "connected" })
	| (ProviderEventBase & { type: "disconnected"; reason: string })
	| (ProviderEventBase & { type: "error"; message: string; recoverable: boolean })
	| (ProviderEventBase & { type: "user_transcript"; text: string; final: boolean })
	| (ProviderEventBase & { type: "assistant_transcript"; text: string; final: boolean })
	| (ProviderEventBase & { type: "tool_call"; call: VoiceToolCallRecord })
	| (ProviderEventBase & { type: "usage"; observation: UsageObservation })
	| (ProviderEventBase & { type: "turn_signal"; signal: "speech_started" | "speech_stopped" | "waiting_for_input" | "interrupted" | "turn_complete" })
	| (ProviderEventBase & { type: "context_delivery"; packetId: ContextPacketId; revision: number; status: "delivered" | "skipped" | "failed"; message?: string });

export type ContextPacketChannel = "session" | "pi_state" | "citations" | "tool_surface" | "instruction_result";
export type ContextPacketPriority = "critical" | "normal" | "background";

export type ContextPacketSection = {
	kind: "status" | "recent_output" | "active_goal" | "citations" | "tool_hint" | "instruction_receipt" | "debug";
	title: string;
	text: string;
	tokensEstimate?: number;
};

export type ContextRef = { kind: "citation" | "instruction" | "provider_session" | "session_entry"; id: string; label?: string };

export type ContextPacket = {
	packetId: ContextPacketId;
	revision: number;
	channel: ContextPacketChannel;
	priority: ContextPacketPriority;
	ttlTurns?: number;
	createdAt: number;
	target: PiTargetRef;
	summary: string;
	sections: ContextPacketSection[];
	refs: ContextRef[];
	staleAfterRevision?: number;
};

export type ContextPacketSummary = Pick<ContextPacket, "packetId" | "revision" | "channel" | "priority" | "summary" | "createdAt">;

export type CitationPacketItem = {
	displayRef: string;
	alias: string;
	citationId: CitationId;
	origin: "transcript" | "manual" | "unknown";
	source: string;
	snippet: string;
	fullTextAvailable: boolean;
};

export type CitationDeck = {
	revision: number;
	source: "pinotator";
	observedAt: number;
	active: CitationPacketItem[];
};

export type CitationDeckSummary = { revision: number; count: number; citationIds: CitationId[]; observedAt: number };

export type VoiceToolName = "request" | "pi_state_snapshot" | "pi_send_instruction" | "pi_wait_for_update" | "pi_realtime_status" | "pinotator_citations_list" | "pinotator_citation_resolve";

export type VoiceToolDefinition = {
	name: VoiceToolName;
	description: string;
	direct: true;
	readOnly: boolean;
};

export type VoiceToolSurface = {
	revision: number;
	tools: VoiceToolDefinition[];
};

export type VoiceToolCallRecord = {
	voiceToolCallId: VoiceToolCallId;
	provider: ProviderKind;
	providerSessionId: ProviderSessionId;
	providerToolCallId?: string;
	name: VoiceToolName;
	arguments: Record<string, unknown>;
	status: "pending" | "handled" | "failed";
	createdAt: number;
};

export type VoiceToolResultRecord = {
	voiceToolCallId: VoiceToolCallId;
	providerSessionId: ProviderSessionId;
	status: "sent" | "failed";
	resultText: string;
	at: number;
};

export type VoiceInstructionInput = {
	instructionId: InstructionId;
	source: VoiceInstructionSource;
	provider: ProviderKind;
	providerSessionId: ProviderSessionId;
	voiceToolCallId?: VoiceToolCallId;
	providerToolCallId?: string;
	target: PiTargetRef;
	urgency: "normal" | "interrupt";
	deliveryHint?: "work" | "progress";
	instructionText: string;
	userUtteranceSummary?: string;
	citedCitationIds: CitationId[];
	citationDeckRevision?: number;
};

export type VoiceInstructionReceipt = {
	status: "submitted" | "failed";
	delivery: "immediate" | "followUp" | "steer";
	fallbackUsed?: boolean;
	message?: string;
};

export type VoiceInstructionRecord = VoiceInstructionInput & { submittedAt: number; delivery: VoiceInstructionReceipt["delivery"] };

export type ProviderDeliveryReceipt = { status: "delivered" | "skipped" | "failed"; message?: string };
export type RealtimePushMode = "context_only" | "request_spoken_response";
export type RealtimePushSource = "pi_model_tool" | "automatic_agent_output" | "manual";
export type RealtimeUpdateKind = "ack" | "status" | "text";
export type RealtimeContextPushInput = { providerSessionId?: ProviderSessionId; text: string; mode: RealtimePushMode; source: RealtimePushSource; kind: RealtimeUpdateKind; summary?: string };
export type DisconnectReason = "user" | "shutdown" | "reload" | "tree" | "compact" | "error";

export type RealtimeEvent =
	| { version: typeof EVENT_VERSION; kind: "session_started"; eventId: string; at: number; session: VoiceSessionRecord }
	| { version: typeof EVENT_VERSION; kind: "session_stopped"; eventId: string; at: number; providerSessionId: ProviderSessionId; reason: string }
	| { version: typeof EVENT_VERSION; kind: "session_primary_changed"; eventId: string; at: number; providerSessionId: ProviderSessionId | null }
	| { version: typeof EVENT_VERSION; kind: "provider_event"; eventId: string; at: number; providerEvent: NormalizedProviderEvent }
	| { version: typeof EVENT_VERSION; kind: "context_packet_sent"; eventId: string; at: number; providerSessionId: ProviderSessionId; packet: ContextPacketSummary; receipt: ProviderDeliveryReceipt }
	| { version: typeof EVENT_VERSION; kind: "voice_tool_call_received"; eventId: string; at: number; call: VoiceToolCallRecord }
	| { version: typeof EVENT_VERSION; kind: "voice_tool_result_sent"; eventId: string; at: number; result: VoiceToolResultRecord }
	| { version: typeof EVENT_VERSION; kind: "voice_instruction_submitted"; eventId: string; at: number; instruction: VoiceInstructionRecord; receipt: VoiceInstructionReceipt }
	| { version: typeof EVENT_VERSION; kind: "usage_observed"; eventId: string; at: number; observation: UsageObservation }
	| { version: typeof EVENT_VERSION; kind: "usage_reset"; eventId: string; at: number; providerSessionId?: ProviderSessionId }
	| { version: typeof EVENT_VERSION; kind: "citation_deck_observed"; eventId: string; at: number; deck: CitationDeckSummary }
	| { version: typeof EVENT_VERSION; kind: "config_changed"; eventId: string; at: number; patch: RealtimeConfigPatch };

export type ProviderContextRevisionState = Partial<Record<ContextPacketChannel, number>>;

export type RealtimeHistorySummary = { kind: RealtimeEvent["kind"]; eventId: string; at: number; providerSessionId?: ProviderSessionId };

export type RealtimeState = {
	config: RealtimeConfig;
	sessions: Map<ProviderSessionId, VoiceSessionRecord>;
	primaryProviderSessionId: ProviderSessionId | null;
	pendingToolCalls: Map<VoiceToolCallId, VoiceToolCallRecord>;
	contextRevisions: Map<ProviderSessionId, ProviderContextRevisionState>;
	citationDeck: CitationDeck | null;
	lastInstruction?: VoiceInstructionRecord;
	usage: UsageObservation[];
	usageResets: UsageReset[];
	history: RealtimeHistorySummary[];
};
