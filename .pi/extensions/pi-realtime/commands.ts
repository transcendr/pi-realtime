import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Service } from "./service";
import { parseInteractionMode } from "./domain/interaction-modes";
import type { ProviderKind, ProviderSessionId, RealtimeInteractionModeId, VoiceToolName } from "./types";

type RealtimeCommandHandler = (tokens: string[], ctx: ExtensionCommandContext, service: Service) => Promise<void> | void;

const REALTIME_COMMANDS: Record<string, RealtimeCommandHandler> = {
	help: (_tokens, ctx) => notify(ctx, helpText()),
	status: (_tokens, ctx, service) => notify(ctx, service.statusText()),
	start,
	stop,
	primary,
	mode,
	citations: (_tokens, ctx, service) => citations(ctx, service),
	usage,
	debug,
	webrtc: webrtcPreference,
	text,
	mic,
	audio,
	openai,
	fake,
};

export async function handleRealtimeCommand(args: string, ctx: ExtensionCommandContext, service: Service): Promise<void> {
	service.refresh(ctx);
	const tokens = tokenize(args);
	const [cmd = "status", ...rest] = tokens;
	const handler = REALTIME_COMMANDS[cmd];
	if (!handler) return notify(ctx, `Unknown /realtime command: ${cmd}\n${helpText()}`, "warning");
	await handler(rest, ctx, service);
}

export function realtimeCompletions(): string[] {
	return ["status", "start --provider fake --mode agent", "start --provider openai --mode eco", "mode agent", "mode eco", "text", "mic start", "mic stop", "audio start", "audio stop", "webrtc on", "webrtc off", "openai", "openai start --mode eco", "openai model", "openai model gpt-realtime-mini", "openai model gpt-realtime-2", "openai stop", "openai text", "openai mic start", "openai mic stop", "openai audio start", "openai audio stop", "openai webrtc start", "openai webrtc stop", "openai webrtc status", "usage", "usage --details", "usage reset", "debug", "fake transcript", "fake tool request {\"request\":\"...\"}", "stop", "primary", "citations", "help"];
}

async function start(tokens: string[], ctx: ExtensionCommandContext, service: Service): Promise<void> {
	const provider = providerArg(tokens) ?? "fake";
	const model = valueAfter(tokens, "--model") ?? service.defaultModelFor(provider);
	const personaId = valueAfter(tokens, "--persona") ?? "default";
	const primary = !tokens.includes("--secondary");
	const interactionMode = modeArg(tokens) ?? service.defaultInteractionMode();
	try {
		const providerSessionId = await service.startSession({ provider, model, personaId, primary, interactionMode }, ctx);
		notify(ctx, `Started ${provider} realtime session ${providerSessionId} (${model}, mode=${interactionMode}).${primary ? "" : " Not primary."}`);
		const warning = service.providerWarning(provider);
		if (warning) notify(ctx, warning, "warning");
	} catch (error) {
		notify(ctx, error instanceof Error ? error.message : String(error), "warning");
	}
}

async function stop(tokens: string[], ctx: ExtensionCommandContext, service: Service): Promise<void> {
	const state = service.state();
	const providerSessionId = valueAfter(tokens, "--session") ?? state.primaryProviderSessionId;
	if (!providerSessionId) return notify(ctx, "No realtime provider session is active.", "warning");
	await service.stopSession(providerSessionId, "user");
	notify(ctx, `Stopped realtime session ${providerSessionId}.`);
}

function primary(tokens: string[], ctx: ExtensionCommandContext, service: Service): void {
	const providerSessionId = tokens[0] as ProviderSessionId | undefined;
	if (!providerSessionId) return notify(ctx, "Usage: /realtime primary <providerSessionId>", "warning");
	service.setPrimary(providerSessionId);
	notify(ctx, `Primary realtime session set to ${providerSessionId}.`);
}

function mode(tokens: string[], ctx: ExtensionCommandContext, service: Service): void {
	const selected = parseInteractionMode(tokens[0]);
	if (!selected) return notify(ctx, `Current default realtime interaction mode: ${service.defaultInteractionMode()}\nUsage: /realtime mode agent|eco`, "warning");
	notify(ctx, service.setDefaultInteractionMode(selected));
}

function citations(ctx: ExtensionCommandContext, service: Service): void {
	const deck = service.observeCitationDeck(ctx);
	if (deck.active.length === 0) return notify(ctx, "No active Pinotator citations observed.");
	notify(ctx, [`Pinotator deck revision ${deck.revision}:`, ...deck.active.map((item) => `${item.displayRef} ${item.citationId} ${item.snippet}`)].join("\n"));
}

