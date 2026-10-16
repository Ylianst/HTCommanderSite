#!/usr/bin/env node
/* =========================================================================
   HTCommander site — image optimizer

   The PNG/JPEG files in the folders listed in SETS are the untouched
   originals. This script:
     1. Generates AVIF + WebP copies of each image, at the widths configured
        for its folder, into <folder>/web/ (only when missing or out of date).
     2. Rewrites every <img> pointing at one of those originals, in the
        English pages listed in i18n/config.json and in the blog posts
        (blogs/*.html), into a <picture data-opt> element with AVIF/WebP
        sources, keeping the original as the fallback and adding width/height.
     3. Adds "w", "h" and "widths" to "img" entries of inline JSON data (the
        feature gallery) so assets/js/main.js can build the same sources.

   Re-running is idempotent. Afterwards run `node tools/build-i18n.js` to
   regenerate the localized pages. Re-run this after rebuilding the blog.

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
const FORMATS = [
  { ext: "avif", type: "image/avif", encode: s => s.avif({ quality: 60, effort: 6 }) },
  { ext: "webp", type: "image/webp", encode: s => s.webp({ quality: 85, alphaQuality: 90, effort: 6 }) },
];

/* Image folders. `widths` are the downscaled renditions; the largest
   rendition is the original width capped at `maxWidth` (about 2x the largest
   on-screen size). `sizes(page)` must match the CSS layout. */
const SETS = [
  {
    dirs: ["assets/features"],
    widths: [640, 960],
    maxWidth: Infinity,
    sizes: page =>
      page === "index.html" ? "(max-width: 960px) calc(84vw - 40px), 520px"
      : page === "features.html" ? "(max-width: 960px) calc(100vw - 48px), 542px"
      : page.startsWith("features/") ? "(max-width: 868px) calc(100vw - 48px), 820px"
      : "100vw",
  },
  {
    // Screens page, 3-column grid (shown at most ~420 px wide).
    dirs: ["assets/img/windows", "assets/img/macos", "assets/img/ipad"],
    widths: [480],
    maxWidth: 960,
    sizes: () => "(max-width: 560px) calc(100vw - 143px), (max-width: 960px) calc(50vw - 121px), (max-width: 1200px) calc(33.3vw - 113px), 285px",
  },
  {
    // Screens page, 4-column grid of phone screenshots (at most ~210 px wide).
    dirs: ["assets/img/android", "assets/img/iphone"],
    widths: [240],
    maxWidth: 480,
    sizes: () => "(max-width: 560px) calc(50vw - 121px), (max-width: 960px) calc(33.3vw - 113px), (max-width: 1200px) calc(25vw - 109px), 190px",
  },
  {
    dirs: ["assets/img/radios"],
    widths: [300],
    maxWidth: 700,
    sizes: () => "300px",
  },
  {
    dirs: ["blogs/images"],
    widths: [640, 960],
    maxWidth: 1640,
    sizes: () => "(max-width: 868px) calc(100vw - 63px), 820px",
  },
];

const force = process.argv.includes("--force");
const kb = bytes => (bytes / 1024).toFixed(0) + " KB";

function renditionWidths(set, width) {
  const top = Math.min(width, set.maxWidth);
  return set.widths.filter(w => w < top).concat(top);
}

function setForDir(dir) {
  return SETS.find(s => s.dirs.includes(dir));
}

/* ---------- 1. Image generation ---------- */

