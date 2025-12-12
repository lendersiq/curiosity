// translator/translator_loader.js
// Ensures a global translator registry and merges any preloaded data from custom_translator.js.

(function() {
  const root = (window.Translators = window.Translators || {});
  root._meta = root._meta || {};

  function normalizeMap(map) {
    const normalized = {};
    if (!map) return normalized;
    for (const [k, v] of Object.entries(map)) {
      if (k == null) continue;
      normalized[k] = v;
      const lower = k.toString().toLowerCase();
      normalized[lower] = v;
    }
    return normalized;
  }

  // Normalize any pre-populated translators (e.g., from custom_translator.js)
  for (const [type, map] of Object.entries(root)) {
    if (type === '_meta' || type === 'registerTranslator') continue;
    root[type] = normalizeMap(map);
    root._meta[type] = root._meta[type] || { synonyms: [] };
  }

  function registerTranslator(type, map, meta = {}) {
    if (!type || !map) return;
    if (!root[type]) root[type] = {};
    const normalized = normalizeMap(map);
    Object.assign(root[type], normalized);
    root._meta[type] = {
      synonyms: Array.isArray(meta.synonyms) ? meta.synonyms : (root._meta[type]?.synonyms || [])
    };
    console.log(`🧭 Translator registered [${type}]:`, normalized, 'meta:', root._meta[type]);
  }

  // Expose registry
  root.registerTranslator = registerTranslator;

})();

