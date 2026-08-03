import "server-only";
import { createBackup } from "./backups";
import { getManagedAppDefinition, listManagedAppDefinitions } from "./catalog";
import { acquireOperation, activeOperation, releaseOperation } from "./lock";
import { redact } from "./redact";
import { commandExists, requireProgram, runProgram } from "./runner";
import type { ManagedAppAction, ManagedAppDefinition, ManagedAppId, ManagedAppLogs, ManagedAppView } from "./types";

interface Installation {
  type: "systemd" | "docker" | "package" | "not-installed";
  serviceName?: string;
  containerName?: string;
}

// `is-active` cannot tell "this unit is stopped" from "this unit does not exist":
// on systemd 255 an unknown unit prints `inactive` with rc 4 and an empty stderr,
// so the old text match never fired and the FIRST configured name always won the
// detection. Real consequence: OpenClaw's catalog listed a non-existent
// `openclaw.service` first, so its card read "stopped" and start/stop/restart 409'd
// while its gateway was serving. `show -p LoadState` distinguishes them, and one
// call returns both facts.
async function systemdState(service: string): Promise<"active" | "inactive" | "missing"> {
  for (const scope of [["--user"], []]) {
    const result = await runProgram("systemctl", [...scope, "show", "-p", "LoadState", "-p", "ActiveState", service], 10_000);
    // Non-zero here is no systemctl at all, or no user bus — not an answer about
    // the unit, so try the next scope rather than concluding anything.
    if (result.code !== 0) continue;
    const load = /LoadState=(\S+)/.exec(result.stdout)?.[1];
    if (!load || load === "not-found") continue;
    return /ActiveState=active/.test(result.stdout) ? "active" : "inactive";
  }
  return "missing";
}

async function detect(definition: ManagedAppDefinition): Promise<Installation> {
  for (const serviceName of definition.serviceNames) {
    if (await systemdState(serviceName) !== "missing") return { type: "systemd", serviceName };
  }
  if (await commandExists("docker")) {
    const result = await runProgram("docker", ["ps", "-a", "--format", "{{.Names}}"], 10_000);
    const names = new Set(result.stdout.split(/\r?\n/).map((name) => name.trim()));
    const containerName = definition.containerNames.find((name) => names.has(name));
    if (containerName) return { type: "docker", containerName };
  }
  if (await commandExists(definition.command)) return { type: "package" };
  return { type: "not-installed" };
}

async function running(installation: Installation): Promise<boolean> {
  if (installation.type === "systemd" && installation.serviceName) return (await systemdState(installation.serviceName)) === "active";
  if (installation.type === "docker" && installation.containerName) {
    const result = await runProgram("docker", ["inspect", "--format", "{{.State.Running}}", installation.containerName], 10_000);
    return result.code === 0 && result.stdout.trim() === "true";
  }
  return false;
}

async function health(definition: ManagedAppDefinition): Promise<boolean | null> {
  try {
    const response = await fetch(`${definition.dashboardUrl.replace(/\/$/, "")}/health`, { cache: "no-store", signal: AbortSignal.timeout(4_000) });
    return response.ok;
  } catch {
    return null;
  }
}

// `--version` forks the app's own binary, which is not free (hermes: ~0.44 s of CPU
// per call on this host) — and the Managed Apps panel re-polls every 10 s, for a
// string that only changes on upgrade. Cached per app id; performManagedAppAction
// drops the entry, since an install/restart is the only thing that can move it.
const VERSION_TTL_MS = 60_000;
const versionCache = new Map<ManagedAppId, { value: string | null; at: number }>();

async function version(definition: ManagedAppDefinition): Promise<string | null> {
  const hit = versionCache.get(definition.id);
  if (hit && Date.now() - hit.at < VERSION_TTL_MS) return hit.value;
  let value: string | null = null;
  if (await commandExists(definition.command)) {
    const result = await runProgram(definition.command, ["--version"], 10_000);
    value = result.code === 0 ? result.stdout.trim().split(/\r?\n/)[0]?.slice(0, 160) || null : null;
  }
  versionCache.set(definition.id, { value, at: Date.now() });
  return value;
}

