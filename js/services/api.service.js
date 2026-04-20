/**
 * ============================================
 * API SERVICE
 * Comunicação com backend em produção
 * ============================================
 *
 * Este serviço faz requisições HTTP reais à API.
 * Usado apenas quando CONFIG.MODE = 'production'
 *
 * CORREÇÕES APLICADAS:
 *  - Bug #1: request() mesclava headers errado com ...options,
 *            e tentava response.json() em respostas 204 No Content.
 *  - Bug #3: Token JWT expirava sem renovação automática.
 *            Adicionado refreshTokenIfNeeded() + salvar expiração no login.
 * ============================================
 */

const ApiService = {

  // ==========================================
  // HEADERS
  // ==========================================

  /**
   * Monta os headers padrão usando o token atual do localStorage.
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

  // ==========================================
  // REFRESH DE TOKEN  (Bug #3)
  // ==========================================

  /**
   * Verifica se o token está prestes a expirar (< 5 minutos restantes)
   * e o renova automaticamente via refresh_token.
   *
   * Chamado automaticamente no início de cada request().
   * Salva os novos tokens e a nova expiração no localStorage.
   * Redireciona para o login se o refresh falhar.
   */
  async refreshTokenIfNeeded() {
    const expiry = localStorage.getItem('amz_token_expiry');

    // Sem registro de expiração: token foi gerado antes desta correção,
    // deixa passar e aguarda a próxima renovação manual.
    if (!expiry) return;

    const expiresAt = parseInt(expiry, 10);
    const now       = Math.floor(Date.now() / 1000);

    // Mais de 5 minutos restantes: não precisa renovar ainda
    if (expiresAt - now > 300) return;

    const refreshToken = localStorage.getItem(window.CONFIG.AUTH.REFRESH_TOKEN_KEY);

    if (!refreshToken) {
      // Sem refresh token: força novo login
      console.warn('[ApiService] Sem refresh token disponível. Redirecionando para login.');
      window.location.href = '/index.html';
      return;
    }

    try {
      const res = await fetch(
        `${window.CONFIG.SUPABASE.URL}/auth/v1/token?grant_type=refresh_token`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': window.CONFIG.SUPABASE.ANON_KEY
          },
          body: JSON.stringify({ refresh_token: refreshToken })
        }
      );

      if (!res.ok) {
        console.warn('[ApiService] Refresh token inválido ou expirado. Redirecionando para login.');
        localStorage.removeItem(window.CONFIG.AUTH.TOKEN_KEY);
        localStorage.removeItem(window.CONFIG.AUTH.REFRESH_TOKEN_KEY);
        localStorage.removeItem('amz_token_expiry');
        window.location.href = '/index.html';
        return;
      }

      const data = await res.json();

      // Persiste os novos tokens
      localStorage.setItem(window.CONFIG.AUTH.TOKEN_KEY,         data.access_token);
      localStorage.setItem(window.CONFIG.AUTH.REFRESH_TOKEN_KEY, data.refresh_token);

      // Salva nova expiração (segundos desde epoch)
      const newExpiry = Math.floor(Date.now() / 1000) + data.expires_in;
      localStorage.setItem('amz_token_expiry', newExpiry);

      console.log('[ApiService] Token renovado com sucesso.');

    } catch (err) {
      // Falha de rede durante o refresh: não derruba a sessão,
      // a próxima request vai tentar de novo.
      console.error('[ApiService] Erro ao renovar token:', err.message);
    }
  },

  // ==========================================
  // REQUEST  (Bug #1 + Bug #3)
  // ==========================================

  /**
   * Faz requisição HTTP para a API REST do Supabase.
   *
   * Correções aplicadas:
   *   1. Headers mesclados corretamente: ...getHeaders() base +
   *      ...options.headers extras (ex: 'Prefer': 'return=minimal' do DELETE).
   *      Antes, o ...options sobrescrevia a chave 'headers' inteira.
   *
   *   2. Respostas 204 No Content retornam { success: true } imediatamente,
   *      sem tentar response.json() — que explodia com erro de parse.
   *
   *   3. refreshTokenIfNeeded() é chamado antes de toda requisição autenticada.
   */

    // ------------------------------------------
    // Trava de segurança: bloqueia fetch real em modo DEV
    // ------------------------------------------
  async request(endpoint, options = {}) {
    if (window.CONFIG?.isDev?.() || window.CONFIG?.MODE === 'development') {
      console.warn(`[ApiService] Bloqueando fetch real para ${endpoint}. Redirecionando para Mock.`);
      return window.MockService.request?.(endpoint, options)
        || { success: false, error: 'Mock não configurado' };
    }

    // ------------------------------------------
    // Bug #3 — renova token se necessário
    // ------------------------------------------
    await this.refreshTokenIfNeeded();

    const url = `${window.CONFIG.SUPABASE.URL}/rest/v1${endpoint}`;

    // ------------------------------------------
    // Bug #1 — montagem correta do config
    //
    // ANTES (errado):
    //   const config = {
    //     method: options.method || 'GET',
    //     headers: this.getHeaders(),
    //     ...options   // ← sobrescreve 'headers' inteiro com o objeto aninhado
    //   };
    //
    // DEPOIS (correto):
    //   Extraímos só o que precisamos de options; headers são mesclados
    //   explicitamente para que extras (ex: 'Prefer') se somem, não substituam.
    // ------------------------------------------
    const config = {
      method: options.method || 'GET',
      headers: {
        ...this.getHeaders(),           // headers base (Auth, apikey, Content-Type…)
        ...(options.headers || {})      // headers extras opcionais (ex: Prefer: return=minimal)
      }
    };

    // Serializa o body separadamente (não vem mais do ...options)
    if (options.body && typeof options.body === 'object') {
      config.body = JSON.stringify(options.body);
    }

    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), window.CONFIG.API.TIMEOUT);

    try {
      const response = await fetch(url, {
        ...config,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // Erro HTTP: tenta extrair mensagem do corpo
      if (!response.ok) {
        let errorBody = {};
        try {
          errorBody = await response.json();
        } catch (_) {}
        // O Supabase retorna o erro em diferentes campos dependendo da versão
        const msg = errorBody.message || errorBody.error || errorBody.hint || `HTTP ${response.status}`;
        throw new Error(msg);
      }

      // ------------------------------------------
      // Bug #1 — tratamento do 204 No Content
      //
      // DELETE com 'Prefer: return=minimal' retorna 204 sem body.
      // Chamar response.json() aqui causava SyntaxError: Unexpected end of JSON.
      // ------------------------------------------
      if (response.status === 204) {
        return { success: true };
      }

      return await response.json();

    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error('Tempo de requisição excedido');
      }
      throw error;
    }
  },

  // ==========================================
  // AUTH
  // ==========================================

  /**
   * Login com email + senha.
   *
   * Correção Bug #3: agora salva 'amz_token_expiry' no localStorage
   * para que refreshTokenIfNeeded() saiba quando renovar.
   */
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

    // Bug #3 — salva a expiração absoluta (epoch em segundos)

    const exp = Math.floor(Date.now()/1000) + data.expires_in;
    localStorage.setItem('amz_token_expiry', exp);
    
    return {
      success: true,
      data: {
        user: {
          id:    data.user.id,
          email: data.user.email,
          name:  data.user.user_metadata?.name || data.user.email,
          role:  data.user.user_metadata?.role  || 'administrador'
        },
        token:        data.access_token,
        refreshToken: data.refresh_token,
        expiresIn:    data.expires_in
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
        email:    user.email,
        password: user.password,
        data: {
          name:      user.name,
          role:      user.role      || 'cliente',
          isPending: user.isPending || false
        }
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
        'apikey':        window.CONFIG.SUPABASE.ANON_KEY,
        'Authorization': `Bearer ${token}`
      }
    }).catch(() => {});

    // Limpa todos os dados de sessão
    localStorage.removeItem(window.CONFIG.AUTH.TOKEN_KEY);
    localStorage.removeItem(window.CONFIG.AUTH.REFRESH_TOKEN_KEY);
    localStorage.removeItem(window.CONFIG.AUTH.USER_KEY);
    localStorage.removeItem('amz_token_expiry');

    return { success: true };
  },

  async getProfile() {
    const token = localStorage.getItem(window.CONFIG.AUTH.TOKEN_KEY);

    const response = await fetch(`${window.CONFIG.SUPABASE.URL}/auth/v1/user`, {
      headers: {
        'apikey':        window.CONFIG.SUPABASE.ANON_KEY,
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
      body:   data
    });
  },

  async createGenerator(data) {
    return this.request('/generators', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: data
    });
  },

  async deleteGenerator(id) {
    // 'Prefer: return=minimal' faz o Supabase retornar 204 No Content.
    // Agora tratado corretamente em request() — retorna { success: true }.
    return this.request(`/generators?id=eq.${id}`, {
      method:  'DELETE',
      headers: { 'Prefer': 'return=minimal' }
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
      headers: { 'Prefer': 'return=representation' },
      body:   data
    });
  },

  async updateClient(id, data) {
    return this.request(`/clients?id=eq.${id}`, {
      method: 'PATCH',
      body:   data
    });
  },

  async deleteClient(id) {
    return this.request(`/clients?id=eq.${id}`, {
      method:  'DELETE',
      headers: { 'Prefer': 'return=minimal' }
    });
  },

  // ==========================================
  // GENERATOR STATUS
  // ==========================================

  async getGeneratorStatus(generatorId) {
    return this.request(
      `/generator_status?generator_id=eq.${generatorId}&order=updated_at.desc&limit=1`
    );
  },

  // ==========================================
  // GENERATOR EVENTS
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

  // async getDashboardSummary() {
  //   return this.request('/dashboard/summary');
  // }

};

// Exporta globalmente
window.ApiService = ApiService;

// Em modo desenvolvimento, substitui pelo MockService
if (window.CONFIG?.isDev()) {
  console.warn('⚠️ AMZ App: Redirecionando ApiService para MockService (Modo Dev)');
  window.ApiService = window.MockService;
}
