/**
 * ============================================
 * API SERVICE - SUPABASE
 * Comunicação com backend em produção
 * ============================================
 */

const ApiService = {

  /**
   * Headers padrão para requisições
   */
  getHeaders() {

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1yZ3ZucW95cnBham1vc21qZndiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NTcwODEsImV4cCI6MjA4ODMzMzA4MX0.386o3VAq6aN4_AFfBQuZiVPQJdEVNpqBL5AMDSkCALo',
      'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1yZ3ZucW95cnBham1vc21qZndiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NTcwODEsImV4cCI6MjA4ODMzMzA4MX0.386o3VAq6aN4_AFfBQuZiVPQJdEVNpqBL5AMDSkCALo'
    };

    return headers;
  },

  /**
   * Faz requisição HTTP
   */
  async request(endpoint, options = {}) {

    const url = `https://mrgvnqoyrpajmosmjfwb.supabase.co/rest/v1${endpoint}`;

    const config = {
      method: options.method || 'GET',
      headers: this.getHeaders(),
      ...options
    };

    if (options.body && typeof options.body === 'object') {
      config.body = JSON.stringify(options.body);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

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

  // ==========================================
  // ALERTS
  // ==========================================

  async getAlerts() {
    return this.request('/alerts?select=*');
  },

  async markAlertRead(id) {
    return this.request(`/alerts?id=eq.${id}`, {
      method: 'PATCH',
      body: { read: true }
    });
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

  // ==========================================
  // ACTIVITIES
  // ==========================================

  async getActivities() {
    return this.request('/activities?select=*');
  },

  // ==========================================
  // DASHBOARD
  // ==========================================

  async getDashboardSummary() {

    const generators = await this.getGenerators();
    const alerts = await this.getAlerts();
    const clients = await this.getClients();

    return {
      generators: generators.length,
      alerts: alerts.length,
      clients: clients.length
    };

  }

};

// Exporta globalmente
window.ApiService = ApiService;
