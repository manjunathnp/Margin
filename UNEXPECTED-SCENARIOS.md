# Unexpected-scenario review

Reviewed on 2026-08-28 against the locally served offline-only app at `http://127.0.0.1:4174`.

## Critical defect: leaked inline-code placeholders

### Root cause

An older Markdown parser temporarily replaced backtick code with printable values such as `%%INLINE*CODE*0%%`. When its restoration step failed, that temporary value became document content and was saved permanently in IndexedDB. Updating or reloading the parser could prevent new corruption, but could not reconstruct code values that the old build never saved.

A second migration edge case was reproduced: Markdown interpreted the `*CODE*` portion as emphasis. The placeholder was split across text and `<em>` nodes and its literal asterisks disappeared from `textContent`, so a text-node-only detector missed it.

### Resolution

- New Markdown imports use non-printing, parser-internal markers and restore inline code before sanitization.
- Existing documents are scanned as one continuous text stream, including placeholders split across formatting nodes.
- Both the literal `%%INLINE*CODE*0%%` form and the emphasis-damaged `%%INLINECODE0%%` form are detected.
- A soft repair dialog shows surrounding context and requests the missing value for each unique placeholder. Applying once replaces every occurrence with a real editable `<code>` element and saves it.
- The repair option remains available under document actions until every placeholder has been resolved.

Exact regression input:

```markdown
Because applications **change constantly**. Buttons move. IDs change. Login flows get an extra step. A field renamed from `username` to `email`.
```

Result: zero placeholder strings and two inline-code elements containing `username` and `email`.

## Verified scenarios

| Scenario | Lens | Result |
| --- | --- | --- |
| Import the exact inline-code regression sentence | parser boundary | Passed: 0 leaked tokens, 2 correct inline-code elements |
| Load a saved placeholder split across text and emphasis nodes | legacy state migration | Passed: repair dialog detected both placeholders |
| Repair values as `username` and `email`, then reload | persistence | Passed: values remained real inline code after reload |
| Click a JavaScript code block | interactive formatting | Passed: language selector appeared and keyword/string colors remained visible |
| Change JavaScript to Python | state transition | Passed: language metadata and token coloring changed immediately |
| Reload after changing a code language | persistence/export metadata | Passed: selected language and syntax coloring persisted |
| Inspect simplified review UI | removed dependency | Passed: no model/API controls, one **Export brief** action |
| Check browser console after the full workflow | runtime stability | Passed: no errors |
| Import a 31-page text PDF | large binary input | Passed: all pages extracted locally into editable page sections |
| Reload after PDF import | persistence/sanitization | Passed: all 31 page boundaries and document content survived IndexedDB save/load |
| Inspect Library and Review controls | responsive navigation | Passed: icon-only controls retained accessible names and stayed at the left/right header edges |

## PDF boundary behavior

- Password-protected PDFs receive a specific unlock-first message.
- Invalid or damaged PDFs receive a format-specific error instead of being treated as plain text.
- Image-only PDFs stop with an OCR explanation; Margin does not silently create an empty document.
- Large PDFs report page-level progress and yield periodically so the interface can repaint.
- Files dropped on the document or pasted as files are routed through the same preview-and-import dialog as files chosen from the picker.
- Direct `file://` use loads classic PDF.js bundles lazily and requires no launcher, local server, CDN, or network access.

## Direct-file PDF regression review (2026-09-19)

Evidence available: the reported launcher error, the v13 source and offline runtime assets, the running app, IndexedDB reload behavior, real 10-, 11-, and 31-page PDFs, an intentionally invalid `.pdf`, and the Node regression suite. Browser automation was not permitted to navigate to a `file://` URL, so that protocol is protected by an architecture-level test rather than a scripted UI navigation. The same classic bundles and picker route were exercised end to end in the running app.

### Highest-value findings

