// js/conceptMapper.js
// Access getSchema from window.DataManager when needed (don't destructure at top level)

// Semantic groups: words in the same array are semantically related
// If a field name matches one word and a prompt word matches another in the same group, they're associated
const SEMANTIC_GROUPS = [
  ["branch", "branch_number", "branchnumber", "location", "office", "branch_id"],
  ["officer", "officer_id", "officerid", "rm", "rm_id", "relationship_manager", "relationshipmanager", "relationship_mgr", "relationship", "manager", "owner", "owner_id", "ownerid", "owner_code", "ownercode"],
  ["class", "type", "category", "group", "classification", "class_code", "classcode", "kind"],
  ["principal", "loan_amount", "amount", "balance", "origination", "loan_balance", "principal_amount"],
  ["checking", "checking_balance", "checking_account", "checking_amount"],
  ["deposit", "deposit_balance", "deposit_amount", "deposit_account"],
  ["rate", "rates", "interest_rate", "interest", "apr", "apy"],
  ["close", "closed", "maturity", "paid", "off", "close_date", "maturity_date", "paid_off"],
  ["open", "opened", "origination", "start", "open_date", "date_opened", "origination_date"],
  ["customer", "customer_id", "member", "member_id", "client", "client_id"],
  ["portfolio", "portfolio_id", "account", "account_id", "reference", "id"]
];

// Noun adjunct patterns: common banking nouns that often appear with identifiers
const NOUN_ADJUNCT_PATTERNS = [
  "number", "id", "code", "key", "reference", "identifier"
];

// Simple plural stemmer for translator keys
function stemPlural(word) {
  // Handle common plural endings in reverse order of specificity
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';  // companies -> company
  if (word.endsWith('es')) return word.slice(0, -2);        // branches -> branch, classes -> class
  if (word.endsWith('s')) return word.slice(0, -1);         // officers -> officer, accounts -> account
  return word;                                              // singular words unchanged
}

function tokenizeFieldName(name) {
  return name
    .replace(/[_\-]/g, " ")
    .split(/\s+/)
    .map(t => t.toLowerCase())
    .filter(Boolean);
}

// Extract base noun from noun adjunct patterns (e.g., "branch number" -> "branch")
function extractBaseNoun(concept) {
  const tokens = tokenizeFieldName(concept);

  // Check if the last token is a noun adjunct
  if (tokens.length > 1 && NOUN_ADJUNCT_PATTERNS.includes(tokens[tokens.length - 1])) {
    // Return all tokens except the last one (the noun adjunct)
    return tokens.slice(0, -1).join(" ");
  }

  return concept;
}

// Find which semantic group(s) a word belongs to
function findSemanticGroups(word) {
  const normalized = word.toLowerCase();
  const tokens = tokenizeFieldName(normalized);
  const matchingGroups = [];
  
  for (let i = 0; i < SEMANTIC_GROUPS.length; i++) {
    const group = SEMANTIC_GROUPS[i];
    for (const token of tokens) {
      // Exact match
      if (group.includes(token)) {
        matchingGroups.push(i);
        break;
      }
      // Partial match (substring)
      if (group.some(g => token.includes(g) || g.includes(token))) {
        matchingGroups.push(i);
        break;
      }
    }
  }
  
  return matchingGroups;
}

// Score how well a field name matches a concept word from the prompt
// Returns score > 0 if they share a semantic group, 0 otherwise
function scoreFieldForConcept(fieldName, conceptWord) {
  const fieldTokens = tokenizeFieldName(fieldName);
  const conceptTokens = tokenizeFieldName(conceptWord);
  
  if (!fieldTokens.length || !conceptTokens.length) return 0;
  
  // Find semantic groups for field name tokens
  const fieldGroups = new Set();
  for (const token of fieldTokens) {
    findSemanticGroups(token).forEach(g => fieldGroups.add(g));
  }
  
  // Find semantic groups for concept word tokens
  const conceptGroups = new Set();
  for (const token of conceptTokens) {
    findSemanticGroups(token).forEach(g => conceptGroups.add(g));
  }
  
  // If they share any semantic group, they're related
  const sharedGroups = [...fieldGroups].filter(g => conceptGroups.has(g));
  if (sharedGroups.length === 0) return 0;
  
  // Calculate score based on how well they match
  let score = 0;
  for (const token of fieldTokens) {
    for (const conceptToken of conceptTokens) {
      // Exact match in same group
      const tokenGroups = findSemanticGroups(token);
      const conceptTokenGroups = findSemanticGroups(conceptToken);
      if (tokenGroups.some(g => conceptTokenGroups.includes(g))) {
        if (token === conceptToken) {
          score += 3; // Exact match
        } else {
          score += 2; // Same semantic group
        }
      } else if (token.includes(conceptToken) || conceptToken.includes(token)) {
        score += 1; // Partial substring match
      }
    }
  }
  
  return score;
}

