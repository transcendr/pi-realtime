import { costExcludedReason, emptyUsageBreakdown, estimateUsageCost, type UsageBreakdown, type UsageObservation, type UsageSource } from "../../usage";
import type { ProviderSessionId } from "../../types";

type UsageInput = { providerSessionId: ProviderSessionId; model: string; providerEventId?: string; at?: number };

export function usageFromOpenAIResponseDone(event: unknown, input: UsageInput): UsageObservation | undefined {
	const raw = record(event);
	const response = record(raw?.response);
	const usage = record(response?.usage);
	if (!usage) return undefined;
	return observation({ source: "response", usage, input, responseId: stringValue(response?.id) });
}

export function usageFromOpenAIInputTranscription(event: unknown, input: UsageInput): UsageObservation | undefined {
	const raw = record(event);
	const usage = record(raw?.usage);
	if (!usage) return undefined;
	return observation({ source: "input_transcription", usage, input, itemId: stringValue(raw?.item_id) });
}

function observation(args: { source: UsageSource; usage: Record<string, unknown>; input: UsageInput; responseId?: string; itemId?: string }): UsageObservation {
	const inputBreakdown = inputBreakdownFrom(record(args.usage.input_token_details));
	const outputBreakdown = outputBreakdownFrom(record(args.usage.output_token_details));
	const base = { provider: "openai" as const, model: args.input.model, source: args.source };
	const estimatedCostUsd = estimateUsageCost({ ...base, input: inputBreakdown, output: outputBreakdown });
	return { providerSessionId: args.input.providerSessionId, provider: "openai", model: args.input.model, source: args.source, providerEventId: args.input.providerEventId, responseId: args.responseId, itemId: args.itemId, at: args.input.at ?? Date.now(), input: inputBreakdown, output: outputBreakdown, totalTokens: numberValue(args.usage.total_tokens), estimatedCostUsd, costExcludedReason: costExcludedReason(base) };
}

function inputBreakdownFrom(details: Record<string, unknown> | undefined): UsageBreakdown {
	const cached = record(details?.cached_tokens_details);
	return { ...emptyUsageBreakdown(), textTokens: numberValue(details?.text_tokens), audioTokens: numberValue(details?.audio_tokens), imageTokens: numberValue(details?.image_tokens), cachedTextTokens: numberValue(cached?.text_tokens), cachedAudioTokens: numberValue(cached?.audio_tokens), cachedImageTokens: numberValue(cached?.image_tokens) };
}

function outputBreakdownFrom(details: Record<string, unknown> | undefined): UsageBreakdown {
	return { ...emptyUsageBreakdown(), textTokens: numberValue(details?.text_tokens), audioTokens: numberValue(details?.audio_tokens), imageTokens: numberValue(details?.image_tokens) };
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function numberValue(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}
