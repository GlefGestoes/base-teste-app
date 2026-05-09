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
   * Inicializa Service Worker com path dinâmico
   */
  initServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener("load", () => {
        const pathParts = window.location.pathname.split('/').filter(Boolean);
        pathParts.pop();
        const knownSubdirs = ['pages', 'js', 'css', 'assets'];
        if (knownSubdirs.includes(pathParts[pathParts.length - 1])) {
          pathParts.pop();
        }
        const basePath = pathParts.length > 0 ? '/' + pathParts.join('/') + '/' : '/';
        const swPath = basePath + 'service-worker.js';

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
});

// Exporta globalmente
window.App = App;
