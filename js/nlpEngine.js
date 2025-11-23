// js/nlpEngine.js

const ACTION_WORDS = ["show", "find", "list"];
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
  
  // Check if "branch" appears in conditions (e.g., "in branch 4")
  const hasBranchCondition = conditions.some(c => c.concept === "branch_number");
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
    conditions,
    logicalOp,
    raw: text
  };
}

function parseConditionFragment(fragment) {
  const conds = [];

  // "in branch X" or "at branch X" or "branch X"
  const branchMatch = fragment.match(/\b(?:in|at)\s+branch\s+(\d+)/i) || fragment.match(/\bbranch\s+(\d+)/i);
  if (branchMatch) {
    const branchNum = Number(branchMatch[1]);
    conds.push({
      concept: "branch_number",
      op: "=",
      value: branchNum,
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

  const gtMatch = fragment.match(/greater than\s+\$?([\d,\.]+)/i);
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

function guessConcept(fragment) {
  if (fragment.includes("loan")) return "loan_amount";
  if (fragment.includes("checking") || fragment.includes("account")) return "checking_balance";
  if (fragment.includes("deposit")) return "deposit_balance";
  return "amount";
}

function guessDateConcept(fragment) {
  if (fragment.includes("closed")) return "close_date";
  if (fragment.includes("opened")) return "open_date";
  return "date";
}

// expose globally
window.NLPEngine = { parsePrompt };