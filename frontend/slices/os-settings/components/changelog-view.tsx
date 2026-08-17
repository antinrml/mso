"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ChangelogDay } from "../lib/changelog";

// The changelog as a LIST, in the same idiom as the rest of Settings: an uppercase
// muted caption per day (the SettingsSection title treatment), a group label, a
// mono scope chip, then the subject. Theme tokens only — no hex, nothing that
// stops tracking the active preset.
//
// It scrolls INSIDE a bounded box rather than growing the pane. Six days of
// history is ~60 rows: without a bound it pushed everything below it out of reach
// and made the About pane's own scrollbar the only way back.

const DAY_LABEL = "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

export function ChangelogView({ days, className }: { days: ChangelogDay[]; className?: string }) {
  if (!days.length) return null;
  return (
    <ScrollArea className={cn("max-h-64 rounded-lg border bg-background/40", className)}>
      <div className="space-y-3 p-3">
        {days.map((day) => (
          <section key={day.date} className="space-y-1.5">
            {/* Sticky so the date stays legible while its own entries scroll past;
                the blur matches the shell's other floating chrome. */}
            <h4 className={cn(DAY_LABEL, "sticky -top-3 -mx-3 bg-background/85 px-3 py-1 backdrop-blur")}>
              {day.date}
            </h4>
            {day.groups.map((group) => (
              <div key={group.label} className="space-y-1">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  {group.label}
                </div>
                <ul className="space-y-1">
                  {group.entries.map((entry, i) => (
                    <li key={`${entry.scope}-${i}`} className="flex gap-1.5 text-xs leading-snug">
                      <span aria-hidden className="select-none text-muted-foreground/50">
                        •
                      </span>
                      <span className="min-w-0">
                        {entry.scope && (
                          <span className="mr-1 rounded bg-secondary px-1 font-mono text-[10px] text-muted-foreground">
                            {entry.scope}
                          </span>
                        )}
                        <span className="break-words text-foreground/90">{entry.text}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>
    </ScrollArea>
  );
}
