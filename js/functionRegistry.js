// js/functionRegistry.js
// Function registry for discovering and executing library functions

/**
 * Search for functions matching a description or keyword
 */
function findFunctionByDescription(searchText) {
  if (!window.FunctionLibrary) return null;
  
  const lower = searchText.toLowerCase();
  const keywords = lower.split(/\s+/);
  
  // Search through all libraries
  for (const libName in window.FunctionLibrary) {
    const library = window.FunctionLibrary[libName];
    if (!library || !library.functions) continue;
    
    for (const funcName in library.functions) {
      const func = library.functions[funcName];
      const descLower = func.description.toLowerCase();
      
      // Check if any keyword matches the description
      for (const keyword of keywords) {
        if (keyword.length < 3) continue; // Skip short words
        if (descLower.includes(keyword)) {
          return {
            library: libName,
            functionName: funcName,
            function: func
          };
        }
      }
    }
  }
  
  return null;
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
    } else if (paramLower === 'term') {
      // Try Months first, then Term
      fieldName = schema.fields.find(f => 
        f.name.toLowerCase() === 'months' || f.id.toLowerCase() === 'months' ||
        f.name.toLowerCase() === 'term' || f.id.toLowerCase() === 'term'
      )?.id;
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
  getFunctionParameters,
  mapFunctionParameters,
  executeFunctionOnRow
};

