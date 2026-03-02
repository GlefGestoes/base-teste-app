/**
 * ============================================
 * AMZ APP - CONFIGURAÇÃO CENTRAL
 * ============================================
 * 
 * Arquivo único de configuração para alternar entre
 * modos de desenvolvimento e produção.
 * 
 * INSTRUÇÕES:
 * 1. Para desenvolvimento local: mantenha MODE = 'development'
 * 2. Para produção: altere MODE = 'production'
 * 3. Em produção, configure a API_URL corretamente
 */

const CONFIG = {
  /**
   * MODO DA APLICAÇÃO
   * 'development' - Usa mocks locais, não precisa de backend
   * 'production'  - Conecta à API real
   */
  MODE: 'development',

  /**
   * INFORMAÇÕES DO APP
   */
  APP: {
    NAME: 'AMZ App',
    VERSION: '1.0.0',
    DESCRIPTION: 'Sistema de Gerenciamento de Geradores'
  },

  /**
   * CONFIGURAÇÕES DE API
   */
  API: {
    // URL base da API (usada apenas em produção)
    BASE_URL: 'https://api.amz.app/v1',
    
    // Timeout em milissegundos
    TIMEOUT: 30000,
    
    // Número de tentativas em caso de falha
    RETRIES: 3
  },

  /**
   * FEATURE FLAGS
   */
  FEATURES: {
    OAUTH_GOOGLE: true,
    OAUTH_APPLE: true,
    OFFLINE_MODE: true,
    PUSH_NOTIFICATIONS: false
  },

  /**
   * CONFIGURAÇÕES DE MOCK (apenas desenvolvimento)
   */
  MOCK: {
    // Delay simulado em ms (min, max)
    DELAY: [200, 800],
    
    // Taxa de erro simulada (0 a 1)
    ERROR_RATE: 0.05,
    
    // Habilitar logs
    DEBUG: true
  },

  /**
   * CONFIGURAÇÕES DE AUTH
   */
  AUTH: {
    TOKEN_KEY: 'amz_token',
    REFRESH_TOKEN_KEY: 'amz_refresh_token',
    USER_KEY: 'amz_user',
    TOKEN_EXPIRY: 3600 // segundos
  },

  /**
   * MÉTODOS UTILITÁRIOS
   */
  isDev() {
    return this.MODE === 'development';
  },

  isProd() {
    return this.MODE === 'production';
  },

  getApiUrl() {
    return this.isProd() ? this.API.BASE_URL : null;
  },

  log(...args) {
    if (this.isDev() && this.MOCK.DEBUG) {
      console.log('[AMZ]', ...args);
    }
  }
};

// Exporta para uso global
if (typeof window !== 'undefined') {
  window.CONFIG = CONFIG;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
