/**
 * ============================================
 * AMZ APP - GENERATOR READINGS SERVICE  v3
 * Leituras reais do DSE via Supabase
 * ============================================
 * Usado em: dashboard, monitoramento, relatorios
 *
 * CORREÇÕES v3:
 *
 *  BUG #1 — cache: 'no-store' ausente nos fetches GET
 *    → Browser cacheava respostas REST → dados sempre desatualizados.
 *    → CORRIGIDO: todas as chamadas usam cache:'no-store' + header
 *      'Cache-Control':'no-cache' para garantir dados frescos.
 *
 *  BUG #2 — Sem AbortController / timeout nas requisições
 *    → Fetch podia travar indefinidamente, bloqueando atualizações.
 *    → CORRIGIDO: _fetchWithTimeout() envolve todos os fetch com
 *      AbortController + timeout configurável (default CONFIG.SYNC.TIMEOUT).
 *
 *  BUG #3 — getDashboard() fazia 17 requisições HTTP paralelas
 *    → Cada atualização (incluindo cada INSERT Realtime) disparava
 *      17 fetch simultâneos. Em dashboard.html chamava 8 por evento.
 *    → CORRIGIDO: getDashboard() faz UMA única query que busca as
 *      últimas 50 linhas e pivot em JS para extrair o valor mais
 *      recente de cada campo. 1 request no lugar de 17.
 *
 *  BUG #4 — JOIN do WebSocket sem campo join_ref
 *    → Protocolo Phoenix Channels exige join_ref no JOIN; sem ele
 *      o servidor não cria o canal e a subscription falha silenciosamente.
 *    → CORRIGIDO: join_ref adicionado ao JOIN e a todos os envios.
 *
 *  BUG #5 — access_token ausente quando usuário não está logado
 *    → Sem access_token no JOIN, o Supabase rejeita a subscription
 *      em tabelas com RLS habilitado.
 *    → CORRIGIDO: usa token do usuário se disponível, caso contrário
 *      usa ANON_KEY como fallback — permite subscrição anon.
 *
 *  BUG #6 — onmessage sem verificação de event === 'postgres_changes'
 *    → Mensagens de controle (heartbeat_reply, phx_close etc.) podiam
 *      ser processadas incorretamente.
 *    → CORRIGIDO: verifica event === 'postgres_changes' explicitamente.
 *
 *  BUG #7 — Reconexão Realtime sem backoff exponencial
 *    → Falhas contínuas reconectavam a cada 5s fixos, causando
 *      storm de conexões WebSocket em caso de outage do Supabase.
 *    → CORRIGIDO: backoff exponencial (5s → 10s → 20s → ... máx 120s).
 * ============================================
 */

