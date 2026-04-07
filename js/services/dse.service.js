/**
 * ============================================
 * AMZ APP - INTEGRAÇÃO DSE GATEWAY 4G
 * ============================================
 *
 * Dispositivo: DSE Gateway 4G (Modelo 0890-04)
 * Firmware:    4.6.3
 * Protocolo:   HTTP REST + JSON (API nativa do gateway)
 *
 * O gateway já expõe uma API JSON em:
 *   http://<IP_DO_GATEWAY>/api/
 *
 * Campos retornados pelo dispositivo:
 *   - static:  configurações fixas (modelo, serial, rede, portas)
 *   - realtime: dados ao vivo (GSM, MQTT, GPS, I/O, storage)
 *   - log:      log de eventos em HTML
 *
 * ============================================
 */

// ============================================
// CONFIGURAÇÃO
// ============================================

const DSE_CONFIG = {
  // IP do gateway na rede local (ajuste conforme sua rede)
  // Em produção, use a URL pública ou VPN
  baseUrl:      'http://192.168.1.253',

  // Credenciais padrão DSE (altere após primeiro acesso)
  username:     'Admin',
  password:     '********',

  // Intervalo de polling em ms (padrão: 5 segundos)
  pollInterval: 5000,

  // Timeout de requisição em ms
  timeout:      8000,

  // Número máximo de tentativas antes de marcar offline
  maxRetries:   3,
};

// ============================================
// PARSER DE DADOS DO GATEWAY DSE
// ============================================

