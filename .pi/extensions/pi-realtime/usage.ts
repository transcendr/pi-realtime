import type { ProviderKind, ProviderSessionId, UsageBreakdown, UsageObservation, UsageReset, UsageSource } from "./types";

export type { UsageBreakdown, UsageObservation, UsageSource };

export type UsageSummary = {
	providerSessionId?: ProviderSessionId;
	observations: number;
	responseCount: number;
	transcriptionCount: number;
	input: UsageBreakdown;
	output: UsageBreakdown;
	totalTokens: number;
	estimatedCostUsd: number;
	excludedCostCount: number;
	lastObservedAt?: number;
};

type ModalityPricing = { input: number; cachedInput: number; output?: number };
type ModelPricing = { text: ModalityPricing; audio: ModalityPricing; image: ModalityPricing };

const PRICING_PER_MILLION: Record<string, ModelPricing> = {
	"gpt-realtime-2": { text: { input: 4, cachedInput: 0.4, output: 24 }, audio: { input: 32, cachedInput: 0.4, output: 64 }, image: { input: 5, cachedInput: 0.5 } },
	"gpt-realtime-1.5": { text: { input: 4, cachedInput: 0.4, output: 16 }, audio: { input: 32, cachedInput: 0.4, output: 64 }, image: { input: 5, cachedInput: 0.5 } },
	"gpt-realtime-mini": { text: { input: 0.6, cachedInput: 0.06, output: 2.4 }, audio: { input: 10, cachedInput: 0.3, output: 20 }, image: { input: 0.8, cachedInput: 0.08 } },
};

export function emptyUsageBreakdown(): UsageBreakdown {
	return { textTokens: 0, audioTokens: 0, imageTokens: 0, cachedTextTokens: 0, cachedAudioTokens: 0, cachedImageTokens: 0 };
}

export function estimateUsageCost(input: { provider: ProviderKind; model: string; source: UsageSource; input: UsageBreakdown; output: UsageBreakdown }): number {
	if (input.provider !== "openai" || input.source !== "response") return 0;
	const pricing = PRICING_PER_MILLION[input.model];
	if (!pricing) return 0;
	return dollars(input.input.textTokens, input.input.cachedTextTokens, pricing.text)
		+ dollars(input.input.audioTokens, input.input.cachedAudioTokens, pricing.audio)
		+ dollars(input.input.imageTokens, input.input.cachedImageTokens, pricing.image)
		+ outputDollars(input.output.textTokens, pricing.text)
		+ outputDollars(input.output.audioTokens, pricing.audio);
}

export function costExcludedReason(input: { provider: ProviderKind; model: string; source: UsageSource }): string | undefined {
	if (input.source === "input_transcription") return "Input transcription uses a separate transcription model/rate card; token usage is tracked but excluded from this estimate.";
	if (input.provider !== "openai") return `No local pricing table for provider ${input.provider}.`;
	return PRICING_PER_MILLION[input.model] ? undefined : `No local pricing table for model ${input.model}.`;
}

export function aggregateUsage(observations: readonly UsageObservation[], providerSessionId?: ProviderSessionId, resets: readonly UsageReset[] = []): UsageSummary {
	const resetAt = latestResetAt(resets, providerSessionId);
	const rows = observations.filter((item) => (!providerSessionId || item.providerSessionId === providerSessionId) && item.at > resetAt);
	const summary: UsageSummary = { providerSessionId, observations: rows.length, responseCount: 0, transcriptionCount: 0, input: emptyUsageBreakdown(), output: emptyUsageBreakdown(), totalTokens: 0, estimatedCostUsd: 0, excludedCostCount: 0 };
	for (const row of rows) {
		if (row.source === "response") summary.responseCount += 1;
		if (row.source === "input_transcription") summary.transcriptionCount += 1;
		addBreakdown(summary.input, row.input);
		addBreakdown(summary.output, row.output);
		summary.totalTokens += row.totalTokens;
		summary.estimatedCostUsd += row.estimatedCostUsd;
		if (row.costExcludedReason) summary.excludedCostCount += 1;
		summary.lastObservedAt = Math.max(summary.lastObservedAt ?? 0, row.at);
	}
	return summary;
}

function latestResetAt(resets: readonly UsageReset[], providerSessionId?: ProviderSessionId): number {
	return resets.reduce((latest, reset) => {
		const applies = providerSessionId ? !reset.providerSessionId || reset.providerSessionId === providerSessionId : !reset.providerSessionId;
		return applies ? Math.max(latest, reset.at) : latest;
	}, 0);
}

export function renderUsageSummary(summary: UsageSummary, details = false): string {
	if (summary.observations === 0) return `realtime usage${summary.providerSessionId ? ` for ${summary.providerSessionId}` : ""}: no usage events observed yet`;
	const lines = [
		`realtime usage${summary.providerSessionId ? ` for ${summary.providerSessionId}` : ""}:`,
		`- observations: ${summary.observations} (${summary.responseCount} responses, ${summary.transcriptionCount} input transcriptions)`,
		`- input: text=${summary.input.textTokens} audio=${summary.input.audioTokens} image=${summary.input.imageTokens}`,
		`- cached input: text=${summary.input.cachedTextTokens} audio=${summary.input.cachedAudioTokens} image=${summary.input.cachedImageTokens}`,
		`- output: text=${summary.output.textTokens} audio=${summary.output.audioTokens}`,
		`- total tokens: ${summary.totalTokens}`,
		`- estimated response cost: $${summary.estimatedCostUsd.toFixed(6)}${summary.excludedCostCount ? ` (${summary.excludedCostCount} event(s) excluded/unknown)` : ""}`,
		`- last usage event: ${summary.lastObservedAt ? new Date(summary.lastObservedAt).toISOString() : "never"}`,
	];
	if (details) lines.push("Note: OpenAI dashboard billing is authoritative; this local estimate uses checked-in pricing constants and excludes separately billed transcription when pricing is unknown.");
	return lines.join("\n");
}

function addBreakdown(target: UsageBreakdown, value: UsageBreakdown): void {
	target.textTokens += value.textTokens;
	target.audioTokens += value.audioTokens;
	target.imageTokens += value.imageTokens;
	target.cachedTextTokens += value.cachedTextTokens;
	target.cachedAudioTokens += value.cachedAudioTokens;
	target.cachedImageTokens += value.cachedImageTokens;
}

function dollars(totalTokens: number, cachedTokens: number, pricing: ModalityPricing): number {
	const cached = Math.min(totalTokens, cachedTokens);
	const uncached = Math.max(0, totalTokens - cached);
	return (uncached * pricing.input + cached * pricing.cachedInput) / 1_000_000;
}

function outputDollars(tokens: number, pricing: ModalityPricing): number {
	return (tokens * (pricing.output ?? 0)) / 1_000_000;
}
