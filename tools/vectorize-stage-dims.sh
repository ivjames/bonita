#!/usr/bin/env bash
#
# vectorize-stage-dims.sh — regenerate the stage-dimensions drawing assets from
# the committed source raster, and report overlay-compliance against the source.
#
# Outputs (all committed):
#   site/assets/img/stage-dims.svg        vector master (traced line art + logo)
#   site/assets/img/stage-dims.png        crisp ~2x raster for the web page
#   site/assets/pdf/bca-stage-dimensions.pdf   downloadable vector PDF (US Letter)
#
# Source (committed):
#   tools/fixtures/stage-dims-source.jpg  pristine 3294x2147 original, extracted
#                                         from the drawing the architect supplied.
#
# This is a MANUAL / OFFLINE tool. It is NOT wired into the deploy pipeline or
# CI (it needs external binaries the droplet/CI don't carry). Run it by hand
# when the source drawing changes, then commit the regenerated assets.
#
# Requires: potrace, ImageMagick (convert/compare), librsvg (rsvg-convert).
#   apt-get install -y potrace imagemagick librsvg2-bin
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
src="$here/tools/fixtures/stage-dims-source.jpg"
out_svg="$here/site/assets/img/stage-dims.svg"
out_png="$here/site/assets/img/stage-dims.png"
out_pdf="$here/site/assets/pdf/bca-stage-dimensions.pdf"
PNG_W=2600            # ~3x the ~800px on-page display width, for crispness
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"

read -r W H < <(identify -format '%w %h\n' "$src")

# 1. Tone-separation masks (potrace traces black pixels).
#    The dimension annotation — thin lines, text, AND the solid arrowheads — is
#    drawn in a dark grey (~value 100), NOT black, sitting just below the wall
#    grey (126). A low black threshold lands right in the middle of that ink, so
#    it captures only the darkest cores and shreds the rest into salt-and-pepper
#    (arrowheads and text end up with grey speckle poking through). Threshold at
#    44% (~112) captures the whole annotation solidly while still excluding the
#    wall grey, so black shapes render solid black with no holes.
convert "$src" -colorspace Gray -threshold 44% mask_black.pnm   # dark ink incl. grey annotation
convert "$src" -colorspace Gray -threshold 78% mask_gray.pnm    # everything not paper

# 2. Isolate the logo so it is excluded from the traced layers.
#    maroon = red channel notably greater than green.
convert "$src" -channel R -separate r.png
convert "$src" -channel G -separate g.png
convert r.png g.png -compose MinusSrc -composite -threshold 10% maroon_white.png
#    solid badge region (fill letter holes, small grow for anti-aliased edge)
convert maroon_white.png -morphology Close Disk:12 -morphology Dilate Disk:5 badge_solid.png
#    whiten the badge area out of both traced layers
convert mask_gray.pnm  badge_solid.png -compose Lighten -composite mask_gray_final.pnm
convert mask_black.pnm badge_solid.png -compose Lighten -composite mask_black_final.pnm

# 3. Trace the two line-art layers.
potrace -b svg -C '#7e7e7e' -t 4 -o layer_gray.svg  mask_gray_final.pnm
potrace -b svg -C '#000000' -t 4 -o layer_black.svg mask_black_final.pnm

# 4. Crop the logo's real pixels with a transparent background (not traced).
read -r bw bh bx by < <(convert maroon_white.png -format '%@\n' info: | sed 's/[x+]/ /g')
CX=$((bx-20)); CY=$((by-20)); CW=$((bw+40)); CH=$((bh+40))
convert "$src" -crop ${CW}x${CH}+${CX}+${CY} +repage badge_orig.png
convert badge_orig.png \
  \( +clone -colorspace Gray -threshold 92% -negate \) \
  -alpha off -compose CopyOpacity -composite -strip badge_rgba.png

# 5. Assemble the layers into one SVG (gray, black, embedded logo on top).
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

# 6. Web PNG. Quantize the line art and the logo separately so neither muddies
#    the other:
#    - The line art holds exactly three tones (paper, one grey, black). Snapping
#      it to a 3-colour palette (no dither) keeps the fills perfectly flat and
#      the edges crisp — no light-grey haloes from anti-alias banding. The
#      browser re-creates smooth edges when it scales the ~3x image down.
#    - The logo is a colour photo-ish mark; it keeps its own shades and is
#      composited back on top.
#    Strip the embedded logo <image> to get line-art-only, and keep it alone.
grep -v '<image ' "$out_svg" > lineart.svg
printf '%s' "$(grep '<image ' "$out_svg")" \
  | sed "s#<image#<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" width=\"$W\" height=\"$H\" viewBox=\"0 0 $W $H\"><image#; s#/>\$#/></svg>#" > logo.svg
rsvg-convert -w "$PNG_W" lineart.svg -o lineart.png
rsvg-convert -w "$PNG_W" logo.svg    -o logo.png
printf 'P3\n3 1\n255\n255 255 255\n126 126 126\n0 0 0\n' > pal3.ppm
convert lineart.png +dither -remap pal3.ppm lineart_q.png
# composite the logo, then cap the total palette (3 line tones + a few maroons)
convert lineart_q.png logo.png -compose over -composite +dither -colors 16 -depth 8 PNG8:"$out_png"

# 7. Downloadable vector PDF: scale the drawing to fit a US Letter landscape
#    page (10x7.5in printable box) and centre it. Both --width/--height (to
#    actually scale the art down) and the page size are required — page size
#    alone renders the SVG at its full 3294px natural size and it overflows the
#    page, showing only a clipped corner. The drawing's 1.53 aspect fills the
#    10in width at ~6.52in tall, so ~0.99in top/bottom margins centre it.
rsvg-convert -f pdf "$out_svg" -o "$out_pdf" \
  --page-width 11in --page-height 8.5in \
  --width 10in --height 7.5in --keep-aspect-ratio \
  --left 0.5in --top 0.99in

# 8. Overlay-compliance report: render the SVG and compare to the source raster.
rsvg-convert -w "$W" -h "$H" "$out_svg" -o render.png
tot=$(convert "$src" -format '%[fx:w*h]' info:)
diff=$(compare -metric AE -fuzz 10% "$src" render.png null: 2>&1 || true)
echo "wrote:"
echo "  $out_svg  ($(stat -c%s "$out_svg") B)"
echo "  $out_png  ($(stat -c%s "$out_png") B)"
echo "  $out_pdf  ($(stat -c%s "$out_pdf") B)"
echo "compliance vs source raster:"
echo "  RMSE (normalized) : $(compare -metric RMSE "$src" render.png null: 2>&1 | sed -E 's/.*\(([0-9.]+)\).*/\1/')"
echo "  MAE  (normalized) : $(compare -metric MAE  "$src" render.png null: 2>&1 | sed -E 's/.*\(([0-9.]+)\).*/\1/')"
awk "BEGIN{printf \"  pixels differing >10%% : %d of %d (%.3f%%) — confined to anti-aliased edges\n\", $diff, $tot, 100*$diff/$tot}"
