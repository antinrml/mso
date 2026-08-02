"use client";
/* Dashboard shell pieces — sidebar rows + the Home overview (host stats).
   Split from dashboard-shell.tsx to keep both under the 200-line rule; only the
   Dashboard shell composes these. */
import { X, Cpu, MemoryStick, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSystemStats } from "../../../registry/capabilities";
import type { AppDescriptor } from "../../../lib/types";

export function DashboardHome({ apps, onOpenApp }: { apps: AppDescriptor[]; onOpenApp: (app: AppDescriptor) => void }) {
  const stats = useSystemStats();
  const monitor = apps.find((a) => a.id === "system-monitor");
  const cards = stats
    ? [
        { icon: Cpu, label: "CPU", value: `${Math.round(stats.cpu.pct)}%`, hint: `${stats.cpu.cores} cores` },
        { icon: MemoryStick, label: "Memory", value: `${Math.round((stats.mem.used / stats.mem.total) * 100)}%`, hint: fmtGb(stats.mem.used) + " / " + fmtGb(stats.mem.total) },
        { icon: HardDrive, label: "Disk", value: `${Math.round((stats.disk.used / stats.disk.total) * 100)}%`, hint: fmtGb(stats.disk.used) + " / " + fmtGb(stats.disk.total) },
      ]
    : [];

  return (
    <div className="mx-auto h-full max-w-6xl overflow-auto px-8 py-7">
      <h1 className="mb-1 text-xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mb-8 text-sm text-muted-foreground">Your VPS, one pane at a time.</p>

      {cards.length > 0 && (
        <Section title="Host">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {cards.map((c) => (
              <button
                key={c.label}
                onClick={() => monitor && onOpenApp(monitor)}
                className="flex items-center gap-3.5 rounded-xl border border-border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-md"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><c.icon className="size-5" /></span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{c.label} · {c.value}</span>
                  <span className="block truncate text-xs text-muted-foreground">{c.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* No app grid here. It listed the same apps, in the same order, under the
          same "Apps" heading as the sidebar rail two hundred pixels to the left —
          both on screen at once. The rail is the better copy: always visible, it
          marks what is running and can close it, and it survives once a pane opens.
          Home is the host at a glance; the rail is how you go somewhere. */}
    </div>
  );
}

/* One sidebar row. `running` marks an app that already has a window open, so the
   Apps list doubles as the running list instead of a second section repeating it —
   the point being that a menu entry is a place to GO, not a thing to spawn again.
   The dot follows the Windows taskbar's bg-primary convention rather than the macOS
   dock's bg-muted-foreground; both exist in this repo and the brighter one is what
   reads on this surface (the sidebar already uses text-primary / bg-primary/10).
   Colour alone is never the signal — the sr-only text carries it too. `onClose` is
   the only per-window close affordance the Dashboard has once the Running list is
   gone, so it is kept here rather than dropped. */
export function NavItem({ active, running, onClick, onClose, icon, label }: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  running?: boolean;
  onClose?: () => void;
}) {
  return (
    <div className={`group flex items-center rounded-md ${active ? "bg-primary/10" : "hover:bg-muted"}`}>
      <button
        onClick={onClick}
        className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
          active ? "font-medium text-foreground" : "text-muted-foreground group-hover:text-foreground"
        }`}
      >
        {icon}
        <span className="truncate">{label}</span>
        {running && (
          <>
            {/* Hidden on hover: the ✕ takes this same right-hand slot, and the dot
                sitting next to it read as two marks for one row. */}
            <span aria-hidden className="ml-auto size-1.5 shrink-0 rounded-full bg-primary group-hover:hidden" />
            <span className="sr-only">(running)</span>
          </>
        )}
      </button>
      {running && onClose ? (
        <Button type="button" variant="ghost" size="icon"
          aria-label={`Close ${label}`}
          onClick={onClose}
          className="mr-1 size-6 shrink-0 rounded text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

export function SidebarLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pb-1.5 pt-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-9">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function fmtGb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
