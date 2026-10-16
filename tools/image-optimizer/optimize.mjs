#!/usr/bin/env node
/* =========================================================================
   HTCommander site — feature image optimizer

   The PNG screenshots in assets/features/ are the untouched originals. This
   script:
     1. Generates AVIF + WebP copies of each PNG at 640 px, 960 px and full
        width into assets/features/web/ (only when missing or out of date).
     2. Rewrites every <img> in the English pages (the pages listed in
        i18n/config.json) that points at assets/features/<Name>.png into a
        <picture data-opt> element with AVIF/WebP sources, keeping the PNG as
        the fallback and adding width/height.
     3. Adds "w", "h" and "widths" to the feature-gallery JSON entries so
        assets/js/main.js can build the same sources at runtime.

   Re-running is idempotent. Afterwards run `node tools/build-i18n.js` to
   regenerate the localized pages.

   An <img> written with data-src instead of src (the home-page slideshow)
   gets data-srcset on its sources so main.js can load it on demand.

   Run:  npm install && npm run build      (from tools/image-optimizer)
         npm run force                      (re-encode every image)
   ========================================================================= */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_DIR = path.join(ROOT, "assets", "features");
const OUT_DIR = path.join(SRC_DIR, "web");
const WIDTHS = [640, 960];
const FORMATS = [
  { ext: "avif", type: "image/avif", encode: s => s.avif({ quality: 60, effort: 6 }) },
  { ext: "webp", type: "image/webp", encode: s => s.webp({ quality: 85, alphaQuality: 90, effort: 6 }) },
];

// `sizes` used when an image has none yet; must match the CSS layout of each page.
const DEFAULT_SIZES = [
  { match: p => p === "index.html", sizes: "(max-width: 960px) calc(84vw - 40px), 520px" },
  { match: p => p === "features.html", sizes: "(max-width: 960px) calc(100vw - 48px), 542px" },
  { match: p => p.startsWith("features/"), sizes: "(max-width: 868px) calc(100vw - 48px), 820px" },
];
const FALLBACK_SIZES = "100vw";

const force = process.argv.includes("--force");

function widthsFor(width) {
  return WIDTHS.filter(w => w < width).concat(width);
}

function kb(bytes) {
  return (bytes / 1024).toFixed(0) + " KB";
}

/* ---------- 1. Image generation ---------- */

async function generate() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const info = new Map();
  const expected = new Set();
  const jobs = [];

  const sources = fs.readdirSync(SRC_DIR).filter(f => /\.png$/i.test(f)).sort();
  for (const file of sources) {
    const src = path.join(SRC_DIR, file);
    const name = file.replace(/\.png$/i, "");
    const { width, height } = await sharp(src).metadata();
    const widths = widthsFor(width);
    info.set(name, { width, height, widths, srcBytes: fs.statSync(src).size });

    const srcTime = fs.statSync(src).mtimeMs;
    for (const w of widths) {
      for (const fmt of FORMATS) {
        const outName = `${name}-${w}.${fmt.ext}`;
        const out = path.join(OUT_DIR, outName);
        expected.add(outName);
        if (!force && fs.existsSync(out) && fs.statSync(out).mtimeMs >= srcTime) continue;
        jobs.push({ src, out, w, full: w === width, fmt });
      }
    }
  }

  for (const f of fs.readdirSync(OUT_DIR)) {
    if (/\.(avif|webp)$/i.test(f) && !expected.has(f)) {
      fs.unlinkSync(path.join(OUT_DIR, f));
      console.log(`- removed stale ${f}`);
    }
  }

  let done = 0;
  const queue = jobs.slice();
  const worker = async () => {
    while (queue.length) {
      const job = queue.shift();
      let img = sharp(job.src);
      if (!job.full) img = img.resize({ width: job.w });
      const buf = await job.fmt.encode(img).toBuffer();
      fs.writeFileSync(job.out, buf);
      done++;
      console.log(`✓ [${done}/${jobs.length}] ${path.basename(job.out)}  ${kb(buf.length)}`);
    }
  };
  const parallel = Math.max(1, Math.min(4, os.cpus().length));
  await Promise.all(Array.from({ length: parallel }, worker));
  if (jobs.length === 0) console.log("Images are up to date.");

  return info;
}

/* ---------- 2. HTML rewriting ---------- */

