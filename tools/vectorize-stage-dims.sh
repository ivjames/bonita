#!/usr/bin/env bash
#
# vectorize-stage-dims.sh — regenerate the stage-dimensions drawing assets from
# the committed source raster, and report overlay-compliance against the source.
#
# Outputs (all committed):
#   site/assets/img/stage-dims.svg        vector master (traced line art + text + logo)
#   site/assets/img/stage-dims.png        crisp ~3x raster for the web page
#   site/assets/pdf/bca-stage-dimensions.pdf   downloadable vector PDF (US Letter)
#
# Inputs (committed):
#   tools/fixtures/stage-dims-source.jpg  pristine 3294x2147 original, extracted
#                                         from the drawing the architect supplied.
#   site/assets/img/bca-logo.png          clean canonical brand badge.
#
# This is a MANUAL / OFFLINE tool. It is NOT wired into the deploy pipeline or
# CI (it needs external binaries the droplet/CI don't carry). Run it by hand
# when the source drawing changes, then commit the regenerated assets.
#
# Requires: potrace, ImageMagick (convert/compare), librsvg (rsvg-convert),
#           and the "Liberation Sans" font (fonts-liberation).
#
# Method — the drawing has, by pixel value: white paper (255), grey wall fills
# (~126), a dark-grey dimension annotation (~100: thin lines, text, arrowheads)
# and pure-black section lines. potrace is monochrome, so we threshold into two
# traced layers and stack them (grey fills under black linework). Two subtleties
# the thresholds have to respect:
#   - The annotation ink (~100) sits just BELOW the wall grey (126). A low black
#     threshold splits that ink down the middle and shreds it into speckle, so we
#     threshold black at 44% (~112) to catch the whole annotation solidly while
#     still excluding the walls.
#   - JPEG ringing along the high-contrast wall edges throws dark specks just
#     below that threshold ("boogers"). A slight pre-blur removes the ringing.
# Two things are NOT traced, because tracing a lossy JPEG of them looks rough:
#   - The dimension TEXT is re-set as real <text> (Liberation Sans) at measured
#     positions, and its pixels are knocked out of both traced layers.
#   - The LOGO uses the clean canonical badge (recoloured to the drawing's faded
#     rose) rather than the JPEG-artifacted copy baked into the drawing.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
src="$here/tools/fixtures/stage-dims-source.jpg"
logo_src="$here/site/assets/img/bca-logo.png"
out_svg="$here/site/assets/img/stage-dims.svg"
out_png="$here/site/assets/img/stage-dims.png"
out_pdf="$here/site/assets/pdf/bca-stage-dimensions.pdf"
PNG_W=2600            # ~3x the ~800px on-page display width, for crispness
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"

read -r W H < <(identify -format '%w %h\n' "$src")

# Dimension labels: text, anchor x, baseline y, and the knockout rectangle
# (kx,ky,kw,kh) covering the original traced glyphs. Positions measured (OCR)
# from the source. Numeric labels are centred on their knockout box so they sit
# in the gap the dimension line leaves for them; the SCALE note is left-aligned.
cat > labels.json <<'JSON'
[
 {"t":"11' 10 3/16\"","b":310,"kx":1558,"ky":272,"kw":232,"kh":52},
 {"t":"53' 7 1/2\"","b":556,"kx":1578,"ky":518,"kw":188,"kh":52},
 {"t":"SCALE: 1\" = 10' - 0\"","x":79,"b":598,"kx":72,"ky":560,"kw":382,"kh":52,"left":true},
 {"t":"49' 1 1/2\"","b":721,"kx":1565,"ky":683,"kw":190,"kh":52},
 {"t":"82' 1\"","b":919,"kx":1598,"ky":881,"kw":118,"kh":50},
 {"t":"75' 6\"","b":1099,"kx":1705,"ky":1061,"kw":118,"kh":50},
 {"t":"43' 2 3/4\"","b":1352,"kx":929,"ky":1314,"kw":190,"kh":52},
 {"t":"42' 4\"","b":1337,"kx":1291,"ky":1299,"kw":118,"kh":50},
 {"t":"40' 5 3/4\"","b":1396,"kx":2452,"ky":1358,"kw":190,"kh":52},
 {"t":"16' 4 1/2\"","b":1656,"kx":2611,"ky":1618,"kw":190,"kh":54},
 {"t":"5'","b":580,"kx":1126,"ky":543,"kw":48,"kh":48},
 {"t":"10'","b":1655,"kx":688,"ky":1617,"kw":82,"kh":48},
 {"t":"11' 11\"","b":2093,"kx":2566,"ky":2055,"kw":206,"kh":50}
]
JSON

