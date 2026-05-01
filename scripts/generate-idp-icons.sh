#!/usr/bin/env bash
#
# Render the PWA raster icons (192/512 + 512 maskable) from
# apps/openape-free-idp/public/icon.svg. Run once and commit the
# resulting PNGs — they only need to regenerate when the source SVG
# changes.
#
# Tries rsvg-convert first (Homebrew: `brew install librsvg`), falls
# back to magick (ImageMagick: `brew install imagemagick`). On macOS
# qlmanage + sips is used as a last resort because it can render Apple
# Color Emoji inside the SVG <text> element via WebKit; rsvg-convert
# does not have an emoji color font and would render a tofu glyph.
#
# Maskable safe zone: ~10% inset on each side. icon.svg uses a 320px
# font on a 512 viewBox (~19% margin), so `purpose: maskable` works
# without a separate maskable asset.
#
# iOS Safari note: apple-touch-icon must be PNG; SVG is silently ignored
# and iOS falls back to a screenshot of the page. That's why this script
# exists at all.

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SVG="${ROOT}/apps/openape-free-idp/public/icon.svg"
OUT="${ROOT}/apps/openape-free-idp/public"

if [ ! -f "$SVG" ]; then
  echo "Source not found: $SVG" >&2
  exit 1
fi

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
  # Prefer qlmanage on Darwin so the gorilla emoji actually renders in
  # color. rsvg-convert/ImageMagick lack the Apple Color Emoji font.
  if [ "$(uname)" = "Darwin" ] && command -v qlmanage >/dev/null 2>&1 && command -v sips >/dev/null 2>&1; then
    ensure_ql_tmp
    sips -z "$size" "$size" "$QL_TMP/icon.svg.png" --out "$target" >/dev/null 2>&1
  elif command -v rsvg-convert >/dev/null 2>&1; then
    rsvg-convert -w "$size" -h "$size" "$SVG" -o "$target"
  elif command -v magick >/dev/null 2>&1; then
    magick -background none -density 384 "$SVG" -resize "${size}x${size}" "$target"
  elif command -v convert >/dev/null 2>&1; then
    convert -background none -density 384 "$SVG" -resize "${size}x${size}" "$target"
  else
    echo "No raster renderer available." >&2
    echo "Install one of:" >&2
    echo "  brew install librsvg          # rsvg-convert" >&2
    echo "  brew install imagemagick      # magick / convert" >&2
    echo "macOS users without Homebrew can rely on qlmanage + sips (Xcode CLT)." >&2
    exit 1
  fi
  echo "  ${target}"
}

echo "→ Rendering PWA icons from ${SVG}"
render 192 "${OUT}/icon-192.png"
render 512 "${OUT}/icon-512.png"
render 512 "${OUT}/icon-512-maskable.png"

echo
echo "✓ Done. Manifest in apps/openape-free-idp/nuxt.config.ts already"
echo "  references icon-192.png + icon-512.png + icon-512-maskable.png."