function parseAttrs(tag) {
  const body = tag.replace(/^<img\b/i, "").replace(/\/?\s*>$/, "");
  const attrs = [];
  body.replace(/([^\s="]+)(?:\s*=\s*"([^"]*)")?/g, (m, name, value) => {
    attrs.push([name, value === undefined ? null : value]);
    return m;
  });
  return attrs;
}

const getAttr = (attrs, name) => { const a = attrs.find(x => x[0] === name); return a ? a[1] : undefined; };
const delAttr = (attrs, name) => { const i = attrs.findIndex(x => x[0] === name); if (i >= 0) attrs.splice(i, 1); };
const setAttr = (attrs, name, value) => {
  const a = attrs.find(x => x[0] === name);
  if (a) a[1] = value; else attrs.push([name, value]);
};
const renderImg = attrs =>
  "<img " + attrs.map(([n, v]) => (v == null ? n : `${n}="${v}"`)).join(" ") + " />";

function defaultSizes(page) {
  const rule = DEFAULT_SIZES.find(r => r.match(page));
  return rule ? rule.sizes : FALLBACK_SIZES;
}

function rewriteImage(block, page, info, stats) {
  const isPicture = block.startsWith("<picture");
  const imgTag = isPicture ? (block.match(/<img\b[^>]*>/) || [])[0] : block;
  if (!imgTag) return block;

  const attrs = parseAttrs(imgTag);
  const deferred = getAttr(attrs, "data-src") != null;
  const src = getAttr(attrs, deferred ? "data-src" : "src");
  const m = src && src.match(/^(.*?)assets\/features\/([^/"]+)\.png$/);
  if (!m) return block;
  const [, prefix, name] = m;
  const meta = info.get(name);
  if (!meta) {
    console.warn(`! ${page}: no source image for ${src}`);
    return block;
  }

  // The first <source> carries the sizes once converted; a bare <img> may carry its own.
  const existingSizes = isPicture ? (block.match(/<source\b[^>]*\bsizes="([^"]*)"/) || [])[1] : undefined;
  const sizes = existingSizes || getAttr(attrs, "sizes") || defaultSizes(page);
  delAttr(attrs, "sizes");
  delAttr(attrs, "srcset");
  setAttr(attrs, "width", String(meta.width));
  setAttr(attrs, "height", String(meta.height));

  const srcsetAttr = deferred ? "data-srcset" : "srcset";
  const sources = FORMATS.map(fmt => {
    const srcset = meta.widths
      .map(w => `${prefix}assets/features/web/${name}-${w}.${fmt.ext} ${w}w`)
      .join(", ");
    return `<source type="${fmt.type}" ${srcsetAttr}="${srcset}" sizes="${sizes}" />`;
  }).join("");

  stats.images++;
  return `<picture data-opt>${sources}${renderImg(attrs)}</picture>`;
}

function rewriteGalleryJson(html, info, stats) {
  return html.replace(
    /("img":\s*"[^"]*?assets\/features\/([^"/]+)\.png")(?:,\s*"w":\s*\d+,\s*"h":\s*\d+,\s*"widths":\s*\[[^\]]*\])?/g,
    (m, head, name) => {
      const meta = info.get(name);
      if (!meta) return m;
      stats.json++;
      return `${head}, "w": ${meta.width}, "h": ${meta.height}, "widths": [${meta.widths.join(", ")}]`;
    }
  );
}

function rewritePages(info) {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "i18n", "config.json"), "utf8"));
  let changed = 0;
  for (const page of config.pages) {
    const file = path.join(ROOT, page);
    if (!fs.existsSync(file)) continue;
    const before = fs.readFileSync(file, "utf8");
    const stats = { images: 0, json: 0 };
    let html = before.replace(/<picture data-opt>[\s\S]*?<\/picture>|<img\b[^>]*>/g,
      block => rewriteImage(block, page, info, stats));
    html = rewriteGalleryJson(html, info, stats);
    if (html !== before) {
      fs.writeFileSync(file, html, "utf8");
      changed++;
      console.log(`✓ ${page}: ${stats.images} image(s), ${stats.json} gallery entr${stats.json === 1 ? "y" : "ies"}`);
    }
  }
  console.log(changed ? `${changed} page(s) updated.` : "Pages are up to date.");
}

/* ---------- Main ---------- */

const info = await generate();
rewritePages(info);

let srcTotal = 0;
const outTotals = {};
for (const [name, meta] of info) {
  srcTotal += meta.srcBytes;
  for (const w of meta.widths) {
    for (const fmt of FORMATS) {
      const key = `${fmt.ext} @${w === meta.width ? "full" : w}`;
      outTotals[key] = (outTotals[key] || 0) + fs.statSync(path.join(OUT_DIR, `${name}-${w}.${fmt.ext}`)).size;
    }
  }
}
console.log(`\nOriginal PNGs: ${kb(srcTotal)}`);
for (const [key, bytes] of Object.entries(outTotals)) {
  console.log(`  ${key.padEnd(10)} ${kb(bytes).padStart(9)}  (${((100 * bytes) / srcTotal).toFixed(0)}%)`);
}
console.log("\nNext: node tools/build-i18n.js");
