'use strict';

// Ghostery's Electron adapter executes each scriptlet in the page's global
// scope. Helpers with the same name then overwrite one another: a second
// proxyApplyFn replaces the function used by an existing toString proxy,
// making that proxy call itself. Keep helpers local to each injection while
// retaining the scriptlet's intended changes to the page APIs.
function isolateScriptlets(engine) {
  const getFilters = engine.getCosmeticsFilters.bind(engine);
  engine.getCosmeticsFilters = function (...args) {
    const result = getFilters(...args);
    return { ...result, scripts: result.scripts.map(script => `(() => {\n${script}\n})();`) };
  };
  return engine;
}

module.exports = { isolateScriptlets };
