#!/usr/bin/env node
/* =========================================================================
 * HTCommander blog builder
 *
 * Converts the markdown blog posts that live in the HTCommander repo into
 * styled HTML pages for the HTCommander marketing site, copies their images,
 * and regenerates the blog index (blog.html) from the posts' README.
 *
 * Usage (from this folder):
 *   npm install      # once, to fetch the "marked" dependency
 *   npm run build    # regenerate everything
 *
 * Re-run `npm run build` any time a blog post is added or edited in the repo.
 *
 * Paths are auto-detected assuming the standard layout where the HTCommander
 * and HTCommanderSite repos are siblings, e.g.
 *   <root>/HTCommander/docs/blogs/*.md   (source)
 *   <root>/HTCommanderSite/blogs/*.html  (output)
 * They can be overridden with the BLOG_SRC and BLOG_OUT environment variables.
 * ========================================================================= */

import { readFile, writeFile, readdir, mkdir, copyFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, basename } from 'node:path';
import { marked } from 'marked';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = resolve(__dirname, '..', '..');

const SRC_DIR = process.env.BLOG_SRC
  ? resolve(process.env.BLOG_SRC)
  : resolve(SITE_ROOT, '..', 'HTCommander', 'docs', 'blogs');
const OUT_DIR = process.env.BLOG_OUT ? resolve(process.env.BLOG_OUT) : resolve(SITE_ROOT, 'blogs');
const BLOG_INDEX = resolve(SITE_ROOT, 'blog.html');

const GH_BLOB = 'https://github.com/Ylianst/HTCommander/blob/main/docs/blogs';
const GH_DOCS = 'https://github.com/Ylianst/HTCommander/blob/main/docs';

marked.setOptions({ gfm: true, breaks: false });

/* ---------- small helpers ---------- */

const escHtml = (s = '') =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s = '') =>
  escHtml(s).replace(/"/g, '&quot;');

/** Convert a short markdown string (titles, blurbs) to inline HTML. */
function inline(md = '') {
  return externalLinks(marked.parseInline(md.trim()));
}

/** Add target/rel to absolute links. */
function externalLinks(html) {
  return html.replace(
    /<a href="(https?:\/\/[^"]*)"(?![^>]*\btarget=)/g,
    '<a href="$1" target="_blank" rel="noopener"'
  );
}

/** Point relative markdown links at their generated page or GitHub source. */
function markdownLinks(html) {
  return html.replace(/href="([^"#]+)\.md(#[^"]*)?"/g, (_, path, hash = '') => {
    if (path.startsWith('../')) {
      return `href="${GH_DOCS}/${path.slice(3)}.md${hash}"`;
    }
    return `href="${path}.html${hash}"`;
  });
}

/* ---------- markdown body -> styled HTML ---------- */

function renderBody(md) {
  let html = marked.parse(md);

  // Mermaid fenced blocks -> <pre class="mermaid"> (rendered client-side).
  html = html.replace(
    /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
    (_, code) => `<pre class="mermaid">${code}</pre>`
  );

  // Stand-alone images -> <figure> with the alt text as a caption.
  html = html.replace(/<p>\s*(<img\b[^>]*>)\s*<\/p>/g, (_, img) => {
    const alt = (/alt="([^"]*)"/.exec(img) || [, ''])[1];
    const caption = alt ? `\n  <figcaption>${alt}</figcaption>` : '';
    return `<figure class="post-figure">\n  ${img}${caption}\n</figure>`;
  });

  // Make tables horizontally scrollable on narrow screens.
  html = html
    .replace(/<table>/g, '<div class="table-wrap">\n<table>')
    .replace(/<\/table>/g, '</table>\n</div>');

  return externalLinks(markdownLinks(html));
}

/**
 * Pull the H1 title and the leading italic summary paragraph out of a post,
 * returning them plus the remaining markdown body.
 */
