/**
 * ============================================
 * AMZ APP - DSE GATEWAY SERVICE
 * ============================================
 * Integração com DSE Gateway 4G (modelo 0890-04)
 * Segue o mesmo padrão de MockService e ApiService.
 *
 * Uso em qualquer página:
 *   DSEService.onData(data => renderizarDados(data));
 *   DSEService.startPolling();
 */

const DSEService = {

  // -------------------------------------------
  // ESTADO INTERNO
  // -------------------------------------------
  _pollTimer:    null,
  _isPolling:    false,
  _lastData:     null,
  _retryCount:   0,
  _dataListeners:   [],
  _statusListeners: [],

  // -------------------------------------------
  // LEITURA DO GATEWAY
  // -------------------------------------------

  /**
   * Busca dados do gateway via HTTP Basic Auth.
   * Retorna objeto padronizado igual ao MockService.
   */
  async fetchData() {
    const cfg = window.CONFIG?.DSE || {};
    const url = `${cfg.BASE_URL || 'http://192.168.1.253'}/api/`;

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      cfg.TIMEOUT || 8000
    );

    try {
      const credentials = btoa(`${cfg.USERNAME || 'Admin'}:${cfg.PASSWORD || 'admin'}`);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const raw  = await response.json();
      const data = this._parse(raw);

      this._retryCount = 0;
      this._lastData   = data;
      this._emit(data);
      this._emitStatus('online');

      window.CONFIG?.log('[DSE] Dados recebidos:', data.device.serial);
      return { success: true, data };

    } catch (err) {
      clearTimeout(timer);
      this._retryCount++;

      const status = this._retryCount >= (cfg.MAX_RETRIES || 3) ? 'offline' : 'retrying';
      this._emitStatus(status, err.message);

      console.warn('[DSE] Falha na leitura:', err.message);

      // Retorna cache se disponível (suporte offline PWA)
      if (this._lastData) {
        return { success: false, data: this._lastData, cached: true, error: err.message };
      }
      return { success: false, data: null, error: err.message };
    }
  },

  // -------------------------------------------
  // POLLING
  // -------------------------------------------

  startPolling(intervalMs) {
    if (this._isPolling) return;
    this._isPolling = true;
    const ms = intervalMs || window.CONFIG?.DSE?.POLL_INTERVAL || 5000;

    const loop = async () => {
      if (!this._isPolling) return;
      await this.fetchData();
      this._pollTimer = setTimeout(loop, ms);
    };
    loop();

    // Pausa quando app vai para background (economia de dados)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.stopPolling();
      } else {
        this.startPolling(ms);
      }
    });

    window.CONFIG?.log('[DSE] Polling iniciado a cada', ms / 1000, 's');
  },

  stopPolling() {
    this._isPolling = false;
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  },

  // -------------------------------------------
  // CALLBACKS (mesmo padrão EventEmitter simples)
  // -------------------------------------------

  /** Registra listener de dados. Recebe objeto parseado. */
  onData(cb) {
    this._dataListeners.push(cb);
    if (this._lastData) cb(this._lastData); // entrega cache imediatamente
  },

  /** Registra listener de status: 'online' | 'offline' | 'retrying' */
  onStatus(cb) {
    this._statusListeners.push(cb);
  },

  getLastData() { return this._lastData; },

  _emit(data) {
    this._dataListeners.forEach(cb => { try { cb(data); } catch(e) {} });
  },
  _emitStatus(status, msg = '') {
    this._statusListeners.forEach(cb => { try { cb(status, msg); } catch(e) {} });
  },

  // -------------------------------------------
  // PARSER — converte JSON bruto do DSE em
  // objeto padronizado para o app AMZ
  // -------------------------------------------

  _parse(raw) {
    const s = raw?.static   || {};
    const r = raw?.realtime || {};
    const F = s?.F          || {};

    return {
      // Identificação do gateway
      device: {
        serial:      F.Serial       || 'N/A',
        model:       F.MODEL        || 'N/A',
        firmware:    F.version      || 'N/A',
        bootVersion: F.boot_version || 'N/A',
      },

      // Conectividade 4G/GSM
      gsm: {
        connected:  !!(r.GSM?.ip),
        ip:         r.GSM?.ip        || 'N/A',
        type:       r.GSM?.conection || 'N/A',   // "4G", "3G"…
        signal:     parseInt(r.GSM?.signal) || 0, // 0–5
        operator:   r.GSM?.op        || 'N/A',
        imei:       r.GSM?.imei      || 'N/A',
      },

      // GPS
      gps: {
        hasFix:    r.GPS?.lat !== '#' && !!r.GPS?.lat,
        latitude:  r.GPS?.lat !== '#' ? parseFloat(r.GPS?.lat) : (parseFloat(F.S?.[1]) || null),
        longitude: r.GPS?.lon !== '#' ? parseFloat(r.GPS?.lon) : (parseFloat(F.S?.[2]) || null),
        satellites: parseInt(r.GPS?.num_sattelites) || 0,
      },

      // MQTT
      mqtt: {
        connected: r.mqtt?.status === 'Connected',
        status:    r.mqtt?.status  || 'N/A',
        broker:    F.mqtt?.[0]     || 'N/A',
        client:    r.mqtt?.clientName || 'N/A',
      },

      // Entradas e saídas digitais
      io: {
        in1:  r.IO?.[0] === 1,
        in2:  r.IO?.[1] === 1,
        out1: r.IO?.[2] === 1,
        out2: r.IO?.[3] === 1,
        labels: {
          in1:  F.I?.[0]?.d || 'Digital In 1',
          in2:  F.I?.[1]?.d || 'Digital In 2',
          out1: F.I?.[2]?.d || 'Digital Out 1',
          out2: F.I?.[3]?.d || 'Digital Out 2',
        },
      },

      // Módulos/geradores conectados via Modbus
      // Comms === "1" significa online
      modules: this._parseModules(F.M, r.Cloud),

      // Armazenamento interno do gateway
      storage: {
        usedBytes:   parseInt(r.storage?.value) || 0,
        maxBytes:    parseInt(r.storage?.max)   || 0,
        usedPercent: r.storage?.max
          ? +((parseInt(r.storage.value) / parseInt(r.storage.max)) * 100).toFixed(1)
          : 0,
      },

      // Timestamps
      deviceTime:  r.time ? new Date(r.time * 1000).toISOString() : null,
      capturedAt:  new Date().toISOString(),
    };
  },

  _parseModules(M, Cloud) {
    const list = [];
    if (!M?.P) return list;
    for (const [idx, port] of Object.entries(M.P)) {
      const c = Cloud?.[idx] || {};
      list.push({
        index:    parseInt(idx),
        enabled:  port[0] === '1',
        protocol: ({ '4':'Modbus RTU','5':'DSE Modbus','6':'CAN' })[port[1]] || `P${port[1]}`,
        address:  parseInt(port[3]),
        // Status em tempo real do gerador
        online:   parseInt(c.Comms) === 1,
        serial:   c.Serial   || '',
        type:     parseInt(c.Type)   || 0,
        firmware: c.Firmware || '0.0',
        webnet:   parseInt(c.webnet) || 0,
      });
    }
    return list;
  },
};

// Exporta globalmente (mesmo padrão dos outros services)
window.DSEService = DSEService;
