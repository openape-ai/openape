# Application icon

The OpenApe Pods icon uses a forest-green tile and an ivory cube, the same mark
the workspace header shows (`src/renderer/WorkspaceFrame.vue`). It replaced the
earlier ape face on 2026-10-05 at Patrick Hofmann's request.

`openape-pods.svg` is the source. `openape-pods.png` is its 1024 px RGBA render;
`openape-pods.icns` contains all standard macOS sizes from 16 to 1024 px. Both
fixture and distribution packages use the same icon through `scripts/package.mjs`.

Regenerate after editing the SVG (macOS, no extra tools):

```bash
sips -s format png openape-pods.svg --out openape-pods.png
mkdir icon.iconset
for s in 16 32 128 256 512; do
  sips -z $s $s openape-pods.png --out icon.iconset/icon_${s}x${s}.png
  sips -z $((s*2)) $((s*2)) openape-pods.png --out icon.iconset/icon_${s}x${s}@2x.png
done
iconutil -c icns icon.iconset -o openape-pods.icns && rm -r icon.iconset
```

Packaging includes the icon before signing; do not modify a signed application
bundle to replace its icon.
