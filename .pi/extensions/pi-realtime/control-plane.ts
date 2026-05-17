import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { citationDeckObserved, voiceInstructionSubmitted } from "./events";
import { buildCitationDeckFromBranch } from "./state-packets";
import type { CitationDeck, PiTargetRef, VoiceInstructionInput, VoiceInstructionReceipt } from "./types";
import type { Store } from "./store";

export type PiInstructionSink = { sendInstruction(input: VoiceInstructionInput): Promise<VoiceInstructionReceipt> };

export type ControlPlane = {
	instructionSink: PiInstructionSink;
	currentTarget(ctx: ExtensionContext): PiTargetRef;
	observeCitations(ctx: ExtensionContext): CitationDeck;
};

export function createControlPlane(pi: ExtensionAPI, store: Store, getContext: () => ExtensionContext | undefined): ControlPlane {
	return {
		instructionSink: createInstructionSink(pi, store, getContext),
		currentTarget,
		observeCitations(ctx) {
			const deck = buildCitationDeckFromBranch(ctx.sessionManager.getBranch());
			store.append(citationDeckObserved(deck));
			return deck;
		},
	};
}

function createInstructionSink(pi: ExtensionAPI, store: Store, getContext: () => ExtensionContext | undefined): PiInstructionSink {
	return {
		async sendInstruction(input) {
			const ctx = getContext();
			const delivery = chooseDelivery(ctx, input.urgency);
			try {
				pi.sendUserMessage(renderInstruction(input), delivery === "immediate" ? undefined : { deliverAs: delivery });
				const receipt: VoiceInstructionReceipt = { status: "submitted", delivery };
				store.append(voiceInstructionSubmitted(input, receipt));
				return receipt;
			} catch (error) {
				const receipt: VoiceInstructionReceipt = { status: "failed", delivery, message: error instanceof Error ? error.message : String(error) };
				store.append(voiceInstructionSubmitted(input, receipt));
				return receipt;
			}
		},
	};
}

export function renderInstruction(input: VoiceInstructionInput): string {
	const lines = [
		`Voice instruction from realtime session ${input.providerSessionId} (${input.provider}):`,
		"",
		"<instruction>",
		input.instructionText.trim(),
		"</instruction>",
	];
	const context = instructionContextLines(input);
	return context.length > 0 ? [...lines, "", "Context:", ...context].join("\n") : lines.join("\n");
}

function instructionContextLines(input: VoiceInstructionInput): string[] {
	const lines: string[] = [];
	if (input.userUtteranceSummary) lines.push(`- User voice summary: ${input.userUtteranceSummary}`);
	if (input.citedCitationIds.length > 0) lines.push(`- Cited Pinotator citation ids: ${input.citedCitationIds.join(", ")}`);
	if (input.citationDeckRevision !== undefined) lines.push(`- Realtime citation deck revision: ${input.citationDeckRevision}`);
	lines.push(`- Urgency: ${input.urgency}`);
	if (input.voiceToolCallId) lines.push(`- Voice tool call id: ${input.voiceToolCallId}`);
	return lines;
}

function chooseDelivery(ctx: ExtensionContext | undefined, urgency: VoiceInstructionInput["urgency"]): VoiceInstructionReceipt["delivery"] {
	if (!ctx || ctx.isIdle()) return "immediate";
	return urgency === "interrupt" ? "steer" : "followUp";
}

function currentTarget(ctx: ExtensionContext): PiTargetRef {
	return { kind: "current-session", cwd: ctx.cwd, sessionId: ctx.sessionManager.getSessionId() };
}