const DSEParser = {

  /**
   * Interpreta o JSON bruto do gateway e retorna
   * um objeto padronizado para o app AMZ
   */
  parse(raw) {
    const s = raw?.static  || {};
    const r = raw?.realtime || {};

    return {
      // --- Identificação do dispositivo ---
      device: {
        model:        s?.F?.MODEL        || 'N/A',
        serial:       s?.F?.Serial       || 'N/A',
        firmware:     s?.F?.version      || 'N/A',
        bootVersion:  s?.F?.boot_version || 'N/A',
        tftp:         s?.F?.TFTP         || 'N/A',
      },

      // --- Conectividade GSM / 4G ---
      gsm: {
        connected:    !!r?.GSM?.ip,
        ip:           r?.GSM?.ip         || 'N/A',
        connection:   r?.GSM?.conection  || 'N/A',   // "4G", "3G", etc.
        signal:       parseInt(r?.GSM?.signal) || 0, // 0–5
        operator:     r?.GSM?.op         || 'N/A',
        imei:         r?.GSM?.imei       || 'N/A',
        modemVersion: r?.GSM?.version    || 'N/A',
      },

      // --- GPS ---
      gps: {
        satellites:   parseInt(r?.GPS?.num_sattelites) || 0,
        signal:       parseInt(r?.GPS?.signal)         || 0,
        latitude:     r?.GPS?.lat !== '#' ? parseFloat(r.GPS.lat) : null,
        longitude:    r?.GPS?.lon !== '#' ? parseFloat(r.GPS.lon) : null,
        hasFix:       r?.GPS?.lat !== '#' && r?.GPS?.lat !== undefined,
      },

      // --- Rede local ---
      network: {
        mac:          s?.F?.N?.[6]  || 'N/A',
        ip:           DSEParser._intToIp(s?.F?.N?.[2]),
        mask:         DSEParser._intToIp(s?.F?.N?.[3]),
        gateway:      DSEParser._intToIp(s?.F?.N?.[4]),
        dns:          DSEParser._intToIp(s?.F?.N?.[5]),
        dhcp:         s?.F?.N?.[0] === 'No' ? false : true,
      },

      // --- MQTT ---
      mqtt: {
        status:       r?.mqtt?.status           || 'N/A',
        clientName:   r?.mqtt?.clientName       || 'N/A',
        broker:       s?.F?.mqtt?.[0]           || 'N/A',
        port:         s?.F?.mqtt?.[1]           || '0',
        connected:    r?.mqtt?.status === 'Connected',
        dataPublished: r?.mqtt?.dataPublished   || '0',
        dataReceived:  r?.mqtt?.dataSubscribed  || '0',
      },

      // --- Entradas e Saídas Digitais ---
      io: {
        digitalIn1:   r?.IO?.[0] === 1,
        digitalIn2:   r?.IO?.[1] === 1,
        digitalOut1:  r?.IO?.[2] === 1,
        digitalOut2:  r?.IO?.[3] === 1,
        // Labels configurados no dispositivo
        labels: {
          in1:  s?.F?.I?.[0]?.d || 'Digital In 1',
          in2:  s?.F?.I?.[1]?.d || 'Digital In 2',
          out1: s?.F?.I?.[2]?.d || 'Digital Out 1',
          out2: s?.F?.I?.[3]?.d || 'Digital Out 2',
        },
      },

      // --- Armazenamento interno ---
      storage: {
        usedBytes:    parseInt(r?.storage?.value) || 0,
        maxBytes:     parseInt(r?.storage?.max)   || 0,
        usedPercent:  r?.storage?.max
          ? ((parseInt(r.storage.value) / parseInt(r.storage.max)) * 100).toFixed(1)
          : '0',
      },

      // --- Status de módulos conectados (geradores via Modbus) ---
      modules: DSEParser._parseModules(s?.F?.M, r?.Cloud),

      // --- Timestamp do dispositivo ---
      deviceTime:   r?.time ? new Date(r.time * 1000).toISOString() : null,
      capturedAt:   new Date().toISOString(),
    };
  },

  /**
   * Converte inteiro de IP (big-endian) para string dotted
   */
  _intToIp(intVal) {
    if (!intVal) return 'N/A';
    const n = parseInt(intVal);
    return [
      (n >>> 24) & 0xFF,
      (n >>> 16) & 0xFF,
      (n >>>  8) & 0xFF,
       n         & 0xFF,
    ].join('.');
  },

  /**
   * Monta lista de módulos/geradores conectados via Modbus
   */
  _parseModules(M, Cloud) {
    const modules = [];
    if (!M?.P) return modules;

    for (const [idx, port] of Object.entries(M.P)) {
      const cloud = Cloud?.[idx] || {};
      modules.push({
        index:      parseInt(idx),
        enabled:    port[0] === '1',
        protocol:   DSEParser._protocolName(port[1]),
        modbusAddr: parseInt(port[3]),
        serialPort: parseInt(port[4]),
        baudRate:   parseInt(port[5]),
        // Dados em tempo real do módulo (via cloud/webnet)
        cloud: {
          comms:    parseInt(cloud.Comms)    || 0,
          webnet:   parseInt(cloud.webnet)   || 0,
          mqtt:     parseInt(cloud.mqtt)     || 0,
          serial:   cloud.Serial             || '0',
          type:     parseInt(cloud.Type)     || 0,
          firmware: cloud.Firmware           || '0.0',
          online:   parseInt(cloud.Comms)    === 1,
        },
      });
    }
    return modules;
  },

  _protocolName(code) {
    const map = { '4': 'Modbus RTU', '5': 'DSE Modbus', '6': 'CAN' };
    return map[code] || `Protocol ${code}`;
  },
};

// ============================================
// SERVIÇO DE COMUNICAÇÃO COM O GATEWAY
// ============================================

