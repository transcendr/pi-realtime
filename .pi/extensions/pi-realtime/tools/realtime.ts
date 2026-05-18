import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ControlPlane } from "../control-plane";
import { buildStatePacket, nextContextRevision } from "../state-packets";
import type { CitationDeck, RealtimeState, VoiceToolCallRecord } from "../types";
import { renderStatusText } from "../view";

export async function executeVoiceTool(input: { call: VoiceToolCallRecord; ctx: ExtensionContext | undefined; state: RealtimeState; controlPlane: ControlPlane }): Promise<string> {
	const { call, ctx, state, controlPlane } = input;
	if (call.name === "pi_wait_for_update") return "Acknowledged. Waiting for more user input or system updates.";
	if (call.name === "pi_realtime_status") return renderStatusText(state);
	if (!ctx) return "No active Pi context is available for this fake provider event.";
	if (call.name === "pi_state_snapshot") return JSON.stringify(buildStatePacket(state, controlPlane.currentTarget(ctx), nextContextRevision(state, call.providerSessionId, "pi_state")));
	if (call.name === "pinotator_citations_list") return JSON.stringify(controlPlane.observeCitations(ctx));
	if (call.name === "pinotator_citation_resolve") return JSON.stringify(resolveCitation(controlPlane.observeCitations(ctx), stringArg(call.arguments.ref)));
	if (call.name === "request" || call.name === "pi_send_instruction") return sendRequestFromTool(call, ctx, controlPlane);
	return `Unsupported direct voice tool: ${call.name}`;
}

function resolveCitation(deck: CitationDeck, ref: string): unknown {
	return deck.active.find((item) => item.displayRef === ref || item.alias === ref || item.citationId === ref || item.displayRef === `[${ref}]`) ?? { error: `Citation not found: ${ref}`, deckRevision: deck.revision };
}

async function sendRequestFromTool(call: VoiceToolCallRecord, ctx: ExtensionContext, controlPlane: ControlPlane): Promise<string> {
	const instructionText = stringArg(call.arguments.request) || stringArg(call.arguments.instruction) || stringArg(call.arguments.text);
	if (!instructionText) return "Rejected request: missing required non-empty request text. Ask the user for clarification or call request again with the exact action requested.";
	const deck = controlPlane.observeCitations(ctx);
	await controlPlane.instructionSink.sendInstruction({ instructionId: call.voiceToolCallId, provider: call.provider, providerSessionId: call.providerSessionId, voiceToolCallId: call.voiceToolCallId, providerToolCallId: call.providerToolCallId, target: controlPlane.currentTarget(ctx), urgency: call.arguments.urgency === "interrupt" ? "interrupt" : "normal", instructionText, userUtteranceSummary: stringArg(call.arguments.userUtteranceSummary), citedCitationIds: stringArrayArg(call.arguments.citedCitationIds), citationDeckRevision: deck.revision });
	return "Request submitted.";
}

function stringArg(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function stringArrayArg(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
