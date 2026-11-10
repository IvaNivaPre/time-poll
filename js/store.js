/**
 * Хранилище данных (Store) приложения TimePoll:
 * управление пользователями, авторизацией, темами, мероприятиями и расписанием.
 */
(function () {
  const STORAGE_KEY = 'timepoll_state_v1';
  const SESSION_KEY = 'timepoll_session_user_id';
  const THEME_KEY = 'timepoll_theme';

  const AVATAR_COLORS = [
    '#6366f1', '#10b981', '#f59e0b', '#ec4899',
    '#3b82f6', '#8b5cf6', '#14b8a6', '#f97316'
  ];

  // Генерация 48 слотов по 30 минут: ["00:00", "00:30", ..., "23:30"]
  const ALL_TIME_SLOTS = [];
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, '0');
    ALL_TIME_SLOTS.push(`${hh}:00`);
    ALL_TIME_SLOTS.push(`${hh}:30`);
  }

  function formatSlotEnd(slotKey) {
    const [hStr, mStr] = slotKey.split(':');
    let h = parseInt(hStr, 10);
    let m = parseInt(mStr, 10) + 30;
    if (m >= 60) {
      m = 0;
      h += 1;
    }
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function formatDateISO(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  class Store {
    constructor() {
      this.ALL_TIME_SLOTS = ALL_TIME_SLOTS;
      this.formatSlotEnd = formatSlotEnd;
      this.formatDateISO = formatDateISO;
      this.listeners = [];
      this.state = this._loadLocalState();
      this._ensureAdminAccount();
      this.currentUserId = localStorage.getItem(SESSION_KEY) || null;
      this.theme = localStorage.getItem(THEME_KEY) || 'dark';
    }

    _getDefaultState() {
      const today = new Date();
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2);
      const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 8);

      return {
        version: 1,
        updatedAt: Date.now(),
        users: [
          {
            id: 'u_admin_ivaniva',
            login: 'ivaniva',
            displayName: 'Администратор (ivaniva)',
            password: 'Iiv1334060',
            role: 'admin',
            avatarColor: '#6366f1',
            createdAt: Date.now()
          }
        ],
        events: [
          {
            id: 'ev_demo_1',
            title: 'Встреча команды / Мероприятие',
            description: 'Отметьте правой кнопкой мыши (ПКМ) удобные дни в календаре или кликните ЛКМ на конкретный день, чтобы отметить удобное время.',
            startDate: formatDateISO(start),
            endDate: formatDateISO(end),
            expectedStartTime: '',
            expectedEndTime: '',
            participantIds: ['u_admin_ivaniva'],
            createdBy: 'u_admin_ivaniva',
            createdAt: Date.now(),
            availability: {}
          }
        ]
      };
    }

    _loadLocalState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.users) && Array.isArray(parsed.events)) {
            return parsed;
          }
        }
      } catch (e) {
        console.warn('Не удалось загрузить локальное состояние:', e);
      }
      return this._getDefaultState();
    }

    /**
     * Гарантирует наличие админского аккаунта ivaniva
     */
    _ensureAdminAccount() {
      if (!Array.isArray(this.state.users)) {
        this.state.users = [];
      }
      const existingAdmin = this.state.users.find(
        (u) => u.login.toLowerCase() === 'ivaniva'
      );
      if (!existingAdmin) {
        this.state.users.unshift({
          id: 'u_admin_ivaniva',
          login: 'ivaniva',
          displayName: 'Администратор (ivaniva)',
          password: 'Iiv1334060',
          role: 'admin',
          avatarColor: '#6366f1',
          createdAt: Date.now()
        });
        this._saveLocalOnly();
      } else if (existingAdmin.role !== 'admin') {
        existingAdmin.role = 'admin';
        this._saveLocalOnly();
      }
    }

    _saveLocalOnly() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch (e) {
        console.error('Ошибка записи в localStorage:', e);
      }
    }

    save(skipRemote = false) {
      this.state.updatedAt = Date.now();
      this._saveLocalOnly();
      if (!skipRemote && window.firebaseService) {
        window.firebaseService.saveRemoteState(this.state);
      }
      this.notify();
    }

    applyRemoteState(remoteState, isEmptyRemote = false) {
      if (isEmptyRemote) {
        // Если база Firebase пустая — отправляем туда наши текущие данные
        if (window.firebaseService) {
          window.firebaseService.saveRemoteState(this.state);
        }
        return;
      }

      if (!remoteState || typeof remoteState !== 'object') return;
      const users = Array.isArray(remoteState.users)
        ? remoteState.users
        : Object.values(remoteState.users || {});
      const events = Array.isArray(remoteState.events)
        ? remoteState.events
        : Object.values(remoteState.events || {});

      // Нормализуем структуру событий после получения из RTDB (где пустые объекты могут исчезать)
      const normalizedEvents = events.map((ev) => ({
        ...ev,
        participantIds: Array.isArray(ev.participantIds)
          ? ev.participantIds
          : Object.values(ev.participantIds || {}),
        availability: ev.availability || {}
      }));

      this.state = {
        version: remoteState.version || 1,
        updatedAt: remoteState.updatedAt || Date.now(),
        users,
        events: normalizedEvents
      };
      this._ensureAdminAccount();
      this._saveLocalOnly();

      // Проверяем, существует ли еще текущий залогиненный пользователь
      if (this.currentUserId && !this.getUserById(this.currentUserId)) {
        this.logout();
      }
      this.notify();
    }

    subscribe(listener) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      };
    }

    notify() {
      for (const listener of this.listeners) {
        try {
          listener(this.state);
        } catch (e) {
          console.error(e);
        }
      }
    }

    // ==================== АВТОРИЗАЦИЯ ====================

    getCurrentUser() {
      if (!this.currentUserId) return null;
      return this.getUserById(this.currentUserId) || null;
    }

    isAdmin() {
      const u = this.getCurrentUser();
      return Boolean(u && u.role === 'admin');
    }

    login(loginStr, passwordStr) {
      const cleanLogin = (loginStr || '').trim().toLowerCase();
      const user = this.state.users.find(
        (u) => u.login.toLowerCase() === cleanLogin && u.password === passwordStr
      );
      if (!user) {
        throw new Error('Неверный логин или пароль');
      }
      this.currentUserId = user.id;
      localStorage.setItem(SESSION_KEY, user.id);
      this.notify();
      return user;
    }

    logout() {
      this.currentUserId = null;
      localStorage.removeItem(SESSION_KEY);
      this.notify();
    }

    // ==================== ПОЛЬЗОВАТЕЛИ ====================

    getUsers() {
      return this.state.users;
    }

    getUserById(id) {
      return this.state.users.find((u) => u.id === id);
    }

    addUser({ login, displayName, password, role = 'user' }) {
      if (!this.isAdmin()) {
        throw new Error('Только администратор может добавлять пользователей');
      }
      const cleanLogin = (login || '').trim();
      if (!cleanLogin) {
        throw new Error('Логин не может быть пустым');
      }
      if (!password || password.length < 3) {
        throw new Error('Пароль должен содержать минимум 3 символа');
      }
      const exists = this.state.users.some(
        (u) => u.login.toLowerCase() === cleanLogin.toLowerCase()
      );
      if (exists) {
        throw new Error(`Пользователь с логином "${cleanLogin}" уже существует`);
      }

      const newUser = {
        id: 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        login: cleanLogin,
        displayName: (displayName || '').trim() || cleanLogin,
        password,
        role: role === 'admin' ? 'admin' : 'user',
        avatarColor: AVATAR_COLORS[this.state.users.length % AVATAR_COLORS.length],
        createdAt: Date.now()
      };

      this.state.users.push(newUser);
      this.save();
      return newUser;
    }

    updateUser(userId, { login, displayName, password, role }) {
      if (!this.isAdmin()) {
        throw new Error('Только администратор может редактировать пользователей');
      }
      const user = this.getUserById(userId);
      if (!user) {
        throw new Error('Пользователь не найден');
      }

      const cleanLogin = (login || '').trim();
      if (!cleanLogin) {
        throw new Error('Логин не может быть пустым');
      }

      const duplicate = this.state.users.find(
        (u) => u.id !== userId && u.login.toLowerCase() === cleanLogin.toLowerCase()
      );
      if (duplicate) {
        throw new Error(`Логин "${cleanLogin}" уже занят другим пользователем`);
      }

      // Не даем лишить прав последнего администратора
      if (user.role === 'admin' && role !== 'admin') {
        const adminCount = this.state.users.filter((u) => u.role === 'admin').length;
        if (adminCount <= 1) {
          throw new Error('Нельзя снять права с единственного администратора');
        }
      }

      user.login = cleanLogin;
      user.displayName = (displayName || '').trim() || cleanLogin;
      if (password !== undefined && password !== '') {
        if (password.length < 3) {
          throw new Error('Пароль должен содержать минимум 3 символа');
        }
        user.password = password;
      }
      if (role) {
        user.role = role === 'admin' ? 'admin' : 'user';
      }

      this.save();
      return user;
    }

    deleteUser(userId) {
      if (!this.isAdmin()) {
        throw new Error('Только администратор может удалять пользователей');
      }
      const user = this.getUserById(userId);
      if (!user) {
        throw new Error('Пользователь не найден');
      }
      if (user.role === 'admin') {
        const adminCount = this.state.users.filter((u) => u.role === 'admin').length;
        if (adminCount <= 1) {
          throw new Error('Нельзя удалить единственного администратора');
        }
      }

      this.state.users = this.state.users.filter((u) => u.id !== userId);
      // Удаляем пользователя из списков участников и разметки мероприятий
      for (const ev of this.state.events) {
        if (Array.isArray(ev.participantIds)) {
          ev.participantIds = ev.participantIds.filter((id) => id !== userId);
        }
        if (ev.availability && ev.availability[userId]) {
          delete ev.availability[userId];
        }
      }

      if (this.currentUserId === userId) {
        this.logout();
      }
      this.save();
    }

    changeOwnPassword(currentPassword, newPassword) {
      const user = this.getCurrentUser();
      if (!user) {
        throw new Error('Необходимо войти в аккаунт');
      }
      if (user.password !== currentPassword) {
        throw new Error('Текущий пароль введён неверно');
      }
      if (!newPassword || newPassword.length < 3) {
        throw new Error('Новый пароль должен содержать минимум 3 символа');
      }
      user.password = newPassword;
      this.save();
      return true;
    }

    // ==================== МЕРОПРИЯТИЯ ====================

    getEventsForCurrentUser() {
      const user = this.getCurrentUser();
      if (!user) return [];
      if (user.role === 'admin') {
        return this.state.events;
      }
      return this.state.events.filter(
        (ev) => Array.isArray(ev.participantIds) && ev.participantIds.includes(user.id)
      );
    }

    getEventById(eventId) {
      return this.state.events.find((e) => e.id === eventId) || null;
    }

    canUserParticipate(event, userId) {
      if (!event || !userId) return false;
      const user = this.getUserById(userId);
      if (!user) return false;
      return (
        (Array.isArray(event.participantIds) && event.participantIds.includes(userId)) ||
        user.role === 'admin'
      );
    }

    createEvent({
      title,
      description,
      startDate = '',
      endDate = '',
      expectedStartTime = '',
      expectedEndTime = '',
      participantIds = []
    }) {
      if (!this.isAdmin()) {
        throw new Error('Только администратор может создавать мероприятия');
      }
      const cleanTitle = (title || '').trim();
      if (!cleanTitle) {
        throw new Error('Введите название мероприятия');
      }
      if (startDate && endDate && startDate > endDate) {
        throw new Error('Дата начала не может быть позже даты окончания');
      }

      const newEvent = {
        id: 'ev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        title: cleanTitle,
        description: (description || '').trim(),
        startDate: startDate || '',
        endDate: endDate || '',
        expectedStartTime: expectedStartTime || '',
        expectedEndTime: expectedEndTime || '',
        participantIds: Array.from(new Set(participantIds)),
        createdBy: this.currentUserId,
        createdAt: Date.now(),
        availability: {}
      };

      this.state.events.unshift(newEvent);
      this.save();
      return newEvent;
    }

    updateEvent(
      eventId,
      { title, description, startDate, endDate, expectedStartTime, expectedEndTime, participantIds }
    ) {
      if (!this.isAdmin()) {
        throw new Error('Только администратор может редактировать мероприятия');
      }
      const ev = this.getEventById(eventId);
      if (!ev) {
        throw new Error('Мероприятие не найдено');
      }
      const cleanTitle = (title || '').trim();
      if (!cleanTitle) {
        throw new Error('Введите название мероприятия');
      }
      if (startDate && endDate && startDate > endDate) {
        throw new Error('Дата начала не может быть позже даты окончания');
      }

      ev.title = cleanTitle;
      ev.description = (description || '').trim();
      ev.startDate = startDate || '';
      ev.endDate = endDate || '';
      ev.expectedStartTime = expectedStartTime || '';
      ev.expectedEndTime = expectedEndTime || '';
      if (Array.isArray(participantIds)) {
        ev.participantIds = Array.from(new Set(participantIds));
      }

      this.save();
      return ev;
    }

    deleteEvent(eventId) {
      if (!this.isAdmin()) {
        throw new Error('Только администратор может удалять мероприятия');
      }
      this.state.events = this.state.events.filter((e) => e.id !== eventId);
      this.save();
    }

    // ==================== ПОКРАСКА КАЛЕНДАРЯ И ВРЕМЕНИ ====================

    isDateInExpectedRange(event, dateStr) {
      if (!event || !event.startDate || !event.endDate) return true;
      return dateStr >= event.startDate && dateStr <= event.endDate;
    }

    isSlotInExpectedRange(event, dateStr, slotKey) {
      if (!this.isDateInExpectedRange(event, dateStr)) return false;
      const startT = event.expectedStartTime || '00:00';
      const endT = event.expectedEndTime || '24:00';
      return slotKey >= startT && slotKey < endT;
    }

    _ensureUserDayRecord(event, userId, dateStr) {
      if (!event.availability) event.availability = {};
      if (!event.availability[userId]) event.availability[userId] = {};
      if (!event.availability[userId][dateStr]) {
        event.availability[userId][dateStr] = { slots: {} };
      }
      if (!event.availability[userId][dateStr].slots) {
        event.availability[userId][dateStr].slots = {};
      }
      return event.availability[userId][dateStr];
    }

    /**
     * Покраска целого дня из календаря (заполняет все 48 получасовых слотов этого дня выбранным цветом)
     */
    paintWholeDay(eventId, userId, dateStr, color, deferSave = false) {
      const event = this.getEventById(eventId);
      if (!event) return;

      // Если администратор красит календарь, но еще не добавил себя в список участников — добавим автоматически
      if (!Array.isArray(event.participantIds)) event.participantIds = [];
      if (!event.participantIds.includes(userId)) {
        event.participantIds.push(userId);
      }

      if (!color || color === 'erase') {
        if (event.availability && event.availability[userId]) {
          delete event.availability[userId][dateStr];
        }
      } else {
        const rec = this._ensureUserDayRecord(event, userId, dateStr);
        rec.slots = {};
        for (const slot of ALL_TIME_SLOTS) {
          rec.slots[slot] = color;
        }
      }

      if (!deferSave) {
        this.save();
      }
    }

    /**
     * Покраска одного 30-минутного слота внутри конкретного дня
     */
    paintTimeSlot(eventId, userId, dateStr, slotKey, color, deferSave = false) {
      const event = this.getEventById(eventId);
      if (!event) return;

      if (!Array.isArray(event.participantIds)) event.participantIds = [];
      if (!event.participantIds.includes(userId)) {
        event.participantIds.push(userId);
      }

      const rec = this._ensureUserDayRecord(event, userId, dateStr);
      if (!color || color === 'erase') {
        delete rec.slots[slotKey];
        if (Object.keys(rec.slots).length === 0) {
          delete event.availability[userId][dateStr];
        }
      } else {
        rec.slots[slotKey] = color;
      }

      if (!deferSave) {
        this.save();
      }
    }

    /**
     * Быстрая покраска всех слотов дня (например, только в предполагаемом промежутке или весь день)
     */
    paintDayRange(eventId, userId, dateStr, slotKeys, color) {
      for (const s of slotKeys) {
        this.paintTimeSlot(eventId, userId, dateStr, s, color, true);
      }
      this.save();
    }

    /**
     * Очистить всю разметку пользователя в мероприятии
     */
    clearUserAvailability(eventId, userId) {
      const event = this.getEventById(eventId);
      if (!event || !event.availability) return;
      delete event.availability[userId];
      this.save();
    }

    getUserSlotColor(event, userId, dateStr, slotKey) {
      if (
        !event ||
        !event.availability ||
        !event.availability[userId] ||
        !event.availability[userId][dateStr] ||
        !event.availability[userId][dateStr].slots
      ) {
        return null;
      }
      return event.availability[userId][dateStr].slots[slotKey] || null;
    }

    /**
     * Сводка разметки одного пользователя за конкретный день (для отображения на клетке календаря)
     */
    getUserDaySummary(event, userId, dateStr) {
      const counts = { green: 0, blue: 0, red: 0, total: 0 };
      if (
        !event ||
        !event.availability ||
        !event.availability[userId] ||
        !event.availability[userId][dateStr] ||
        !event.availability[userId][dateStr].slots
      ) {
        return {
          counts,
          uniformColor: null,
          dominantColor: null,
          isMixed: false
        };
      }

      const slots = event.availability[userId][dateStr].slots;
      for (const key of Object.keys(slots)) {
        const c = slots[key];
        if (c === 'green' || c === 'blue' || c === 'red') {
          counts[c]++;
          counts.total++;
        }
      }

      if (counts.total === 0) {
        return { counts, uniformColor: null, dominantColor: null, isMixed: false };
      }

      let uniformColor = null;
      if (counts.green === 48) uniformColor = 'green';
      else if (counts.blue === 48) uniformColor = 'blue';
      else if (counts.red === 48) uniformColor = 'red';

      let dominantColor = null;
      const nonZeroTypes = ['green', 'blue', 'red'].filter((k) => counts[k] > 0);
      if (nonZeroTypes.length === 1 && counts.total === 48) {
        dominantColor = nonZeroTypes[0];
      } else {
        // Приоритет отображения доминирующего цвета
        if (counts.green >= counts.blue && counts.green >= counts.red && counts.green > 0) {
          dominantColor = 'green';
        } else if (counts.blue >= counts.green && counts.blue >= counts.red && counts.blue > 0) {
          dominantColor = 'blue';
        } else if (counts.red > 0) {
          dominantColor = 'red';
        }
      }

      return {
        counts,
        uniformColor,
        dominantColor,
        isMixed: uniformColor === null && counts.total > 0
      };
    }

    /**
     * Групповая сводка по конкретному 30-минутному слоту среди всех участников мероприятия
     */
    getGroupSlotStats(event, dateStr, slotKey) {
      const participants = (event.participantIds || [])
        .map((id) => this.getUserById(id))
        .filter(Boolean);

      const greenUsers = [];
      const blueUsers = [];
      const redUsers = [];
      const unmarkedUsers = [];

      for (const u of participants) {
        const c = this.getUserSlotColor(event, u.id, dateStr, slotKey);
        if (c === 'green') greenUsers.push(u);
        else if (c === 'blue') blueUsers.push(u);
        else if (c === 'red') redUsers.push(u);
        else unmarkedUsers.push(u);
      }

      const availableCount = greenUsers.length + blueUsers.length;
      const score = greenUsers.length * 3 + blueUsers.length * 2 - redUsers.length * 4;

      return {
        totalParticipants: participants.length,
        greenUsers,
        blueUsers,
        redUsers,
        unmarkedUsers,
        availableCount,
        score
      };
    }

    /**
     * Групповая сводка по дню (сколько участников свободны в этот день хотя бы в какие-то слоты)
     */
    getGroupDayStats(event, dateStr) {
      const participants = (event.participantIds || [])
        .map((id) => this.getUserById(id))
        .filter(Boolean);

      const userStatuses = {
        green: [],
        blue: [],
        red: [],
        unmarked: []
      };

      for (const u of participants) {
        const sum = this.getUserDaySummary(event, u.id, dateStr);
        if (sum.counts.total === 0) {
          userStatuses.unmarked.push(u);
        } else if (sum.counts.green > 0) {
          userStatuses.green.push(u);
        } else if (sum.counts.blue > 0) {
          userStatuses.blue.push(u);
        } else {
          userStatuses.red.push(u);
        }
      }

      return {
        totalParticipants: participants.length,
        ...userStatuses,
        availableCount: userStatuses.green.length + userStatuses.blue.length
      };
    }

    /**
     * Находит лучшие пересечения времени для мероприятия
     */
    findBestIntervals(event, limit = 6) {
      if (!event) return [];
      const dateSet = new Set();
      if (event.availability) {
        for (const uid of Object.keys(event.availability)) {
          for (const d of Object.keys(event.availability[uid] || {})) {
            dateSet.add(d);
          }
        }
      }

      const results = [];
      const sortedDates = Array.from(dateSet).sort();

      for (const dateStr of sortedDates) {
        let currentBlock = null;
        for (const slotKey of ALL_TIME_SLOTS) {
          const stats = this.getGroupSlotStats(event, dateStr, slotKey);
          if (stats.availableCount > 0) {
            const signature = [
              stats.greenUsers.map((u) => u.id).join(','),
              stats.blueUsers.map((u) => u.id).join(','),
              stats.redUsers.map((u) => u.id).join(',')
            ].join('|');

            if (currentBlock && currentBlock.signature === signature) {
              currentBlock.endSlot = formatSlotEnd(slotKey);
              currentBlock.slotCount += 1;
            } else {
              if (currentBlock) results.push(currentBlock);
              currentBlock = {
                dateStr,
                startSlot: slotKey,
                endSlot: formatSlotEnd(slotKey),
                slotCount: 1,
                signature,
                stats,
                inExpectedRange: this.isSlotInExpectedRange(event, dateStr, slotKey)
              };
            }
          } else if (currentBlock) {
            results.push(currentBlock);
            currentBlock = null;
          }
        }
        if (currentBlock) {
          results.push(currentBlock);
        }
      }

      results.sort((a, b) => {
        if (b.stats.availableCount !== a.stats.availableCount) {
          return b.stats.availableCount - a.stats.availableCount;
        }
        if (a.stats.redUsers.length !== b.stats.redUsers.length) {
          return a.stats.redUsers.length - b.stats.redUsers.length;
        }
        if (b.stats.score !== a.stats.score) {
          return b.stats.score - a.stats.score;
        }
        if (b.inExpectedRange !== a.inExpectedRange) {
          return (b.inExpectedRange ? 1 : 0) - (a.inExpectedRange ? 1 : 0);
        }
        return b.slotCount - a.slotCount;
      });

      return results.slice(0, limit);
    }

    // ==================== ТЕМЫ ====================

    setTheme(themeName) {
      this.theme = themeName;
      localStorage.setItem(THEME_KEY, themeName);
      document.documentElement.setAttribute('data-theme', themeName);
      this.notify();
    }

    getTheme() {
      return this.theme;
    }
  }

  window.appStore = new Store();
})();

