// js/queryEngine.js
// Access getDB from window.DB when needed (don't destructure at top level)

function buildNumericPredicate(cond) {
  if (!cond.field) return () => false;

  if (cond.op === "between") {
    const min = cond.valueMin;
    const max = cond.valueMax;
    return row => {
      const v = Number(
        String(row[cond.field] ?? "").replace(/[^0-9.\-]/g, "")
      );
      if (Number.isNaN(v)) return false;
      return v >= min && v <= max;
    };
  }

  if (cond.op === "=" || cond.op === ">" || cond.op === "<" || cond.op === ">=" || cond.op === "<=") {
    const value = cond.value;
    return row => {
      const v = Number(
        String(row[cond.field] ?? "").replace(/[^0-9.\-]/g, "")
      );
      if (Number.isNaN(v)) return false;
      switch (cond.op) {
        case "=": return v === value;
        case ">": return v > value;
        case "<": return v < value;
        case ">=": return v >= value;
        case "<=": return v <= value;
        default: return false;
      }
    };
  }

  return () => true;
}

function buildDatePredicate(cond) {
  if (!cond.field) return () => false;

  if (cond.absoluteDate) {
    const boundary = new Date(cond.absoluteDate);
    if (isNaN(boundary.getTime())) return () => false;

    return row => {
      const d = new Date(row[cond.field]);
      if (isNaN(d.getTime())) return false;
      if (cond.op === "after") return d >= boundary;
      if (cond.op === "before") return d <= boundary;
      return false;
    };
  }

  if (!cond.relativeTime) return () => false;

  const now = new Date();
  const boundary = new Date(now);

  const { unit, value } = cond.relativeTime;
  if (unit === "months") {
    boundary.setMonth(boundary.getMonth() - value);
  } else if (unit === "years") {
    boundary.setFullYear(boundary.getFullYear() - value);
  } else if (unit === "days") {
    boundary.setDate(boundary.getDate() - value);
  }

  return row => {
    const d = new Date(row[cond.field]);
    if (isNaN(d.getTime())) return false;
    if (cond.op === "after") return d >= boundary;
    if (cond.op === "before") return d <= boundary;
    return false;
  };
}

function buildPredicate(cond) {
  if (cond.valueType === "number") return buildNumericPredicate(cond);
  if (cond.valueType === "date") return buildDatePredicate(cond);
  return () => true;
}

