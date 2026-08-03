// Real product marks for the apps that wrap a THIRD-PARTY product, so the dock
// shows Hermes/OpenClaw/Camoufox as themselves rather than as an approximate
// lucide glyph. Each file is the upstream's own shipped icon, copied verbatim:
//
//   public/brand/hermes.png    ← hermes_cli/web_dist/favicon.ico (48px frame)
//   public/brand/openclaw.svg  ← openclaw/dist/control-ui/favicon.svg
//   public/brand/camoufox.png  ← camoufox browser/chrome/icons/default/default128.png
//
// Plain <img>, not next/image: these are tiny fixed-size local assets, so the
// optimizer would add a round trip and buy nothing. They live in os-shell (the
// mso CONSUMER), never in appshell — the framework stays brand-free.
//
// `alt=""` on purpose: every surface that renders an app icon already labels it
// with the app title, so alt text here would just repeat it to a screen reader.
import type { AppIconComponent } from "@/features/appshell";

function mark(src: string, className: string): AppIconComponent {
  const Mark: AppIconComponent = ({ className: cls }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" aria-hidden className={cls ?? className} draggable={false} />
  );
  Mark.displayName = `BrandMark(${src})`;
  return Mark;
}

export const HermesMark = mark("/brand/hermes.png", "size-full");
export const OpenClawMark = mark("/brand/openclaw.svg", "size-full");
export const CamoufoxMark = mark("/brand/camoufox.png", "size-full");