function extractMeta(md) {
  const lines = md.split(/\r?\n/);
  let i = 0;
  let title = null;

  for (; i < lines.length; i++) {
    const m = /^#\s+(.+?)\s*$/.exec(lines[i]);
    if (m) {
      title = m[1].trim();
      i++;
      break;
    }
  }

  while (i < lines.length && lines[i].trim() === '') i++;

  let subtitle = null;
  if (i < lines.length && /^\*(?!\*)/.test(lines[i].trim())) {
    const start = i;
    const para = [];
    while (i < lines.length && lines[i].trim() !== '') para.push(lines[i++]);
    const text = para.join(' ').trim();
    if (text.startsWith('*') && !text.startsWith('**') && text.endsWith('*')) {
      subtitle = text.slice(1, -1).trim();
      while (i < lines.length && lines[i].trim() === '') i++;
      if (i < lines.length && /^-{3,}\s*$/.test(lines[i].trim())) i++;
    } else {
      i = start; // not a clean summary — leave it in the body
    }
  }

  return { title, subtitle, body: lines.slice(i).join('\n') };
}

/* ---------- shared chrome ---------- */

function nav(prefix) {
  return `  <header class="nav" id="nav">
    <div class="container nav__inner">
      <a class="brand" href="${prefix}index.html">
        <img src="${prefix}assets/img/appicon.png" alt="HTCommander icon" />
        <span><b>HTCommander</b></span>
      </a>
      <nav class="nav__links" id="navLinks">
        <a href="${prefix}features.html">Features</a>
        <a href="${prefix}screens.html">Screens</a>
        <a href="${prefix}blog.html">Blog</a>
      </nav>
      <div class="nav__cta">
        <a class="btn btn--ghost btn--sm" href="https://github.com/Ylianst/HTCommander" target="_blank" rel="noopener">View source</a>
        <a class="btn btn--primary btn--sm" href="${prefix}downloads.html">Download</a>
        <button class="nav__toggle" id="navToggle" aria-label="Toggle menu" aria-expanded="false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
      </div>
    </div>
  </header>`;
}

function footer(prefix) {
  return `  <footer class="footer">
    <div class="container">
      <div class="footer__grid">
        <div class="footer__brand">
          <a class="brand" href="${prefix}index.html"><img src="${prefix}assets/img/appicon.png" alt="" /><span><b>HTCommander</b></span></a>
          <p>A cross-platform companion for Benshi handheld radios. Built for the amateur radio community. An amateur radio license is required to transmit.</p>
        </div>
        <div>
          <h4>App</h4>
          <ul>
            <li><a href="${prefix}index.html#features">Features</a></li>
            <li><a href="${prefix}screens.html">Screens</a></li>
            <li><a href="${prefix}features.html">Deep dive</a></li>
          </ul>
        </div>
        <div>
          <h4>Project</h4>
          <ul>
            <li><a href="https://github.com/Ylianst/HTCommander" target="_blank" rel="noopener">GitHub</a></li>
            <li><a href="https://github.com/Ylianst/HTCommander/releases" target="_blank" rel="noopener">Releases</a></li>
            <li><a href="${prefix}blog.html">Technology blog</a></li>
            <li><a href="https://www.arrl.org/getting-licensed" target="_blank" rel="noopener">Get licensed</a></li>
          </ul>
        </div>
        <div>
          <h4>Legal</h4>
          <ul>
            <li><a href="${prefix}privacy.html">Privacy policy</a></li>
            <li><a href="https://github.com/Ylianst/HTCommander/blob/main/LICENSE" target="_blank" rel="noopener">License (Apache 2.0)</a></li>
          </ul>
        </div>
      </div>
      <div class="footer__bottom">
        <span>© 2026 HTCommander. Released under the Apache 2.0 License.</span>
        <span>An amateur radio license is required to transmit.</span>
      </div>
    </div>
  </footer>`;
}

const MERMAID = `  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
    mermaid.initialize({ startOnLoad: true, theme: 'dark', securityLevel: 'strict', themeVariables: { fontFamily: 'inherit' } });
  </script>`;