# 1. Tone masks — NO blur/median/open. Any smoothing filter rounds the hard 90°
#    corners of the walls (filleting) and erodes the thin dimension lines, so we
#    threshold the raw grayscale and keep every corner and line exactly as-is.
convert "$src" -colorspace Gray -threshold 44% mask_black.pnm    # dark ink (annotation + wall outlines)
convert "$src" -colorspace Gray -threshold 78% mask_gray.pnm     # wall fills (+ everything darker)

# 2. Isolate the logo footprint (from the original faded badge) to knock the
#    traced layers out where the replacement logo goes.
convert "$src" -channel R -separate r.png
convert "$src" -channel G -separate g.png
convert r.png g.png -compose MinusSrc -composite -threshold 10% maroon_white.png
convert maroon_white.png -morphology Close Disk:12 -morphology Dilate Disk:5 badge_solid.png
read -r bw bh bx by < <(convert maroon_white.png -format '%@\n' info: | sed 's/[x+]/ /g')

# 3. Knock the logo footprint AND every text box out of both masks.
node -e '
const fs=require("fs");const L=require("./labels.json");const pad=4;
fs.writeFileSync("krects.txt", L.map(l=>`rectangle ${l.kx-pad},${l.ky-pad} ${l.kx+l.kw+pad},${l.ky+l.kh+pad}`).join(" "));
'
# The footlight scallops (a festoon of arcs on little stems rising from the wall)
# and the two dimension arrows in their band all trace badly from the JPEG, so
# the whole band is knocked out of the black mask and everything in it is redrawn
# cleanly at assembly (festoon arcs + stems + the two down-arrows).
# (the scallop lines are dark enough to land in BOTH masks, so knock the band
#  out of both — otherwise the grey layer re-draws the scallops underneath. The
#  grey knockout stops at y2027, just above the wall-fill top (y2028), so it
#  removes the scallops without trimming the wall the stems land on.)
scallop_knock_b="rectangle 1005,1955 2340,2030"
scallop_knock_g="rectangle 1005,1955 2340,2027"
convert mask_gray.pnm  badge_solid.png -compose Lighten -composite -fill white -draw "$(cat krects.txt)" -draw "$scallop_knock_g" mask_gray_final.pnm
convert mask_black.pnm badge_solid.png -compose Lighten -composite -fill white -draw "$(cat krects.txt)" -draw "$scallop_knock_b" mask_black_full.pnm

# 4. The gray wall FILLS trace perfectly clean, but the black WALL OUTLINES are
#    ragged (JPEG blocking on the slanted edges = "boogers"). So we don't trace
#    the wall outlines at all: instead the clean gray shapes get a crisp vector
#    stroke (added at assembly), and the black layer keeps only the annotation
#    that lives on white paper — dimension lines and arrowheads. Drop any black
#    ink within 5px of a gray fill (that's the wall outline); keep the rest.
convert mask_gray_final.pnm -negate -morphology Dilate Disk:5 gray_region_dil.png
convert mask_black_full.pnm -negate blackfg.png
convert blackfg.png gray_region_dil.png -compose MinusSrc -composite -negate mask_black_final.pnm

# 5. Trace the layers. The grey walls have hard 90° corners, so trace them with
#    -a 0 (polygonal, no smoothing) to keep those corners crisp. The black
#    annotation is dimension lines, arrowheads, and the curved footlight
#    scallops; trace it at max alphamax (4 clamps to potrace's 1.33) so JPEG
#    jaggies on the CURVES smooth out — sharp corners like arrowhead tips have
#    steep enough angles that they survive the smoothing, and straight lines
#    have no mid-run corners to round.
potrace -b svg -a 0 -C '#7e7e7e' -t 4 -o layer_gray.svg  mask_gray_final.pnm
potrace -b svg -a 4 -C '#000000' -t 4 -o layer_black.svg mask_black_final.pnm

# 6. Replacement logo: clean canonical badge recoloured to the drawing's faded
#    dusty-rose (brightness up, saturation down) so it matches but stays crisp.
convert "$logo_src" -modulate 200,48,100 logo_toned.png

