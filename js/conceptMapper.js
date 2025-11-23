// js/conceptMapper.js
// Access getSchema from window.DataManager when needed (don't destructure at top level)

const CONCEPT_VOCAB = {
  loan_amount: ["loan", "amount", "principal", "balance", "origination"],
  checking_balance: ["checking", "balance", "avg", "average"],
  deposit_balance: ["deposit", "balance", "avg", "average"],
  close_date: ["close", "closed", "maturity", "paid", "off"],
  open_date: ["open", "opened", "origination", "start"],
  branch_number: ["branch", "branch_number", "branchnumber"]
};

function tokenizeFieldName(name) {
  return name
    .replace(/[_\-]/g, " ")
    .split(/\s+/)
    .map(t => t.toLowerCase())
    .filter(Boolean);
}

function scoreFieldForConcept(fieldName, concept) {
  const tokens = tokenizeFieldName(fieldName);
  const vocab = CONCEPT_VOCAB[concept] || [];
  if (!vocab.length || !tokens.length) return 0;

  let score = 0;
  for (const t of tokens) {
    if (vocab.includes(t)) score += 2;
    else {
      if (vocab.some(v => t.includes(v) || v.includes(t))) score += 1;
    }
  }
  return score;
}

async function mapConceptsToFields(sourceId, conditions) {
  const schema = await window.DataManager.getSchema(sourceId);
  if (!schema || !schema.fields || !schema.fields.length) return conditions;

  return conditions.map(cond => {
    if (!cond.concept) return cond;

    let bestField = null;
    let bestScore = -1;

    for (const f of schema.fields) {
      if (cond.valueType === "number" && f.dataType !== "number") continue;
      if (cond.valueType === "date" && f.dataType !== "date") continue;

      const s = scoreFieldForConcept(f.name, cond.concept);
      if (s > bestScore) {
        bestScore = s;
        bestField = f;
      }
    }

    if (!bestField) return cond;

    return {
      ...cond,
      field: bestField.id
    };
  });
}

// expose globally
window.ConceptMapper = {
  mapConceptsToFields
};