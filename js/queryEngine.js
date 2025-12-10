// js/queryEngine.js
// Access getDB from window.DB when needed (don't destructure at top level)

// Valid entity types for query validation
const VALID_ENTITIES = ["loans", "checking", "customers", "deposits", "branches", "certificates", "savings", "credit cards", "mortgages", "indirect"];

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
  // Load all rows from session storage
  const allRows = await window.DB.getAllRows(source.sourceId);
  if (allRows.length === 0) {
    return [];
  }

  const predicates = conditions.map(buildPredicate);
  const logic = queryPlan.logicalOp || "AND";

  // If any condition failed to map to a field, exclude all rows from this source
  const hasUnmappedConditions = conditions.some(c => !c.field);
  if (hasUnmappedConditions) {
    console.log(`Source ${source.name}: has unmapped conditions, excluding all rows`);
    return [];
  }

  const resultRows = [];

  // Filter rows using array operations
  for (const row of allRows) {
    let keep = true;
    if (logic === "AND") {
      keep = predicates.every(fn => fn(row));
    } else if (logic === "OR") {
      keep = predicates.some(fn => fn(row));
    }

    if (keep) {
      resultRows.push({ ...row, _sourceId: source.sourceId });
    }
  }

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

  // Load all rows from session storage
  const allRows = await window.DB.getAllRows(candidateSource.sourceId);
  if (allRows.length === 0) {
    return { rows: [], usedSource: null, usedSources: [] };
  }

  const predicates = queryPlan.conditions.map(buildPredicate);
  const logic = queryPlan.logicalOp || "AND";

  const resultRows = [];

  // Filter rows using array operations
  for (const row of allRows) {
    let keep = true;
    if (logic === "AND") {
      keep = predicates.every(fn => fn(row));
    } else if (logic === "OR") {
      keep = predicates.some(fn => fn(row));
    }

    if (keep) resultRows.push(row);
  }

  return { rows: resultRows, usedSource: candidateSource, usedSources: [candidateSource] };
}

async function executeMultiSourceQuery(queryPlan, sourcesMeta) {
  const targetEntities = queryPlan.targetEntities || [];
  const uniqueId = queryPlan.uniqueId || await findUniqueIdentifierField(sourcesMeta);
  const columns = queryPlan.columns || [];
  // For multi-entity queries, collect valuation fields from each matched source
  const matchedSources = targetEntities.length
    ? sourcesMeta.filter(s => targetEntities.includes((window.DataManager.detectEntityTypes(s)[0] || '').toLowerCase()) || targetEntities.includes((s.name || '').toLowerCase()) )
    : sourcesMeta;

  // Get valuation field for each source individually, then combine
  const allValuationFields = new Set();
  for (const source of matchedSources) {
    const sourceValuationFields = await identifyValuationFields([source]);
    sourceValuationFields.forEach(field => allValuationFields.add(field));
  }
  const valuationFields = Array.from(allValuationFields);

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
  const combined = await combineMultiSourceResults(sourceResults, uniqueId, columns, valuationFields, queryPlan);

  return { rows: combined, usedSources: sourcesToQuery, uniqueId, columns, valuationFields };
}

async function combineMultiSourceResults(sourceResults, uniqueId, columns, valuationFields, queryPlan) {
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
  // Smart scoring: evaluate all fields and pick the highest-scoring valuation field
  // based on banking valuation terminology.
  const heuristics = [
    { pattern: /principal/i, score: 5 },
    { pattern: /outstanding/i, score: 3 },
    { pattern: /average|avg/i, score: 3 },
    { pattern: /balance/i, score: 5 },
    { pattern: /amount/i, score: 2 },
    { pattern: /value/i, score: 1 },
  ];

  let best = { score: 0, fieldId: null };

  for (const source of sourcesMeta) {
    const schema = await window.DataManager.getSchema(source.sourceId);
    if (!schema || !schema.fields) continue;

    for (const field of schema.fields) {
      const name = (field.name || "").toLowerCase();
      const id = (field.id || "").toLowerCase();
      let score = 0;

      heuristics.forEach(h => {
        if (h.pattern.test(name) || h.pattern.test(id)) {
          score += h.score;
          // Small bonus for exact word match
          if (name === h.pattern.source.replace(/\\|\/|i/g, '').toLowerCase() ||
              id === h.pattern.source.replace(/\\|\/|i/g, '').toLowerCase()) {
            score += 1;
          }
        }
      });

      if (score > best.score) {
        best = { score, fieldId: field.id };
      }
    }
  }

  return best.fieldId ? [best.fieldId] : [];
}

function pickSourceForEntity(entity, sourcesMeta) {
  if (!sourcesMeta || !sourcesMeta.length) return null;
  const lowerEntity = (entity || "").toLowerCase();

  // Use detectEntityTypes to properly match entities based on both name and filename
  const preferred = sourcesMeta.find(s => {
    const entities = window.DataManager.detectEntityTypes(s);
    return entities.some(e => e.toLowerCase() === lowerEntity);
  });
  
  // Return null if no match found (don't fall back to first source)
  return preferred || null;
}

/**
 * Validate a query plan before execution
 */