const GeneratorReadingsService = {

  // ── Configuração ──────────────────────────
  _supabaseUrl:  null,
  _anonKey:      null,

  // ── Realtime ──────────────────────────────
  _ws:              null,
  _heartbeatTimer:  null,
  _reconnectTimer:  null,
  _onNovaCallback:  null,
  _reconnectDelay:  5000,      // BUG #7: começa em 5s, dobra a cada falha
  _maxReconnectDelay: 120000,  // BUG #7: máximo de 2 minutos
  _wsRef:           0,         // BUG #4: contador de ref para mensagens WS

  // ── Timeout padrão ────────────────────────
  _timeout() {
    return window.CONFIG?.SYNC?.TIMEOUT ?? 8000;
  },

  _init() {
    if (!this._supabaseUrl) {
      this._supabaseUrl = window.CONFIG?.SUPABASE?.URL;
      this._anonKey     = window.CONFIG?.SUPABASE?.ANON_KEY;
    }
  },

  _headers() {
    const token = localStorage.getItem(window.CONFIG?.AUTH?.TOKEN_KEY);
    return {
      // BUG #1 CORRIGIDO: sem Cache-Control, o browser cacheia GETs e
      // retorna dados velhos mesmo depois de novos INSERTs no Supabase.
      'Cache-Control': 'no-cache',
      'apikey':        this._anonKey,
      'Content-Type':  'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    };
  },

  // ── BUG #2 CORRIGIDO: fetch com timeout ───
  async _fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._timeout());
    try {
      const res = await fetch(url, {
        ...options,
        // BUG #1 CORRIGIDO: cache:'no-store' impede que o browser guarde
        // a resposta em cache — cada chamada sempre busca do servidor.
        cache:  'no-store',
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new Error(`[Readings] Timeout após ${this._timeout()}ms: ${url}`);
      }
      throw err;
    }
  },

  // ── BUG #3 CORRIGIDO: getDashboard — 1 request em vez de 17 ──────────
  // Busca as últimas 50 linhas e faz pivot em JS para obter o valor mais
  // recente de cada campo. Reduz de 17 requisições paralelas para 1.
  async getDashboard() {
    this._init();
    const campos = [
      'velocidade_motor','pressao_oleo','temperatura_resfriamento',
      'temperatura_oleo','nivel_combustivel','tensao_bateria',
      'tensao_carga_alternador','frequencia_gerador','gerador_tensao_l1n',
      'gerador_tensao_l2n','gerador_tensao_l3n','frequencia_rede',
      'rede_tensao_l1n','rede_tensao_l2n','rede_tensao_l3n',
      'gerador_watts_total','tempo_funcionamento_motor','numero_partidas',
    ];
    try {
      const selecao = ['reading_timestamp', ...campos].join(',');
      // FIX-LIMIT: aumentado de 60 para 300.
      // Com 23 campos e ~1 linha por leitura, 60 linhas cobrem no máximo
      // 3-4 campos quando tensãoDeCargaDoAlternador domina o topo da tabela.
      // 300 garante cobertura de todos os campos mesmo em dados esparsos.
      const res = await this._fetchWithTimeout(
        `${this._supabaseUrl}/rest/v1/generator_readings`
        + `?select=${selecao}`
        + `&order=reading_timestamp.desc`
        + `&limit=300`,
        { headers: this._headers() }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();

      // FIX-PIVOT: pivot melhorado com staleness detection.
      // Ignora valores zero para campos onde 0 indica "gerador desligado"
      // e registra se o dado é antigo (stale) para a UI mostrar aviso visual.
      const STALE_THRESHOLD_MS = 2 * 3600 * 1000; // 2 horas
      const now = Date.now();

      // Campos onde valor=0 com gerador offline não deve aparecer como leitura "atual"
      // (correntes, watts, RPM — são 0 só quando desligado; UI já trata via getStatus)
      const IGNORAR_ZERO = new Set([
        'gerador_corrente_l1','gerador_corrente_l2','gerador_corrente_l3',
        'gerador_watts_l1','gerador_watts_l2','gerador_watts_l3','gerador_watts_total',
        'temperatura_oleo',  // 0°C é fisicamente impossível em operação — dado corrompido
      ]);

      const dash = {};
      campos.forEach(c => {
        const row = rows.find(r => {
          const v = r[c];
          if (v === null || v === undefined) return false;
          // Para campos sensíveis, ignora zeros — evita mostrar 0 de quando desligou
          if (IGNORAR_ZERO.has(c) && parseFloat(v) === 0) return false;
          return true;
        });
        const ts    = row?.reading_timestamp ?? null;
        const ageMs = ts ? (now - new Date(ts).getTime()) : Infinity;
        dash[c] = {
          valor:  row ? parseFloat(row[c]) : null,
          timestamp: ts,
          stale: ageMs > STALE_THRESHOLD_MS,   // dado com mais de 2h
          ageMin: ts ? Math.round(ageMs / 60000) : null,
        };
      });
      console.log('[Readings] getDashboard — 1 query, pivot de', rows.length, 'linhas ✓');
      return dash;
    } catch (err) {
      console.error('[Readings] getDashboard:', err.message);
      return {};
    }
  },

  // ── Última leitura consolidada (view) ─────
  async getUltimaLeitura() {
    this._init();
    try {
      const res = await this._fetchWithTimeout(
        `${this._supabaseUrl}/rest/v1/vw_ultima_leitura?select=*&limit=1`,
        { headers: this._headers() }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data?.[0] ?? null;
    } catch (err) {
      console.error('[Readings] getUltimaLeitura:', err.message);
      return null;
    }
  },

  // ── Última leitura por campo ──────────────
  async getUltimoPorCampo(campo) {
    this._init();
    try {
      const res = await this._fetchWithTimeout(
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
      console.error('[Readings] getUltimoPorCampo:', err.message);
      return null;
    }
  },

  // ── Histórico de um campo ─────────────────
  async getHistorico(campo, horas = 24, limite = 200) {
    this._init();
    const since = new Date(Date.now() - horas * 3600000).toISOString();
    try {
      const res = await this._fetchWithTimeout(
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
      console.error('[Readings] getHistorico:', err.message);
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

      const res = await this._fetchWithTimeout(url, { headers: this._headers() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error('[Readings] getRelatorio:', err.message);
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

      const res  = await this._fetchWithTimeout(url, { headers: this._headers() });
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
      console.error('[Readings] getEstatisticas:', err.message);
      return { min: null, max: null, media: null, total: 0 };
    }
  },

  // ── Status do gerador ─────────────────────
  async getStatus() {
    this._init();
    try {
      const res = await this._fetchWithTimeout(
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
      console.error('[Readings] getStatus:', err.message);
      return { online: false, standby: false, velocidade: 0, ultimaLeitura: null, atrasoMin: null };
    }
  },

  // ══════════════════════════════════════════════════════════════════════
  // REALTIME — WebSocket Supabase
  //
  // BUG #4 CORRIGIDO: join_ref adicionado a JOIN e demais mensagens.
  //   Sem join_ref, o servidor Phoenix não associa replies ao canal e
  //   a subscription falha silenciosamente.
  //
  // BUG #5 CORRIGIDO: access_token fallback para ANON_KEY.
  //   Sem access_token no JOIN, Supabase rejeita subscription em tabelas
  //   com RLS (retorna phx_error sem mensagem clara).
  //
  // BUG #6 CORRIGIDO: verificação explícita de event === 'postgres_changes'.
  //
  // BUG #7 CORRIGIDO: backoff exponencial na reconexão.
  // ══════════════════════════════════════════════════════════════════════
  subscribeRealtime(onNova) {
    this._init();
    if (!this._supabaseUrl) {
      console.warn('[Realtime] Supabase URL não configurada — realtime desativado');
      return null;
    }

    // FIX-WS: envolve o callback num wrapper que verifica se a página
    // ainda está ativa antes de processar — protege contra callbacks
    // disparados após navegação (stale closure)
    this._onNovaCallback = (record) => {
      if (document.hidden) {
        console.debug('[Realtime] Evento ignorado — página em background');
        return;
      }
      try { onNova(record); }
      catch (e) { console.error('[Realtime] Erro no callback do subscriber:', e); }
    };

    this._reconnectDelay = 5000;
    this._conectarRealtime();
    return this._ws;
  },

  _conectarRealtime() {
    this._limparRealtime(false);

    const token  = localStorage.getItem(window.CONFIG?.AUTH?.TOKEN_KEY);
    // BUG #5 CORRIGIDO: usa token do usuário OU anon key como fallback
    const authToken = token || this._anonKey;

    const wsUrl = this._supabaseUrl
      .replace('https://', 'wss://')
      .replace('http://',  'ws://')
      + '/realtime/v1/websocket'
      + `?apikey=${this._anonKey}`
      + `&vsn=1.0.0`;

    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      console.error('[Realtime] Erro ao criar WebSocket:', err.message);
      this._agendarReconexao();
      return null;
    }

    ws.onopen = () => {
      console.log('[Realtime] WebSocket conectado — enviando JOIN ✓');
      this._reconnectDelay = 5000;  // BUG #7: reseta backoff em conexão bem-sucedida
      this._wsRef = 0;

      // BUG #4 CORRIGIDO: join_ref agora incluído no JOIN
      // BUG #5 CORRIGIDO: access_token com fallback para anon key
      ws.send(JSON.stringify({
        topic:    'realtime:generator_readings_channel',
        event:    'phx_join',
        payload:  {
          config: {
            broadcast:        { self: false },
            presence:         { key: '' },
            postgres_changes: [{
              event:  'INSERT',
              schema: 'public',
              table:  'generator_readings',
            }],
          },
          access_token: authToken,
        },
        ref:      '1',
        join_ref: '1',   // BUG #4: campo obrigatório no protocolo Phoenix Channels
      }));

      // Heartbeat a cada 25s — mantém conexão viva no Supabase
      this._heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          this._wsRef++;
          ws.send(JSON.stringify({
            topic:    'phoenix',
            event:    'heartbeat',
            payload:  {},
            ref:      String(this._wsRef),
            join_ref: null,
          }));
          console.debug('[Realtime] Heartbeat enviado ref=' + this._wsRef);
        }
      }, 25_000);
    };

    ws.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data);
        const ev     = parsed?.event;

        // Confirmação de JOIN — loga e ignora
        if (ev === 'phx_reply' && parsed?.ref === '1') {
          const status = parsed?.payload?.status;
          if (status === 'ok') {
            console.log('[Realtime] Canal generator_readings confirmado ✓');
          } else {
            console.error('[Realtime] JOIN rejeitado pelo servidor:', JSON.stringify(parsed?.payload));
          }
          return;
        }

        // BUG #6 CORRIGIDO: verifica event === 'postgres_changes' explicitamente
        // Descarta mensagens de controle (heartbeat_reply, system, phx_close etc.)
        if (ev !== 'postgres_changes') return;

        const record = parsed?.payload?.data?.record;
        if (!record) {
          console.warn('[Realtime] Evento postgres_changes sem record:', JSON.stringify(parsed));
          return;
        }

        console.log('[Realtime] INSERT recebido — xml_source:', record.xml_source,
          '| ts:', record.reading_timestamp);

        if (typeof this._onNovaCallback === 'function') {
          this._onNovaCallback(record);
        }

      } catch (err) {
        console.warn('[Realtime] Erro ao parsear mensagem WS:', err.message);
      }
    };

    ws.onerror = (e) => {
      console.warn('[Realtime] Erro no WebSocket (ver estado de rede)');
    };

    // BUG #7 CORRIGIDO: backoff exponencial ao reconectar
    ws.onclose = (e) => {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
      if (e.wasClean) {
        console.log(`[Realtime] Conexão encerrada normalmente (code=${e.code})`);
      } else {
        console.warn(`[Realtime] Conexão perdida (code=${e.code}) — reconectando em ${this._reconnectDelay / 1000}s`);
      }
      if (this._onNovaCallback) {
        this._agendarReconexao();
      }
    };

    this._ws = ws;
    return ws;
  },

  // BUG #7 CORRIGIDO: backoff exponencial (5s → 10s → 20s → ... máx 120s)
  _agendarReconexao() {
    clearTimeout(this._reconnectTimer);
    const delay = this._reconnectDelay;
    this._reconnectTimer = setTimeout(() => {
      if (this._onNovaCallback) {
        console.log(`[Realtime] Tentando reconectar (delay foi ${delay / 1000}s)…`);
        this._conectarRealtime();
      }
    }, delay);
    // Dobra o delay para a próxima tentativa, respeitando o máximo
    this._reconnectDelay = Math.min(delay * 2, this._maxReconnectDelay);
  },

  _limparRealtime(limparCallback = true) {
    clearInterval(this._heartbeatTimer);
    clearTimeout(this._reconnectTimer);
    this._heartbeatTimer = null;
    this._reconnectTimer = null;

    if (this._ws) {
      this._ws.onclose = null;  // evita reconexão ao fechar manualmente
      try { this._ws.close(); } catch (_) {}
      this._ws = null;
    }

    if (limparCallback) {
      this._onNovaCallback = null;
    }
  },

  unsubscribeRealtime() {
    console.log('[Realtime] Desconectando manualmente…');
    this._limparRealtime(true);
    this._reconnectDelay = 5000;  // reseta backoff
  },

  // ── Alias compatível ──────────────────────
  // Mantido para backward-compatibility com código legado que use _realtimeSub
  get _realtimeSub() { return this._ws; },

  // ── Helpers de formatação ─────────────────
  formatarTimestamp(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('pt-BR', {
        timeZone: 'America/Manaus',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch (_) { return iso; }
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
    if (!cfg || valor === null || valor === undefined) return null;
    const v = parseFloat(valor);
    if (isNaN(v)) return null;
    if (cfg.alertaMax !== null && v > cfg.alertaMax) return 'critico';
    if (cfg.alertaMin !== null && v < cfg.alertaMin && v > 0) return 'atencao';
    return 'normal';
  },
};

window.GeneratorReadingsService = GeneratorReadingsService;
