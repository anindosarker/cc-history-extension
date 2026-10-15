#!/usr/bin/env sh
# Derives the 720p mp4 and the GIF preview from out/intro.mp4, then copies the
# 1080p mp4 and the GIF to ../media/. Requires ffmpeg on the PATH.
set -eu
cd "$(dirname "$0")/.."

ffmpeg -y -v error -i out/intro.mp4 \
  -vf "scale=1280:720:flags=lanczos" \
  -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -movflags +faststart \
  out/intro-720.mp4

# Two-pass palette GIF: 12 fps, 800 px wide. If it lands above 10 MB, it is
# regenerated with only the first 20 seconds so the README stays light.
GIF_FILTERS="fps=12,scale=800:-1:flags=lanczos"
make_gif() {
  ffmpeg -y -v error $1 -i out/intro.mp4 \
    -vf "$GIF_FILTERS,palettegen=stats_mode=diff" out/palette.png
  ffmpeg -y -v error $1 -i out/intro.mp4 -i out/palette.png \
    -lavfi "$GIF_FILTERS[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
    out/intro.gif
  rm -f out/palette.png
}
make_gif ""
if [ "$(stat -f %z out/intro.gif 2>/dev/null || stat -c %s out/intro.gif)" -gt 10485760 ]; then
  echo "GIF above 10 MB, capping to the first 20 seconds"
  make_gif "-t 20"
fi

cp out/intro.mp4 ../media/intro.mp4
cp out/intro.gif ../media/intro.gif
ls -la out/intro.mp4 out/intro-720.mp4 out/intro.gif
