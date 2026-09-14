(function(root) {
  'use strict';

  const FIELD_CONFIGS = [
    { selector: '.ann-input', prefix: 'announcements' },
    { selector: '.church-news-input', prefix: 'churchNews' },
    { selector: '#prayerHome', id: 'prayer.homeRest' },
    { selector: '#prayerHospital', id: 'prayer.hospital' },
    { selector: '#prayerOther', id: 'prayer.other' }
  ];

  function buildProofreadingPayload(fields) {
    return (Array.isArray(fields) ? fields : [])
      .filter(field => field && field.id != null && String(field.text || '').trim())
      .map(field => ({
        id: String(field.id),
        text: String(field.text || '').trim()
      }));
  }

  function getResponseItems(response) {
    if (Array.isArray(response)) return response;
    if (response && Array.isArray(response.suggestions)) return response.suggestions;
    if (response && Array.isArray(response.data)) return response.data;
    return [];
  }

  function normalizeProofreadingResponse(response, requestedFields) {
    const requested = buildProofreadingPayload(requestedFields);
    const requestedById = new Map(requested.map(field => [field.id, field]));
    const responseById = new Map();

    getResponseItems(response).forEach(item => {
      const id = item && item.id != null ? String(item.id) : '';
      if (requestedById.has(id) && !responseById.has(id)) responseById.set(id, item);
    });

    return requested.map(field => {
      const item = responseById.get(field.id) || {};
      const suggestion = typeof item.suggestion === 'string' && item.suggestion.trim()
        ? item.suggestion.trim()
        : field.text;
      const changed = typeof item.changed === 'boolean'
        ? item.changed
        : suggestion !== field.text;
      return {
        id: field.id,
        text: field.text,
        suggestion,
        changed,
        note: typeof item.note === 'string' ? item.note.trim() : ''
      };
    });
  }

  function getFieldId(textarea, config, index) {
    if (config.id) return config.id;
    return `${config.prefix}.${index}`;
  }

  function getDocumentOptions(document) {
    return document && document._sundayBulletinAiOptions
      ? document._sundayBulletinAiOptions
      : {};
  }

  function toggleClass(element, className, force) {
    if (!element || !element.classList) return;
    if (force && typeof element.classList.add === 'function') {
      element.classList.add(className);
    } else if (!force && typeof element.classList.remove === 'function') {
      element.classList.remove(className);
    }
  }

  function setSuggestionControls(textarea, options) {
    const opts = options || {};
    const hasChange = Boolean(opts.hasChange);
    const applied = Boolean(opts.applied);
    const checkbox = textarea && textarea._aiSuggestionCheckbox;
    const applyButton = textarea && textarea._aiApplyButton;

    if (checkbox) {
      checkbox.checked = false;
      checkbox.disabled = !hasChange;
    }
    if (applyButton) {
      applyButton.disabled = !hasChange;
      applyButton.textContent = applied ? '已套用' : (hasChange ? '套用這項' : '無需套用');
      toggleClass(applyButton, 'ai-apply-suggestion-button-applied', applied);
    }
  }

  function emitApply(document, ids) {
    const onApply = getDocumentOptions(document).onApply;
    if (typeof onApply === 'function' && ids.length) {
      onApply({ ids, count: ids.length });
    }
  }

  function createInputEvent() {
    const EventCtor = root.Event || (typeof Event !== 'undefined' ? Event : null);
    return EventCtor
      ? new EventCtor('input', { bubbles: true })
      : { type: 'input', bubbles: true };
  }

  function createSuggestionSlot(document, textarea) {
    const layout = document.createElement('div');
    layout.className = 'ai-field-layout';

    const originalColumn = document.createElement('div');
    originalColumn.className = 'ai-original-column';
    const originalLabel = document.createElement('div');
    originalLabel.className = 'ai-field-label';
    originalLabel.textContent = '原文';
    originalColumn.appendChild(originalLabel);

    const suggestionColumn = document.createElement('div');
    suggestionColumn.className = 'ai-suggestion-column';
    const suggestionLabel = document.createElement('div');
    suggestionLabel.className = 'ai-field-label ai-suggestion-label';
    suggestionLabel.textContent = 'AI 建議修改';

    const suggestionInput = document.createElement('textarea');
    suggestionInput.className = 'ai-suggestion-input';
    suggestionInput.rows = textarea.rows || 2;
    suggestionInput.readOnly = true;
    suggestionInput.placeholder = '按「AI 檢查錯字」後顯示建議';
    suggestionInput.setAttribute('aria-label', 'AI 建議修改');

    const suggestionNote = document.createElement('div');
    suggestionNote.className = 'ai-suggestion-note';

    const suggestionActions = document.createElement('div');
    suggestionActions.className = 'ai-suggestion-actions';

    const selectLabel = document.createElement('label');
    selectLabel.className = 'ai-suggestion-select';

    const suggestionCheckbox = document.createElement('input');
    suggestionCheckbox.type = 'checkbox';
    suggestionCheckbox.className = 'ai-suggestion-checkbox';
    suggestionCheckbox.disabled = true;
    suggestionCheckbox.setAttribute('aria-label', '選取此項 AI 建議');
    suggestionCheckbox.dataset.aiFieldId = textarea.dataset.aiFieldId;

    const selectText = document.createElement('span');
    selectText.textContent = '選取套用';
    selectLabel.append(suggestionCheckbox, selectText);

    const applyButton = document.createElement('button');
    applyButton.type = 'button';
    applyButton.className = 'btn ai-apply-suggestion-button';
    applyButton.textContent = '無需套用';
    applyButton.disabled = true;
    applyButton.setAttribute('aria-label', '套用此項 AI 建議');
    applyButton.addEventListener('click', () => {
      if (applySuggestionToField(textarea)) {
        emitApply(document, [textarea.dataset.aiFieldId]);
      }
    });

    suggestionActions.append(selectLabel, applyButton);
    suggestionColumn.append(suggestionLabel, suggestionInput, suggestionNote, suggestionActions);
    const parent = textarea.parentNode;
    parent.insertBefore(layout, textarea);
    layout.append(originalColumn, suggestionColumn);
    originalColumn.appendChild(textarea);

    textarea._aiSuggestionInput = suggestionInput;
    textarea._aiSuggestionNote = suggestionNote;
    textarea._aiSuggestionLayout = layout;
    textarea._aiSuggestionCheckbox = suggestionCheckbox;
    textarea._aiApplyButton = applyButton;
  }

  function getEditableTextareas(document) {
    const fields = [];
    FIELD_CONFIGS.forEach(config => {
      const textareas = Array.from(document.querySelectorAll(config.selector));
      textareas.forEach((textarea, index) => {
        const id = getFieldId(textarea, config, index);
        textarea.dataset.aiFieldId = id;
        if (!textarea.dataset.aiInitialized) {
          createSuggestionSlot(document, textarea);
          textarea.dataset.aiInitialized = 'true';
          textarea.addEventListener('input', () => {
            textarea._aiSuggestionInput.value = '';
            textarea._aiSuggestionNote.textContent = '原文已變更，請重新檢查';
            toggleClass(textarea._aiSuggestionLayout, 'ai-suggestion-ready', false);
            toggleClass(textarea._aiSuggestionLayout, 'ai-suggestion-applied', false);
            textarea.dataset.aiSuggestionChanged = 'false';
            textarea.dataset.aiSuggestionApplied = 'false';
            setSuggestionControls(textarea);
          });
        }
        fields.push({ id, text: textarea.value });
      });
    });
    return fields;
  }

  function findFieldTextarea(document, id) {
    return document.querySelector('[data-ai-field-id="' + id + '"]');
  }

  function getSuggestionEntries(document) {
    if (!document) return [];
    return getEditableTextareas(document)
      .map(field => {
        const textarea = findFieldTextarea(document, field.id);
        if (!textarea || !textarea._aiSuggestionInput) return null;
        const suggestion = String(textarea._aiSuggestionInput.value || '').trim();
        const text = String(textarea.value || '').trim();
        const aiMarkedChanged = textarea.dataset.aiSuggestionChanged !== 'false';
        return {
          id: field.id,
          text,
          suggestion,
          changed: Boolean(aiMarkedChanged && suggestion && suggestion !== text),
          textarea
        };
      })
      .filter(Boolean)
      .filter(item => item.changed);
  }

  function selectSuggestionIds(items, selectedIds) {
    const selected = new Set(
      Array.isArray(selectedIds) ? selectedIds.map(id => String(id)) : []
    );
    return (Array.isArray(items) ? items : [])
      .filter(item => item && item.id != null && item.changed && selected.has(String(item.id)))
      .map(item => String(item.id));
  }

  function getPendingSuggestionIds(document) {
    return getSuggestionEntries(document).map(item => item.id);
  }

  function getSelectedSuggestionIds(document) {
    if (!document) return [];
    const pending = new Set(getPendingSuggestionIds(document));
    return Array.from(document.querySelectorAll('.ai-suggestion-checkbox:checked'))
      .filter(checkbox => !checkbox.disabled && pending.has(String(checkbox.dataset.aiFieldId || '')))
      .map(checkbox => String(checkbox.dataset.aiFieldId));
  }

  function applySuggestionToField(textarea) {
    if (!textarea || !textarea._aiSuggestionInput) return false;

    const suggestion = String(textarea._aiSuggestionInput.value || '').trim();
    const current = String(textarea.value || '').trim();
    if (!suggestion || suggestion === current) return false;

    textarea.value = suggestion;
    if (typeof textarea.dispatchEvent === 'function') {
      textarea.dispatchEvent(createInputEvent());
    }

    textarea._aiSuggestionInput.value = '';
    if (textarea._aiSuggestionNote) textarea._aiSuggestionNote.textContent = '已套用 AI 建議';
    toggleClass(textarea._aiSuggestionLayout, 'ai-suggestion-ready', false);
    toggleClass(textarea._aiSuggestionLayout, 'ai-suggestion-applied', true);
    textarea.dataset.aiSuggestionChanged = 'false';
    textarea.dataset.aiSuggestionApplied = 'true';
    setSuggestionControls(textarea, { applied: true });
    return true;
  }

  function applySuggestions(document, ids) {
    if (!document) return [];

    const entries = getSuggestionEntries(document);
    const targetIds = ids == null
      ? entries.map(item => item.id)
      : selectSuggestionIds(entries, ids);
    const target = new Set(targetIds);
    const appliedIds = [];

    entries.forEach(item => {
      if (target.has(item.id) && applySuggestionToField(item.textarea)) {
        appliedIds.push(item.id);
      }
    });

    emitApply(document, appliedIds);
    return appliedIds;
  }

  function init(document, options) {
    if (!document) return;
    if (options) document._sundayBulletinAiOptions = options;
    getEditableTextareas(document);
  }

  function clearSuggestions(document) {
    if (!document) return;
    getEditableTextareas(document).forEach(field => {
      const textarea = findFieldTextarea(document, field.id);
      if (!textarea || !textarea._aiSuggestionInput) return;
      textarea._aiSuggestionInput.value = '';
      textarea._aiSuggestionNote.textContent = '';
      toggleClass(textarea._aiSuggestionLayout, 'ai-suggestion-ready', false);
      toggleClass(textarea._aiSuggestionLayout, 'ai-suggestion-applied', false);
      textarea.dataset.aiSuggestionChanged = 'false';
      textarea.dataset.aiSuggestionApplied = 'false';
      setSuggestionControls(textarea);
    });
  }

  async function checkAll(options) {
    const opts = options || {};
    const document = opts.document || root.document;
    const button = opts.button || (document && document.getElementById('btnAiProofread'));
    const status = opts.onStatus || function() {};
    const notify = opts.onNotify || function() {};
    const callApi = opts.callApi;
    if (!document || typeof callApi !== 'function') throw new Error('AI 校對服務尚未就緒');

    const requested = buildProofreadingPayload(getEditableTextareas(document));
    if (!requested.length) {
      status('請先輸入至少一個要檢查的欄位');
      notify('請先輸入至少一個要檢查的欄位', 'info');
      return [];
    }

    if (button) button.disabled = true;
    status('AI 檢查中，請稍候…');
    try {
      const response = await callApi({ fields: requested });
      const suggestions = normalizeProofreadingResponse(response, requested);
      suggestions.forEach(item => {
        const textarea = findFieldTextarea(document, item.id);
        if (!textarea || !textarea._aiSuggestionInput) return;
        textarea._aiSuggestionInput.value = item.suggestion;
        textarea._aiSuggestionNote.textContent = item.changed
          ? (item.note || '請人工確認後再採用')
          : (item.note || '原文無明顯錯字，可維持原文');
        const hasChange = Boolean(
          item.changed && String(item.suggestion).trim() !== String(item.text).trim()
        );
        textarea.dataset.aiSuggestionChanged = String(hasChange);
        textarea.dataset.aiSuggestionApplied = 'false';
        toggleClass(textarea._aiSuggestionLayout, 'ai-suggestion-applied', false);
        toggleClass(textarea._aiSuggestionLayout, 'ai-suggestion-ready', hasChange);
        setSuggestionControls(textarea, { hasChange });
      });
      status(`AI 檢查完成：${suggestions.length} 個欄位`);
      notify('AI 建議已產生，原文未被修改', 'success');
      return suggestions;
    } catch (error) {
      status('AI 檢查失敗，請稍後重試');
      notify(`AI 檢查失敗：${error.message || error}`, 'error');
      throw error;
    } finally {
      if (button) button.disabled = false;
    }
  }

  const api = {
    buildProofreadingPayload,
    normalizeProofreadingResponse,
    selectSuggestionIds,
    applySuggestionToField,
    applySuggestions,
    getPendingSuggestionIds,
    getSelectedSuggestionIds,
    getEditableTextareas,
    init,
    clearSuggestions,
    checkAll
  };

  root.SundayBulletinAI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
