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

  // ── Dashboard: todos os campos de uma vez ─
  async getDashboard() {
    this._init();
    const campos = [
      'velocidade_motor','pressao_oleo','temperatura_resfriamento',
      'nivel_combustivel','tensao_bateria','tensao_carga_alternador',
      'frequencia_gerador','gerador_tensao_l1n','gerador_tensao_l2n',
      'gerador_tensao_l3n','frequencia_rede','rede_tensao_l1n',
      'rede_tensao_l2n','rede_tensao_l3n','gerador_watts_total',
      'engine_hours','numero_partidas',
    ];
    try {
      // UMA única requisição com todos os campos
      const res = await fetch(
        `${this._supabaseUrl}/rest/v1/generator_readings`
        + `?select=reading_timestamp,${campos.join(',')}`
        + `&order=reading_timestamp.desc`
        + `&limit=1`,
        { headers: this._headers() }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const row = data?.[0];
      if (!row) return {};
  
      const dash = {};
      campos.forEach(c => {
        dash[c] = { valor: row[c] ?? null, timestamp: row.reading_timestamp };
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
    const leit = await this.getUltimoPorCampo('velocidade_motor');
    if (!leit) return { online: false, velocidade: 0, ultimaLeitura: null, atrasoMin: null };

    const diffMin = Math.round((Date.now() - new Date(leit.reading_timestamp)) / 60000);
    return {
      online:       parseFloat(leit.velocidade_motor) > 0 && diffMin < 5,
      velocidade:   parseFloat(leit.velocidade_motor),
      ultimaLeitura: leit.reading_timestamp,
      atrasoMin:    diffMin,
    };
  },

  // ── Realtime: ouve novos INSERTs ──────────
  subscribeRealtime(onNova) {
    this._init();
    if (!window.CONFIG?.SUPABASE?.URL) return null;

    // Usa Supabase Realtime via WebSocket nativo
    const wsUrl = this._supabaseUrl
      .replace('https://', 'wss://')
      .replace('http://',  'ws://')
      + '/realtime/v1/websocket?apikey=' + this._anonKey + '&vsn=1.0.0';

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        ws.send(JSON.stringify({
          topic:   'realtime:public:generator_readings',
          event:   'phx_join',
          payload: { config: { broadcast: { self: true }, presence: { key: '' }, postgres_changes: [{ event: 'INSERT', schema: 'public', table: 'generator_readings' }] } },
          ref:     '1'
        }));
        console.log('[Realtime] Conectado — ouvindo generator_readings');
      };

      ws.onmessage = (msg) => {
        try {
          const parsed = JSON.parse(msg.data);
          if (parsed?.payload?.data?.record) {
            onNova(parsed.payload.data.record);
          }
        } catch (_) {}
      };

      ws.onerror = (e) => console.warn('[Realtime] Erro WS:', e);

      this._realtimeSub = ws;
      return ws;
    } catch (err) {
      console.error('[Realtime] Falha ao conectar:', err);
      return null;
    }
  },

  unsubscribeRealtime() {
    if (this._realtimeSub) {
      this._realtimeSub.close();
      this._realtimeSub = null;
    }
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