async function validateQueryPlan(plan, sourcesMeta = null) {
  const issues = [];
  let isValid = true;
  let confidence = 1.0;

  // Check for required fields
  if (!plan.intent) {
    issues.push("Missing intent");
    isValid = false;
    confidence = 0.0;
  }

  // Check target entities
  if (!plan.targetEntities || plan.targetEntities.length === 0) {
    issues.push("No target entities specified");
    isValid = false;
    confidence = 0.0;
  } else {
    // Ensure targetEntities are strings (convert if needed)
    const stringEntities = plan.targetEntities.map(entity =>
      typeof entity === 'string' ? entity : (entity.entity || String(entity))
    );

    // Validate entities exist in our data sources
    const invalidEntities = stringEntities.filter(entity => !VALID_ENTITIES.includes(entity));
    if (invalidEntities.length > 0) {
      issues.push(`Unknown entities: ${invalidEntities.join(", ")}`);
      isValid = false;
      confidence = Math.min(confidence, 0.3);
    }

    // If we have sourcesMeta, validate that sources exist for entities
    if (sourcesMeta && isValid) {
      for (const entity of stringEntities) {
        const source = pickSourceForEntity(entity, sourcesMeta);
        if (!source) {
          issues.push(`No data source found for entity: ${entity}`);
          isValid = false;
          confidence = Math.min(confidence, 0.5);
        }
      }
    }

    // Update plan with string entities for consistency
    plan.targetEntities = stringEntities;
  }

  // Check statistical operations
  if (plan.statisticalOp) {
    const validStats = ["mean", "average", "min", "max", "count", "sum", "standard deviation", "variance", "median"];
    if (!validStats.some(stat => plan.statisticalOp.toLowerCase().includes(stat))) {
      issues.push(`Unknown statistical operation: ${plan.statisticalOp}`);
      isValid = false;
      confidence = Math.min(confidence, 0.7);
    }

    if (!plan.statisticalField) {
      issues.push("Statistical operation specified but no field provided");
      isValid = false;
      confidence = Math.min(confidence, 0.7);
    }
  }

  // Check conditions with field validation if sourcesMeta available
  if (plan.conditions) {
    for (const condition of plan.conditions) {
      if (!condition.concept) {
        issues.push("Condition missing concept");
        isValid = false;
        confidence = Math.min(confidence, 0.8);
      }
      if (!condition.op) {
        issues.push("Condition missing operator");
        isValid = false;
        confidence = Math.min(confidence, 0.8);
      }
      if (condition.valueType && !["number", "date", "string"].includes(condition.valueType)) {
        issues.push(`Invalid condition value type: ${condition.valueType}`);
        isValid = false;
        confidence = Math.min(confidence, 0.8);
      }

      // Validate field existence if sourcesMeta is available
      if (sourcesMeta && condition.concept && plan.targetEntities) {
        let fieldFound = false;
        for (const entity of plan.targetEntities) {
          const source = pickSourceForEntity(entity, sourcesMeta);
          if (source) {
            // Try to map the condition to actual fields
            try {
              const mappedConditions = await window.ConceptMapper.mapConceptsToFields(
                source.sourceId,
                [condition]
              );
              if (mappedConditions && mappedConditions.length > 0 && mappedConditions[0].field) {
                fieldFound = true;
                break;
              }
            } catch (err) {
              // Ignore mapping errors during validation
            }
          }
        }
        if (!fieldFound) {
          issues.push(`Condition field "${condition.concept}" not found in data sources`);
          confidence = Math.min(confidence, 0.6);
        }
      }
    }
  }

  // Check for conflicting operations
  if (plan.statisticalOp && plan.functionCall) {
    issues.push("Cannot specify both statistical operation and function call");
    isValid = false;
    confidence = Math.min(confidence, 0.7);
  }

  // Reduce confidence if we have sourcesMeta but couldn't validate fields
  if (sourcesMeta && confidence > 0.8) {
    confidence = 0.8; // Leave some room for execution-time issues
  }

  return {
    isValid,
    issues,
    confidence
  };
}

/**
 * Calculate overall confidence in the query plan
 */
function calculatePlanConfidence(plan) {
  let confidence = 1.0;

  // Reduce confidence for missing entities
  if (!plan.targetEntities || plan.targetEntities.length === 0) {
    confidence *= 0.3;
  }

  // Reduce confidence for unknown entities
  if (plan.targetEntities) {
    const invalidCount = plan.targetEntities.filter(entity => !VALID_ENTITIES.includes(entity)).length;
    if (invalidCount > 0) {
      confidence *= Math.max(0.2, 1 - (invalidCount * 0.3));
    }
  }

  // Reduce confidence for complex conditions
  if (plan.conditions && plan.conditions.length > 3) {
    confidence *= 0.8;
  }

  // Reduce confidence for multi-entity queries
  if (plan.targetEntities && plan.targetEntities.length > 2) {
    confidence *= 0.7;
  }

  return Math.max(0.1, confidence);
}

// expose globally
window.QueryEngine = {
  executeQueryPlan,
  pickSourceForEntity,
  findUniqueIdentifierField,
  identifyValuationFields,
  combineMultiSourceResults,
  validateQueryPlan
};