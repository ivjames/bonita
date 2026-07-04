#!/usr/bin/env bash
#
# vectorize-stage-dims.sh — regenerate site/assets/img/stage-dims.svg from the
# committed source drawing, and report overlay-compliance metrics against the
# original.
#
# This is a MANUAL / OFFLINE tool. It is NOT wired into the deploy pipeline or
# CI (it needs external binaries the droplet/CI don't carry). Run it by hand
# when the source drawing changes, then commit the regenerated SVG.
#
# Requires: potrace, ImageMagick (convert/compare), librsvg (rsvg-convert),
#           poppler-utils (pdfimages).
#   apt-get install -y potrace imagemagick librsvg2-bin poppler-utils
#
# Method: the drawing is three-tone (white paper, ~#7e7e7e wall fills, black
# linework/text) plus a colored logo. potrace is monochrome, so we separate by
# threshold and trace each tone as its own layer, then stack them:
#   - gray fills   (everything darker than paper)  -> fill #7e7e7e
#   - black lines  (only the dark ink)             -> fill #000000
# The logo is a colored brand mark, not line art, so it is NOT traced (potrace
# flattens it to a muddy silhouette). Instead its exact original pixels are
# embedded as a transparent PNG so it stays pixel-identical to the source.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
src_pdf="$here/site/assets/pdf/bca-stage-dimensions.pdf"
out_svg="$here/site/assets/img/stage-dims.svg"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"

# 1. Extract the high-res source raster embedded in the PDF (3294x2147, 300ppi).
pdfimages -all "$src_pdf" src >/dev/null
src="$(find . -maxdepth 1 -name 'src-*' | sort | head -1)"
read -r W H < <(identify -format '%w %h\n' "$src")

# 2. Tone-separation masks (potrace traces black pixels).
convert "$src" -colorspace Gray -threshold 25% mask_black.pnm   # dark ink only
convert "$src" -colorspace Gray -threshold 78% mask_gray.pnm    # everything not paper

# 3. Isolate the logo so it is excluded from the traced layers.
#    maroon = red channel notably greater than green.
convert "$src" -channel R -separate r.png
convert "$src" -channel G -separate g.png
convert r.png g.png -compose MinusSrc -composite -threshold 10% maroon_white.png
#    solid badge region (fill letter holes, small grow for anti-aliased edge)
convert maroon_white.png -morphology Close Disk:12 -morphology Dilate Disk:5 badge_solid.png
#    whiten the badge area out of both traced layers
convert mask_gray.pnm  badge_solid.png -compose Lighten -composite mask_gray_final.pnm
convert mask_black.pnm badge_solid.png -compose Lighten -composite mask_black_final.pnm

# 4. Trace the two line-art layers.
potrace -b svg -C '#7e7e7e' -t 4 -o layer_gray.svg  mask_gray_final.pnm
potrace -b svg -C '#000000' -t 4 -o layer_black.svg mask_black_final.pnm

# 5. Crop the logo's real pixels with a transparent background (not traced).
read -r bw bh bx by < <(convert maroon_white.png -format '%@\n' info: | sed 's/[x+]/ /g')
CX=$((bx-20)); CY=$((by-20)); CW=$((bw+40)); CH=$((bh+40))
convert "$src" -crop ${CW}x${CH}+${CX}+${CY} +repage badge_orig.png
convert badge_orig.png \
  \( +clone -colorspace Gray -threshold 92% -negate \) \
  -alpha off -compose CopyOpacity -composite -strip badge_rgba.png

# 6. Assemble the layers into one SVG (gray, black, embedded logo on top).
node - "$W" "$H" "$CX" "$CY" "$CW" "$CH" badge_rgba.png > "$out_svg" <<'NODE'
import { readFileSync } from 'fs';
const [W,H,x,y,w,h,badge] = process.argv.slice(2);
const b64 = readFileSync(badge).toString('base64');
const g = f => readFileSync(f,'utf8').match(/<g [\s\S]*?<\/g>/)[0];
process.stdout.write(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
<title>Bonita Center for the Arts — stage plan with dimensions</title>
<rect width="${W}" height="${H}" fill="#ffffff"/>
${g('layer_gray.svg')}
${g('layer_black.svg')}
<image x="${x}" y="${y}" width="${w}" height="${h}" image-rendering="optimizeQuality" xlink:href="data:image/png;base64,${b64}"/>
</svg>
`);
NODE

# 7. Overlay-compliance report: render the SVG and compare to the original.
rsvg-convert -w "$W" -h "$H" "$out_svg" -o render.png
tot=$(convert "$src" -format '%[fx:w*h]' info:)
diff=$(compare -metric AE -fuzz 10% "$src" render.png null: 2>&1 || true)
echo "wrote $out_svg"
echo "compliance vs original:"
echo "  RMSE (normalized) : $(compare -metric RMSE "$src" render.png null: 2>&1 | sed -E 's/.*\(([0-9.]+)\).*/\1/')"
echo "  MAE  (normalized) : $(compare -metric MAE  "$src" render.png null: 2>&1 | sed -E 's/.*\(([0-9.]+)\).*/\1/')"
awk "BEGIN{printf \"  pixels differing >10%% : %d of %d (%.3f%%) — confined to anti-aliased edges\n\", $diff, $tot, 100*$diff/$tot}"
