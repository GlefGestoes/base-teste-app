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
  // CONFIG
  // -------------------------------------------
  _getConfig() {
    return window.CONFIG?.SUPABASE || {};
  },

  // -------------------------------------------
  // SINCRONIZAÇÃO (CHAMA EDGE FUNCTION)
  // -------------------------------------------
  async sync(generator) {
    try {
      this._emitStatus('syncing');

      const cfg = this._getConfig();

      const res = await fetch(
        `${cfg.URL}/functions/v1/sync-generator`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cfg.ANON_KEY}`
          },
          body: JSON.stringify({
            serial: generator.serial,
            module_id: generator.module_id,
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
        {
          headers: {
            'apikey': cfg.ANON_KEY,
            'Authorization': `Bearer ${cfg.ANON_KEY}`
          }
        }
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
    const cfg = this._getConfig();

    const res = await fetch(
      `${cfg.URL}/rest/v1/generator_events?generator_id=eq.${generatorId}&order=event_time.desc`,
      {
        headers: {
          'apikey': cfg.ANON_KEY,
          'Authorization': `Bearer ${cfg.ANON_KEY}`
        }
      }
    );

    return res.json();
  },

  // -------------------------------------------
  // POLLING
  // -------------------------------------------
  startPolling(generator, intervalMs = 10000) {
    if (this._isPolling) return;

    this._isPolling = true;

    const loop = async () => {
      if (!this._isPolling) return;

      await this.sync(generator);
      this._pollTimer = setTimeout(loop, intervalMs);
    };

    loop();

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stopPolling();
      else this.startPolling(generator, intervalMs);
    });
  },

  stopPolling() {
    this._isPolling = false;
    if (this._pollTimer) clearTimeout(this._pollTimer);
    this._pollTimer = null;
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