/* ---------- post page ---------- */

function postPage({ title, subtitle, section, bodyHtml, slug, hasMermaid }) {
  const ghUrl = `${GH_BLOB}/${slug}.md`;
  const lead = subtitle ? `\n      <p>${inline(subtitle)}</p>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escAttr(title)} — HTCommander</title>
  <meta name="description" content="${escAttr(subtitle || title)}" />
  <meta name="theme-color" content="#07090d" />
  <link rel="icon" href="../favicon.ico" />
  <link rel="stylesheet" href="../assets/css/style.css" />
</head>
<body>
${nav('../')}

  <section class="page-hero page-hero--article">
    <div class="container">
      <span class="eyebrow">${escHtml(section || 'Technology blog')}</span>
      <h1>${escHtml(title)}</h1>${lead}
      <p class="article__back-top"><a href="../blog.html">← All posts</a></p>
    </div>
  </section>

  <section class="section--tight">
    <div class="container">
      <article class="article">
${bodyHtml}
        <div class="article__foot">
          <a class="btn btn--ghost" href="../blog.html">← Back to the blog</a>
          <a class="btn btn--ghost" href="${ghUrl}" target="_blank" rel="noopener">View source on GitHub →</a>
        </div>
      </article>
    </div>
  </section>

${footer('../')}

  <script src="../assets/js/main.js"></script>
${hasMermaid ? MERMAID + '\n' : ''}</body>
</html>
`;
}

/* ---------- README-driven index ---------- */

function parseReadme(md) {
  const lines = md.split(/\r?\n/);
  const sections = [];
  let cur = null;

  for (let i = 0; i < lines.length; i++) {
    const h = /^##\s+(.+?)\s*$/.exec(lines[i]);
    if (h) {
      cur = { name: h[1].trim(), intro: '', items: [] };
      sections.push(cur);
      continue;
    }
    if (!cur) continue;

    const item = /^\d+\.\s+\*\*\[(.+?)\]\((.+?\.md)\)\*\*\s*$/.exec(lines[i]);
    if (item) {
      const desc = [];
      let j = i + 1;
      while (
        j < lines.length &&
        lines[j].trim() !== '' &&
        !/^\d+\.\s/.test(lines[j].trim()) &&
        !/^##\s/.test(lines[j])
      ) {
        desc.push(lines[j].trim());
        j++;
      }
      cur.items.push({
        title: item[1].trim(),
        slug: basename(item[2].trim()).replace(/\.md$/, ''),
        desc: desc.join(' ').trim(),
      });
      i = j - 1;
      continue;
    }

    const line = lines[i].trim();
    if (
      cur.items.length === 0 &&
      line &&
      !line.startsWith('**Related') &&
      !line.startsWith('*More') &&
      !/^-{3,}$/.test(line)
    ) {
      cur.intro += (cur.intro ? ' ' : '') + line;
    }
  }

  return sections.filter((s) => s.items.length);
}

function kickerFor(sectionName, index) {
  if (/dart/i.test(sectionName)) return `Part ${index + 1}`;
  const map = {
    'Firmware Updates': 'Firmware',
    'Sharing & Interop': 'Interop',
    'Home Automation & Integrations': 'Integration',
    'App Architecture': 'Architecture',
  };
  return map[sectionName] || sectionName.split(/\s+/)[0];
}

