import { Bot, Workflow } from "lucide-react";
import type { AppDescriptor } from "@/features/os-shell";

type ManagedApp = "hermes" | "openclaw";

// Ordinary apps, dock and all. They were `noDock` while MSO could swap its whole shell
// into a Hermes/OpenClaw "workspace mode" that opened them by itself — that is gone: each
// ships its own sidebar, so re-hosting its navigation bought nothing. One window per app.
function managedDescriptor(app: ManagedApp): AppDescriptor {
  const hermes = app === "hermes";
  return {
    id: app,
    title: hermes ? "Hermes" : "OpenClaw",
    icon: hermes ? Bot : Workflow,
    gradient: hermes ? "linear-gradient(160deg,#8b5cf6,#4f46e5)" : "linear-gradient(160deg,#f97316,#dc2626)",
    load: async () => {
      const loaded = await import("./app");
      return { default: hermes ? loaded.HermesApp : loaded.OpenClawApp };
    },
    defaultSize: { w: 1100, h: 720 },
  };
}

export const hermesApp = managedDescriptor("hermes");
export const openclawApp = managedDescriptor("openclaw");
