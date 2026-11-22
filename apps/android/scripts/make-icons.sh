#!/usr/bin/env bash
#
# Regenerates the Android launcher icons from the web app's icons, so the two
# can never drift apart: change `apps/web/public/icons/*` and run this.
#
#   apps/android/scripts/make-icons.sh
#
# Needs ImageMagick (`convert`). The generated PNGs are committed, so CI and
# anyone just building the app do not.
#
# Android wants two things from an icon:
#
#  - Adaptive (API 26+): a 108dp square of which only the middle 72dp is
#    guaranteed to show, because the launcher masks it to a circle, squircle or
#    whatever the device uses. A *foreground* glyph on a transparent layer plus a
#    flat *background* colour lets it do that without cropping the keys. The web
#    app's maskable icon is already designed for this (its glyph sits inside the
#    safe zone), so the foreground is that icon with its ground made transparent.
#  - Legacy (API 24-25, and launchers that ignore adaptive icons): finished
#    square and round bitmaps at five densities.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
icons="$here/../../web/public/icons"
res="$here/../android/app/src/main/res"

command -v convert >/dev/null || { echo "ImageMagick (convert) is required" >&2; exit 1; }

# The ground colour, read off the icon rather than restated here. ImageMagick
# reports RGBA (eight digits); Android's `#AARRGGBB` would read the trailing FF as
# blue, so keep the six that are the colour.
ground="$(convert "$icons/icon-maskable-512.png" -format '%[hex:p{4,4}]' info:)"
ground="${ground:0:6}"
echo "ground colour #$ground"

# density: launcher px (48dp), foreground px (108dp)
for spec in mdpi:48:108 hdpi:72:162 xhdpi:96:216 xxhdpi:144:324 xxxhdpi:192:432; do
  IFS=: read -r density launcher foreground <<<"$spec"
  dir="$res/mipmap-$density"
  mkdir -p "$dir"

  # Foreground glyph, ground removed. The edges are axis-aligned rectangles, so a
  # small fuzz removes the ground without eating into the keys.
  convert "$icons/icon-maskable-512.png" -fuzz 2% -transparent "#$ground" \
    -filter Lanczos -resize "${foreground}x${foreground}" "$dir/ic_launcher_foreground.png"

  # Legacy square: the finished rounded icon.
  convert "$icons/icon-512.png" -filter Lanczos -resize "${launcher}x${launcher}" \
    "$dir/ic_launcher.png"

  # Legacy round: the full-bleed icon cut to a circle.
  half=$(( launcher / 2 ))
  convert "$icons/icon-maskable-512.png" -filter Lanczos -resize "${launcher}x${launcher}" \
    \( -size "${launcher}x${launcher}" xc:black -fill white \
       -draw "circle ${half},${half} ${half},0" \) \
    -alpha off -compose copy_opacity -composite "$dir/ic_launcher_round.png"
done

cat > "$res/values/ic_launcher_background.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#${ground^^}</color>
</resources>
XML

echo "wrote launcher icons to $res"
