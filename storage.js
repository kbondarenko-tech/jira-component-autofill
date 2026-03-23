(function () {
  const DEFAULT_SETTINGS = {
    enabled: true,
    rules: []
  };

  function normalizeText(value) {
    return String(value || '').trim();
  }

  function normalizeComponentList(value) {
    const items = Array.isArray(value) ? value : String(value || '').split(',');
    const seen = new Set();
    const normalized = [];

    for (const item of items) {
      const trimmed = normalizeText(item);
      if (!trimmed) {
        continue;
      }

      const key = trimmed.toLowerCase();
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      normalized.push(trimmed);
    }

    return normalized;
  }

  function normalizeRule(rule) {
    return {
      id: normalizeText(rule && rule.id) || String(Date.now() + Math.random()),
      projectMatcher: normalizeText(rule && rule.projectMatcher),
      components: normalizeComponentList(rule && rule.components),
      enabled: rule && rule.enabled !== false
    };
  }

  function validateRule(rule) {
    const normalized = normalizeRule(rule);
    if (!normalized.projectMatcher) {
      throw new Error('Project matcher is required.');
    }

    if (normalized.components.length === 0) {
      throw new Error('At least one component is required.');
    }

    return normalized;
  }

  async function getSettings() {
    const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    return {
      enabled: stored.enabled !== false,
      rules: Array.isArray(stored.rules) ? stored.rules.map(normalizeRule) : []
    };
  }

  async function saveSettings(settings) {
    const payload = {
      enabled: settings && settings.enabled !== false,
      rules: Array.isArray(settings && settings.rules) ? settings.rules.map(normalizeRule) : []
    };

    await chrome.storage.sync.set(payload);
    return payload;
  }

  async function upsertRule(rule) {
    const normalized = validateRule(rule);
    const settings = await getSettings();
    const nextRules = settings.rules.filter((item) => item.id !== normalized.id);
    nextRules.push(normalized);
    nextRules.sort((left, right) => left.projectMatcher.localeCompare(right.projectMatcher));

    await saveSettings({
      enabled: settings.enabled,
      rules: nextRules
    });

    return normalized;
  }

  async function deleteRule(ruleId) {
    const settings = await getSettings();
    const nextRules = settings.rules.filter((item) => item.id !== ruleId);

    await saveSettings({
      enabled: settings.enabled,
      rules: nextRules
    });
  }

  self.JiraComponentStorage = {
    DEFAULT_SETTINGS,
    normalizeRule,
    validateRule,
    normalizeComponentList,
    getSettings,
    saveSettings,
    upsertRule,
    deleteRule
  };
})();
