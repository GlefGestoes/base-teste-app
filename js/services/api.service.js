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
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    const token = localStorage.getItem(window.CONFIG?.AUTH?.TOKEN_KEY);
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
  },

  /**
   * Faz requisição HTTP
   */
  async request(endpoint, options = {}) {
    const url = `${window.CONFIG.API.BASE_URL}${endpoint}`;
    
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
    return this.request('/auth/login', {
      method: 'POST',
      body: { email, password }
    });
  },
  
	async register(user) {
	  return this.request('/auth/register', {
		method: 'POST',
		body: user
	  });
	},

  async logout() {
    return this.request('/auth/logout', { method: 'POST' });
  },

  async refreshToken() {
    return this.request('/auth/refresh', { method: 'POST' });
  },

  async getProfile() {
    return this.request('/auth/profile');
  },

  // ==========================================
  // GENERATORS
  // ==========================================

  async getGenerators() {
    return this.request('/generators');
  },

  async getGenerator(id) {
    return this.request(`/generators/${id}`);
  },

  async updateGenerator(id, data) {
    return this.request(`/generators/${id}`, {
      method: 'PUT',
      body: data
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
    return this.request('/clients');
  },

  async getClient(id) {
    return this.request(`/clients/${id}`);
  },

  async createClient(data) {
    return this.request('/clients', {
      method: 'POST',
      body: data
    });
  },

  async updateClient(id, data) {
    return this.request(`/clients/${id}`, {
      method: 'PUT',
      body: data
    });
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

  async getDashboardSummary() {
    return this.request('/dashboard/summary');
  }
};

// Exporta globalmente
window.ApiService = ApiService;

// Se estiver em modo desenvolvimento, substitui o ApiService pelo MockService
if (window.CONFIG?.isDev()) {
    console.warn("⚠️ AMZ App: Redirecionando ApiService para MockService (Modo Dev)");
    window.ApiService = window.MockService;
}
