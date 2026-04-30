/**
 * ============================================
 * AMZ APP - DSE SERVICE (via Supabase)
 * ============================================
 *
 * CORREÇÕES APLICADAS (v2):
 *
 *  BUG #1 — startPolling(null): o generator era null, então sync() enviava
 *            { serial: undefined } à Edge Function, que rejeitava com 422.
 *            → Corrigido: startPolling exige generator válido OU aguarda
 *              loadFirstGenerator() antes de iniciar o loop.
 *
 *  BUG #2 — Headers Authorization ausente no modo produção:
 *            _getAuthHeaders() não enviava 'Authorization' quando o token
 *            estava presente (lógica invertida). A Edge Function do Supabase
 *            exige o header para validar RLS.
 *            → Corrigido: lógica de fallback removida, Authorization sempre
 *              presente quando token existe.
 *
 *  BUG #3 — destroy() chamado em geradores.html mas não existe no service:
 *            Causava TypeError silencioso ao sair da página.
 *            → Corrigido: método destroy() adicionado como alias de stopPolling()
 *              + limpeza de listeners.
 *
 *  BUG #4 — Mapeamento de dados do gateway (onGatewayData):
 *            A Edge Function retorna um objeto normalizado, mas o frontend
 *            esperava campos específicos (data.device.serial, data.gsm.ip…).
 *            Esse contrato agora está documentado e garantido pela Edge Function.
 *
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
  _currentGenerator: null,

  // Circuit breaker
  _consecutiveFailures: 0,
  _maxFailures: 5,
  _backoffMultiplier: 2,
  _maxInterval: 300000,  // 5 min
  _baseInterval: 10000,  // 10s

  // -------------------------------------------
  // CONFIG & HELPERS
  // -------------------------------------------
  _getConfig() {
    return window.CONFIG?.SUPABASE || {};
  },

  /**
   * BUG #2 CORRIGIDO:
   * Antes havia um bloco "if (userToken)" com lógica confusa —
   * em alguns caminhos o Authorization era omitido mesmo com token válido.
   * Agora: apikey SEMPRE presente (obrigatório pelo Supabase),
   *        Authorization adicionado quando token existe.
   */
  _getAuthHeaders() {
    const cfg       = this._getConfig();
    const userToken = localStorage.getItem(window.CONFIG?.AUTH?.TOKEN_KEY);

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
    // BUG #1 CORRIGIDO: valida generator antes de fazer a requisição
    if (!generator || !generator.serial) {
      throw new Error('Generator inválido ou sem serial para sync()');
    }

    try {
      this._emitStatus('syncing');

      const cfg = this._getConfig();

      const res = await fetch(
        `${cfg.FUNCTIONS_URL}/sync-generator`,
        {
          method: 'POST',
          headers: this._getAuthHeaders(),
          body: JSON.stringify({
            serial:       generator.serial,
            module_id:    generator.moduleId || generator.module_id || null,
            generator_id: generator.id       || null,
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
  //
  // BUG #1 CORRIGIDO:
  // Antes: startPolling(null, ...) era chamado em geradores.html
  //        sem um generator real — o sync() enviava serial: undefined
  //        à Edge Function, que retornava 422 silenciosamente.
  //
  // Agora: se generator for null/undefined, o serviço aguarda até
  //        que setGenerator() seja chamado com um generator válido.
  //        Isso permite a página iniciar o serviço e fornecer o
  //        generator depois que a lista carregar da API.
  // -------------------------------------------
  startPolling(generator, intervalMs = 10000) {
    if (this._isPolling) {
      console.log('[DSEService] Polling já ativo');
      // Se chegou um generator novo, atualiza
      if (generator) this._currentGenerator = generator;
      return;
    }

    if (generator) {
      this._currentGenerator = generator;
    }

    this._isPolling   = true;
    this._baseInterval = intervalMs;

    const loop = async () => {
      if (!this._isPolling) return;

      // BUG #1: só executa sync se tiver generator válido
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

    if (!this._visibilityListenerAdded) {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          console.log('[DSEService] Aba oculta — pausando polling');
          this.stopPolling();
        } else if (this._currentGenerator) {
          console.log('[DSEService] Aba visível — retomando polling');
          this.startPolling(this._currentGenerator, this._baseInterval);
        }
      });
      this._visibilityListenerAdded = true;
    }
  },

  /**
   * Define ou atualiza o generator sem reiniciar o loop.
   * Útil para fornecer o generator depois que a API retornar.
   *
   * Uso em geradores.html:
   *   // Após carregar generators da API:
   *   const firstGenerator = generators[0];
   *   DSEService.setGenerator(firstGenerator);
   */
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

  /**
   * BUG #3 CORRIGIDO:
   * geradores.html chamava window.DSEService.destroy() ao sair da página,
   * mas o método não existia → TypeError silencioso.
   * Agora destroy() para o polling e limpa os listeners.
   */
  destroy() {
    this.stopPolling();
    this._dataListeners   = [];
    this._statusListeners = [];
    this._currentGenerator = null;
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
    if (this._lastData) cb(this._lastData);
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
      try { cb(status, msg); } catch (e) { /* silencioso */ }
    });
  },

  getLastData() {
    return this._lastData;
  }
};

window.DSEService = DSEService;
