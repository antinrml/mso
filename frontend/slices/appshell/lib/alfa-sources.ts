"use client";

import type { MentionItem } from "./mentions";

// Completion sources for the composer's @ and / menus. Same seam as the runner and
// for the same reason: agents live in the assistant slice's localStorage store and
// skills come from /api/skills, neither of which appshell may reach. The consumer
// registers plain GETTERS — called on keystroke, never subscribed to — so typing
// re-renders the popup and nothing else. If nothing is registered the menus are
// simply empty and the composer behaves as it always did.
export type AlfaSources = {
  /** Display name of the agent currently answering, for the thread header. Without
   *  it a switch made from the sheet is global, persistent AND invisible — the user
   *  changes who replies to every future message with no feedback at all. */
  activeAgentName?: () => string | null;
  /** @ — the agents the user can address. */
  agents: () => MentionItem[];
  /** / — skills and executable tools, already merged and labelled by the consumer. */
  commands: () => MentionItem[];
};

const NO_SOURCES: AlfaSources = { agents: () => [], commands: () => [] };
let sources: AlfaSources = NO_SOURCES;

const subs = new Set<() => void>();
let version = 0;

// The consumer's source module is worth ~88 KB of chunk (tool catalog, its run()
// closures, agent presets) and NOTHING renders it until an AI composer exists. So
// the consumer registers a LOADER instead of importing eagerly, and the first
// composer render is what pulls it in.
let loader: (() => void | Promise<void>) | null = null;
let loaderStarted = false;

export function registerAlfaLoader(fn: () => void | Promise<void>): void {
  loader = fn;
}

export function registerAlfaSources(next: AlfaSources): void {
  sources = next;
  notifyAlfaSources();
}

/** Call when a getter's data lands asynchronously (the skills fetch). The composer
 *  computes its item list DURING render — deliberately, see chat-composer — so
 *  without this the new rows only appear on the user's next keystroke. */
export function notifyAlfaSources(): void {
  version++;
  for (const cb of subs) cb();
}

export function subscribeAlfaSources(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

export function alfaSourcesVersion(): number {
  return version;
}

export function alfaSources(): AlfaSources {
  if (loader && !loaderStarted) {
    loaderStarted = true;
    // Fire and forget: the loader calls registerAlfaSources, which notifies.
    void Promise.resolve(loader()).catch(() => {
      loaderStarted = false; // a failed chunk may succeed on the next open
    });
  }
  return sources;
}
