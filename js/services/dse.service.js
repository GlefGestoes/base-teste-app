/**
 * ============================================
 * AMZ APP - DSE SERVICE  v4
 * ============================================
 *
 * HISTÓRICO DE CORREÇÕES:
 *
 *  v2 — BUG #1: startPolling(null) com serial undefined
 *       BUG #2: Authorization ausente no modo produção
 *       BUG #3: destroy() inexistente
 *       BUG #4: Mapeamento de dados do gateway
 *
 *  v3 — BUG #8: sync() sem AbortController/timeout
 *
 *  v4 — ANÁLISE DE LOGS (correções desta versão):
 *
 *  FIX-A: visibilitychange listener acumulando (memory leak)
 *    → Antes: handler era arrow function anônima; destroy() resetava
 *      o flag _visibilityListenerAdded mas NÃO removia o listener do
 *      document. A cada startPolling (após destroy+reload na mesma
 *      sessão ou tab), um novo listener era adicionado silenciosamente.
 *    → Depois: handler armazenado em _visibilityHandler; destroy() chama
 *      removeEventListener com a referência correta.
 *
 *  FIX-B: onData() disparava _lastData ANTES do DOM estar pronto
 *    → Antes: onData(cb) chamava cb(this._lastData) sincronicamente
 *      no momento do registro — ANTES que loadDashboard() completasse
 *      seu await e antes que allGenerators[] fosse preenchido.
 *      Isso causava updateGatewayPanel → renderGenerators(allGenerators=[])
 *      com risco de container null.
 *    → Depois: disparo é feito via setTimeout(0) — microtask seguinte,
 *      garantindo que o callsite finalize seu setup antes de receber dados.
 *
 *  FIX-C: _emitStatus não capturava exceções silenciosamente
 *    → Adicionado log de warn para erros em _emitStatus listeners.
 * ============================================
 */

