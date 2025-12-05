// js/nlpEngine.js

const ACTION_WORDS = ["show", "find", "list", "share", "calculate", "compute", "get"];
const STATISTICAL_OPERATIONS = [
  "mean", "average", "avg",
  "standard deviation", "std dev", "stddev", "std",
  "median",
  "min", "minimum",
  "max", "maximum",
  "sum",
  "count",
  "variance"
];
const ENTITY_WORDS = [
  "loan",
  "loans",
  "customer",
  "customers",
  "checking",
  "accounts",
  "deposits",
  "branch",
  "branches"
];

function parsePrompt(prompt) {
  const text = (prompt || "").trim();
  if (!text) {
    return {
      intent: null,
      targetEntities: [],
      conditions: [],
      logicalOp: "AND",
      raw: text
    };
  }

  const lower = text.toLowerCase();

  // Detect statistical operations
  let statisticalOp = null;
  let statisticalField = null;
  
  for (const op of STATISTICAL_OPERATIONS) {
    const opLower = op.toLowerCase();
    // Look for patterns like "standard deviation of X" or "mean of X" or "share standard deviation of X"
    const opPattern = new RegExp(`\\b${opLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+of\\s+([^\\s]+(?:\\s+[^\\s]+)*)`, 'i');
    const match = text.match(opPattern);
    if (match) {
      statisticalOp = opLower;
      // Extract the field name (e.g., "loan rates" -> "rate")
      const fieldPhrase = match[1].toLowerCase();
      statisticalField = extractFieldFromPhrase(fieldPhrase);
      break;
    }
  }

  // Detect function calls (e.g., "average balance", "average principal")
  let functionCall = null;
  if (window.FunctionRegistry) {
    // Search for function keywords in the prompt
    const functionKeywords = [
      'average balance',
      'average principal', 
      'mean balance',
      'mean principal',
      'average loan balance',
      'average loan principal'
    ];
    
    for (const keyword of functionKeywords) {
      if (lower.includes(keyword)) {
        const found = window.FunctionRegistry.findFunctionByDescription(keyword);
        if (found) {
          functionCall = {
            library: found.library,
            functionName: found.functionName,
            description: found.function.description
          };
          break;
        }
      }
    }
    
    // Also try searching by individual words if no match found
    if (!functionCall) {
      const words = lower.split(/\s+/);
      for (let i = 0; i < words.length - 1; i++) {
        const phrase = words[i] + ' ' + words[i + 1];
        const found = window.FunctionRegistry.findFunctionByDescription(phrase);
        if (found) {
          functionCall = {
            library: found.library,
            functionName: found.functionName,
            description: found.function.description
          };
          break;
        }
      }
    }
  }

  const intent =
    ACTION_WORDS.find(w => lower.startsWith(w + " ") || lower.startsWith(w + "s ")) ||
    (lower.startsWith("customers with") ? "show" : "show");

  const logicalOp = lower.includes(" and ") ? "AND" : lower.includes(" or ") ? "OR" : "AND";

  // Parse conditions first to identify branch conditions
  const parts = lower
    .split(/\b(?:and|or)\b/)
    .map(p => p.trim())
    .filter(Boolean);

  const conditions = parts.flatMap(part => parseConditionFragment(part));
  const dateConditions = extractDateConditions(text);
  
  // Check if "branch" appears in conditions (e.g., "in branch 4")
  const hasBranchCondition = [...conditions, ...dateConditions].some(c => c.concept === "branch");
  const branchInCondition = /\b(?:in|at)\s+branch\s+(\d+)/i.test(text);

  // Extract target entities, but exclude "branch"/"branches" if they're in a condition
  const targetEntities = ENTITY_WORDS.filter(w => {
    const wordLower = w.toLowerCase();
    // Skip branch/branches if they appear in a condition context
    if ((wordLower === "branch" || wordLower === "branches") && (hasBranchCondition || branchInCondition)) {
      return false;
    }
    return lower.includes(w);
  }).map(w => {
    if (w === "loan" || w === "loans") return "loans";
    if (w === "customer" || w === "customers") return "customers";
    if (w === "checking" || w === "accounts") return "checking";
    if (w === "deposits") return "deposits";
    if (w === "branch" || w === "branches") return "branches";
    return w;
  });

  return {
    intent,
    targetEntities: Array.from(new Set(targetEntities)),
    conditions: [...conditions, ...dateConditions],
    logicalOp,
    statisticalOp,
    statisticalField,
    functionCall,
    raw: text
  };
}

function extractFieldFromPhrase(phrase) {
  // Extract field name from phrases like "loan rates" -> "rate", "checking balances" -> "balance"
  const lower = phrase.toLowerCase();
  
  // Common field name patterns
  if (lower.includes("rate") || lower.includes("rates")) return "rate";
  if (lower.includes("balance") || lower.includes("balances")) return "balance";
  if (lower.includes("principal")) return "principal";
  if (lower.includes("amount")) return "amount";
  if (lower.includes("payment")) return "payment";
  if (lower.includes("charge") || lower.includes("charges")) return "charge";
  
  // If phrase contains "loan" or "checking", try to extract the actual field
  // "loan rates" -> "rate", "checking balances" -> "balance"
  const words = lower.split(/\s+/);
  for (const word of words) {
    if (word !== "loan" && word !== "loans" && word !== "checking" && word !== "account" && word !== "accounts") {
      return word;
    }
  }
  
  return phrase; // Fallback to original phrase
}

