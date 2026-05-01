#!/usr/bin/env bash
#
# Render the PWA raster icons (192/512 + 512 maskable) from
# apps/openape-chat/public/icon.svg. Run once and commit the resulting
# PNGs — they only need to regenerate when the source SVG changes.
#
# Tries rsvg-convert first (Homebrew: `brew install librsvg`), falls
# back to magick (ImageMagick: `brew install imagemagick`). Modern
# browsers happily install the PWA from the SVG alone, but older
# Android launchers and legacy Chromebook installs render the home-
# screen icon at very low quality without raster sources, so it's
# worth providing them.
#
# Maskable safe zone: ~10% inset on each side. Our icon.svg already
# uses ~96px inset on a 512 viewBox (= 19% from each edge), so the
# `any maskable` purpose works without a separate maskable asset.

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SVG="${ROOT}/apps/openape-chat/public/icon.svg"
OUT="${ROOT}/apps/openape-chat/public"

if [ ! -f "$SVG" ]; then
  echo "Source not found: $SVG" >&2
  exit 1
fi

# macOS fallback: qlmanage + sips render SVG via the system QuickLook
# generator. It only outputs at 512×512 and ignores the size argument, so
# we render once at 512 and scale down with sips for the smaller targets.
QL_TMP=""
ensure_ql_tmp() {
  if [ -z "$QL_TMP" ]; then
    QL_TMP=$(mktemp -d)
    trap 'rm -rf "$QL_TMP"' EXIT
    qlmanage -t -s 512 -o "$QL_TMP" "$SVG" >/dev/null 2>&1
    if [ ! -s "$QL_TMP/icon.svg.png" ]; then
      echo "qlmanage failed to render $SVG" >&2
      exit 1
    fi
  fi
}

render() {
  local size="$1"
  local target="$2"
  if command -v rsvg-convert >/dev/null 2>&1; then
    rsvg-convert -w "$size" -h "$size" "$SVG" -o "$target"
  elif command -v magick >/dev/null 2>&1; then
    magick -background none -density 384 "$SVG" -resize "${size}x${size}" "$target"
  elif command -v convert >/dev/null 2>&1; then
    convert -background none -density 384 "$SVG" -resize "${size}x${size}" "$target"
  elif [ "$(uname)" = "Darwin" ] && command -v qlmanage >/dev/null 2>&1 && command -v sips >/dev/null 2>&1; then
    ensure_ql_tmp
    sips -z "$size" "$size" "$QL_TMP/icon.svg.png" --out "$target" >/dev/null 2>&1
  else
    echo "No raster renderer available." >&2
    echo "Install one of:" >&2
    echo "  brew install librsvg          # rsvg-convert (preferred)" >&2
    echo "  brew install imagemagick      # magick / convert" >&2
    echo "macOS users without Homebrew can install Xcode CLT for qlmanage + sips." >&2
    exit 1
  fi
  echo "  ${target}"
}

echo "→ Rendering PWA icons from ${SVG}"
render 192 "${OUT}/icon-192.png"
render 512 "${OUT}/icon-512.png"
# Maskable uses the same source — Chrome/Android crops to the safe zone,
# our viewBox already keeps the glyph inside it.
render 512 "${OUT}/icon-512-maskable.png"

echo
echo "✓ Done. Update the manifest in apps/openape-chat/nuxt.config.ts to"
echo "  reference icon-192.png + icon-512.png + icon-512-maskable.png if"
echo "  you want raster fallbacks alongside the SVG."
