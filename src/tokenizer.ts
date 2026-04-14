import { encodingForModel, getEncoding, Tiktoken } from "js-tiktoken";

const MODEL_FROM_ENV = process.env.LOOM_TOKENIZER_MODEL ?? "gpt-4o-mini";
const FALLBACK_ENCODING = "cl100k_base";
const SUPPORTED_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"] as const;
type SupportedModel = (typeof SUPPORTED_MODELS)[number];

function isSupportedModel(model: string): model is SupportedModel {
  return (SUPPORTED_MODELS as readonly string[]).includes(model);
}

const TOKENIZER_MODEL: SupportedModel | null = isSupportedModel(MODEL_FROM_ENV)
  ? MODEL_FROM_ENV
  : null;

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
    encoder = TOKENIZER_MODEL ? encodingForModel(TOKENIZER_MODEL) : getEncoding(FALLBACK_ENCODING);
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
