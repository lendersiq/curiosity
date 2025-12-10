// js/db.js - Session-only in-memory storage (no persistence for security)
let sessionStorage = {
  sources: new Map(),
  schemas: new Map(),
  rows: new Map()
};

function initDB() {
  // No-op - in-memory storage doesn't need initialization
  return Promise.resolve({
    // Mock IDBDatabase interface for compatibility
    objectStoreNames: {
      contains: (name) => {
        if (name === 'sources' || name === 'schemas') return true;
        return name.startsWith('rows_');
      }
    },
    transaction: (storeNames, mode) => {
      let pendingOperations = 0;
      let transactionCompleted = false;

      const completeTransaction = () => {
        if (!transactionCompleted && pendingOperations === 0) {
          transactionCompleted = true;
          if (tx.oncomplete) tx.oncomplete();
        }
      };

      const tx = {
        oncomplete: null,
        onerror: null,
        objectStore: (storeName) => ({
          put: (data) => {
            pendingOperations++;
            const request = { onsuccess: null, onerror: null };
            setTimeout(() => {
              try {
                if (storeName === 'sources') {
                  sessionStorage.sources.set(data.sourceId, data);
                } else if (storeName === 'schemas') {
                  sessionStorage.schemas.set(data.sourceId, data);
                }
                if (request.onsuccess) request.onsuccess();
              } catch (error) {
                if (request.onerror) request.onerror();
              } finally {
                pendingOperations--;
                completeTransaction();
              }
            }, 0);
            return request;
          },
          get: (key) => {
            pendingOperations++;
            const request = { onsuccess: null, onerror: null, result: null };
            setTimeout(() => {
              try {
                request.result = storeName === 'sources' ? sessionStorage.sources.get(key) :
                                storeName === 'schemas' ? sessionStorage.schemas.get(key) : null;
                if (request.onsuccess) request.onsuccess();
              } catch (error) {
                if (request.onerror) request.onerror();
              } finally {
                pendingOperations--;
                completeTransaction();
              }
            }, 0);
            return request;
          },
          getAll: () => {
            pendingOperations++;
            const request = { onsuccess: null, onerror: null, result: null };
            setTimeout(() => {
              try {
                request.result = storeName === 'sources' ? Array.from(sessionStorage.sources.values()) :
                                storeName === 'schemas' ? Array.from(sessionStorage.schemas.values()) : [];
                if (request.onsuccess) request.onsuccess();
              } catch (error) {
                if (request.onerror) request.onerror();
              } finally {
                pendingOperations--;
                completeTransaction();
              }
            }, 0);
            return request;
          },
          add: (data) => {
            pendingOperations++;
            const request = { onsuccess: null, onerror: null };
            setTimeout(() => {
              try {
                if (storeName.startsWith('rows_')) {
                  const sourceId = storeName.replace('rows_', '');
                  if (!sessionStorage.rows.has(sourceId)) {
                    sessionStorage.rows.set(sourceId, []);
                  }
                  sessionStorage.rows.get(sourceId).push(data);
                }
                if (request.onsuccess) request.onsuccess();
              } catch (error) {
                if (request.onerror) request.onerror();
              } finally {
                pendingOperations--;
                completeTransaction();
              }
            }, 0);
            return request;
          }
        })
      };

      // Complete transaction after operations
      setTimeout(() => completeTransaction(), 0);

      return tx;
    },
    close: () => {} // No-op for session storage
  });
}

async function getDB() {
  return initDB();
}

async function ensureRowsStore(sourceId) {
  // No-op - session storage doesn't need store creation
  return Promise.resolve();
}

async function getAllRows(sourceId) {
  // Return rows from session storage
  return sessionStorage.rows.get(sourceId) || [];
}

// Expose functions globally
window.DB = { initDB, getDB, ensureRowsStore, getAllRows };
