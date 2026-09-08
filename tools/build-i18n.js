#!/usr/bin/env node
/* =========================================================================
   HTCommander site — i18n static generator
   Produces the per-language folders (de/, es/, ...) from the English pages.

   For every page listed in i18n/config.json:
     1. Ensures the English page is "wired" (language switcher container,
        hreflang alternates, HT_PAGE config, i18n.js include) — written back
        in place so English stays the single source of content.
     2. For each non-English language, emits <lang>/<page> by:
        - applying the merged string catalog (i18n/common.json + the page
          catalog in i18n/pages/<page>.json),
        - rewriting relative asset/link paths for the extra folder depth,
        - setting <html lang> and the HT_PAGE config.
     3. Rewrites the TRANSLATED manifest inside assets/js/i18n.js.

   No dependencies. Run:  node tools/build-i18n.js
   ========================================================================= */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const I18N = path.join(ROOT, "i18n");
const ASSET_VER = "20260719";

function readJSON(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function read(p) { return fs.readFileSync(p, "utf8"); }
function write(p, s) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s, "utf8");
}

const config = readJSON(path.join(I18N, "config.json"));
const common = readJSON(path.join(I18N, "common.json"));
const LANGS = config.languages;               // [{code,label,name}]
const NON_EN = LANGS.filter(l => l.code !== "en").map(l => l.code);
const BUILD = config.pages;                    // pages generated from catalogs
const HAND = config.handTranslated || [];      // pages translated outside the build
const TRANSLATED = new Set([...BUILD, ...HAND]);

function enPrefixFor(page) { return "../".repeat(page.split("/").length - 1); }
function langPrefixFor(page) { return "../".repeat(page.split("/").length); }

function hreflangBlock(page) {
  const base = config.baseUrl;
  const lines = [];
  lines.push(`  <link rel="alternate" hreflang="x-default" href="${base}${page}" />`);
  lines.push(`  <link rel="alternate" hreflang="en" href="${base}${page}" />`);
  NON_EN.forEach(code => {
    lines.push(`  <link rel="alternate" hreflang="${code}" href="${base}${code}/${page}" />`);
  });
  return lines.join("\n") + "\n";
}

/* Ensure the English page carries the i18n wiring. Idempotent. */
function wireEnglish(html, page) {
  const enPrefix = enPrefixFor(page);

  if (!/hreflang=/.test(html)) {
    html = html.replace(/<\/head>/, hreflangBlock(page) + "</head>");
  }
  if (!/id="langSwitch"/.test(html)) {
    html = html.replace(
      /<div class="nav__cta">/,
      `<div class="nav__cta">\n        <div class="nav__lang" id="langSwitch"></div>`
    );
  }
  // Normalize the HT_PAGE + i18n.js include: drop any existing pair, re-add.
  html = html.replace(/\s*<script>window\.HT_PAGE = \{[^}]*\};<\/script>/g, "");
  html = html.replace(/\s*<script src="[^"]*assets\/js\/i18n\.js[^"]*"><\/script>/g, "");
  const wiring =
    `  <script>window.HT_PAGE = { lang: "en", page: "${page}", root: "${enPrefix}" };</script>\n` +
    `  <script src="${enPrefix}assets/js/i18n.js?v=${ASSET_VER}"></script>\n`;
  html = html.replace(/<\/body>/, wiring + "</body>");
  return html;
}

/* Rewrite every relative path that resolves outside the current language
   folder (assets, favicon, pages that are not translated) to point at the
   English copy, using the correct number of "../" for the page's depth. Links
   to translated pages and in-page anchors are left unchanged. */