1. **Observed failure — direct-file PDF import was blocked (P0).** A user opening `index.html` directly could choose a PDF, but `loadPdfLibrary()` rejected every `file://` page and told them to start a launcher. Markdown did not have this restriction. The invariant is now explicit: every supported file type must use the same picker without requiring a server. The protocol guard and dynamic module dependency were removed; worker-first classic bundles load lazily from local files. `tests/import-architecture.test.mjs` prevents the launcher message, protocol guard, missing PDF picker type, or module-only runtime from returning.
2. **Observed recovery result — invalid PDF does not replace the open document (P0).** An invalid file named `margin-invalid.pdf` produced “This PDF is damaged or is not a valid PDF file,” kept the import dialog open, and left the existing 10-page document unchanged. A valid 11-page PDF selected immediately afterward imported successfully. Recommended coverage: browser integration test when a file-URL-capable runner is available.
3. **Observed cross-format result — Markdown still works after PDF (P1).** A Markdown file imported after PDF produced its heading and a real `<code>username</code>` element with zero PDF page wrappers. This protects against global parser state leaking across format handlers. Recommended coverage: current static routing test plus browser integration.
4. **Observed lifecycle result — PDF survives reload (P1).** The 10-page PDF retained all ten `.pdf-page` sections after reload. The earlier 31-page fixture retained all 31 sections and 5,980 extracted words. Recommended coverage: IndexedDB browser test with a small deterministic PDF fixture.
5. **Candidate gap — scanned or mixed text/image books (P1).** Image-only PDFs receive the intended OCR explanation, but a mixed document containing some text pages and some scanned pages was not available. The invariant should be that readable pages import and unreadable page markers remain truthful. Recommended coverage: integration fixture with one text page and one scan.
6. **Candidate gap — very large books under storage pressure (P2).** Page-level progress and periodic yielding are implemented, but browser quota exhaustion during a several-hundred-page import was not run. The existing document must remain intact and the error must be recoverable. Recommended coverage: resilience test with constrained IndexedDB quota.

### Regression evidence

- `npm test`: 7/7 passing architecture and structure regressions.
- Direct picker import: 10/10 PDF pages extracted; local PDF bundles were absent before selection and both loaded lazily afterward.
- Invalid PDF followed by valid retry: expected error, no document replacement, then successful 11-page import.
- Markdown after PDF: heading and inline code preserved.
- JavaScript syntax checks: importer, parsers, app, service worker, and vendoring script passed.

## Automatic PDF structure regression review (2026-09-19)

Evidence available: the new geometry-and-font reconstruction module, its unit regressions, the real 31-page Tech Book Store guide, rendered source pages containing a three-column table and JavaScript/JSON examples, the live v15 editor, reload behavior, syntax-token markup, and browser console logs.

### Highest-value findings

1. **Observed failure, resolved — callout labels were merged into body paragraphs (P1).** A font-family test treated `sans-serif` as both sans and serif because the second name contains the substring `serif`. That shifted the calculated body margin and prevented indented callout detection. The matcher now excludes sans families from serif metrics, and a regression proves mixed inline code plus a reviewable information block are both retained.
2. **Observed result — real tables and code blocks remain semantic and editable (P0).** Directly importing the 31-page guide produced 17 HTML tables, 14 language-tagged code blocks, 57 paragraph-level inline-code spans, 4 information blocks, 1 list, and 47 headings across all 31 page sections. The status-code matrix retained its header and three data rows. The JSON example was identified as JSON and received 17 colored token spans. No `%%INLINE*CODE*n%%` variants appeared.
3. **Observed result — imported structured blocks can be reviewed (P0).** Clicking a reconstructed table set the explicit `Table selected` state, exposed the block review actions, and enabled **Add review**. This protects the cross-feature invariant that PDF reconstruction must not produce decorative-only blocks.
4. **Observed result — reload does not flatten reconstructed content (P1).** After IndexedDB save and browser reload, the document still contained 31 page sections, 17 tables, 14 code blocks, 4 information blocks, and 111 syntax-color token spans. Browser logs contained no warnings or errors.
5. **Candidate gap — borderless or irregular tables (P1).** Detection currently relies on repeated horizontal anchors. Merged cells, rotated headers, and tables whose rows use inconsistent starting positions were not represented in the available fixture. Expected invariant: uncertain layouts should remain readable and in source order rather than being confidently reconstructed into the wrong columns. Recommended coverage: integration fixtures for merged cells, wrapped headers, and borderless financial tables.
6. **Candidate gap — mixed text and scanned pages (P1).** The current build reports image-only documents honestly, but a book with selectable chapters and isolated scanned pages was not available. Expected invariant: readable pages should import without presenting missing scanned content as successfully reconstructed. Recommended coverage: a two-page fixture with one text page and one raster-only page, plus an explicit per-page notice.
7. **Candidate gap — complex visual objects (P2).** Charts, equations, multi-column magazines, and overlapping text boxes were not exercised. PDF files often omit semantic roles for these objects. Recommended coverage: visual comparison fixtures and a fallback representation that stays selectable for review without duplicating extracted text.

### Added regression oracles

