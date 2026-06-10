/**
 * ============================================
 * AMZ APP - APP.JS (Entry Point)
 * ============================================
 */
 
const App = {
  /**
   * Inicializa aplicação
   */
  init() {
    this.logMode();
    this.initServiceWorker();
    this.checkAuth();
  },
 
  /**
   * Log do modo atual
   */
  logMode() {
    if (window.CONFIG?.isDev()) {
      console.log('%c AMZ App - Modo Desenvolvimento ', 
        'background: #FF5E00; color: #fff; padding: 4px 8px; border-radius: 4px; font-weight: bold;');
      console.log('✅ Dados mockados ativos - não requer backend');
      console.log('📋 Credenciais de teste:');
      console.log('   admin@amz.app / admin123');
      console.log('   vendedor@amz.app / vendedor123');
      console.log('   tecnico@amz.app / tecnico123');
      console.log('   cliente@amz.app / cliente123');
    } else {
      console.log('%c AMZ App - Modo Produção ', 
        'background: #10B981; color: #fff; padding: 4px 8px; border-radius: 4px; font-weight: bold;');
    }
  },
 
  /**
   * Inicializa Service Worker com path fixo baseado no repositório GitHub Pages
   * Correção: path dinâmico causava 404 quando a URL não continha nome de arquivo
   * (ex: /base-teste-app/ → pathParts.pop() removia o subdiretório inteiro,
   *  fazendo o SW ser registrado em '/' onde o arquivo não existe)
   */
  initServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener("load", () => {
        // Detecta o basePath de forma segura a partir da tag <base> ou da URL
        // Sempre aponta para a raiz do app, nunca para a raiz do domínio
        const getBasePath = () => {
          // 1. Tenta usar a tag <base href="..."> se existir
          const baseTag = document.querySelector('base[href]');
          if (baseTag) {
            const href = baseTag.getAttribute('href');
            if (href && href !== '/') return href.endsWith('/') ? href : href + '/';
          }

          // 2. Caminha pela pathname removendo apenas o arquivo final (se houver)
          const parts = window.location.pathname.split('/').filter(Boolean);
          const lastPart = parts[parts.length - 1] || '';
          // Remove o arquivo se tiver extensão (ex: index.html, dashboard.html)
          if (lastPart.includes('.')) parts.pop();
          // Remove subdiretórios conhecidos do app (pages, js, css, assets)
          const knownSubdirs = ['pages', 'js', 'css', 'assets'];
          if (knownSubdirs.includes(parts[parts.length - 1])) parts.pop();

          return parts.length > 0 ? '/' + parts.join('/') + '/' : '/';
        };

        const basePath = getBasePath();
        const swPath   = basePath + 'service-worker.js';

        console.log('[SW] Registrando em:', swPath, '| scope:', basePath);

        navigator.serviceWorker.register(swPath, { scope: basePath })
          .then(reg => {
            console.log("[SW] Registrado:", reg.scope);
            reg.addEventListener('updatefound', () => {
              const newWorker = reg.installing;
              newWorker?.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  console.log('[SW] Nova versão disponível. Recarregue para atualizar.');
                }
              });
            });
          })
          .catch(err => console.error("[SW] Erro no registro:", err));
      });
    } else {
      console.warn('[SW] Service Worker não suportado neste navegador');
    }
  },
  
   /**
   *  CORRIGIDO: Verifica autenticação com paths dinâmicos
   */
  checkAuth() {
    const path = window.location.pathname;
    const file = path.split("/").pop() || 'index.html';
    
    //  Detecta se está na raiz ou em subpasta
    const isAuthPage = file === '' || file === 'index.html' || file === 'cadastro.html';
    
    if (!isAuthPage && !window.AuthService?.isAuthenticated()) {
      //  Redireciona para login relativo ao path atual
      const basePath = window.location.pathname.replace(/\/[^\/]*$/, '') || '/';
      const loginPath = basePath.endsWith('/') ? basePath : basePath + '/';
      window.location.href = loginPath + 'index.html';
      return;
    }
 
    if (isAuthPage && window.AuthService?.isAuthenticated()) {
      window.AuthService?.redirectAfterLogin();
    }
  },
 
  /**
   * Verifica se o usuário tem perfil pendente e abre modal de completar cadastro.
   * Ativado pela query string ?complete_profile=1 ou pelo flag isPending no user.
   */
  checkPendingProfile() {
    const user = window.AuthService?.getCurrentUser?.();
    if (!user) return;
 
    const params = new URLSearchParams(window.location.search);
    const hasFlag = params.get('complete_profile') === '1';
 
    if (hasFlag || user.isPending) {
      this._openCompleteProfileModal(user);
    }
  },
 
  /**
   * Cria e abre o modal de completar perfil.
   * Bloqueia navegação até que os dados sejam salvos.
   */
  _openCompleteProfileModal(user) {
    if (document.getElementById('completeProfileModal')) return;
 
    const roles = [
      { value: 'cliente',       label: 'Cliente'       },
      { value: 'vendedor',      label: 'Vendedor'      },
      { value: 'tecnico',       label: 'Técnico'       },
      { value: 'administrador', label: 'Administrador' },
    ];
 
    const roleOptions = roles.map(r =>
      `<option value="${r.value}" ${user.role === r.value ? 'selected' : ''}>${r.label}</option>`
    ).join('');
 
    const el = document.createElement('div');
    el.id = 'completeProfileModal';
    el.className = 'modal';
    el.style.cssText = 'display:flex; z-index:2000;';
    el.innerHTML = `
      <div class="modal-container" style="max-width:440px;">
        <div class="modal-header">
          <h2 style="font-size:1.1rem;">👋 Complete seu cadastro</h2>
        </div>
        <div class="modal-body">
          <p style="margin:0 0 var(--space-4);color:var(--text-secondary);font-size:.9rem;line-height:1.6;">
            Para acessar o sistema, preencha as informações abaixo.
          </p>
          <div class="form-group">
            <label class="form-label">Nome completo *</label>
            <input type="text" id="cpName" class="form-input" value="${user.name || ''}" placeholder="Seu nome completo">
            <span id="cpNameErr" class="form-error" style="display:none;"></span>
          </div>
          <div class="form-group">
            <label class="form-label">Telefone</label>
            <input type="tel" id="cpPhone" class="form-input" value="${user.phone || ''}" placeholder="(00) 00000-0000">
          </div>
          <div class="form-group">
            <label class="form-label">Empresa / Organização</label>
            <input type="text" id="cpCompany" class="form-input" value="${user.company || ''}" placeholder="Nome da empresa">
          </div>
          <div class="form-group">
            <label class="form-label">Perfil de acesso *</label>
            <select id="cpRole" class="form-select">${roleOptions}</select>
          </div>
        </div>
        <div class="modal-footer">
          <button id="cpSaveBtn" class="btn btn-primary" style="flex:1;">Salvar e Acessar</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);
 
    document.getElementById('cpSaveBtn').addEventListener('click', async () => {
      const name = document.getElementById('cpName').value.trim();
      if (!name || name.length < 2) {
        const err = document.getElementById('cpNameErr');
        err.textContent = 'Informe seu nome completo';
        err.style.display = 'flex';
        return;
      }
 
      const updatedUser = window.AuthService.updateUserLocal({
        name,
        phone:   document.getElementById('cpPhone').value.trim(),
        company: document.getElementById('cpCompany').value.trim(),
        role:    document.getElementById('cpRole').value,
        isPending: false,
      });
 
      // Tenta salvar no Supabase (produção)
      if (window.CONFIG?.isProd?.() && window.ApiService) {
        const token = window.AuthService.getToken();
        const headers = {
          'Content-Type':  'application/json',
          'apikey':        window.CONFIG.SUPABASE.ANON_KEY,
          'Authorization': `Bearer ${token}`,
        };
 
        // 1. Atualiza user_metadata em auth.users
        try {
          await fetch(`${window.CONFIG.SUPABASE.URL}/auth/v1/user`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({
              data: {
                name:      updatedUser.name,
                phone:     updatedUser.phone,
                company:   updatedUser.company,
                role:      updatedUser.role,
                isPending: false,
              }
            }),
          });
        } catch(err) {
          console.warn('[App] Erro ao atualizar auth.users:', err);
        }
 
        // 2. Atualiza (ou insere) em public.users — mantém sincronizado com auth
        try {
          await fetch(`${window.CONFIG.SUPABASE.URL}/rest/v1/users?id=eq.${updatedUser.id}`, {
            method: 'PATCH',
            headers: { ...headers, 'Prefer': 'return=minimal' },
            body: JSON.stringify({
              name:    updatedUser.name,
              role:    updatedUser.role,
            }),
          });
        } catch(err) {
          console.warn('[App] Erro ao atualizar public.users:', err);
        }
      }
 
      el.remove();
 
      // Remove flag da URL sem recarregar
      const url = new URL(window.location.href);
      url.searchParams.delete('complete_profile');
      window.history.replaceState({}, '', url.toString());
 
      // Aplica as permissões do novo role
      window.PermissionsService?.applyToDOM?.();
    });
  },
 
  /**
   * Aplica as permissões do usuário logado na página atual.
   */
  applyPermissions() {
    if (window.PermissionsService) {
      // Pequeno delay para garantir que o DOM esteja montado
      setTimeout(() => window.PermissionsService.applyToDOM(), 150);
    }
  },
 
  /**
   * Mostra badge de modo dev
   */
  showDevBadge() {
    if (!window.CONFIG?.isDev()) return;
    
    const badge = document.createElement('div');
    badge.className = 'dev-badge';
    badge.textContent = 'MODO TESTE';
    badge.style.cssText = `
      position: fixed;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      background: #FF5E00;
      color: white;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: bold;
      z-index: 9999;
      animation: pulse 2s infinite;
    `;
    (document.body || document.documentElement).appendChild(badge);
  }
};
 
// Inicializa quando DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
  App.init();
  App.showDevBadge();
  App.checkPendingProfile();
  App.applyPermissions();
});
 
// Exporta globalmente
window.App = App;
