import { resolveRealtimeBehaviorProfile } from "./behavior-profiles";
import type { BackendUpdateSpeechChunkingPolicy, BackendUpdateSpeechEnvelope, BackendUpdateSpeechRenderingMode, RealtimeBehaviorProfileFragment, RealtimeContextPushInput, RealtimeInteractionModeId } from "../types";

export type SpeechChunk = {
	text: string;
	index: number;
	count: number;
	originalTextLength: number;
	renderingMode: BackendUpdateSpeechRenderingMode;
	envelope: BackendUpdateSpeechEnvelope;
};

const COMMON_ABBREVIATIONS = new Set(["e.g.", "i.e.", "vs.", "approx."]);

export function chunkBackendUpdateSpeech(input: {
	text: string;
	policy: BackendUpdateSpeechChunkingPolicy;
}): SpeechChunk[] {
	const text = input.text.trim();
	const maxChars = Math.max(1, input.policy.maxChars);
	if (!input.policy.enabled || text.length <= maxChars) return buildChunks([text], text.length, "verbatim", "speak_this_verbatim");
	const units = speechUnitsFor(text, maxChars).flatMap((unit) => splitOverlongUnit(unit, maxChars));
	return buildChunks(packUnits(units, maxChars), text.length, "verbatim", "speak_this_verbatim");
}

export function chunkRealtimePushSpeech(input: {
	push: RealtimeContextPushInput;
	text: string;
	providerProfile?: RealtimeBehaviorProfileFragment;
	interactionMode: RealtimeInteractionModeId;
}): SpeechChunk[] {
	const profile = resolveRealtimeBehaviorProfile({ providerProfile: input.providerProfile, interactionMode: input.interactionMode });
	const speech = profile.backendUpdateSpeech;
	const renderingMode = renderingModeFor(input.text, speech.rendering.defaultMode, speech.rendering.longTextThresholdChars, speech.rendering.longTextMode);
	if (input.push.mode !== "request_spoken_response" || input.push.kind !== "text" || !speech.chunking.enabled) {
		return [{ text: input.text, index: 1, count: 1, originalTextLength: input.text.length, renderingMode, envelope: speech.rendering.envelope }];
	}
	return chunkBackendUpdateSpeech({ text: input.text, policy: speech.chunking }).map((chunk) => ({ ...chunk, renderingMode, envelope: speech.rendering.envelope }));
}

function speechUnitsFor(text: string, maxChars: number): string[] {
	return splitByBlankLines(text).flatMap((block) => {
		if (isStructuredSpeechBlock(block)) return splitByLines(block);
		if (isListBlock(block)) return splitByLines(block);
		if (block.length > maxChars && block.includes("\n")) return splitByLines(block);
		return splitSentences(block);
	}).filter((unit) => unit.length > 0);
}

function splitByBlankLines(text: string): string[] {
	const blocks: string[] = [];
	let start = 0;
	const blankLine = /\n[ \t]*\n/g;
	for (let match = blankLine.exec(text); match; match = blankLine.exec(text)) {
		blocks.push(text.slice(start, match.index + match[0].length));
		start = match.index + match[0].length;
	}
	blocks.push(text.slice(start));
	return blocks.filter((block) => block.length > 0);
}

function splitByLines(text: string): string[] {
	const lines: string[] = [];
	let start = 0;
	for (let index = 0; index < text.length; index += 1) {
		if (text[index] !== "\n") continue;
		lines.push(text.slice(start, index + 1));
		start = index + 1;
	}
	if (start < text.length) lines.push(text.slice(start));
	return lines.filter((line) => line.length > 0);
}

function splitSentences(text: string): string[] {
	const sentences: string[] = [];
	let start = 0;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (char !== "." && char !== "!" && char !== "?") continue;
		if (!isSentenceBoundary(text, index)) continue;
		const end = consumeTrailingWhitespace(text, index + 1);
		sentences.push(text.slice(start, end));
		start = end;
	}
	if (start < text.length) sentences.push(text.slice(start));
	return sentences.filter((sentence) => sentence.length > 0);
}

function isSentenceBoundary(text: string, index: number): boolean {
	const char = text[index];
	if (char === "." && isProtectedPeriod(text, index)) return false;
	const next = text[index + 1];
	if (next === undefined) return true;
	if (!/\s/.test(next)) return false;
	const nextNonWhitespace = nextNonWhitespaceChar(text, index + 1);
	return nextNonWhitespace === undefined || !/[a-z]/.test(nextNonWhitespace);
}

