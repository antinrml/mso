"use client";

import { useCallback, useEffect, useState } from "react";
import { Plug, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/features/shell-settings";
import { toast } from "@/features/os-shell";
import { IS_DEMO } from "@/lib/demo";
import { McpToolsetCard, type McpToolsetInfo } from "./mcp-toolset-card";

type AuditRow = {
  ts?: string;
  action: string;
  actor?: string | null;
  target?: string;
  ok?: boolean;
  detail?: string;
};

type TokenRow = {
  id: string;
  label: string;
  clientId: string;
  scope: string;
  createdAt: number;
  expiresAt: number;
  lastUsedAt?: number;
  status: "active" | "revoked" | "expired";
};

const fmt = (t?: number) => (t ? new Date(t).toLocaleString() : "—");

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="w-40 shrink-0 text-xs text-muted-foreground">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded bg-secondary px-2 py-1 font-mono text-[11px]">{value}</code>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Copy ${label}`}
        className="size-8 shrink-0 [@media(pointer:coarse)]:size-11"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </Button>
    </div>
  );
}

export function McpSection() {
  const [state, setState] = useState<{ enabled: boolean; maxScope: string; toolset: McpToolsetInfo; tokens: TokenRow[] } | null>(null);
  const [trail, setTrail] = useState<AuditRow[]>([]);
  const [origin, setOrigin] = useState("");

  const load = useCallback(() => {
    if (IS_DEMO) return;
    fetch("/api/mcp/tokens", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((s) => {
        // Read the origin here rather than in the effect body: window.location is
        // an impure render-time read, and a synchronous setState in an effect is a
        // cascading render. Both are lint errors, and both are avoidable by doing
        // it once, in the callback that already updates this component.
        setOrigin(window.location.origin);
        setState(s);
      })
      .catch(() => toast("Couldn't load MCP tokens", { tone: "error" }));
    // What those tokens actually DID. Revoking is a weak control if you cannot
    // see the writes and commands that already went through.
    fetch("/api/v1/sys/audit?actor=mcp%3A&limit=20", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { entries: [] }))
      .then((d: { entries?: AuditRow[] }) => setTrail(d.entries ?? []))
      .catch(() => setTrail([]));
  }, []);

  useEffect(load, [load]);

  async function revoke(id: string, what: string) {
    const r = await fetch(`/api/mcp/tokens?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!r.ok) {
      toast(`Couldn't revoke ${what}`, { tone: "error" });
      return;
    }
    toast(`Revoked ${what}. Any client using it is cut off now.`);
    load();
  }

  const live = state?.tokens.filter((t) => t.status === "active") ?? [];

  return (
    <SettingsSection
      icon={<Plug />}
      title="MCP — control this VPS from ChatGPT"
      footnote="Tokens are stored as a hash; the raw value is shown to the client once, at mint. Revoking is immediate — it is re-checked on every call."
    >
      {!state?.enabled ? (
        <p className="text-xs text-muted-foreground">
          Disabled. Set <code className="font-mono">OS_MCP_ENABLED=1</code> in <code className="font-mono">.env.local</code>{" "}
          and restart mso.service. While it is off, <code className="font-mono">/mcp</code> and the OAuth
          discovery documents return 404 — there is no MCP surface at all, not an unauthenticated one.
        </p>
      ) : (
        <>
          <div className="space-y-0.5">
            <p className="pb-1 text-xs text-muted-foreground">
              In ChatGPT: Settings → Connectors → New App. Authentication <strong>OAuth</strong>, registration{" "}
              <strong>User-Defined OAuth Client</strong>, Client Secret <strong>empty</strong>, token endpoint auth{" "}
              <strong>none</strong>.
            </p>
            <CopyRow label="MCP Server URL" value={`${origin}/mcp`} />
            <CopyRow label="Auth URL" value={`${origin}/oauth/authorize`} />
            <CopyRow label="Token URL" value={`${origin}/oauth/token`} />
            <CopyRow label="Resource" value={`${origin}/mcp`} />
            <CopyRow label="Client ID" value="chatgpt-mso" />
            <p className="pt-1 text-xs text-muted-foreground">
              Claude.ai, Cursor and mcp-remote register themselves — give them{" "}
              <code className="font-mono">{origin}/mcp</code> and nothing else. Highest tier this server will
              mint: <strong>{state.maxScope}</strong> (<code className="font-mono">OS_MCP_MAX_SCOPE</code>).
            </p>
            <McpToolsetCard info={state.toolset} />
          </div>

          <div className="mt-3 border-t border-border pt-3">
            {state.tokens.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No tokens yet. One is minted when you approve a client on the consent screen.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {state.tokens.map((t) => {
                  const dead = t.status !== "active";
                  return (
                    <li key={t.id} className="flex items-center gap-2 text-xs">
                      <span className={dead ? "min-w-0 flex-1 truncate text-muted-foreground line-through" : "min-w-0 flex-1 truncate"}>
                        {t.label}
                        <span className="ml-1.5 rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]">{t.scope}</span>
                      </span>
                      <span className="hidden shrink-0 text-muted-foreground sm:inline">last used {fmt(t.lastUsedAt)}</span>
                      {dead ? (
                        <span className="shrink-0 text-muted-foreground">{t.status}</span>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 shrink-0 text-destructive [@media(pointer:coarse)]:min-h-[44px]"
                          onClick={() => void revoke(t.id, t.label)}
                        >
                          Revoke
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {trail.length > 0 && (
              <div className="mt-4 border-t border-border pt-3">
                <p className="pb-1.5 text-xs font-medium">Recent MCP activity</p>
                <ul className="space-y-1">
                  {trail.map((e, i) => (
                    <li key={i} className="flex items-baseline gap-2 text-[11px]">
                      <code className={e.ok === false ? "shrink-0 font-mono text-destructive" : "shrink-0 font-mono"}>{e.action}</code>
                      <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{e.target ?? e.detail ?? ""}</span>
                      <span className="shrink-0 text-muted-foreground">{e.ts ? new Date(e.ts).toLocaleString() : ""}</span>
                    </li>
                  ))}
                </ul>
                <p className="pt-1.5 text-[11px] text-muted-foreground">
                  This forensic trail still records privileged mutations and denials. The Assistant → MCP tab adds a separate live activity stream for all tool calls, including reads. Full forensic trail: <code className="font-mono">mso audit</code>.
                </p>
              </div>
            )}
            {live.length > 0 && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-3 w-full text-destructive [@media(pointer:coarse)]:min-h-[44px]"
                onClick={() => void revoke("all", `all ${live.length} live token(s)`)}
              >
                Revoke all ({live.length})
              </Button>
            )}
          </div>
        </>
      )}
    </SettingsSection>
  );
}
