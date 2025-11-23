// js/dataManager.js
// Access getDB and ensureRowsStore from window.DB when needed (don't destructure at top level)

/**
 * Simple CSV parser (no full quoted-comma handling in v1).
 */
function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  if (!lines.length) return { headers: [], rows: [] };

  const headers = lines[0].split(",").map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    const cols = line.split(",").map(c => c.trim());
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = cols[i] ?? "";
    });
    return obj;
  });

  return { headers, rows };
}

function detectType(values) {
  let numCount = 0;
  let dateCount = 0;
  let total = 0;

  for (const v of values) {
    if (v === null || v === undefined || v === "") continue;
    total++;
    const n = Number(v.toString().replace(/[^0-9.\-]/g, ""));
    if (!Number.isNaN(n) && v.toString().match(/[0-9]/)) numCount++;

    const d = new Date(v);
    if (!isNaN(d.getTime())) dateCount++;
  }

  if (!total) return "string";
  if (numCount / total > 0.8) return "number";
  if (dateCount / total > 0.8) return "date";
  return "string";
}

function guessRole(name) {
  const lower = name.toLowerCase();

  if (
    /customer(_)?id/.test(lower) ||
    /member(_)?id/.test(lower) ||
    /account(_)?id/.test(lower) ||
    /portfolio(_)?id/.test(lower) ||
    /^id$/.test(lower) ||
    /^portfolio$/.test(lower) ||
    /^reference$/.test(lower)
  ) {
    return "candidateId";
  }

  return "field";
}

async function importFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) throw new Error("No files selected");

  const imported = [];

  for (const file of files) {
    const extMatch = file.name.split(".").pop().toLowerCase();
    let parsed = null;

    if (extMatch === "csv") {
      const text = await file.text();
      parsed = parseCsv(text);
    } else if (extMatch === "json") {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error("JSON must be an array of objects");
      const headers = Object.keys(data[0] || {});
      parsed = { headers, rows: data };
    } else if (extMatch === "xlsx") {
      console.warn("XLSX support not implemented yet. Skipping:", file.name);
      continue;
    } else {
      console.warn("Unsupported file type:", file.name);
      continue;
    }

    const sourceId = file.name.replace(/[^a-zA-Z0-9_-]/g, "_") + "_" + Date.now();

    await window.DB.ensureRowsStore(sourceId);
    
    // Get fresh DB reference after ensureRowsStore (it may have closed/reopened)
    const db = await window.DB.getDB();

    // Build schema from sample rows
    const sampleRows = parsed.rows.slice(0, 100);
    const fields = parsed.headers.map(h => {
      const values = sampleRows.map(r => r[h]);
      return {
        id: h,
        name: h,
        dataType: detectType(values),
        roleGuess: guessRole(h),
        sample: values.slice(0, 5)
      };
    });

    // Create separate transaction for metadata
    const txSources = db.transaction(["sources", "schemas"], "readwrite");
    const sourcesStore = txSources.objectStore("sources");
    const schemasStore = txSources.objectStore("schemas");

    sourcesStore.put({
      sourceId,
      name: file.name.replace(/\.[^.]+$/, ""),
      originalFileName: file.name,
      lastUpdated: new Date().toISOString()
    });

    schemasStore.put({
      sourceId,
      fields
    });

    // Wait for metadata transaction to complete before moving to rows
    await new Promise((resolve, reject) => {
      txSources.oncomplete = () => resolve();
      txSources.onerror = () => reject(txSources.error);
    });

    imported.push({ sourceId, fields, name: file.name });

    // Save rows in separate transaction
    const rowsStoreName = `rows_${sourceId}`;
    const txRows = db.transaction(rowsStoreName, "readwrite");
    const rowsStore = txRows.objectStore(rowsStoreName);
    await new Promise((resolve, reject) => {
      let index = 0;
      function addNext() {
        if (index >= parsed.rows.length) {
          txRows.oncomplete = () => resolve();
          txRows.onerror = () => reject(txRows.error);
          return;
        }
        const req = rowsStore.add(parsed.rows[index]);
        index++;
        req.onsuccess = () => {
          // continue
          if (index % 500 === 0) {
            // let event loop breathe
            setTimeout(addNext, 0);
          } else {
            addNext();
          }
        };
        req.onerror = () => reject(req.error);
      }
      addNext();
    });
  }

  return imported;
}

async function listSources() {
  const db = await window.DB.getDB();
  const tx = db.transaction("sources", "readonly");
  const store = tx.objectStore("sources");
  const req = store.getAll();
  const result = await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  return result;
}

async function getSchema(sourceId) {
  const db = await window.DB.getDB();
  const tx = db.transaction("schemas", "readonly");
  const store = tx.objectStore("schemas");
  const req = store.get(sourceId);
  const result = await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  return result;
}