function usage(tokens: string[], ctx: ExtensionCommandContext, service: Service): void {
	const providerSessionId = valueAfter(tokens, "--session") as ProviderSessionId | undefined;
	if (tokens[0] === "reset") return notify(ctx, service.resetUsage(providerSessionId));
	notify(ctx, service.usageText(providerSessionId, tokens.includes("--details")));
}

function debug(tokens: string[], ctx: ExtensionCommandContext, service: Service): void {
	const providerSessionId = valueAfter(tokens, "--session") as ProviderSessionId | undefined;
	notify(ctx, service.debugText(providerSessionId));
}

function webrtcPreference(tokens: string[], ctx: ExtensionCommandContext, service: Service): void {
	const [mode] = tokens;
	if (mode === "on") return notify(ctx, service.updateProviderPreference("openai", { autoMediaMode: "webrtc" }));
	if (mode === "off") return notify(ctx, service.updateProviderPreference("openai", { autoMediaMode: "none" }));
	notify(ctx, "Usage: /realtime webrtc on|off", "warning");
}

async function text(tokens: string[], ctx: ExtensionCommandContext, service: Service): Promise<void> {
	const providerSessionId = valueAfter(tokens, "--session") ?? service.state().primaryProviderSessionId;
	const message = stripSessionFlag(tokens).join(" ").trim();
	if (!providerSessionId) return notify(ctx, "No primary realtime session. Start one with /realtime start --provider fake or openai.", "warning");
	if (!message) return notify(ctx, "Usage: /realtime text <message>", "warning");
	try {
		await service.sendTextInput(providerSessionId, message);
		notify(ctx, `Sent text input to ${providerSessionId}.`);
	} catch (error) {
		notify(ctx, error instanceof Error ? error.message : String(error), "warning");
	}
}

async function mic(tokens: string[], ctx: ExtensionCommandContext, service: Service): Promise<void> {
	const [subcommand = "status", ...rest] = tokens;
	const providerSessionId = valueAfter(rest, "--session") ?? service.state().primaryProviderSessionId;
	if (subcommand === "status") return notify(ctx, service.microphoneStatus());
	if (!providerSessionId) return notify(ctx, "No primary realtime session. Start one with /realtime start --provider openai.", "warning");
	try {
		if (subcommand === "start") {
			await service.startMicrophone(providerSessionId);
			return notify(ctx, `Started microphone streaming to ${providerSessionId}.`);
		}
		if (subcommand === "stop") {
			await service.stopMicrophone(providerSessionId);
			return notify(ctx, `Stopped microphone streaming to ${providerSessionId}.`);
		}
	} catch (error) {
		return notify(ctx, error instanceof Error ? error.message : String(error), "warning");
	}
	return notify(ctx, "Usage: /realtime mic start|stop|status [--session <providerSessionId>]", "warning");
}

async function audio(tokens: string[], ctx: ExtensionCommandContext, service: Service): Promise<void> {
	const [subcommand = "status", ...rest] = tokens;
	const providerSessionId = valueAfter(rest, "--session") ?? service.state().primaryProviderSessionId;
	if (subcommand === "status") return notify(ctx, service.audioPlaybackStatus());
	if (!providerSessionId) return notify(ctx, "No primary realtime session. Start one with /realtime start --provider openai.", "warning");
	try {
		if (subcommand === "start") {
			await service.startAudioPlayback(providerSessionId);
			return notify(ctx, `Started audio playback for ${providerSessionId}.`);
		}
		if (subcommand === "stop") {
			await service.stopAudioPlayback(providerSessionId);
			return notify(ctx, `Stopped audio playback for ${providerSessionId}.`);
		}
	} catch (error) {
		return notify(ctx, error instanceof Error ? error.message : String(error), "warning");
	}
	return notify(ctx, "Usage: /realtime audio start|stop|status [--session <providerSessionId>]", "warning");
}

