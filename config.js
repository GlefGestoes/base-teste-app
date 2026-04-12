/**
 * ============================================
 * AMZ APP - CONFIGURAÇÃO CENTRAL
 * ============================================
 */

const CONFIG = {
  MODE: 'development', // 'development' | 'production'

  APP: {
    NAME: 'AMZ App',
    VERSION: '1.0.0',
    DESCRIPTION: 'Sistema de Gerenciamento de Geradores'
  },

  API: {
    BASE_URL: 'https://api.amz.app/v1',
    TIMEOUT: 30000,
    RETRIES: 3
  },

  /**
   * ============================================
   * CONFIGURAÇÃO DO DSE GATEWAY 4G
   * ============================================
   * Ajuste o IP conforme sua rede local.
   * Em produção, use um proxy no backend para evitar CORS.
   */
  SUPABASE: {
    URL: 'https://mrgvnqoyrpajmosmjfwb.supabase.co',
    ANON_KEY: 'sb_publishable_hzgfbdFLWibQVfO4niwJNg__bRW64LY',
    FUNCTIONS_URL: 'https://mrgvnqoyrpajmosmjfwb.supabase.co/functions/v1'
  },
  SYNC: {
    POLL_INTERVAL: 5000,
    TIMEOUT: 8000,
    MAX_RETRIES: 3,
    AUTO_POLL: true,
  },

  FEATURES: {
    OAUTH_GOOGLE: true,
    OAUTH_APPLE: true,
    OFFLINE_MODE: true,
    PUSH_NOTIFICATIONS: false,
    DSE_INTEGRATION: true,
  },

  MOCK: {
    DELAY: [200, 800],
    ERROR_RATE: 0.05,
    DEBUG: true
  },

  AUTH: {
    TOKEN_KEY: 'amz_token',
    REFRESH_TOKEN_KEY: 'amz_refresh_token',
    USER_KEY: 'amz_user',
    TOKEN_EXPIRY: 3600
  },

  isDev()  { return this.MODE === 'development'; },
  isProd() { return this.MODE === 'production'; },
  getApiUrl() { return this.isProd() ? this.API.BASE_URL : null; },

  log(...args) {
    if (this.isDev() && this.MOCK.DEBUG) {
      console.log('[AMZ]', ...args);
    }
  }
};

if (typeof window !== 'undefined')  window.CONFIG = CONFIG;
if (typeof module !== 'undefined' && module.exports) module.exports = CONFIG;

