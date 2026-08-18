---
name: mso-image-editor
description: Edit MSO image-editor documents through the shared command registry, keeping document CRUD deterministic and rendering/raster-only operations in the real browser editor.
metadata:
  mso:
    risk: medium
    policy: document-crud
---

# /mso-image-editor — document-level image editing

MSO exposes the same editor command registry to the browser AI and the CLI. The CLI edits **document data**; the real editor remains the only renderer and owns raster operations.

Resolve paths dynamically:

```bash
MSO_ROOT="${MSO_DIR:-$(systemctl show -p WorkingDirectory --value mso.service 2>/dev/null || true)}"
[ -n "$MSO_ROOT" ] || MSO_ROOT="$HOME/mso"
IE="$MSO_ROOT/claude-skills/mso-image-editor/image-editor.sh"

"$IE" new 1080x1080
"$IE" open ~/pic.jpg
"$IE" run layer.add kind=text text="SALE" fontSize=160 fill=#ffffff
"$IE" inspect
"$IE" save ~/pic.doc.json
"$IE" view ~/pic.doc.json
```

## Model

- `new` / `open` → create a working document session.
- `inspect` / `doc` → read document state.
- `run` → apply one command from the shared registry.
- `save` → persist a `.doc.json` host file.
- `view` → open the persisted document in the real editor for rendering.

Use `"$IE" tools` as the authoritative command/schema list instead of copying a static command count into this skill.

## Boundaries

- Document commands may change layers, text, shapes, transforms, adjustments and styles.
- Brush pixels, interactive masks, background removal and final raster rendering are browser-only by design.
- Every `run` is stateless apart from the document it returns. Save versions when an undo point matters.
- Never hardcode the MSO repo path or login secret. `image-editor.sh` resolves its own repo root and reads the configured env file without printing credentials.
