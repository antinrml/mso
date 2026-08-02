import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { isManagedAppId } from "@/lib/managed-apps/catalog";
import { listManagedAppJobs } from "@/lib/managed-apps/jobs";

// History for one app: the last operations with their outcome, WITHOUT the
// transcripts (a summary carries no `log`, so a list is not 20 x 256 KB).
// Read-only, so it stops at verifyAuth like the other GETs.

export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await context.params;
  if (!isManagedAppId(id)) return NextResponse.json({ error: "unknown managed application" }, { status: 404 });
  return NextResponse.json({ jobs: await listManagedAppJobs(id) });
}