function rewritePaths(html, page) {
  const pageDir = path.posix.dirname(page) === "." ? "" : path.posix.dirname(page);
  const up = "../".repeat(page.split("/").length); // depth incl. the /<lang>/ level
  return html.replace(/\b(src|href|content)="([^"]*)"/g, (m, attr, val) => {
    if (/^(https?:|mailto:|tel:|data:|\/\/|#)/.test(val)) return m;
    if (attr === "content" && !/^assets\//.test(val)) return m;
    const parts = val.match(/^([^#?]*)([?#].*)?$/);
    const pathPart = parts[1];
    const rest = parts[2] || "";
    if (pathPart === "") return m;
    const rootRel = path.posix.normalize(path.posix.join(pageDir, pathPart));
    if (TRANSLATED.has(rootRel)) return m;
    return `${attr}="${up}${rootRel}${rest}"`;
  });
}

/* Prepend one "../" to relative asset paths inside inline JSON data blocks
   (e.g. feature-gallery's galleryData), which are not HTML attributes and so
   are missed by rewritePaths. */
function rewriteJsonAssets(html) {
  return html.replace(
    /(<script type="application\/json"[^>]*>)([\s\S]*?)(<\/script>)/g,
    (m, open, body, close) => open + body.replace(/"(assets\/[^"]*)"/g, '"../$1"') + close
  );
}

/* Literal, collision-safe string substitution via a two-pass token swap so a
   translated fragment can never be re-translated by a shorter key. */
function translate(html, catalog, lang) {
  const entries = Object.keys(catalog)
    .map(en => ({ en, tr: catalog[en][lang] }))
    .filter(e => e.tr != null)
    .sort((a, b) => b.en.length - a.en.length);
  const values = [];
  entries.forEach((e, i) => {
    const token = "\u0000" + i + "\u0000";
    if (html.indexOf(e.en) !== -1) {
      html = html.split(e.en).join(token);
      values[i] = e.tr;
    }
  });
  values.forEach((tr, i) => {
    if (tr == null) return;
    html = html.split("\u0000" + i + "\u0000").join(tr);
  });
  return html;
}

function updateManifest() {
  const p = path.join(ROOT, "assets", "js", "i18n.js");
  let js = read(p);
  const obj = {};
  [...TRANSLATED].sort().forEach(page => { obj[page] = NON_EN; });
  const body = Object.keys(obj)
    .map(k => `    ${JSON.stringify(k)}: ${JSON.stringify(obj[k])}`)
    .join(",\n");
  const block =
    "/* BUILD:TRANSLATED-START — generated by tools/build-i18n.js, do not edit by hand */\n" +
    "  var TRANSLATED = {\n" + body + "\n  };\n" +
    "  /* BUILD:TRANSLATED-END */";
  js = js.replace(
    /\/\* BUILD:TRANSLATED-START[\s\S]*?BUILD:TRANSLATED-END \*\//,
    block
  );
  write(p, js);
}

function build() {
  let count = 0;
  BUILD.forEach(page => {
    const srcPath = path.join(ROOT, page);
    if (!fs.existsSync(srcPath)) {
      console.warn(`! skipping ${page} (English source not found)`);
      return;
    }
    let english = wireEnglish(read(srcPath), page);
    write(srcPath, english);

    const pageCatalogPath = path.join(I18N, "pages", page.replace(/\//g, "__") + ".json");
    const pageCatalog = fs.existsSync(pageCatalogPath) ? readJSON(pageCatalogPath) : {};
    const catalog = Object.assign({}, common, pageCatalog);

    const langPrefix = langPrefixFor(page);

    NON_EN.forEach(code => {
      let html = rewritePaths(english, page);
      html = rewriteJsonAssets(html);
      html = html.replace(/<html lang="en">/, `<html lang="${code}">`);
      html = html.replace(
        /window\.HT_PAGE = \{ lang: "en", page: "([^"]*)", root: "[^"]*" \}/,
        `window.HT_PAGE = { lang: "${code}", page: "$1", root: "${langPrefix}" }`
      );
      // Shield URL/path attributes (src, href), descriptive alt text and JSON
      // "img" values so that translatable words never alter a filename, a link
      // or leak into an alt sentence (e.g. the badge "Programming" must not
      // touch BatchChannelProgramming.png).
      const shielded = [];
      const stash = (m, a, v, b) => {
        shielded.push(v);
        return a + "\u0001" + (shielded.length - 1) + "\u0001" + b;
      };
      html = html.replace(/(\b(?:src|href|alt)=")([^"]*)(")/g, stash);
      html = html.replace(/("img":\s*")([^"]*)(")/g, stash);
      html = translate(html, catalog, code);
      shielded.forEach((v, i) => { html = html.split("\u0001" + i + "\u0001").join(v); });
      write(path.join(ROOT, code, page), html);
      count++;
    });
    console.log(`✓ ${page} → ${NON_EN.length} languages`);
  });
  updateManifest();
  console.log(`Done. ${count} localized files written; manifest updated.`);
}

build();
