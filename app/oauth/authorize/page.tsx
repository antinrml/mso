import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/require-session";
import { getClient } from "@/lib/mcp/store";
import { isAllowedRedirect } from "@/lib/mcp/pkce";
import { mcpEnabled, maxScope } from "@/lib/mcp/scope";
import { ConsentForm } from "./consent-form";

// OAuth consent. Renders only for a signed-in owner; everything it needs to mint
// a code is carried in the query string and re-validated in the action.
export const dynamic = "force-dynamic";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main id="main-content" className="grid min-h-dvh place-items-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">{children}</div>
    </main>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!mcpEnabled()) notFound();
  const q = await searchParams;
  const one = (k: string) => (Array.isArray(q[k]) ? q[k][0] : q[k]) ?? "";

  const clientId = one("client_id");
  const redirectUri = one("redirect_uri");
  const challenge = one("code_challenge");
  const method = one("code_challenge_method");

  if (!(await requireSession())) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">Sign in first</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Open mso, unlock it on this device, then start the connection again from the client. This page
          cannot authorize anything on its own.
        </p>
        <Link className="mt-4 inline-block text-sm underline" href="/" prefetch={false}>
          Open mso
        </Link>
      </Shell>
    );
  }

  // Fail loudly and specifically BEFORE showing an Allow button — a consent screen
  // that approves a malformed request is worse than one that refuses to render.
  const problem =
    !clientId ? "The client did not send a client_id."
    : !isAllowedRedirect(redirectUri) ? "The client's redirect target is missing, or is not https (or localhost)."
    : method !== "S256" || !challenge ? "The client did not use PKCE with S256, which mso requires."
    : null;

  if (problem) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">Cannot connect this client</h1>
        <p className="mt-2 text-sm text-muted-foreground">{problem}</p>
      </Shell>
    );
  }

  const client = await getClient(clientId);
  return (
    <Shell>
      <ConsentForm
        clientName={client?.name ?? clientId}
        redirectUri={redirectUri}
        ceiling={maxScope()}
        hidden={{
          client_id: clientId,
          redirect_uri: redirectUri,
          code_challenge: challenge,
          code_challenge_method: method,
          state: one("state"),
        }}
      />
    </Shell>
  );
}