function isProtectedPeriod(text: string, index: number): boolean {
	const previous = text[index - 1];
	const next = text[index + 1];
	if (isDigit(previous) && isDigit(next)) return true;
	const token = tokenAround(text, index).toLowerCase();
	if (COMMON_ABBREVIATIONS.has(token)) return true;
	if (token.startsWith("http://") || token.startsWith("https://") || token.startsWith("www.")) return true;
	return false;
}

function tokenAround(text: string, index: number): string {
	let start = index;
	while (start > 0 && !/\s/.test(text[start - 1] as string)) start -= 1;
	let end = index + 1;
	while (end < text.length && !/\s/.test(text[end] as string)) end += 1;
	return text.slice(start, end).replace(/[),;:]+$/g, "");
}

function nextNonWhitespaceChar(text: string, start: number): string | undefined {
	for (let index = start; index < text.length; index += 1) if (!/\s/.test(text[index] as string)) return text[index];
	return undefined;
}

function consumeTrailingWhitespace(text: string, start: number): number {
	let end = start;
	while (end < text.length && /\s/.test(text[end] as string)) end += 1;
	return end;
}

function isStructuredSpeechBlock(block: string): boolean {
	const trimmed = block.trimStart();
	return trimmed.startsWith("```")
		|| trimmed.startsWith("{")
		|| trimmed.startsWith("[")
		|| /^\s*(at |Caused by:|Error:|\w+Error:)/m.test(block);
}

function isListBlock(block: string): boolean {
	return /^\s*(?:[-*+] |\d+[.)] )/m.test(block);
}

function splitOverlongUnit(unit: string, maxChars: number): string[] {
	if (unit.length <= maxChars) return [unit];
	const lineParts = splitByLines(unit);
	if (lineParts.length > 1) return lineParts.flatMap((part) => splitOverlongUnit(part, maxChars));
	const syntaxParts = splitBySyntaxDelimiters(unit, maxChars);
	if (syntaxParts.length > 1) return syntaxParts.flatMap((part) => splitOverlongUnit(part, maxChars));
	return hardSplit(unit, maxChars);
}

function splitBySyntaxDelimiters(text: string, maxChars: number): string[] {
	const parts: string[] = [];
	let start = 0;
	for (let index = 0; index < text.length; index += 1) {
		if (text[index] !== ";" && text[index] !== ",") continue;
		if (index - start + 1 < Math.floor(maxChars / 2)) continue;
		const end = consumeTrailingWhitespace(text, index + 1);
		parts.push(text.slice(start, end));
		start = end;
	}
	if (start < text.length) parts.push(text.slice(start));
	return parts.filter((part) => part.length > 0);
}

function hardSplit(text: string, maxChars: number): string[] {
	const chunks: string[] = [];
	for (let start = 0; start < text.length; start += maxChars) chunks.push(text.slice(start, start + maxChars));
	return chunks;
}

function packUnits(units: readonly string[], maxChars: number): string[] {
	const chunks: string[] = [];
	let current = "";
	for (const unit of units) {
		if (!unit) continue;
		if (!current) {
			current = unit;
			continue;
		}
		if (current.length + unit.length <= maxChars) {
			current += unit;
			continue;
		}
		chunks.push(current);
		current = unit;
	}
	if (current) chunks.push(current);
	return chunks;
}

function buildChunks(texts: readonly string[], originalTextLength: number, renderingMode: BackendUpdateSpeechRenderingMode, envelope: BackendUpdateSpeechEnvelope): SpeechChunk[] {
	const filtered = texts.filter((text) => text.length > 0);
	return filtered.map((text, index) => ({
		text,
		index: index + 1,
		count: filtered.length,
		originalTextLength,
		renderingMode,
		envelope,
	}));
}

function renderingModeFor(text: string, defaultMode: BackendUpdateSpeechRenderingMode, threshold: number | undefined, longTextMode: BackendUpdateSpeechRenderingMode | undefined): BackendUpdateSpeechRenderingMode {
	if (threshold === undefined || longTextMode === undefined) return defaultMode;
	return text.length > threshold ? longTextMode : defaultMode;
}

function isDigit(value: string | undefined): boolean {
	return value !== undefined && /\d/.test(value);
}
