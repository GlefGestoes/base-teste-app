/**
 * ============================================
 * AMZ APP - ENTRY POINT
 * Inicialização da aplicação
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
   * Inicializa Service Worker
   */
	initServiceWorker() {
	  if ('serviceWorker' in navigator) {
		window.addEventListener("load", () => {
		  navigator.serviceWorker.register("./service-worker.js")
			.then(reg => console.log("SW registrado:", reg.scope))
			.catch(err => console.error("SW erro:", err));
		});
	  }
	},

  /**
   * Verifica autenticação
   */
	checkAuth() {
	  const path = window.location.pathname;
	  const file = path.split("/").pop();
	
	  const isAuthPage = file === "" || file === "index.html";
	
	  if (!isAuthPage && !window.AuthService?.isAuthenticated()) {
	    window.AuthService?.redirectToLogin();
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
