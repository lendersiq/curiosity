// js/functionRegistry.js
// Function registry for discovering and executing library functions

const stopWords = new Set([
  'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
  'an', 'a', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
  'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it',
  'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its',
  'our', 'their', 'what', 'which', 'who', 'when', 'where', 'why', 'how'
]);

let cachedKeywordEntries = null;

function normalizeKeywordsFromDescription(desc) {
  const keywords = desc
    .toLowerCase()
    .split(/\s+/)
    .map(k => k.replace(/[^a-z0-9]/g, ''))
    .filter(k => k.length >= 3 && !stopWords.has(k));

  // Add stemmed/plural variations for better matching
  const expanded = new Set(keywords);
  for (const kw of keywords) {
    // Add singular/plural variations
    if (kw.endsWith('s') && kw.length > 3) {
      expanded.add(kw.slice(0, -1)); // profits -> profit
    } else if (kw.length > 3) {
      expanded.add(kw + 's'); // profit -> profits
    }

    // Add common synonyms
    if (kw === 'profit') expanded.add('earnings');
    if (kw === 'earnings') expanded.add('profit');
    if (kw === 'interest') expanded.add('rate');
    if (kw === 'rate') expanded.add('interest');
    if (kw === 'balance') expanded.add('principal');
    if (kw === 'principal') expanded.add('balance');
  }

  return Array.from(expanded);
}

function buildKeywordEntries() {
  const entries = [];
  if (!window.FunctionLibrary) return entries;

  for (const libName in window.FunctionLibrary) {
    const library = window.FunctionLibrary[libName];
    if (!library || !library.functions) continue;

    for (const funcName in library.functions) {
      const func = library.functions[funcName];
      if (!func) continue;
      const keywords = new Set();

      // From explicit keywords
      if (Array.isArray(func.keywords)) {
        func.keywords.forEach(k => {
          if (!k) return;
          const normalized = k.toLowerCase().trim();
          if (normalized && normalized.length >= 2) keywords.add(normalized);
          // Also split multi-word keywords into tokens
          normalized.split(/\s+/).forEach(tok => {
            if (tok && tok.length >= 3 && !stopWords.has(tok)) keywords.add(tok);
          });
        });
      }

      // From function name
      const fnLower = funcName.toLowerCase();
      keywords.add(fnLower);
      fnLower.split(/[^a-z0-9]+/).forEach(tok => {
        if (tok && tok.length >= 3 && !stopWords.has(tok)) keywords.add(tok);
      });

      // From description tokens
      if (func.description) {
        normalizeKeywordsFromDescription(func.description).forEach(k => keywords.add(k));
      }

      entries.push({
        library: libName,
        functionName: funcName,
        function: func,
        keywords,
        descriptionLower: (func.description || '').toLowerCase()
      });
    }
  }

  return entries;
}

function getKeywordEntries() {
  if (!cachedKeywordEntries) {
    cachedKeywordEntries = buildKeywordEntries();
  }
  return cachedKeywordEntries;
}

function clearKeywordCache() {
  cachedKeywordEntries = null;
}

/**
 * Find the best matching function for a prompt using keyword/tag scoring.
 * Now includes entity compatibility checking.
 */
