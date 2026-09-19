(function (root) {
  "use strict";

  function deletePlan(documents = [], documentId, currentDocumentId) {
    const index = documents.findIndex((document) => document.id === documentId);
    if (index < 0) {
      return { found: false, wasCurrent: false, remaining: [...documents], nextDocumentId: currentDocumentId || null };
    }

    const remaining = documents.filter((document) => document.id !== documentId);
    const wasCurrent = documentId === currentDocumentId;
    const nextDocument = wasCurrent ? remaining[Math.min(index, remaining.length - 1)] : null;
    return {
      found: true,
      wasCurrent,
      remaining,
      nextDocumentId: wasCurrent ? nextDocument?.id || null : currentDocumentId || null
    };
  }

  function clearPhraseMatches(value) {
    return String(value || "").trim() === "CLEAR ALL";
  }

  function createSerialQueue() {
    let tail = Promise.resolve();
    return {
      run(operation) {
        const result = tail.then(operation);
        tail = result.catch(() => {});
        return result;
      },
      idle() {
        return tail;
      }
    };
  }

  root.MarginDocumentLifecycle = { clearPhraseMatches, createSerialQueue, deletePlan };
})(typeof globalThis !== "undefined" ? globalThis : window);