async function openai(tokens: string[], ctx: ExtensionCommandContext, service: Service): Promise<void> {
	const [subcommand, ...rest] = tokens;
	if (!subcommand) return latestActiveOpenAISession(service) ? stopProvider("openai", ctx, service) : startProvider("openai", rest, ctx, service);
	if (subcommand === "start") return startProvider("openai", rest, ctx, service);
	if (subcommand === "stop") return stopProvider("openai", ctx, service);
	if (subcommand === "model") return openAIModel(rest, ctx, service);
	const openaiSession = latestActiveOpenAISession(service);
	if (!openaiSession) return notify(ctx, "No active OpenAI realtime session. Start one with /realtime openai start.", "warning");
	if (subcommand === "text") return text(["--session", openaiSession.providerSessionId, ...rest], ctx, service);
	if (subcommand === "mic") return mic([...rest, "--session", openaiSession.providerSessionId], ctx, service);
	if (subcommand === "audio") return audio([...rest, "--session", openaiSession.providerSessionId], ctx, service);
	if (subcommand === "webrtc") return webrtc(rest, ctx, service, openaiSession.providerSessionId);
	return notify(ctx, "Usage: /realtime openai [start|stop] | openai model [gpt-realtime-mini|gpt-realtime-2] | openai text <message> | openai mic start|stop|status | openai audio start|stop|status | openai webrtc start|stop|status", "warning");
}

function openAIModel(tokens: string[], ctx: ExtensionCommandContext, service: Service): void {
	const model = tokens[0];
	const available = service.availableModelsFor("openai");
	if (!model) return notify(ctx, `Current OpenAI realtime default model: ${service.defaultModelFor("openai")}\nAvailable OpenAI realtime models: ${available.join(", ")}`);
	try {
		notify(ctx, service.setDefaultModel("openai", model));
	} catch (error) {
		notify(ctx, `${error instanceof Error ? error.message : String(error)}\nAvailable OpenAI realtime models: ${available.join(", ")}`, "warning");
	}
}

async function startProvider(provider: ProviderKind, tokens: string[], ctx: ExtensionCommandContext, service: Service): Promise<void> {
	const model = valueAfter(tokens, "--model") ?? service.defaultModelFor(provider);
	const personaId = valueAfter(tokens, "--persona") ?? "default";
	try {
		const interactionMode = modeArg(tokens) ?? service.defaultInteractionMode();
		const providerSessionId = await service.startSession({ provider, model, personaId, primary: !tokens.includes("--secondary"), interactionMode }, ctx);
		const mediaMode = service.providerPreference(provider).autoMediaMode;
		if (mediaMode && mediaMode !== "none" && mediaMode !== "raw") {
			const url = await service.startSessionMedia(providerSessionId, mediaMode, ctx);
			return notify(ctx, `Started ${provider} realtime session ${providerSessionId} (${model}, mode=${interactionMode}) and opened ${mediaMode} media: ${url}`);
		}
		notify(ctx, `Started ${provider} realtime session ${providerSessionId} (${model}, mode=${interactionMode}).`);
	} catch (error) {
		notify(ctx, error instanceof Error ? error.message : String(error), "warning");
	}
}

async function stopProvider(provider: ProviderKind, ctx: ExtensionCommandContext, service: Service): Promise<void> {
	const session = latestActiveProviderSession(service, provider);
	if (!session) return notify(ctx, `No active ${provider} realtime session is active.`, "warning");
	await service.stopSession(session.providerSessionId, "user");
	notify(ctx, `Stopped ${provider} realtime session ${session.providerSessionId}.`);
}

async function webrtc(tokens: string[], ctx: ExtensionCommandContext, service: Service, providerSessionId: ProviderSessionId): Promise<void> {
	const [subcommand = "status"] = tokens;
	try {
		if (subcommand === "status") return notify(ctx, service.mediaStatus(providerSessionId));
		if (subcommand === "start") {
			const url = await service.startSessionMedia(providerSessionId, "webrtc", ctx);
			return notify(ctx, `Started OpenAI WebRTC helper for ${providerSessionId}. Opened ${url}`);
		}
		if (subcommand === "stop") {
			await service.stopSessionMedia(providerSessionId);
			return notify(ctx, `Stopped OpenAI WebRTC helper for ${providerSessionId}.`);
		}
	} catch (error) {
		return notify(ctx, error instanceof Error ? error.message : String(error), "warning");
	}
	return notify(ctx, "Usage: /realtime openai webrtc start|stop|status", "warning");
}

function latestActiveOpenAISession(service: Service) {
	return latestActiveProviderSession(service, "openai");
}

function latestActiveProviderSession(service: Service, provider: ProviderKind) {
	return [...service.state().sessions.values()].reverse().find((session) => session.provider === provider && (session.status === "active" || session.status === "starting"));
}

