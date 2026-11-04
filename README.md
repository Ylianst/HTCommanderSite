> [!NOTE]
> Web site at: [https://ylianst.github.io/HTCommanderSite/](https://ylianst.github.io/HTCommanderSite/).

## Satellite Tracker

The interactive tracker is at [satellites.html](satellites.html). Serve this
directory over HTTP for local development (for example,
`npx http-server . -p 8093`); ES modules and orbital data fetches require a web
server rather than opening the page directly from disk. No build is required.

The page uses pinned CDN versions of Three.js, satellite.js (SGP4), and Lucide.
It shares the app's default radio-tunable FM satellite catalog, including its
curated APRS, SSTV and voice usages. App-specific user satellite overrides are
not included. Observer coordinates are stored only in the browser's local
storage; location permission is requested only when the location button is used.

The files in `assets/satellites/` are copied unchanged from HTCommander's
`src/assets/satellites/`. Copy those three files again when the app's curated
catalog or fallback elements change. The land outlines use Natural Earth data.
The browser attempts a CelesTrak amateur-group refresh and caches successful
results for at least two hours. Failed or blocked refreshes retain the bundled
or cached elements; stale epochs are explicitly flagged. Visibility is geometric
and does not assert that a satellite's radio is currently operating.