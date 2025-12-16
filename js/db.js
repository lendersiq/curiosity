// js/db.js - Direct in-memory storage (no persistence for security)
const storage = {
  sources: new Map(),
  schemas: new Map(),
  rows: new Map()
};

// Direct API for in-memory storage - no async overhead, no transactions
window.DB = {
  // Sources
  putSource: (source) => {
    storage.sources.set(source.sourceId, source);
  },
  
  getSource: (sourceId) => {
    return storage.sources.get(sourceId);
  },
  
  getAllSources: () => {
    return Array.from(storage.sources.values());
  },
  
  deleteSource: (sourceId) => {
    storage.sources.delete(sourceId);
  },
  
  // Schemas
  putSchema: (sourceId, schema) => {
    storage.schemas.set(sourceId, schema);
  },
  
  getSchema: (sourceId) => {
    return storage.schemas.get(sourceId);
  },
  
  deleteSchema: (sourceId) => {
    storage.schemas.delete(sourceId);
  },
  
  // Rows
  addRow: (sourceId, row) => {
    if (!storage.rows.has(sourceId)) {
      storage.rows.set(sourceId, []);
    }
    storage.rows.get(sourceId).push(row);
  },
  
  addRows: (sourceId, rows) => {
    if (!storage.rows.has(sourceId)) {
      storage.rows.set(sourceId, []);
    }
    const existing = storage.rows.get(sourceId);
    existing.push(...rows);
  },
  
  getAllRows: (sourceId) => {
    return storage.rows.get(sourceId) || [];
  },
  
  clearRows: (sourceId) => {
    storage.rows.set(sourceId, []);
  },
  
  deleteRows: (sourceId) => {
    storage.rows.delete(sourceId);
  },
  
  // Legacy compatibility methods (for gradual migration)
  initDB: () => Promise.resolve({}),
  getDB: () => Promise.resolve({}),
  ensureRowsStore: (sourceId) => Promise.resolve()
};
