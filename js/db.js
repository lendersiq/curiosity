// js/db.js
const DB_NAME = "PrivateAIDB";
let DB_VERSION = 1;

let dbPromise = null;

function initDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = event => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains("sources")) {
        const srcStore = db.createObjectStore("sources", { keyPath: "sourceId" });
        srcStore.createIndex("byName", "name", { unique: false });
      }

      if (!db.objectStoreNames.contains("schemas")) {
        db.createObjectStore("schemas", { keyPath: "sourceId" });
      }
      // rows_ stores are created dynamically
    };

    req.onsuccess = () => {
      const db = req.result;
      // Update DB_VERSION to match actual version
      DB_VERSION = db.version;
      resolve(db);
    };
    
    req.onerror = () => {
      const error = req.error;
      // Handle VersionError
      if (error.name === "VersionError") {
        // Try to open without version to get current version
        const fallbackReq = indexedDB.open(DB_NAME);
        fallbackReq.onsuccess = () => {
          const db = fallbackReq.result;
          DB_VERSION = db.version;
          db.close();
          // Retry with correct version
          dbPromise = null;
          resolve(initDB());
        };
        fallbackReq.onerror = () => reject(fallbackReq.error);
      } else {
        reject(error);
      }
    };
  });

  return dbPromise;
}

async function getDB() {
  return initDB();
}

async function ensureRowsStore(sourceId) {
  const db = await getDB();

  if (db.objectStoreNames.contains(`rows_${sourceId}`)) return;

  // Need to upgrade DB version to add a new store
  DB_VERSION = db.version + 1;
  db.close();

  const upgradePromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const upgradedDB = e.target.result;

      if (!upgradedDB.objectStoreNames.contains("sources")) {
        const srcStore = upgradedDB.createObjectStore("sources", { keyPath: "sourceId" });
        srcStore.createIndex("byName", "name", { unique: false });
      }

      if (!upgradedDB.objectStoreNames.contains("schemas")) {
        upgradedDB.createObjectStore("schemas", { keyPath: "sourceId" });
      }

      if (!upgradedDB.objectStoreNames.contains(`rows_${sourceId}`)) {
        upgradedDB.createObjectStore(`rows_${sourceId}`, {
          keyPath: "rowId",
          autoIncrement: true
        });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const upgradedDB = await upgradePromise;
  dbPromise = Promise.resolve(upgradedDB);
}

// expose globally
window.DB = { initDB, getDB, ensureRowsStore };