function parseDateString(text) {
  if (!text) return null;
  const cleaned = text.trim().replace(/,/g, " ").replace(/\s+/g, " ");

  // Try native Date parsing first
  const native = new Date(cleaned);
  if (!isNaN(native.getTime())) return native;

  const numericMatch = cleaned.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (numericMatch) {
    const month = Number(numericMatch[1]);
    const day = Number(numericMatch[2]);
    let year = Number(numericMatch[3]);
    if (year < 100) year += 2000;
    const date = new Date(year, month - 1, day);
    if (!isNaN(date.getTime())) return date;
  }

  const isoMatch = cleaned.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const date = new Date(year, month - 1, day);
    if (!isNaN(date.getTime())) return date;
  }

  const monthNameMatch = cleaned.match(
    /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i
  );
  if (monthNameMatch) {
    const monthName = monthNameMatch[1].toLowerCase();
    const day = Number(monthNameMatch[2]);
    const year = Number(monthNameMatch[3]);
    const monthNames = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const month = monthNames.findIndex(m => monthName.startsWith(m));
    if (month >= 0) {
      const date = new Date(year, month, day);
      if (!isNaN(date.getTime())) return date;
    }
  }

  return null;
}

function parseConditionFragment(fragment) {
  const conds = [];

  // "in branch X" or "at branch X" or "branch X"
  const branchMatch = fragment.match(/\b(?:in|at)\s+branch\s+(\d+)/i) || fragment.match(/\bbranch\s+(\d+)/i);
  if (branchMatch) {
    const branchNum = Number(branchMatch[1]);
    conds.push({
      concept: "branch", // Use actual prompt word, not concept ID
      op: "=",
      value: branchNum,
      valueType: "number"
    });
  }

  // "of type X" or "type X"
  const typeMatch = fragment.match(/\b(?:of\s+)?type\s+(\d+)/i);
  if (typeMatch) {
    const typeValue = Number(typeMatch[1]);
    conds.push({
      concept: "type", // Use actual prompt word, not concept ID
      op: "=",
      value: typeValue,
      valueType: "number"
    });
  }

  // between X and Y
  const betweenMatch = fragment.match(
    /between\s+\$?([\d,\.]+)\s+and\s+\$?([\d,\.]+)/i
  );
  if (betweenMatch) {
    const v1 = Number(betweenMatch[1].replace(/,/g, ""));
    const v2 = Number(betweenMatch[2].replace(/,/g, ""));
    conds.push({
      concept: guessConcept(fragment),
      op: "between",
      valueMin: Math.min(v1, v2),
      valueMax: Math.max(v1, v2),
      valueType: "number"
    });
  }

  // "greater than" or "over"
  const gtMatch = fragment.match(/(?:greater than|over)\s+\$?([\d,\.]+)/i);
  if (gtMatch) {
    const v = Number(gtMatch[1].replace(/,/g, ""));
    conds.push({
      concept: guessConcept(fragment),
      op: ">",
      value: v,
      valueType: "number"
    });
  }

  const ltMatch = fragment.match(/less than\s+\$?([\d,\.]+)/i);
  if (ltMatch) {
    const v = Number(ltMatch[1].replace(/,/g, ""));
    conds.push({
      concept: guessConcept(fragment),
      op: "<",
      value: v,
      valueType: "number"
    });
  }

  const timeMatch = fragment.match(/last\s+(\d+)\s+(month|months|year|years|day|days)/i);
  if (timeMatch) {
    const value = Number(timeMatch[1]);
    const unitWord = timeMatch[2];
    let unit = "months";
    if (unitWord.startsWith("year")) unit = "years";
    if (unitWord.startsWith("day")) unit = "days";

    conds.push({
      concept: guessDateConcept(fragment),
      op: "after",
      relativeTime: {
        unit,
        value
      },
      valueType: "date"
    });
  }

  return conds;
}

function extractDateConditions(text) {
  const conds = [];
  if (!text) return conds;

  const regex = /\b(?:(opened|open|closed|close|matured|maturity)\s+)?(before|after)\s+([0-9a-zA-Z\/\-\.,\s]+?)(?=\s+(?:and|or)\b|$)/gi;
  let lastField = null;
  let match;

  while ((match = regex.exec(text)) !== null) {
    let fieldWord = match[1] ? match[1].toLowerCase() : lastField;
    if (!fieldWord) continue;

    // Update last field reference when explicit field provided
    if (match[1]) {
      lastField = fieldWord;
    }

    const opWord = match[2].toLowerCase();
    const dateText = match[3].trim();
    const parsedDate = parseDateString(dateText);
    if (!parsedDate) continue;

    const concept =
      fieldWord.includes("open") ? "open" :
      fieldWord.includes("close") ? "close" :
      "maturity";

    conds.push({
      concept,
      op: opWord === "before" ? "before" : "after",
      valueType: "date",
      absoluteDate: parsedDate.toISOString()
    });
  }

  return conds;
}

function guessConcept(fragment) {
  // Return the actual word from the prompt, not a concept ID
  // The concept mapper will match via semantic groups
  if (fragment.includes("principal")) return "principal";
  if (fragment.includes("loan")) return "loan";
  if (fragment.includes("checking")) return "checking";
  if (fragment.includes("account")) return "account";
  if (fragment.includes("deposit")) return "deposit";
  if (fragment.includes("branch")) return "branch";
  if (fragment.includes("type")) return "type";
  if (fragment.includes("class")) return "class";
  if (fragment.includes("amount")) return "amount";
  if (fragment.includes("balance")) return "balance";
  return "amount"; // Default fallback
}

function guessDateConcept(fragment) {
  // Return the actual word from the prompt
  if (fragment.includes("closed") || fragment.includes("close")) return "close";
  if (fragment.includes("opened") || fragment.includes("open")) return "open";
  if (fragment.includes("maturity")) return "maturity";
  return "date";
}

// expose globally
window.NLPEngine = { parsePrompt };