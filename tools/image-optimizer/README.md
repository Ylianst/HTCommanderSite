# Image optimizer

Makes the site's screenshots and photos fast to load without touching the
originals.

The originals are large PNG/JPEG files, many with transparent backgrounds. This
tool encodes AVIF and WebP copies (both keep transparency) at the widths each
page actually needs, and points the pages at them. The browser picks the format
(AVIF → WebP → original) and the width that fits the layout and the screen's
pixel density.

| Folder | Used on | Renditions | Originals → smallest AVIF |
| --- | --- | --- | --- |
| `assets/features/` | Home slideshow, features, feature gallery, feature pages | 640, 960, full | 15.4 MB → 0.7 MB |
| `assets/img/{windows,macos,ipad}/` | Screens page (3-column grid) | 480, 960 | 17.6 MB → 0.3 MB |
| `assets/img/{android,iphone}/` | Screens page (phone grid) | 240, 480 | 8.6 MB → 0.15 MB |
| `assets/img/radios/` | Radios page | 300, full (≤700) | 0.5 MB → 0.06 MB |
| `blogs/images/` | Blog posts | 640, 960, full (≤1640) | 0.8 MB → 0.1 MB |

Each image folder gets a `web/` subfolder with the generated files. The folder
list, widths, encoder quality and the per-folder `sizes` hints are the `SETS`
and `FORMATS` constants at the top of `optimize.mjs`. AVIF uses quality 60 and
WebP quality 85. At those settings the images look the same as the originals.

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

Run this any time an image in one of those folders is **added, replaced or
removed**, and after rebuilding the blog with `tools/blog-builder`. It will:

1. Write `<folder>/web/<Name>-<width>.avif|webp` (and delete renditions whose
   source image is gone).
2. Rewrite every `<img>` pointing at one of those images, in the English pages
   listed in `i18n/config.json` and in `blogs/*.html`, into:

   ```html
   <picture data-opt>
     <source type="image/avif" srcset="…/web/Name-640.avif 640w, …/web/Name-960.avif 960w, …" sizes="…" />
     <source type="image/webp" srcset="…" sizes="…" />
     <img src="…/Name.png" alt="…" width="1319" height="974" />
   </picture>
   ```

   Already-converted `<picture data-opt>` blocks are regenerated in place, so
   the tool is idempotent and picks up new image sizes and `sizes` hints.
3. Add `"w"`, `"h"` and `"widths"` to `"img"` entries in inline JSON data (the
   feature gallery) so `assets/js/main.js` can build the same sources.

## Adding an image to a page

Just write a plain `<img src="assets/img/macos/new.png" alt="…" loading="lazy" />`
(any folder listed in `SETS`) and run the tool. Optional:

- `sizes="…"` on the `<img>` overrides the folder's default layout hint for
  that image. It stays on the `<img>` and is copied to the sources on every run.
- `data-src` instead of `src` marks the image as **deferred**: the sources get
  `data-srcset` and nothing is downloaded until script copies them back. The
  home-page slideshow uses this so only the visible and the next slide load.

To optimize a new folder, add it to `SETS` with widths up to about twice its
largest on-screen size and a `sizes` value that matches the CSS layout.
