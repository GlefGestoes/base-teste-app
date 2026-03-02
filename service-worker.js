/**
 * ============================================
 * AMZ APP - SERVICE WORKER
 * ============================================
 * 
 * Gerencia cache e funcionalidade offline da PWA.
 * Estratégia: Cache First, then Network
 */

const CACHE_NAME = 'amz-app-v1';
const STATIC_CACHE = 'amz-static-v1';
const DYNAMIC_CACHE = 'amz-dynamic-v1';
const IMAGE_CACHE = 'amz-images-v1';

// Assets essenciais para o shell do app
const STATIC_ASSETS = [
  './',
  './index.html',
  './config.js',
  './css/styles.css',
  './js/app.js',
  './js/utils/helpers.js',
  './js/services/mock.service.js',
  './js/services/api.service.js',
  './js/services/auth.service.js',
  './pages/dashboard.html',
  './pages/monitoramento.html',
  './pages/relatorios.html',
  './pages/clientes.html',
  './pages/configuracoes.html',
  './assets/icons/favicon.svg'
];

// URLs externas que devem ser cacheadas
const EXTERNAL_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap'
];

// ============================================
// INSTALAÇÃO
// ============================================
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando Service Worker...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Cacheando assets estáticos...');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('[SW] Assets estáticos cacheados com sucesso');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Erro ao cachear assets:', error);
      })
  );
});

// ============================================
// ATIVAÇÃO
// ============================================
self.addEventListener('activate', (event) => {
  console.log('[SW] Ativando Service Worker...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            // Remove caches antigos
            if (
              cacheName !== STATIC_CACHE &&
              cacheName !== DYNAMIC_CACHE &&
              cacheName !== IMAGE_CACHE
            ) {
              console.log('[SW] Removendo cache antigo:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('[SW] Service Worker ativado');
        return self.clients.claim();
      })
  );
});

// ============================================
// FETCH - Estratégias de Cache
// ============================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Ignora requisições não-GET
  if (request.method !== 'GET') {
    return;
  }
  
  // Ignora requisições de analytics e tracking
  if (url.pathname.includes('analytics') || url.pathname.includes('tracking')) {
    return;
  }
  
  // Estratégia para páginas HTML - Network First
  if (request.mode === 'navigate' || request.headers.get('accept').includes('text/html')) {
    event.respondWith(networkFirst(request));
    return;
  }
  
  // Estratégia para CSS e JS - Cache First
  if (url.pathname.match(/\.(css|js)$/)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }
  
  // Estratégia para imagens - Cache First com fallback
  if (request.destination === 'image') {
    event.respondWith(cacheFirst(request, IMAGE_CACHE));
    return;
  }
  
  // Estratégia para fontes - Cache First
  if (request.destination === 'font') {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }
  
  // Estratégia padrão para API - Network First
  if (url.pathname.startsWith('/api/') || url.hostname.includes('api.')) {
    event.respondWith(networkFirst(request));
    return;
  }
  
  // Estratégia padrão - Stale While Revalidate
  event.respondWith(staleWhileRevalidate(request));
});

// ============================================
// ESTRATÉGIAS DE CACHE
// ============================================

/**
 * Cache First - Tenta o cache primeiro, senão vai na rede
 */
async function cacheFirst(request, cacheName = STATIC_CACHE) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  
  if (cached) {
    return cached;
  }
  
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.error('[SW] Erro ao buscar:', error);
    // Retorna uma resposta de fallback se disponível
    return caches.match('./offline.html') || new Response('Offline', { status: 503 });
  }
}

/**
 * Network First - Tenta a rede primeiro, senão usa cache
 */
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.log('[SW] Falha na rede, tentando cache...');
    const cache = await caches.open(DYNAMIC_CACHE);
    const cached = await cache.match(request);
    
    if (cached) {
      return cached;
    }
    
    // Tenta no cache estático
    const staticCache = await caches.open(STATIC_CACHE);
    const staticCached = await staticCache.match(request);
    
    if (staticCached) {
      return staticCached;
    }
    
    // Fallback para página offline
    return caches.match('./index.html');
  }
}

/**
 * Stale While Revalidate - Retorna do cache imediatamente e atualiza em background
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(DYNAMIC_CACHE);
  const cached = await cache.match(request);
  
  const fetchPromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse.ok) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch((error) => {
      console.log('[SW] Falha no fetch:', error);
      return cached;
    });
  
  return cached || fetchPromise;
}

// ============================================
// BACKGROUND SYNC
// ============================================
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-data') {
    event.waitUntil(syncData());
  }
});

async function syncData() {
  console.log('[SW] Sincronizando dados em background...');
  // Implementar lógica de sincronização aqui
}

// ============================================
// PUSH NOTIFICATIONS
// ============================================
self.addEventListener('push', (event) => {
  if (!event.data) return;
  
  const data = event.data.json();
  
  const options = {
    body: data.body || 'Nova notificação do AMZ App',
    icon: './assets/icons/icon-192x192.png',
    badge: './assets/icons/badge-72x72.png',
    tag: data.tag || 'default',
    requireInteraction: data.requireInteraction || false,
    actions: data.actions || [],
    data: data.data || {}
  };
  
  event.waitUntil(
    self.registration.showNotification(
      data.title || 'AMZ App',
      options
    )
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const notificationData = event.notification.data;
  let url = './pages/dashboard.html';
  
  if (notificationData && notificationData.url) {
    url = notificationData.url;
  }
  
  event.waitUntil(
    clients.matchAll({ type: 'window' })
      .then((clientList) => {
        // Se já tem uma janela aberta, foca nela
        for (const client of clientList) {
          if (client.url === url && 'focus' in client) {
            return client.focus();
          }
        }
        // Senão, abre uma nova janela
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});

// ============================================
// MESSAGE HANDLER (Comunicação com o app)
// ============================================
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  
  if (event.data === 'getVersion') {
    event.ports[0].postMessage({ version: '1.0.0' });
  }
  
  if (event.data.type === 'CACHE_URLS') {
    event.waitUntil(
      caches.open(DYNAMIC_CACHE)
        .then((cache) => cache.addAll(event.data.payload))
    );
  }
});

// ============================================
// PERIODIC BACKGROUND SYNC (se suportado)
// ============================================
if ('periodicSync' in self.registration) {
  self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'update-data') {
      event.waitUntil(updatePeriodicData());
    }
  });
}

async function updatePeriodicData() {
  console.log('[SW] Atualização periódica de dados...');
  // Implementar atualização periódica aqui
}

console.log('[SW] Service Worker carregado');