const DSEService = {

  // -------------------------------------------
  // ESTADO INTERNO
  // -------------------------------------------
  _pollTimer:    null,
  _isPolling:    false,
  _lastData:     null,
  _dataListeners:   [],
  _statusListeners: [],

  // FIX-A: referência nomeada ao handler para poder removê-lo
  _visibilityHandler:        null,
  _visibilityListenerAdded:  false,
  _currentGenerator:         null,

  // Circuit breaker
  _consecutiveFailures: 0,
  _maxFailures:         5,
  _backoffMultiplier:   2,
  _maxInterval:         300000,  // 5 min
  _baseInterval:        10000,   // 10s

  // -------------------------------------------
  // CONFIG & HELPERS
  // -------------------------------------------
  _getConfig() {
    return window.CONFIG?.SUPABASE || {};
  },

  _getAuthHeaders() {
    const cfg       = this._getConfig();
    const userToken = localStorage.getItem(window.CONFIG?.AUTH?.TOKEN_KEY);
    const headers   = {
      'Content-Type': 'application/json',
      'apikey':       cfg.ANON_KEY,
    };
    if (userToken) headers['Authorization'] = `Bearer ${userToken}`;
    return headers;
  },

  // -------------------------------------------
  // SINCRONIZAÇÃO (CHAMA EDGE FUNCTION)
  // -------------------------------------------
  async sync(generator) {
    if (!generator || !generator.serial) {
      throw new Error('Generator inválido ou sem serial para sync()');
    }

    const cfg        = this._getConfig();
    const timeoutMs  = window.CONFIG?.SYNC?.TIMEOUT ?? 8000;
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), timeoutMs);

    try {
      this._emitStatus('syncing');

      const res = await fetch(
        `${cfg.FUNCTIONS_URL}/sync-generator`,
        {
          method:  'POST',
          headers: this._getAuthHeaders(),
          body:    JSON.stringify({
            serial:       generator.serial,
            module_id:    generator.moduleId || generator.module_id || null,
            generator_id: generator.id       || null,
          }),
          signal: controller.signal,
        }
      );

      clearTimeout(timer);

      if (!res.ok) {
        console.warn(`[DSEService] sync-generator HTTP ${res.status} serial=${generator.serial}`);
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      this._lastData = data;
      this._emit(data);
      this._emitStatus('online');
      return data;

    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        const msg = `Timeout (${timeoutMs}ms) ao chamar sync-generator`;
        this._emitStatus('error', msg);
        console.warn('[DSEService]', msg);
        throw new Error(msg);
      }
      this._emitStatus('error', err.message);
      console.error('[DSEService] sync error:', err.message);
      throw err;
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
    if (this._isPolling) {
      if (generator) this._currentGenerator = generator;
      return;
    }

    if (generator) this._currentGenerator = generator;

    this._isPolling    = true;
    this._baseInterval = intervalMs;

    const loop = async () => {
      if (!this._isPolling) return;

      if (!this._currentGenerator || !this._currentGenerator.serial) {
        console.warn('[DSEService] Aguardando generator válido para sync...');
        this._pollTimer = setTimeout(() => loop(), 3000);
        return;
      }

      try {
        await this.sync(this._currentGenerator);
        this._consecutiveFailures = 0;
      } catch (err) {
        this._consecutiveFailures++;
        console.warn(
          `[DSEService] Falha ${this._consecutiveFailures}/${this._maxFailures}:`,
          err.message
        );

        if (this._consecutiveFailures >= this._maxFailures) {
          console.error('[DSEService] Circuit breaker ativado');
          this._emitStatus('offline', 'Máximo de falhas atingido');
          this.stopPolling();
          return;
        }
      }

      const nextInterval = Math.min(
        this._baseInterval * Math.pow(this._backoffMultiplier, this._consecutiveFailures),
        this._maxInterval
      );

      console.log(`[DSEService] Próximo poll em ${nextInterval / 1000}s`);
      this._pollTimer = setTimeout(() => loop(), nextInterval);
    };

    loop();

    // FIX-A: armazena referência nomeada para poder remover depois
    if (!this._visibilityListenerAdded) {
      this._visibilityHandler = () => {
        if (document.hidden) {
          console.log('[DSEService] Aba oculta — pausando polling');
          this.stopPolling();
        } else if (this._currentGenerator && !this._isPolling) {
          console.log('[DSEService] Aba visível — retomando polling');
          this.startPolling(this._currentGenerator, this._baseInterval);
        }
      };
      document.addEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityListenerAdded = true;
    }
  },

  setGenerator(generator) {
    if (!generator || !generator.serial) {
      console.warn('[DSEService] setGenerator: generator inválido');
      return;
    }
    this._currentGenerator = generator;
    console.log('[DSEService] Generator definido:', generator.serial);
  },

  stopPolling() {
    this._isPolling = false;
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  },

  destroy() {
    this.stopPolling();
    this._dataListeners    = [];
    this._statusListeners  = [];
    this._currentGenerator = null;

    // FIX-A: usa removeEventListener com a referência nomeada — sem leak
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }
    this._visibilityListenerAdded = false;

    console.log('[DSEService] Destruído e listeners removidos');
  },

  resetCircuitBreaker() {
    this._consecutiveFailures = 0;
    console.log('[DSEService] Circuit breaker resetado');
  },

  // -------------------------------------------
  // CALLBACKS
  // -------------------------------------------
  onData(cb) {
    this._dataListeners.push(cb);

    // FIX-B: disparo de _lastData via setTimeout(0) em vez de síncrono.
    // Garante que o callsite (ex: dashboard.html) finalize seu setup
    // antes de receber o dado — evita race condition onde
    // updateGatewayPanel → renderGenerators é chamado antes de
    // allGenerators ser preenchido por loadDashboard().
    if (this._lastData) {
      setTimeout(() => {
        try { cb(this._lastData); }
        catch (e) { console.error('[DSEService] onData deferred error:', e); }
      }, 0);
    }
  },

  onStatus(cb) {
    this._statusListeners.push(cb);
  },

  _emit(data) {
    this._dataListeners.forEach(cb => {
      try { cb(data); } catch (e) { console.error('[DSEService] _emit error:', e); }
    });
  },

  _emitStatus(status, msg = '') {
    this._statusListeners.forEach(cb => {
      try { cb(status, msg); } catch (e) { console.warn('[DSEService] _emitStatus error:', e); }
    });
  },

  getLastData() {
    return this._lastData;
  }
};

window.DSEService = DSEService;