async function deleteSource(sourceId) {
  const db = await window.DB.getDB();
  const DB_NAME = "PrivateAIDB";
  
  // Delete from sources store
  const txSources = db.transaction("sources", "readwrite");
  const sourcesStore = txSources.objectStore("sources");
  await new Promise((resolve, reject) => {
    const req = sourcesStore.delete(sourceId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  
  // Delete from schemas store
  const txSchemas = db.transaction("schemas", "readwrite");
  const schemasStore = txSchemas.objectStore("schemas");
  await new Promise((resolve, reject) => {
    const req = schemasStore.delete(sourceId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  
  // Note: Deleting object stores requires DB upgrade, which is complex
  // For now, we'll just clear the rows store
  if (db.objectStoreNames.contains(`rows_${sourceId}`)) {
    const txRows = db.transaction(`rows_${sourceId}`, "readwrite");
    const rowsStore = txRows.objectStore(`rows_${sourceId}`);
    await new Promise((resolve, reject) => {
      const req = rowsStore.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
  
  await new Promise((resolve, reject) => {
    txSources.oncomplete = () => resolve();
    txSources.onerror = () => reject(txSources.error);
  });
}

async function updateSource(sourceId, file) {
  const extMatch = file.name.split(".").pop().toLowerCase();
  let parsed = null;
  
  if (extMatch === "csv") {
    const text = await file.text();
    parsed = parseCsv(text);
  } else if (extMatch === "json") {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error("JSON must be an array of objects");
    const headers = Object.keys(data[0] || {});
    parsed = { headers, rows: data };
  } else {
    throw new Error("Unsupported file type");
  }
  
  await window.DB.ensureRowsStore(sourceId);
  
  // Get fresh DB reference after ensureRowsStore (it may have closed/reopened)
  const db = await window.DB.getDB();
  
  const txSources = db.transaction(["sources", "schemas"], "readwrite");
  const sourcesStore = txSources.objectStore("sources");
  const schemasStore = txSources.objectStore("schemas");
  
  // Build schema from sample rows
  const sampleRows = parsed.rows.slice(0, 100);
  const fields = parsed.headers.map(h => {
    const values = sampleRows.map(r => r[h]);
    return {
      id: h,
      name: h,
      dataType: detectType(values),
      roleGuess: guessRole(h),
      sample: values.slice(0, 5)
    };
  });
  
  sourcesStore.put({
    sourceId,
    name: file.name.replace(/\.[^.]+$/, ""),
    originalFileName: file.name,
    lastUpdated: new Date().toISOString()
  });
  
  schemasStore.put({
    sourceId,
    fields
  });
  
  // Wait for metadata transaction to complete
  await new Promise((resolve, reject) => {
    txSources.oncomplete = () => resolve();
    txSources.onerror = () => reject(txSources.error);
  });
  
  // Clear and update rows in separate transaction
  const rowsStoreName = `rows_${sourceId}`;
  const txRows = db.transaction(rowsStoreName, "readwrite");
  const rowsStore = txRows.objectStore(rowsStoreName);
  
  // Clear existing rows
  await new Promise((resolve, reject) => {
    const req = rowsStore.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  
  // Add new rows
  await new Promise((resolve, reject) => {
    let index = 0;
    function addNext() {
      if (index >= parsed.rows.length) {
        txRows.oncomplete = () => resolve();
        txRows.onerror = () => reject(txRows.error);
        return;
      }
      const req = rowsStore.add(parsed.rows[index]);
      index++;
      req.onsuccess = () => {
        if (index % 500 === 0) {
          setTimeout(addNext, 0);
        } else {
          addNext();
        }
      };
      req.onerror = () => reject(req.error);
    }
    addNext();
  });
  
  return { sourceId, fields, name: file.name };
}

function detectEntityTypes(source) {
  const name = (source.name || "").toLowerCase();
  const fileName = (source.originalFileName || "").toLowerCase();
  const entities = [];
  
  if (name.includes("loan") || fileName.includes("loan")) {
    entities.push("loans");
  }
  if (name.includes("checking") || fileName.includes("checking")) {
    entities.push("checking");
  }
  if (name.includes("deposit") || fileName.includes("deposit")) {
    entities.push("deposits");
  }
  if (name.includes("customer") || fileName.includes("customer")) {
    entities.push("customers");
  }
  if (name.includes("branch") || fileName.includes("branch")) {
    entities.push("branches");
  }
  
  return entities.length > 0 ? entities : ["data"];
}

// expose globally
window.DataManager = {
  importFiles,
  listSources,
  getSchema,
  deleteSource,
  updateSource,
  detectEntityTypes
};
