export const DEFAULT_PROVIDER = "anthropic";

// No entry for "openai-codex" on purpose. Its models are ACCOUNT-scoped and change
// (measured live: gpt-5.6-sol/-terra/-luna, gpt-5.5, gpt-5.4, gpt-5.4-mini), and the
// literal that used to sit here — "gpt-5-codex" — is refused outright by the backend:
//   400 "The 'gpt-5-codex' model is not supported when using Codex with a ChatGPT
//   account". It was written into the field on every provider change, so the default
// was a guaranteed failure. The UI now takes the first model the account actually
// offers (ai-section.tsx), which cannot rot.
export const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-opus-4-8",
  openai: "gpt-4o",
  openrouter: "openai/gpt-4o",
  google: "gemini-2.0-flash",
  groq: "llama-3.3-70b-versatile",
  xai: "grok-2-latest",
  deepseek: "deepseek-chat",
  mistral: "mistral-large-latest",
};

export function defaultModelFor(provider?: string): string {
  return DEFAULT_MODELS[provider || DEFAULT_PROVIDER] ?? "gpt-4o";
}
