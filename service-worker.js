/**
 * ============================================
 * AMZ APP - SERVICE WORKER v2.0
 * ============================================
 *
 * Correções aplicadas:
 * - CSS/JS voltam para cacheFirst (offline funcional)
 * - Estratégia API separada: networkOnly para Supabase
 * - Fallback robusto para qualquer tipo de asset
 * - Scope dinâmico compatível com subpastas
 */

const CACHE_VERSION = 'v2'; // Incrementar a cada deploy
const STATIC_CACHE  = `amz-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `amz-dynamic-${CACHE_VERSION}`;
const IMAGE_CACHE   = `amz-images-${CACHE_VERSION}`;

// Assets críticos — sempre na raiz (mesmo nível que index.html)
const CRITICAL_ASSETS = [
  './',
  './index.html',
  './config.js',
  './css/styles.css',
  './js/app.js',
  './assets/icons/logoamz.png',
];

// Assets opcionais — falha silenciosa
const OPTIONAL_ASSETS = [
  './js/utils/helpers.js',
  './js/services/mock.service.js',
  './js/services/api.service.js',
  './js/services/auth.service.js',
  './js/services/dse.service.js',
  './pages/dashboard.html',
  './pages/monitoramento.html',
  './pages/relatorios.html',
  './pages/clientes.html',
  './pages/geradores.html',
  './pages/configuracoes.html',
  './pages/cadastro.html',
];

// ============================================
// INSTALAÇÃO
// ============================================

self.addEventListener('install', (event) => {
  console.log('[SW] Instalando Service Worker...');

  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Cacheando assets críticos...');

        // Cache crítico: atômico — qualquer 404 aqui aborta o install
        const cacheCritical = cache.addAll(CRITICAL_ASSETS);

        // Cache opcional: individual — falha silenciosa
        const cacheOptional = Promise.all(
          OPTIONAL_ASSETS.map((url) =>
            cache.add(url).catch((err) => {
              console.warn(`[SW] Asset opcional não encontrado: ${url}`, err.message);
            })
          )
        );

        return cacheCritical.then(() => cacheOptional);
      })
      .then(() => {
        console.log('[SW] Assets cacheados com sucesso');
        return self.skipWaiting(); // Ativa imediatamente
      })
      .catch((error) => {
        console.error('[SW] Erro ao cachear assets críticos:', error);
        // Mesmo com erro, tenta continuar (não bloqueia install)
        return self.skipWaiting();
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
            // Limpa apenas caches antigos da MESMA família
            if (
              cacheName.startsWith('amz-static-') && cacheName !== STATIC_CACHE ||
              cacheName.startsWith('amz-dynamic-') && cacheName !== DYNAMIC_CACHE ||
              cacheName.startsWith('amz-images-') && cacheName !== IMAGE_CACHE
            ) {
              console.log('[SW] Removendo cache antigo:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('[SW] Service Worker ativado');
        return self.clients.claim(); // Assume controle imediatamente
      })
  );
});

// ============================================
// FETCH — Estratégias de Cache
// ============================================

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignora requisições não-GET
  if (request.method !== 'GET') return;

  // Ignora esquemas não-http
  if (!url.protocol.startsWith('http')) return;

  // Ignora analytics e tracking
  if (url.pathname.includes('analytics') || url.pathname.includes('tracking')) return;

  // 1. Páginas HTML — Network First (sempre versão mais recente)
  const acceptHeader = request.headers.get('accept') || '';
  if (request.mode === 'navigate' || acceptHeader.includes('text/html')) {
    event.respondWith(networkFirstWithOfflineFallback(request));
    return;
  }

  // 2. CSS e JS — CACHE FIRST (essencial para offline!)
  if (url.pathname.match(/\.(css|js)$/)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // 3. Imagens — Cache First
  if (request.destination === 'image') {
    event.respondWith(cacheFirst(request, IMAGE_CACHE));
    return;
  }

  // 4. Fontes — Cache First
  if (request.destination === 'font') {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // 5. API Supabase — NETWORK ONLY (nunca cacheia dados dinâmicos)
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(networkOnly(request));
    return;
  }

  // 6. Padrão — Stale While Revalidate
  event.respondWith(staleWhileRevalidate(request));
});

// ============================================
// ESTRATÉGIAS DE CACHE (CORRIGIDAS)
// ============================================

/**
 * Cache First — ESSENCIAL para CSS/JS funcionarem offline
 */
async function cacheFirst(request, cacheName = STATIC_CACHE) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) {
    // Retorna cache imediatamente (rápido)
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      // Guarda no cache para próxima vez
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.error('[SW] Falha ao buscar recurso:', request.url, error);
    
    // Fallback último recurso: página offline genérica
    if (request.destination === 'document') {
      return caches.match('./index.html');
    }
    
    // Para CSS/JS, retorna resposta vazia para não quebrar a página
    return new Response('', { status: 503, statusText: 'Service Unavailable' });
  }
}

/**
 * Network First — Para HTML (sempre tenta versão mais recente)
 */
async function networkFirstWithOfflineFallback(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      // Atualiza cache dinâmico com versão mais recente
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.log('[SW] Rede falhou, tentando cache...');

    // Tenta cache dinâmico primeiro (versão mais recente visitada)
    const dynamicCache = await caches.open(DYNAMIC_CACHE);
    const dynamicMatch = await dynamicCache.match(request);
    if (dynamicMatch) return dynamicMatch;

    // Tenta cache estático (páginas pre-cacheadas no install)
    const staticCache = await caches.open(STATIC_CACHE);
    const staticMatch = await staticCache.match(request);
    if (staticMatch) return staticMatch;

    // Fallback final: index.html (SPA behavior)
    const fallback = await caches.match('./index.html');
    if (fallback) return fallback;

    // Último recurso: mensagem offline
    return new Response(
      '<html><body><h1>AMZ App - Offline</h1><p>Você está offline. Conecte-se à internet para continuar.</p></body></html>',
      { headers: { 'Content-Type': 'text/html' } }
    );
  }
}

/**
 * Network Only — Para API Supabase (nunca cacheia)
 */
async function networkOnly(request) {
  // Sempre vai na rede, nunca usa cache
  // Isso evita dados stale e problemas de sincronização
  try {
    return await fetch(request);
  } catch (error) {
    console.error('[SW] API offline:', request.url);
    
    // Retorna erro JSON para o cliente tratar
    return new Response(
      JSON.stringify({ error: 'Offline', message: 'Sem conexão com o servidor' }),
      { 
        status: 503, 
        headers: { 'Content-Type': 'application/json' } 
      }
    );
  }
}

/**
 * Stale While Revalidate — Para assets genéricos
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(DYNAMIC_CACHE);
  const cached = await cache.match(request);

  // Busca na rede em background (não bloqueia)
  const fetchPromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse.ok) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(() => {
      console.log('[SW] SWR: rede falhou, usando cache');
      return cached;
    });

  // Retorna cache imediatamente (rápido), atualiza depois
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
  // TODO: Implementar lógica de sincronização offline→online
}

// ============================================
// PUSH NOTIFICATIONS
// ============================================

self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();

  const options = {
    body: data.body || 'Nova notificação do AMZ App',
    icon: './assets/icons/logoamz.png',
    badge: './assets/icons/logoamz.png',
    tag: data.tag || 'default',
    requireInteraction: data.requireInteraction || false,
    actions: data.actions || [],
    data: data.data || {},
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'AMZ App', options)
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
        for (const client of clientList) {
          if (client.url.includes(url) && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});

// ============================================
// MESSAGE HANDLER
// ============================================

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }

  if (event.data === 'getVersion') {
    event.ports[0]?.postMessage({ version: CACHE_VERSION });
  }

  if (event.data && event.data.type === 'CACHE_URLS') {
    event.waitUntil(
      caches.open(DYNAMIC_CACHE)
        .then((cache) => cache.addAll(event.data.payload))
    );
  }
});

// ============================================
// PERIODIC BACKGROUND SYNC
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
  // TODO: Implementar sincronização periódica com Supabase
}

console.log('[SW] Service Worker carregado - versão:', CACHE_VERSION);
