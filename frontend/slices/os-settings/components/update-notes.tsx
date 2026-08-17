"use client";

import { useEffect, useState } from "react";
import { GitCommitHorizontal } from "lucide-react";
import { FormDrawer, mdToHtml } from "@/features/os-shell";
import type { UpdateCommit } from "@/lib/host/self-update";

// The docs behind the update button: what is ABOUT to land, then what already has.
//
// Two different sources on purpose. The incoming list comes from the update check
// (`git log HEAD..origin/main`) because docs/CHANGELOG.md in this checkout is, by
// definition, the OLD one — it is generated at ship time and arrives WITH the update
// it would describe. The shipped list is that file, the same one "What's new" shows.

const REPO = "https://github.com/rahmanef63/mso";

export function UpdateNotes({ commits }: { commits: UpdateCommit[] }) {
  const [shipped, setShipped] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/changelog", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { markdown?: string } | null) => alive && setShipped(d?.markdown?.slice(0, 12_000) ?? ""))
      .catch(() => alive && setShipped(""));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <FormDrawer.Body className="space-y-4">
      {commits.length > 0 && (
        <section className="space-y-1.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Incoming</h3>
          <ul className="space-y-1.5">
            {commits.map((c) => (
              <li key={c.sha} className="flex gap-2 text-xs">
                <GitCommitHorizontal className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="break-words text-foreground">{c.subject}</span>{" "}
                  <span className="whitespace-nowrap font-mono text-[10px] text-muted-foreground">
                    {c.sha} · {c.date}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {commits.length > 0 ? "Already shipped here" : "Shipped"}
        </h3>
        {shipped === null ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : shipped ? (
          <div
            className="space-y-1 text-xs leading-relaxed [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1 [&_code]:font-mono [&_h2]:pt-2 [&_h2]:text-[11px] [&_h2]:font-semibold [&_h2]:text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground"
            dangerouslySetInnerHTML={{ __html: mdToHtml(shipped) }}
          />
        ) : (
          <p className="text-xs text-muted-foreground">No changelog in this checkout yet.</p>
        )}
      </section>

      <section className="space-y-1 border-t pt-3 text-xs">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Docs</h3>
        {/* Real links, so ⌘-click and long-press-share behave. The repo is public;
            everything here is already in the commit history it points at. */}
        <ul className="space-y-1">
          {[
            ["README — what MSO is, and the security model", `${REPO}#readme`],
            ["Full changelog", `${REPO}/blob/main/docs/CHANGELOG.md`],
            ["Progress log — why each change happened", `${REPO}/blob/main/docs/PROGRESS.md`],
            ["CLI reference", `${REPO}/blob/main/docs/CLI.md`],
          ].map(([label, href]) => (
            <li key={href}>
              <a href={href} target="_blank" rel="noreferrer" className="text-info underline-offset-2 hover:underline">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </FormDrawer.Body>
  );
}
