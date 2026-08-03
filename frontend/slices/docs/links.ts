// Every link the Docs app shows, in one place. These used to be the DEFAULT
// quicklinks — but quicklinks are the owner's own shortcuts, and shipping four
// GitHub file URLs in that slot meant a fresh install's "personal" links were
// really the project's docs. Docs live here; quicklinks went back to being the
// owner's (see lib/quicklinks/store.ts).
export const REPO = "https://github.com/rahmanef63/mso";
const blob = (p: string) => `${REPO}/blob/main/${p}`;

export type DocLink = { title: string; desc: string; href: string };

// Shown first and on its own: the one page you can send to someone who has no
// account and no idea what MSO is. It is served by this very instance at
// /install, so it works even for a visitor who cannot reach github.com.
export const INSTALL_GUIDE: DocLink = {
  title: "Install on your own server",
  desc: "No login needed — requirements, the one-line installer, and the device-pairing step.",
  href: "/install",
};

export const START_HERE: DocLink[] = [
  { title: "GitHub repository", desc: "Source, issues, releases.", href: REPO },
  { title: "Install reference", desc: "Full server setup, TLS/VPN, updates and rollback.", href: blob("docs/INSTALL.md") },
  { title: "CLI reference", desc: "Every `mso` command, generated from its own --help.", href: blob("docs/CLI.md") },
  { title: "Security model", desc: "What a session can reach, and how to bound it.", href: blob("SECURITY.md") },
];

export const DEEPER: DocLink[] = [
  { title: "Architecture", desc: "How the shell, slices and host API fit together.", href: blob("docs/ARCHITECTURE.md") },
  { title: "Managed apps", desc: "Running Hermes and OpenClaw under MSO.", href: blob("docs/MANAGED-APPS.md") },
  { title: "Development", desc: "Local setup, slice conventions, tests.", href: blob("docs/DEVELOPMENT.md") },
  { title: "Troubleshooting", desc: "Common install, build and deploy failures.", href: blob("docs/TROUBLESHOOTING.md") },
  { title: "FAQ", desc: "What MSO is and, more usefully, what it is not.", href: blob("docs/FAQ.md") },
  { title: "Slice catalog", desc: "Every slice, what it owns, and its state.", href: blob("docs/SLICE-CATALOG.md") },
];
