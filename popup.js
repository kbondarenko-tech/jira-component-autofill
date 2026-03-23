(function () {
  const enabledCheckbox = document.getElementById('popup-enabled');
  const summary = document.getElementById('popup-summary');
  const openOptionsButton = document.getElementById('open-options');
  const applyNowButton = document.getElementById('apply-now');
  const showLogButton = document.getElementById('show-log');
  const clearLogButton = document.getElementById('clear-log');
  const copyLogButton = document.getElementById('copy-log');
  const messageElement = document.getElementById('popup-message');
  const logOutput = document.getElementById('log-output');

  function showMessage(text, isError) {
    messageElement.textContent = text || '';
    messageElement.className = isError ? 'message error' : 'message';
  }

  function isConnectionError(error) {
    return error && /could not establish connection|receiving end does not exist|no tab with id/i.test(error.message || '');
  }

  async function ensureContentScript(tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['storage.js', 'content.js']
      });
      // Give the scripts a moment to initialise
      await new Promise((resolve) => setTimeout(resolve, 400));
    } catch (e) {
      // May fail if already injected or page is restricted — ignore
    }
  }

  async function sendMessageWithRetry(tabId, message) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      if (isConnectionError(error)) {
        await ensureContentScript(tabId);
        return await chrome.tabs.sendMessage(tabId, message);
      }
      throw error;
    }
  }

  async function loadPopup() {
    const settings = await self.JiraComponentStorage.getSettings();
    enabledCheckbox.checked = settings.enabled;
    summary.textContent = `${settings.rules.length} rule(s) configured.`;
  }

  enabledCheckbox.addEventListener('change', async () => {
    const settings = await self.JiraComponentStorage.getSettings();
    await self.JiraComponentStorage.saveSettings({
      enabled: enabledCheckbox.checked,
      rules: settings.rules
    });
    loadPopup();
  });

  openOptionsButton.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  applyNowButton.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || typeof tab.id !== 'number') {
        throw new Error('Active Jira tab not found.');
      }

      const response = await sendMessageWithRetry(tab.id, { type: 'jira-component-autofill.apply-now' });
      if (!response || response.ok !== true) {
        throw new Error(response?.error || 'Autofill did not run.');
      }

      showMessage(response.message || 'Default component applied.', false);
    } catch (error) {
      showMessage(error.message || 'Failed to apply component.', true);
    }
  });

  async function fetchAndShowLog() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || typeof tab.id !== 'number') {
        throw new Error('Active Jira tab not found.');
      }
      const response = await sendMessageWithRetry(tab.id, { type: 'jira-component-autofill.get-log' });
      const lines = response?.log || [];
      logOutput.textContent = lines.length ? lines.join('\n') : '(log is empty)';
      logOutput.style.display = 'block';
      logOutput.closest('details').open = true;
      logOutput.scrollTop = logOutput.scrollHeight;
    } catch (error) {
      logOutput.textContent = 'Failed to get log: ' + (error.message || error);
      logOutput.style.display = 'block';
      logOutput.closest('details').open = true;
    }
  }

  showLogButton.addEventListener('click', fetchAndShowLog);

  clearLogButton.addEventListener('click', async () => {
    logOutput.textContent = '';
    logOutput.style.display = 'none';
  });

  copyLogButton.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || typeof tab.id !== 'number') throw new Error('Active Jira tab not found.');
      const response = await sendMessageWithRetry(tab.id, { type: 'jira-component-autofill.get-log' });
      const text = (response?.log || []).join('\n');
      await navigator.clipboard.writeText(text);
      showMessage('Log copied to clipboard.', false);
    } catch (error) {
      showMessage('Failed to copy: ' + (error.message || error), true);
    }
  });

  loadPopup();
})();