- Aligned PDF text segments must create a table with the expected row count.
- Consecutive monospace lines must create a language-tagged code block.
- Mixed serif and monospace segments must preserve real inline `<code>` elements and never emit legacy placeholder text.
- Indented sans labels followed by aligned body text must create reviewable information blocks.
- App shell assets, the reconstruction module, and local PDF bundles must share the same release cache key.

## Plausible risks not yet reproduced

These are test candidates, not confirmed defects.

- **Book-sized input:** Import, edit, autosave, export, and review filtering with several hundred thousand words still need a representative corpus.
- **Large code blocks:** Continuous editing and recoloring of code blocks with tens of thousands of lines needs performance measurement.
- **Binary-rich Word files:** Nested tables, floating images, equations, tracked changes, and embedded diagrams need a fixture set.
- **Storage pressure:** IndexedDB quota exhaustion, private-browsing restrictions, and browser storage eviction need environment-specific tests.
- **Offline upgrade interruption:** Multi-tab behavior while a new service worker activates needs explicit testing.

## Document deletion and clear-all review (2026-09-19)

Evidence available: the running final app with eight existing local documents, source and existing tests, soft-dialog accessibility output, browser console logs, pure lifecycle regressions, a serial-write race test, and an isolated in-memory IndexedDB implementation. The final destructive buttons were not committed against the user's real library; storage deletion was executed only against isolated test records. Cancellation, phrase gating, filtering, and dialogs were exercised in the live app.

### Highest-value findings

1. **Confirmed gap, resolved — document records had no deletion workflow (P0).** The inspected library only opened documents, while storage exposed a low-level single-record delete that the UI never called. Every library row now has an individually labelled delete control and a soft warning that identifies the title, source format, save time, and review count. The storage regression confirms one ID is removed without affecting a duplicate-titled sibling.
2. **Confirmed gap, resolved — the library could not be cleared safely (P0).** There was no storage `clear()` API, warning, or empty-library state. **Clear all** now displays the complete count, requires the exact phrase `CLEAR ALL`, serializes behind pending writes, clears IndexedDB, and transitions to a truthful empty workspace without recreating an untitled document.
3. **Observed failure prevented — delayed autosave could recreate deleted data (P0).** The original save path used independent asynchronous writes. A delete racing a scheduled save could allow the later write to restore the supposedly deleted record. Storage mutations now use one serial queue; the regression holds a save open, queues clear, proves save finishes before clear, then proves a failed write cannot poison later deletion.
4. **Observed live result — cancellation preserves the library (P0).** Opening the delete warning for `margin-markdown-regression` and choosing **Keep document** retained all eight documents. Opening **Clear all** and pressing Escape also retained all eight. No JavaScript alert appeared.
5. **Observed live result — confirmation resists accidental and lookalike input (P1).** The destructive button stayed disabled for blank input, `CLEAR`, lowercase `clear all`, doubled spaces, extra words, and punctuation. It enabled only for the exact phrase, allowing harmless surrounding whitespace.
6. **Observed live result — search filtering cannot disguise bulk scope (P1).** With the library filtered to one visible result, the warning still stated “8 documents will be deleted.” Cancelling restored the complete library when the search was cleared.
7. **Observed live result — supplied branding remains readable across themes (P2).** The local logo mark was visually inspected in dark and light themes. The document remained white with dark readable text in both. One canonical supplied logo is used across visible and installable app surfaces.
8. **Candidate gap — simultaneous destructive actions across two tabs (P1).** The current UI prevents repeated actions in one tab, and stale IDs are idempotent, but no multi-tab synchronization channel exists. A second open tab could retain stale content until reload. Recommended coverage: a BroadcastChannel-based refresh or a two-tab integration fixture.
9. **Candidate gap — browser-level quota or transaction abort during clear (P1).** The error path preserves in-memory documents and leaves the warning open, but a real browser transaction-abort fault was not injectable in the available runner. Recommended coverage: an integration harness that aborts the IndexedDB transaction and verifies no success toast or empty state appears.

### Regression evidence

- `npm test`: 16/16 passing tests.
- Individual deletion plans: current middle, current last, background, only-document, and stale/repeated target cases passed.
- Storage lifecycle: two duplicate-titled records inserted; one removed twice safely; clear then returned an empty list.
- Mutation ordering: delayed save completed before clear; a simulated quota failure did not block the next delete.
- Live negative paths: individual cancel, bulk Escape, exact-phrase gating, filtered-library count, dark/light branding, and zero browser warnings or errors passed.

## Coverage status

The repository has no automated browser-test suite. The scenarios above were exercised manually in the in-app browser. Repeatable fixtures should be added for parser boundaries, legacy migration, syntax-language persistence, and book-scale performance before production distribution.
