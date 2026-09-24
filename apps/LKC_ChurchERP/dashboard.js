(() => {
  'use strict';

  // 這裡先保留與正式 API 對應的資料形狀；接線時可替換成各系統的 adapter 回傳值。
  const dashboardData = {
    service: [
      { day: '一', date: '09/21', title: '行政與例行', owner: '事工總表', filled: 4, total: 4, status: '已完成', tone: 'done' },
      { day: '二', date: '09/22', title: '事工排班確認', owner: '事工總表', filled: 3, total: 5, status: '進行中', tone: 'progress', today: true },
      { day: '三', date: '09/23', title: '週報資料彙整', owner: '週報管理', filled: 2, total: 3, status: '進行中', tone: 'progress' },
      { day: '四', date: '09/24', title: '禮拜 PPT 資料校對', owner: 'PPT 產生器', filled: 1, total: 3, status: '待開始', tone: 'pending' },
      { day: '日', date: '09/27', title: '主日服事準備', owner: '全部門', filled: 3, total: 3, status: '已完成', tone: 'done' }
    ],
    attendance: [
      { name: '台語禮拜', value: 67, total: 80, percent: 84 },
      { name: '華語禮拜', value: 92, total: 110, percent: 84 },
      { name: '聯合禮拜', value: 30, total: 40, percent: 75 }
    ],
    calendar: [
      { date: '09/22 · 二', title: '行政會議', note: '本週幹事例會 · 會議室', status: '進行中', tone: 'active' },
      { date: '09/24 · 四', title: '週報資料截稿', note: '需完成消息、代禱與奉獻資料', status: '待處理', tone: 'active' },
      { date: '09/26 · 六', title: '敬拜團彩排', note: '華語禮拜 · 19:30', status: '已排定', tone: 'done' },
      { date: '09/27 · 日', title: '主日禮拜', note: '台語／華語 · 09:00', status: '已排定', tone: 'done' }
    ],
    readiness: [
      { title: '行事曆：講題／講員／經文', source: '教會行事曆', status: '已完成', tone: 'done' },
      { title: '服事：台語與華語名單', source: '教會事工總表', status: '已完成', tone: 'done' },
      { title: '週報：本會消息與關懷代禱', source: '教會週報管理', status: '進行中', tone: 'progress' },
      { title: 'PPT：曲目與投影片素材', source: '禮拜 PPT 產生器', status: '待補資料', tone: 'pending' },
      { title: '最後校對與匯出', source: '週報／PPT 工作流', status: '待開始', tone: 'pending' }
    ],
    sources: [
      { icon: '✦', title: '教會事工總表', detail: 'ministry_schedules · API', state: 'ready' },
      { icon: '◉', title: '主日出席系統', detail: 'attendance_records · API', state: 'ready' },
      { icon: '⌁', title: '教會行事曆', detail: 'calendar_events · API', state: 'ready' },
      { icon: '▤', title: '週報／禮拜 PPT', detail: 'bulletins · drafts · API', state: 'demo' }
    ]
  };

  const escapeHtml = value => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const serviceRows = document.getElementById('serviceRows');
  const attendanceRows = document.getElementById('attendanceRows');
  const calendarRows = document.getElementById('calendarRows');
  const readinessRows = document.getElementById('readinessRows');
  const sourceRows = document.getElementById('sourceRows');

  if (!serviceRows || !attendanceRows || !calendarRows || !readinessRows || !sourceRows) return;

  serviceRows.innerHTML = dashboardData.service.map(row => {
    const percent = Math.round((row.filled / row.total) * 100);
    return `
      <div class="service-row">
        <div class="service-day">
          <span class="day-chip${row.today ? ' today' : ''}">${escapeHtml(row.day)}<br><small>${escapeHtml(row.date.slice(3))}</small></span>
          <div class="service-title">
            <strong>${escapeHtml(row.title)}</strong>
            <span>${escapeHtml(row.date)} · ${escapeHtml(row.owner)}</span>
          </div>
        </div>
        <span class="service-owner">${escapeHtml(row.owner)}</span>
        <div class="row-progress">
          <span class="row-progress-track"><i style="width:${percent}%"></i></span>
          <em>${row.filled}/${row.total}</em>
        </div>
        <span class="status-badge ${escapeHtml(row.tone)}">${escapeHtml(row.status)}</span>
      </div>`;
  }).join('');

  attendanceRows.innerHTML = dashboardData.attendance.map(row => `
    <div class="attendance-row">
      <span class="attendance-name">${escapeHtml(row.name)}</span>
      <span class="attendance-track"><i style="width:${row.percent}%"></i></span>
      <span class="attendance-number">${row.value} <small>/ ${row.total}</small></span>
    </div>`).join('');

  calendarRows.innerHTML = dashboardData.calendar.map(row => `
    <div class="timeline-item">
      <span class="timeline-date">${escapeHtml(row.date)}</span>
      <span class="timeline-dot ${escapeHtml(row.tone)}" aria-hidden="true"></span>
      <div class="timeline-content">
        <strong>${escapeHtml(row.title)}</strong>
        <span>${escapeHtml(row.note)}</span>
      </div>
      <span class="timeline-tag ${escapeHtml(row.tone)}">${escapeHtml(row.status)}</span>
    </div>`).join('');

  const readinessIcon = tone => tone === 'done' ? '✓' : tone === 'progress' ? '!' : '·';
  readinessRows.innerHTML = dashboardData.readiness.map(row => `
    <div class="readiness-row">
      <span class="readiness-icon ${escapeHtml(row.tone)}" aria-hidden="true">${readinessIcon(row.tone)}</span>
      <div class="readiness-copy">
        <strong>${escapeHtml(row.title)}</strong>
        <span>${escapeHtml(row.source)}</span>
      </div>
      <span class="readiness-status ${escapeHtml(row.tone)}">${escapeHtml(row.status)}</span>
    </div>`).join('');

  sourceRows.innerHTML = dashboardData.sources.map(row => `
    <div class="source-card">
      <span class="source-icon" aria-hidden="true">${escapeHtml(row.icon)}</span>
      <div class="source-copy">
        <strong>${escapeHtml(row.title)}</strong>
        <span>${escapeHtml(row.detail)}</span>
      </div>
      <span class="source-state${row.state === 'ready' ? ' ready' : ''}" title="${row.state === 'ready' ? '已列入正式串接來源' : '目前為示範狀態'}"></span>
    </div>`).join('');

  const toast = document.getElementById('toast');
  const refreshButton = document.getElementById('refreshDemo');
  let toastTimer;

  const showToast = message => {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2600);
  };

  if (refreshButton) {
    refreshButton.addEventListener('click', () => {
      const now = new Date();
      const time = now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
      const updateText = document.querySelector('.readiness-footer > span');
      if (updateText) updateText.textContent = `最後更新 ${time}`;
      showToast('示範資料已重新整理；正式串接後將改為讀取各系統 API。');
    });
  }
})();
