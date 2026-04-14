/**
 * ============================================
 * AMZ APP - DSE SERVICE (via Supabase)
 * ============================================
 *
 * Este serviço:
 * - NÃO acessa o gateway diretamente
 * - Usa Supabase Edge Function como backend
 * - Mantém padrão de eventos (onData / onStatus)
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

  // -------------------------------------------
  // CONFIG & HELPERS
  // -------------------------------------------
  _getConfig() {
    return window.CONFIG?.SUPABASE || {};
  },

  // Helper interno para pegar o token do usuário logado
  _getAuthHeaders() {
    const cfg = this._getConfig();
    // Busca o token no localStorage conforme a chave configurada no sistema
    const userToken = localStorage.getItem(window.CONFIG?.AUTH?.TOKEN_KEY);
    const bearer = userToken || cfg.ANON_KEY; // fallback para anon se não logado

    return {
      'Content-Type': 'application/json',
      'apikey': cfg.ANON_KEY,
      'Authorization': `Bearer ${bearer}`
    };
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
          headers: this._getAuthHeaders(), // Atualizado para usar o helper
          body: JSON.stringify({
            serial: generator.serial,
            module_id: generator.moduleId,
            generator_id: generator.id
          })
        }
      );

      if (!res.ok) throw new Error('Erro na sincronização');

      const data = await res.json();

      this._lastData = data;
      this._emit(data);
      this._emitStatus('online');

      return data;

    } catch (err) {
      this._emitStatus('error', err.message);
      console.error('[DSEService] sync error:', err);
      return null;
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
        { headers: this._getAuthHeaders() } // Atualizado para usar o helper
      );

      const json = await res.json();

      if (json?.length) {
        this._lastData = json[0];
        this._emit(json[0]);
        this._emitStatus('online');
      }

      return json[0] || null;

    } catch (err) {
      this._emitStatus('error', err.message);
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
        { headers: this._getAuthHeaders() } // Atualizado para usar o helper
      );

      return res.json();
    } catch (err) {
      console.error('[DSEService] getEvents error:', err);
      return [];
    }
  },

  // -------------------------------------------
  // POLLING
  // -------------------------------------------
  startPolling(generator, intervalMs = 10000) {
    if (!generator || !generator.id) return;
    if (this._isPolling) return;

    this._currentGenerator = generator;
    this._isPolling = true;

    const loop = async () => {
      if (!this._isPolling) return;
      await this.sync(this._currentGenerator);
      this._pollTimer = setTimeout(loop, intervalMs);
    };

    loop();

    if (!this._visibilityListenerAdded) {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.stopPolling();
        } else if (this._currentGenerator) {
          this.stopPolling();
          this.startPolling(this._currentGenerator, intervalMs);
        }
      });
      this._visibilityListenerAdded = true;
    },

  stopPolling() {
    this._isPolling = false;
    if (this._pollTimer) clearTimeout(this._pollTimer);
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
      try { cb(data); } catch (e) {}
    });
  },

  _emitStatus(status, msg = '') {
    this._statusListeners.forEach(cb => {
      try { cb(status, msg); } catch (e) {}
    });
  },

  getLastData() {
    return this._lastData;
  }
};

window.DSEService = DSEService;
