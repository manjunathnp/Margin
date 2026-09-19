import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(resolve(projectRoot, path), "utf8");

test("PDF is exposed through the same direct file picker as other imports", async () => {
  const [html, importer] = await Promise.all([read("index.html"), read("file-importers.js")]);

  assert.match(html, /accept="[^"]*\.pdf[^"]*application\/pdf/);
  assert.match(importer, /file\.type === "application\/pdf"/);
  assert.doesNotMatch(importer, /location\.protocol\s*===\s*["']file:/);
  assert.doesNotMatch(importer, /start\.command|local launcher/i);
});

test("file-compatible PDF bundles are local, lazy, and worker-first", async () => {
  const importer = await read("file-importers.js");
  const workerLoad = importer.indexOf("loadClassicScript(PDF_WORKER_URL");
  const libraryLoad = importer.indexOf("loadClassicScript(PDF_LIBRARY_URL");

  assert.ok(workerLoad >= 0, "worker bundle should be loaded lazily");
  assert.ok(libraryLoad > workerLoad, "worker bundle must load before the PDF library");
  await Promise.all([
    stat(resolve(projectRoot, "vendor/pdfjs/pdf.js")),
    stat(resolve(projectRoot, "vendor/pdfjs/pdf.worker.js"))
  ]);
});

test("offline cache and browser cache-busting use the same release", async () => {
  const [html, worker] = await Promise.all([read("index.html"), read("service-worker.js")]);

  assert.match(worker, /margin-review-v1\.0\.0/);
  for (const asset of ["styles.css", "storage.js", "parsers.js", "pdf-structure.js", "document-lifecycle.js", "file-importers.js", "app.js"]) {
    assert.match(html, new RegExp(`${asset.replace(".", "\\.")}\\?v=1\\.0\\.0`));
    assert.match(worker, new RegExp(`${asset.replace(".", "\\.")}\\?v=1\\.0\\.0`));
  }
  assert.match(worker, /vendor\/pdfjs\/pdf\.js\?v=1\.0\.0/);
  assert.match(worker, /vendor\/pdfjs\/pdf\.worker\.js\?v=1\.0\.0/);
  assert.match(worker, /assets\/margin-logo-square\.png/);
});

async function pdfStructure() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(await read("pdf-structure.js"), context);
  return context.MarginPdfStructure;
}

function pdfItem(str, x, y, width, fontName, height = 12) {
  return { str, width, height, fontName, transform: [height, 0, 0, height, x, y] };
}

test("PDF geometry reconstructs tables instead of flattening their columns", async () => {
  const structure = await pdfStructure();
  const styles = { body: { fontFamily: "serif" }, heading: { fontFamily: "sans-serif" } };
  const items = [
    pdfItem("Range", 50, 500, 35, "heading"), pdfItem("Meaning", 140, 500, 48, "heading"), pdfItem("Common ones", 280, 500, 80, "heading"),
    pdfItem("2xx", 50, 482, 22, "body"), pdfItem("Success", 140, 482, 45, "body"), pdfItem("200, 201", 280, 482, 55, "body"),
    pdfItem("4xx", 50, 464, 22, "body"), pdfItem("Client error", 140, 464, 68, "body"), pdfItem("400, 404", 280, 464, 55, "body"),
    pdfItem("5xx", 50, 446, 22, "body"), pdfItem("Server error", 140, 446, 68, "body"), pdfItem("500, 503", 280, 446, 55, "body")
  ];
  const html = structure.pageToHtml(items, styles);

  assert.match(html, /<table>/);
  assert.match(html, /<th>Range<\/th>/);
  assert.equal((html.match(/<tr>/g) || []).length, 4);
});

test("PDF monospace runs become colored, language-tagged code blocks", async () => {
  const structure = await pdfStructure();
  const styles = { code: { fontFamily: "monospace" } };
  const items = [
    pdfItem("const response = await fetch(url);", 72, 500, 210, "code"),
    pdfItem("const data = await response.json();", 72, 486, 218, "code"),
    pdfItem("console.log(data);", 72, 472, 115, "code")
  ];
  const html = structure.pageToHtml(items, styles);

  assert.match(html, /<pre data-language="javascript">/);
  assert.match(html, /const response = await fetch\(url\);/);
  assert.doesNotMatch(html, /%%INLINE\*CODE/);
});

test("PDF mixed-font lines preserve inline code and information blocks", async () => {
  const structure = await pdfStructure();
  const styles = {
    body: { fontFamily: "serif" },
    label: { fontFamily: "sans-serif" },
    code: { fontFamily: "monospace" }
  };
  const items = [
    pdfItem("A field renamed from", 50, 500, 112, "body"),
    pdfItem("username", 168, 500, 50, "code"),
    pdfItem("to", 224, 500, 12, "body"),
    pdfItem("email", 242, 500, 31, "code"),
    pdfItem("Note", 70, 468, 28, "label"),
    pdfItem("Review this behavior before release.", 70, 452, 205, "body")
  ];
  const html = structure.pageToHtml(items, styles);

  assert.match(html, /<code>username<\/code>/);
  assert.match(html, /<code>email<\/code>/);
  assert.match(html, /class="information-block"/);
  assert.match(html, /data-review-block="information"/);
});

test("Library and Review controls remain icon-only but accessible", async () => {
  const html = await read("index.html");
  for (const id of ["toggle-library", "toggle-reviews"]) {
    const button = html.match(new RegExp(`<button[^>]*id="${id}"[\\s\\S]*?<\\/button>`))?.[0] || "";
    assert.match(button, /aria-label="[^"]+"/);
    assert.match(button, /panel-toggle-icon/);
    assert.doesNotMatch(button, />\s*(Library|Reviews)\s*</);
  }
});

async function documentLifecycle() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(await read("document-lifecycle.js"), context);
  return context.MarginDocumentLifecycle;
}

test("deleting documents chooses a stable next document without mutating input", async () => {
  const lifecycle = await documentLifecycle();
  const documents = [{ id: "a" }, { id: "b" }, { id: "c" }];

  const middle = lifecycle.deletePlan(documents, "b", "b");
  assert.equal(middle.found, true);
  assert.equal(middle.wasCurrent, true);
  assert.equal(middle.nextDocumentId, "c");
  assert.deepEqual(Array.from(middle.remaining, (item) => item.id), ["a", "c"]);

  const last = lifecycle.deletePlan(documents, "c", "c");
  assert.equal(last.nextDocumentId, "b");
  assert.deepEqual(documents.map((item) => item.id), ["a", "b", "c"]);
});

test("document deletion is idempotent for stale or repeated targets", async () => {
  const lifecycle = await documentLifecycle();
  const documents = [{ id: "a" }, { id: "b" }];
  const stale = lifecycle.deletePlan(documents, "missing", "a");

  assert.equal(stale.found, false);
  assert.equal(stale.nextDocumentId, "a");
  assert.deepEqual(Array.from(stale.remaining, (item) => item.id), ["a", "b"]);
});

test("deleting the only document produces a truthful empty-library state", async () => {
  const lifecycle = await documentLifecycle();
  const result = lifecycle.deletePlan([{ id: "only" }], "only", "only");

  assert.equal(result.found, true);
  assert.equal(result.wasCurrent, true);
  assert.equal(result.nextDocumentId, null);
  assert.equal(result.remaining.length, 0);
});

test("deleting a background document preserves the active document", async () => {
  const lifecycle = await documentLifecycle();
  const result = lifecycle.deletePlan([{ id: "active" }, { id: "other" }], "other", "active");

  assert.equal(result.wasCurrent, false);
  assert.equal(result.nextDocumentId, "active");
  assert.deepEqual(Array.from(result.remaining, (item) => item.id), ["active"]);
});

test("clear-all confirmation rejects partial and lookalike phrases", async () => {
  const lifecycle = await documentLifecycle();

  for (const value of ["", "CLEAR", "clear all", "CLEAR ALL DOCS", "CLEAR  ALL", "CLEAR ALL!"]) {
    assert.equal(lifecycle.clearPhraseMatches(value), false, value);
  }
  for (const value of ["CLEAR ALL", " CLEAR ALL "]) {
    assert.equal(lifecycle.clearPhraseMatches(value), true, value);
  }
});

test("storage writes stay ordered and a failed write cannot poison later deletion", async () => {
  const lifecycle = await documentLifecycle();
  const queue = lifecycle.createSerialQueue();
  const events = [];
  let releaseSave;
  const saveGate = new Promise((resolve) => { releaseSave = resolve; });
  const save = queue.run(async () => {
    events.push("save-start");
    await saveGate;
    events.push("save-finish");
  });
  const clear = queue.run(async () => { events.push("clear"); });
  releaseSave();
  await Promise.all([save, clear]);
  assert.deepEqual(events, ["save-start", "save-finish", "clear"]);

  await assert.rejects(queue.run(async () => { throw new Error("quota"); }), /quota/);
  await queue.run(async () => { events.push("delete-after-error"); });
  assert.equal(events.at(-1), "delete-after-error");
});

test("destructive document controls use soft dialogs and storage clear", async () => {
  const [html, app, storage] = await Promise.all([read("index.html"), read("app.js"), read("storage.js")]);

  assert.match(html, /id="delete-document-dialog"[^>]*class="dialog soft-dialog"/);
  assert.match(html, /id="clear-documents-dialog"[^>]*class="dialog soft-dialog"/);
  assert.match(html, /Type <strong>CLEAR ALL<\/strong> to confirm/);
  assert.match(app, /queueStorageWrite\(\(\) => DB\.remove\(documentId\)\)/);
  assert.match(app, /queueStorageWrite\(\(\) => DB\.clear\(\)\)/);
  assert.match(storage, /store\.clear\(\)/);
  assert.doesNotMatch(app, /confirm\s*\(/);
});

test("provided Margin artwork is wired into visible and installable surfaces", async () => {
  const [html, css, manifest] = await Promise.all([read("index.html"), read("styles.css"), read("manifest.webmanifest")]);
  const parsed = JSON.parse(manifest);

  assert.match(html, /class="brand-logo" src="assets\/margin-logo-square\.png\?v=1\.0\.0" alt="Margin"/);
  assert.match(html, /rel="icon"[^>]+assets\/margin-logo-square\.png\?v=1\.0\.0/);
  assert.match(css, /\.brand-logo[\s\S]*object-fit:\s*contain/);
  assert.doesNotMatch(css, /\.brand-mark/);
  assert.deepEqual(parsed.icons.map(({ src, sizes }) => ({ src, sizes })), [
    { src: "assets/margin-logo-square.png", sizes: "1920x1920" }
  ]);
  await stat(resolve(projectRoot, "assets/margin-logo-square.png"));
});

function memoryIndexedDB() {
  const records = new Map();
  let created = false;
  const store = {
    createIndex() {},
    put(record) { records.set(record.id, structuredClone(record)); },
    delete(id) { records.delete(id); },
    clear() { records.clear(); },
    get(id) {
      const request = {};
      queueMicrotask(() => {
        request.result = records.has(id) ? structuredClone(records.get(id)) : undefined;
        request.onsuccess?.();
      });
      return request;
    },
    getAll() {
      const request = {};
      queueMicrotask(() => {
        request.result = [...records.values()].map((record) => structuredClone(record));
        request.onsuccess?.();
      });
      return request;
    }
  };
  const database = {
    objectStoreNames: { contains: () => created },
    createObjectStore() { created = true; return store; },
    transaction() {
      const transaction = { objectStore: () => store };
      queueMicrotask(() => transaction.oncomplete?.());
      return transaction;
    }
  };
  return {
    open() {
      const request = { result: database };
      queueMicrotask(() => {
        if (!created) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    }
  };
}

test("storage clear removes every document while remove remains individually scoped", async () => {
  const context = { indexedDB: memoryIndexedDB(), structuredClone, window: {} };
  vm.createContext(context);
  vm.runInContext(await read("storage.js"), context);
  const database = context.window.MarginDB;
  await database.put({ id: "a", title: "Same", updatedAt: "2026-01-01T00:00:00.000Z" });
  await database.put({ id: "b", title: "Same", updatedAt: "2026-01-02T00:00:00.000Z" });
  assert.deepEqual(Array.from(await database.list(), (record) => record.id), ["b", "a"]);

  await database.remove("a");
  assert.deepEqual(Array.from(await database.list(), (record) => record.id), ["b"]);
  await database.remove("a");
  assert.deepEqual(Array.from(await database.list(), (record) => record.id), ["b"]);

  await database.clear();
  assert.deepEqual(Array.from(await database.list()), []);
});
