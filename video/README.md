# Intro video

A short Remotion intro for the extension. Standalone project: it has its own
`package.json` and does not share dependencies with the extension.

The screenshots in `public/` are copies of `../media/screenshots/*.png` plus
`../media/icon@2x.png`. Copy them again after retaking screenshots.

## Commands

Install:

```sh
cd video && pnpm install
```

Preview in Remotion Studio:

```sh
pnpm preview
```

Render everything (1080p mp4, 720p mp4, GIF) and copy the mp4 and GIF to `../media/`:

```sh
pnpm render:all
```

Single steps: `pnpm render` (1080p, h264, crf 18) and `pnpm postprocess`
(`scripts/postprocess.sh`: 720p mp4, two-pass palette GIF at 12 fps and 800
wide, capped to the first 20 seconds when the full one is above 10 MB, then the
copies to `../media/`). Output lands in `out/`. The postprocess
step requires `ffmpeg` on the PATH.

Preview frames for a quick layout check:

```sh
for t in 1.5 5.5 10.5 14.3 18.3 22.5 26; do ffmpeg -y -ss $t -i out/intro.mp4 -frames:v 1 out/preview-${t}s.png; done
```
