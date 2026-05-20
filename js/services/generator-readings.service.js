/**
 * ============================================
 * AMZ APP - GENERATOR READINGS SERVICE
 * Leituras reais do DSE via Supabase
 * ============================================
 * Busca dados da tabela generator_readings
 * Usado em: dashboard, monitoramento, relatorios
 * ============================================
 */

const GeneratorReadingsService = {

  // ── Config ────────────────────────────────
  _supabaseUrl:  null,
  _anonKey:      null,
  _realtimeSub:  null,
  _heartbeatTimer: null,
  _reconnectTimer: null,
  _onNovaCallback: null,
  _listeners:    [],

  _init() {
    this._supabaseUrl = window.CONFIG?.SUPABASE?.URL;
    this._anonKey     = window.CONFIG?.SUPABASE?.ANON_KEY;
  },

  _headers() {
    const token = localStorage.getItem(window.CONFIG?.AUTH?.TOKEN_KEY);
    const h = {
      'apikey':       this._anonKey,
      'Content-Type': 'application/json',
    };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  },

  // ── Última leitura consolidada (view) ─────
  async getUltimaLeitura() {
    this._init();
    try {
      const res = await fetch(
        `${this._supabaseUrl}/rest/v1/vw_ultima_leitura?select=*&limit=1`,
        { headers: this._headers() }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data?.[0] ?? null;
    } catch (err) {
      console.error('[Readings] getUltimaLeitura:', err);
      return null;
    }
  },

  // ── Última leitura por campo ──────────────
  async getUltimoPorCampo(campo) {
    this._init();
    try {
      const res = await fetch(
        `${this._supabaseUrl}/rest/v1/generator_readings`
        + `?select=reading_timestamp,${campo}`
        + `&${campo}=not.is.null`
        + `&order=reading_timestamp.desc`
        + `&limit=1`,
        { headers: this._headers() }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data?.[0] ?? null;
    } catch (err) {
      console.error('[Readings] getUltimoPorCampo:', err);
      return null;
    }
  },

  // ── Dashboard: busca cada campo individualmente ─
  // NOTA: A edge function insere UMA linha por atributo (1 coluna por row).
  // Por isso é necessário buscar cada campo separadamente.
  async getDashboard() {
    this._init();
    const campos = [
      'velocidade_motor','pressao_oleo','temperatura_resfriamento',
      'nivel_combustivel','tensao_bateria','tensao_carga_alternador',
      'frequencia_gerador','gerador_tensao_l1n','gerador_tensao_l2n',
      'gerador_tensao_l3n','frequencia_rede','rede_tensao_l1n',
      'rede_tensao_l2n','rede_tensao_l3n','gerador_watts_total',
      'tempo_funcionamento_motor','numero_partidas',
    ];
    try {
      const resultados = await Promise.all(campos.map(c => this.getUltimoPorCampo(c)));
      const dash = {};
      campos.forEach((c, i) => {
        const row = resultados[i];
        dash[c] = {
          valor:     row ? (row[c] ?? null) : null,
          timestamp: row?.reading_timestamp ?? null,
        };
      });
      return dash;
    } catch (err) {
      console.error('[Readings] getDashboard:', err);
      return {};
    }
  },

  // ── Histórico de um campo ─────────────────
  async getHistorico(campo, horas = 24, limite = 200) {
    this._init();
    const since = new Date(Date.now() - horas * 3600000).toISOString();
    try {
      const res = await fetch(
        `${this._supabaseUrl}/rest/v1/generator_readings`
        + `?select=reading_timestamp,${campo}`
        + `&${campo}=not.is.null`
        + `&reading_timestamp=gte.${since}`
        + `&order=reading_timestamp.asc`
        + `&limit=${limite}`,
        { headers: this._headers() }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error('[Readings] getHistorico:', err);
      return [];
    }
  },

  // ── Relatório com filtro de período ───────
  async getRelatorio(dataInicio, dataFim, limite = 500) {
    this._init();
    try {
      let url = `${this._supabaseUrl}/rest/v1/generator_readings`
        + `?select=reading_timestamp,xml_source,velocidade_motor,pressao_oleo`
        + `,temperatura_resfriamento,nivel_combustivel,tensao_bateria`
        + `,tensao_carga_alternador,frequencia_gerador,gerador_tensao_l1n`
        + `,gerador_tensao_l2n,gerador_tensao_l3n,gerador_corrente_l1`
        + `,gerador_watts_total,frequencia_rede,rede_tensao_l1n`
        + `,rede_tensao_l2n,rede_tensao_l3n,tempo_funcionamento_motor`
        + `,numero_partidas`
        + `&order=reading_timestamp.desc`
        + `&limit=${limite}`;

      if (dataInicio) url += `&reading_timestamp=gte.${dataInicio}`;
      if (dataFim)    url += `&reading_timestamp=lte.${dataFim}`;

      const res = await fetch(url, { headers: this._headers() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error('[Readings] getRelatorio:', err);
      return [];
    }
  },

  // ── Estatísticas de um campo ──────────────
  async getEstatisticas(campo, dataInicio, dataFim, limite = 2000) {
    this._init();
    try {
      let url = `${this._supabaseUrl}/rest/v1/generator_readings`
        + `?select=reading_timestamp,${campo}`
        + `&${campo}=not.is.null`
        + `&order=reading_timestamp.asc`
        + `&limit=${limite}`;
      
      if (dataInicio) url += `&reading_timestamp=gte.${dataInicio}`;
      if (dataFim)    url += `&reading_timestamp=lte.${dataFim}`;

      const res  = await fetch(url, { headers: this._headers() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const vals = data.map(r => parseFloat(r[campo])).filter(v => !isNaN(v));
      if (!vals.length) return { min: null, max: null, media: null, total: 0 };

      return {
        min:   Math.min(...vals),
        max:   Math.max(...vals),
        media: (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2),
        total: vals.length,
      };
    } catch (err) {
      console.error('[Readings] getEstatisticas:', err);
      return { min: null, max: null, media: null, total: 0 };
    }
  },

  // ── Status do gerador ─────────────────────
  async getStatus() {
    this._init();
    try {
      const res = await fetch(
        `${this._supabaseUrl}/rest/v1/generator_readings`
        + `?select=reading_timestamp,velocidade_motor,temperatura_resfriamento,nivel_combustivel,tensao_bateria`
        + `&order=reading_timestamp.desc`
        + `&limit=1`,
        { headers: this._headers() }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const leit = data?.[0] ?? null;
      if (!leit) return { online: false, standby: false, velocidade: 0, ultimaLeitura: null, atrasoMin: null };

      const rpm         = parseFloat(leit.velocidade_motor)         || 0;
      const temp        = parseFloat(leit.temperatura_resfriamento) || 0;
      const combustivel = parseFloat(leit.nivel_combustivel)        || 0;
      const bateria     = parseFloat(leit.tensao_bateria)           || 0;
      const comLeituras = temp > 0 && combustivel > 0 && bateria > 0;

      return {
        online:        rpm > 0 && comLeituras,
        standby:       rpm === 0 && comLeituras,
        velocidade:    rpm,
        ultimaLeitura: leit.reading_timestamp,
        atrasoMin:     Math.round((Date.now() - new Date(leit.reading_timestamp)) / 60000),
      };
    } catch (err) {
      console.error('[Readings] getStatus:', err);
      return { online: false, standby: false, velocidade: 0, ultimaLeitura: null, atrasoMin: null };
    }
  },

  // ── Realtime: ouve novos INSERTs ──────────
  // CORREÇÃO: ws era usado antes de ser declarado (ReferenceError).
  // Adicionado: heartbeat a cada 25s e auto-reconnect em caso de queda.
  subscribeRealtime(onNova) {
    this._init();
    if (!window.CONFIG?.SUPABASE?.URL) return null;

    this._onNovaCallback = onNova;
    this._conectarRealtime();
    return this._realtimeSub;
  },

  _conectarRealtime() {
    // Limpa conexão anterior se existir
    this._limparRealtime(false);

    const token  = localStorage.getItem(window.CONFIG?.AUTH?.TOKEN_KEY);
    const wsUrl  = this._supabaseUrl
      .replace('https://', 'wss://')
      + '/realtime/v1/websocket'
      + `?apikey=${this._anonKey}`
      + `&vsn=1.0.0`;

    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      console.error('[Realtime] Falha ao criar WebSocket:', err);
      this._agendarReconexao();
      return null;
    }

    // ── onopen: JOIN no canal + heartbeat ──────────────────────────────
    ws.onopen = () => {
      console.log('[Realtime] Conectado — ouvindo generator_readings ✓');

      ws.send(JSON.stringify({
        topic:   'realtime:public:generator_readings',
        event:   'phx_join',
        payload: {
          config: {
            broadcast:        { self: true },
            presence:         { key: '' },
            postgres_changes: [{
              event:  'INSERT',
              schema: 'public',
              table:  'generator_readings',
            }],
          },
          ...(token ? { access_token: token } : {}),
        },
        ref: '1',
      }));

      // Heartbeat a cada 25s para manter a conexão viva no Supabase
      this._heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            topic:   'phoenix',
            event:   'heartbeat',
            payload: {},
            ref:     String(Date.now()),
          }));
        }
      }, 25_000);
    };

    // ── onmessage: dispara callback quando chega novo INSERT ───────────
    ws.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data);

        // Confirmação de JOIN
        if (parsed?.event === 'phx_reply' && parsed?.ref === '1') {
          console.log('[Realtime] Canal confirmado ✓');
          return;
        }

        // Novo dado inserido
        if (parsed?.payload?.data?.record) {
          console.log('[Realtime] Nova leitura recebida:', parsed.payload.data.record);
          if (typeof this._onNovaCallback === 'function') {
            this._onNovaCallback(parsed.payload.data.record);
          }
        }
      } catch (_) {}
    };

    ws.onerror = (e) => {
      console.warn('[Realtime] Erro WebSocket:', e);
    };

    // ── onclose: reconecta automaticamente após 5s ─────────────────────
    ws.onclose = (e) => {
      console.warn(`[Realtime] Conexão fechada (code=${e.code}) — reconectando em 5s…`);
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
      // Só reconecta se ainda há callback registrado (não foi unsubscribe intencional)
      if (this._onNovaCallback) {
        this._agendarReconexao();
      }
    };

    this._realtimeSub = ws;
    return ws;
  },

  _agendarReconexao() {
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => {
      if (this._onNovaCallback) {
        console.log('[Realtime] Tentando reconectar…');
        this._conectarRealtime();
      }
    }, 5_000);
  },

  _limparRealtime(limparCallback = true) {
    clearInterval(this._heartbeatTimer);
    clearTimeout(this._reconnectTimer);
    this._heartbeatTimer = null;
    this._reconnectTimer = null;

    if (this._realtimeSub) {
      // Remove onclose para não disparar reconexão ao fechar manualmente
      this._realtimeSub.onclose = null;
      this._realtimeSub.close();
      this._realtimeSub = null;
    }

    if (limparCallback) {
      this._onNovaCallback = null;
    }
  },

  unsubscribeRealtime() {
    console.log('[Realtime] Desconectando…');
    this._limparRealtime(true);
  },

  // ── Helpers de formatação ─────────────────
  formatarTimestamp(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR', {
      timeZone: 'America/Manaus',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  },

  formatarValor(valor, unidade = '', decimais = 1) {
    if (valor === null || valor === undefined) return '—';
    const n = parseFloat(valor);
    if (isNaN(n)) return '—';
    return n.toFixed(decimais) + (unidade ? ' ' + unidade : '');
  },

  // ── Config de campos para UI ──────────────
  CAMPOS: {
    velocidade_motor:         { label: 'Velocidade Motor',        unidade: 'RPM', decimais: 0, alertaMax: 1950, alertaMin: 0 },
    pressao_oleo:             { label: 'Pressão do Óleo',         unidade: 'bar', decimais: 2, alertaMax: 8.5,  alertaMin: 1.5 },
    temperatura_resfriamento: { label: 'Temp. Resfriamento',      unidade: '°C',  decimais: 0, alertaMax: 95,   alertaMin: 0 },
    temperatura_oleo:         { label: 'Temp. do Óleo',           unidade: '°C',  decimais: 0, alertaMax: 110,  alertaMin: 0 },
    nivel_combustivel:        { label: 'Nível de Combustível',    unidade: '%',   decimais: 0, alertaMax: 100,  alertaMin: 15 },
    tensao_bateria:           { label: 'Tensão da Bateria',       unidade: 'V',   decimais: 1, alertaMax: 30,   alertaMin: 22 },
    tensao_carga_alternador:  { label: 'Tensão Alternador',       unidade: 'V',   decimais: 1, alertaMax: 30,   alertaMin: 0 },
    frequencia_gerador:       { label: 'Frequência Gerador',      unidade: 'Hz',  decimais: 1, alertaMax: 61,   alertaMin: 59 },
    gerador_tensao_l1n:       { label: 'Gerador Tensão L1-N',     unidade: 'V',   decimais: 1, alertaMax: 140,  alertaMin: 100 },
    gerador_tensao_l2n:       { label: 'Gerador Tensão L2-N',     unidade: 'V',   decimais: 1, alertaMax: 140,  alertaMin: 100 },
    gerador_tensao_l3n:       { label: 'Gerador Tensão L3-N',     unidade: 'V',   decimais: 1, alertaMax: 140,  alertaMin: 100 },
    gerador_corrente_l1:      { label: 'Corrente L1',             unidade: 'A',   decimais: 1, alertaMax: 200,  alertaMin: 0 },
    gerador_corrente_l2:      { label: 'Corrente L2',             unidade: 'A',   decimais: 1, alertaMax: 200,  alertaMin: 0 },
    gerador_corrente_l3:      { label: 'Corrente L3',             unidade: 'A',   decimais: 1, alertaMax: 200,  alertaMin: 0 },
    gerador_watts_total:      { label: 'Potência Total',          unidade: 'W',   decimais: 0, alertaMax: null, alertaMin: 0 },
    frequencia_rede:          { label: 'Frequência da Rede',      unidade: 'Hz',  decimais: 1, alertaMax: 61,   alertaMin: 59 },
    rede_tensao_l1n:          { label: 'Rede Tensão L1-N',        unidade: 'V',   decimais: 1, alertaMax: 140,  alertaMin: 100 },
    rede_tensao_l2n:          { label: 'Rede Tensão L2-N',        unidade: 'V',   decimais: 1, alertaMax: 140,  alertaMin: 100 },
    rede_tensao_l3n:          { label: 'Rede Tensão L3-N',        unidade: 'V',   decimais: 1, alertaMax: 140,  alertaMin: 100 },
    tempo_funcionamento_motor:{ label: 'Horas de Funcionamento',  unidade: 'h',   decimais: 0, alertaMax: null, alertaMin: 0 },
    numero_partidas:          { label: 'Número de Partidas',      unidade: '',    decimais: 0, alertaMax: null, alertaMin: 0 },
  },

  getAlerta(campo, valor) {
    const cfg = this.CAMPOS[campo];
    if (!cfg || valor === null) return null;
    const v = parseFloat(valor);
    if (cfg.alertaMax !== null && v > cfg.alertaMax) return 'critico';
    if (cfg.alertaMin !== null && v < cfg.alertaMin && v > 0) return 'atencao';
    return 'normal';
  },
};

window.GeneratorReadingsService = GeneratorReadingsService;
