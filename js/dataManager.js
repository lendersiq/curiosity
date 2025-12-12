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
  let integerCount = 0;
  let currencyCount = 0;
  let percentageCount = 0;
  let decimalCount = 0;
  let maxNumeric = Number.NEGATIVE_INFINITY;
  let dateCount = 0;
  let total = 0;

  for (const v of values) {
    if (v === null || v === undefined || v === "") continue;
    total++;

    // Check for dates first - be very strict to avoid false positives
    const str = v.toString().trim();

    // Only consider it a potential date if it has date-like formatting
    let isPotentialDate = false;

    // Check for common date separators and formats
    if (str.includes('/') || str.includes('-') || /^\d{4}-\d{2}-\d{2}/.test(str) ||
        /^\d{2}\/\d{2}\/\d{4}/.test(str) || /^\d{2}-\d{2}-\d{4}/.test(str) ||
        /^\d{4}\/\d{2}\/\d{2}/.test(str)) {
      isPotentialDate = true;
    }

    // Also check for month names or common date words
    if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b/i.test(str) ||
        /\b(mon|tue|wed|thu|fri|sat|sun)\w*\b/i.test(str)) {
      isPotentialDate = true;
    }

    if (isPotentialDate) {
      const d = new Date(v);
      // Additional validation: date shouldn't be from Unix epoch start
      if (!isNaN(d.getTime()) && d.getTime() > 0 && d.getFullYear() > 1900 && d.getFullYear() < 2100) {
        dateCount++;
        continue;
      }
    }

    // Check for numeric / percentage values
    const rawStr = v.toString();
    const isPercent = rawStr.trim().endsWith("%");
    const cleanValue = rawStr.replace(/[^0-9.\-]/g, "");
    const n = Number(cleanValue);
    if (!Number.isNaN(n) && v.toString().match(/[0-9]/)) {
      numCount++;

      if (isPercent) {
        percentageCount++;
      }

      if (!Number.isInteger(n)) {
        decimalCount++;
      }

      if (n > maxNumeric) maxNumeric = n;

      // Check if it's an integer (no decimal point)
      if (Number.isInteger(n)) {
        integerCount++;
      }
      // Check if it's currency (has decimal point or currency symbols)
      else if (v.toString().match(/[\.,]/) || v.toString().match(/[$€£¥]/)) {
        currencyCount++;
      }
    }
  }

  if (!total) return "string";
  if (dateCount / total > 0.8) return "date";

  // If majority are percentages, classify as percentage
  if (percentageCount / total > 0.8) return "percentage";

  // Heuristic: decimal numeric values that are all <= 1 are likely rates/percentages
  if (numCount / total > 0.8 && decimalCount / Math.max(numCount,1) > 0.3 && maxNumeric <= 1) {
    return "percentage";
  }

  // If more than 80% are numeric, determine the subtype
  if (numCount / total > 0.8) {
    // If all numeric values are integers, classify as integer
    if (integerCount === numCount) {
      return "integer";
    }
    // If we have currency indicators, classify as currency
    else if (currencyCount > 0) {
      return "currency";
    }
    // Default to currency for decimal numbers
    else {
      return "currency";
    }
  }

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
  console.log('🏭 Starting importFiles with:', fileList);
  const files = Array.from(fileList || []);
  console.log('📋 Files array:', files);
  if (!files.length) throw new Error("No files selected");

  console.log('🔄 Processing', files.length, 'files...');
  const imported = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    console.log(`📄 Processing file ${i + 1}/${files.length}:`, file.name, 'size:', file.size, 'type:', file.type);

    const extMatch = file.name.split(".").pop().toLowerCase();
    console.log(`🔍 File extension: ${extMatch}`);
    let parsed = null;

    try {
      if (extMatch === "csv") {
        console.log('📖 Reading CSV file...');
        const text = await file.text();
        console.log('📖 CSV text length:', text.length);
        parsed = parseCsv(text);
        console.log('📊 CSV parsed, headers:', parsed.headers?.length, 'rows:', parsed.rows?.length);
      } else if (extMatch === "json") {
        console.log('📖 Reading JSON file...');
        const text = await file.text();
        console.log('📖 JSON text length:', text.length);
        const data = JSON.parse(text);
        if (!Array.isArray(data)) throw new Error("JSON must be an array of objects");
        const headers = Object.keys(data[0] || {});
        parsed = { headers, rows: data };
        console.log('📊 JSON parsed, headers:', headers?.length, 'rows:', data?.length);
      } else if (extMatch === "xlsx") {
        console.warn("XLSX support not implemented yet. Skipping:", file.name);
        continue;
      } else {
        console.warn("Unsupported file type:", file.name);
        continue;
      }
    } catch (error) {
      console.error(`❌ Error processing file ${file.name}:`, error);
      throw error;
    }

    console.log(`🔢 Generating source ID for ${file.name}...`);
    const sourceId = file.name.replace(/[^a-zA-Z0-9_-]/g, "_") + "_" + Date.now();
    console.log(`🆔 Source ID: ${sourceId}`);

    console.log(`💾 Ensuring rows store for ${sourceId}...`);
    await window.DB.ensureRowsStore(sourceId);
    console.log(`✅ Rows store ensured`);

    // Get fresh DB reference after ensureRowsStore (it may have closed/reopened)
    console.log(`🔌 Getting DB reference...`);
    const db = await window.DB.getDB();
    console.log(`✅ DB reference obtained`);

    // Build schema from sample rows
    console.log(`🏗️ Building schema from ${parsed.rows.length} rows...`);
    const sampleRows = parsed.rows.slice(0, 100);
    console.log(`📊 Using sample of ${sampleRows.length} rows for schema detection`);
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
    console.log(`📋 Schema built with ${fields.length} fields`);
    console.log(`📋 Field types:`, fields.map(f => `${f.name}: ${f.dataType}`));

    // Detect and register translators (e.g., branch name → branch id)
    const translatorInfo = detectTranslator(fields);
    if (translatorInfo) {
      const translatorMap = buildTranslatorMap(translatorInfo, parsed.rows);
      if (translatorMap && Object.keys(translatorMap).length) {
        ensureTranslatorRegistry();
        window.Translators.registerTranslator(translatorInfo.type, translatorMap);
      }
    }

    // Create separate transaction for metadata
    console.log(`💾 Storing metadata for source ${sourceId}...`);
    const txSources = db.transaction(["sources", "schemas"], "readwrite");
    const sourcesStore = txSources.objectStore("sources");
    const schemasStore = txSources.objectStore("schemas");

    console.log(`📝 Storing source info...`);
    sourcesStore.put({
      sourceId,
      name: file.name.replace(/\.[^.]+$/, ""),
      originalFileName: file.name,
      lastUpdated: new Date().toISOString()
    });

    console.log(`📋 Storing schema...`);
    schemasStore.put({
      sourceId,
      fields
    });

    // Wait for metadata transaction to complete before moving to rows
    console.log(`⏳ Waiting for metadata transaction to complete...`);
    await new Promise((resolve, reject) => {
      txSources.oncomplete = () => {
        console.log(`✅ Metadata transaction completed`);
        resolve();
      };
      txSources.onerror = () => {
        console.error(`❌ Metadata transaction failed:`, txSources.error);
        reject(txSources.error);
      };
    });

    console.log(`✅ Adding source ${sourceId} to imported list`);
    imported.push({ sourceId, fields, name: file.name });

    // Save rows in batches to avoid transaction timeout
    // Session storage operations are fast and don't timeout
    // We'll process in batches of 1000 rows per transaction
    const rowsStoreName = `rows_${sourceId}`;
    const batchSize = 1000;
    const totalRows = parsed.rows.length;

    console.log(`💾 Storing ${totalRows} rows in batches of ${batchSize}...`);

    for (let startIndex = 0; startIndex < totalRows; startIndex += batchSize) {
      const endIndex = Math.min(startIndex + batchSize, totalRows);
      const batch = parsed.rows.slice(startIndex, endIndex);
      const batchNumber = Math.floor(startIndex / batchSize) + 1;
      const totalBatches = Math.ceil(totalRows / batchSize);

      console.log(`📦 Processing batch ${batchNumber}/${totalBatches}: rows ${startIndex + 1}-${endIndex}`);

      // Create a fresh transaction for each batch
      const db = await window.DB.getDB();
      const txRows = db.transaction(rowsStoreName, "readwrite");
      const rowsStore = txRows.objectStore(rowsStoreName);

      await new Promise((resolve, reject) => {
        let index = 0;
        function addNext() {
          if (index >= batch.length) {
            console.log(`✅ Batch ${batchNumber} completed`);
            txRows.oncomplete = () => resolve();
            txRows.onerror = () => reject(txRows.error);
            return;
          }
          const req = rowsStore.add(batch[index]);
          index++;
          if (index % 100 === 0) {
            console.log(`📝 Batch ${batchNumber}: processed ${index}/${batch.length} rows`);
          }
          req.onsuccess = () => {
            addNext();
          };
          req.onerror = () => reject(req.error);
        }
        addNext();
      });
    }

    console.log(`🎉 File ${file.name} processing completed`);
  }

  // Log memory usage after import (if supported by the environment)
  try {
    if (performance && performance.memory) {
      const { usedJSHeapSize, totalJSHeapSize } = performance.memory;
      console.log(`🧠 Memory after import: used ${formatBytes(usedJSHeapSize)} / total ${formatBytes(totalJSHeapSize)}`);
    } else {
      console.log('🧠 Memory after import: performance.memory not available in this environment');
    }
  } catch (e) {
    console.log('ℹ️ Memory usage check failed:', e.message);
  }

  console.log('✅ importFiles completed, returning:', imported);
  return imported;
}

