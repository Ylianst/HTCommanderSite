# Image optimizer

Makes the feature screenshots in `assets/features/` fast to load without
touching the original PNGs.

The originals are large, lossless PNGs (about 15 MB in total) with transparent
backgrounds and soft drop shadows. This tool encodes AVIF and WebP copies, both
of which keep the transparency, and points the pages at them:

| Rendition | Size vs. original PNGs |
| --- | --- |
| AVIF 640 px | ~4% |
| AVIF 960 px | ~7% |
| AVIF full width | ~10% |
| WebP 640 / 960 / full | ~6% / 11% / 15% |

The browser picks the format (AVIF → WebP → original PNG) and the width that
fits the layout and the screen's pixel density. High-DPI screens get the
full-width file, normal screens usually get the 640 or 960 px one.

## Setup (once)

```bash
cd tools/image-optimizer
npm install
```

## Build / rebuild

```bash
npm run build        # only re-encodes images that are new or changed
npm run force        # re-encode everything (e.g. after changing quality)
node ../build-i18n.js   # then regenerate the localized pages
```

Run this any time a PNG in `assets/features/` is **added, replaced or removed**.
It will:

1. Write `assets/features/web/<Name>-640|960|<full>.avif|webp` (and delete
   renditions whose source PNG is gone).
2. Rewrite every `<img src=".../assets/features/<Name>.png">` in the English
   pages listed in `i18n/config.json` into:

   ```html
   <picture data-opt>
     <source type="image/avif" srcset="…-640.avif 640w, …-960.avif 960w, …-1319.avif 1319w" sizes="…" />
     <source type="image/webp" srcset="…" sizes="…" />
     <img src="assets/features/Name.png" alt="…" width="1319" height="974" />
   </picture>
   ```

   Already-converted `<picture data-opt>` blocks are regenerated in place, so
   the tool is idempotent and picks up new image dimensions.
3. Add `"w"`, `"h"` and `"widths"` to the `"img"` entries of the feature
   gallery's JSON so `assets/js/main.js` can build the same sources.

## Adding a feature image to a page

Just write a plain `<img src="assets/features/MyFeature.png" alt="…" />` and
run the tool. Optional:

- `sizes="…"` on the `<img>` sets the layout hint; it's moved onto the
  `<source>` elements and kept on re-runs. Without it the per-page default in
  `DEFAULT_SIZES` (`optimize.mjs`) is used.
- `data-src` instead of `src` marks the image as **deferred**: the sources get
  `data-srcset` and nothing is downloaded until script copies them back. The
  home-page slideshow uses this so only the visible and the next slide load.

## Settings

Widths, encoder quality and the per-page `sizes` defaults are constants at the
top of `optimize.mjs`. AVIF uses quality 60 and WebP quality 85. At those
settings the screenshots look the same as the originals.