function indexPage(sections) {
  const groups = sections
    .map((sec, si) => {
      const cards = sec.items
        .map(
          (it, ii) => `        <a class="post" href="blogs/${it.slug}.html">
          <span class="kicker">${escHtml(kickerFor(sec.name, ii))}</span>
          <h3>${inline(it.title)}</h3>
          <p>${inline(it.desc)}</p>
          <span class="post__more">Read more →</span>
        </a>`
        )
        .join('\n');
      const bg = si % 2 === 1 ? ' style="background: var(--bg-2);"' : '';
      const sub = sec.intro ? `\n      <p class="group-sub">${inline(sec.intro)}</p>` : '';
      return `  <section class="section--tight"${bg}>
    <div class="container">
      <h2 class="group-title">${escHtml(sec.name)}</h2>${sub}

      <div class="grid grid--blog mt-40">
${cards}
      </div>
    </div>
  </section>`;
    })
    .join('\n\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Technology blog — HTCommander</title>
  <meta name="description" content="Field notes and deep dives on the technology behind HTCommander — the DART modem, Benshi firmware updates, DSP experiments and protocol reverse-engineering." />
  <meta name="theme-color" content="#07090d" />
  <link rel="icon" href="favicon.ico" />
  <link rel="stylesheet" href="assets/css/style.css" />
</head>
<body>
${nav('')}

  <section class="page-hero">
    <div class="container">
      <span class="eyebrow">Technology blog</span>
      <h1>Field notes from the bench</h1>
      <p>Deep dives on the engineering behind HTCommander — real-world findings, protocol reverse-engineering and DSP experiments. The honest ledger of what works, what doesn't, and what we still don't know.</p>
    </div>
  </section>

${groups}

  <section class="section--tight">
    <div class="container">
      <div class="center">
        <a class="btn btn--ghost" href="${GH_BLOB}/README.md" target="_blank" rel="noopener">See the source blog index on GitHub →</a>
      </div>
    </div>
  </section>

${footer('')}

  <script src="assets/js/main.js"></script>
</body>
</html>
`;
}

/* ---------- image copy ---------- */

async function copyDir(src, dest) {
  if (!existsSync(src)) return 0;
  await mkdir(dest, { recursive: true });
  let count = 0;
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) count += await copyDir(from, to);
    else {
      await copyFile(from, to);
      count++;
    }
  }
  return count;
}

/* ---------- main ---------- */

async function main() {
  if (!existsSync(SRC_DIR)) {
    console.error(`Source folder not found: ${SRC_DIR}`);
    console.error('Set BLOG_SRC to the path of HTCommander/docs/blogs.');
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });

  const readmePath = join(SRC_DIR, 'README.md');
  const sections = existsSync(readmePath)
    ? parseReadme(await readFile(readmePath, 'utf8'))
    : [];

  // Map each slug to the section it belongs to, for the post's eyebrow.
  const sectionOf = new Map();
  for (const sec of sections)
    for (const it of sec.items) sectionOf.set(it.slug, sec.name);

  const files = (await readdir(SRC_DIR))
    .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
    .sort();

  let built = 0;
  for (const file of files) {
    const slug = file.replace(/\.md$/, '');
    const md = await readFile(join(SRC_DIR, file), 'utf8');
    const { title, subtitle, body } = extractMeta(md);
    if (!title) {
      console.warn(`  ! ${file}: no H1 title found, skipping`);
      continue;
    }
    const bodyHtml = renderBody(body);
    const hasMermaid = /class="mermaid"/.test(bodyHtml);
    const html = postPage({
      title,
      subtitle,
      section: sectionOf.get(slug) || 'Technology blog',
      bodyHtml,
      slug,
      hasMermaid,
    });
    await writeFile(join(OUT_DIR, `${slug}.html`), html, 'utf8');
    built++;
    if (!sectionOf.has(slug))
      console.warn(`  ! ${file}: not listed in README.md — page built but not in index`);
  }

  const imgCount = await copyDir(join(SRC_DIR, 'images'), join(OUT_DIR, 'images'));

  if (sections.length) {
    await writeFile(BLOG_INDEX, indexPage(sections), 'utf8');
  } else {
    console.warn('  ! No README.md sections found — blog.html index not regenerated.');
  }

  console.log(`Built ${built} post page(s), copied ${imgCount} image(s).`);
  console.log(`Output: ${OUT_DIR}`);
  if (sections.length) console.log(`Index:  ${BLOG_INDEX}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
