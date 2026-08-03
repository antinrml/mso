---
name: mso-image-editor
description: Edit images from the CLI by CRUD-ing an mso editor DOCUMENT (JSON) — open an image, run any editor op (layers, text, shapes, adjustments, blend/shadow/glow/stroke, transform, crop, resize), save it, then render by opening in the REAL mso editor. No bespoke renderer. Trigger on /mso-image-editor, "edit this image", "add text to image", "make a thumbnail/story", "resize/crop image", "adjust brightness/contrast", "drive the image editor from cli".
---

# /mso-image-editor — edit images via document CRUD

Edit images from here using the SAME command registry the in-browser editor's AI
panel uses. The CLI is **data-level**: it builds/updates an editor **document**
(JSON) via `POST /api/v1/editor/exec` (a React-free reducer — pure data, no
browser). To SEE the result, **open the doc in the real mso editor** ("render
= the actual editor"). This is just editor-document CRUD — see the generic
`mso crud` in [/mso]; this skill is the editor-doc-specialized front end.

```bash
SH=/home/rahman/.claude/skills/mso-image-editor/image-editor.sh
$SH open ~/pic.jpg                         # → 1:1 doc (image layer; dims via header probe)
$SH run adjust.set brightness=0.15 contrast=20
$SH run layer.add kind=text text="SALE 50%" fontSize=160 fill=#ff3366
$SH run transform.set x=120 y=200
$SH run style.shadow enabled=true distance=12 size=20 opacity=0.6
$SH inspect                                # layer stack + canvas state
$SH save ~/pic.doc.json                    # persist the doc to a host file
$SH view ~/pic.doc.json                    # → URL; open it to RENDER in the real editor
```

Other verbs: `new [WxH]` (blank doc), `tools` (every command + schema), `doc`
(raw session JSON). `k=v` values coerce: `12`/`1.5` → number, `true/false` →
bool, else string. Hex (`#ff3366`) is fine unquoted.

## Model (no parallel renderer)

- **Session** = a working Doc JSON (`$TMPDIR/mso-image-editor.session.json`). Each
  verb sends it + one command and saves the returned doc. `open`/`new` reset it;
  `save <path>` writes it to a real host file (what the editor opens).
- **CRUD mapping**: `new`/`open` = Create · `inspect`/`doc` = Read · `run` =
  Update · (delete the file via `mso crud del`). The generic equivalent:
  `mso crud set <path.json> <cmd k=v…>`.
- **Render = the REAL editor.** `save` to a `.doc.json`, then open
  `https://mso.rahmanef.com/studio/<abs-path>` (what `view` prints) — media-studio
  loads it into the actual Konva editor (`ImageEditor projectSrc`). Pixel-exact,
  zero duplicate engine. (There is no server-side PNG render anymore.)
- **Auth**: persistent cookie jar (`$TMPDIR/mso-image-editor.jar`), login only on
  401 — same device-approval model as [/mso].

## Commands (32) — `$SH tools` for the full schema

| Domain | Commands |
|---|---|
| document | `doc.inspect` `doc.resize w h` `doc.aspect preset` `doc.crop x y w h` |
| layer | `layer.add kind=…` `layer.remove` `layer.duplicate` `layer.select` `layer.order move=raise\|lower\|front\|back` `layer.visibility visible=` `layer.lock locked=` `layer.rename name=` `layer.opacity opacity=` |
| transform | `transform.set x= y= width= height= rotation= scaleX= scaleY=` `transform.flip horizontal= vertical=` `text.edit text= fontSize= fill= …` `shape.edit shape= fillColor=` |
| adjust | `adjust.set brightness= contrast= saturation= hue= blur= grayscale= invert= sepia=` `adjust.reset` `adjust.addLayer` |
| style | `style.blend blend= clipBelow=` `style.shadow enabled= …` `style.glow enabled= …` `style.stroke enabled= color= width=` |
| tool | `tool.select tool=` `brush.set` `color.set fg= bg=` `color.swap` `mask.add` `mask.remove` `edit.undo` `edit.redo` |

Target a layer with `layerId=`/`layerName=`; omit → the selected layer (the last
added). `doc.aspect` presets: `Square 1:1`, `Portrait 4:5`, `Story 9:16`,
`Landscape 16:9`, `Wide 1.91:1`.

## Recipe

```bash
# Instagram story from a photo + title, rendered in the real editor
$SH open ~/photo.jpg
$SH run doc.aspect preset="Story 9:16"
$SH run layer.add kind=text text="NEW DROP" fontSize=140 fill=#ffffff fontStyle=bold
$SH run transform.set x=90 y=1500
$SH save ~/story.doc.json
$SH view ~/story.doc.json     # open the printed URL → Konva renders it exactly
```

## Notes

- `set`/`run` only edit DATA; brush pixels are painted in the real editor (the
  doc carries layers/styles, not brush strokes). `image.removeBackground` is a
  browser-only op (run it in the editor's AI panel, not headless).
- Code: route `app/api/v1/editor/exec/route.ts`; engine
  `frontend/slices/image-editor/lib/headless/{editor-core,run,image-size}.ts`;
  server barrel `…/image-editor/server.ts`; render bridge `media-studio/app.tsx`
  + `image-editor.tsx` (`projectSrc`/`ProjectLoader`).
- Adding a command (a `commands/*.commands.ts` entry) exposes it to this CLI, the
  generic `mso crud`, AND the in-browser AI panel at once.