async function mapConceptsToFields(sourceId, conditions) {
  const schema = await window.DataManager.getSchema(sourceId);
  if (!schema || !schema.fields || !schema.fields.length) return conditions;

  return conditions.map(cond => {
    // Skip function-based conditions as they don't need field mapping
    if (cond.function) return cond;

    // Handle translated conditions using semantic groups
    if (cond.translated && cond.translationSource && window.Translators && window.Translators._meta) {
      console.log(`🔄 Mapping translated condition: ${cond.concept} from ${cond.translationSource}`);
      const stemmedSource = stemPlural(cond.translationSource);
      console.log(`🔄 Stemmed source: ${stemmedSource}`);
      const translatorMeta = window.Translators._meta[stemmedSource];

      if (translatorMeta) {
        console.log(`✅ Found translator meta for ${stemmedSource}`);
        // Find semantic group containing the stemmed source
        const semanticGroup = SEMANTIC_GROUPS.find(group =>
          group.some(term => term.toLowerCase() === stemmedSource.toLowerCase())
        );

        if (semanticGroup) {
          console.log(`✅ Found semantic group:`, semanticGroup);
          // Use the primary field name from the semantic group
          // For branches: "Branch", for officers: "Owner_Code", etc.
          const primaryField = semanticGroup.find(fieldName =>
            schema.fields.some(f => f.name.toLowerCase() === fieldName.toLowerCase())
          );

          if (primaryField) {
            console.log(`✅ Found primary field: ${primaryField}`);
            const actualField = schema.fields.find(f =>
              f.name.toLowerCase() === primaryField.toLowerCase()
            );
            if (actualField) {
              console.log(`✅ Mapped to actual field: ${actualField.id}`);
              const result = { ...cond, field: actualField.id.toLowerCase() };
              console.log(`✅ Returning mapped condition:`, result);
              return result;
            }
          }
        }
      }
      console.log(`❌ No mapping found for translated condition`);
      // If no mapping found, return condition as-is (don't break the flow)
      return cond;
    }

    if (!cond.concept) return cond;

    console.log(`Mapping concept "${cond.concept}" for source, ${schema.fields.length} fields available`);

    // Intelligent noun adjunct recognition
    const baseNoun = extractBaseNoun(cond.concept);
    console.log(`Base noun extracted: "${baseNoun}" from "${cond.concept}"`);

    // First priority: exact match for base noun (handles noun adjunct patterns)
    const exactBaseNounField = schema.fields.find(f =>
      f.name.toLowerCase() === baseNoun.toLowerCase() &&
      (cond.valueType !== "number" || f.dataType === "number" || f.dataType === "integer" || f.dataType === "currency") &&
      (cond.valueType !== "date" || f.dataType === "date")
    );

    if (exactBaseNounField) {
      console.log(`Using exact base noun match for "${cond.concept}": ${exactBaseNounField.name}`);
      return {
        ...cond,
        field: exactBaseNounField.id
      };
    }

    // Second priority: semantic scoring for the full concept
    let bestField = null;
    let bestScore = -1;

    for (const f of schema.fields) {
      if (cond.valueType === "number" && f.dataType !== "number" && f.dataType !== "integer" && f.dataType !== "currency") continue;
      if (cond.valueType === "date" && f.dataType !== "date") continue;

      const s = scoreFieldForConcept(f.name, cond.concept);
      console.log(`Field "${f.name}" (${f.dataType}) score for "${cond.concept}": ${s}`);

      if (s > bestScore) {
        bestScore = s;
        bestField = f;
        console.log(`New best field: "${f.name}" with score ${s}`);
      }
    }

    // If no field found, try using concept name as fallback (for debugging)
    // But prefer to return original condition if no match
    if (!bestField || bestScore <= 0) {
      // Try direct field name match as last resort
      const directMatch = schema.fields.find(f =>
        f.name.toLowerCase() === cond.concept.toLowerCase() ||
        f.id.toLowerCase() === cond.concept.toLowerCase()
      );
      if (directMatch) {
        return {
          ...cond,
          field: directMatch.id
        };
      }
      return cond;
    }

    console.log(`Best match for "${cond.concept}": ${bestField.name} (score: ${bestScore})`);
    const result = {
      ...cond,
      field: bestField.id
    };
    console.log(`Final mapping result:`, result);
    return result;
  });
}

// expose globally
window.ConceptMapper = {
  mapConceptsToFields
};