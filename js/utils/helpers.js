/**
 * ============================================
 * HELPERS
 * Funções utilitárias globais
 * ============================================
 */

const Utils = {
  /**
   * Formata data
   */
  formatDate(date, options = {}) {
    const d = new Date(date);
    if (isNaN(d.getTime())) return 'Data inválida';
    
    return d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      ...options
    });
  },

  /**
   * Formata data relativa
   */
  timeAgo(date) {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    
    const intervals = {
      ano: 31536000,
      mês: 2592000,
      semana: 604800,
      dia: 86400,
      hora: 3600,
      minuto: 60
    };

    for (const [unit, secondsInUnit] of Object.entries(intervals)) {
      const interval = Math.floor(seconds / secondsInUnit);
      if (interval >= 1) {
        return `há ${interval} ${unit}${interval > 1 ? 's' : ''}`;
      }
    }
    
    return 'agora';
  },

  /**
   * Formata telefone
   */
  formatPhone(phone) {
    const nums = phone.replace(/\D/g, '');
    if (nums.length === 11) {
      return `(${nums.slice(0, 2)}) ${nums.slice(2, 7)}-${nums.slice(7)}`;
    }
    if (nums.length === 10) {
      return `(${nums.slice(0, 2)}) ${nums.slice(2, 6)}-${nums.slice(6)}`;
    }
    return phone;
  },

  /**
   * Formata CNPJ/CPF
   */
  formatDocument(doc) {
    const nums = doc.replace(/\D/g, '');
    if (nums.length === 14) {
      return nums.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    }
    if (nums.length === 11) {
      return nums.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    }
    return doc;
  },

  /**
   * Valida email
   */
  isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  },

  /**
   * Trunca texto
   */
  truncate(text, length = 100) {
    if (text.length <= length) return text;
    return text.slice(0, length).trim() + '...';
  },

  /**
   * Capitaliza string
   */
  capitalize(str) {
    return str.toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
  },

  /**
   * Debounce
   */
  debounce(fn, delay = 300) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), delay);
    };
  },

  /**
   * Seletor DOM
   */
  $(selector, context = document) {
    return context.querySelector(selector);
  },

  /**
   * Seletor DOM múltiplo
   */
  $$(selector, context = document) {
    return context.querySelectorAll(selector);
  }
};

// Exporta globalmente
window.Utils = Utils;
