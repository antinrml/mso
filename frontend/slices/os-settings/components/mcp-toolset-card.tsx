"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { BadgeCheck, Copy, RefreshCw, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";

export type McpToolsetInfo = {
  serverVersion: string;
  version: string;
  hash: string;
  changedAt: string;
  toolCount: number;
  byScope: { read: number; write: number; exec: number };
};

const ACK_KEY = "mso.mcp.toolset-ack";
const ACK_EVENT = "mso:mcp-toolset-ack";
const subscribeAck = (callback: () => void) => {
  window.addEventListener("storage", callback);
  window.addEventListener(ACK_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(ACK_EVENT, callback);
  };
};
const ackSnapshot = () => window.localStorage.getItem(ACK_KEY);
const serverAckSnapshot = () => null;

export function McpToolsetCard({ info }: { info: McpToolsetInfo }) {
  const signature = useMemo(() => `${info.version}:${info.hash}:${info.toolCount}`, [info]);
  const ack = useSyncExternalStore(subscribeAck, ackSnapshot, serverAckSnapshot);
  const [copied, setCopied] = useState(false);
  const current = ack === signature;
  const changed = Boolean(ack && !current);

  return (
    <div className="mt-3 rounded-xl border border-border bg-secondary/30 p-3">
      <div className="flex items-start gap-2">
        <Wrench className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-xs font-medium">MCP toolset {info.version}</p>
            <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]">{info.toolCount} tools</span>
            <span className="font-mono text-[10px] text-muted-foreground">{info.hash}</span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Server {info.serverVersion} · read {info.byScope.read} · write {info.byScope.write} · exec {info.byScope.exec} · changed {info.changedAt.slice(0, 10)}
          </p>
          <p className={`mt-1 text-[11px] ${changed ? "text-warning" : "text-muted-foreground"}`}>
            {current
              ? "ChatGPT action snapshot marked current for this browser."
              : changed
                ? "Toolset signature changed. Refresh or reconnect the MSO app in ChatGPT, then mark it current."
                : "After refreshing the MSO app in ChatGPT, mark this signature current so future drift is visible."}
          </p>
        </div>
        {current ? <BadgeCheck className="size-4 shrink-0 text-success" /> : <RefreshCw className="size-4 shrink-0 text-warning" />}
      </div>
      <div className="mt-2 flex gap-2">
        <Button
          type="button" variant="secondary" size="sm" className="h-8 text-[11px]"
          onClick={() => { window.localStorage.setItem(ACK_KEY, signature); window.dispatchEvent(new Event(ACK_EVENT)); }}
        >
          {current ? "Marked refreshed" : "Mark ChatGPT refreshed"}
        </Button>
        <Button
          type="button" variant="ghost" size="sm" className="h-8 text-[11px]"
          onClick={() => void navigator.clipboard.writeText(signature).then(() => {
            setCopied(true); window.setTimeout(() => setCopied(false), 1500);
          })}
        >
          <Copy className="mr-1 size-3.5" />{copied ? "Copied" : "Copy signature"}
        </Button>
      </div>
    </div>
  );
}
