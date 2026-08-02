import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { listBackups } from "@/lib/managed-apps/backups";
import { isManagedAppId } from "@/lib/managed-apps/catalog";

// The snapshots a rollback can choose from, newest first, straight out of each
// manifest — no directory is walked and nothing is sized on the fly, so this
// stays cheap enough to load with the panel.
//
// `skipped.dirNames` travels with every row on purpose: it is what a restore
// of that snapshot will NOT bring back, and the operator picking one deserves
// to see that before clicking, not after.

export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await context.params;
  if (!isManagedAppId(id)) return NextResponse.json({ error: "unknown managed application" }, { status: 404 });
  return NextResponse.json({ backups: await listBackups(id) });
}
