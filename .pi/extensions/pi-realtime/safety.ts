export type RecentUserTranscript = { text: string; at: number };

export const VOICE_INSTRUCTION_TRANSCRIPT_WINDOW_MS = 120_000;

const MIN_GROUNDING_WORDS = 2;
const GROUNDING_STOP_WORDS = new Set(["a", "an", "and", "are", "as", "at", "be", "can", "could", "do", "for", "from", "i", "in", "is", "it", "me", "my", "of", "on", "or", "please", "that", "the", "this", "to", "you"]);

export function hasGroundingOverlap(userTranscript: string, candidate: string): boolean {
	const userWords = meaningfulWords(userTranscript);
	if (userWords.length < MIN_GROUNDING_WORDS) return false;
	const candidateWords = new Set(meaningfulWords(candidate));
	return userWords.some((word) => candidateWords.has(word));
}

export function quoteForStatus(text: string): string {
	const clean = text.replace(/\s+/g, " ").trim();
	return JSON.stringify(clean.length > 120 ? `${clean.slice(0, 117)}...` : clean);
}

function meaningfulWords(text: string): string[] {
	return text.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g)?.filter((word) => !GROUNDING_STOP_WORDS.has(word)) ?? [];
}
