/**
 * ============================================
 * API SERVICE
 * Comunicação com backend em produção
 * ============================================
 * 
 * Este serviço faz requisições HTTP reais à API.
 * Usado apenas quando CONFIG.MODE = 'production'
 */

const ApiService = {
  /**
   * Headers padrão para requisições
   */
	getHeaders() {
	  const sessionToken = localStorage.getItem(window.CONFIG.AUTH.TOKEN_KEY);
	  const token = sessionToken || window.CONFIG.SUPABASE.ANON_KEY;
	  return {
	    'Content-Type': 'application/json',
	    'Accept': 'application/json',
	    'apikey': window.CONFIG.SUPABASE.ANON_KEY,
	    'Authorization': `Bearer ${token}`
	  };
	},

  /**
   * Faz requisição HTTP
   */
  async request(endpoint, options = {}) {
    // ==========================================
    // TRAVA DE SEGURANÇA PARA MODO DEV
    // ==========================================
    if (window.CONFIG?.isDev?.() || window.CONFIG?.MODE === 'development') {
      console.warn(`[ApiService] Bloqueando fetch real para ${endpoint}. Redirecionando para Mock.`);
      
      // Aqui, em vez de continuar, nós forçamos o uso do MockService
      // Se você fez a troca no final do arquivo (window.ApiService = window.MockService),
      // este if garante que se algo falhar na troca, o fetch real não ocorra.
      return window.MockService.request?.(endpoint, options) || { success: false, error: 'Mock não configurado' };
    }
    // ==========================================

    const url = `${window.CONFIG.SUPABASE.URL}/rest/v1${endpoint}`;
    
    const config = {
      method: options.method || 'GET',
      headers: this.getHeaders(),
      ...options
    };

    if (options.body && typeof options.body === 'object') {
      config.body = JSON.stringify(options.body);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), window.CONFIG.API.TIMEOUT);

    try {
      const response = await fetch(url, {
        ...config,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // O erro do "<!DOCTYPE" acontece aqui embaixo quando o fetch retorna HTML
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Tempo de requisição excedido');
      }
      throw error;
    }
  },
	
  // ==========================================
  // AUTH
  // ==========================================

  async login(email, password) {
    const url = `${window.CONFIG.SUPABASE.URL}/auth/v1/token?grant_type=password`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': window.CONFIG.SUPABASE.ANON_KEY
      },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    if (!response.ok) {
      return { success: false, error: data.error_description || 'Email ou senha inválidos' };
    }
    return {
      success: true,
      data: {
        user: {
          id: data.user.id,
          email: data.user.email,
          name: data.user.user_metadata?.name || data.user.email,
          role: data.user.user_metadata?.role || 'administrador'
        },
        token: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in
      }
    };
  },

  async register(user) {
    const url = `${window.CONFIG.SUPABASE.URL}/auth/v1/signup`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': window.CONFIG.SUPABASE.ANON_KEY
      },
      body: JSON.stringify({
        email: user.email,
        password: user.password,
        data: { name: user.name, role: user.role || 'cliente', isPending: user.isPending || false }
      })
    });
    const data = await response.json();
    if (!response.ok) {
      return { success: false, error: data.error_description || 'Erro ao criar conta' };
    }
    return { success: true, data };
  },

  async logout() {
    const token = localStorage.getItem(window.CONFIG.AUTH.TOKEN_KEY);
    await fetch(`${window.CONFIG.SUPABASE.URL}/auth/v1/logout`, {
      method: 'POST',
      headers: {
        'apikey': window.CONFIG.SUPABASE.ANON_KEY,
        'Authorization': `Bearer ${token}`
      }
    }).catch(() => {});
    return { success: true };
  },

  async getProfile() {
    const token = localStorage.getItem(window.CONFIG.AUTH.TOKEN_KEY);
    const response = await fetch(`${window.CONFIG.SUPABASE.URL}/auth/v1/user`, {
      headers: {
        'apikey': window.CONFIG.SUPABASE.ANON_KEY,
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await response.json();
    if (!response.ok) return { success: false, error: 'Não autenticado' };
    return { success: true, data };
  },
  		

  // ==========================================
  // GENERATORS
  // ==========================================

	async getGenerators() {
	  return this.request('/generators?select=*');
	},
	
	async getGenerator(id) {
	  return this.request(`/generators?id=eq.${id}&select=*`);
	},
	
	async updateGenerator(id, data) {
	  return this.request(`/generators?id=eq.${id}`, {
	    method: 'PATCH',
	    body: data
	  });
	},

	// Botão detelar gerador
	
	async deleteGenerator(id) {
	  return this.request(`/generators?id=eq.${id}`, {
	    method: 'DELETE',
	    headers: {
	      ...this.getHeaders(),
	      'Prefer': 'return=minimal'
	    }
	  });
	},

  // ==========================================
  // ALERTS
  // ==========================================

  async getAlerts() {
    return this.request('/alerts');
  },

  async markAlertRead(id) {
    return this.request(`/alerts/${id}/read`, { method: 'PUT' });
  },

  // ==========================================
  // CLIENTS
  // ==========================================

	async getClients() {
	  return this.request('/clients?select=*');
	},
	
	async getClient(id) {
	  return this.request(`/clients?id=eq.${id}&select=*`);
	},
	
	async createClient(data) {
	  return this.request('/clients', {
	    method: 'POST',
	    body: data
	  });
	},
	
	async updateClient(id, data) {
	  return this.request(`/clients?id=eq.${id}`, {
	    method: 'PATCH',
	    body: data
	  });
	},

	// Botão detelar cliente

	async deleteClient(id) {
	  return this.request(`/clients?id=eq.${id}`, {
	    method: 'DELETE',
	    headers: {
	      ...this.getHeaders(),
	      'Prefer': 'return=minimal'
	    }
	  });
	},
	
  // ==========================================
  // Generator Status
  // ==========================================

	async getGeneratorStatus(generatorId) {
	  return this.request(
	    `/generator_status?generator_id=eq.${generatorId}&order=updated_at.desc&limit=1`
	  );
	},
	
  // ==========================================
  // Generator Events
  // ==========================================

	async getGeneratorEvents(generatorId) {
	  return this.request(
	    `/generator_events?generator_id=eq.${generatorId}&order=event_time.desc`
	  );
	},
	

  // ==========================================
  // ACTIVITIES
  // ==========================================

  async getActivities() {
    return this.request('/activities');
  },

  // ==========================================
  // DASHBOARD
  // ==========================================

   //async getDashboardSummary() {
     //return this.request('/dashboard/summary');
   //}
   };

// Exporta globalmente
window.ApiService = ApiService;

// Se estiver em modo desenvolvimento, substitui o ApiService pelo MockService
if (window.CONFIG?.isDev()) {
    console.warn("⚠️ AMZ App: Redirecionando ApiService para MockService (Modo Dev)");
    window.ApiService = window.MockService;
}
