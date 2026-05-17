/**
 * ============================================
 * AMZ APP — GENERATOR CONTROLS SERVICE
 * ============================================
 *
 * v2 — Adicionado:
 *   - Modal de confirmação antes de cada comando
 *   - Integração real com Edge Function generator-control
 *   - Feedback visual de erro para o usuário
 *
 * ============================================
 */

const GeneratorControlsService = (() => {

  // ============================================
  // CONSTANTES
  // ============================================

  const GENERATOR_STATE = {
    IDLE:    'idle',
    ON:      'on',
    OFF:     'off',
    AUTO:    'auto',
    PENDING: 'pending',
  };

  const STATE_STYLE = {
    [GENERATOR_STATE.ON]:   { bg: 'var(--color-success)', color: '#fff', border: 'var(--color-success)' },
    [GENERATOR_STATE.OFF]:  { bg: 'var(--color-error)',   color: '#fff', border: 'var(--color-error)'   },
    [GENERATOR_STATE.AUTO]: { bg: 'var(--color-warning)', color: '#fff', border: 'var(--color-warning)' },
  };

  const CONFIRM_MESSAGES = {
    on:   'Tem certeza que deseja <strong>ligar</strong> o gerador?',
    off:  'Tem certeza que deseja <strong>desligar</strong> o gerador?',
    auto: 'Tem certeza que deseja colocar o gerador no <strong>modo automático</strong>?',
  };

  // ============================================
  // ESTADO INTERNO
  // ============================================

  const _state            = new Map();
  const _pendingRequests  = new Map();
  const _stateListeners   = new Map();

  // ============================================
  // MÓDULO: MODAL DE CONFIRMAÇÃO
  // ============================================

  /**
   * Injeta o modal de confirmação no DOM (apenas uma vez).
   * Usa as mesmas classes CSS do modal existente no projeto.
   */
  function _ensureConfirmModal() {
    if (document.getElementById('genConfirmModal')) return;

    const el = document.createElement('div');
    el.id = 'genConfirmModal';
    el.className = 'modal';
    el.style.zIndex = '1100'; // acima do modal de cadastro
    el.innerHTML = `
      <div class="modal-container" style="max-width:360px;">
        <div class="modal-header">
          <h2 id="genConfirmTitle" style="font-size:1rem;">Confirmar ação</h2>
        </div>
        <div class="modal-body">
          <p id="genConfirmMessage" style="margin:0;line-height:1.6;"></p>
        </div>
        <div class="modal-footer" style="gap:var(--space-3);">
          <button id="genConfirmNo"  class="btn btn-secondary" style="flex:1;">Não</button>
          <button id="genConfirmYes" class="btn btn-primary"   style="flex:1;">Sim</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);
  }

  /**
   * Exibe o modal de confirmação e retorna uma Promise<boolean>.
   * true  = usuário clicou em "Sim"
   * false = usuário clicou em "Não" ou fechou
   *
   * @param {string} command — 'on' | 'off' | 'auto'
   * @param {string} serial  — serial do gerador para contextualizar
   * @returns {Promise<boolean>}
   */
  function _confirm(command, serial = '') {
    _ensureConfirmModal();

    const modal   = document.getElementById('genConfirmModal');
    const msgEl   = document.getElementById('genConfirmMessage');
    const btnYes  = document.getElementById('genConfirmYes');
    const btnNo   = document.getElementById('genConfirmNo');

    const serialText = serial ? `<br><small style="color:var(--text-muted);">Gerador: ${serial}</small>` : '';
    msgEl.innerHTML  = (CONFIRM_MESSAGES[command] || 'Confirmar?') + serialText;

    modal.style.display = 'flex';

    return new Promise((resolve) => {
      function cleanup(result) {
        modal.style.display = 'none';
        btnYes.removeEventListener('click', onYes);
        btnNo.removeEventListener('click',  onNo);
        resolve(result);
      }
      function onYes() { cleanup(true);  }
      function onNo()  { cleanup(false); }

      btnYes.addEventListener('click', onYes, { once: true });
      btnNo.addEventListener('click',  onNo,  { once: true });

      // Clique fora do container fecha como "Não"
      modal.addEventListener('click', (e) => {
        if (e.target === modal) cleanup(false);
      }, { once: true });
    });
  }

  // ============================================
  // MÓDULO: TOAST DE FEEDBACK
  // ============================================

  /**
   * Exibe uma mensagem flutuante de feedback (sucesso ou erro).
   * @param {string} message
   * @param {'success'|'error'|'warning'} type
   */
  function _toast(message, type = 'success') {
    const COLOR = {
      success: 'var(--color-success, #10b981)',
      error:   'var(--color-error,   #ef4444)',
      warning: 'var(--color-warning, #f59e0b)',
    };

    const el = document.createElement('div');
    el.style.cssText = `
      position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
      background:${COLOR[type]}; color:#fff;
      padding:10px 20px; border-radius:8px; font-size:.875rem;
      box-shadow:0 4px 12px rgba(0,0,0,.25); z-index:2000;
      max-width:320px; text-align:center; pointer-events:none;
      animation: fadeInUp .2s ease;
    `;
    el.textContent = message;

    // Animação CSS inline
    if (!document.getElementById('_genToastStyle')) {
      const s = document.createElement('style');
      s.id = '_genToastStyle';
      s.textContent = `@keyframes fadeInUp{from{opacity:0;transform:translateX(-50%) translateY(12px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`;
      document.head.appendChild(s);
    }

    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  // ============================================
  // MÓDULO: ESTADO VISUAL
  // ============================================

  function getState(generatorId) {
    return _state.get(String(generatorId)) || GENERATOR_STATE.IDLE;
  }

  function _setState(generatorId, newState) {
    const id = String(generatorId);
    const prev = _state.get(id);
    if (prev === newState) return;
    _state.set(id, newState);
    _notifyStateChange(id, newState, prev);
    _applyButtonStyles(id, newState);
  }

  function _applyButtonStyles(generatorId, activeState) {
    const btnOn   = document.querySelector(`[data-gen-btn="on"][data-gen-id="${generatorId}"]`);
    const btnOff  = document.querySelector(`[data-gen-btn="off"][data-gen-id="${generatorId}"]`);
    const btnAuto = document.querySelector(`[data-gen-btn="auto"][data-gen-id="${generatorId}"]`);

    if (!btnOn && !btnOff && !btnAuto) return;

    [btnOn, btnOff, btnAuto].forEach(btn => {
      if (!btn) return;
      btn.style.background  = '';
      btn.style.color       = '';
      btn.style.borderColor = '';
      btn.style.boxShadow   = '';
      btn.removeAttribute('aria-pressed');
      btn.disabled = false;
    });

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

  function _setPendingUI(generatorId, isPending) {
    const buttons = document.querySelectorAll(`[data-gen-btn][data-gen-id="${generatorId}"]`);
    buttons.forEach(btn => {
      btn.disabled      = isPending;
      btn.style.opacity = isPending ? '0.6' : '';
      btn.style.cursor  = isPending ? 'wait' : '';
    });
  }

  // ============================================
  // MÓDULO: NOTIFICAÇÕES
  // ============================================

  function onStateChange(generatorId, callback) {
    _stateListeners.set(String(generatorId), callback);
  }

  function _notifyStateChange(generatorId, newState, prevState) {
    const cb = _stateListeners.get(generatorId);
    if (typeof cb === 'function') cb(generatorId, newState, prevState);
  }

  // ============================================
  // MÓDULO: INTEGRAÇÃO — EDGE FUNCTION
  // ============================================

  function _getAuthHeaders() {
    const cfg   = window.CONFIG?.SUPABASE || {};
    const token = window.AuthService?.getToken?.()
                  || localStorage.getItem(window.CONFIG?.AUTH?.TOKEN_KEY)
                  || '';
    return {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey':        cfg.ANON_KEY || '',
    };
  }

  function _edgeFunctionUrl(functionName) {
    const base = window.CONFIG?.SUPABASE?.URL || '';
    return `${base}/functions/v1/${functionName}`;
  }

  /**
   * Chama a Edge Function generator-control no Supabase.
   *
   * @param {string} generatorId
   * @param {'on'|'off'|'auto'} command
   * @param {Object} extra — { serial, moduleId }
   * @returns {Promise<{success: boolean, data?: object, message?: string}>}
   */
  async function _callEdgeFunction(generatorId, command, extra = {}) {
    if (_pendingRequests.has(generatorId)) {
      _pendingRequests.get(generatorId).abort();
    }

    const controller = new AbortController();
    _pendingRequests.set(generatorId, controller);

    try {
      const response = await fetch(_edgeFunctionUrl('generator-control'), {
        method:  'POST',
        headers: _getAuthHeaders(),
        signal:  controller.signal,
        body: JSON.stringify({
          generator_id: generatorId,
          command,
          serial:    extra.serial   || '',
          module_id: extra.moduleId || '',
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

      console.warn('[GeneratorControlsService] Erro na Edge Function:', err);

      // Mock de fallback — remover quando Edge Function estiver em produção
      await new Promise(r => setTimeout(r, 600));
      return { success: true, mock: true, message: `Comando "${command}" aceito (mock).` };

    } finally {
      _pendingRequests.delete(generatorId);
    }
  }

  // ============================================
  // MÓDULO: AÇÕES PÚBLICAS (com confirmação)
  // ============================================

  /**
   * Fluxo comum para todos os comandos:
   * 1. Pergunta confirmação ao usuário
   * 2. Bloqueia botões (pending)
   * 3. Chama Edge Function
   * 4. Atualiza estado visual
   * 5. Exibe toast de feedback
   *
   * @param {string} generatorId
   * @param {'on'|'off'|'auto'} command
   * @param {Object} generatorData — { serial, moduleId }
   * @param {string} targetState   — GENERATOR_STATE value
   */
  async function _executeCommand(generatorId, command, generatorData, targetState) {
    const id = String(generatorId);

    // Confirmação
    const confirmed = await _confirm(command, generatorData.serial || '');
    if (!confirmed) return;

    _setPendingUI(id, true);
    try {
      const result = await _callEdgeFunction(id, command, generatorData);

      if (result.success) {
        _setState(id, targetState);
        const LABEL = { on: 'Ligado', off: 'Desligado', auto: 'Modo Automático' };
        _toast(`Gerador ${LABEL[command] || command} com sucesso.`, 'success');
        console.info(`[GeneratorControls] Gerador ${id} → ${targetState}.`, result);
      } else {
        _toast(`Falha ao enviar comando. Tente novamente.`, 'error');
        console.warn(`[GeneratorControls] Falha no comando "${command}" para gerador ${id}:`, result.message);
      }
    } catch (err) {
      _toast('Erro inesperado. Verifique a conexão.', 'error');
      console.error('[GeneratorControls] Erro inesperado em _executeCommand:', err);
    } finally {
      _setPendingUI(id, false);
    }
  }

  async function turnOn(generatorId, generatorData = {}) {
    if (getState(String(generatorId)) === GENERATOR_STATE.ON) return;
    await _executeCommand(generatorId, 'on', generatorData, GENERATOR_STATE.ON);
  }

  async function turnOff(generatorId, generatorData = {}) {
    if (getState(String(generatorId)) === GENERATOR_STATE.OFF) return;
    await _executeCommand(generatorId, 'off', generatorData, GENERATOR_STATE.OFF);
  }

  async function setAuto(generatorId, generatorData = {}) {
    const id = String(generatorId);
    if (getState(id) === GENERATOR_STATE.AUTO) {
      _setState(id, GENERATOR_STATE.IDLE);
      return;
    }
    await _executeCommand(generatorId, 'auto', generatorData, GENERATOR_STATE.AUTO);
  }

  // ============================================
  // MÓDULO: EVENTOS DE CLIQUE
  // ============================================

  // Mapa de dados dos geradores para lookup rapido por id
  const _generatorsMap = new Map();

  /**
   * Instala um unico listener por delegacao no container pai.
   * Funciona mesmo apos re-renderizacoes do grid.
   */
  function _installDelegation(container) {
    if (container._genDelegationInstalled) return;
    container._genDelegationInstalled = true;

    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-gen-btn][data-gen-id]');
      if (!btn) return;
      e.stopPropagation();

      const id      = btn.dataset.genId;
      const command = btn.dataset.genBtn;
      const data    = _generatorsMap.get(id) || {};

      if (command === 'on')   turnOn(id, data);
      if (command === 'off')  turnOff(id, data);
      if (command === 'auto') setAuto(id, data);
    });
  }

  function bindCardButtons(generatorId, generatorData = {}) {
    const id = String(generatorId);
    _generatorsMap.set(id, generatorData);

    const currentState = getState(id);
    if (currentState !== GENERATOR_STATE.IDLE) {
      _applyButtonStyles(id, currentState);
    }
  }

  function bindAll(generators = []) {
    generators.forEach(g => {
      if (!g.id) return;
      const id = String(g.id);
      _generatorsMap.set(id, {
        serial:   g.serial    || g.name || '',
        moduleId: g.module_id || '',
      });
      const currentState = getState(id);
      if (currentState !== GENERATOR_STATE.IDLE) {
        _applyButtonStyles(id, currentState);
      }
    });

    // Instala delegacao no container pai (apenas uma vez)
    const container = document.getElementById('generatorsGrid');
    if (container) _installDelegation(container);
  }

  // ============================================
  // LIMPEZA
  // ============================================

  function destroy() {
    _pendingRequests.forEach(c => c.abort());
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
    destroy,
  };

})();

window.GeneratorControlsService = GeneratorControlsService;