async function fake(tokens: string[], ctx: ExtensionCommandContext, service: Service): Promise<void> {
	const [subcommand, ...rest] = tokens;
	const providerSessionId = valueAfter(rest, "--session") ?? service.state().primaryProviderSessionId;
	if (!providerSessionId) return notify(ctx, "No primary fake realtime session. Start one with /realtime start --provider fake.", "warning");
	if (subcommand === "transcript") {
		const text = stripSessionFlag(rest).join(" ").trim();
		if (!text) return notify(ctx, "Usage: /realtime fake transcript <text>", "warning");
		service.simulateFakeTranscript(providerSessionId, text, true);
		return notify(ctx, `Fake transcript emitted for ${providerSessionId}.`);
	}
	if (subcommand === "tool") {
		const clean = stripSessionFlag(rest);
		const name = clean[0] as VoiceToolName | undefined;
		if (!name) return notify(ctx, "Usage: /realtime fake tool <tool_name> <json>", "warning");
		const args = parseJsonObject(clean.slice(1).join(" "));
		if (!args.ok) return notify(ctx, args.message, "warning");
		const callId = await service.simulateFakeToolCall(providerSessionId, name, args.value);
		return notify(ctx, `Fake tool call ${callId} emitted for ${providerSessionId}.`);
	}
	notify(ctx, "Usage: /realtime fake transcript <text> | fake tool <tool_name> <json>", "warning");
}

function stripSessionFlag(tokens: string[]): string[] {
	const index = tokens.indexOf("--session");
	return index >= 0 ? [...tokens.slice(0, index), ...tokens.slice(index + 2)] : tokens;
}

function providerArg(tokens: string[]): ProviderKind | undefined {
	const value = valueAfter(tokens, "--provider");
	return value === "fake" || value === "openai" || value === "gemini" ? value : undefined;
}

function modeArg(tokens: string[]): RealtimeInteractionModeId | undefined {
	return parseInteractionMode(valueAfter(tokens, "--mode"));
}

function valueAfter(tokens: string[], flag: string): string | undefined {
	const index = tokens.indexOf(flag);
	return index >= 0 ? tokens[index + 1] : undefined;
}

function parseJsonObject(input: string): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
	if (!input.trim()) return { ok: true, value: {} };
	try {
		const value = JSON.parse(input) as unknown;
		return typeof value === "object" && value !== null && !Array.isArray(value) ? { ok: true, value: value as Record<string, unknown> } : { ok: false, message: "Tool arguments must be a JSON object." };
	} catch (error) {
		return { ok: false, message: `Invalid JSON tool arguments: ${error instanceof Error ? error.message : String(error)}` };
	}
}

function tokenize(args: string): string[] {
	return args.trim().split(/\s+/).filter(Boolean);
}

function notify(ctx: ExtensionCommandContext, message: string, level: "info" | "warning" = "info"): void {
	ctx.ui.notify(message, level);
}

function helpText(): string {
	return [
		"/realtime status — show provider sessions",
		"/realtime start --provider fake|openai|gemini [--model <id>] [--mode agent|eco] [--secondary]",
		"/realtime text <message> — send text to the primary live provider session",
		"/realtime mic start|stop|status — stream local microphone to the primary session",
		"/realtime audio start|stop|status — play provider audio from the primary session",
		"/realtime webrtc on|off — persistently toggle OpenAI WebRTC auto-launch",
		"/realtime openai [start|stop] — toggle/start/stop OpenAI; start launches WebRTC when enabled",
		"/realtime openai model [gpt-realtime-mini|gpt-realtime-2] — show or set the default OpenAI realtime model for future sessions",
		"/realtime openai text <message> — send text to the active OpenAI session",
		"/realtime openai mic start|stop|status — stream local microphone to the active OpenAI session",
		"/realtime openai audio start|stop|status — play OpenAI audio responses",
		"/realtime openai webrtc start|stop|status — use localhost browser/WebRTC media with echo cancellation",
		"/realtime fake transcript <text>",
		"/realtime fake tool <tool_name> <json>",
		"/realtime stop [--session <id>]",
		"/realtime mode agent|eco — set default interaction mode for future sessions",
		"/realtime primary <providerSessionId>",
		"/realtime citations — inspect current Pinotator citation deck",
		"/realtime usage [--session <id>] [--details] — inspect provider usage telemetry and estimated response cost",
		"/realtime usage reset [--session <id>] — reset displayed usage counters without deleting historical events",
		"/realtime debug [--session <id>] — show WebRTC diagnostic trace file paths",
	].join("\n");
}
