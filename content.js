(function () {
  const STATE = {
    isApplying: false,
    componentCache: new Map()
  };

  const LOG_MAX = 60;
  const LOG = [];

  function dbg(message, detail) {
    const ts = new Date().toTimeString().slice(0, 8);
    const line = detail !== undefined
      ? `[${ts}] ${message}: ${JSON.stringify(detail)}`
      : `[${ts}] ${message}`;
    if (LOG.length >= LOG_MAX) LOG.shift();
    LOG.push(line);
  }

  function warn(message, details) {
    dbg(message, details);
  }

  const LABELS = {
    space: 'space',
    project: 'project',
    components: 'components',
    component: 'component'
  };

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function lowerText(value) {
    return normalizeText(value).toLowerCase();
  }

  function normalizeLabelText(value) {
    return lowerText(value).replace(/\*/g, '').replace(/\s+/g, ' ').trim();
  }

  function isVisible(element) {
    if (!element || !(element instanceof Element)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function collectCandidateLabels(container, labelText) {
    const exact = normalizeLabelText(labelText);
    const selectors = ['label', 'legend', '[data-testid*="label"]', 'span', 'div'];
    const candidates = [];

    for (const selector of selectors) {
      for (const element of container.querySelectorAll(selector)) {
        if (!isVisible(element)) {
          continue;
        }

        const text = normalizeLabelText(element.textContent);
        if (text === exact || text.startsWith(`${exact} `) || text.includes(`${exact} required`)) {
          candidates.push(element);
        }
      }
    }

    return candidates;
  }

  function getInteractiveElements(root) {
    if (!root || !root.querySelectorAll) {
      return [];
    }

    return Array.from(
      root.querySelectorAll(
        'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [role="combobox"]'
      )
    ).filter(isVisible);
  }

  function scoreFieldRoot(root, labelText) {
    const interactiveCount = getInteractiveElements(root).length;
    const textLength = normalizeText(root.innerText || root.textContent || '').length;
    const containsLabel = normalizeLabelText(root.innerText || root.textContent || '').includes(
      normalizeLabelText(labelText)
    );

    if (!containsLabel || interactiveCount === 0) {
      return null;
    }

    return {
      root,
      interactiveCount,
      textLength
    };
  }

  function findBestFieldRootFromElement(element, labelText) {
    const candidates = [];
    let current = element;

    for (let depth = 0; current && depth < 8; depth += 1) {
      const score = scoreFieldRoot(current, labelText);
      if (score) {
        candidates.push(score);
      }

      current = current.parentElement;
    }

    candidates.sort((left, right) => {
      if (left.interactiveCount !== right.interactiveCount) {
        return left.interactiveCount - right.interactiveCount;
      }

      return left.textLength - right.textLength;
    });

    return candidates[0]?.root || element.parentElement || null;
  }

  function findFieldRoot(container, labelText) {
    const ariaElement = container.querySelector(
      `input[aria-label="${labelText}"], textarea[aria-label="${labelText}"], [role="combobox"][aria-label="${labelText}"]`
    );

    if (ariaElement) {
      return findBestFieldRootFromElement(ariaElement, labelText);
    }

    const labels = collectCandidateLabels(container, labelText);
    for (const label of labels) {
      if (label.tagName === 'LABEL' && label.htmlFor) {
        const target = container.querySelector(`#${CSS.escape(label.htmlFor)}`) || document.getElementById(label.htmlFor);
        if (target) {
          return findBestFieldRootFromElement(target, labelText);
        }
      }

      const fieldRoot = findBestFieldRootFromElement(label, labelText);
      if (fieldRoot) {
        return fieldRoot;
      }
    }

    return null;
  }

  function findEditableInput(fieldRoot, fallbackAriaLabel) {
    if (!fieldRoot) {
      return null;
    }

    return (
      fieldRoot.querySelector('[role="combobox"] input:not([type="hidden"]):not([disabled])') ||
      fieldRoot.querySelector('input[aria-autocomplete]:not([type="hidden"]):not([disabled])') ||
      fieldRoot.querySelector('input:not([type="hidden"]):not([disabled])') ||
      fieldRoot.querySelector('textarea:not([disabled])') ||
      document.querySelector(`input[aria-label="${fallbackAriaLabel}"]`)
    );
  }

  function findDropdownTrigger(fieldRoot) {
    if (!fieldRoot) {
      return null;
    }

    const selectors = [
      '[role="combobox"]',
      '[aria-haspopup="listbox"]',
      'button',
      'select',
      'input:not([type="hidden"]):not([disabled])'
    ];

    for (const selector of selectors) {
      const match = fieldRoot.querySelector(selector);
      if (match && isVisible(match)) {
        return match;
      }
    }

    return null;
  }

  function readFieldText(fieldRoot, fieldLabel) {
    if (!fieldRoot) {
      return '';
    }

    const text = normalizeText(fieldRoot.innerText || fieldRoot.textContent || '');
    return normalizeText(text.replace(new RegExp(fieldLabel, 'ig'), ''));
  }

  function fieldHasSelectedValues(fieldRoot) {
    if (!fieldRoot) {
      return false;
    }

    // Search inside fieldRoot and the nearest dialog/form
    const scopeEl = fieldRoot.closest('[role="dialog"], form') || fieldRoot.parentElement || fieldRoot;
    for (const root of [fieldRoot, scopeEl]) {
      if (
        root.querySelector('[aria-label^="Remove "]') ||
        root.querySelector('[data-testid*="multi-value"]') ||
        root.querySelector('[data-testid*="selected-value"]')
      ) {
        return true;
      }
    }

    // native select with a non-empty value
    const selectEl = fieldRoot.querySelector('select');
    if (selectEl && selectEl.value && selectEl.value.trim() !== '') {
      return true;
    }

    // text input with non-empty content (unlikely for components)
    const inputEl = fieldRoot.querySelector('input:not([type="hidden"])');
    if (inputEl && inputEl.value && inputEl.value.trim() !== '') {
      return true;
    }

    return false;
  }

  function readLockedFieldValue(container, labelText) {
    const exact = normalizeLabelText(labelText);
    const labels = collectCandidateLabels(container, labelText);
    dbg(`readLockedFieldValue(${labelText}) labels found`, labels.length);
    for (const label of labels) {
      // Walk up to find an ancestor that contains more text than just the label itself
      let el = label.parentElement;
      for (let depth = 0; el && depth < 6; depth += 1) {
        const text = normalizeText(el.innerText || el.textContent || '');
        const stripped = normalizeText(text.replace(new RegExp(exact, 'ig'), '').replace(/\*/g, ''));
        if (stripped.length > 2) {
          dbg(`readLockedFieldValue(${labelText}) found value`, stripped);
          return lowerText(stripped);
        }
        el = el.parentElement;
      }
    }
    dbg(`readLockedFieldValue(${labelText}) no value found`);
    return '';
  }

  function readContextText(contextFieldRoot) {
    return lowerText(
      readFieldText(contextFieldRoot, LABELS.space) ||
      readFieldText(contextFieldRoot, LABELS.project)
    );
  }

  function getProjectKeyFromUrl() {
    try {
      const href = window.location.href || '';
      const projectMatch = href.match(/\/projects\/([A-Z0-9_]+)/i);
      if (projectMatch && projectMatch[1]) {
        return lowerText(projectMatch[1]);
      }

      const issueMatch = href.match(/selectedIssue=([A-Z0-9_]+)-\d+/i);
      if (issueMatch && issueMatch[1]) {
        return lowerText(issueMatch[1]);
      }
    } catch (e) {
      // ignore
    }

    return '';
  }

  async function getSettings() {
    try {
      return await self.JiraComponentStorage.getSettings();
    } catch (e) {
      return { enabled: true, rules: [] };
    }
  }

  async function fetchComponentsForProject(projectKey) {
    const key = lowerText(String(projectKey || '').trim());
    if (!key) return [];
    if (STATE.componentCache.has(key)) {
      return STATE.componentCache.get(key);
    }
    try {
      const resp = await fetch(`/rest/api/3/project/${encodeURIComponent(projectKey)}/components`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin'
      });
      if (!resp.ok) {
        return [];
      }
      const data = await resp.json();
      if (Array.isArray(data)) {
        STATE.componentCache.set(key, data);
        return data;
      }
      return [];
    } catch (e) {
      return [];
    }
  }

  async function getComponentId(projectKey, componentName) {
    const components = await fetchComponentsForProject(projectKey);
    const target = lowerText(componentName || '');
    const found = components.find((c) => lowerText(c.name || '') === target);
    return found ? String(found.id) : null;
  }

  function findRuleForProject(settings, projectKeyOrId) {
    const key = lowerText(String(projectKeyOrId || '').trim());
    if (!key) return null;
    return settings.rules.find((rule) => rule.enabled && key.includes(lowerText(rule.projectMatcher || ''))) || null;
  }

  async function injectComponentsIntoPayload(payload, rule) {
    if (!payload || !payload.fields || !rule || !Array.isArray(rule.components) || rule.components.length === 0) {
      return payload;
    }
    if (Array.isArray(payload.fields.components) && payload.fields.components.length > 0) {
      return payload;
    }
    const name = rule.components[0];
    if (!name) return payload;

    const projectKey = payload.fields?.project?.key || payload.fields?.project?.id || getProjectKeyFromUrl();
    let componentEntry = { name };

    const id = await getComponentId(projectKey, name);
    if (id) {
      componentEntry = { id };
    }

    payload.fields.components = [componentEntry];
    return payload;
  }

  function patchFetch() {
    const originalFetch = window.fetch;
    window.fetch = async function patchedFetch(input, init = {}) {
      try {
        const url = typeof input === 'string' ? input : input?.url || '';
        const method = (init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
        if (method === 'POST' && url.includes('/rest/api/3/issue')) {
          let body = init.body;
          if (typeof body === 'string') {
            try {
              const parsed = JSON.parse(body);
              const currentSettings = await getSettings();
              if (currentSettings.enabled) {
                const projectKey = parsed?.fields?.project?.key || parsed?.fields?.project?.id || getProjectKeyFromUrl();
                const rule = findRuleForProject(currentSettings, projectKey);
                const updated = await injectComponentsIntoPayload(parsed, rule);
                init = { ...init, body: JSON.stringify(updated) };
              }
            } catch (e) {
              // ignore parse errors
            }
          }
        }
      } catch (e) {
        // ignore
      }
      return originalFetch(input, init);
    };
  }

  function patchXHR() {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function patchedOpen(method, url, async, user, password) {
      this.__jiraAutoMethod = (method || '').toUpperCase();
      this.__jiraAutoUrl = url || '';
      return originalOpen.call(this, method, url, async, user, password);
    };

    XMLHttpRequest.prototype.send = function patchedSend(body) {
      const xhr = this;
      try {
        if (xhr.__jiraAutoMethod === 'POST' && typeof xhr.__jiraAutoUrl === 'string' && xhr.__jiraAutoUrl.includes('/rest/api/3/issue')) {
          if (typeof body === 'string') {
            try {
              const parsed = JSON.parse(body);
              getSettings().then(async (currentSettings) => {
                if (!currentSettings.enabled) {
                  return originalSend.call(xhr, body);
                }
                const projectKey = parsed?.fields?.project?.key || parsed?.fields?.project?.id || getProjectKeyFromUrl();
                const rule = findRuleForProject(currentSettings, projectKey);
                const updated = await injectComponentsIntoPayload(parsed, rule);
                return originalSend.call(xhr, JSON.stringify(updated));
              }).catch(() => originalSend.call(xhr, body));
              return;
            } catch (e) {
              // ignore parse errors
            }
          }
        }
      } catch (e) {
        // ignore
      }
      return originalSend.call(xhr, body);
    };
  }

  function findComponentsFieldRoot(container) {
    return findFieldRoot(container, 'Components') || findFieldRoot(container, 'Component');
  }

  function matchesContextRule(contextFieldRoot, rule) {
    const projectText = readContextText(contextFieldRoot);
    const matcher = lowerText(rule.projectMatcher);
    return Boolean(projectText) && Boolean(matcher) && projectText.includes(matcher);
  }

  function markContainerApplied(container, signature) {
    container.dataset.jiraComponentAutofill = signature;
  }

  function hasContainerBeenApplied(container, signature) {
    return container.dataset.jiraComponentAutofill === signature;
  }

  function setNativeValue(input, value) {
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function pressKey(element, key) {
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        bubbles: true
      })
    );
    element.dispatchEvent(
      new KeyboardEvent('keyup', {
        key,
        bubbles: true
      })
    );
  }

  function clickElement(element) {
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    element.click();
  }

  function setNativeSelectValue(selectElement, componentName) {
    const expected = lowerText(componentName);
    const option = Array.from(selectElement.options || []).find((item) => {
      return lowerText(item.textContent || item.label || item.value) === expected;
    });

    if (!option) {
      return false;
    }

    selectElement.value = option.value;
    selectElement.dispatchEvent(new Event('input', { bubbles: true }));
    selectElement.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function isOnScreen(element) {
    try {
      const r = element.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch (e) {
      return false;
    }
  }

  function optionText(element) {
    return lowerText(element.innerText || element.textContent || '');
  }

  // Wait for a dropdown portal (listbox/menu) to appear after trigger click
  async function waitForDropdownPortal(timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const portals = Array.from(
        document.querySelectorAll('[role="listbox"], [role="menu"], [data-testid*="menu"], [data-testid*="dropdown"], [data-testid*="popup"]')
      ).filter(isOnScreen);
      if (portals.length > 0) return portals[portals.length - 1]; // last = most recently opened
      await wait(80);
    }
    return null;
  }

  // Find an option inside a specific portal container
  function findOptionInPortal(portal, componentName) {
    const expected = lowerText(componentName);
    const candidates = Array.from(
      portal.querySelectorAll('[role="option"], [role="menuitem"], li, div, span')
    ).filter((el) => {
      if (!isOnScreen(el)) return false;
      const text = optionText(el);
      return text.includes(expected) && text.length < 120;
    });
    const exact = candidates.find((el) => optionText(el) === expected);
    return exact || candidates[0] || null;
  }

  async function waitForOption(componentName, timeoutMs) {
    const startedAt = Date.now();
    const expected = lowerText(componentName);

    while (Date.now() - startedAt < timeoutMs) {
      // First try: search within any visible listbox/menu portal
      const portals = Array.from(
        document.querySelectorAll('[role="listbox"], [role="menu"]')
      ).filter(isOnScreen);
      for (const portal of portals) {
        const found = findOptionInPortal(portal, componentName);
        if (found) return found;
      }
      // Fallback: global search with extended roles
      const options = Array.from(
        document.querySelectorAll('[role="option"], [role="menuitemcheckbox"], [role="menuitem"]')
      ).filter((el) => isOnScreen(el) && optionText(el).includes(expected));
      const exact = options.find((el) => optionText(el) === expected);
      if (exact) return exact;
      if (options[0]) return options[0];

      await wait(100);
    }

    return null;
  }

  function componentAlreadySelected(fieldRoot, componentName) {
    const target = lowerText(componentName);

    // Search inside fieldRoot and nearest dialog/form
    const scopeEl = fieldRoot.closest('[role="dialog"], form') || fieldRoot.parentElement || fieldRoot;

    for (const root of [fieldRoot, scopeEl]) {
      // Standard chip selectors (Remove button aria-label)
      const chips = Array.from(root.querySelectorAll(
        '[aria-label^="Remove "], [aria-label^="remove "]'
      ));
      if (chips.some((el) => lowerText(el.getAttribute('aria-label') || '').includes(target))) {
        return true;
      }
      // Atlaskit/react-select multi-value containers
      const valueContainers = Array.from(root.querySelectorAll(
        '[data-testid*="multi-value"], [data-testid*="selected-value"], [class*="-multiValue"], [class*="multiValue"]'
      ));
      if (valueContainers.some((el) => lowerText(el.textContent).includes(target))) {
        return true;
      }
    }

    const selectEl = fieldRoot.querySelector('select');
    if (selectEl && selectEl.value && lowerText(selectEl.options[selectEl.selectedIndex || 0]?.text || '').includes(target)) {
      return true;
    }

    // Log what chips ARE present to help diagnose
    const scopeChips = Array.from(scopeEl.querySelectorAll('[aria-label^="Remove "], [aria-label^="remove "]'));
    dbg('componentAlreadySelected chips', scopeChips.map((el) => el.getAttribute('aria-label')));

    return false;
  }

  async function addComponent(fieldRoot, componentName) {
    if (componentAlreadySelected(fieldRoot, componentName)) {
      return true;
    }

    try {
      fieldRoot.scrollIntoView({ block: 'center' });
    } catch (e) {
      // ignore
    }

    const nativeSelect = fieldRoot.querySelector('select:not([disabled])');
    if (nativeSelect && setNativeSelectValue(nativeSelect, componentName)) {
      await wait(150);
      return componentAlreadySelected(fieldRoot, componentName);
    }

    // Find the combobox input directly — Jira renders input[role="combobox"] itself
    // (not a wrapper with role=combobox containing an input)
    let input =
      fieldRoot.querySelector('input[role="combobox"]:not([disabled])') ||
      fieldRoot.querySelector('input[aria-autocomplete]:not([disabled])') ||
      fieldRoot.querySelector('input:not([type="hidden"]):not([disabled])');

    // If not found inside fieldRoot, search the whole document by testid pattern.
    // Use the exact --input suffix to avoid matching --input-container divs.
    if (!input) {
      const byTestid =
        document.querySelector('[data-testid$="components-field-select--input"]') ||
        document.querySelector('[data-testid*="components-field-select"][data-testid$="--input"]') ||
        document.querySelector('[data-testid*="component"][data-testid$="--input"]');
      // byTestid may still be a container div — unwrap if needed
      if (byTestid && byTestid.tagName === 'INPUT') {
        input = byTestid;
      } else if (byTestid) {
        input = byTestid.querySelector('input:not([type="hidden"]):not([disabled])') || null;
      }
    }

    // Last resort: if fieldRoot produced a non-input element somehow, unwrap it
    if (input && input.tagName !== 'INPUT' && input.tagName !== 'TEXTAREA') {
      input = input.querySelector('input[role="combobox"]:not([disabled])') ||
              input.querySelector('input:not([type="hidden"]):not([disabled])') ||
              null;
    }

    dbg('components input found', input ? {
      tag: input.tagName,
      role: input.getAttribute('role'),
      testid: input.getAttribute('data-testid')
    } : null);

    if (!input) {
      dbg('components input not found in fieldRoot');
      return false;
    }

    // Click to open dropdown, then type to filter
    input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    input.click();
    input.focus();
    await wait(400);

    setNativeValue(input, componentName);
    await wait(800);

    // Look for matching options — Jira uses role="option" inside a portal
    // after typing; also check role="menuitem" and role="menuitemcheckbox"
    const option = await waitForOption(componentName, 2500);
    dbg('option found after typing', !!option);
    if (option) {
      clickElement(option);
      await wait(800);

      // Primary check: did the chip appear?
      if (componentAlreadySelected(fieldRoot, componentName)) {
        return true;
      }

      // Reliable fallback: Jira removes already-selected options from the dropdown.
      // Open the dropdown again and check if our option is gone → it was selected.
      input.focus();
      input.click();
      await wait(500);
      const stillAvailable = await waitForOption(componentName, 600);
      dbg('option still available after click (false = selected)', !!stillAvailable);
      // Close dropdown
      pressKey(input, 'Escape');
      await wait(200);
      if (!stillAvailable) {
        // Option disappeared from list → was selected
        return true;
      }

      return false;
    }

    // Keyboard fallback: ArrowDown + Enter
    dbg('option not found, falling back to keyboard select', componentName);
    input.focus();
    pressKey(input, 'ArrowDown');
    await wait(150);
    pressKey(input, 'Enter');
    await wait(300);
    return componentAlreadySelected(fieldRoot, componentName);
  }

  async function applyNow() {
    dbg('applyNow called');
    if (STATE.isApplying) {
      dbg('applyNow skipped: already applying');
      return {
        ok: false,
        error: 'Autofill is already running.'
      };
    }

    const settings = await self.JiraComponentStorage.getSettings();
    dbg('settings', { enabled: settings.enabled, ruleCount: settings.rules.length });
    if (!settings.enabled) {
      return {
        ok: false,
        error: 'Extension is disabled in options.'
      };
    }

    const containers = findCreateContainers();
    dbg('containers found', containers.length);
    if (containers.length === 0) {
      return {
        ok: false,
        error: 'Create Task form was not found on the page.'
      };
    }

    for (const container of containers) {
      const projectFieldRoot = findFieldRoot(container, 'Project') || findFieldRoot(container, 'Space');
      dbg('projectFieldRoot found', !!projectFieldRoot);
      const projectTextFromField = projectFieldRoot ? readContextText(projectFieldRoot) : '';
      dbg('projectTextFromField', projectTextFromField);
      const projectText =
        projectTextFromField ||
        readLockedFieldValue(container, 'Space') ||
        readLockedFieldValue(container, 'Project') ||
        getProjectKeyFromUrl();
      dbg('projectText (final)', projectText);
      const componentsFieldRoot = findComponentsFieldRoot(container);
      dbg('componentsFieldRoot found', !!componentsFieldRoot);
      if (!componentsFieldRoot) {
        dbg('skipping container: no components field');
        continue;
      }

      const matchedRules = settings.rules.filter((rule) => {
        if (!rule.enabled) return false;
        if (projectFieldRoot && matchesContextRule(projectFieldRoot, rule)) return true;
        if (projectText && lowerText(rule.projectMatcher) && projectText.includes(lowerText(rule.projectMatcher))) return true;
        return false;
      });
      dbg('matchedRules count', matchedRules.length);
      dbg('all rule matchers', settings.rules.map((r) => r.projectMatcher));
      if (matchedRules.length !== 1) {
        dbg('skipping container: matched ' + matchedRules.length + ' rules (need exactly 1)');
        continue;
      }

      const rule = matchedRules[0];
      const signature = `${rule.projectMatcher}::${rule.components.join('|')}`;

      if (hasContainerBeenApplied(container, signature)) {
        dbg('container already applied, skipping');
        return {
          ok: true,
          message: 'Components already applied.'
        };
      }

      if (fieldHasSelectedValues(componentsFieldRoot)) {
        dbg('components field already has values');
        markContainerApplied(container, signature);
        return {
          ok: true,
          message: 'Components already filled.'
        };
      }
      dbg('applying components', rule.components);
      STATE.isApplying = true;
      let allApplied = true;
      try {
        for (const componentName of rule.components) {
          const result = await addComponent(componentsFieldRoot, componentName);
          dbg('addComponent result', { componentName, result });
          if (!result) allApplied = false;
        }
      } finally {
        STATE.isApplying = false;
      }
      if (allApplied) {
        markContainerApplied(container, signature);
        return {
          ok: true,
          message: `Applied component rule for ${rule.projectMatcher}.`
        };
      }
      // addComponent failed — do not mark as applied so the next MutationObserver
      // trigger can retry (e.g. when the form finishes rendering)
      dbg('addComponent failed, will retry on next DOM change');
      return {
        ok: false,
        error: 'Could not select component — will retry automatically.'
      };
    }

    dbg('no matching rule found for any container');
    return {
      ok: false,
      error: 'No matching enabled rule was found for the current Space/Project.'
    };
  }

  function findCreateContainers() {
    const visibleDialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter((element) => {
      return isVisible(element) && /create/i.test(normalizeText(element.textContent));
    });

    if (visibleDialogs.length > 0) {
      return visibleDialogs.slice(0, 1);
    }

    const candidates = new Set();

    for (const element of document.querySelectorAll('[role="dialog"], form, [data-testid*="issue-create"]')) {
      const hasProject = findFieldRoot(element, 'Project') || findFieldRoot(element, 'Space');
      const hasComponents = findComponentsFieldRoot(element);
      if (hasProject && hasComponents) {
        candidates.add(element);
      }
    }

    if (
      (findFieldRoot(document.body, 'Project') || findFieldRoot(document.body, 'Space')) &&
      findComponentsFieldRoot(document.body)
    ) {
      candidates.add(document.body);
    }

    return Array.from(candidates);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'jira-component-autofill.get-log') {
      sendResponse({ log: LOG.slice() });
      return true;
    }

    if (message?.type !== 'jira-component-autofill.apply-now') {
      return undefined;
    }

    applyNow()
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error.message || 'Autofill failed.'
        })
      );

    return true;
  });

  // Patch outbound issue creation requests to inject default component if missing
  patchFetch();
  patchXHR();
  chrome.runtime.sendMessage({ type: 'jira-component-autofill.ready' }, () => {});

  // Auto-apply when a create-issue dialog becomes visible
  let _autofillDebounce = null;
  const _observer = new MutationObserver(() => {
    if (STATE.isApplying) return;
    const hasDialog = Array.from(document.querySelectorAll('[role="dialog"]')).some(isVisible);
    if (!hasDialog) return;
    clearTimeout(_autofillDebounce);
    _autofillDebounce = setTimeout(() => {
      applyNow().catch(() => {});
    }, 1200);
  });
  _observer.observe(document.body, { childList: true, subtree: true });

})();
