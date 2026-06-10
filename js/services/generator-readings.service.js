/**
 * ============================================
 * AMZ APP - GENERATOR READINGS SERVICE  v4
 * Leituras reais do DSE via Supabase
 * ============================================
 *
 * CORREÇÕES v4 (em relação à v3):
 *
 *  BUG #12 — getDashboard() pivot com limit=300 ainda falha em dados muito esparsos
 *    → Com tabela sparse (1 campo por linha), 300 linhas podem cobrir apenas
 *      ~15 campos únicos se um campo é inserido com alta frequência.
 *    → CORRIGIDO: pivot agora usa Set de campos já encontrados para parar de
 *      iterar quando todos os campos foram satisfeitos. Reduz processamento JS
 *      e garante cobertura completa mesmo com dados desiguais.
 *      Limite aumentado para 500 como salvaguarda.
 *
 *  BUG #13 — getStatus() usa lógica "comLeituras" que mascara gerador offline
 *    → ANTES: comLeituras = temp > 0 && combustivel > 0 && bateria > 0
 *      → se o gerador desligar e a temperatura cair para 0°C, standby ficava false
 *      → gerador era marcado como "offline" quando estava apenas parado (standby)
 *    → CORRIGIDO: standby = rpm === 0 && leit válida. Não depende mais de temp > 0.
 *
 *  BUG #14 — subscribeRealtime() criava novo WebSocket sem fechar o anterior
 *    quando chamado duas vezes na mesma página (ex: hot-reload ou fast-refresh)
 *    → CORRIGIDO: _limparRealtime() sempre chamado antes de _conectarRealtime()
 *      (já estava, mas o guard _onNovaCallback !== null impedia reconexão intencional)
 *    → CORRIGIDO: subscribeRealtime() agora aceita chamada repetida mesmo com
 *      _onNovaCallback existente — fecha o canal antigo e reabre.
 *
 *  BUG #15 — heartbeat de 25s pode ser muito agressivo em planos gratuitos Supabase
 *    → Sem impacto funcional mas gera logs desnecessários.
 *    → Ajustado para 29s (logo abaixo do timeout de 30s do servidor).
 *
 *  BUG #16 — onmessage não tratava 'system' event enviado pelo Supabase na reconexão
 *    → 'system' events carregam status de presença e não devem ser descartados com warn
 *    → CORRIGIDO: 'system' logado como debug em vez de warning.
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
  _reconnectDelay:  5000,
  _maxReconnectDelay: 120000,
  _wsRef:           0,

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
      'Cache-Control': 'no-cache',
      'apikey':        this._anonKey,
      'Content-Type':  'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    };
  },

  async _fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._timeout());
    try {
      const res = await fetch(url, {
        ...options,
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

  // ── BUG #12 CORRIGIDO: getDashboard com pivot otimizado ──────────────
  // v5 CORRIGIDO: getDashboard usa 1 query por campo (not.is.null + limit=1)
  // FIX PRINCIPAL: a tabela é SPARSE (cada linha tem só 1 campo preenchido).
  // O pivot anterior precisava de 500+ linhas e ainda assim falhava em campos
  // com poucas leituras. Agora cada campo tem sua própria query direta ao banco,
  // garantindo sempre a leitura mais recente independente da frequência de dados.
  // As queries são disparadas em paralelo (Promise.all) para manter performance.
  async getDashboard() {
    this._init();
    const campos = [
      // Motor
      'velocidade_motor','pressao_oleo','temperatura_resfriamento',
      'temperatura_oleo','nivel_combustivel','tensao_bateria',
      'tensao_carga_alternador','tempo_funcionamento_motor','numero_partidas',
      // Gerador elétrico
      'frequencia_gerador',
      'gerador_tensao_l1n','gerador_tensao_l2n','gerador_tensao_l3n',
      'gerador_tensao_l1l2','gerador_tensao_l2l3','gerador_tensao_l3l1',
      'gerador_corrente_l1','gerador_corrente_l2','gerador_corrente_l3',
      'gerador_watts_total','gerador_watts_l1','gerador_watts_l2','gerador_watts_l3',
      'gerador_va_total','gerador_va_l1','gerador_va_l2','gerador_va_l3',
      'gerador_var_total','gerador_var_l1','gerador_var_l2','gerador_var_l3',
      'gerador_fator_potencia','gerador_fator_potencia_l1','gerador_fator_potencia_l2','gerador_fator_potencia_l3',
      'gerador_energia_kwh','gerador_energia_kva','gerador_energia_kvar',
      // Rede elétrica
      'frequencia_rede',
      'rede_tensao_l1n','rede_tensao_l2n','rede_tensao_l3n',
      'rede_tensao_l1l2',
    ];

    // Campos onde valor=0 é fisicamente impossível quando gerador está ativo
    // gerador_corrente e watts: podem ser 0 legitimamente (sem carga) — não ignorar
    // temperatura_oleo: sensor pode não estar presente, não ignorar 0 aqui
    const IGNORAR_ZERO = new Set([
      // removido gerador_watts_total e outros que podem ter valor 0 válido
    ]);

    const STALE_THRESHOLD_MS = 4 * 3600 * 1000; // 4h — tolerante com geradores intermitentes
    const now = Date.now();

    try {
      // Dispara 1 query por campo em paralelo — cada uma retorna a leitura mais recente
      const resultados = await Promise.all(
        campos.map(async (c) => {
          try {
            const res = await this._fetchWithTimeout(
              `${this._supabaseUrl}/rest/v1/generator_readings`
              + `?select=reading_timestamp,${c}`
              + `&${c}=not.is.null`
              + `&order=reading_timestamp.desc`
              + `&limit=1`,
              { headers: this._headers() }
            );
            if (!res.ok) return [c, null];
            const data = await res.json();
            const row  = data?.[0];
            if (!row || row[c] === null || row[c] === undefined) return [c, null];

            const v     = parseFloat(row[c]);
            if (isNaN(v)) return [c, null];
            if (IGNORAR_ZERO.has(c) && v === 0) return [c, null];

            const ts    = row.reading_timestamp ?? null;
            const ageMs = ts ? (now - new Date(ts).getTime()) : Infinity;
            return [c, {
              valor:     v,
              timestamp: ts,
              stale:     ageMs > STALE_THRESHOLD_MS,
              ageMin:    ts ? Math.round(ageMs / 60000) : null,
            }];
          } catch (_) {
            return [c, null];
          }
        })
      );

      const dash = {};
      let encontrados = 0;
      for (const [c, dado] of resultados) {
        if (dado) encontrados++;
        dash[c] = dado ?? { valor: null, timestamp: null, stale: false, ageMin: null };
      }

      console.log(`[Readings] getDashboard v5 — ${campos.length} queries paralelas, ${encontrados}/${campos.length} campos com dados ✓`);
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
        + `?select=reading_timestamp,velocidade_motor,pressao_oleo`
        + `,temperatura_resfriamento,temperatura_oleo,nivel_combustivel`
        + `,tensao_bateria,tensao_carga_alternador,tempo_funcionamento_motor,numero_partidas`
        + `,frequencia_gerador`
        + `,gerador_tensao_l1n,gerador_tensao_l2n,gerador_tensao_l3n`
        + `,gerador_tensao_l1l2,gerador_tensao_l2l3,gerador_tensao_l3l1`
        + `,gerador_corrente_l1,gerador_corrente_l2,gerador_corrente_l3`
        + `,gerador_watts_total,gerador_watts_l1,gerador_watts_l2,gerador_watts_l3`
        + `,gerador_va_total,gerador_va_l1,gerador_va_l2,gerador_va_l3`
        + `,gerador_var_total,gerador_var_l1,gerador_var_l2,gerador_var_l3`
        + `,gerador_fator_potencia,gerador_fator_potencia_l1,gerador_fator_potencia_l2,gerador_fator_potencia_l3`
        + `,gerador_energia_kwh,gerador_energia_kva,gerador_energia_kvar`
        + `,frequencia_rede,rede_tensao_l1n,rede_tensao_l2n,rede_tensao_l3n,rede_tensao_l1l2`
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

  // ── BUG #13 CORRIGIDO: Status do gerador ──
  // ANTES: standby dependia de temp/combustivel/bateria > 0, mascarando
  //        geradores parados corretamente (temp pode cair a 0 quando desligado)
  // DEPOIS: standby = última leitura existe E rpm === 0 (simples e correto)
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

      if (!leit) {
        return { online: false, standby: false, velocidade: 0, ultimaLeitura: null, atrasoMin: null };
      }

      const rpm  = parseFloat(leit.velocidade_motor) || 0;
      // BUG #13 CORRIGIDO: standby é simplesmente rpm=0 com leitura existente
      // Não depende mais de temperatura/combustivel/bateria > 0
      const temLeitura = leit.reading_timestamp !== null;

      return {
        online:        rpm > 0,
        standby:       rpm === 0 && temLeitura,
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
  // ══════════════════════════════════════════════════════════════════════

  // BUG #14 CORRIGIDO: subscribeRealtime aceita chamada repetida corretamente
  subscribeRealtime(onNova) {
    this._init();
    if (!this._supabaseUrl) {
      console.warn('[Realtime] Supabase URL não configurada — realtime desativado');
      return null;
    }

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

    const token     = localStorage.getItem(window.CONFIG?.AUTH?.TOKEN_KEY);
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
      this._reconnectDelay = 5000;
      this._wsRef = 0;

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
        join_ref: '1',
      }));

      // BUG #15 CORRIGIDO: heartbeat a cada 29s (era 25s)
      // 29s é o valor ideal: abaixo do timeout de 30s do servidor Supabase,
      // mas sem sobrecarga desnecessária de mensagens de controle
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
      }, 29_000);
    };

    ws.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data);
        const ev     = parsed?.event;

        if (ev === 'phx_reply' && parsed?.ref === '1') {
          const status = parsed?.payload?.status;
          if (status === 'ok') {
            console.log('[Realtime] Canal generator_readings confirmado ✓');
          } else {
            console.error('[Realtime] JOIN rejeitado:', JSON.stringify(parsed?.payload));
          }
          return;
        }

        // BUG #16 CORRIGIDO: 'system' event logado como debug, não como warning
        if (ev === 'system') {
          console.debug('[Realtime] System event:', JSON.stringify(parsed?.payload));
          return;
        }

        if (ev !== 'postgres_changes') return;

        const record = parsed?.payload?.data?.record;
        if (!record) {
          console.warn('[Realtime] Evento postgres_changes sem record:', JSON.stringify(parsed));
          return;
        }

        console.log('[Realtime] INSERT recebido — ts:', record.reading_timestamp);

        if (typeof this._onNovaCallback === 'function') {
          this._onNovaCallback(record);
        }

      } catch (err) {
        console.warn('[Realtime] Erro ao parsear mensagem WS:', err.message);
      }
    };

    ws.onerror = () => {
      console.warn('[Realtime] Erro no WebSocket (verifique conexão de rede)');
    };

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

  _agendarReconexao() {
    clearTimeout(this._reconnectTimer);
    const delay = this._reconnectDelay;
    this._reconnectTimer = setTimeout(() => {
      if (this._onNovaCallback) {
        console.log(`[Realtime] Tentando reconectar (delay foi ${delay / 1000}s)…`);
        this._conectarRealtime();
      }
    }, delay);
    this._reconnectDelay = Math.min(delay * 2, this._maxReconnectDelay);
  },

  _limparRealtime(limparCallback = true) {
    clearInterval(this._heartbeatTimer);
    clearTimeout(this._reconnectTimer);
    this._heartbeatTimer = null;
    this._reconnectTimer = null;

    if (this._ws) {
      this._ws.onclose = null;
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
    this._reconnectDelay = 5000;
  },

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

  // Bug #6 corrigido: horasDeFuncionamentoDoMotor chega do DSE como string "HH:MM:SS".
  // parseFloat("01:46:25") retornaria 1 (truncando minutos e segundos).
  // Esta função converte corretamente para horas decimais antes de persistir/exibir.
  hhmmssToHoras(str) {
    if (!str || typeof str !== 'string') return null;
    const partes = str.split(':').map(Number);
    if (partes.length !== 3 || partes.some(isNaN)) return null;
    const [h, m, s] = partes;
    return h + m / 60 + s / 3600;
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
    // Bug #1 corrigido: alertaMin null — rampa de partida sobe de ~36V ate 127V (~30s),
    // alertaMin: 100 disparava falso alarme toda vez que o gerador ligava.
    gerador_tensao_l1n:       { label: 'Gerador Tensão L1-N',     unidade: 'V',   decimais: 1, alertaMax: 135,  alertaMin: null },
    gerador_tensao_l2n:       { label: 'Gerador Tensão L2-N',     unidade: 'V',   decimais: 1, alertaMax: 135,  alertaMin: null },
    gerador_tensao_l3n:       { label: 'Gerador Tensão L3-N',     unidade: 'V',   decimais: 1, alertaMax: 135,  alertaMin: null },
    gerador_corrente_l1:      { label: 'Corrente L1',             unidade: 'A',   decimais: 1, alertaMax: 200,  alertaMin: 0 },
    gerador_corrente_l2:      { label: 'Corrente L2',             unidade: 'A',   decimais: 1, alertaMax: 200,  alertaMin: 0 },
    gerador_corrente_l3:      { label: 'Corrente L3',             unidade: 'A',   decimais: 1, alertaMax: 200,  alertaMin: 0 },
    gerador_watts_total:      { label: 'Potência Total',          unidade: 'kW',  decimais: 1, alertaMax: null, alertaMin: 0 },
    frequencia_rede:          { label: 'Frequência da Rede',      unidade: 'Hz',  decimais: 1, alertaMax: 61,   alertaMin: 59 },
    // Confirmado: DSE exporta redeTensãoL1N (fase-neutro ~127V) para este módulo.
    // Valor real observado: 129.5V — faixa correta 100-140V (L-N de rede 220V trifásica).
    rede_tensao_l1n:          { label: 'Rede Tensão L1-N',        unidade: 'V',   decimais: 1, alertaMax: 140,  alertaMin: 100 },
    rede_tensao_l2n:          { label: 'Rede Tensão L2-N',        unidade: 'V',   decimais: 1, alertaMax: 140,  alertaMin: 100 },
    rede_tensao_l3n:          { label: 'Rede Tensão L3-N',        unidade: 'V',   decimais: 1, alertaMax: 140,  alertaMin: 100 },
    rede_tensao_l1l2:         { label: 'Rede Tensão L1-L2',       unidade: 'V',   decimais: 1, alertaMax: 250,  alertaMin: 190 },
    tempo_funcionamento_motor:{ label: 'Horas de Funcionamento',  unidade: 'h',   decimais: 1, alertaMax: null, alertaMin: 0 },
    numero_partidas:          { label: 'Número de Partidas',      unidade: '',    decimais: 0, alertaMax: null, alertaMin: 0 },
    // Gerador — tensões fase-fase
    gerador_tensao_l1l2:      { label: 'Gerador Tensão L1-L2',    unidade: 'V',   decimais: 1, alertaMax: 235,  alertaMin: null },
    gerador_tensao_l2l3:      { label: 'Gerador Tensão L2-L3',    unidade: 'V',   decimais: 1, alertaMax: 235,  alertaMin: null },
    gerador_tensao_l3l1:      { label: 'Gerador Tensão L3-L1',    unidade: 'V',   decimais: 1, alertaMax: 235,  alertaMin: null },
    // Gerador — potência por fase
    gerador_watts_l1:         { label: 'Potência L1',             unidade: 'kW',  decimais: 1, alertaMax: null, alertaMin: 0 },
    gerador_watts_l2:         { label: 'Potência L2',             unidade: 'kW',  decimais: 1, alertaMax: null, alertaMin: 0 },
    gerador_watts_l3:         { label: 'Potência L3',             unidade: 'kW',  decimais: 1, alertaMax: null, alertaMin: 0 },
    // Gerador — VA
    gerador_va_total:         { label: 'Potência Aparente Total', unidade: 'kVA', decimais: 1, alertaMax: null, alertaMin: 0 },
    gerador_va_l1:            { label: 'Potência Aparente L1',    unidade: 'kVA', decimais: 1, alertaMax: null, alertaMin: 0 },
    gerador_va_l2:            { label: 'Potência Aparente L2',    unidade: 'kVA', decimais: 1, alertaMax: null, alertaMin: 0 },
    gerador_va_l3:            { label: 'Potência Aparente L3',    unidade: 'kVA', decimais: 1, alertaMax: null, alertaMin: 0 },
    // Gerador — VAR
    gerador_var_total:        { label: 'Potência Reativa Total',  unidade: 'kVAr',decimais: 1, alertaMax: null, alertaMin: null },
    gerador_var_l1:           { label: 'Potência Reativa L1',     unidade: 'kVAr',decimais: 1, alertaMax: null, alertaMin: null },
    gerador_var_l2:           { label: 'Potência Reativa L2',     unidade: 'kVAr',decimais: 1, alertaMax: null, alertaMin: null },
    gerador_var_l3:           { label: 'Potência Reativa L3',     unidade: 'kVAr',decimais: 1, alertaMax: null, alertaMin: null },
    // Gerador — fator de potência
    gerador_fator_potencia:   { label: 'Fator de Potência',       unidade: '',    decimais: 2, alertaMax: 1,    alertaMin: null },
    gerador_fator_potencia_l1:{ label: 'Fator Potência L1',       unidade: '',    decimais: 2, alertaMax: 1,    alertaMin: null },
    gerador_fator_potencia_l2:{ label: 'Fator Potência L2',       unidade: '',    decimais: 2, alertaMax: 1,    alertaMin: null },
    gerador_fator_potencia_l3:{ label: 'Fator Potência L3',       unidade: '',    decimais: 2, alertaMax: 1,    alertaMin: null },
    // Gerador — energia acumulada
    gerador_energia_kwh:      { label: 'Energia (kWh)',            unidade: 'kWh', decimais: 1, alertaMax: null, alertaMin: 0 },
    gerador_energia_kva:      { label: 'Energia (kVAh)',           unidade: 'kVAh',decimais: 1, alertaMax: null, alertaMin: 0 },
    gerador_energia_kvar:     { label: 'Energia (kVArh)',          unidade: 'kVArh',decimais: 1,alertaMax: null, alertaMin: 0 },
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
