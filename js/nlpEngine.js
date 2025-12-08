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

// Fuzzy matching configuration
const FUZZY_MATCH_THRESHOLD = 0.8; // Minimum similarity score (0-1)
const FUZZY_MAX_DISTANCE = 2; // Maximum Levenshtein distance

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a, b) {
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));

  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,     // deletion
        matrix[j - 1][i] + 1,     // insertion
        matrix[j - 1][i - 1] + indicator // substitution
      );
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity score (0-1) between two strings
 */
function calculateSimilarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;

  const distance = levenshteinDistance(a, b);
  return (maxLen - distance) / maxLen;
}

/**
 * Find fuzzy matches for an entity word in the prompt
 */
function findFuzzyEntityMatches(promptWords, entityWord) {
  const matches = [];

  for (const word of promptWords) {
    const similarity = calculateSimilarity(word.toLowerCase(), entityWord.toLowerCase());
    const distance = levenshteinDistance(word.toLowerCase(), entityWord.toLowerCase());

    if (similarity >= FUZZY_MATCH_THRESHOLD && distance <= FUZZY_MAX_DISTANCE) {
      matches.push({
        word: word,
        entity: entityWord,
        similarity: similarity,
        distance: distance
      });
    }
  }

  return matches;
}

/**
 * Normalize entity names to standard forms
 */
