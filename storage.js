(function () {
  "use strict";

  const DB_NAME = "margin-review";
  const DB_VERSION = 1;
  const STORE = "documents";
  let dbPromise;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("updatedAt", "updatedAt");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  async function transact(mode, callback) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let result;
      try {
        result = callback(store);
      } catch (error) {
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Database transaction was aborted."));
    });
  }

  async function list() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onsuccess = () => {
        const docs = request.result || [];
        docs.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        resolve(docs);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async function get(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function put(document) {
    const record = structuredClone(document);
    await transact("readwrite", (store) => store.put(record));
    return record;
  }

  async function remove(id) {
    await transact("readwrite", (store) => store.delete(id));
  }

  async function clear() {
    await transact("readwrite", (store) => store.clear());
  }

  window.MarginDB = { open, list, get, put, remove, clear };
})();
