/**
 * ============================================
 * AUTH SERVICE
 * Gerenciamento de autenticação
 * ============================================
 * 
 * Funciona em ambos os modos (dev/prod) automaticamente
 */

const AuthService = {
  _currentUser: null,

  /**
   * Obtém o serviço correto baseado no modo
   */
  getService() {
    return window.CONFIG?.isDev() ? window.MockService : window.ApiService;
  },

  /**
   * Realiza login
   */
  async login(email, password) {
    try {
      const service = this.getService();

      // Supabase Edge Functions podem demorar no cold start (plano gratuito).
      // Exibe aviso ao usuário se a resposta demorar mais de 5 segundos.
      let slowTimer = null;
      const slowWarning = () => {
        const el = document.getElementById('loginSlowMsg');
        if (el) {
          el.textContent = '⏳ O servidor está iniciando, aguarde alguns segundos...';
          el.style.display = 'block';
        }
      };
      slowTimer = setTimeout(slowWarning, 5000);

      const response = await service.login(email, password);
      clearTimeout(slowTimer);
      const el = document.getElementById('loginSlowMsg');
      if (el) el.style.display = 'none';

      if (response.success && response.data) {
        const { user, token, refreshToken, expiresIn } = response.data;
        
        this.saveTokens(token, refreshToken);
        this.saveUser(user);
        this._currentUser = user;
        
        return { success: true, user };
      }

      return { success: false, error: response.error };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  /**
   * Redireciona o usuário após login considerando isPending
   * Se perfil incompleto → abre modal de completar perfil na página atual
   * Se completo → vai ao dashboard
   */
  redirectAfterLoginWithCheck() {
    const user = this.getCurrentUser();
    if (!user) { this.redirectToLogin(); return; }

    if (user.isPending) {
      // Vai para o dashboard mas com flag para abrir modal
      window.location.href = this._buildUrl('../pages/dashboard.html', { complete_profile: '1' });
    } else {
      this.redirectAfterLogin();
    }
  },

  _buildUrl(base, params = {}) {
    const url = new URL(base, window.location.href);
    Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
    return url.toString();
  },
  
	  /**
	 * Registra novo usuário
	 */
	async register(user) {
	  try {
		const service = this.getService();
		const response = await service.register(user);

		if (response.success) {
		  return { success: true, data: response.data };
		}

		return { success: false, error: response.error };
	  } catch (error) {
		return { success: false, error: error.message };
	  }
	},

  /**
   * Realiza logout
   */
  async logout() {
    try {
      if (window.CONFIG?.isProd()) {
        await window.ApiService.logout().catch(() => {});
      }
    } finally {
      this.clearSession();
    }
    return { success: true };
  },

  /**
   * Verifica se usuário está autenticado
   */
  isAuthenticated() {
    const token = this.getToken();
    if (!token) return false;

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return Date.now() < payload.exp * 1000;
    } catch {
      return false;
    }
  },

  /**
   * Obtém usuário atual
   */
  getCurrentUser() {
    if (this._currentUser) return this._currentUser;
    
    const userJson = localStorage.getItem(window.CONFIG?.AUTH?.USER_KEY);
    if (userJson) {
      try {
        this._currentUser = JSON.parse(userJson);
        return this._currentUser;
      } catch {
        return null;
      }
    }
    return null;
  },

  /**
   * Obtém papel (role) do usuário
   */
  getRole() {
    const user = this.getCurrentUser();
    return user?.role || null;
  },

  /**
   * Verifica permissão (RBAC)
   */
  hasPermission(permission) {
    const user = this.getCurrentUser();
    if (!user) return false;

    // Admin tem todas as permissões
    if (user.role === 'administrador') return true;

    const permissions = {
      cliente: ['view_own', 'edit_own'],
      vendedor: ['view_clients', 'edit_clients', 'create_proposals'],
      tecnico: ['view_generators', 'edit_generators', 'execute_maintenance'],
      supervisor: ['view_all', 'manage_team', 'approve_orders']
    };

    const userPermissions = permissions[user.role] || [];
    
    if (Array.isArray(permission)) {
      return permission.some(p => userPermissions.includes(p));
    }
    
    return userPermissions.includes(permission) || userPermissions.includes('*');
  },

  /**
   * Verifica se tem determinado papel
   */
  hasRole(roles) {
    const role = this.getRole();
    if (!role) return false;

    if (Array.isArray(roles)) {
      return roles.includes(role);
    }
    
    return role === roles;
  },

  /**
   * Redireciona para login
   */
  redirectToLogin() {
    this.clearSession();
    window.location.href = "/base-teste-app/";
  },

  /**
   * Redireciona após login
   */
  redirectAfterLogin() {
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get('redirect') || '/base-teste-app/pages/dashboard.html';
    window.location.href = redirect;
  },
  
   /**
   * Simulação de novo usuário e login
   */
   
   /**
   * Atualiza os dados do usuário logado localmente
   */
  updateUserLocal(newData) {
    const user = this.getCurrentUser();
    const updatedUser = { ...user, ...newData, isPending: false };
    this.saveUser(updatedUser);
    this._currentUser = updatedUser;
    return updatedUser;
  },

  /**
   * Verifica se o usuário logado ainda tem pendências de cadastro
   */
  isProfilePending() {
    const user = this.getCurrentUser();
    // Consideramos pendente se tiver a flag 'isPending' que criaremos no cadastro
    return user && user.isPending === true;
  },

  // ==========================================
  // STORAGE
  // ==========================================

  saveTokens(token, refreshToken) {
    localStorage.setItem(window.CONFIG?.AUTH?.TOKEN_KEY, token);
    localStorage.setItem(window.CONFIG?.AUTH?.REFRESH_TOKEN_KEY, refreshToken);
  },

  saveUser(user) {
    localStorage.setItem(window.CONFIG?.AUTH?.USER_KEY, JSON.stringify(user));
  },

  getToken() {
    return localStorage.getItem(window.CONFIG?.AUTH?.TOKEN_KEY);
  },

  getRefreshToken() {
    return localStorage.getItem(window.CONFIG?.AUTH?.REFRESH_TOKEN_KEY);
  },

	clearSession() {
	  localStorage.removeItem(window.CONFIG?.AUTH?.TOKEN_KEY);
	  localStorage.removeItem(window.CONFIG?.AUTH?.REFRESH_TOKEN_KEY);
	  localStorage.removeItem(window.CONFIG?.AUTH?.USER_KEY);
	  localStorage.removeItem('amz_token_expiry');
	  this._currentUser = null;
	}
};

// Exporta globalmente
window.AuthService = AuthService;



