import type { Metadata } from "next";
import { Copy } from "./copy";

// A PUBLIC page: no session, no shell, no client data fetch. Someone evaluating
// MSO lands here from a shared link and has to be able to read the whole story —
// what it is, what it costs them in risk, and the exact commands — without an
// account. It deliberately does NOT render the OS shell: the shell is ~338 KB of
// JS for a page whose job is to be read.
export const metadata: Metadata = {
  title: "Install Manef Shell OS on your own server",
  description:
    "One command installs MSO on a Linux server you own: a browser terminal, file manager, live metrics and a BYOK AI assistant, behind password + device approval.",
};

const INSTALL = "curl -fsSL https://raw.githubusercontent.com/rahmanef63/mso/main/scripts/install.sh | bash";

const REQUIREMENTS = [
  ["A Linux server you own", "A $5 VPS is enough. Debian/Ubuntu, Fedora and Arch are covered by the installer."],
  ["Node 20.9 or newer", "The installer adds it via NodeSource if it is missing."],
  ["A normal, non-root user", "MSO runs as that user and can do whatever that user can do. Never install it as root."],
  ["About 2 GB free disk", "Mostly the build. The app itself is small; there is no database."],
];

const STEPS = [
  {
    n: 1,
    title: "Run the installer",
    body: "As your normal user, not root. It installs prerequisites, clones the repo, builds, generates a login password and session secret, and sets up the systemd unit.",
    code: INSTALL,
    note: "It prints your login password once. Save it — it is written only to .env.local on the server.",
  },
  {
    n: 2,
    title: "Put it behind something",
    body: "MSO listens on :4005. An authenticated session can read allowed files and run commands as the process user, so treat the port like SSH: do not expose it raw to the internet. Tailscale or a VPN is the easy answer; a TLS reverse proxy with an allowlist also works.",
    code: "sudo ufw deny 4005",
  },
  {
    n: 3,
    title: "Pair your first device",
    body: "Open the app and enter the password. Your browser lands in a PENDING state and shows a device id — correct password alone is not enough. Approve it from a shell on the server:",
    code: "mso device pending\nmso device approve <deviceId> \"my laptop\"",
    note: "Device approval is a browser allowlist, not standards-based 2FA. Approve only devices you own.",
  },
  {
    n: 4,
    title: "Reload and sign in",
    body: "That device can now log in with the password. Approve later devices the same way, or from Settings → Devices once you are in.",
  },
];

export default function InstallPage() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl px-5 py-14 text-foreground sm:px-8">
      <header className="mb-12">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Manef Shell OS</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Install it on your own server
        </h1>
        <p className="mt-4 text-balance text-base leading-relaxed text-muted-foreground">
          A browser terminal, file manager, live system metrics and a bring-your-own-key AI
          assistant for one Linux server you control. Open source, self-hosted, no account and
          no database. This page needs no login — the install does.
        </p>
        <p className="mt-4 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
          <strong className="font-medium text-foreground">Public Alpha.</strong> MSO is a normal
          non-root Node process on top of Linux. It is not an operating system, a distribution,
          or a hardened multi-tenant platform. One owner, one server.
        </p>
      </header>

      <section className="mb-12">
        <h2 className="mb-4 text-lg font-semibold">Before you start</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          {REQUIREMENTS.map(([term, detail]) => (
            <div key={term} className="rounded-lg border border-border p-4">
              <dt className="text-sm font-medium">{term}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mb-12">
        <h2 className="mb-5 text-lg font-semibold">Four steps</h2>
        <ol className="space-y-8">
          {STEPS.map((s) => (
            <li key={s.n} className="grid grid-cols-[2rem_1fr] gap-x-3">
              <span
                aria-hidden
                className="mt-0.5 flex size-7 items-center justify-center rounded-full border border-border text-sm font-medium tabular-nums"
              >
                {s.n}
              </span>
              <div className="min-w-0">
                <h3 className="text-base font-medium">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                {s.code ? <Copy text={s.code} /> : null}
                {s.note ? (
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">Note:</span> {s.note}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mb-12">
        <h2 className="mb-3 text-lg font-semibold">Drive it from a shell</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          The installer also puts <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]">mso</code> on
          your PATH. It reaches the same API the browser does — files, host shell, metrics,
          managed apps, devices — so nothing is UI-only. Start with{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]">mso doctor</code>.
        </p>
        <Copy text="mso doctor" />
      </section>

      <footer className="flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-6 text-sm">
        {[
          ["Source + full docs", "https://github.com/rahmanef63/mso"],
          ["Install reference", "https://github.com/rahmanef63/mso/blob/main/docs/INSTALL.md"],
          ["CLI reference", "https://github.com/rahmanef63/mso/blob/main/docs/CLI.md"],
          ["Security model", "https://github.com/rahmanef63/mso/blob/main/SECURITY.md"],
        ].map(([label, href]) => (
          <a key={href} className="text-muted-foreground underline underline-offset-4 hover:text-foreground" href={href}>
            {label}
          </a>
        ))}
      </footer>
    </main>
  );
}
