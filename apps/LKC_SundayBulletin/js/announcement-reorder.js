// Adds accessible up/down controls to the fixed weekly report lists.
(function (global) {
  const initializedRoots = new WeakSet();

  function getRows(list) {
    return Array.from(list.children).filter((child) => child.classList.contains('announcement-item'));
  }

  function getSectionLabel(textarea) {
    return textarea.classList.contains('church-news-input')
      || String(textarea.dataset.field || '').startsWith('churchNews.')
      ? '教界消息'
      : '本會消息';
  }

  function updateControls(list) {
    const rows = getRows(list);
    rows.forEach((row, index) => {
      const textarea = row.querySelector('textarea.form-input');
      const number = row.querySelector('.announcement-num')?.textContent.trim() || String(index + 1);
      const sectionLabel = textarea ? getSectionLabel(textarea) : '消息';
      const upButton = row.querySelector('[data-announcement-direction="-1"]');
      const downButton = row.querySelector('[data-announcement-direction="1"]');

      if (upButton) {
        upButton.disabled = index === 0;
        upButton.setAttribute('aria-label', '將第 ' + number + ' 則' + sectionLabel + '上移');
        upButton.title = '上移一則';
      }
      if (downButton) {
        downButton.disabled = index === rows.length - 1;
        downButton.setAttribute('aria-label', '將第 ' + number + ' 則' + sectionLabel + '下移');
        downButton.title = '下移一則';
      }
    });
  }

  function createButton(direction, symbol, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-icon announcement-reorder-btn';
    button.dataset.announcementDirection = String(direction);
    button.textContent = symbol;
    button.title = label;
    return button;
  }

  function moveItem(button, direction) {
    const row = button.closest('.announcement-item');
    const list = row?.parentElement;
    if (!row || !list) return;

    const rows = getRows(list);
    const fromIndex = rows.indexOf(row);
    const toIndex = fromIndex + direction;
    if (fromIndex < 0 || toIndex < 0 || toIndex >= rows.length) return;

    const currentTextarea = row.querySelector('textarea.form-input');
    const targetTextarea = rows[toIndex].querySelector('textarea.form-input');
    if (!currentTextarea || !targetTextarea) return;

    const currentValue = currentTextarea.value;
    currentTextarea.value = targetTextarea.value;
    targetTextarea.value = currentValue;

    [currentTextarea, targetTextarea].forEach((textarea) => {
      textarea.dispatchEvent(new global.Event('input', { bubbles: true }));
      if (typeof textarea._updateCharCount === 'function') textarea._updateCharCount();
    });

    updateControls(list);
    list.dispatchEvent(new global.CustomEvent('announcement-reordered', {
      bubbles: true,
      detail: { fromIndex, toIndex }
    }));

    const selector = '[data-announcement-direction="' + direction + '"]';
    const targetButton = rows[toIndex].querySelector(selector);
    if (targetButton && !targetButton.disabled) targetButton.focus();
    else targetTextarea.focus();
  }

  function init(root = document) {
    if (!root || initializedRoots.has(root)) return;
    initializedRoots.add(root);

    root.querySelectorAll('.announcement-list').forEach((list) => {
      getRows(list).forEach((row) => {
        if (row.querySelector('.announcement-reorder')) return;

        const controls = document.createElement('div');
        controls.className = 'announcement-reorder';
        controls.append(
          createButton(-1, '↑', '上移一則'),
          createButton(1, '↓', '下移一則')
        );
        row.appendChild(controls);
      });
      updateControls(list);
    });

    root.addEventListener('click', (event) => {
      const button = event.target.closest?.('.announcement-reorder-btn');
      if (!button || button.disabled) return;
      moveItem(button, Number(button.dataset.announcementDirection));
    });
  }

  global.AnnouncementReorder = { init };
})(window);