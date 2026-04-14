import { encodingForModel, getEncoding, Tiktoken } from "js-tiktoken";

const DEFAULT_MODEL = process.env.LOOM_TOKENIZER_MODEL ?? "gpt-4o-mini";
const FALLBACK_ENCODING = "cl100k_base";

let encoder: Tiktoken | null = null;

/**
 * Legacy fallback used when tokenizer initialization fails.
 */
export function fallbackCharsToTokens(chars: number): number {
  return Math.round(chars / 4);
}

function getEncoder(): Tiktoken {
  if (encoder) {
    return encoder;
  }

  try {
    encoder = encodingForModel(DEFAULT_MODEL as Parameters<typeof encodingForModel>[0]);
    return encoder;
  } catch {
    encoder = getEncoding(FALLBACK_ENCODING);
    return encoder;
  }
}

/**
 * Counts tokens using js-tiktoken with model-aware encoding where possible.
 */
export function countTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  try {
    return getEncoder().encode(text).length;
  } catch {
    return fallbackCharsToTokens(text.length);
  }
}