function ensureTranslatorRegistry() {
  if (!window.Translators) {
    window.Translators = { registerTranslator: (type, map) => { window.Translators[type] = { ...(window.Translators[type] || {}), ...map }; } };
  } else if (typeof window.Translators.registerTranslator !== 'function') {
    window.Translators.registerTranslator = (type, map) => {
      if (!window.Translators[type]) window.Translators[type] = {};
      Object.assign(window.Translators[type], map);
    };
  }
}

function detectTranslator(fields) {
  if (!fields || fields.length < 2) return null;
  const lowerFields = fields.map(f => ({ ...f, lower: f.name.toLowerCase(), idLower: f.id.toLowerCase() }));

  // Simple two-column map detectors
  const integerField = lowerFields.find(f => f.dataType === 'integer');
  const stringField = lowerFields.find(f => f.dataType !== 'integer');

  if (!integerField || !stringField) return null;

  // Branch translator: branch_number + branch_name
  const isBranchTranslator =
    (integerField.lower.includes('branch') || integerField.idLower.includes('branch')) &&
    (stringField.lower.includes('branch') || stringField.idLower.includes('branch') || stringField.lower.includes('name'));

  if (isBranchTranslator) {
    return {
      type: 'branches',
      idField: integerField.id,
      nameField: stringField.id
    };
  }

  // Officer translator: officer_id + officer_name
  const isOfficerTranslator =
    (integerField.lower.includes('officer') || integerField.idLower.includes('officer') || integerField.lower.includes('rm') || integerField.idLower.includes('rm') || integerField.lower.includes('id')) &&
    (stringField.lower.includes('officer') || stringField.idLower.includes('officer') || stringField.lower.includes('name'));

  if (isOfficerTranslator) {
    return {
      type: 'officer',
      idField: integerField.id,
      nameField: stringField.id
    };
  }

  return null;
}