async function executeQueryFromSource(queryPlan, source, conditions) {
  const db = await window.DB.getDB();
  const storeName = `rows_${source.sourceId}`;
  if (!db.objectStoreNames.contains(storeName)) {
    return [];
  }

  const tx = db.transaction(storeName, "readonly");
  const store = tx.objectStore(storeName);

  const predicates = conditions.map(buildPredicate);
  const logic = queryPlan.logicalOp || "AND";

  const resultRows = [];

  await new Promise((resolve, reject) => {
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve();
      const row = cursor.value;

      let keep = true;
      if (logic === "AND") {
        keep = predicates.every(fn => fn(row));
      } else if (logic === "OR") {
        keep = predicates.some(fn => fn(row));
      }

      if (keep) {
        resultRows.push({ ...row, _sourceId: source.sourceId });
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });

  return resultRows;
}

async function executeQueryPlan(queryPlan, sourcesMeta) {
  if (!queryPlan || !queryPlan.targetEntities?.length) {
    return { rows: [], usedSource: null, usedSources: [] };
  }

  // Multi-source query
  if (queryPlan.targetEntities.length > 1 || (queryPlan.uniqueId && queryPlan.columns)) {
    return await executeMultiSourceQuery(queryPlan, sourcesMeta);
  }

  // Single source query
  const mainEntity = queryPlan.targetEntities[0];
  const candidateSource = pickSourceForEntity(mainEntity, sourcesMeta);
  if (!candidateSource) return { rows: [], usedSource: null, usedSources: [] };

  const db = await window.DB.getDB();
  const storeName = `rows_${candidateSource.sourceId}`;
  if (!db.objectStoreNames.contains(storeName)) {
    return { rows: [], usedSource: null, usedSources: [] };
  }

  const tx = db.transaction(storeName, "readonly");
  const store = tx.objectStore(storeName);

  const predicates = queryPlan.conditions.map(buildPredicate);
  const logic = queryPlan.logicalOp || "AND";

  const resultRows = [];

  await new Promise((resolve, reject) => {
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve();
      const row = cursor.value;

      let keep = true;
      if (logic === "AND") {
        keep = predicates.every(fn => fn(row));
      } else if (logic === "OR") {
        keep = predicates.some(fn => fn(row));
      }

      if (keep) resultRows.push(row);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });

  return { rows: resultRows, usedSource: candidateSource, usedSources: [candidateSource] };
}

async function executeMultiSourceQuery(queryPlan, sourcesMeta) {
  const targetEntities = queryPlan.targetEntities || [];
  const uniqueId = queryPlan.uniqueId || await findUniqueIdentifierField(sourcesMeta);
  const columns = queryPlan.columns || [];
  const valuationFields = await identifyValuationFields(sourcesMeta);

  // Find sources for each entity
  const sourcesToQuery = [];
  for (const entity of targetEntities) {
    const source = pickSourceForEntity(entity, sourcesMeta);
    if (source) {
      sourcesToQuery.push(source);
    }
  }

  if (!sourcesToQuery.length) {
    return { rows: [], usedSources: [] };
  }

  // Get conditions mapped per source
  const allConditions = queryPlan.conditions || [];
  const sourceResults = [];

  for (const source of sourcesToQuery) {
    const schema = await window.DataManager.getSchema(source.sourceId);
    if (!schema) continue;

    // Remap conditions for this source
    const mappedConditions = await window.ConceptMapper.mapConceptsToFields(
      source.sourceId,
      allConditions
    );

    const rows = await executeQueryFromSource(queryPlan, source, mappedConditions);
    sourceResults.push({ source, rows });
  }

  // Combine results
  const combined = combineMultiSourceResults(sourceResults, uniqueId, columns, valuationFields);

  return { rows: combined, usedSources: sourcesToQuery, uniqueId, columns, valuationFields };
}

function combineMultiSourceResults(sourceResults, uniqueId, columns, valuationFields) {
  const grouped = new Map();

  // Group by unique ID
  for (const { source, rows } of sourceResults) {
    for (const row of rows) {
      const idValue = row[uniqueId];
      if (!idValue) continue;

      if (!grouped.has(idValue)) {
        grouped.set(idValue, {
          [uniqueId]: idValue,
          _rows: [],
          _sources: new Set()
        });
      }

      const group = grouped.get(idValue);
      group._rows.push({ ...row, _source: source });
      group._sources.add(source.sourceId);
    }
  }

  // Aggregate grouped data
  const aggregated = [];
  for (const [idValue, group] of grouped) {
    const agg = { [uniqueId]: idValue };

    // Sum valuation fields
    for (const field of valuationFields) {
      let sum = 0;
      for (const row of group._rows) {
        const val = Number(String(row[field] || "").replace(/[^0-9.\-]/g, ""));
        if (!Number.isNaN(val)) {
          sum += val;
        }
      }
      agg[field] = sum;
    }

    // Include condition fields (take first non-null value)
    const conditionFields = columns.filter(c => c !== uniqueId && !valuationFields.includes(c));
    for (const field of conditionFields) {
      for (const row of group._rows) {
        if (row[field] != null && row[field] !== "") {
          agg[field] = row[field];
          break;
        }
      }
    }

    // Mark as aggregated if multiple rows
    agg._isAggregated = group._rows.length > 1;
    agg._subRows = group._rows;
    agg._sourceIds = Array.from(group._sources);

    aggregated.push(agg);
  }

  return aggregated;
}

async function findUniqueIdentifierField(sourcesMeta) {
  // Check all sources for common ID fields
  const candidates = ["Portfolio", "Portfolio_ID", "ID", "Customer_ID", "Account_ID", "Reference"];
  
  // Check schemas for fields with candidateId role
  for (const source of sourcesMeta) {
    const schema = await window.DataManager.getSchema(source.sourceId);
    if (!schema || !schema.fields) continue;

    for (const field of schema.fields) {
      if (field.roleGuess === "candidateId") {
        return field.id;
      }
    }
  }

  // Fallback to common patterns
  for (const candidate of candidates) {
    for (const source of sourcesMeta) {
      const schema = await window.DataManager.getSchema(source.sourceId);
      if (!schema || !schema.fields) continue;
      
      const found = schema.fields.find(f => 
        f.id === candidate || f.name === candidate
      );
      if (found) return candidate;
    }
  }

  return "Portfolio"; // Default fallback
}

async function identifyValuationFields(sourcesMeta) {
  const valuationPatterns = ["Principal", "Average_Balance", "Balance", "Amount", "Value"];
  const found = new Set();

  // Check schemas for valuation fields
  for (const source of sourcesMeta) {
    const schema = await window.DataManager.getSchema(source.sourceId);
    if (!schema || !schema.fields) continue;

    for (const field of schema.fields) {
      const lowerName = field.name.toLowerCase();
      if (valuationPatterns.some(p => lowerName.includes(p.toLowerCase()))) {
        found.add(field.id);
      }
    }
  }

  // Add common patterns if not found
  if (found.size === 0) {
    valuationPatterns.forEach(p => found.add(p));
  }

  return Array.from(found);
}

function pickSourceForEntity(entity, sourcesMeta) {
  if (!sourcesMeta || !sourcesMeta.length) return null;
  const lowerEntity = (entity || "").toLowerCase();

  const preferred = sourcesMeta.find(s =>
    s.name.toLowerCase().includes(lowerEntity.replace(/s$/, ""))
  );
  
  // Return null if no match found (don't fall back to first source)
  return preferred || null;
}

// expose globally
window.QueryEngine = {
  executeQueryPlan,
  pickSourceForEntity,
  findUniqueIdentifierField,
  identifyValuationFields,
  combineMultiSourceResults
};