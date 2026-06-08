import { encodingForModel, getEncoding, Tiktoken } from "js-tiktoken";

const DEFAULT_ENCODING = "o200k_base";
const FALLBACK_ENCODING = "cl100k_base";
const SUPPORTED_ENCODINGS = [DEFAULT_ENCODING, FALLBACK_ENCODING, "p50k_base", "r50k_base"] as const;
const SUPPORTED_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"] as const;
type SupportedEncoding = (typeof SUPPORTED_ENCODINGS)[number];
type SupportedModel = (typeof SUPPORTED_MODELS)[number];

export type TokenizerConfig =
  | { kind: "encoding"; value: SupportedEncoding }
  | { kind: "model"; value: SupportedModel }
  | { kind: "fallback"; value: typeof FALLBACK_ENCODING };

function isSupportedEncoding(encoding: string): encoding is SupportedEncoding {
  return (SUPPORTED_ENCODINGS as readonly string[]).includes(encoding);
}

function isSupportedModel(model: string): model is SupportedModel {
  return (SUPPORTED_MODELS as readonly string[]).includes(model);
}

export function resolveTokenizerConfig(env: NodeJS.ProcessEnv = process.env): TokenizerConfig {
  const encodingFromEnv = env.LOOM_TOKENIZER_ENCODING;
  if (encodingFromEnv) {
    return isSupportedEncoding(encodingFromEnv)
      ? { kind: "encoding", value: encodingFromEnv }
      : { kind: "fallback", value: FALLBACK_ENCODING };
  }

  const legacyModelFromEnv = env.LOOM_TOKENIZER_MODEL;
  if (legacyModelFromEnv) {
    return isSupportedModel(legacyModelFromEnv)
      ? { kind: "model", value: legacyModelFromEnv }
      : { kind: "fallback", value: FALLBACK_ENCODING };
  }

  return { kind: "encoding", value: DEFAULT_ENCODING };
}

const TOKENIZER_CONFIG = resolveTokenizerConfig();

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
    encoder =
      TOKENIZER_CONFIG.kind === "model"
        ? encodingForModel(TOKENIZER_CONFIG.value)
        : getEncoding(TOKENIZER_CONFIG.value);
    return encoder;
  } catch {
    encoder = getEncoding(FALLBACK_ENCODING);
    return encoder;
  }
}

/**
 * Counts tokens locally using js-tiktoken. This never calls a model API.
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