# 7. Assemble the master SVG: grey wall fills (with a crisp stroke standing in
#    for the wall outlines), black annotation, logo, and real text.
node - "$W" "$H" "$bx" "$by" "$bw" "$bh" logo_toned.png > "$out_svg" <<'NODE'
import { readFileSync } from 'fs';
const [W,H,x,y,w,h,logo] = process.argv.slice(2);
const L = JSON.parse(readFileSync('labels.json','utf8'));
const b64 = readFileSync(logo).toString('base64');
const g = f => readFileSync(f,'utf8').match(/<g [\s\S]*?<\/g>/)[0];
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
// Stroke the clean gray shapes to draw the wall edges — a crisp ~2px black
// outline standing in for the drawing's poché lines (miter keeps 90° corners
// sharp). potrace wraps paths in scale(0.1), so stroke-width is 10x: 22 -> 2.2px.
const gray = g('layer_gray.svg').replace(/stroke="none"/, 'stroke="#1a1a1a" stroke-width="22" stroke-linejoin="miter"');
const texts = L.map(l => {
  const cx = l.left ? l.x : (l.kx + l.kw/2);
  const anchor = l.left ? '' : ' text-anchor="middle"';
  return `<text x="${cx}" y="${l.b}"${anchor} font-family="Liberation Sans, Arial, sans-serif" font-size="43" fill="#1a1a1a">${esc(l.t)}</text>`;
}).join('\n');
// Footlight scallops: drawn clean. Shallow arcs whose cusps sit on short stems
// rising from the wall top, plus the two dimension down-arrows in the band.
const F = {cusp:2014, x0:1025, xEnd:2318, n:10, ry:18, wall:2029};
const fp = (F.xEnd - F.x0)/F.n, frx = fp/2;
let fd = '';
for (let i=0;i<F.n;i++){ const a=F.x0+i*fp, b=a+fp; fd += `M ${a.toFixed(1)} ${F.cusp} A ${frx.toFixed(1)} ${F.ry} 0 0 1 ${b.toFixed(1)} ${F.cusp} `; }
for (let i=0;i<=F.n;i++){ const x=(F.x0+i*fp).toFixed(1); fd += `M ${x} ${F.cusp} L ${x} ${F.wall} `; }
const arrow = (x,baseY,tipY,hw) =>
  `<line x1="${x}" y1="1955" x2="${x}" y2="${baseY}" stroke="#1a1a1a" stroke-width="3"/>` +
  `<path d="M ${x-hw} ${baseY} L ${x+hw} ${baseY} L ${x} ${tipY} Z" fill="#1a1a1a"/>`;
const festoon = `<path d="${fd}" fill="none" stroke="#1a1a1a" stroke-width="2.5"/>` +
  arrow(1025,1993,2024,11) + arrow(1348,1964,1996,15);
process.stdout.write(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
<title>Bonita Center for the Arts — stage plan with dimensions</title>
<rect width="${W}" height="${H}" fill="#ffffff"/>
${gray}
${g('layer_black.svg')}
${festoon}
<image x="${x}" y="${y}" width="${w}" height="${h}" image-rendering="optimizeQuality" xlink:href="data:image/png;base64,${b64}"/>
${texts}
</svg>
`);
NODE

# 6. Web PNG. The line art + text hold three tones (paper, one grey, black);
#    snap them to a flat 3-colour palette (no dither) so fills stay clean and
#    edges crisp — the browser re-creates smooth edges scaling the ~3x image
#    down. The logo keeps its own shades and is composited back on top.
grep -v '<image ' "$out_svg" > lineart.svg
printf '%s' "$(grep '<image ' "$out_svg")" \
  | sed "s#<image#<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" width=\"$W\" height=\"$H\" viewBox=\"0 0 $W $H\"><image#; s#/>\$#/></svg>#" > logo.svg
rsvg-convert -w "$PNG_W" lineart.svg -o lineart.png
rsvg-convert -w "$PNG_W" logo.svg    -o logo.png
printf 'P3\n3 1\n255\n255 255 255\n126 126 126\n0 0 0\n' > pal3.ppm
convert lineart.png +dither -remap pal3.ppm lineart_q.png
convert lineart_q.png logo.png -compose over -composite +dither -colors 16 -depth 8 PNG8:"$out_png"

# 7. Downloadable vector PDF: scale the drawing to fit a US Letter landscape
#    page (10x7.5in printable box) and centre it. Both --width/--height (to
#    actually scale the art down) and the page size are required — page size
#    alone renders the SVG at its full natural size and it overflows the page,
#    showing only a clipped corner.
rsvg-convert -f pdf "$out_svg" -o "$out_pdf" \
  --page-width 11in --page-height 8.5in \
  --width 10in --height 7.5in --keep-aspect-ratio \
  --left 0.5in --top 0.99in

echo "wrote:"
echo "  $out_svg  ($(stat -c%s "$out_svg") B)"
echo "  $out_png  ($(stat -c%s "$out_png") B)"
echo "  $out_pdf  ($(stat -c%s "$out_pdf") B)"