function buildTranslatorMap(info, rows) {
  const map = {};
  if (!info || !rows || !rows.length) return map;
  const { idField, nameField } = info;
  rows.forEach(r => {
    const nameRaw = r[nameField];
    const codeRaw = r[idField];
    const key = nameRaw == null ? '' : nameRaw.toString().trim().toLowerCase();
    const code = Number(codeRaw);
    if (key && !Number.isNaN(code)) {
      map[key] = code;
    }
  });
  console.log(`🧭 Translator detected [${info.type}]`, map);
  return map;
}

function formatBytes(bytes) {
  if (bytes === 0 || bytes == null) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${sizes[i]}`;
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
  
  // Clear existing rows in a single transaction
  const txClear = db.transaction(rowsStoreName, "readwrite");
  const clearStore = txClear.objectStore(rowsStoreName);
  await new Promise((resolve, reject) => {
    const req = clearStore.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    txClear.oncomplete = () => resolve();
    txClear.onerror = () => reject(txClear.error);
  });
  
  // Add new rows in batches to avoid transaction timeout
  // IndexedDB transactions can timeout if they take too long
  const batchSize = 1000;
  const totalRows = parsed.rows.length;
  
  for (let startIndex = 0; startIndex < totalRows; startIndex += batchSize) {
    const endIndex = Math.min(startIndex + batchSize, totalRows);
    const batch = parsed.rows.slice(startIndex, endIndex);
    
    // Create a fresh transaction for each batch
    const txRows = db.transaction(rowsStoreName, "readwrite");
    const rowsStore = txRows.objectStore(rowsStoreName);
    
    await new Promise((resolve, reject) => {
      let index = 0;
      function addNext() {
        if (index >= batch.length) {
          txRows.oncomplete = () => resolve();
          txRows.onerror = () => reject(txRows.error);
          return;
        }
        const req = rowsStore.add(batch[index]);
        index++;
        req.onsuccess = () => {
          addNext();
        };
        req.onerror = () => reject(req.error);
      }
      addNext();
    });
  }

  return { sourceId, fields, name: file.name };
}

function detectEntityTypes(source) {
  const name = (source.name || "").toLowerCase();
  const fileName = (source.originalFileName || "").toLowerCase();
  const entities = [];
  
  if (name.includes("loan") || fileName.includes("loan")) {
    entities.push("loans");
  }
  // DDA = Demand Deposit Account = checking account
  if (name.includes("checking") || fileName.includes("checking") || 
      name.includes("dda") || fileName.includes("dda")) {
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
