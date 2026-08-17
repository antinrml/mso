"use client";

import { Download, FileQuestion, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";

// The end of the road for bytes no browser renders — .docx, .zip, a codec the
// build has no decoder for. It names the format instead of showing a blank frame,
// because a blank frame reads as "MSO is broken" and sends people looking for a
// fault that is not there. The download is the real answer, so it is the button.
export function FallbackCard({
  name,
  ext,
  reason,
  onDownload,
  editorLabel,
  onOpenEditor,
}: {
  name: string;
  ext: string;
  reason: string;
  onDownload: () => void;
  editorLabel?: string;
  onOpenEditor?: () => void;
}) {
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-xl border bg-card/80 p-6 text-center text-muted-foreground shadow-2xl backdrop-blur sm:p-8">
      <div className="grid size-14 place-items-center rounded-2xl bg-muted text-foreground">
        <FileQuestion className="size-7" />
      </div>
      <div className="w-full break-words text-sm font-semibold text-foreground">{name}</div>
      <p className="max-w-[320px] text-xs leading-relaxed">
        {reason}
        {ext && <span className="ml-1 font-mono uppercase">({ext})</span>}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="sm" onClick={onDownload} className="[@media(pointer:coarse)]:min-h-[44px]">
          <Download className="size-3.5" />
          Download
        </Button>
        {editorLabel && onOpenEditor && (
          <Button size="sm" variant="secondary" onClick={onOpenEditor} className="[@media(pointer:coarse)]:min-h-[44px]">
            <Pencil className="size-3.5" />
            Open in {editorLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
