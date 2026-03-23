(function () {
  const enabledCheckbox = document.getElementById('extension-enabled');
  const form = document.getElementById('rule-form');
  const formTitle = document.getElementById('form-title');
  const ruleIdInput = document.getElementById('rule-id');
  const projectMatcherInput = document.getElementById('project-matcher');
  const componentsInput = document.getElementById('components');
  const ruleEnabledInput = document.getElementById('rule-enabled');
  const cancelEditButton = document.getElementById('cancel-edit');
  const messageElement = document.getElementById('message');
  const rulesEmptyElement = document.getElementById('rules-empty');
  const rulesListElement = document.getElementById('rules-list');

  function showMessage(text, isError) {
    messageElement.textContent = text || '';
    messageElement.className = isError ? 'message error' : 'message';
  }

  function resetForm() {
    formTitle.textContent = 'Add rule';
    ruleIdInput.value = '';
    projectMatcherInput.value = '';
    componentsInput.value = '';
    ruleEnabledInput.checked = true;
    cancelEditButton.hidden = true;
  }

  function populateForm(rule) {
    formTitle.textContent = 'Edit rule';
    ruleIdInput.value = rule.id;
    projectMatcherInput.value = rule.projectMatcher;
    componentsInput.value = rule.components.join(', ');
    ruleEnabledInput.checked = rule.enabled;
    cancelEditButton.hidden = false;
  }

  function renderRules(rules) {
    rulesListElement.innerHTML = '';
    rulesEmptyElement.hidden = rules.length > 0;

    for (const rule of rules) {
      const card = document.createElement('article');
      card.className = 'rule-card';

      const title = document.createElement('h3');
      title.textContent = rule.projectMatcher;

      const components = document.createElement('p');
      components.textContent = `Components: ${rule.components.join(', ')}`;

      const status = document.createElement('p');
      status.textContent = `Status: ${rule.enabled ? 'Enabled' : 'Disabled'}`;

      const actions = document.createElement('div');
      actions.className = 'actions';

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.textContent = 'Edit';
      editButton.addEventListener('click', () => populateForm(rule));

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'danger';
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', async () => {
        try {
          await self.JiraComponentStorage.deleteRule(rule.id);
          if (ruleIdInput.value === rule.id) {
            resetForm();
          }
          await loadPage();
          showMessage('Rule deleted.', false);
        } catch (error) {
          showMessage(error.message || 'Failed to delete rule.', true);
        }
      });

      actions.append(editButton, deleteButton);
      card.append(title, components, status, actions);
      rulesListElement.append(card);
    }
  }

  async function loadPage() {
    const settings = await self.JiraComponentStorage.getSettings();
    enabledCheckbox.checked = settings.enabled;
    renderRules(settings.rules);
  }

  enabledCheckbox.addEventListener('change', async () => {
    try {
      const settings = await self.JiraComponentStorage.getSettings();
      await self.JiraComponentStorage.saveSettings({
        enabled: enabledCheckbox.checked,
        rules: settings.rules
      });
      showMessage('Extension settings updated.', false);
    } catch (error) {
      showMessage(error.message || 'Failed to update extension state.', true);
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      await self.JiraComponentStorage.upsertRule({
        id: ruleIdInput.value,
        projectMatcher: projectMatcherInput.value,
        components: componentsInput.value,
        enabled: ruleEnabledInput.checked
      });

      resetForm();
      await loadPage();
      showMessage('Rule saved.', false);
    } catch (error) {
      showMessage(error.message || 'Failed to save rule.', true);
    }
  });

  cancelEditButton.addEventListener('click', () => {
    resetForm();
    showMessage('', false);
  });

  loadPage().catch((error) => {
    showMessage(error.message || 'Failed to load rules.', true);
  });
})();
