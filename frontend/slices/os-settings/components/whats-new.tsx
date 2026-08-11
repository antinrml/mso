"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/features/shell-settings";
import { mdToHtml } from "@/features/os-shell";
import { IS_DEMO } from "@/lib/demo";

// "What's new", from docs/CHANGELOG.md — which is generated from git subjects, so
// it cannot drift from what actually shipped.
//
// This exists because a change that only lands in a terminal is a change the owner
// has to go looking for. The deploy already ships the file; this puts it where they
// already are.

const COLLAPSED_DAYS = 2;

/** Split on the `## YYYY-MM-DD` day headings the generator emits. */
function days(md: string): { date: string; body: string }[] {
  return md
    .split(/^## (?=\d{4}-\d{2}-\d{2})/m)
    .slice(1)
    .map((chunk) => {
      const nl = chunk.indexOf("\n");
      return { date: chunk.slice(0, nl).trim(), body: chunk.slice(nl + 1).trim() };
    });
}

export function WhatsNew() {
  const [md, setMd] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    if (IS_DEMO) return;
    let alive = true;
    fetch("/api/changelog", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { markdown?: string } | null) => alive && setMd(d?.markdown ?? ""))
      .catch(() => alive && setMd(""));
    return () => {
      alive = false;
    };
  }, []);

  // Nothing to show is not a failure state — a fresh checkout has no generated
  // changelog, and an empty card would just be noise in Settings.
  if (!md) return null;
  const entries = days(md);
  if (!entries.length) return null;
  const shown = all ? entries : entries.slice(0, COLLAPSED_DAYS);

  return (
    <SettingsSection
      icon={<Sparkles />}
      title="What's new"
      footnote="Generated from the commit history of this deployment — it cannot drift from what shipped."
    >
      <div className="space-y-3">
        {shown.map((d) => (
          <div key={d.date}>
            <div className="pb-1 text-xs font-semibold text-muted-foreground">{d.date}</div>
            <div
              className="space-y-0.5 text-xs leading-relaxed [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1 [&_code]:font-mono [&_strong]:font-semibold [&_strong]:text-foreground"
              dangerouslySetInnerHTML={{ __html: mdToHtml(d.body) }}
            />
          </div>
        ))}
        {entries.length > COLLAPSED_DAYS && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full [@media(pointer:coarse)]:min-h-[44px]"
            onClick={() => setAll((v) => !v)}
          >
            {all ? "Show less" : `Show all ${entries.length} days`}
          </Button>
        )}
      </div>
    </SettingsSection>
  );
}