async function generate() {
  const info = new Map(); // "dir/Name" -> { set, width, height, widths, srcBytes, outDir, name }
  const jobs = [];

  for (const set of SETS) {
    for (const dir of set.dirs) {
      const srcDir = path.join(ROOT, dir);
      if (!fs.existsSync(srcDir)) continue;
      const outDir = path.join(srcDir, "web");
      fs.mkdirSync(outDir, { recursive: true });
      const expected = new Set();

      const sources = fs.readdirSync(srcDir).filter(f => /\.(png|jpe?g)$/i.test(f)).sort();
      for (const file of sources) {
        const src = path.join(srcDir, file);
        const name = file.replace(/\.(png|jpe?g)$/i, "");
        const key = `${dir}/${name}`;
        if (info.has(key)) {
          console.warn(`! ${dir}: ${file} collides with another image named "${name}", skipped`);
          continue;
        }
        const { width, height } = await sharp(src).metadata();
        const widths = renditionWidths(set, width);
        const stat = fs.statSync(src);
        info.set(key, { set, width, height, widths, srcBytes: stat.size, outDir, name });

        for (const w of widths) {
          for (const fmt of FORMATS) {
            const outName = `${name}-${w}.${fmt.ext}`;
            const out = path.join(outDir, outName);
            expected.add(outName);
            if (!force && fs.existsSync(out) && fs.statSync(out).mtimeMs >= stat.mtimeMs) continue;
            jobs.push({ src, out, w, resize: w !== width, fmt });
          }
        }
      }

      for (const f of fs.readdirSync(outDir)) {
        if (/\.(avif|webp)$/i.test(f) && !expected.has(f)) {
          fs.unlinkSync(path.join(outDir, f));
          console.log(`- removed stale ${dir}/web/${f}`);
        }
      }
    }
  }

  let done = 0;
  const queue = jobs.slice();
  const worker = async () => {
    while (queue.length) {
      const job = queue.shift();
      let img = sharp(job.src);
      if (job.resize) img = img.resize({ width: job.w });
      const buf = await job.fmt.encode(img).toBuffer();
      fs.writeFileSync(job.out, buf);
      done++;
      console.log(`✓ [${done}/${jobs.length}] ${path.relative(ROOT, job.out).replace(/\\/g, "/")}  ${kb(buf.length)}`);
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

/* Map an image URL used on `page` to its info entry, or null. */
function lookup(url, page, info) {
  if (!url || /^(https?:|data:|\/\/)/.test(url)) return null;
  const m = url.match(/^(.*\/)?([^/]+)\.(png|jpe?g)$/i);
  if (!m) return null;
  const pageDir = path.posix.dirname(page);
  const dir = path.posix.dirname(path.posix.normalize(path.posix.join(pageDir, url)));
  if (!setForDir(dir)) return null;
  const meta = info.get(`${dir}/${m[2]}`);
  if (!meta) {
    console.warn(`! ${page}: no source image for ${url}`);
    return null;
  }
  return { meta, webBase: `${m[1] || ""}web/${m[2]}` };
}

function rewriteImage(block, page, info, stats) {
  const imgTag = block.startsWith("<picture") ? (block.match(/<img\b[^>]*>/) || [])[0] : block;
  if (!imgTag) return block;

  const attrs = parseAttrs(imgTag);
  const deferred = getAttr(attrs, "data-src") != null;
  const hit = lookup(getAttr(attrs, deferred ? "data-src" : "src"), page, info);
  if (!hit) return block;
  const { meta, webBase } = hit;

  // A sizes attribute on the <img> is a per-image override and is kept there.
  const sizes = getAttr(attrs, "sizes") || meta.set.sizes(page);
  delAttr(attrs, "srcset");
  setAttr(attrs, "width", String(meta.width));
  setAttr(attrs, "height", String(meta.height));

  const srcsetAttr = deferred ? "data-srcset" : "srcset";
  const sources = FORMATS.map(fmt => {
    const srcset = meta.widths.map(w => `${webBase}-${w}.${fmt.ext} ${w}w`).join(", ");
    return `<source type="${fmt.type}" ${srcsetAttr}="${srcset}" sizes="${sizes}" />`;
  }).join("");

  stats.images++;
  return `<picture data-opt>${sources}${renderImg(attrs)}</picture>`;
}

function rewriteJson(html, page, info, stats) {
  return html.replace(
    /("img":\s*"([^"]+)")(?:,\s*"w":\s*\d+,\s*"h":\s*\d+,\s*"widths":\s*\[[^\]]*\])?/g,
    (m, head, url) => {
      const hit = lookup(url, page, info);
      if (!hit) return m;
      stats.json++;
      return `${head}, "w": ${hit.meta.width}, "h": ${hit.meta.height}, "widths": [${hit.meta.widths.join(", ")}]`;
    }
  );
}

function pagesToRewrite() {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "i18n", "config.json"), "utf8"));
  const blogDir = path.join(ROOT, "blogs");
  const blogs = fs.existsSync(blogDir)
    ? fs.readdirSync(blogDir).filter(f => f.endsWith(".html")).sort().map(f => `blogs/${f}`)
    : [];
  return [...config.pages, ...blogs];
}

function rewritePages(info) {
  let changed = 0;
  for (const page of pagesToRewrite()) {
    const file = path.join(ROOT, page);
    if (!fs.existsSync(file)) continue;
    const before = fs.readFileSync(file, "utf8");
    const stats = { images: 0, json: 0 };
    let html = before.replace(/<picture data-opt>[\s\S]*?<\/picture>|<img\b[^>]*>/g,
      block => rewriteImage(block, page, info, stats));
    html = rewriteJson(html, page, info, stats);
    if (html !== before) {
      fs.writeFileSync(file, html, "utf8");
      changed++;
      console.log(`✓ ${page}: ${stats.images} image(s), ${stats.json} JSON entr${stats.json === 1 ? "y" : "ies"}`);
    }
  }
  console.log(changed ? `${changed} page(s) updated.` : "Pages are up to date.");
}

/* ---------- Main ---------- */

const info = await generate();
rewritePages(info);

const totals = new Map(); // folder -> bytes of originals and of the smallest rendition per format
for (const meta of info.values()) {
  const folder = path.relative(ROOT, path.dirname(meta.outDir)).replace(/\\/g, "/");
  const t = totals.get(folder) || { src: 0, avif: 0, webp: 0 };
  t.src += meta.srcBytes;
  for (const fmt of FORMATS) {
    t[fmt.ext] += fs.statSync(path.join(meta.outDir, `${meta.name}-${meta.widths[0]}.${fmt.ext}`)).size;
  }
  totals.set(folder, t);
}
console.log("\nOriginals vs. smallest rendition (all images per folder):");
for (const [folder, t] of totals) {
  console.log(`  ${folder.padEnd(22)} ${kb(t.src).padStart(9)}  ->  avif ${kb(t.avif).padStart(7)}  webp ${kb(t.webp).padStart(7)}`);
}
console.log("\nNext: node tools/build-i18n.js");
