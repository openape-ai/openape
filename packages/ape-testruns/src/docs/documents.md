# Client-authored documents

`ape-testruns publish report.json --key stable-publication-key --json` publishes
a private immutable report. Keep the exact file and key for retries; changed bytes
with the same key conflict. `--category "Test Runs"` and `--series-id ID` are optional.
`--preview-output preview.html` instead saves a sanitized local preview, without
creating a publication or sending notifications. Treat preview exports as private.

The UTF-8 JSON envelope is:

```json
{"type":"document","schemaVersion":1,"title":"Verification","language":"en","category":"Test Runs","html":"<main><h1>Verification</h1><p>Actual results belong here.</p><img src=\"asset:desktop.png\" alt=\"Inspected desktop screenshot\"></main>","css":"body{font:16px/1.6 system-ui;padding:24px}img{max-width:100%}","assets":[{"name":"desktop.png","contentType":"image/png","data":"BASE64_BYTES"}]}
```

The client chooses content, language and static presentation. CSS belongs in the
`css` field; inline style attributes and style tags are removed. Scripts, forms,
SVG, embeds, metadata overrides, executable attributes and navigable links are
excluded. External resources, CSS URLs/imports/fonts and escapes are unsupported.
Safe responsive CSS (including media queries, grids, flex and gradients) remains.
Raster assets must be base64 PNG/JPEG/WebP with matching signatures, at most ten,
2 MiB each and 4 MiB combined. HTML is at most 256 KiB, CSS 64 KiB, total JSON 6 MiB.
Categories are trimmed NFC text up to 160 UTF-8 bytes, without control characters.

Publication returns `id`, `version`, `digest` (original UTF-8 request),
`artifactDigest`, `policyVersion`, and immutable `url`/`edition_url`. An exact
receipt is available at `GET /api/reports/publication?key=KEY&seriesId=ID`.
Series publishers are bound by the owner and cannot read private content.
Owner credentials are never copied into automated publishers.

`ape-testruns upload RUN_DIRECTORY --json` remains the compatible shared test
adapter. Its manifest, screenshot upload, versions and old links remain valid;
these reports appear under Test Runs in the owner's Reports collection. Publishing
does not imply verification: record real results and personally inspect screenshots.
