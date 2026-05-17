/**
 * ============================================
 * AMZ APP — PERMISSIONS SERVICE (RBAC)
 * ============================================
 *
 * Controla o acesso a páginas, botões e relatórios
 * por perfil de usuário. O administrador pode
 * customizar as permissões de cada perfil.
 *
 * Estrutura salva no localStorage: amz_permissions
 * ============================================
 */

const PermissionsService = (() => {

  const STORAGE_KEY = 'amz_permissions';

  // ============================================
  // DEFINIÇÃO DE RECURSOS
  // ============================================

  const RESOURCES = {
    pages: {
      dashboard:     { label: 'Dashboard',      icon: '📊' },
      monitoramento: { label: 'Monitoramento',  icon: '📡' },
      relatorios:    { label: 'Relatórios',      icon: '📄' },
      clientes:      { label: 'Clientes',        icon: '👥' },
      geradores:     { label: 'Geradores',       icon: '⚡' },
      configuracoes: { label: 'Configurações',   icon: '⚙️' },
    },
    buttons: {
      gen_ligar:        { label: 'Ligar Gerador',        icon: '🟢', page: 'geradores' },
      gen_desligar:     { label: 'Desligar Gerador',     icon: '🔴', page: 'geradores' },
      gen_auto:         { label: 'Modo Automático',      icon: '🔄', page: 'geradores' },
      gen_novo:         { label: 'Novo Gerador',         icon: '➕', page: 'geradores' },
      gen_editar:       { label: 'Editar Gerador',       icon: '✏️',  page: 'geradores' },
      gen_excluir:      { label: 'Excluir Gerador',      icon: '🗑️',  page: 'geradores' },
      cli_novo:         { label: 'Novo Cliente',         icon: '➕', page: 'clientes'  },
      cli_editar:       { label: 'Editar Cliente',       icon: '✏️',  page: 'clientes'  },
      cli_excluir:      { label: 'Excluir Cliente',      icon: '🗑️',  page: 'clientes'  },
    },
    reports: {
      rel_consumo:      { label: 'Relatório de Consumo',    icon: '⛽' },
      rel_manutencao:   { label: 'Relatório de Manutenção', icon: '🔧' },
      rel_alarmes:      { label: 'Relatório de Alarmes',    icon: '🔔' },
      rel_desempenho:   { label: 'Relatório de Desempenho', icon: '📈' },
      rel_exportar:     { label: 'Exportar Relatórios',     icon: '📤' },
    },
  };

  // ============================================
  // PERMISSÕES PADRÃO POR PERFIL
  // ============================================

  const DEFAULT_PERMISSIONS = {
    administrador: {
      pages:   Object.keys(RESOURCES.pages),
      buttons: Object.keys(RESOURCES.buttons),
      reports: Object.keys(RESOURCES.reports),
    },
    tecnico: {
      pages:   ['dashboard', 'monitoramento', 'geradores', 'relatorios'],
      buttons: ['gen_ligar', 'gen_desligar', 'gen_auto', 'gen_editar'],
      reports: ['rel_consumo', 'rel_manutencao', 'rel_alarmes', 'rel_desempenho'],
    },
    vendedor: {
      pages:   ['dashboard', 'clientes', 'relatorios'],
      buttons: ['cli_novo', 'cli_editar'],
      reports: ['rel_consumo', 'rel_desempenho', 'rel_exportar'],
    },
    cliente: {
      pages:   ['dashboard', 'monitoramento'],
      buttons: [],
      reports: ['rel_consumo', 'rel_desempenho'],
    },
  };

  // ============================================
  // STORAGE
  // ============================================

  function _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function _save(perms) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(perms));
  }

  function getAll() {
    return _load() || JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS));
  }

  function getRolePermissions(role) {
    const all = getAll();
    return all[role] || { pages: [], buttons: [], reports: [] };
  }

  function saveRolePermissions(role, perms) {
    if (role === 'administrador') return; // Admin não pode ser restrito
    const all = getAll();
    all[role] = perms;
    _save(all);
  }

  function resetToDefaults() {
    localStorage.removeItem(STORAGE_KEY);
  }

  // ============================================
  // VERIFICAÇÕES
  // ============================================

  function canAccessPage(role, page) {
    if (role === 'administrador') return true;
    const perms = getRolePermissions(role);
    return (perms.pages || []).includes(page);
  }

  function canUseButton(role, buttonKey) {
    if (role === 'administrador') return true;
    const perms = getRolePermissions(role);
    return (perms.buttons || []).includes(buttonKey);
  }

  function canViewReport(role, reportKey) {
    if (role === 'administrador') return true;
    const perms = getRolePermissions(role);
    return (perms.reports || []).includes(reportKey);
  }

  // ============================================
  // APLICAÇÃO NO DOM
  // ============================================

  /**
   * Aplica as permissões do usuário logado no DOM atual.
   * Oculta botões/links que o usuário não tem acesso.
   * Deve ser chamado após cada renderização de página.
   */
  function applyToDOM() {
    const user = window.AuthService?.getCurrentUser?.();
    if (!user || user.role === 'administrador') return;

    const role = user.role;

    // Botões com data-permission
    document.querySelectorAll('[data-permission]').forEach(el => {
      const key = el.dataset.permission;
      const allowed = canUseButton(role, key) || canViewReport(role, key);
      el.style.display = allowed ? '' : 'none';
    });

    // Links de navegação com data-page
    document.querySelectorAll('[data-page]').forEach(el => {
      const page = el.dataset.page;
      if (!canAccessPage(role, page)) {
        el.style.display = 'none';
      }
    });
  }

  /**
   * Verifica se o usuário atual pode acessar a página corrente.
   * Se não puder, redireciona para o dashboard.
   * @param {string} pageKey — chave da página (ex: 'geradores')
   */
  function guardPage(pageKey) {
    const user = window.AuthService?.getCurrentUser?.();
    if (!user) return;
    if (user.role === 'administrador') return;
    if (!canAccessPage(user.role, pageKey)) {
      window.location.href = '../pages/dashboard.html';
    }
  }

  // ============================================
  // API PÚBLICA
  // ============================================

  return {
    RESOURCES,
    DEFAULT_PERMISSIONS,
    getAll,
    getRolePermissions,
    saveRolePermissions,
    resetToDefaults,
    canAccessPage,
    canUseButton,
    canViewReport,
    applyToDOM,
    guardPage,
  };

})();

window.PermissionsService = PermissionsService;
