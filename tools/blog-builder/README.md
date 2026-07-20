# Blog builder

Converts the markdown blog posts from the **HTCommander** repo
(`HTCommander/docs/blogs/*.md`) into styled HTML pages for this website, copies
their images, and regenerates the blog index page (`blog.html`).

## Setup (once)

```bash
cd tools/blog-builder
npm install
```

## Build / rebuild

```bash
npm run build
```

Run this any time a blog post is **added or edited** in the HTCommander repo.
It will:

1. Read every `*.md` in `HTCommander/docs/blogs/` (except `README.md`).
2. Generate a matching styled page in `HTCommanderSite/blogs/<name>.html`.
3. Copy the post images into `HTCommanderSite/blogs/images/`.
4. Regenerate `HTCommanderSite/blog.html` (the card index) from the posts'
   `README.md` — sections, order and blurbs all come from that file.

## How a post becomes a page

- The first `# Heading` is the page title.
- A leading `*italic summary*` paragraph (if present) becomes the page's
  intro/lead text and meta description.
- The rest of the markdown is rendered to the site's dark theme: tables, code
  blocks, block quotes, images (with captions from their alt text) and
  ```mermaid``` diagrams (rendered client-side via mermaid.js).

## Adding a new post

1. Add the `.md` file (and any images) to `HTCommander/docs/blogs/`.
2. Add it to the appropriate section list in that folder's `README.md`.
3. Run `npm run build`. The new page and index card appear automatically.

## Paths

Paths are auto-detected assuming `HTCommander` and `HTCommanderSite` are sibling
folders. Override with environment variables if your layout differs:

```bash
BLOG_SRC=/path/to/HTCommander/docs/blogs BLOG_OUT=/path/to/HTCommanderSite/blogs npm run build
```