function normalizeEntity(entityWord) {
  const lower = entityWord.toLowerCase();
  if (lower === "loan" || lower === "loans") return "loans";
  if (lower === "customer" || lower === "customers") return "customers";
  if (lower === "checking" || lower === "accounts") return "checking";
  if (lower === "deposits") return "deposits";
  if (lower === "branch" || lower === "branches") return "branches";
  return lower;
}

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


  // Enhanced intent classification with confidence scoring
  let intent = "show"; // Default
  let intentConfidence = 0.5; // Low confidence for default

  // Check for explicit action words at start
  for (const action of ACTION_WORDS) {
    if (lower.startsWith(action + " ") || lower.startsWith(action + "s ")) {
      intent = action === "calculate" || action === "compute" ? "show" : action;
      intentConfidence = 0.95; // High confidence for explicit matches
      break;
    }
  }

  // Special case for "customers with"
  if (lower.startsWith("customers with")) {
    intent = "show";
    intentConfidence = 0.9;
  }

  // Check for implicit show intent (contains data-related words)
  if (intentConfidence < 0.8) {
    const dataWords = ["loan", "customer", "checking", "account", "branch", "balance", "rate"];
    const hasDataWords = dataWords.some(word => lower.includes(word));
    if (hasDataWords) {
      intent = "show";
      intentConfidence = 0.8; // Medium confidence for implicit intent
    }
  }

  const logicalOp = lower.includes(" and ") ? "AND" : lower.includes(" or ") ? "OR" : "AND";

  // Parse between conditions first (before splitting by and/or)
  const betweenConditions = parseBetweenConditions(text);

  // Parse conditions from remaining text after removing between clauses
  let remainingText = text;
  betweenConditions.forEach(cond => {
    // Remove the between clause from text to avoid double parsing
    const betweenRegex = new RegExp(`\\bbetween\\s+\\\$?[\\d,\\.]+\\s+and\\s+\\\$?[\\d,\\.]+`, 'gi');
    remainingText = remainingText.replace(betweenRegex, '').trim();
  });

  // Parse conditions from remaining text
  const parts = remainingText.toLowerCase()
    .split(/\b(?:and|or)\b/)
    .map(p => p.trim())
    .filter(Boolean);

  const conditions = parts.flatMap(part => parseConditionFragment(part));
  const dateConditions = extractDateConditions(text);

  // Combine all conditions
  const allConditions = [...betweenConditions, ...conditions, ...dateConditions];
  
  // Check if "branch" appears in conditions (e.g., "in branch 4", "branch number 4", "branch #4")
  const hasBranchCondition = allConditions.some(c => c.concept === "branch");
  const branchInCondition = /\b(?:in|at)\s+branch\s+(?:number\s+|no\.?\s+|#\s*)?\d+/i.test(text);

  // Enhanced entity extraction with confidence scores and fuzzy matching
  const promptWords = lower.split(/\s+/);
  const entityMatches = [];

  // Find exact matches first
  for (const entityWord of ENTITY_WORDS) {
    if (lower.includes(entityWord)) {
      // Skip branch/branches if they appear in a condition context
      const wordLower = entityWord.toLowerCase();
      if ((wordLower === "branch" || wordLower === "branches") && (hasBranchCondition || branchInCondition)) {
        continue;
      }

      entityMatches.push({
        entity: normalizeEntity(entityWord),
        confidence: 1.0, // Exact match = 100% confidence
        matchType: 'exact',
        matchedWord: entityWord
      });
    }
  }

  // Find fuzzy matches for entities not already found
  const foundEntities = new Set(entityMatches.map(m => m.entity));
  for (const entityWord of ENTITY_WORDS) {
    if (foundEntities.has(normalizeEntity(entityWord))) continue;

    const fuzzyMatches = findFuzzyEntityMatches(promptWords, entityWord);
    for (const match of fuzzyMatches) {
      // Skip branch/branches if they appear in a condition context
      const entityNormalized = normalizeEntity(entityWord);
      if ((entityNormalized === "branches") && (hasBranchCondition || branchInCondition)) {
        continue;
      }

      entityMatches.push({
        entity: entityNormalized,
        confidence: match.similarity * 0.8, // Fuzzy matches get slightly lower confidence
        matchType: 'fuzzy',
        matchedWord: match.word,
        originalEntity: entityWord
      });
    }
  }

  // Sort by confidence and remove duplicates (keep highest confidence)
  const uniqueEntities = new Map();
  for (const match of entityMatches.sort((a, b) => b.confidence - a.confidence)) {
    if (!uniqueEntities.has(match.entity)) {
      uniqueEntities.set(match.entity, match);
    }
  }

  let targetEntities = Array.from(uniqueEntities.values());


  // If no entities remain but we detected a branch condition, treat branches as the target
  if (targetEntities.length === 0 && (hasBranchCondition || branchInCondition)) {
    targetEntities.push({
      entity: "branches",
      confidence: 0.9, // High confidence for branch condition fallback
      matchType: 'condition_fallback'
    });
  }

  // Convert to final format (backward compatibility)
  const finalTargetEntities = targetEntities.map(match => match.entity);

  // Detect function calls dynamically from function libraries (moved here after entities are determined)
  // Skip function detection if we already found a statistical operation
  let functionCall = null;
  if (window.FunctionRegistry && !statisticalOp) {
    // Only detect functions for explicit function intent (not basic queries)
    const explicitFunctionWords = ['calculate', 'compute', 'determine', 'measure', 'estimate'];
    const hasExplicitFunctionIntent = explicitFunctionWords.some(word => lower.includes(word));

    // Allow function detection for "find/get + function pattern" but not basic data queries
    const hasFunctionPattern = lower.includes('average') || lower.includes('mean') ||
                              lower.includes('total') || lower.includes('sum') ||
                              lower.includes('count') || lower.includes('minimum') ||
                              lower.includes('maximum') || lower.includes('standard deviation');

    const hasFunctionIntent = hasExplicitFunctionIntent || (hasFunctionPattern && (lower.includes('find') || lower.includes('get')));

    // Skip function detection for multi-entity queries (they don't make sense)
    const isMultiEntityQuery = finalTargetEntities.length > 1;

    if (hasFunctionIntent && !isMultiEntityQuery) {
      // Dynamically get all function keywords from libraries
      const allFunctionKeywords = getAllFunctionKeywords();

      // Search for matching keywords in the prompt
      for (const keyword of allFunctionKeywords) {
        if (lower.includes(keyword.toLowerCase())) {
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
  }

  return {
    intent,
    targetEntities: Array.from(new Set(finalTargetEntities)),
    conditions: allConditions,
    logicalOp,
    statisticalOp,
    statisticalField,
    functionCall,
    raw: text,
    _entityDetails: targetEntities // Keep detailed entity info for debugging
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

/**
 * Dynamically discover all function keywords from function libraries
 */
function getAllFunctionKeywords() {
  const keywords = new Set();

  if (!window.FunctionLibrary) return Array.from(keywords);

  // Common stop words to exclude from keywords
  const stopWords = new Set([
    'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
    'an', 'a', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
    'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
    'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it',
    'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its',
    'our', 'their', 'what', 'which', 'who', 'when', 'where', 'why', 'how',
    'calculate', 'compute', 'find', 'get', 'determine', 'measure', 'estimate'
  ]);

  // Search through all libraries
  for (const libName in window.FunctionLibrary) {
    const library = window.FunctionLibrary[libName];
    if (!library || !library.functions) continue;

    for (const funcName in library.functions) {
      const func = library.functions[funcName];

      // Extract keywords from function description
      if (func.description) {
        const descWords = func.description.toLowerCase()
          .replace(/[^\w\s]/g, ' ') // Remove punctuation
          .split(/\s+/)
          .filter(word => word.length >= 3 && !stopWords.has(word));

        // Add individual meaningful words
        descWords.forEach(word => keywords.add(word));

        // Add 2-word and 3-word combinations
        for (let i = 0; i < descWords.length - 1; i++) {
          keywords.add(descWords[i] + ' ' + descWords[i + 1]);
          if (i < descWords.length - 2) {
            keywords.add(descWords[i] + ' ' + descWords[i + 1] + ' ' + descWords[i + 2]);
          }
        }
      }

      // Add function name variations
      const funcNameLower = funcName.toLowerCase();
      keywords.add(funcNameLower);

      // Add common variations
      const variations = [
        'average ' + funcNameLower,
        'mean ' + funcNameLower,
        'calculate ' + funcNameLower,
        funcNameLower + ' of',
        'find ' + funcNameLower
      ];
      variations.forEach(variation => keywords.add(variation));
    }
  }

  return Array.from(keywords).sort((a, b) => b.length - a.length); // Sort by length descending for better matching
}

function parseBetweenConditions(text) {
  const conds = [];
  const lower = text.toLowerCase();

  // Find all "between X and Y" patterns
  const betweenRegex = /\bbetween\s+\$?([\d,\.]+)\s+and\s+\$?([\d,\.]+)/gi;
  let match;

  while ((match = betweenRegex.exec(lower)) !== null) {
    const v1 = Number(match[1].replace(/,/g, ""));
    const v2 = Number(match[2].replace(/,/g, ""));

    // Use the original text around this match to determine concept
    const startPos = match.index;
    const endPos = match.index + match[0].length;
    const context = text.substring(Math.max(0, startPos - 50), endPos + 50);

    conds.push({
      concept: guessConcept(context),
      op: "between",
      valueMin: Math.min(v1, v2),
      valueMax: Math.max(v1, v2),
      valueType: "number"
    });
  }

  return conds;
}

// Extract relevant context around a condition match for better concept guessing
function extractConditionContext(fragment, matchIndex, matchLength, windowSize = 10) {
  // Get context around the match
  const start = Math.max(0, matchIndex - windowSize);
  const end = Math.min(fragment.length, matchIndex + matchLength + windowSize);
  const context = fragment.substring(start, end);

  // Try to find word boundaries for cleaner context
  const beforeMatch = fragment.substring(0, matchIndex);
  const wordsBefore = beforeMatch.split(/\s+/).filter(w => w.length > 0);
  const lastFewWords = wordsBefore.slice(-3).join(' '); // Last 3 words before match

  return lastFewWords + ' ' + fragment.substr(matchIndex, matchLength);
}

// ============================================================================
// AI-Powered Concept Resolution System (No Storage Required)
// ============================================================================

// Comprehensive banking knowledge base - pre-trained intelligence
const BANKING_KNOWLEDGE_BASE = {
  // Semantic relationships - what concepts map to what fields
  semanticMappings: {
    // Monetary concepts
    monetary: {
      concepts: ["amount", "balance", "principal", "value", "sum", "total"],
      contexts: ["over", "under", "above", "below", "greater", "less", "between"]
    },

    // Location concepts
    location: {
      concepts: ["branch", "location", "office", "region", "area"],
      contexts: ["in", "at", "from", "located"]
    },

    // Identity concepts
    identity: {
      concepts: ["id", "number", "code", "reference", "account", "customer"],
      contexts: ["with", "for", "by", "number", "code", "id"]
    },

    // Time concepts
    temporal: {
      concepts: ["date", "time", "period", "month", "year", "opened", "closed"],
      contexts: ["on", "during", "since", "before", "after"]
    }
  },

  // Domain-specific patterns learned from banking usage
  domainPatterns: {
    // Entity + Condition patterns
    "loan": {
      "over|above|greater": "principal",
      "under|below|less": "principal",
      "in|at": "branch",
      "with": "rate",
      "from": "branch"
    },

    "account|checking|savings": {
      "over|above|greater": "balance",
      "under|below|less": "balance",
      "in|at": "branch",
      "with": "rate",
      "type": "class"
    },

    "customer": {
      "with": "id",
      "in": "branch",
      "from": "branch"
    },

    "branch": {
      "number": "branch",
      "with": "location"
    }
  },

  // Linguistic patterns for intelligent parsing
  linguisticPatterns: {
    // Noun adjunct patterns (attributive nouns)
    nounAdjectives: ["number", "id", "code", "rate", "balance", "amount", "principal"],

    // Prepositions that indicate field types
    prepositionHints: {
      "over|above|greater|more": "numeric_increasing",
      "under|below|less|fewer": "numeric_decreasing",
      "in|at|from": "location_reference",
      "with|having": "attribute_reference",
      "number|id|code": "identifier_reference"
    },

    // Question patterns that suggest field types
    questionPatterns: {
      "how much|how many": "numeric_aggregation",
      "where": "location_reference",
      "what type|what kind": "category_reference"
    }
  }
};

// Session-based learning (resets on page refresh)
let sessionLearnings = new Map();
let sessionQueryHistory = [];

// Intelligent concept resolution combining multiple AI approaches
function intelligentConceptResolution(fragment, context = {}) {
  const fragment_lower = fragment.toLowerCase().trim();

  // 1. Check session learnings first (highest priority - learned from this session)
  const sessionLearned = sessionLearnings.get(fragment_lower);
  if (sessionLearned && sessionLearned.confidence > 0.8) {
    return sessionLearned;
  }

  // 2. Apply domain pattern matching (pre-trained knowledge)
  const domainResult = resolveWithDomainPatterns(fragment_lower, context);
  if (domainResult.confidence > 0.7) {
    learnFromResolution(fragment_lower, domainResult);
    return domainResult;
  }

  // 3. Linguistic analysis with semantic understanding
  const linguisticResult = resolveWithLinguisticAnalysis(fragment_lower, context);
  if (linguisticResult.confidence > 0.6) {
    learnFromResolution(fragment_lower, linguisticResult);
    return linguisticResult;
  }

  // 4. Context-aware pattern matching
  const contextResult = resolveWithContextAnalysis(fragment_lower, context);
  if (contextResult.confidence > 0.5) {
    learnFromResolution(fragment_lower, contextResult);
    return contextResult;
  }

  // 5. Statistical analysis of query history
  const statisticalResult = resolveWithStatisticalAnalysis(fragment_lower);
  if (statisticalResult.confidence > 0.4) {
    learnFromResolution(fragment_lower, statisticalResult);
    return statisticalResult;
  }

  // 6. Fallback with low confidence
  const fallbackResult = {
    concept: inferFallbackConcept(fragment_lower),
    confidence: 0.2,
    method: "fallback",
    reasoning: "No strong pattern match found"
  };

  learnFromResolution(fragment_lower, fallbackResult);
  return fallbackResult;
}

// Learn from successful resolutions within this session
function learnFromResolution(fragment, resolution) {
  sessionLearnings.set(fragment, resolution);

  // Also track in query history for statistical analysis
  sessionQueryHistory.push({
    fragment: fragment,
    resolution: resolution,
    timestamp: Date.now()
  });

  // Keep history manageable (last 100 queries)
  if (sessionQueryHistory.length > 100) {
    sessionQueryHistory = sessionQueryHistory.slice(-100);
  }
}

// Domain pattern matching using pre-trained banking knowledge
function resolveWithDomainPatterns(fragment, context) {
  // Check for entity + condition patterns
  for (const [entity, patterns] of Object.entries(BANKING_KNOWLEDGE_BASE.domainPatterns)) {
    if (fragment.includes(entity) || fragment.includes(entity + 's')) {
      // Found entity, now check for condition patterns
      for (const [conditionPattern, targetConcept] of Object.entries(patterns)) {
        const regex = new RegExp(`\\b(${conditionPattern.replace('|', '|')})\\b`, 'i');
        if (regex.test(fragment)) {
          return {
            concept: targetConcept,
            confidence: 0.85,
            method: "domain_pattern",
            reasoning: `Entity "${entity}" with condition pattern "${conditionPattern}" → "${targetConcept}"`
          };
        }
      }
    }
  }

  return { concept: null, confidence: 0 };
}

// Linguistic analysis with semantic understanding
function resolveWithLinguisticAnalysis(fragment, context) {
  const words = fragment.split(/\s+/);

  // Look for noun adjunct patterns (e.g., "branch number" → "branch")
  for (let i = 0; i < words.length - 1; i++) {
    const currentWord = words[i];
    const nextWord = words[i + 1];

    // Check if next word is a noun adjunct
    if (BANKING_KNOWLEDGE_BASE.linguisticPatterns.nounAdjectives.includes(nextWord)) {
      // Found pattern like "branch number" - the concept is the base noun
      return {
        concept: currentWord,
        confidence: 0.75,
        method: "noun_adjunct",
        reasoning: `Noun adjunct pattern: "${currentWord} ${nextWord}" → "${currentWord}"`
      };
    }
  }

  // Look for preposition hints
  for (const [prepositionPattern, hintType] of Object.entries(BANKING_KNOWLEDGE_BASE.linguisticPatterns.prepositionHints)) {
    const regex = new RegExp(`\\b(${prepositionPattern.replace('|', '|')})\\b`, 'i');
    if (regex.test(fragment)) {
      const hintConcept = mapHintTypeToConcept(hintType, fragment);
      if (hintConcept) {
        return {
          concept: hintConcept,
          confidence: 0.65,
          method: "preposition_hint",
          reasoning: `Preposition pattern "${prepositionPattern}" suggests "${hintConcept}"`
        };
      }
    }
  }

  return { concept: null, confidence: 0 };
}

// Context-aware pattern matching
function resolveWithContextAnalysis(fragment, context) {
  // Use context clues to inform resolution
  const contextHints = [];

  // Check for explicit field mentions
  if (fragment.includes("principal") || fragment.includes("loan")) {
    contextHints.push({ concept: "principal", weight: 0.8 });
  }
  if (fragment.includes("balance") || fragment.includes("account")) {
    contextHints.push({ concept: "balance", weight: 0.8 });
  }
  if (fragment.includes("branch") || fragment.includes("location")) {
    contextHints.push({ concept: "branch", weight: 0.8 });
  }
  if (fragment.includes("rate") || fragment.includes("interest")) {
    contextHints.push({ concept: "rate", weight: 0.7 });
  }

  // Check for numeric context (suggests monetary fields)
  if (fragment.match(/\$\d/) || fragment.match(/\d+\.?\d*/)) {
    if (fragment.includes("loan")) {
      contextHints.push({ concept: "principal", weight: 0.6 });
    } else {
      contextHints.push({ concept: "balance", weight: 0.6 });
    }
  }

  // Return highest weighted hint
  if (contextHints.length > 0) {
    contextHints.sort((a, b) => b.weight - a.weight);
    const bestHint = contextHints[0];
    return {
      concept: bestHint.concept,
      confidence: bestHint.weight,
      method: "context_analysis",
      reasoning: `Context analysis suggests "${bestHint.concept}"`
    };
  }

  return { concept: null, confidence: 0 };
}

// Statistical analysis of session query history
function resolveWithStatisticalAnalysis(fragment) {
  if (sessionQueryHistory.length < 3) {
    return { concept: null, confidence: 0 };
  }

  // Find similar fragments in history
  const similarFragments = sessionQueryHistory
    .filter(entry => calculateSimilarity(fragment, entry.fragment) > 0.7)
    .sort((a, b) => calculateSimilarity(fragment, b.fragment) - calculateSimilarity(fragment, a.fragment));

  if (similarFragments.length > 0) {
    // Use the most similar successful resolution
    const bestMatch = similarFragments[0];
    return {
      concept: bestMatch.resolution.concept,
      confidence: Math.min(bestMatch.resolution.confidence * 0.8, 0.55), // Slightly lower confidence for statistical matches
      method: "statistical",
      reasoning: `Similar to previous query: "${bestMatch.fragment}" → "${bestMatch.resolution.concept}"`
    };
  }

  return { concept: null, confidence: 0 };
}

// Helper functions
function mapHintTypeToConcept(hintType, fragment) {
  switch (hintType) {
    case "numeric_increasing":
    case "numeric_decreasing":
      return fragment.includes("loan") ? "principal" : "balance";
    case "location_reference":
      return "branch";
    case "attribute_reference":
      return fragment.includes("rate") ? "rate" : "balance";
    case "identifier_reference":
      return "id";
    default:
      return null;
  }
}

function inferFallbackConcept(fragment) {
  // Simple fallback based on keywords
  if (fragment.includes("branch")) return "branch";
  if (fragment.includes("balance") || fragment.includes("account")) return "balance";
  if (fragment.includes("principal") || fragment.includes("loan")) return "principal";
  if (fragment.includes("rate")) return "rate";
  if (fragment.includes("amount")) return "amount";
  return "balance"; // Most common fallback
}

function calculateSimilarity(str1, str2) {
  // Simple similarity based on common words
  const words1 = new Set(str1.toLowerCase().split(/\s+/));
  const words2 = new Set(str2.toLowerCase().split(/\s+/));

  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

// Parse individual condition patterns and extract appropriate context
function parseConditionFragment(fragment) {
  const conds = [];

  // "in branch 4", "at branch 4", "branch 4", "branch number 4", "branch no. 4", "branch #4"
  const branchMatch =
    fragment.match(/\b(?:in|at)\s+branch\s+(?:number\s+|no\.?\s+|#\s*)?(\d+)/i) ||
    fragment.match(/\bbranch\s+(?:number\s+|no\.?\s+|#\s*)?(\d+)/i);
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
    const context = extractConditionContext(fragment, betweenMatch.index, betweenMatch[0].length);
    conds.push({
      concept: guessConcept(context),
      op: "between",
      valueMin: Math.min(v1, v2),
      valueMax: Math.max(v1, v2),
      valueType: "number"
    });
  }

  // "greater than", "over", "above", "more than", "higher than", etc.
  const gtMatch = fragment.match(/(?:greater than|over|above|more than|higher than|bigger than|larger than)\s+\$?([\d,\.]+)/i);
  if (gtMatch) {
    const v = Number(gtMatch[1].replace(/,/g, ""));
    const context = extractConditionContext(fragment, gtMatch.index, gtMatch[0].length);
    conds.push({
      concept: guessConcept(context),
      op: ">",
      value: v,
      valueType: "number"
    });
  }

  const ltMatch = fragment.match(/(?:less than|under|below|fewer than|smaller than|lower than)\s+\$?([\d,\.]+)/i);
  if (ltMatch) {
    const v = Number(ltMatch[1].replace(/,/g, ""));
    const context = extractConditionContext(fragment, ltMatch.index, ltMatch[0].length);
    conds.push({
      concept: guessConcept(context),
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
  // Use the new AI-powered concept resolution system
  const result = intelligentConceptResolution(fragment, {
    isCondition: true, // This is called from condition parsing
    originalQuery: fragment
  });

  // Log the AI reasoning for debugging
  console.log(`AI Concept Resolution for "${fragment}":`, result);

  return result.concept;
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