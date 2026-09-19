(function () {
  "use strict";

  const P = window.MarginParsers;
  const PDFStructure = window.MarginPdfStructure;
  const PDF_LIBRARY_URL = "./vendor/pdfjs/pdf.js?v=1.0.0";
  const PDF_WORKER_URL = "./vendor/pdfjs/pdf.worker.js?v=1.0.0";
  const SUPPORTED_EXTENSIONS = ["pdf", "docx", "md", "markdown", "txt", "html", "htm", "rtf", "csv", "json", "xml"];
  const ACCEPT_ATTRIBUTE = [
    ...SUPPORTED_EXTENSIONS.map((extension) => `.${extension}`),
    "text/*",
    "application/pdf",
    "application/json",
    "application/xml",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ].join(",");

  let pdfLibraryPromise = null;

  function fileExtension(file) {
    return String(file?.name || "").split(".").pop().toLowerCase();
  }

  function documentTitle(file, fallback = "Imported document") {
    return String(file?.name || "").replace(/\.[^.]+$/, "").trim() || fallback;
  }

  function emitProgress(options, current, total, message) {
    options?.onProgress?.({ current, total, message });
  }

  function loadClassicScript(src, isReady) {
    if (isReady()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      script.onload = () => isReady() ? resolve() : reject(new Error(`Loaded ${src}, but its browser API was unavailable.`));
      script.onerror = () => reject(new Error(`Could not load the bundled reader at ${src}.`));
      document.head.append(script);
    });
  }

  async function loadPdfLibrary() {
    if (!pdfLibraryPromise) {
      pdfLibraryPromise = (async () => {
        await loadClassicScript(PDF_WORKER_URL, () => Boolean(window.pdfjsWorker?.WorkerMessageHandler));
        await loadClassicScript(PDF_LIBRARY_URL, () => Boolean(window.pdfjsLib?.getDocument));
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(PDF_WORKER_URL, document.baseURI).href;
        return window.pdfjsLib;
      })().catch((error) => {
          pdfLibraryPromise = null;
          throw new Error(`The offline PDF reader could not be loaded. ${error?.message || "Reload Margin and try again."}`);
        });
    }
    return pdfLibraryPromise;
  }

  function friendlyPdfError(error) {
    const name = error?.name || "";
    if (name === "PasswordException") return "This PDF is password-protected. Save an unlocked copy, then import it again.";
    if (name === "InvalidPDFException") return "This PDF is damaged or is not a valid PDF file.";
    if (name === "MissingPDFException") return "The selected PDF could not be read.";
    return error?.message || "The PDF could not be imported.";
  }

  async function pdfToDocument(file, options = {}) {
    const pdfjs = await loadPdfLibrary();
    emitProgress(options, 0, 1, "Opening PDF…");
    let pdf = null;
    let loadingTask = null;
    try {
      loadingTask = pdfjs.getDocument({
        data: new Uint8Array(await file.arrayBuffer()),
        isEvalSupported: false,
        verbosity: pdfjs.VerbosityLevel.ERRORS
      });
      pdf = await loadingTask.promise;
      const metadata = await pdf.getMetadata().catch(() => ({ info: {} }));
      const pages = [];
      let pagesWithText = 0;

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        emitProgress(options, pageNumber - 1, pdf.numPages, `Reading page ${pageNumber} of ${pdf.numPages}…`);
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
        const lines = PDFStructure.textItemsToLines(content.items || [], content.styles || {});
        if (lines.length) pagesWithText += 1;
        pages.push(`<section class="pdf-page" data-pdf-page="${pageNumber}">${PDFStructure.linesToHtml(lines)}</section>`);
        page.cleanup();
        if (pageNumber % 8 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }

      if (!pagesWithText) {
        throw new Error("No selectable text was found. This appears to be a scanned or image-only PDF; OCR is not included in this offline build.");
      }

      emitProgress(options, pdf.numPages, pdf.numPages, `Imported ${pdf.numPages} ${pdf.numPages === 1 ? "page" : "pages"}.`);
      const metadataTitle = String(metadata?.info?.Title || metadata?.metadata?.get?.("dc:title") || "").trim();
      return {
        title: metadataTitle || documentTitle(file),
        html: P.sanitizeHTML(pages.join("")),
        format: `PDF (${pdf.numPages} ${pdf.numPages === 1 ? "page" : "pages"})`
      };
    } catch (error) {
      throw new Error(friendlyPdfError(error));
    } finally {
      try {
        if (typeof pdf?.cleanup === "function") await pdf.cleanup();
        if (typeof loadingTask?.destroy === "function") await loadingTask.destroy();
      } catch (_) { /* Cleanup must not discard a completed import. */ }
    }
  }

  async function fileToDocument(file, options = {}) {
    if (!file) throw new Error("Choose a file to import.");
    const extension = fileExtension(file);
    if (extension === "pdf" || file.type === "application/pdf") return pdfToDocument(file, options);
    emitProgress(options, 0, 1, `Reading ${file.name || "document"}…`);
    const result = await P.fileToDocument(file);
    emitProgress(options, 1, 1, "Document ready.");
    return result;
  }

  window.MarginFileImporters = {
    acceptAttribute: ACCEPT_ATTRIBUTE,
    fileToDocument,
    pdfToDocument,
    supportedExtensions: [...SUPPORTED_EXTENSIONS]
  };
})();