const DSEService = {

  _retryCount:    0,
  _pollTimer:     null,
  _isPolling:     false,
  _lastData:      null,
  _listeners:     [],
  _statusListeners: [],

  /**
   * Busca dados do gateway via REST
   * Autenticação: HTTP Basic Auth (padrão DSE)
   */
  async fetchData() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DSE_CONFIG.timeout);

    try {
      const credentials = btoa(`${DSE_CONFIG.username}:${DSE_CONFIG.password}`);

      const response = await fetch(`${DSE_CONFIG.baseUrl}/api/`, {
        method:  'GET',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Accept':        'application/json',
          'Content-Type':  'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const raw  = await response.json();
      const data = DSEParser.parse(raw);

      this._retryCount = 0;
      this._lastData   = data;
      this._notifyListeners(data);
      this._notifyStatus('online');

      return { success: true, data };

    } catch (error) {
      clearTimeout(timer);
      this._retryCount++;

      const isOffline = this._retryCount >= DSE_CONFIG.maxRetries;
      this._notifyStatus(isOffline ? 'offline' : 'retrying', error.message);

      // Retorna último dado em cache se disponível (suporte offline PWA)
      if (this._lastData) {
        return { success: false, data: this._lastData, cached: true, error: error.message };
      }

      return { success: false, data: null, error: error.message };
    }
  },

  /**
   * Inicia polling contínuo
   */
  startPolling(intervalMs = DSE_CONFIG.pollInterval) {
    if (this._isPolling) return;
    this._isPolling = true;

    console.log(`[DSE] Iniciando polling a cada ${intervalMs / 1000}s`);

    const poll = async () => {
      if (!this._isPolling) return;
      await this.fetchData();
      this._pollTimer = setTimeout(poll, intervalMs);
    };

    poll();
  },

  /**
   * Para o polling
   */
  stopPolling() {
    this._isPolling = false;
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    console.log('[DSE] Polling encerrado');
  },

  /**
   * Registra callback para receber dados
   * Uso: DSEService.onData(data => console.log(data))
   */
  onData(callback) {
    this._listeners.push(callback);
    // Entrega dado em cache imediatamente se disponível
    if (this._lastData) callback(this._lastData);
  },

  /**
   * Registra callback para status de conexão
   * Uso: DSEService.onStatus(status => ...)
   * status: 'online' | 'offline' | 'retrying'
   */
  onStatus(callback) {
    this._statusListeners.push(callback);
  },

  _notifyListeners(data) {
    this._listeners.forEach(cb => {
      try { cb(data); } catch (e) { console.error('[DSE] Listener error:', e); }
    });
  },

  _notifyStatus(status, message = '') {
    this._statusListeners.forEach(cb => {
      try { cb(status, message); } catch (e) { console.error('[DSE] Status listener error:', e); }
    });
  },

  /**
   * Retorna o último dado capturado (cache local)
   */
  getLastData() {
    return this._lastData;
  },
};

// ============================================
// ENVIO PARA BACKEND AMZ
// ============================================

