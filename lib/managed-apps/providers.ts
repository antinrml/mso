import type { ManagedAppId } from "./types";

// Deliberately NOT `server-only`: this table is the install route's allowlist AND
// the install panel's dropdown, and the two must not drift — a provider the UI
// offers but the server refuses is a dead-end the operator only finds after
// typing a key in. install.ts (server) and install-panel.tsx (client) both read
// from here.
//
// `envVar` is the name each CLI reads the key from on its own, verified against
// the shipped code rather than the docs: `grep` over `openclaw`'s dist for the
// literals, and over Hermes' Python source. That is what makes an environment
// hand-off possible at all, and an environment hand-off is what keeps the key
// out of the job argv that gets persisted and audited.

export interface InstallProvider {
  id: string;
  label: string;
  envVar: string;
  apps: readonly ManagedAppId[];
}

export const INSTALL_PROVIDERS: readonly InstallProvider[] = [
  { id: "anthropic", label: "Anthropic", envVar: "ANTHROPIC_API_KEY", apps: ["hermes", "openclaw"] },
  { id: "openai", label: "OpenAI", envVar: "OPENAI_API_KEY", apps: ["hermes", "openclaw"] },
  { id: "openrouter", label: "OpenRouter", envVar: "OPENROUTER_API_KEY", apps: ["hermes", "openclaw"] },
  { id: "google", label: "Google Gemini", envVar: "GEMINI_API_KEY", apps: ["openclaw"] },
  { id: "groq", label: "Groq", envVar: "GROQ_API_KEY", apps: ["openclaw"] },
  { id: "xai", label: "xAI", envVar: "XAI_API_KEY", apps: ["openclaw"] },
  { id: "deepseek", label: "DeepSeek", envVar: "DEEPSEEK_API_KEY", apps: ["openclaw"] },
  { id: "nous", label: "Nous Research", envVar: "NOUS_API_KEY", apps: ["hermes"] },
];

export const providersFor = (id: ManagedAppId): InstallProvider[] => INSTALL_PROVIDERS.filter((provider) => provider.apps.includes(id));

export const findProvider = (id: string | null | undefined): InstallProvider | undefined =>
  id ? INSTALL_PROVIDERS.find((provider) => provider.id === id) : undefined;