function actionsFor(installation: Installation): ManagedAppAction[] {
  if (installation.type === "systemd" || installation.type === "docker") return ["start", "stop", "restart", "backup"];
  if (installation.type === "package") return ["backup"];
  return [];
}

export async function getManagedApp(id: ManagedAppId): Promise<ManagedAppView> {
  const definition = getManagedAppDefinition(id);
  const installation = await detect(definition);
  const isRunning = await running(installation);
  const isHealthy = isRunning ? await health(definition) : null;
  const operation = activeOperation(id);
  const state = operation === "start"
    ? "starting"
    : installation.type === "not-installed"
      ? "not-installed"
      : isHealthy === false
        ? "unhealthy"
        : isRunning
          ? "running"
          : "stopped";
  return {
    id,
    name: definition.name,
    description: definition.description,
    installed: installation.type !== "not-installed",
    installationType: installation.type,
    state,
    healthy: isHealthy,
    version: await version(definition),
    dashboardAvailable: isRunning && isHealthy !== false,
    supportedActions: actionsFor(installation),
  };
}

export async function listManagedApps(): Promise<ManagedAppView[]> {
  const views: ManagedAppView[] = [];
  for (const definition of listManagedAppDefinitions()) views.push(await getManagedApp(definition.id));
  return views;
}

async function runLifecycle(installation: Installation, action: "start" | "stop" | "restart"): Promise<void> {
  if (installation.type === "systemd" && installation.serviceName) {
    for (const args of [["--user", action, installation.serviceName], [action, installation.serviceName]]) {
      const result = await runProgram("systemctl", args, 30_000);
      if (result.code === 0) return;
    }
  }
  if (installation.type === "docker" && installation.containerName) {
    await requireProgram("docker", [action, installation.containerName], 30_000);
    return;
  }
  throw new Error("operation unsupported for detected installation type");
}

export async function performManagedAppAction(id: ManagedAppId, action: ManagedAppAction): Promise<ManagedAppView> {
  // Taken before detection now, and shared with the job layer (lock.ts), so a
  // 30-minute update and a `restart` can never interleave on the same app.
  if (!acquireOperation(id, action)) throw new Error("another operation is already running");
  try {
    const definition = getManagedAppDefinition(id);
    const installation = await detect(definition);
    if (!actionsFor(installation).includes(action)) throw new Error("operation unsupported for detected installation type");
    if (action === "backup") await createBackup(definition, "manual");
    else await runLifecycle(installation, action);
  } finally {
    releaseOperation(id);
    // The action may have installed/upgraded the binary — drop the cached version
    // so the view returned below reports the new one, not a stale ≤60 s reading.
    versionCache.delete(id);
  }
  return getManagedApp(id);
}

export async function getManagedAppLogs(id: ManagedAppId): Promise<ManagedAppLogs> {
  const definition = getManagedAppDefinition(id);
  const installation = await detect(definition);
  let result = null;
  if (installation.type === "systemd" && installation.serviceName) {
    result = await runProgram("journalctl", ["--user", "-u", installation.serviceName, "-n", "100", "--no-pager", "-o", "short-iso"], 15_000);
    if (result.code !== 0) result = await runProgram("journalctl", ["-u", installation.serviceName, "-n", "100", "--no-pager", "-o", "short-iso"], 15_000);
  } else if (installation.type === "docker" && installation.containerName) {
    result = await runProgram("docker", ["logs", "--tail", "100", installation.containerName], 15_000);
  }
  if (!result || result.code !== 0) return { available: false, entries: [] };
  return { available: true, entries: `${result.stdout}\n${result.stderr}`.split(/\r?\n/).filter(Boolean).slice(-100).map(redact) };
}
