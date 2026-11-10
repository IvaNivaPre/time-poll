/**
 * Сервис синхронизации с Firebase (Firestore и Realtime Database) + резервное локальное хранилище.
 */
(function () {
  const FB_CONFIG_KEY = 'timepoll_firebase_config';

  class FirebaseService {
    constructor() {
      this.config = null;
      this.app = null;
      this.db = null;
      this.mode = 'local'; // 'local' | 'firestore' | 'rtdb'
      this.status = 'local'; // 'local' | 'connecting' | 'connected' | 'error'
      this.lastError = null;
      this.unsubscribe = null;
      this.onRemoteDataCallback = null;
      this.onStatusChangeCallback = null;
      this.isApplyingRemote = false;

      this._checkUrlConfig();
      this._loadSavedConfig();
    }

    /**
     * Проверяет, передана ли конфигурация БД в URL-ссылке (?fb_config=...)
     */
    _checkUrlConfig() {
      try {
        const params = new URLSearchParams(window.location.search);
        const encoded = params.get('fb_config');
        if (encoded) {
          const jsonStr = decodeURIComponent(escape(atob(encoded)));
          const parsed = JSON.parse(jsonStr);
          if (parsed && (parsed.projectId || parsed.databaseURL)) {
            localStorage.setItem(FB_CONFIG_KEY, JSON.stringify(parsed));
            // Очищаем параметр из адресной строки для аккуратности
            params.delete('fb_config');
            const newQuery = params.toString();
            const cleanUrl =
              window.location.pathname +
              (newQuery ? '?' + newQuery : '') +
              window.location.hash;
            window.history.replaceState({}, document.title, cleanUrl);
          }
        }
      } catch (err) {
        console.warn('Не удалось прочитать конфигурацию Firebase из URL:', err);
      }
    }

    _loadSavedConfig() {
      try {
        const raw = localStorage.getItem(FB_CONFIG_KEY);
        if (raw) {
          this.config = JSON.parse(raw);
          return;
        }
      } catch (e) {
        console.warn('Ошибка чтения сохраненного конфига Firebase:', e);
      }

      if (window.DEFAULT_FIREBASE_CONFIG && typeof window.DEFAULT_FIREBASE_CONFIG === 'object') {
        this.config = window.DEFAULT_FIREBASE_CONFIG;
      }
    }

    /**
     * Умный парсер текста конфига из консоли Firebase (поддерживает и JSON, и JS-объект)
     */
    parseConfigInput(rawText, preferredMode = 'auto') {
      if (!rawText || !rawText.trim()) {
        throw new Error('Введите конфигурацию Firebase');
      }
      let text = rawText.trim();

      // Если вставили кусок кода вида const firebaseConfig = { ... };
      const braceStart = text.indexOf('{');
      const braceEnd = text.lastIndexOf('}');
      if (braceStart !== -1 && braceEnd !== -1 && braceEnd > braceStart) {
        text = text.slice(braceStart, braceEnd + 1);
      }

      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch (_) {
        // Конвертируем ключи без кавычек и одинарные кавычки в валидный JSON
        const normalized = text
          .replace(/\/\/.*$/gm, '')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?\s*:/g, '"$2":')
          .replace(/'([^']*)'/g, '"$1"')
          .replace(/,\s*([}\]])/g, '$1');
        try {
          parsed = JSON.parse(normalized);
        } catch (err2) {
          throw new Error(
            'Не удалось распознать формат конфигурации. Вставьте JSON или объект firebaseConfig из консоли Firebase.'
          );
        }
      }

      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Некорректный объект конфигурации.');
      }

      if (!parsed.projectId && !parsed.databaseURL) {
        throw new Error('В конфигурации должен быть указан хотя бы projectId или databaseURL.');
      }

      if (preferredMode && preferredMode !== 'auto') {
        parsed.mode = preferredMode;
      } else if (!parsed.mode) {
        parsed.mode = parsed.databaseURL && !parsed.projectId ? 'rtdb' : 'firestore';
      }

      return parsed;
    }

    setStatus(status, errorMsg = null) {
      this.status = status;
      this.lastError = errorMsg;
      if (this.onStatusChangeCallback) {
        this.onStatusChangeCallback(this.status, this.lastError, this.config);
      }
    }

    /**
     * Инициализация подключения к Firebase
     */
    async init(onRemoteData, onStatusChange) {
      if (onRemoteData) this.onRemoteDataCallback = onRemoteData;
      if (onStatusChange) this.onStatusChangeCallback = onStatusChange;

      this.disconnect();

      if (!this.config || (!this.config.projectId && !this.config.databaseURL)) {
        this.mode = 'local';
        this.setStatus('local');
        return false;
      }

      if (typeof window.firebase === 'undefined') {
        this.mode = 'local';
        this.setStatus('error', 'SDK Firebase не загружен (проверьте интернет-соединение)');
        return false;
      }

      try {
        this.setStatus('connecting');

        // Переиспользуем или создаем приложение Firebase
        if (!window.firebase.apps.length) {
          this.app = window.firebase.initializeApp(this.config);
        } else {
          try {
            const existing = window.firebase.app('timepollApp');
            await existing.delete();
          } catch (_) {}
          this.app = window.firebase.initializeApp(this.config, 'timepollApp');
        }

        const targetMode =
          this.config.mode === 'rtdb' || (!this.config.projectId && this.config.databaseURL)
            ? 'rtdb'
            : 'firestore';

        if (targetMode === 'rtdb') {
          this.mode = 'rtdb';
          this.db = this.app.database();
          const ref = this.db.ref('timepoll_app_state');

          const listener = ref.on(
            'value',
            (snapshot) => {
              this.setStatus('connected');
              const val = snapshot.val();
              if (val && this.onRemoteDataCallback) {
                this.isApplyingRemote = true;
                try {
                  this.onRemoteDataCallback(val);
                } finally {
                  this.isApplyingRemote = false;
                }
              } else if (!val && this.onRemoteDataCallback) {
                // Если в БД еще пусто, выгружаем начальное состояние
                this.onRemoteDataCallback(null, true);
              }
            },
            (err) => {
              console.error('Ошибка Realtime Database:', err);
              this.setStatus('error', err.message || 'Ошибка доступа к Realtime Database');
            }
          );

          this.unsubscribe = () => ref.off('value', listener);
        } else {
          this.mode = 'firestore';
          this.db = this.app.firestore();
          const docRef = this.db.collection('timepoll_data').doc('app_state');

          this.unsubscribe = docRef.onSnapshot(
            (docSnap) => {
              this.setStatus('connected');
              if (docSnap.exists) {
                const data = docSnap.data();
                if (data && data.payload && this.onRemoteDataCallback) {
                  let parsedPayload = data.payload;
                  if (typeof parsedPayload === 'string') {
                    try {
                      parsedPayload = JSON.parse(parsedPayload);
                    } catch (_) {}
                  }
                  this.isApplyingRemote = true;
                  try {
                    this.onRemoteDataCallback(parsedPayload);
                  } finally {
                    this.isApplyingRemote = false;
                  }
                }
              } else if (this.onRemoteDataCallback) {
                // Документ еще не создан в Firestore — инициализируем его текущими данными
                this.onRemoteDataCallback(null, true);
              }
            },
            (err) => {
              console.error('Ошибка Firestore:', err);
              this.setStatus('error', err.message || 'Ошибка доступа к Cloud Firestore');
            }
          );
        }

        return true;
      } catch (err) {
        console.error('Ошибка инициализации Firebase:', err);
        this.setStatus('error', err.message || 'Не удалось инициализировать Firebase');
        return false;
      }
    }

    /**
     * Сохранение состояния в Firebase
     */
    async saveRemoteState(stateObj) {
      if (this.isApplyingRemote) return false;
      if (this.status !== 'connected' && this.status !== 'connecting') return false;
      if (!this.db) return false;

      try {
        if (this.mode === 'rtdb') {
          await this.db.ref('timepoll_app_state').set(JSON.parse(JSON.stringify(stateObj)));
          this.setStatus('connected');
          return true;
        } else if (this.mode === 'firestore') {
          await this.db
            .collection('timepoll_data')
            .doc('app_state')
            .set({
              updatedAt: Date.now(),
              payload: JSON.stringify(stateObj)
            });
          this.setStatus('connected');
          return true;
        }
      } catch (err) {
        console.error('Ошибка сохранения в Firebase:', err);
        this.setStatus('error', 'Ошибка записи в БД: ' + (err.message || err));
      }
      return false;
    }

    /**
     * Сохранить новую конфигурацию из админки и переподключиться
     */
    async updateConfig(newConfigObj) {
      this.config = newConfigObj;
      if (newConfigObj) {
        localStorage.setItem(FB_CONFIG_KEY, JSON.stringify(newConfigObj));
      } else {
        localStorage.removeItem(FB_CONFIG_KEY);
      }
      return await this.init();
    }

    disconnect() {
      if (this.unsubscribe) {
        try {
          this.unsubscribe();
        } catch (_) {}
        this.unsubscribe = null;
      }
      this.db = null;
    }

    /**
     * Сгенерировать ссылку для участников со встроенным подключением к этой БД
     */
    generateShareUrl() {
      const base = window.location.origin + window.location.pathname;
      if (!this.config) return base;
      const jsonStr = JSON.stringify(this.config);
      const encoded = btoa(unescape(encodeURIComponent(jsonStr)));
      return `${base}?fb_config=${encodeURIComponent(encoded)}`;
    }

    /**
     * Сгенерировать содержимое файла js/firebase-config.js для коммита в GitHub Pages
     */
    generateConfigFileContent() {
      const cfgString = this.config ? JSON.stringify(this.config, null, 2) : 'null';
      return `/**
 * Конфигурация Firebase для GitHub Pages (сгенерировано в админ-панели TimePoll)
 */
window.DEFAULT_FIREBASE_CONFIG = ${cfgString};
`;
    }
  }

  window.firebaseService = new FirebaseService();
})();

