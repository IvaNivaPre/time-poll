/**
 * Главный контроллер пользовательского интерфейса TimePoll
 */
(function () {
  const store = window.appStore;
  const fbService = window.firebaseService;

  const COLOR_META = {
    green: {
      name: 'Зелёный',
      desc: 'Предпочитаемое время',
      short: 'Предпочитаю',
      icon: '🟢'
    },
    blue: {
      name: 'Синий',
      desc: 'Свободен в это время',
      short: 'Свободен',
      icon: '🔵'
    },
    red: {
      name: 'Красный',
      desc: 'Занят в это время',
      short: 'Занят',
      icon: '🔴'
    },
    erase: {
      name: 'Ластик',
      desc: 'Стереть разметку',
      short: 'Очистить',
      icon: '⚪'
    }
  };

  const THEMES = [
    {
      id: 'dark',
      name: 'Тёмная (Графит)',
      desc: 'Классическая контрастная тёмная тема',
      colors: ['#0f1117', '#171b26', '#6366f1', '#10b981']
    },
    {
      id: 'light',
      name: 'Светлая (Дневная)',
      desc: 'Чистая светлая тема с серым фоном вне промежутка',
      colors: ['#f1f5f9', '#ffffff', '#4f46e5', '#10b981']
    },
    {
      id: 'midnight',
      name: 'Полночь (Неон)',
      desc: 'Глубокий индиго с фиолетовыми акцентами',
      colors: ['#070514', '#110e26', '#a855f7', '#3b82f6']
    },
    {
      id: 'forest',
      name: 'Изумрудный лес',
      desc: 'Природные тёмно-зелёные оттенки',
      colors: ['#0b1612', '#12221c', '#10b981', '#34d399']
    },
    {
      id: 'ocean',
      name: 'Океанский бриз',
      desc: 'Глубокие морские синие тона',
      colors: ['#091521', '#0f2133', '#0ea5e9', '#38bdf8']
    },
    {
      id: 'sunset',
      name: 'Тёплый закат',
      desc: 'Уютная тёплая палитра с янтарным акцентом',
      colors: ['#1c1210', '#291a17', '#f97316', '#fdba74']
    }
  ];

  const MONTH_NAMES = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
  ];

  const MONTH_NAMES_GENITIVE = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
  ];

  const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatReadableDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map((n) => parseInt(n, 10));
    if (!y || !m || !d) return dateStr;
    return `${d} ${MONTH_NAMES_GENITIVE[m - 1]} ${y}`;
  }

  class App {
    constructor() {
      this.activeTab = 'events'; // 'events' | 'users' | 'settings'
      this.selectedEventId = null;
      this.activeColor = 'green'; // 'green' | 'blue' | 'red' | 'erase'
      this.calendarSubView = 'month'; // 'month' | 'day'
      this.selectedDateStr = null; // 'YYYY-MM-DD' когда открыт конкретный день
      this.viewYear = new Date().getFullYear();
      this.viewMonth = new Date().getMonth();
      this.calendarMode = 'personal'; // 'personal' | 'group'
      this.inspectedUserId = null; // Позволяет смотреть/красить конкретного пользователя

      // Состояние зажатой ПКМ для рисования протягиванием
      this.paintDrag = {
        active: false,
        type: null, // 'day' | 'slot'
        targetColor: null,
        dirty: false
      };

      this.modalHtml = null;
      this.modalBindFn = null;
    }

    init() {
      // Применяем сохраненную тему
      document.documentElement.setAttribute('data-theme', store.getTheme());

      // Выбираем первое доступное мероприятие
      this._ensureSelectedEvent();

      // Глобальное завершение протягивания ПКМ
      window.addEventListener('mouseup', (e) => {
        if (this.paintDrag.active && (e.button === 2 || e.buttons === 0)) {
          this.finishPaintDrag();
        }
      });

      // Горячие клавиши выбора цвета (1 - Зеленый, 2 - Синий, 3 - Красный, 0 - Ластик)
      window.addEventListener('keydown', (e) => {
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
          return;
        }
        if (e.key === '1') this.setActiveColor('green');
        else if (e.key === '2') this.setActiveColor('blue');
        else if (e.key === '3') this.setActiveColor('red');
        else if (e.key === '0') this.setActiveColor('erase');
        else if (e.key === 'Escape' && this.calendarSubView === 'day') {
          this.calendarSubView = 'month';
          this.render();
        }
      });

      // Подписка на обновления Store
      store.subscribe(() => {
        this._ensureSelectedEvent();
        if (!this.paintDrag.active) {
          this.render();
        }
      });

      // Инициализируем подключение к Firebase (если оно настроено)
      fbService.init(
        (remoteData, isEmptyRemote) => {
          store.applyRemoteState(remoteData, isEmptyRemote);
        },
        () => {
          this.updateDbStatusBadge();
        }
      );

      this.render();
    }

    _ensureSelectedEvent() {
      const events = store.getEventsForCurrentUser();
      if (events.length === 0) {
        this.selectedEventId = null;
        return;
      }
      if (!this.selectedEventId || !events.some((e) => e.id === this.selectedEventId)) {
        this.selectedEventId = events[0].id;
        this._syncCalendarMonthToEvent(events[0]);
      }
    }

    _syncCalendarMonthToEvent(ev) {
      if (ev && ev.startDate) {
        const [y, m] = ev.startDate.split('-').map((n) => parseInt(n, 10));
        if (y && m) {
          this.viewYear = y;
          this.viewMonth = m - 1;
        }
      }
    }

    setActiveColor(color) {
      if (!COLOR_META[color]) return;
      this.activeColor = color;
      // Обновляем кнопки палитры без полной перерисовки страницы
      document.querySelectorAll('.color-brush-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-color') === color);
      });
    }

    showToast(message, type = 'info') {
      let container = document.getElementById('toast-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
      }
      const el = document.createElement('div');
      el.className = `toast-msg ${type}`;
      el.textContent = message;
      container.appendChild(el);
      setTimeout(() => {
        el.remove();
      }, 3600);
    }

    openModal(htmlContent, bindEventsCallback) {
      this.modalHtml = htmlContent;
      this.modalBindFn = bindEventsCallback;
      this.renderModal();
    }

    closeModal() {
      this.modalHtml = null;
      this.modalBindFn = null;
      const root = document.getElementById('modal-root');
      if (root) root.innerHTML = '';
    }

    renderModal() {
      const root = document.getElementById('modal-root');
      if (!root) return;
      if (!this.modalHtml) {
        root.innerHTML = '';
        return;
      }
      root.innerHTML = `
        <div class="modal-backdrop" id="modal-backdrop">
          <div class="modal-window">
            ${this.modalHtml}
          </div>
        </div>
      `;
      const backdrop = document.getElementById('modal-backdrop');
      if (backdrop) {
        backdrop.addEventListener('click', (e) => {
          if (e.target === backdrop) this.closeModal();
        });
      }
      if (this.modalBindFn) {
        this.modalBindFn();
      }
    }

    updateDbStatusBadge() {
      const badge = document.getElementById('db-status-badge');
      if (!badge) return;
      const st = fbService.status;
      badge.className = `db-status-badge ${st}`;
      let label = 'Локальная БД';
      if (st === 'connected') {
        label = `Firebase (${fbService.mode === 'rtdb' ? 'Realtime DB' : 'Firestore'})`;
      } else if (st === 'connecting') {
        label = 'Подключение к Firebase...';
      } else if (st === 'error') {
        label = 'Ошибка БД (Локальный кэш)';
      }
      badge.innerHTML = `<span class="db-status-dot"></span><span>${escapeHtml(label)}</span>`;
      if (fbService.lastError) {
        badge.title = fbService.lastError;
      } else {
        badge.title = 'Статус синхронизации базы данных';
      }
    }

    // ==================== ГЛАВНЫЙ РЕНДЕР ====================

    render() {
      const appRoot = document.getElementById('app');
      if (!appRoot) return;

      const currentUser = store.getCurrentUser();
      if (!currentUser) {
        appRoot.innerHTML = this.renderAuthScreen();
        this.bindAuthEvents();
        return;
      }

      if (!this.inspectedUserId || !store.getUserById(this.inspectedUserId)) {
        this.inspectedUserId = currentUser.id;
      }

      appRoot.innerHTML = `
        ${this.renderHeader(currentUser)}
        ${this.activeTab === 'events' ? this.renderPaletteBar() : ''}
        <main class="main-container">
          ${this.renderActiveTabContent(currentUser)}
        </main>
      `;

      this.updateDbStatusBadge();
      this.bindHeaderEvents();
      if (this.activeTab === 'events') {
        this.bindPaletteEvents();
        this.bindEventsTab();
      } else if (this.activeTab === 'users') {
        this.bindUsersTab();
      } else if (this.activeTab === 'settings') {
        this.bindSettingsTab();
      }
    }

    // ==================== ЭКРАН ВХОДА ====================

    renderAuthScreen() {
      return `
        <div class="auth-wrapper">
          <div class="auth-card">
            <div class="auth-logo">
              <div class="auth-logo-icon">📅</div>
              <div>
                <h1 class="auth-title">TimePoll</h1>
              </div>
            </div>
            <p class="auth-subtitle">Опросы о времени проведения мероприятий и календарь занятости участников</p>
            <form id="login-form">
              <div class="form-group">
                <label class="form-label" for="login-input">Логин</label>
                <input type="text" id="login-input" class="form-input" placeholder="Введите ваш логин" required autocomplete="username" />
              </div>
              <div class="form-group">
                <label class="form-label" for="password-input">Пароль</label>
                <input type="password" id="password-input" class="form-input" placeholder="Введите пароль" required autocomplete="current-password" />
              </div>
              <div id="login-error" style="color: #ef4444; font-size: 0.86rem; margin-bottom: 12px; display: none;"></div>
              <button type="submit" class="btn btn-primary" style="width: 100%; padding: 11px;">Войти в систему</button>
            </form>
          </div>
        </div>
      `;
    }

    bindAuthEvents() {
      const form = document.getElementById('login-form');
      if (!form) return;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const loginVal = document.getElementById('login-input').value;
        const passVal = document.getElementById('password-input').value;
        const errBox = document.getElementById('login-error');
        try {
          const user = store.login(loginVal, passVal);
          this.inspectedUserId = user.id;
          this.activeTab = 'events';
          this._ensureSelectedEvent();
          this.showToast(`Добро пожаловать, ${user.displayName}!`, 'success');
          this.render();
        } catch (err) {
          if (errBox) {
            errBox.textContent = err.message;
            errBox.style.display = 'block';
          }
        }
      });
    }

    // ==================== ШАПКА И НАВИГАЦИЯ ====================

    renderHeader(currentUser) {
      const isAdmin = currentUser.role === 'admin';
      const initial = (currentUser.displayName || currentUser.login || '?')[0].toUpperCase();

      return `
        <header class="app-header">
          <div class="brand-area">
            <div class="brand-icon">📅</div>
            <span class="brand-name">TimePoll</span>
            <div id="db-status-badge" class="db-status-badge">
              <span class="db-status-dot"></span>
              <span>Локальная БД</span>
            </div>
          </div>

          <nav class="nav-tabs">
            <button type="button" class="nav-tab ${this.activeTab === 'events' ? 'active' : ''}" data-tab="events">
              <span>🗓️</span> Мероприятия и Календарь
            </button>
            ${
              isAdmin
                ? `
              <button type="button" class="nav-tab ${this.activeTab === 'users' ? 'active' : ''}" data-tab="users">
                <span>👥</span> Пользователи (${store.getUsers().length})
              </button>
            `
                : ''
            }
            <button type="button" class="nav-tab ${this.activeTab === 'settings' ? 'active' : ''}" data-tab="settings">
              <span>⚙️</span> Настройки
            </button>
          </nav>

          <div class="user-area">
            <div class="user-pill">
              <span class="user-avatar" style="background: ${escapeHtml(currentUser.avatarColor || '#6366f1')}">
                ${escapeHtml(initial)}
              </span>
              <div>
                <div style="font-weight: 600; font-size: 0.88rem; line-height: 1.2;">
                  ${escapeHtml(currentUser.displayName)}
                </div>
                <div style="font-size: 0.74rem; color: var(--text-secondary);">
                  @${escapeHtml(currentUser.login)}
                </div>
              </div>
              <span class="user-role-tag">${isAdmin ? 'Админ' : 'Участник'}</span>
            </div>
            <button type="button" id="logout-btn" class="btn btn-sm" title="Выйти из аккаунта">Выйти</button>
          </div>
        </header>
      `;
    }

    bindHeaderEvents() {
      document.querySelectorAll('.nav-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.activeTab = btn.getAttribute('data-tab');
          this.render();
        });
      });

      const logoutBtn = document.getElementById('logout-btn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
          store.logout();
          this.showToast('Вы вышли из аккаунта');
          this.render();
        });
      }
    }

    // ==================== ПАНЕЛЬ ПАЛИТРЫ ПОКРАСКИ ====================

    renderPaletteBar() {
      return `
        <section class="palette-sticky-bar">
          <div class="palette-tools">
            <span class="palette-label">🎨 Палитра покраски:</span>
            <button type="button" class="color-brush-btn ${this.activeColor === 'green' ? 'active' : ''}" data-color="green" title="Горячая клавиша: 1">
              <span class="color-swatch"></span>
              <span>Зелёный — Предпочитаемое время</span>
            </button>
            <button type="button" class="color-brush-btn ${this.activeColor === 'blue' ? 'active' : ''}" data-color="blue" title="Горячая клавиша: 2">
              <span class="color-swatch"></span>
              <span>Синий — Свободен в это время</span>
            </button>
            <button type="button" class="color-brush-btn ${this.activeColor === 'red' ? 'active' : ''}" data-color="red" title="Горячая клавиша: 3">
              <span class="color-swatch"></span>
              <span>Красный — Занят в это время</span>
            </button>
            <button type="button" class="color-brush-btn ${this.activeColor === 'erase' ? 'active' : ''}" data-color="erase" title="Горячая клавиша: 0">
              <span class="color-swatch"></span>
              <span>Ластик (Стереть)</span>
            </button>
          </div>

          <div class="palette-hint">
            <span>🖱️ Нажмите <kbd>ПКМ</kbd> (правую кнопку мыши) или зажмите <kbd>ПКМ</kbd> для покраски. <kbd>ЛКМ</kbd> по дню — выбор времени (шаг 30 мин).</span>
          </div>
        </section>
      `;
    }

    bindPaletteEvents() {
      document.querySelectorAll('.color-brush-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const color = btn.getAttribute('data-color');
          this.setActiveColor(color);
        });
      });
    }

    // ==================== СОДЕРЖИМОЕ ВКЛАДОК ====================

    renderActiveTabContent(currentUser) {
      if (this.activeTab === 'users' && currentUser.role === 'admin') {
        return this.renderUsersManagementTab();
      }
      if (this.activeTab === 'settings') {
        return this.renderSettingsTab(currentUser);
      }
      return this.renderEventsWorkspace(currentUser);
    }

    // ==================== ВКЛАДКА: МЕРОПРИЯТИЯ И КАЛЕНДАРЬ ====================

    renderEventsWorkspace(currentUser) {
      const isAdmin = currentUser.role === 'admin';
      const events = store.getEventsForCurrentUser();
      const selectedEvent = store.getEventById(this.selectedEventId);

      return `
        <div class="events-layout">
          <aside class="sidebar-panel">
            <div class="sidebar-header">
              <h2 class="sidebar-title">Мероприятия</h2>
              ${
                isAdmin
                  ? `<button type="button" id="create-event-btn" class="btn btn-primary btn-sm">+ Создать</button>`
                  : ''
              }
            </div>

            ${
              events.length === 0
                ? `<div style="padding: 20px 10px; text-align: center; color: var(--text-secondary); font-size: 0.9rem;">
                    ${
                      isAdmin
                        ? 'Нет созданных мероприятий. Нажмите «+ Создать», чтобы добавить опрос.'
                        : 'Вас пока не добавили ни в одно мероприятие.'
                    }
                   </div>`
                : `<div class="event-list">
                    ${events
                      .map((ev) => {
                        const isActive = ev.id === this.selectedEventId;
                        const partCount = (ev.participantIds || []).length;
                        return `
                          <div class="event-card-item ${isActive ? 'active' : ''}" data-event-id="${escapeHtml(ev.id)}">
                            <div class="event-card-title">${escapeHtml(ev.title)}</div>
                            <div class="event-card-dates">
                              <span>📆</span>
                              <span>${escapeHtml(formatReadableDate(ev.startDate))} — ${escapeHtml(formatReadableDate(ev.endDate))}</span>
                            </div>
                            <div class="event-card-meta">
                              <span>👥 Участников: ${partCount}</span>
                              <span>⏰ ${escapeHtml(ev.expectedStartTime || '00:00')}–${escapeHtml(ev.expectedEndTime || '24:00')}</span>
                            </div>
                          </div>
                        `;
                      })
                      .join('')}
                   </div>`
            }
          </aside>

          <section class="workspace-panel">
            ${
              !selectedEvent
                ? `<div style="padding: 48px 20px; text-align: center; color: var(--text-secondary);">
                    <div style="font-size: 2.5rem; margin-bottom: 10px;">🗓️</div>
                    <h3 style="margin: 0 0 8px 0; color: var(--text-primary);">Выберите или создайте мероприятие</h3>
                    <p style="margin: 0;">Здесь появится интерактивный календарь для разметки свободных дат и времени.</p>
                   </div>`
                : this.renderSelectedEventContent(selectedEvent, currentUser)
            }
          </section>
        </div>
      `;
    }

    renderSelectedEventContent(event, currentUser) {
      const isAdmin = currentUser.role === 'admin';
      const participants = (event.participantIds || [])
        .map((uid) => store.getUserById(uid))
        .filter(Boolean);

      const targetUserId =
        isAdmin && this.inspectedUserId && store.getUserById(this.inspectedUserId)
          ? this.inspectedUserId
          : currentUser.id;
      const targetUser = store.getUserById(targetUserId) || currentUser;

      return `
        <div class="event-top-bar">
          <div>
            <h2 class="event-info-title">${escapeHtml(event.title)}</h2>
            ${
              event.description
                ? `<p class="event-info-desc">${escapeHtml(event.description)}</p>`
                : ''
            }
            <div class="event-badges-row">
              <span class="info-badge highlight">
                📆 Предполагаемый промежуток: ${escapeHtml(formatReadableDate(event.startDate))} — ${escapeHtml(formatReadableDate(event.endDate))}
              </span>
              <span class="info-badge">
                ⏰ Ожидаемое время: ${escapeHtml(event.expectedStartTime || '00:00')} – ${escapeHtml(event.expectedEndTime || '24:00')}
              </span>
              <span class="info-badge">
                👥 Участников: ${participants.length}
              </span>
            </div>
          </div>

          ${
            isAdmin
              ? `<div style="display: flex; gap: 8px; flex-wrap: wrap;">
                  <button type="button" id="edit-event-btn" class="btn btn-sm">✏️ Редактировать</button>
                  <button type="button" id="delete-event-btn" class="btn btn-danger btn-sm">🗑️ Удалить</button>
                 </div>`
              : ''
          }
        </div>

        <div class="mode-toolbar">
          <div class="view-mode-group">
            <button type="button" class="btn btn-sm ${this.calendarMode === 'personal' ? 'btn-primary' : ''}" id="mode-personal-btn">
              🖌️ Разметка (${escapeHtml(targetUser.id === currentUser.id ? 'Моя' : targetUser.displayName)})
            </button>
            <button type="button" class="btn btn-sm ${this.calendarMode === 'group' ? 'btn-primary' : ''}" id="mode-group-btn">
              📊 Общая сводка (${participants.length} участн.)
            </button>

            ${
              participants.length > 1 || isAdmin
                ? `<select id="inspect-user-select" class="form-select" style="width: auto; padding: 5px 10px; font-size: 0.84rem;" title="Чью разметку отображать в режиме разметки">
                    ${participants
                      .map(
                        (u) =>
                          `<option value="${escapeHtml(u.id)}" ${u.id === targetUser.id ? 'selected' : ''}>
                            Участник: ${escapeHtml(u.displayName)} (@${escapeHtml(u.login)})
                          </option>`
                      )
                      .join('')}
                   </select>`
                : ''
            }

            <button type="button" id="clear-my-marks-btn" class="btn btn-sm" title="Очистить всю разметку в этом мероприятии">
              🧹 Очистить мою разметку
            </button>
          </div>

          <div class="legend-range-group">
            <span class="legend-item">
              <span class="legend-box in-range"></span>
              <span>Предполагаемый промежуток (светлый)</span>
            </span>
            <span class="legend-item">
              <span class="legend-box out-range"></span>
              <span>Вне промежутка (серый, тоже можно выбирать)</span>
            </span>
          </div>
        </div>

        ${
          this.calendarSubView === 'day' && this.selectedDateStr
            ? this.renderDay30MinView(event, targetUser, currentUser)
            : this.renderMonthCalendarView(event, targetUser)
        }

        ${this.renderBestTimesSection(event)}
      `;
    }

    // ==================== МЕСЯЧНЫЙ КАЛЕНДАРЬ ====================

    renderMonthCalendarView(event, targetUser) {
      const monthTitle = `${MONTH_NAMES[this.viewMonth]} ${this.viewYear}`;
      const cells = this._buildCalendarMonthCells(this.viewYear, this.viewMonth);

      return `
        <div class="calendar-nav-bar">
          <div style="display: flex; align-items: center; gap: 8px;">
            <button type="button" class="btn btn-sm" id="cal-prev-month">◀ Пред. месяц</button>
            <span class="calendar-month-title">${escapeHtml(monthTitle)}</span>
            <button type="button" class="btn btn-sm" id="cal-next-month">След. месяц ▶</button>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button type="button" class="btn btn-sm" id="cal-jump-event">🎯 К датам мероприятия</button>
          </div>
        </div>

        <div class="calendar-grid-weekdays">
          ${WEEKDAYS_SHORT.map((w) => `<div class="weekday-header">${w}</div>`).join('')}
        </div>

        <div class="calendar-grid-days" id="calendar-days-grid">
          ${cells.map((cell) => this.renderCalendarDayCell(cell, event, targetUser)).join('')}
        </div>
      `;
    }

    _buildCalendarMonthCells(year, month) {
      const firstDay = new Date(year, month, 1);
      // Понедельник = 0, Воскресенье = 6
      const startWeekday = (firstDay.getDay() + 6) % 7;
      const daysInMonth = new Date(year, month + 1, 0).getDate();

      const cells = [];
      // Дни предыдущего месяца для выравнивания сетки
      for (let i = startWeekday - 1; i >= 0; i--) {
        const d = new Date(year, month, -i);
        cells.push({
          dateStr: store.formatDateISO(d),
          dayNum: d.getDate(),
          isCurrentMonth: false
        });
      }
      // Дни текущего месяца
      for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(year, month, day);
        cells.push({
          dateStr: store.formatDateISO(d),
          dayNum: day,
          isCurrentMonth: true
        });
      }
      // Дни следующего месяца до кратности 7
      const remainder = cells.length % 7;
      if (remainder !== 0) {
        const needed = 7 - remainder;
        for (let i = 1; i <= needed; i++) {
          const d = new Date(year, month + 1, i);
          cells.push({
            dateStr: store.formatDateISO(d),
            dayNum: d.getDate(),
            isCurrentMonth: false
          });
        }
      }
      return cells;
    }

    renderCalendarDayCell(cell, event, targetUser) {
      const inRange = store.isDateInExpectedRange(event, cell.dateStr);
      const rangeClass = inRange ? 'in-expected-range' : 'out-of-expected-range';
      const monthClass = cell.isCurrentMonth ? '' : 'other-month';

      const userSummary = store.getUserDaySummary(event, targetUser.id, cell.dateStr);
      const groupStats = store.getGroupDayStats(event, cell.dateStr);

      let paintedClass = '';
      if (this.calendarMode === 'personal') {
        if (userSummary.uniformColor) {
          paintedClass = `painted-${userSummary.uniformColor}`;
        } else if (userSummary.dominantColor && userSummary.counts.total > 0) {
          paintedClass = `painted-${userSummary.dominantColor}`;
        }
      } else {
        // В режиме общей сводки подсвечиваем день, если есть доступные участники
        if (groupStats.green.length > 0 && groupStats.red.length === 0) {
          paintedClass = 'painted-green';
        } else if (groupStats.availableCount > 0) {
          paintedClass = 'painted-blue';
        } else if (groupStats.red.length > 0) {
          paintedClass = 'painted-red';
        }
      }

      // Мини-полоска пропорций (если день раскрашен по часам)
      let bodyHtml = '';
      if (this.calendarMode === 'personal') {
        const { counts, uniformColor } = userSummary;
        if (uniformColor) {
          const meta = COLOR_META[uniformColor];
          bodyHtml = `
            <div>
              <span class="day-status-pill ${uniformColor}">${meta.icon} Весь день: ${meta.short}</span>
            </div>
          `;
        } else if (counts.total > 0) {
          const gPct = Math.round((counts.green / 48) * 100);
          const bPct = Math.round((counts.blue / 48) * 100);
          const rPct = Math.round((counts.red / 48) * 100);
          bodyHtml = `
            <div>
              <div class="day-mini-bar" title="Разметка по 30-минутным интервалам">
                ${gPct > 0 ? `<div class="day-mini-segment green" style="width:${gPct}%"></div>` : ''}
                ${bPct > 0 ? `<div class="day-mini-segment blue" style="width:${bPct}%"></div>` : ''}
                ${rPct > 0 ? `<div class="day-mini-segment red" style="width:${rPct}%"></div>` : ''}
              </div>
              <div class="day-counts-caption">
                ${counts.green > 0 ? `<span>🟢 ${counts.green / 2}ч</span>` : ''}
                ${counts.blue > 0 ? `<span>🔵 ${counts.blue / 2}ч</span>` : ''}
                ${counts.red > 0 ? `<span>🔴 ${counts.red / 2}ч</span>` : ''}
              </div>
            </div>
          `;
        } else {
          bodyHtml = `<div style="font-size: 0.73rem; opacity: 0.75; margin-top: auto;">ЛКМ — часы · ПКМ — день</div>`;
        }
      } else {
        // Режим общей сводки на клетке дня
        if (groupStats.availableCount > 0 || groupStats.red.length > 0) {
          bodyHtml = `
            <div class="day-counts-caption" style="margin-top: auto;">
              ${groupStats.green.length > 0 ? `<span>🟢 ${groupStats.green.length}</span>` : ''}
              ${groupStats.blue.length > 0 ? `<span>🔵 ${groupStats.blue.length}</span>` : ''}
              ${groupStats.red.length > 0 ? `<span>🔴 ${groupStats.red.length}</span>` : ''}
              <span style="font-weight: 700;">Свободны: ${groupStats.availableCount}/${groupStats.totalParticipants}</span>
            </div>
          `;
        } else {
          bodyHtml = `<div style="font-size: 0.73rem; opacity: 0.7; margin-top: auto;">Нет отметок</div>`;
        }
      }

      return `
        <div
          class="calendar-day-cell ${rangeClass} ${monthClass} ${paintedClass}"
          data-date="${escapeHtml(cell.dateStr)}"
          title="ЛКМ — перейти в дату (${escapeHtml(formatReadableDate(cell.dateStr))}) для разметки по 30 минут. ПКМ — закрасить день."
        >
          <div class="day-top-row">
            <span class="day-number">${cell.dayNum}</span>
            <span class="day-range-tag">${inRange ? 'В промежутке' : 'Вне промежутка'}</span>
          </div>
          ${bodyHtml}
        </div>
      `;
    }

    // ==================== ДЕТАЛЬНЫЙ ВИД ДНЯ (ШАГ 30 МИНУТ) ====================

    renderDay30MinView(event, targetUser, currentUser) {
      const dateStr = this.selectedDateStr;
      const inDateRange = store.isDateInExpectedRange(event, dateStr);
      const allSlots = store.ALL_TIME_SLOTS;
      const morningSlots = allSlots.slice(0, 24); // 00:00 - 12:00
      const eveningSlots = allSlots.slice(24, 48); // 12:00 - 24:00

      return `
        <div class="day-detail-header">
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <button type="button" class="btn btn-sm" id="back-to-month-btn">← Назад к календарю</button>
            <button type="button" class="btn btn-sm" id="prev-day-btn" title="Предыдущий день">◀</button>
            <h3 class="day-detail-title">
              📅 ${escapeHtml(formatReadableDate(dateStr))}
            </h3>
            <button type="button" class="btn btn-sm" id="next-day-btn" title="Следующий день">▶</button>
            <span class="info-badge ${inDateRange ? 'highlight' : ''}">
              ${inDateRange ? '✨ День в предполагаемом промежутке' : '⚪ День вне предполагаемого промежутка (доступен для выбора)'}
            </span>
          </div>

          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <button type="button" class="btn btn-sm" id="paint-expected-day-btn" title="Закрасить слоты предполагаемого времени выбранным на панели цветом">
              Закрасить промежуток (${escapeHtml(event.expectedStartTime)}–${escapeHtml(event.expectedEndTime)})
            </button>
            <button type="button" class="btn btn-sm" id="paint-all-day-btn" title="Закрасить все 48 слотов этого дня выбранным цветом">
              Закрасить весь день
            </button>
            <button type="button" class="btn btn-sm" id="clear-day-btn">
              Очистить день
            </button>
          </div>
        </div>

        <div class="slots-columns-wrapper" id="day-slots-grid">
          <div class="slots-column">
            <div class="slots-column-header">🌙 Ночь и Утро (00:00 – 12:00, шаг 30 мин)</div>
            ${morningSlots.map((slotKey) => this.renderSingleTimeSlot(event, targetUser, dateStr, slotKey)).join('')}
          </div>
          <div class="slots-column">
            <div class="slots-column-header">☀️ День и Вечер (12:00 – 24:00, шаг 30 мин)</div>
            ${eveningSlots.map((slotKey) => this.renderSingleTimeSlot(event, targetUser, dateStr, slotKey)).join('')}
          </div>
        </div>
      `;
    }

    renderSingleTimeSlot(event, targetUser, dateStr, slotKey) {
      const endLabel = store.formatSlotEnd(slotKey);
      const inExpected = store.isSlotInExpectedRange(event, dateStr, slotKey);
      const rangeClass = inExpected ? 'in-expected-range' : 'out-of-expected-range';

      const myColor = store.getUserSlotColor(event, targetUser.id, dateStr, slotKey);
      const groupStats = store.getGroupSlotStats(event, dateStr, slotKey);

      let paintedClass = '';
      if (this.calendarMode === 'personal') {
        if (myColor) paintedClass = `painted-${myColor}`;
      } else {
        if (groupStats.greenUsers.length > 0 && groupStats.redUsers.length === 0) {
          paintedClass = 'painted-green';
        } else if (groupStats.availableCount > 0) {
          paintedClass = 'painted-blue';
        } else if (groupStats.redUsers.length > 0) {
          paintedClass = 'painted-red';
        }
      }

      const myBadge = myColor
        ? `<span class="day-status-pill ${myColor}" style="margin: 0;">${COLOR_META[myColor].icon} ${COLOR_META[myColor].short}</span>`
        : `<span style="font-size: 0.75rem; opacity: 0.7;">${inExpected ? 'Ожидаемое время' : 'Вне промежутка'}</span>`;

      // Чипы участников, отметивших этот слот
      const chipsHtml = [
        ...groupStats.greenUsers.map(
          (u) => `<span class="mini-user-chip green" title="${escapeHtml(u.displayName)}: Предпочитаемое время">${escapeHtml(u.displayName)}</span>`
        ),
        ...groupStats.blueUsers.map(
          (u) => `<span class="mini-user-chip blue" title="${escapeHtml(u.displayName)}: Свободен">${escapeHtml(u.displayName)}</span>`
        ),
        ...groupStats.redUsers.map(
          (u) => `<span class="mini-user-chip red" title="${escapeHtml(u.displayName)}: Занят">${escapeHtml(u.displayName)}</span>`
        )
      ].join('');

      return `
        <div
          class="time-slot-row ${rangeClass} ${paintedClass}"
          data-slot="${escapeHtml(slotKey)}"
          title="Нажмите ПКМ (или зажмите ПКМ и проведите), чтобы покрасить интервал ${slotKey} – ${endLabel}"
        >
          <div style="display: flex; align-items: center; gap: 10px;">
            <span class="slot-time-label">${slotKey} – ${endLabel}</span>
            ${myBadge}
          </div>
          <div class="slot-status-area">
            <div class="slot-avatars-list">${chipsHtml}</div>
          </div>
        </div>
      `;
    }

    // ==================== СЕКЦИЯ ЛУЧШИХ ПЕРЕСЕЧЕНИЙ ====================

    renderBestTimesSection(event) {
      const bestList = store.findBestIntervals(event, 6);
      if (bestList.length === 0) {
        return `
          <div class="best-slots-panel">
            <div style="font-weight: 700; font-size: 1rem;">🏆 Лучшее время по итогам опроса</div>
            <div style="font-size: 0.86rem; color: var(--text-secondary); margin-top: 4px;">
              Пока никто из участников не отметил свободное время (зелёным или синим цветом). Нажмите ПКМ по датам или слотам времени!
            </div>
          </div>
        `;
      }

      return `
        <div class="best-slots-panel">
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
            <div style="font-weight: 700; font-size: 1rem;">🏆 Лучшие пересечения времени (Топ совпадений)</div>
            <span style="font-size: 0.8rem; color: var(--text-secondary);">Нажмите на карточку, чтобы открыть этот день</span>
          </div>
          <div class="best-slots-grid">
            ${bestList
              .map((item) => {
                const { stats } = item;
                return `
                  <div class="best-slot-card" data-jump-date="${escapeHtml(item.dateStr)}">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                      <strong style="font-size: 0.92rem;">${escapeHtml(formatReadableDate(item.dateStr))}</strong>
                      <span class="info-badge highlight" style="padding: 2px 8px; font-size: 0.76rem;">
                        Свободны: ${stats.availableCount}/${stats.totalParticipants}
                      </span>
                    </div>
                    <div style="font-family: monospace; font-weight: 700; font-size: 0.95rem; color: var(--accent); margin-bottom: 6px;">
                      ⏰ ${escapeHtml(item.startSlot)} – ${escapeHtml(item.endSlot)}
                    </div>
                    <div style="font-size: 0.78rem; color: var(--text-secondary); display: flex; gap: 8px; flex-wrap: wrap;">
                      <span>🟢 Предпочитают: ${stats.greenUsers.length}</span>
                      <span>🔵 Свободны: ${stats.blueUsers.length}</span>
                      ${stats.redUsers.length > 0 ? `<span style="color:#fca5a5;">🔴 Заняты: ${stats.redUsers.length}</span>` : ''}
                    </div>
                  </div>
                `;
              })
              .join('')}
          </div>
        </div>
      `;
    }

    // ==================== ОБРАБОТЧИКИ СОБЫТИЙ КАЛЕНДАРЯ И ПОКРАСКИ ПКМ ====================

    bindEventsTab() {
      const currentUser = store.getCurrentUser();
      const event = store.getEventById(this.selectedEventId);

      // Выбор мероприятия в боковой панели
      document.querySelectorAll('.event-card-item').forEach((card) => {
        card.addEventListener('click', () => {
          const id = card.getAttribute('data-event-id');
          this.selectedEventId = id;
          this.calendarSubView = 'month';
          const ev = store.getEventById(id);
          this._syncCalendarMonthToEvent(ev);
          this.render();
        });
      });

      // Кнопки создания / редактирования / удаления мероприятия (для Админа)
      const createBtn = document.getElementById('create-event-btn');
      if (createBtn) {
        createBtn.addEventListener('click', () => this.openEventFormModal(null));
      }

      if (!event) return;

      const editBtn = document.getElementById('edit-event-btn');
      if (editBtn) {
        editBtn.addEventListener('click', () => this.openEventFormModal(event));
      }

      const deleteBtn = document.getElementById('delete-event-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
          this.openConfirmModal({
            title: 'Удаление мероприятия',
            message: `Вы действительно хотите удалить мероприятие «${event.title}»? Все отметки времени будут удалены.`,
            confirmText: 'Удалить мероприятие',
            danger: true,
            onConfirm: () => {
              store.deleteEvent(event.id);
              this.selectedEventId = null;
              this._ensureSelectedEvent();
              this.showToast('Мероприятие удалено');
              this.render();
            }
          });
        });
      }

      // Переключение режима: Разметка / Общая сводка
      const personalBtn = document.getElementById('mode-personal-btn');
      if (personalBtn) {
        personalBtn.addEventListener('click', () => {
          this.calendarMode = 'personal';
          this.render();
        });
      }
      const groupBtn = document.getElementById('mode-group-btn');
      if (groupBtn) {
        groupBtn.addEventListener('click', () => {
          this.calendarMode = 'group';
          this.render();
        });
      }

      const inspectSelect = document.getElementById('inspect-user-select');
      if (inspectSelect) {
        inspectSelect.addEventListener('change', (e) => {
          this.inspectedUserId = e.target.value;
          this.calendarMode = 'personal';
          this.render();
        });
      }

      const targetUserId =
        currentUser.role === 'admin' && this.inspectedUserId
          ? this.inspectedUserId
          : currentUser.id;

      const clearMarksBtn = document.getElementById('clear-my-marks-btn');
      if (clearMarksBtn) {
        clearMarksBtn.addEventListener('click', () => {
          this.openConfirmModal({
            title: 'Очистка разметки',
            message: 'Очистить все отмеченные даты и часы в этом мероприятии?',
            confirmText: 'Да, очистить',
            danger: true,
            onConfirm: () => {
              store.clearUserAvailability(event.id, targetUserId);
              this.showToast('Разметка очищена');
              this.render();
            }
          });
        });
      }

      // Карточки лучших пересечений -> переход в конкретный день
      document.querySelectorAll('[data-jump-date]').forEach((card) => {
        card.addEventListener('click', () => {
          this.selectedDateStr = card.getAttribute('data-jump-date');
          this.calendarSubView = 'day';
          this.render();
        });
      });

      // Навигация по месяцам
      const prevMonthBtn = document.getElementById('cal-prev-month');
      if (prevMonthBtn) {
        prevMonthBtn.addEventListener('click', () => {
          this.viewMonth -= 1;
          if (this.viewMonth < 0) {
            this.viewMonth = 11;
            this.viewYear -= 1;
          }
          this.render();
        });
      }

      const nextMonthBtn = document.getElementById('cal-next-month');
      if (nextMonthBtn) {
        nextMonthBtn.addEventListener('click', () => {
          this.viewMonth += 1;
          if (this.viewMonth > 11) {
            this.viewMonth = 0;
            this.viewYear += 1;
          }
          this.render();
        });
      }

      const jumpEventBtn = document.getElementById('cal-jump-event');
      if (jumpEventBtn) {
        jumpEventBtn.addEventListener('click', () => {
          this._syncCalendarMonthToEvent(event);
          this.render();
        });
      }

      // Привязка интерактивности клеток месяца (ЛКМ - переход внутрь даты, ПКМ - покраска дня)
      const daysGrid = document.getElementById('calendar-days-grid');
      if (daysGrid) {
        daysGrid.addEventListener('contextmenu', (e) => e.preventDefault());

        daysGrid.querySelectorAll('.calendar-day-cell').forEach((cell) => {
          const dateStr = cell.getAttribute('data-date');

          // ЛКМ — перейти внутрь конкретной даты (интервалы по 30 минут)
          cell.addEventListener('click', (e) => {
            if (e.button !== 0) return;
            this.selectedDateStr = dateStr;
            this.calendarSubView = 'day';
            this.render();
          });

          // ПКМ — покрасить день (или начать протягивание с зажатой ПКМ)
          cell.addEventListener('mousedown', (e) => {
            if (e.button === 2) {
              e.preventDefault();
              const currentSummary = store.getUserDaySummary(event, targetUserId, dateStr);
              let nextColor = this.activeColor === 'erase' ? null : this.activeColor;
              // Если весь день уже покрашен этим же цветом, повторное нажатие ПКМ снимает покраску
              if (nextColor && currentSummary.uniformColor === nextColor) {
                nextColor = null;
              }

              this.paintDrag = {
                active: true,
                type: 'day',
                targetColor: nextColor,
                dirty: true
              };

              store.paintWholeDay(event.id, targetUserId, dateStr, nextColor, true);
              this._applyQuickCellVisual(cell, nextColor);
            }
          });

          cell.addEventListener('mouseenter', (e) => {
            if (this.paintDrag.active && this.paintDrag.type === 'day' && (e.buttons & 2) === 2) {
              this.paintDrag.dirty = true;
              store.paintWholeDay(
                event.id,
                targetUserId,
                dateStr,
                this.paintDrag.targetColor,
                true
              );
              this._applyQuickCellVisual(cell, this.paintDrag.targetColor);
            }
          });
        });
      }

      // Обработчики детального вида дня (30-минутные слоты)
      const backBtn = document.getElementById('back-to-month-btn');
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          this.calendarSubView = 'month';
          this.render();
        });
      }

      const prevDayBtn = document.getElementById('prev-day-btn');
      if (prevDayBtn) {
        prevDayBtn.addEventListener('click', () => {
          this.selectedDateStr = this._shiftDateISO(this.selectedDateStr, -1);
          this.render();
        });
      }

      const nextDayBtn = document.getElementById('next-day-btn');
      if (nextDayBtn) {
        nextDayBtn.addEventListener('click', () => {
          this.selectedDateStr = this._shiftDateISO(this.selectedDateStr, 1);
          this.render();
        });
      }

      const paintExpectedBtn = document.getElementById('paint-expected-day-btn');
      if (paintExpectedBtn) {
        paintExpectedBtn.addEventListener('click', () => {
          const color = this.activeColor === 'erase' ? null : this.activeColor;
          const startT = event.expectedStartTime || '00:00';
          const endT = event.expectedEndTime || '24:00';
          const slotsToPaint = store.ALL_TIME_SLOTS.filter((s) => s >= startT && s < endT);
          store.paintDayRange(event.id, targetUserId, this.selectedDateStr, slotsToPaint, color);
          this.render();
        });
      }

      const paintAllDayBtn = document.getElementById('paint-all-day-btn');
      if (paintAllDayBtn) {
        paintAllDayBtn.addEventListener('click', () => {
          const color = this.activeColor === 'erase' ? null : this.activeColor;
          store.paintWholeDay(event.id, targetUserId, this.selectedDateStr, color, false);
          this.render();
        });
      }

      const clearDayBtn = document.getElementById('clear-day-btn');
      if (clearDayBtn) {
        clearDayBtn.addEventListener('click', () => {
          store.paintWholeDay(event.id, targetUserId, this.selectedDateStr, null, false);
          this.render();
        });
      }

      // Привязка покраски 30-минутных слотов по ПКМ
      const slotsGrid = document.getElementById('day-slots-grid');
      if (slotsGrid && this.selectedDateStr) {
        slotsGrid.addEventListener('contextmenu', (e) => e.preventDefault());

        slotsGrid.querySelectorAll('.time-slot-row').forEach((row) => {
          const slotKey = row.getAttribute('data-slot');

          row.addEventListener('mousedown', (e) => {
            if (e.button === 2) {
              e.preventDefault();
              const existingColor = store.getUserSlotColor(
                event,
                targetUserId,
                this.selectedDateStr,
                slotKey
              );
              let nextColor = this.activeColor === 'erase' ? null : this.activeColor;
              if (nextColor && existingColor === nextColor) {
                nextColor = null;
              }

              this.paintDrag = {
                active: true,
                type: 'slot',
                targetColor: nextColor,
                dirty: true
              };

              store.paintTimeSlot(
                event.id,
                targetUserId,
                this.selectedDateStr,
                slotKey,
                nextColor,
                true
              );
              this._applyQuickCellVisual(row, nextColor);
            }
          });

          row.addEventListener('mouseenter', (e) => {
            if (this.paintDrag.active && this.paintDrag.type === 'slot' && (e.buttons & 2) === 2) {
              this.paintDrag.dirty = true;
              store.paintTimeSlot(
                event.id,
                targetUserId,
                this.selectedDateStr,
                slotKey,
                this.paintDrag.targetColor,
                true
              );
              this._applyQuickCellVisual(row, this.paintDrag.targetColor);
            }
          });
        });
      }
    }

    _applyQuickCellVisual(el, color) {
      el.classList.remove('painted-green', 'painted-blue', 'painted-red');
      if (color === 'green' || color === 'blue' || color === 'red') {
        el.classList.add(`painted-${color}`);
      }
    }

    finishPaintDrag() {
      const wasDirty = this.paintDrag.dirty;
      this.paintDrag = {
        active: false,
        type: null,
        targetColor: null,
        dirty: false
      };
      if (wasDirty) {
        store.save();
        this.render();
      }
    }

    _shiftDateISO(dateStr, deltaDays) {
      const [y, m, d] = dateStr.split('-').map((n) => parseInt(n, 10));
      const dt = new Date(y, m - 1, d + deltaDays);
      return store.formatDateISO(dt);
    }

    // ==================== МОДАЛЬНОЕ ОКНО СОЗДАНИЯ / РЕДАКТИРОВАНИЯ МЕРОПРИЯТИЯ ====================

    openEventFormModal(existingEvent = null) {
      const isEdit = Boolean(existingEvent);
      const users = store.getUsers();
      const today = new Date();
      const defaultStart = store.formatDateISO(today);
      const defaultEnd = store.formatDateISO(
        new Date(today.getFullYear(), today.getMonth(), today.getDate() + 5)
      );

      const selectedSet = new Set(
        existingEvent ? existingEvent.participantIds || [] : users.map((u) => u.id)
      );

      const timeOptions = store.ALL_TIME_SLOTS.concat(['24:00']);

      const html = `
        <div class="modal-header">
          <h3 class="modal-title">${isEdit ? 'Редактировать мероприятие' : 'Создать новое мероприятие'}</h3>
          <button type="button" class="btn btn-sm" id="modal-close-x">✕</button>
        </div>
        <form id="event-modal-form">
          <div class="form-group">
            <label class="form-label">Название мероприятия *</label>
            <input type="text" id="ev-title" class="form-input" required placeholder="Например: Выезд на природу / Настолки" value="${escapeHtml(existingEvent ? existingEvent.title : '')}" />
          </div>
          <div class="form-group">
            <label class="form-label">Описание / комментарий</label>
            <textarea id="ev-desc" class="form-textarea" rows="2" placeholder="Дополнительная информация для участников">${escapeHtml(existingEvent ? existingEvent.description : '')}</textarea>
          </div>
          <div class="form-row-2">
            <div class="form-group">
              <label class="form-label">Начало предполагаемого промежутка *</label>
              <input type="date" id="ev-start-date" class="form-input" required value="${escapeHtml(existingEvent ? existingEvent.startDate : defaultStart)}" />
            </div>
            <div class="form-group">
              <label class="form-label">Конец предполагаемого промежутка *</label>
              <input type="date" id="ev-end-date" class="form-input" required value="${escapeHtml(existingEvent ? existingEvent.endDate : defaultEnd)}" />
            </div>
          </div>
          <div class="form-row-2">
            <div class="form-group">
              <label class="form-label">Предполагаемое время (с)</label>
              <select id="ev-start-time" class="form-select">
                ${timeOptions
                  .slice(0, 48)
                  .map(
                    (t) =>
                      `<option value="${t}" ${(existingEvent ? existingEvent.expectedStartTime : '10:00') === t ? 'selected' : ''}>${t}</option>`
                  )
                  .join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Предполагаемое время (до)</label>
              <select id="ev-end-time" class="form-select">
                ${timeOptions
                  .slice(1)
                  .map(
                    (t) =>
                      `<option value="${t}" ${(existingEvent ? existingEvent.expectedEndTime : '22:00') === t ? 'selected' : ''}>${t}</option>`
                  )
                  .join('')}
              </select>
            </div>
          </div>

          <div class="form-group">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <label class="form-label" style="margin: 0;">Участники мероприятия *</label>
              <div style="display: flex; gap: 8px;">
                <button type="button" class="btn btn-sm" id="select-all-users-btn" style="padding: 2px 8px; font-size: 0.76rem;">Выбрать всех</button>
                <button type="button" class="btn btn-sm" id="deselect-all-users-btn" style="padding: 2px 8px; font-size: 0.76rem;">Снять всех</button>
              </div>
            </div>
            <div class="participants-checklist">
              ${users
                .map(
                  (u) => `
                  <label class="participant-check-item">
                    <input type="checkbox" name="ev-participant" value="${escapeHtml(u.id)}" ${selectedSet.has(u.id) ? 'checked' : ''} />
                    <span class="user-avatar" style="width:22px;height:22px;font-size:0.7rem;background:${escapeHtml(u.avatarColor || '#6366f1')}">
                      ${escapeHtml((u.displayName || u.login)[0].toUpperCase())}
                    </span>
                    <span style="font-weight: 600;">${escapeHtml(u.displayName)}</span>
                    <span style="color: var(--text-secondary); font-size: 0.82rem;">(@${escapeHtml(u.login)})</span>
                  </label>
                `
                )
                .join('')}
            </div>
          </div>

          <div id="ev-form-error" style="color: #ef4444; font-size: 0.85rem; display: none; margin-bottom: 10px;"></div>

          <div class="modal-footer">
            <button type="button" class="btn" id="modal-cancel-btn">Отмена</button>
            <button type="submit" class="btn btn-primary">${isEdit ? 'Сохранить изменения' : 'Создать мероприятие'}</button>
          </div>
        </form>
      `;

      this.openModal(html, () => {
        document.getElementById('modal-close-x')?.addEventListener('click', () => this.closeModal());
        document.getElementById('modal-cancel-btn')?.addEventListener('click', () => this.closeModal());

        document.getElementById('select-all-users-btn')?.addEventListener('click', () => {
          document.querySelectorAll('input[name="ev-participant"]').forEach((cb) => {
            cb.checked = true;
          });
        });
        document.getElementById('deselect-all-users-btn')?.addEventListener('click', () => {
          document.querySelectorAll('input[name="ev-participant"]').forEach((cb) => {
            cb.checked = false;
          });
        });

        const form = document.getElementById('event-modal-form');
        form?.addEventListener('submit', (e) => {
          e.preventDefault();
          const title = document.getElementById('ev-title').value;
          const description = document.getElementById('ev-desc').value;
          const startDate = document.getElementById('ev-start-date').value;
          const endDate = document.getElementById('ev-end-date').value;
          const expectedStartTime = document.getElementById('ev-start-time').value;
          const expectedEndTime = document.getElementById('ev-end-time').value;
          const checkedIds = Array.from(
            document.querySelectorAll('input[name="ev-participant"]:checked')
          ).map((cb) => cb.value);

          const errEl = document.getElementById('ev-form-error');
          if (expectedStartTime >= expectedEndTime) {
            errEl.textContent = 'Время окончания промежутка должно быть позже времени начала';
            errEl.style.display = 'block';
            return;
          }

          try {
            if (isEdit) {
              store.updateEvent(existingEvent.id, {
                title,
                description,
                startDate,
                endDate,
                expectedStartTime,
                expectedEndTime,
                participantIds: checkedIds
              });
              this.showToast('Мероприятие обновлено', 'success');
            } else {
              const created = store.createEvent({
                title,
                description,
                startDate,
                endDate,
                expectedStartTime,
                expectedEndTime,
                participantIds: checkedIds
              });
              this.selectedEventId = created.id;
              this.calendarSubView = 'month';
              this._syncCalendarMonthToEvent(created);
              this.showToast('Мероприятие создано', 'success');
            }
            this.closeModal();
            this.render();
          } catch (err) {
            errEl.textContent = err.message;
            errEl.style.display = 'block';
          }
        });
      });
    }

    // ==================== ВКЛАДКА: УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ (ДЛЯ АДМИНА) ====================

    renderUsersManagementTab() {
      const users = store.getUsers();
      return `
        <div class="workspace-panel">
          <div class="event-top-bar">
            <div>
              <h2 class="event-info-title">👥 Управление пользователями</h2>
              <p class="event-info-desc">
                Администратор может добавлять новых пользователей, редактировать их данные, менять пароли и удалять аккаунты.
              </p>
            </div>
            <button type="button" id="add-user-btn" class="btn btn-primary">+ Добавить пользователя</button>
          </div>

          <div class="users-table-wrap">
            <table class="users-table">
              <thead>
                <tr>
                  <th>Пользователь</th>
                  <th>Логин</th>
                  <th>Пароль</th>
                  <th>Роль</th>
                  <th style="text-align: right;">Действия</th>
                </tr>
              </thead>
              <tbody>
                ${users
                  .map((u) => {
                    const initial = (u.displayName || u.login || '?')[0].toUpperCase();
                    return `
                      <tr>
                        <td>
                          <div style="display: flex; align-items: center; gap: 10px;">
                            <span class="user-avatar" style="background: ${escapeHtml(u.avatarColor || '#6366f1')}">
                              ${escapeHtml(initial)}
                            </span>
                            <strong>${escapeHtml(u.displayName)}</strong>
                          </div>
                        </td>
                        <td><code>${escapeHtml(u.login)}</code></td>
                        <td>
                          <code style="background: var(--bg-elevated); padding: 3px 8px; border-radius: 4px;">
                            ${escapeHtml(u.password)}
                          </code>
                        </td>
                        <td>
                          <span class="user-role-tag">${u.role === 'admin' ? 'Администратор' : 'Пользователь'}</span>
                        </td>
                        <td style="text-align: right;">
                          <div style="display: inline-flex; gap: 8px;">
                            <button type="button" class="btn btn-sm" data-edit-user="${escapeHtml(u.id)}">✏️ Редактировать</button>
                            <button type="button" class="btn btn-danger btn-sm" data-delete-user="${escapeHtml(u.id)}">🗑️ Удалить</button>
                          </div>
                        </td>
                      </tr>
                    `;
                  })
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    bindUsersTab() {
      const addBtn = document.getElementById('add-user-btn');
      if (addBtn) {
        addBtn.addEventListener('click', () => this.openUserModal(null));
      }

      document.querySelectorAll('[data-edit-user]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const uid = btn.getAttribute('data-edit-user');
          const user = store.getUserById(uid);
          if (user) this.openUserModal(user);
        });
      });

      document.querySelectorAll('[data-delete-user]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const uid = btn.getAttribute('data-delete-user');
          const user = store.getUserById(uid);
          if (!user) return;
          this.openConfirmModal({
            title: 'Удаление пользователя',
            message: `Вы действительно хотите удалить пользователя «${user.displayName}» (@${user.login})?`,
            confirmText: 'Удалить пользователя',
            danger: true,
            onConfirm: () => {
              try {
                store.deleteUser(uid);
                this.showToast(`Пользователь @${user.login} удалён`, 'success');
                this.render();
              } catch (err) {
                this.showToast(err.message, 'error');
              }
            }
          });
        });
      });
    }

    openUserModal(existingUser = null) {
      const isEdit = Boolean(existingUser);
      const html = `
        <div class="modal-header">
          <h3 class="modal-title">${isEdit ? `Редактировать: @${escapeHtml(existingUser.login)}` : 'Добавить пользователя'}</h3>
          <button type="button" class="btn btn-sm" id="modal-close-x">✕</button>
        </div>
        <form id="user-modal-form">
          <div class="form-group">
            <label class="form-label">Логин для входа *</label>
            <input type="text" id="usr-login" class="form-input" required value="${escapeHtml(existingUser ? existingUser.login : '')}" placeholder="Например: ivan2" />
          </div>
          <div class="form-group">
            <label class="form-label">Отображаемое имя</label>
            <input type="text" id="usr-name" class="form-input" value="${escapeHtml(existingUser ? existingUser.displayName : '')}" placeholder="Например: Иван Петров" />
          </div>
          <div class="form-group">
            <label class="form-label">${isEdit ? 'Пароль (оставьте как есть или введите новый)' : 'Пароль *'}</label>
            <input type="text" id="usr-password" class="form-input" required value="${escapeHtml(existingUser ? existingUser.password : '')}" placeholder="Минимум 3 символа" />
          </div>
          <div class="form-group">
            <label class="form-label">Роль в системе</label>
            <select id="usr-role" class="form-select">
              <option value="user" ${!existingUser || existingUser.role === 'user' ? 'selected' : ''}>Пользователь (Участник опросов)</option>
              <option value="admin" ${existingUser && existingUser.role === 'admin' ? 'selected' : ''}>Администратор (Полный доступ)</option>
            </select>
          </div>
          <div id="usr-form-error" style="color: #ef4444; font-size: 0.85rem; display: none; margin-bottom: 10px;"></div>
          <div class="modal-footer">
            <button type="button" class="btn" id="modal-cancel-btn">Отмена</button>
            <button type="submit" class="btn btn-primary">${isEdit ? 'Сохранить' : 'Создать аккаунт'}</button>
          </div>
        </form>
      `;

      this.openModal(html, () => {
        document.getElementById('modal-close-x')?.addEventListener('click', () => this.closeModal());
        document.getElementById('modal-cancel-btn')?.addEventListener('click', () => this.closeModal());

        const form = document.getElementById('user-modal-form');
        form?.addEventListener('submit', (e) => {
          e.preventDefault();
          const login = document.getElementById('usr-login').value;
          const displayName = document.getElementById('usr-name').value;
          const password = document.getElementById('usr-password').value;
          const role = document.getElementById('usr-role').value;
          const errEl = document.getElementById('usr-form-error');

          try {
            if (isEdit) {
              store.updateUser(existingUser.id, { login, displayName, password, role });
              this.showToast('Данные пользователя обновлены', 'success');
            } else {
              store.addUser({ login, displayName, password, role });
              this.showToast('Пользователь успешно добавлен', 'success');
            }
            this.closeModal();
            this.render();
          } catch (err) {
            errEl.textContent = err.message;
            errEl.style.display = 'block';
          }
        });
      });
    }

    // ==================== ВКЛАДКА: НАСТРОЙКИ (ТЕМЫ, ПАРОЛЬ, FIREBASE ДЛЯ АДМИНА) ====================

    renderSettingsTab(currentUser) {
      const isAdmin = currentUser.role === 'admin';
      const activeTheme = store.getTheme();
      const fbCfg = fbService.config;

      return `
        <div style="display: flex; flex-direction: column; gap: 24px;">
          <!-- Карточка выбора темы оформления -->
          <div class="settings-card">
            <h2 class="settings-card-title">🎨 Темы оформления</h2>
            <p class="settings-card-desc">Выберите цветовую тему интерфейса. Настройка применяется мгновенно и сохраняется в браузере.</p>
            <div class="themes-grid">
              ${THEMES.map(
                (t) => `
                <div class="theme-card ${activeTheme === t.id ? 'active' : ''}" data-theme-select="${escapeHtml(t.id)}">
                  <div class="theme-preview-swatches">
                    ${t.colors
                      .map((c) => `<span class="theme-swatch-circle" style="background: ${c};"></span>`)
                      .join('')}
                  </div>
                  <div style="font-weight: 700; font-size: 0.95rem; margin-bottom: 4px;">${escapeHtml(t.name)}</div>
                  <div style="font-size: 0.8rem; color: var(--text-secondary);">${escapeHtml(t.desc)}</div>
                </div>
              `
              ).join('')}
            </div>
          </div>

          <div class="settings-grid">
            <!-- Карточка смены пароля с вводом дважды и подтверждением действия -->
            <div class="settings-card">
              <h2 class="settings-card-title">🔐 Смена пароля аккаунта</h2>
              <p class="settings-card-desc">
                Для безопасности введите текущий пароль, затем дважды введите новый пароль и подтвердите действие во всплывающем окне.
              </p>
              <form id="change-password-form">
                <div class="form-group">
                  <label class="form-label" for="cp-current">Текущий пароль *</label>
                  <input type="password" id="cp-current" class="form-input" required placeholder="Введите текущий пароль" />
                </div>
                <div class="form-group">
                  <label class="form-label" for="cp-new1">Новый пароль (первый раз) *</label>
                  <input type="password" id="cp-new1" class="form-input" required placeholder="Введите новый пароль" />
                </div>
                <div class="form-group">
                  <label class="form-label" for="cp-new2">Повторите новый пароль (второй раз) *</label>
                  <input type="password" id="cp-new2" class="form-input" required placeholder="Введите новый пароль ещё раз" />
                </div>
                <div id="cp-error" style="color: #ef4444; font-size: 0.86rem; margin-bottom: 12px; display: none;"></div>
                <button type="submit" class="btn btn-primary">Сменить пароль</button>
              </form>
            </div>

            <!-- Карточка настройки БД Firebase (Только для администратора) -->
            ${
              isAdmin
                ? `
              <div class="settings-card">
                <h2 class="settings-card-title">🔥 Настройка БД Firebase (Для администратора)</h2>
                <p class="settings-card-desc">
                  Подключите Cloud Firestore или Realtime Database для онлайн-синхронизации между всеми участниками на GitHub Pages.
                </p>

                <div class="form-group">
                  <label class="form-label" for="fb-mode-select">Режим базы данных Firebase</label>
                  <select id="fb-mode-select" class="form-select">
                    <option value="firestore" ${!fbCfg || fbCfg.mode === 'firestore' ? 'selected' : ''}>Cloud Firestore (Рекомендуется)</option>
                    <option value="rtdb" ${fbCfg && fbCfg.mode === 'rtdb' ? 'selected' : ''}>Realtime Database (RTDB)</option>
                  </select>
                </div>

                <div class="form-group">
                  <label class="form-label" for="fb-config-input">
                    Объект конфигурации <code>firebaseConfig</code> (JSON или код из консоли Firebase)
                  </label>
                  <textarea id="fb-config-input" class="form-textarea" rows="8" style="font-family: monospace; font-size: 0.82rem;" placeholder='{\n  "apiKey": "AIzaSy...",\n  "authDomain": "project.firebaseapp.com",\n  "databaseURL": "https://project-default-rtdb.firebaseio.com",\n  "projectId": "project",\n  "storageBucket": "project.appspot.com",\n  "messagingSenderId": "...",\n  "appId": "..."\n}'>${escapeHtml(fbCfg ? JSON.stringify(fbCfg, null, 2) : '')}</textarea>
                </div>

                <div id="fb-config-msg" style="font-size: 0.85rem; margin-bottom: 12px; display: none;"></div>

                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                  <button type="button" id="fb-save-btn" class="btn btn-primary">💾 Сохранить и подключить БД</button>
                  <button type="button" id="fb-push-btn" class="btn">☁️ Выгрузить текущие данные в БД</button>
                  <button type="button" id="fb-share-link-btn" class="btn" title="Скопировать ссылку с зашитыми настройками БД для участников">🔗 Скопировать ссылку с БД</button>
                  <button type="button" id="fb-download-cfg-btn" class="btn" title="Скачать готовый файл js/firebase-config.js для репозитория GitHub Pages">📥 Скачать firebase-config.js</button>
                  ${
                    fbCfg
                      ? `<button type="button" id="fb-disconnect-btn" class="btn btn-danger">Отключить Firebase</button>`
                      : ''
                  }
                </div>
              </div>
            `
                : `
              <div class="settings-card">
                <h2 class="settings-card-title">ℹ️ Информация о подключении</h2>
                <p class="settings-card-desc">
                  Настройка базы данных Firebase доступна только администратору сайта.
                </p>
                <div class="info-badge">
                  Статус БД: ${fbService.status === 'connected' ? 'Онлайн (Firebase подключен)' : 'Локальный режим'}
                </div>
              </div>
            `
            }
          </div>
        </div>
      `;
    }

    bindSettingsTab() {
      // Переключение темы
      document.querySelectorAll('[data-theme-select]').forEach((card) => {
        card.addEventListener('click', () => {
          const themeId = card.getAttribute('data-theme-select');
          store.setTheme(themeId);
          this.showToast('Тема оформления изменена', 'success');
          this.render();
        });
      });

      // Смена пароля (с двойным вводом + модальным подтверждением действия)
      const cpForm = document.getElementById('change-password-form');
      if (cpForm) {
        cpForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const currentPass = document.getElementById('cp-current').value;
          const newPass1 = document.getElementById('cp-new1').value;
          const newPass2 = document.getElementById('cp-new2').value;
          const errEl = document.getElementById('cp-error');
          errEl.style.display = 'none';

          const user = store.getCurrentUser();
          if (!user) return;

          if (user.password !== currentPass) {
            errEl.textContent = 'Текущий пароль введён неверно';
            errEl.style.display = 'block';
            return;
          }

          if (newPass1.length < 3) {
            errEl.textContent = 'Новый пароль должен содержать минимум 3 символа';
            errEl.style.display = 'block';
            return;
          }

          if (newPass1 !== newPass2) {
            errEl.textContent = 'Новые пароли не совпадают! Введите одинаковый новый пароль в оба поля.';
            errEl.style.display = 'block';
            return;
          }

          // Обязательное подтверждение действия перед сменой пароля
          this.openConfirmModal({
            title: 'Подтверждение смены пароля',
            message: `Вы действительно хотите сменить пароль для вашего аккаунта @${user.login}? Подтвердите выполнение действия.`,
            confirmText: 'Подтвердить смену пароля',
            danger: false,
            onConfirm: () => {
              try {
                store.changeOwnPassword(currentPass, newPass1);
                cpForm.reset();
                this.showToast('Пароль успешно изменён!', 'success');
              } catch (err) {
                errEl.textContent = err.message;
                errEl.style.display = 'block';
              }
            }
          });
        });
      }

      // Настройки Firebase для Админа
      const fbSaveBtn = document.getElementById('fb-save-btn');
      if (fbSaveBtn) {
        fbSaveBtn.addEventListener('click', async () => {
          const rawInput = document.getElementById('fb-config-input').value;
          const mode = document.getElementById('fb-mode-select').value;
          const msgEl = document.getElementById('fb-config-msg');

          try {
            const parsed = fbService.parseConfigInput(rawInput, mode);
            msgEl.style.display = 'block';
            msgEl.style.color = 'var(--text-secondary)';
            msgEl.textContent = 'Подключение к Firebase...';

            const ok = await fbService.updateConfig(parsed);
            if (ok) {
              await fbService.saveRemoteState(store.state);
              this.showToast('Firebase успешно подключен и синхронизирован!', 'success');
              this.render();
            } else {
              msgEl.style.color = '#ef4444';
              msgEl.textContent = fbService.lastError || 'Не удалось подключиться к Firebase';
            }
          } catch (err) {
            msgEl.style.display = 'block';
            msgEl.style.color = '#ef4444';
            msgEl.textContent = err.message;
          }
        });
      }

      const fbPushBtn = document.getElementById('fb-push-btn');
      if (fbPushBtn) {
        fbPushBtn.addEventListener('click', async () => {
          if (!fbService.config) {
            this.showToast('Сначала сохраните конфигурацию Firebase', 'error');
            return;
          }
          const ok = await fbService.saveRemoteState(store.state);
          if (ok) {
            this.showToast('Текущие данные успешно выгружены в Firebase!', 'success');
          } else {
            this.showToast('Ошибка выгрузки данных. Проверьте правила доступа (Rules) в Firebase.', 'error');
          }
        });
      }

      const fbShareBtn = document.getElementById('fb-share-link-btn');
      if (fbShareBtn) {
        fbShareBtn.addEventListener('click', () => {
          if (!fbService.config) {
            this.showToast('Сначала сохраните конфигурацию Firebase', 'error');
            return;
          }
          const url = fbService.generateShareUrl();
          navigator.clipboard?.writeText(url);
          this.showToast('Ссылка со встроенной настройкой БД скопирована в буфер обмена!', 'success');
        });
      }

      const fbDownloadBtn = document.getElementById('fb-download-cfg-btn');
      if (fbDownloadBtn) {
        fbDownloadBtn.addEventListener('click', () => {
          if (!fbService.config) {
            this.showToast('Сначала сохраните конфигурацию Firebase', 'error');
            return;
          }
          const content = fbService.generateConfigFileContent();
          const blob = new Blob([content], { type: 'application/javascript;charset=utf-8' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'firebase-config.js';
          a.click();
          this.showToast('Файл firebase-config.js скачан (замените им js/firebase-config.js на GitHub Pages)', 'success');
        });
      }

      const fbDisconnectBtn = document.getElementById('fb-disconnect-btn');
      if (fbDisconnectBtn) {
        fbDisconnectBtn.addEventListener('click', async () => {
          await fbService.updateConfig(null);
          this.showToast('Firebase отключен. Сайт переведён в локальный режим.');
          this.render();
        });
      }
    }

    // ==================== УНИВЕРСАЛЬНОЕ ОКНО ПОДТВЕРЖДЕНИЯ ДЕЙСТВИЯ ====================

    openConfirmModal({ title, message, confirmText = 'Подтвердить', danger = false, onConfirm }) {
      const html = `
        <div class="modal-header">
          <h3 class="modal-title">${escapeHtml(title)}</h3>
          <button type="button" class="btn btn-sm" id="confirm-close-x">✕</button>
        </div>
        <p style="margin: 0 0 16px 0; color: var(--text-secondary); font-size: 0.95rem;">
          ${escapeHtml(message)}
        </p>
        <div class="modal-footer">
          <button type="button" class="btn" id="confirm-cancel-btn">Отмена</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirm-ok-btn">
            ${escapeHtml(confirmText)}
          </button>
        </div>
      `;

      this.openModal(html, () => {
        document.getElementById('confirm-close-x')?.addEventListener('click', () => this.closeModal());
        document.getElementById('confirm-cancel-btn')?.addEventListener('click', () => this.closeModal());
        document.getElementById('confirm-ok-btn')?.addEventListener('click', () => {
          this.closeModal();
          if (onConfirm) onConfirm();
        });
      });
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    window.timePollApp = app;
    app.init();
  });
})();

