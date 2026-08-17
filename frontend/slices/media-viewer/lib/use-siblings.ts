"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useOsApi } from "./host";
import { kindForName, isPreviewable, type ViewKind } from "./kinds";

// ← → through the folder, the way every OS preview works.
//
// The sibling list is LISTED, not passed in: a window opened from a deep link, from
// Spotlight or from the assistant carries one path and no folder, and a viewer that
// could only page when it was opened from the file grid would be arrows that
// sometimes exist. One `fs.list` of the parent directory covers every entry point.

export interface Sibling {
  path: string;
  name: string;
  kind: ViewKind;
}

const parentOf = (path: string): string => {
  const cut = path.replace(/\/+$/, "").lastIndexOf("/");
  return cut > 0 ? path.slice(0, cut) : "/";
};

export function useSiblings(path: string, name: string): {
  items: Sibling[];
  index: number;
  prev: Sibling | null;
  next: Sibling | null;
  go: (delta: number) => Sibling | null;
} {
  const api = useOsApi();
  const [items, setItems] = useState<Sibling[]>([]);
  const dir = useMemo(() => parentOf(path), [path]);

  useEffect(() => {
    let alive = true;
    api.fs
      .list(dir)
      .then((res) => {
        if (!alive) return;
        // Only files this viewer can actually show — paging onto a .zip would be a
        // download card between two photos.
        const base = res.path || dir;
        setItems(
          res.entries
            .filter((e) => e.kind === "file" && isPreviewable(kindForName(e.name)))
            .map((e) => ({
              path: `${base.replace(/\/+$/, "")}/${e.name}`,
              name: e.name,
              kind: kindForName(e.name),
            })),
        );
      })
      .catch(() => {
        // A folder we cannot list (bounds, permissions) simply has no arrows.
        if (alive) setItems([]);
      });
    return () => {
      alive = false;
    };
  }, [api, dir]);

  const index = items.findIndex((i) => i.path === path || i.name === name);
  const at = useCallback(
    (delta: number): Sibling | null => {
      if (items.length < 2 || index < 0) return null;
      return items[(index + delta + items.length) % items.length] ?? null;
    },
    [items, index],
  );

  return { items, index, prev: at(-1), next: at(1), go: at };
}
