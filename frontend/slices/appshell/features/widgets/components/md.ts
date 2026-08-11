// Minimal, SAFE markdown → HTML. Escape FIRST (including the double-quote, so a
// link URL can't break out of href="…" and inject an event-handler attribute),
// THEN apply a fixed set of transforms. Links are restricted to http(s) — no
// javascript:/data:. The output is rendered via dangerouslySetInnerHTML, so the
// escaping here is load-bearing (see md.test.ts).
//
// Used by the Markdown widget AND by the Alfa chat bubble, which is why fenced
// code blocks exist: an assistant reporting command output emits them on almost
// every turn, and rendering them literally is what made the thread look unfinished.
// ponytail: headings/bold/italic/code/fences/links/bullets — no tables, no nested
// lists. Add one only when something actually needs it.

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// A placeholder that cannot appear in real text and survives the escape pass
// untouched (it contains none of & < > ").
const MARK = "\u0000F";

export function mdToHtml(src: string): string {
  // Fenced blocks are lifted out BEFORE anything else and restored last. The
  // inline passes below would otherwise eat the ** and ` inside a shell snippet —
  // `rm -rf **` in a code block would have rendered as bold nothing.
  const fences: string[] = [];
  const body = src.replace(/```[a-zA-Z0-9_-]*\r?\n?([\s\S]*?)```/g, (_m, code: string) => {
    fences.push(esc(code.replace(/\n$/, "")));
    return `${MARK}${fences.length - 1}${MARK}`;
  });

  return esc(body)
    .replace(/^### (.+)$/gm, '<div class="text-sm font-semibold">$1</div>')
    .replace(/^## (.+)$/gm, '<div class="text-base font-bold">$1</div>')
    .replace(/^# (.+)$/gm, '<div class="text-lg font-bold">$1</div>')
    .replace(/^[-*] (.+)$/gm, "• $1")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/`([^`\n]+)`/g, '<code class="rounded bg-black/20 px-1">$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="underline">$1</a>')
    .replace(/\n/g, "<br/>")
    .replace(new RegExp(`${MARK}(\\d+)${MARK}`, "g"), (_m, i: string) =>
      `<pre class="my-1.5 overflow-x-auto rounded-md bg-black/25 p-2 text-[0.92em] leading-snug"><code>${fences[Number(i)]}</code></pre>`,
    );
}