const DSEBackendSync = {

  // Fila de dados para envio offline
  _queue: [],

  /**
   * Envia dados do gerador para o backend AMZ
   * Estrutura JSON padronizada para armazenamento
   */
  async send(parsedData, generatorId = null) {
    const payload = this._buildPayload(parsedData, generatorId);

    try {
      const token = localStorage.getItem('amz_token') || '';

      const response = await fetch(`${window.APP_CONFIG?.apiUrl || '/api'}/generators/telemetry`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error(`Backend HTTP ${response.status}`);

      console.log('[DSE] Dados enviados ao backend com sucesso');

      // Limpa fila offline após sucesso
      this._flushQueue();

      return { success: true };

    } catch (error) {
      console.warn('[DSE] Falha no envio, enfileirando para retry:', error.message);

      // Enfileira para envio posterior (suporte offline PWA)
      this._enqueue(payload);

      return { success: false, queued: true, error: error.message };
    }
  },

  /**
   * Monta o payload padronizado para o backend
   */
  _buildPayload(data, generatorId) {
    return {
      // Metadados
      schema_version: '1.0',
      generator_id:   generatorId || data.device.serial,
      captured_at:    data.capturedAt,
      device_time:    data.deviceTime,

      // Identificação
      device: {
        model:    data.device.model,
        serial:   data.device.serial,
        firmware: data.device.firmware,
      },

      // Conectividade
      connectivity: {
        gsm: {
          connected:  data.gsm.connected,
          type:       data.gsm.connection,
          signal:     data.gsm.signal,
          operator:   data.gsm.operator,
          ip:         data.gsm.ip,
        },
        mqtt: {
          connected: data.mqtt.connected,
          broker:    data.mqtt.broker,
        },
        gps: {
          has_fix:   data.gps.hasFix,
          latitude:  data.gps.latitude,
          longitude: data.gps.longitude,
          satellites: data.gps.satellites,
        },
      },

      // I/O Digital (status do gerador via entradas digitais)
      io: {
        digital_in_1:  data.io.digitalIn1,
        digital_in_2:  data.io.digitalIn2,
        digital_out_1: data.io.digitalOut1,
        digital_out_2: data.io.digitalOut2,
      },

      // Módulos/geradores conectados via Modbus
      modules: data.modules.map(m => ({
        index:    m.index,
        enabled:  m.enabled,
        protocol: m.protocol,
        online:   m.cloud.online,
        firmware: m.cloud.firmware,
        type:     m.cloud.type,
      })),

      // Armazenamento
      storage: {
        used_bytes:   data.storage.usedBytes,
        max_bytes:    data.storage.maxBytes,
        used_percent: parseFloat(data.storage.usedPercent),
      },
    };
  },

  _enqueue(payload) {
    this._queue.push(payload);
    // Persiste fila no localStorage para sobreviver reload
    try {
      localStorage.setItem('amz_dse_queue', JSON.stringify(this._queue));
    } catch (e) {
      console.warn('[DSE] Não foi possível persistir fila:', e.message);
    }
  },

  async _flushQueue() {
    if (!this._queue.length) return;

    const token = localStorage.getItem('amz_token') || '';
    const toSend = [...this._queue];
    this._queue = [];

    for (const payload of toSend) {
      try {
        await fetch(`${window.APP_CONFIG?.apiUrl || '/api'}/generators/telemetry/batch`, {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ payloads: [payload] }),
        });
      } catch {
        // Se ainda falhar, re-enfileira
        this._queue.push(payload);
      }
    }

    localStorage.setItem('amz_dse_queue', JSON.stringify(this._queue));
  },

  /**
   * Restaura fila do localStorage ao iniciar
   */
  restoreQueue() {
    try {
      const saved = localStorage.getItem('amz_dse_queue');
      if (saved) {
        this._queue = JSON.parse(saved);
        console.log(`[DSE] Fila restaurada: ${this._queue.length} item(s) pendente(s)`);
      }
    } catch (e) {
      console.warn('[DSE] Erro ao restaurar fila:', e.message);
    }
  },
};

// ============================================
// INICIALIZAÇÃO — USE NA PÁGINA DO GERADOR
// ============================================

/**
 * Exemplo de uso em geradores.html:
 *
 *   DSEIntegration.init({
 *     generatorId: 'GEN-001',
 *     onUpdate: (data) => renderDashboard(data),
 *     onStatus: (status) => updateStatusBadge(status),
 *   });
 */

const DSEIntegration = {

  init({ generatorId = null, onUpdate = null, onStatus = null } = {}) {

    // Restaura fila de envios pendentes (offline PWA)
    DSEBackendSync.restoreQueue();

    // Registra callbacks
    if (onUpdate) DSEService.onData(onUpdate);
    if (onStatus) DSEService.onStatus(onStatus);

    // Pipeline: dados → backend
    DSEService.onData(async (data) => {
      await DSEBackendSync.send(data, generatorId);
    });

    // Inicia polling
    DSEService.startPolling();

    // Para polling quando página sai do foco (economia de bateria/dados)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        DSEService.stopPolling();
      } else {
        DSEService.startPolling();
      }
    });

    console.log('[DSE] Integração iniciada');
  },

  stop() {
    DSEService.stopPolling();
  },
};

// Exporta para uso nos outros scripts do app
if (typeof window !== 'undefined') {
  window.DSEConfig      = DSE_CONFIG;
  window.DSEParser      = DSEParser;
  window.DSEService     = DSEService;
  window.DSEBackendSync = DSEBackendSync;
  window.DSEIntegration = DSEIntegration;
}