function findBestFunctionByPrompt(promptText, targetEntities = []) {
  if (!promptText || !window.FunctionLibrary) return null;
  const lowerPrompt = promptText.toLowerCase();

  // Generate tokens with variations for better matching
  const baseTokens = lowerPrompt
    .split(/\s+/)
    .map(t => t.replace(/[^a-z0-9]/g, ''))
    .filter(t => t.length >= 3 && !stopWords.has(t));

  const tokens = new Set(baseTokens);
  // Add stemmed variations
  for (const t of baseTokens) {
    if (t.endsWith('s') && t.length > 3) {
      tokens.add(t.slice(0, -1)); // profits -> profit
    } else if (t.length > 3) {
      tokens.add(t + 's'); // profit -> profits
    }
  }

  if (tokens.size === 0) return null;

  const entries = getKeywordEntries();
  let best = null;
  let bestScore = 0;

  for (const entry of entries) {
    let score = 0;
    const func = entry.function;

    // Check entity compatibility if targetEntities provided
    if (targetEntities.length > 0 && func.entities && Array.isArray(func.entities)) {
      const functionEntities = func.entities;
      const hasCommonEntities = functionEntities.some(funcEntity =>
        targetEntities.some(targetEntity =>
          funcEntity.toLowerCase() === targetEntity.toLowerCase()
        )
      );

      // Skip functions that don't match target entities
      if (!hasCommonEntities) continue;
    }

    // Exact keyword phrase hits (keywords may include spaces)
    if (entry.keywords) {
      for (const kw of entry.keywords) {
        if (!kw) continue;
        if (kw.length >= 3 && lowerPrompt.includes(kw)) {
          score += 3;
        }
      }
    }

    // Token overlap
    for (const t of tokens) {
      if (entry.keywords && entry.keywords.has(t)) score += 2;
      else if (entry.descriptionLower && entry.descriptionLower.includes(t)) score += 1;
    }

    // Boost functions whose name contains key query tokens
    const funcNameLower = entry.functionName.toLowerCase();
    for (const t of tokens) {
      if (funcNameLower.includes(t) && t.length > 3) {
        score += 3; // Significant boost for name matches
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  return bestScore > 0 ? {
    library: best.library,
    functionName: best.functionName,
    function: best.function,
    entities: best.function.entities,
    returnType: best.function.returnType
  } : null;
}

/**
 * Backward-compatible search for a function matching a description or keyword.
 * Now delegates to the best-match scorer.
 */
function findFunctionByDescription(searchText) {
  return findBestFunctionByPrompt(searchText);
}

/**
 * Get function parameter names from implementation
 * This is a simple heuristic - in practice, you might want more sophisticated parsing
 */
function getFunctionParameters(func) {
  // Try to extract parameter names from function string
  const funcStr = func.implementation.toString();
  const paramMatch = funcStr.match(/function\s*\(([^)]*)\)/);
  if (paramMatch) {
    return paramMatch[1].split(',').map(p => p.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Map function parameters to actual field names from schema
 */
async function mapFunctionParameters(sourceId, functionInfo) {
  const schema = await window.DataManager.getSchema(sourceId);
  if (!schema || !schema.fields) return {};
  
  const paramNames = getFunctionParameters(functionInfo);
  const fieldMapping = {};
  
  for (const param of paramNames) {
    // Special handling for known parameter names
    let fieldName = null;
    
    // Map common parameter names to field names
    const paramLower = param.toLowerCase();
    if (paramLower === 'principal') {
      fieldName = schema.fields.find(f => 
        f.name.toLowerCase() === 'principal' || f.id.toLowerCase() === 'principal'
      )?.id;
    } else if (paramLower === 'payment') {
      // Try Last_Payment first, then Payment
      fieldName = schema.fields.find(f => 
        f.name.toLowerCase().includes('payment') || f.id.toLowerCase().includes('payment')
      )?.id;
    } else if (paramLower === 'rate') {
      fieldName = schema.fields.find(f => 
        f.name.toLowerCase() === 'rate' || f.id.toLowerCase() === 'rate'
      )?.id;
    } else if (paramLower === 'maturity') {
      // Maturity is a date field
      fieldName = schema.fields.find(f => 
        f.name.toLowerCase().includes('maturity') || f.id.toLowerCase().includes('maturity')
      )?.id;
    } else if (paramLower === 'term' || paramLower === 'termmonths') {
      // Prefer months/term fields
      fieldName = schema.fields.find(f => {
        const n = f.name.toLowerCase();
        const i = f.id.toLowerCase();
        return n === 'months' || i === 'months' ||
               n === 'term' || i === 'term' ||
               n.includes('months') || i.includes('months') ||
               n.includes('term') || i.includes('term');
      })?.id;
    }
    
    if (fieldName) {
      fieldMapping[param] = fieldName;
    } else {
      // Fallback: Try to find matching field using concept mapper
      const tempCondition = {
        concept: paramLower,
        valueType: paramLower.includes('maturity') || paramLower.includes('date') ? "date" : "number"
      };
      
      const mapped = await window.ConceptMapper.mapConceptsToFields(
        sourceId,
        [tempCondition]
      );
      
      if (mapped[0] && mapped[0].field) {
        fieldMapping[param] = mapped[0].field;
      } else {
        // Try direct field name match
        const directMatch = schema.fields.find(f => 
          f.name.toLowerCase() === paramLower ||
          f.id.toLowerCase() === paramLower
        );
        if (directMatch) {
          fieldMapping[param] = directMatch.id;
        }
      }
    }
  }
  
  return fieldMapping;
}

/**
 * Execute a function on a row of data
 */
function executeFunctionOnRow(row, functionInfo, fieldMapping) {
  const params = getFunctionParameters(functionInfo);
  const args = params.map(param => {
    const fieldName = fieldMapping[param];
    if (fieldName && row[fieldName] != null) {
      return row[fieldName];
    }
    return null;
  });
  
  try {
    return functionInfo.implementation(...args);
  } catch (err) {
    console.error('Function execution error:', err);
    return null;
  }
}

// expose globally
window.FunctionRegistry = {
  findFunctionByDescription,
  findBestFunctionByPrompt,
  getFunctionParameters,
  mapFunctionParameters,
  executeFunctionOnRow,
  clearKeywordCache
};