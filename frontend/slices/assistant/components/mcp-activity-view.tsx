"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Camera, CheckCircle2, CircleDashed, ShieldAlert, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export type McpActivityRow = {
  id: string;
  ts: string;
  actor?: string | null;
  tool: string;
  state: "started" | "completed" | "failed" | "denied" | "rate_limited";
  scope?: string;
  target?: string;
  durationMs?: number;
  detail?: string;
};

const stateMeta = {
  started: { label: "running", Icon: CircleDashed, cls: "text-info" },
  completed: { label: "done", Icon: CheckCircle2, cls: "text-success" },
  failed: { label: "failed", Icon: XCircle, cls: "text-destructive" },
  denied: { label: "denied", Icon: ShieldAlert, cls: "text-warning" },
  rate_limited: { label: "limited", Icon: ShieldAlert, cls: "text-warning" },
} as const;

export function McpActivityView() {
  const [entries, setEntries] = useState<McpActivityRow[]>([]);
  const [paused, setPaused] = useState(false);

  const load = useCallback(() => {
    fetch("/api/mcp/activity?limit=160", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { entries?: McpActivityRow[] }) => setEntries(d.entries ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    if (paused) return;
    const timer = window.setInterval(load, 1000);
    return () => window.clearInterval(timer);
  }, [load, paused]);

  // The log writes one row at start and one at completion. Newest-first means the
  // first row for each id is the current state; collapse the pair for a readable
  // live feed instead of showing every tool twice.
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return entries.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    }).slice(0, 80);
  }, [entries]);
  const running = rows.filter((r) => r.state === "started").length;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Activity className="size-4" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">MCP Activity</p>
          <p className="text-[10px] text-muted-foreground">
            {running ? `${running} tool call${running === 1 ? "" : "s"} running now` : "Live tool-call trail from connected AI clients"}
          </p>
        </div>
        <span className="flex items-center gap-1 rounded-full bg-secondary px-2 py-1 text-[10px] text-muted-foreground">
          <span className={`size-1.5 rounded-full ${paused ? "bg-muted-foreground" : "bg-success animate-pulse"}`} />
          {paused ? "Paused" : "Live"}
        </span>
        <Button variant="ghost" size="sm" className="h-8 text-[11px]" onClick={() => setPaused((v) => !v)}>
          {paused ? "Resume" : "Pause"}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {rows.length === 0 ? (
          <div className="grid h-full place-items-center text-center text-xs text-muted-foreground">
            <div>
              <Camera className="mx-auto mb-2 size-7 opacity-60" />
              No MCP activity yet. Ask ChatGPT to check the VPS or capture the MSO screen.
            </div>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((row) => {
              const meta = stateMeta[row.state];
              const Icon = meta.Icon;
              return (
                <li key={row.id} className="flex items-start gap-2 rounded-lg border border-border/70 bg-card/50 px-2.5 py-2">
                  <Icon className={`mt-0.5 size-3.5 shrink-0 ${meta.cls} ${row.state === "started" ? "animate-spin" : ""}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <code className="truncate font-mono text-[11px] font-medium">{row.tool}</code>
                      <span className={`shrink-0 text-[10px] ${meta.cls}`}>{meta.label}</span>
                      {row.durationMs != null ? <span className="shrink-0 text-[10px] text-muted-foreground">{row.durationMs} ms</span> : null}
                    </div>
                    {row.target || row.detail ? (
                      <p className="truncate font-mono text-[10px] text-muted-foreground">{row.target ?? row.detail}</p>
                    ) : null}
                  </div>
                  <time className="shrink-0 text-[9px] text-muted-foreground">
                    {new Date(row.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </time>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
