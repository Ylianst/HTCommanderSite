# Converting blog posts to web pages

The HTML files in this folder are **generated** from the markdown blog posts in
the HTCommander repo (`HTCommander/docs/blogs/*.md`). Do not edit them by hand —
they are overwritten every time the builder runs. Edit the source markdown
instead, then rebuild.

## Where things live

| Thing | Location |
|---|---|
| Source posts (markdown) | `HTCommander/docs/blogs/*.md` |
| Source images | `HTCommander/docs/blogs/images/` |
| Post index (drives the cards) | `HTCommander/docs/blogs/README.md` |
| The build tool | `HTCommanderSite/tools/blog-builder/` |
| Generated pages (this folder) | `HTCommanderSite/blogs/*.html` |
| Generated images | `HTCommanderSite/blogs/images/` |
| Generated index page | `HTCommanderSite/blog.html` |

This assumes the `HTCommander` and `HTCommanderSite` repos sit side by side in
the same parent folder.

## One-time setup

Install the tool's one dependency (`marked`):

```bash
cd tools/blog-builder
npm install
```

## Build / rebuild

From `tools/blog-builder`:

```bash
npm run build
```

Run this any time a post is **added or edited**. It will:

1. Read every `*.md` in `HTCommander/docs/blogs/` (except `README.md`).
2. Generate a matching styled page in `HTCommanderSite/blogs/<name>.html`.
3. Copy the post images into `HTCommanderSite/blogs/images/`.
4. Regenerate `HTCommanderSite/blog.html` (the card index) from `README.md`.

Expected output looks like:

```
Built 12 post page(s), copied 16 image(s).
Output: .../HTCommanderSite/blogs
Index:  .../HTCommanderSite/blog.html
```

## Adding a new post

1. Add the `.md` file (and any images) to `HTCommander/docs/blogs/`.
2. Add a bullet for it under the right `##` section in that folder's
   `README.md`, using the existing format:

   ```markdown
   1. **[Your Post Title](your-post-file.md)**
      A one or two sentence summary that becomes the card blurb.
   ```

3. Run `npm run build`. The new page and its index card appear automatically.

## How a post becomes a page

- The first `# Heading` in the markdown becomes the page title.
- A leading `*italic summary*` paragraph (if present) becomes the page's intro
  lead and the HTML meta description.
- The rest of the markdown is rendered into the site's dark theme:
  - **Tables**, including column alignment.
  - **Fenced code blocks** (` ``` `).
  - **Block quotes** and nested lists.
  - **Images** — turned into captioned figures using their alt text.
  - **Mermaid diagrams** (` ```mermaid `) — rendered in the browser via
    mermaid.js.
- Each generated page gets the site nav, footer, a "Back to the blog" link and a
  "View source on GitHub" link.

## Custom paths

Paths are auto-detected. If your repos are laid out differently, override them
with environment variables:

```bash
BLOG_SRC=/path/to/HTCommander/docs/blogs \
BLOG_OUT=/path/to/HTCommanderSite/blogs \
npm run build
```

## Notes

- `blog.html` is fully generated — edit `README.md` (for cards) or the builder
  template (`tools/blog-builder/build.mjs`) rather than the HTML.
- The article/blog styling lives in `assets/css/style.css` (search for
  "Blog article").
- Mermaid is loaded from a CDN (`cdn.jsdelivr.net`, pinned to v11).
