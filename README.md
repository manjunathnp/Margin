<p align="center">
  <img src="assets/margin-logo-square.png" alt="Margin logo" width="220" />
</p>

<h1 align="center">Margin</h1>

<p align="center">
  A private, offline-first workspace for reviewing long documents and exporting structured feedback briefs.
</p>

<p align="center">
  <a href="https://github.com/manjunathnp/Margin/releases/latest"><img src="https://img.shields.io/github/v/release/manjunathnp/Margin?display_name=tag" alt="Latest release" /></a>
  <img src="https://img.shields.io/badge/storage-local--only-2f6750" alt="Local-only storage" />
  <img src="https://img.shields.io/badge/AI_connections-none-20211f" alt="No AI connections" />
</p>

Margin is a browser-based document review application for readers, editors, researchers, and technical reviewers. Import or paste a long document, attach precise questions and revision requests to text or structured blocks, add insertion instructions at exact positions, and export the complete review context as one Markdown brief.

The application works directly from `index.html`. Documents remain in the browser profile and are never uploaded by Margin.

## Highlights

- Import PDF, Markdown, DOCX, HTML, RTF, CSV, JSON, XML, and plain text files.
- Paste rich content from Microsoft Word, Google Docs, and web pages.
- Review selected passages, tables, images, information blocks, and code blocks.
- Add anchored insertions between paragraphs with visible summaries and direct removal controls.
- Highlight content with multiple colors and remove highlights without deleting reviews.
- Format and syntax-color code blocks using selectable languages.
- Keep a document-wide instruction alongside passage-level feedback.
- Resize or collapse the Library and Review panels without losing their restore controls.
- Delete individual documents or clear the entire library through explicit confirmation dialogs.
- Export review briefs and documents without connecting an AI provider.
- Use light and dark themes while keeping the document canvas readable.

## Supported imports

| Format | Support | Notes |
| --- | --- | --- |
| PDF | Direct local import | Reconstructs page boundaries, headings, lists, tables, information blocks, and code where the PDF exposes usable text geometry. |
| Markdown | Native | Supports headings, tables, links, quotes, inline code, and fenced code blocks. |
| DOCX | Native | Imports modern Microsoft Word documents. |
| HTML / RTF | Native | Sanitized before entering the editable document. |
| TXT / CSV / JSON / XML | Native | Converted into readable, reviewable content. |
| Rich clipboard content | Native | Preserves useful structure from Word, Google Docs, and browsers. |

Password-protected PDFs must be unlocked before import. Image-only scanned PDFs require OCR, which is not bundled. Legacy `.doc`, Apple Pages, and OpenDocument files should first be exported as DOCX, HTML, Markdown, or text.

## Get started

### Run directly

Clone or download the repository, then open `index.html` in a modern browser. PDF support and all other import formats work without a launcher, web server, CDN, or network connection.

```bash
git clone https://github.com/manjunathnp/Margin.git
cd Margin
open index.html
```

On Windows, open `index.html` from File Explorer. On Linux, use the equivalent desktop file action or `xdg-open index.html`.

### Optional local server

The server is only needed to exercise installable PWA and service-worker caching behavior.

```bash
npm install
npm start
```

Then visit [http://127.0.0.1:4173](http://127.0.0.1:4173).

## Review workflow

1. Import a supported file or paste content into a new document.
2. Select text or a structured block and choose Ask, Simplify, Rewrite, Verify, or Note.
3. Add detailed instructions and follow-up notes in the review composer.
4. Place insertion reviews at exact document positions when new content belongs between existing blocks.
5. Add a document-wide instruction when one rule should apply to the entire revision.
6. Export the review brief for use in your preferred writing or AI workflow.

## Privacy model

- Documents and reviews are stored in IndexedDB inside the current browser profile.
- Margin does not include analytics, local-model detection, external model endpoints, or API-key storage.
- Imported files do not leave the device.
- Clearing browser site data removes the local library; export important work periodically.

## Architecture

| File | Responsibility |
| --- | --- |
| `app.js` | Editor interactions, review workflow, panel controls, dialogs, and exports. |
| `storage.js` | IndexedDB persistence for documents and reviews. |
| `parsers.js` | Sanitized conversion for text-oriented formats and rich clipboard input. |
| `file-importers.js` | File-type routing, progress reporting, import errors, and PDF orchestration. |
| `pdf-structure.js` | Geometry-aware reconstruction of PDF headings, tables, code, and content blocks. |
| `document-lifecycle.js` | Deterministic deletion selection, strict clear confirmation, and ordered storage writes. |
| `vendor/pdfjs/` | Pinned local PDF.js browser bundles. |
| `service-worker.js` | Optional offline application cache for server-hosted use. |

## Development

Requirements: Node.js 18 or newer and npm.

```bash
npm install
npm test
```

The regression suite covers direct PDF import, offline asset consistency, PDF structure reconstruction, inline and block code handling, accessible panel controls, destructive library workflows, and storage ordering.

To intentionally refresh the vendored PDF.js bundles after changing the pinned dependency:

```bash
npm run vendor:pdf
```

## Known limitations

- PDF is a fixed-layout format; complex multi-column or highly graphical pages may require manual cleanup after import.
- OCR is not included for scanned PDFs.
- Browser storage is local to the browser profile and is not a backup service.
- Margin exports review instructions but does not execute them through an AI model.

## Release

The first repository release is [`v1.0.0`](https://github.com/manjunathnp/Margin/releases/tag/v1.0.0). See [CHANGELOG.md](CHANGELOG.md) for the release summary.

## Author

Developed by [Manjunath N P](https://github.com/manjunathnp).
