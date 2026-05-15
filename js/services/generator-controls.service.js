/**
 * ============================================
 * AMZ APP — GENERATOR CONTROLS SERVICE
 * ============================================
 *
 * Responsabilidade exclusiva:
 *   Gerenciar estado visual e lógica assíncrona
 *   dos botões Ligar / Desligar / Aut de cada card
 *   de gerador na página geradores.html.
 *
 * Arquitetura:
 *   - Estado visual isolado por generator ID
 *   - Chamadas assíncronas via Supabase Edge Functions
 *   - Estrutura preparada para integração DSE em tempo real
 *   - Modular: cada responsabilidade em seção separada
 *
 * Integração futura:
 *   - Supabase Edge Function: /functions/v1/generator-control
 *   - DSE Gateway: via DSEService.sendCommand()
 *   - Realtime: via Supabase channel subscription
 *
 * ============================================
 */

const GeneratorControlsService = (() => {

  // ============================================
  // CONSTANTES
  // ============================================

  /** Estados possíveis do gerador */
  const GENERATOR_STATE = {
    IDLE:    'idle',    // Nenhum comando ativo
    ON:      'on',      // Ligado
    OFF:     'off',     // Desligado
    AUTO:    'auto',    // Modo automático
    PENDING: 'pending', // Aguardando resposta
  };

  /** Mapeamento de estado → aparência visual do botão */
  const STATE_STYLE = {
    [GENERATOR_STATE.ON]:   { bg: 'var(--color-success)', color: '#fff', border: 'var(--color-success)' },
    [GENERATOR_STATE.OFF]:  { bg: 'var(--color-error)',   color: '#fff', border: 'var(--color-error)'   },
    [GENERATOR_STATE.AUTO]: { bg: 'var(--color-warning)', color: '#fff', border: 'var(--color-warning)' },
  };

  // ============================================
  // ESTADO INTERNO (por generator ID)
  // ============================================

  /** @type {Map<string, string>} generatorId → GENERATOR_STATE */
  const _state = new Map();

  /** @type {Map<string, AbortController>} generatorId → AbortController */
  const _pendingRequests = new Map();

  /** @type {Map<string, Function>} Listeners de mudança de estado */
  const _stateListeners = new Map();

  // ============================================
  // MÓDULO: ESTADO VISUAL
  // ============================================

  /**
   * Retorna o estado atual de um gerador.
   * @param {string} generatorId
   * @returns {string} GENERATOR_STATE
   */
  function getState(generatorId) {
    return _state.get(String(generatorId)) || GENERATOR_STATE.IDLE;
  }

  /**
   * Define o estado de um gerador e dispara atualização visual.
   * @param {string} generatorId
   * @param {string} newState — GENERATOR_STATE value
   */
  function _setState(generatorId, newState) {
    const id = String(generatorId);
    const prev = _state.get(id);
    if (prev === newState) return;

    _state.set(id, newState);
    _notifyStateChange(id, newState, prev);
    _applyButtonStyles(id, newState);
  }

  /**
   * Aplica os estilos visuais nos 3 botões do card do gerador.
   * Segue exatamente o padrão do CSS global (border-radius, padding, transition).
   * @param {string} generatorId
   * @param {string} activeState
   */
  function _applyButtonStyles(generatorId, activeState) {
    const btnOn   = document.querySelector(`[data-gen-btn="on"][data-gen-id="${generatorId}"]`);
    const btnOff  = document.querySelector(`[data-gen-btn="off"][data-gen-id="${generatorId}"]`);
    const btnAuto = document.querySelector(`[data-gen-btn="auto"][data-gen-id="${generatorId}"]`);

    if (!btnOn && !btnOff && !btnAuto) return;

    // Reseta todos para o estilo padrão do sistema (btn-secondary)
    [btnOn, btnOff, btnAuto].forEach(btn => {
      if (!btn) return;
      btn.style.background    = '';
      btn.style.color         = '';
      btn.style.borderColor   = '';
      btn.style.boxShadow     = '';
      btn.removeAttribute('aria-pressed');
      btn.disabled = false;
    });

    // Aplica destaque ao botão ativo
    const style = STATE_STYLE[activeState];
    if (!style) return;

    const activeBtn = {
      [GENERATOR_STATE.ON]:   btnOn,
      [GENERATOR_STATE.OFF]:  btnOff,
      [GENERATOR_STATE.AUTO]: btnAuto,
    }[activeState];

    if (!activeBtn) return;

    activeBtn.style.background  = style.bg;
    activeBtn.style.color       = style.color;
    activeBtn.style.borderColor = style.border;
    activeBtn.style.boxShadow   = `0 0 8px ${style.bg}`;
    activeBtn.setAttribute('aria-pressed', 'true');
  }

  /**
   * Coloca todos os botões do card no estado "pendente" (desabilitado + spinner visual).
   * @param {string} generatorId
   * @param {boolean} isPending
   */
  function _setPendingUI(generatorId, isPending) {
    const buttons = document.querySelectorAll(
      `[data-gen-btn][data-gen-id="${generatorId}"]`
    );
    buttons.forEach(btn => {
      btn.disabled = isPending;
      btn.style.opacity = isPending ? '0.6' : '';
      btn.style.cursor  = isPending ? 'wait' : '';
    });
  }

  // ============================================
  // MÓDULO: NOTIFICAÇÕES / LISTENERS
  // ============================================

  /**
   * Registra um listener chamado ao mudar o estado de um gerador.
   * @param {string} generatorId
   * @param {Function} callback — fn(generatorId, newState, prevState)
   */
  function onStateChange(generatorId, callback) {
    _stateListeners.set(String(generatorId), callback);
  }

  function _notifyStateChange(generatorId, newState, prevState) {
    const cb = _stateListeners.get(generatorId);
    if (typeof cb === 'function') cb(generatorId, newState, prevState);
  }

  // ============================================
  // MÓDULO: INTEGRAÇÃO — SUPABASE / DSE
  // ============================================

  /**
   * Obtém os headers de autenticação para a Edge Function.
   * @returns {Object}
   */
  function _getAuthHeaders() {
    const cfg   = window.CONFIG?.SUPABASE || {};
    const token = window.AuthService?.getToken?.() || cfg.ANON_KEY || '';
    return {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey':        cfg.ANON_KEY || '',
    };
  }

  /**
   * Monta a URL da Edge Function.
   * @param {string} functionName
   * @returns {string}
   */
  function _edgeFunctionUrl(functionName) {
    const base = window.CONFIG?.SUPABASE?.URL || '';
    return `${base}/functions/v1/${functionName}`;
  }

  /**
   * Envia comando para a Edge Function do Supabase.
   * Preparado para integração futura — retorna mock enquanto não implantado.
   *
   * @param {string} generatorId
   * @param {string} command — 'on' | 'off' | 'auto'
   * @param {Object} [extra] — dados adicionais do gerador (serial, moduleId)
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async function _callEdgeFunction(generatorId, command, extra = {}) {
    // Cancela requisição anterior do mesmo gerador
    if (_pendingRequests.has(generatorId)) {
      _pendingRequests.get(generatorId).abort();
    }

    const controller = new AbortController();
    _pendingRequests.set(generatorId, controller);

    const url = _edgeFunctionUrl('generator-control');

    try {
      const response = await fetch(url, {
        method:  'POST',
        headers: _getAuthHeaders(),
        signal:  controller.signal,
        body: JSON.stringify({
          generator_id: generatorId,
          command,
          serial:    extra.serial    || '',
          module_id: extra.moduleId  || '',
          timestamp: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`Edge Function retornou ${response.status}: ${errBody}`);
      }

      const data = await response.json();
      return { success: true, data };

    } catch (err) {
      if (err.name === 'AbortError') {
        return { success: false, message: 'Requisição cancelada.' };
      }
      console.warn('[GeneratorControlsService] Edge Function indisponível — modo mock.', err);

      // -------------------------------------------------------
      // MOCK: simula resposta positiva enquanto Edge Function
      // não está implantada. REMOVER quando produção estiver OK.
      // -------------------------------------------------------
      await new Promise(r => setTimeout(r, 600));
      return { success: true, mock: true, message: `Comando "${command}" aceito (mock).` };

    } finally {
      _pendingRequests.delete(generatorId);
    }
  }

  /**
   * Envia comando ao DSEService (se disponível e configurado).
   * @param {string} generatorId
   * @param {string} command
   * @param {Object} generatorData
   */
  function _callDSE(generatorId, command, generatorData = {}) {
    if (!window.CONFIG?.FEATURES?.DSE_INTEGRATION) return;
    if (!window.DSEService?.sendCommand) return;

    window.DSEService.sendCommand({
      generatorId,
      command,
      serial:    generatorData.serial    || '',
      module_id: generatorData.moduleId  || '',
    }).catch(err => {
      console.warn('[GeneratorControlsService] DSE command error:', err);
    });
  }

  // ============================================
  // MÓDULO: AÇÕES PÚBLICAS
  // ============================================

  /**
   * Liga o gerador.
   * @param {string} generatorId
   * @param {Object} generatorData — { serial, moduleId }
   */
  async function turnOn(generatorId, generatorData = {}) {
    const id = String(generatorId);
    if (getState(id) === GENERATOR_STATE.ON) return;

    _setPendingUI(id, true);
    try {
      const result = await _callEdgeFunction(id, 'on', generatorData);

      if (result.success) {
        _setState(id, GENERATOR_STATE.ON);
        _callDSE(id, 'on', generatorData);
        console.info(`[GeneratorControls] Gerador ${id} LIGADO.`, result);
      } else {
        console.warn(`[GeneratorControls] Falha ao ligar gerador ${id}:`, result.message);
      }
    } catch (err) {
      console.error('[GeneratorControls] Erro inesperado em turnOn:', err);
    } finally {
      _setPendingUI(id, false);
    }
  }

  /**
   * Desliga o gerador.
   * @param {string} generatorId
   * @param {Object} generatorData — { serial, moduleId }
   */
  async function turnOff(generatorId, generatorData = {}) {
    const id = String(generatorId);
    if (getState(id) === GENERATOR_STATE.OFF) return;

    _setPendingUI(id, true);
    try {
      const result = await _callEdgeFunction(id, 'off', generatorData);

      if (result.success) {
        _setState(id, GENERATOR_STATE.OFF);
        _callDSE(id, 'off', generatorData);
        console.info(`[GeneratorControls] Gerador ${id} DESLIGADO.`, result);
      } else {
        console.warn(`[GeneratorControls] Falha ao desligar gerador ${id}:`, result.message);
      }
    } catch (err) {
      console.error('[GeneratorControls] Erro inesperado em turnOff:', err);
    } finally {
      _setPendingUI(id, false);
    }
  }

  /**
   * Ativa o modo automático do gerador.
   * @param {string} generatorId
   * @param {Object} generatorData — { serial, moduleId }
   */
  async function setAuto(generatorId, generatorData = {}) {
    const id = String(generatorId);
    if (getState(id) === GENERATOR_STATE.AUTO) {
      // Toggle: se já em auto, volta para idle
      _setState(id, GENERATOR_STATE.IDLE);
      return;
    }

    _setPendingUI(id, true);
    try {
      const result = await _callEdgeFunction(id, 'auto', generatorData);

      if (result.success) {
        _setState(id, GENERATOR_STATE.AUTO);
        _callDSE(id, 'auto', generatorData);
        console.info(`[GeneratorControls] Gerador ${id} em modo AUTO.`, result);
      } else {
        console.warn(`[GeneratorControls] Falha ao ativar modo auto do gerador ${id}:`, result.message);
      }
    } catch (err) {
      console.error('[GeneratorControls] Erro inesperado em setAuto:', err);
    } finally {
      _setPendingUI(id, false);
    }
  }

  // ============================================
  // MÓDULO: EVENTOS DE CLIQUE
  // ============================================

  /**
   * Registra os handlers de clique nos botões de um card.
   * Deve ser chamado após o card ser renderizado no DOM.
   *
   * @param {string} generatorId
   * @param {Object} generatorData — { serial, moduleId }
   */
  function bindCardButtons(generatorId, generatorData = {}) {
    const id = String(generatorId);

    const btnOn   = document.querySelector(`[data-gen-btn="on"][data-gen-id="${id}"]`);
    const btnOff  = document.querySelector(`[data-gen-btn="off"][data-gen-id="${id}"]`);
    const btnAuto = document.querySelector(`[data-gen-btn="auto"][data-gen-id="${id}"]`);

    if (btnOn) {
      btnOn.addEventListener('click', (e) => {
        e.stopPropagation();
        turnOn(id, generatorData);
      });
    }

    if (btnOff) {
      btnOff.addEventListener('click', (e) => {
        e.stopPropagation();
        turnOff(id, generatorData);
      });
    }

    if (btnAuto) {
      btnAuto.addEventListener('click', (e) => {
        e.stopPropagation();
        setAuto(id, generatorData);
      });
    }

    // Restaura estado visual se já existia (ex: re-render após busca)
    const currentState = getState(id);
    if (currentState !== GENERATOR_STATE.IDLE) {
      _applyButtonStyles(id, currentState);
    }
  }

  /**
   * Registra botões para TODOS os geradores renderizados.
   * Conveniência para chamar após render().
   * @param {Array} generators — lista de objetos gerador
   */
  function bindAll(generators = []) {
    generators.forEach(g => {
      if (!g.id) return;
      bindCardButtons(String(g.id), {
        serial:   g.serial    || '',
        moduleId: g.module_id || '',
      });
    });
  }

  // ============================================
  // MÓDULO: REALTIME (PREPARADO — Supabase)
  // ============================================

  /**
   * Placeholder para assinatura Supabase Realtime.
   * Quando a Edge Function publicar eventos de estado via broadcast
   * ou postgres_changes, conectar aqui.
   *
   * Exemplo de uso futuro:
   *   GeneratorControlsService.subscribeRealtime(supabaseClient);
   *
   * @param {Object} supabaseClient — instância do @supabase/supabase-js
   */
  function subscribeRealtime(supabaseClient) {
    if (!supabaseClient) return;

    // TODO: implementar quando a tabela `generator_states` existir no Supabase
    // supabaseClient
    //   .channel('generator-states')
    //   .on('postgres_changes', { event: '*', schema: 'public', table: 'generator_states' },
    //     (payload) => {
    //       const { id, state } = payload.new;
    //       _setState(String(id), state);
    //     })
    //   .subscribe();

    console.info('[GeneratorControls] subscribeRealtime: pronto para conexão futura.');
  }

  // ============================================
  // LIMPEZA
  // ============================================

  /** Cancela todas as requisições pendentes e limpa estado. */
  function destroy() {
    _pendingRequests.forEach(controller => controller.abort());
    _pendingRequests.clear();
    _stateListeners.clear();
  }

  // ============================================
  // API PÚBLICA
  // ============================================
  return {
    GENERATOR_STATE,
    getState,
    turnOn,
    turnOff,
    setAuto,
    bindCardButtons,
    bindAll,
    onStateChange,
    subscribeRealtime,
    destroy,
  };

})();

// Exporta como global para uso nas páginas
window.GeneratorControlsService = GeneratorControlsService;
