import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { citationDeckObserved, voiceInstructionSubmitted } from "./events";
import { REALTIME_REQUEST_MESSAGE_TYPE, REALTIME_SESSION_MESSAGE_TYPE, renderRealtimeRequestMessage, renderRealtimeSessionMessage } from "./messages";
import { buildCitationDeckFromBranch } from "./state-packets";
import type { CitationDeck, PiTargetRef, VoiceInstructionInput, VoiceInstructionReceipt, VoiceSessionRecord } from "./types";
import type { Store } from "./store";

export type PiInstructionSink = { sendInstruction(input: VoiceInstructionInput): Promise<VoiceInstructionReceipt> };

export type ControlPlane = {
	instructionSink: PiInstructionSink;
	currentTarget(ctx: ExtensionContext): PiTargetRef;
	observeCitations(ctx: ExtensionContext): CitationDeck;
	sendSessionAwareness(session: VoiceSessionRecord, active: boolean): void;
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
		sendSessionAwareness(session, active) {
			pi.sendMessage({ customType: REALTIME_SESSION_MESSAGE_TYPE, content: renderRealtimeSessionMessage(session, active), display: true, details: { providerSessionId: session.providerSessionId, provider: session.provider, model: session.model, active, at: Date.now() } });
		},
	};
}

function sendRealtimeRequest(pi: ExtensionAPI, input: VoiceInstructionInput, delivery: VoiceInstructionReceipt["delivery"]): void {
	const message = { customType: REALTIME_REQUEST_MESSAGE_TYPE, content: renderRealtimeRequestMessage(input), display: true, details: { providerSessionId: input.providerSessionId, provider: input.provider, instructionId: input.instructionId, voiceToolCallId: input.voiceToolCallId, urgency: input.urgency, at: Date.now() } };
	if (delivery === "immediate") pi.sendMessage(message, { triggerTurn: true });
	else pi.sendMessage(message, { deliverAs: delivery, triggerTurn: true });
}

function createInstructionSink(pi: ExtensionAPI, store: Store, getContext: () => ExtensionContext | undefined): PiInstructionSink {
	return {
		async sendInstruction(input) {
			const ctx = getContext();
			const delivery = chooseDelivery(ctx, input);
			try {
				sendRealtimeRequest(pi, input, delivery);
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

function chooseDelivery(ctx: ExtensionContext | undefined, input: Pick<VoiceInstructionInput, "urgency" | "deliveryHint">): VoiceInstructionReceipt["delivery"] {
	if (!ctx || ctx.isIdle()) return "immediate";
	if (input.urgency === "interrupt" || input.deliveryHint === "progress") return "steer";
	return "followUp";
}

function currentTarget(ctx: ExtensionContext): PiTargetRef {
	return { kind: "current-session", cwd: ctx.cwd, sessionId: ctx.sessionManager.getSessionId() };
}
