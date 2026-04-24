/**
 * ============================================
 * AMZ APP - DSE SERVICE (via Supabase)
 * ============================================
 */

const DSEService = {

  // -------------------------------------------
  // ESTADO INTERNO
  // -------------------------------------------
  _pollTimer: null,
  _isPolling: false,
  _lastData: null,
  _dataListeners: [],
  _statusListeners: [],
  _visibilityListenerAdded: false,
  
  // ✅ NOVO: Estado do circuit breaker (persiste entre chamadas)
  _consecutiveFailures: 0,
  _maxFailures: 5,
  _backoffMultiplier: 2,
  _maxInterval: 300000, // 5 min
  _baseInterval: 10000, // 10s (padrão)

  // -------------------------------------------
  // CONFIG & HELPERS
  // -------------------------------------------
  _getConfig() {
    return window.CONFIG?.SUPABASE || {};
  },

  _getAuthHeaders() {
    const cfg = this._getConfig();
    const userToken = localStorage.getItem(window.CONFIG?.AUTH?.TOKEN_KEY);
    
    // ✅ CORREÇÃO: NÃO usar ANON_KEY como fallback de Authorization
    const headers = {
      'Content-Type': 'application/json',
      'apikey': cfg.ANON_KEY,
    };
    
    if (userToken) {
      headers['Authorization'] = `Bearer ${userToken}`;
    }
    
    return headers;
  },

  // -------------------------------------------
  // SINCRONIZAÇÃO (CHAMA EDGE FUNCTION)
  // -------------------------------------------
  async sync(generator) {
    try {
      this._emitStatus('syncing');

      const cfg = this._getConfig();

      const res = await fetch(
        `${cfg.FUNCTIONS_URL}/sync-generator`,
        {
          method: 'POST',
          headers: this._getAuthHeaders(),
          body: JSON.stringify({
            serial: generator.serial,
            module_id: generator.moduleId,
            generator_id: generator.id
          })
        }
      );

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }

      const data = await res.json();

      this._lastData = data;
      this._emit(data);
      this._emitStatus('online');

      return data;

    } catch (err) {
      this._emitStatus('error', err.message);
      console.error('[DSEService] sync error:', err);
      throw err; // ✅ PROPAGA o erro para o loop capturar
    }
  },

  // -------------------------------------------
  // BUSCAR STATUS (DADOS DO SUPABASE)
  // -------------------------------------------
  async getStatus(generatorId) {
    try {
      const cfg = this._getConfig();

      const res = await fetch(
        `${cfg.URL}/rest/v1/generator_status?generator_id=eq.${generatorId}&order=updated_at.desc&limit=1`,
        { headers: this._getAuthHeaders() }
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json();

      if (json?.length) {
        this._lastData = json[0];
        this._emit(json[0]);
        this._emitStatus('online');
      }

      return json[0] || null;

    } catch (err) {
      this._emitStatus('error', err.message);
      console.error('[DSEService] getStatus error:', err);
      return null;
    }
  },

  // -------------------------------------------
  // BUSCAR EVENTOS (HISTÓRICO)
  // -------------------------------------------
  async getEvents(generatorId) {
    try {
      const cfg = this._getConfig();

      const res = await fetch(
        `${cfg.URL}/rest/v1/generator_events?generator_id=eq.${generatorId}&order=event_time.desc`,
        { headers: this._getAuthHeaders() }
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      return await res.json();

    } catch (err) {
      console.error('[DSEService] getEvents error:', err);
      return [];
    }
  },

  // -------------------------------------------
  // POLLING COM BACKOFF EXPONENCIAL
  // -------------------------------------------
  startPolling(generator, intervalMs = 10000) {
    if (!generator || !generator.id) {
      console.warn('[DSEService] Generator inválido para polling');
      return;
    }
    
    if (this._isPolling) {
      console.log('[DSEService] Polling já ativo');
      return;
    }

    this._currentGenerator = generator;
    this._isPolling = true;
    this._baseInterval = intervalMs;
    
    // ✅ NÃO reseta _consecutiveFailures aqui — mantém histórico

    const loop = async () => {
      if (!this._isPolling) return;

      try {
        await this.sync(this._currentGenerator);
        // ✅ Sucesso: reseta contador de falhas
        this._consecutiveFailures = 0;
      } catch (err) {
        this._consecutiveFailures++;
        console.warn(
          `[DSEService] Falha ${this._consecutiveFailures}/${this._maxFailures}:`,
          err.message
        );

        // ✅ Circuit breaker: para após N falhas
        if (this._consecutiveFailures >= this._maxFailures) {
          console.error('[DSEService] Circuit breaker ativado');
          this._emitStatus('offline', 'Máximo de falhas atingido');
          this.stopPolling();
          return; // Sai do loop permanentemente
        }
      }

      // ✅ Calcula próximo intervalo com backoff exponencial
      const nextInterval = Math.min(
        this._baseInterval * Math.pow(this._backoffMultiplier, this._consecutiveFailures),
        this._maxInterval
      );

      console.log(`[DSEService] Próximo poll em ${nextInterval / 1000}s`);

      this._pollTimer = setTimeout(() => loop(), nextInterval);
    };

    // ✅ INICIA o polling imediatamente
    loop();

    // ✅ Listener de visibilidade (garantido uma vez)
    if (!this._visibilityListenerAdded) {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          console.log('[DSEService] Aba oculta — pausando polling');
          this.stopPolling();
        } else if (this._currentGenerator) {
          console.log('[DSEService] Aba visível — retomando polling');
          // ✅ Retoma sem resetar falhas (mantém backoff)
          this.startPolling(this._currentGenerator, this._baseInterval);
        }
      });
      this._visibilityListenerAdded = true;
    }
  },

  stopPolling() {
    this._isPolling = false;
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  },

  // ✅ NOVO: Reset manual do circuit breaker
  resetCircuitBreaker() {
    this._consecutiveFailures = 0;
    console.log('[DSEService] Circuit breaker resetado');
  },

  // -------------------------------------------
  // CALLBACKS
  // -------------------------------------------
  onData(cb) {
    this._dataListeners.push(cb);
    if (this._lastData) cb(this._lastData);
  },

  onStatus(cb) {
    this._statusListeners.push(cb);
  },

  _emit(data) {
    this._dataListeners.forEach(cb => {
      try { cb(data); } catch (e) { /* silencioso */ }
    });
  },

  _emitStatus(status, msg = '') {
    this._statusListeners.forEach(cb => {
      try { cb(status, msg); } catch (e) { /* silencioso */ }
    });
  },

  getLastData() {
    return this._lastData;
  }
};

window.DSEService = DSEService;
