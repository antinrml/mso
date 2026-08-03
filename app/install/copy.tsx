"use client";

import * as React from "react";
import { Check, Copy as CopyIcon } from "lucide-react";

// The one interactive bit on an otherwise static public page. A shell command you
// have to hand-retype is a command you mistype, and the install one-liner is long
// enough that a wrapped line hides a missing character.
export function Copy({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <div className="group relative mt-3">
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted/50 py-3 pl-4 pr-12 text-[0.8125rem] leading-relaxed">
        <code>{text}</code>
      </pre>
      <button
        type="button"
        // navigator.clipboard is undefined on insecure origins — someone reading
        // this over plain http on a LAN address still gets a working button.
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
          } catch {
            const el = document.createElement("textarea");
            el.value = text;
            el.style.position = "fixed";
            el.style.opacity = "0";
            document.body.appendChild(el);
            el.select();
            document.execCommand("copy");
            el.remove();
          }
          setCopied(true);
        }}
        className="absolute right-2 top-2 rounded-md border border-border bg-background/80 p-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-label={copied ? "Copied" : "Copy to clipboard"}
      >
        {copied ? <Check className="size-3.5" aria-hidden /> : <CopyIcon className="size-3.5" aria-hidden />}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </div>
  );
}
