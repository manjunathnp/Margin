# Vendored PDF.js runtime

These classic browser bundles are built from `pdfjs-dist` version `6.3.289`, pinned in the project lockfile. They provide local PDF text extraction without a CDN, external service, local server, or launcher. The worker bundle is loaded into the page before the main PDF.js bundle so the same code works from both `file://` and `http://`.

To update them intentionally:

```bash
npm install
npm run vendor:pdf
```

PDF.js is maintained by Mozilla and distributed under the Apache License 2.0. See `LICENSE` in this directory.
