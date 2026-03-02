# AMZ App - Sistema de Gerenciamento de Geradores

PWA (Progressive Web App) completo para monitoramento e gerenciamento de geradores de energia, com arquitetura profissional suportando modos de desenvolvimento e produção.

---

## 📁 Estrutura do Projeto

```
amz-app/
├── index.html                 # Página de login (entry point)
├── manifest.json              # Configuração PWA
├── service-worker.js          # Service Worker para offline
├── config.js                  # Configuração central (dev/prod)
├── README.md                  # Documentação
│
├── css/
│   └── styles.css             # Estilos consolidados
│
├── js/
│   ├── app.js                 # Entry point JavaScript
│   ├── utils/
│   │   └── helpers.js         # Funções utilitárias
│   └── services/
│       ├── mock.service.js    # API mock (desenvolvimento)
│       ├── api.service.js     # API real (produção)
│       └── auth.service.js    # Autenticação
│
├── pages/
│   ├── dashboard.html         # Dashboard principal
│   ├── monitoramento.html     # Monitoramento em tempo real
│   ├── relatorios.html        # Relatórios e análises
│   ├── clientes.html          # Gerenciamento de clientes
│   └── configuracoes.html     # Configurações do usuário
│
└── assets/
    └── icons/
        └── favicon.svg        # Ícone do app
```

---

## 🚀 Modos de Operação

### Modo Desenvolvimento (Development)

No modo desenvolvimento, o app funciona **sem necessidade de backend**:

- ✅ Dados mockados locais
- ✅ Login fake para testes
- ✅ Simulação de delay de rede
- ✅ Geração de tokens JWT mockados
- ✅ Funciona apenas com um servidor estático

**Para ativar:**
```javascript
// config.js
const CONFIG = {
  MODE: 'development',  // ← Altere aqui
  // ...
};
```

**Usuários de teste:**
| Email | Senha | Perfil |
|-------|-------|--------|
| admin@amz.app | admin123 | Administrador |
| vendedor@amz.app | vendedor123 | Vendedor |
| tecnico@amz.app | tecnico123 | Técnico |
| cliente@amz.app | cliente123 | Cliente |

### Modo Produção (Production)

No modo produção, o app conecta à **API real**:

- ✅ Requisições HTTP reais
- ✅ Autenticação JWT com backend
- ✅ Dados persistentes
- ✅ Pronto para deploy em produção

**Para ativar:**
```javascript
// config.js
const CONFIG = {
  MODE: 'production',  // ← Altere aqui
  API: {
    BASE_URL: 'https://sua-api.com/v1',  // ← Configure a URL
    TIMEOUT: 30000,
    RETRIES: 3
  },
  // ...
};
```

---

## 🏗️ Arquitetura

### Padrão Repository + Strategy

O projeto utiliza o padrão **Repository** combinado com **Strategy** para alternar entre mock e API real:

```
┌─────────────────┐
│   AuthService   │ ← Abstração de autenticação
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐  ┌────────┐
│  Mock  │  │  API   │ ← Implementações
│Service │  │Service │
└────────┘  └────────┘
```

### Fluxo de Autenticação

1. Usuário faz login na página inicial
2. `AuthService` decide qual serviço usar (Mock ou API)
3. Serviço retorna token JWT e dados do usuário
4. Token é armazenado no localStorage
5. Todas as requisições subsequentes usam o token

### Cache e Offline

O Service Worker implementa:
- **Cache First** para CSS/JS/Imagens
- **Network First** para páginas HTML
- **Stale While Revalidate** para dados dinâmicos
- Background Sync para ações pendentes

---

## 🛠️ Tecnologias

- **HTML5** - Estrutura semântica
- **CSS3** - Variáveis CSS, Flexbox, Grid, Glassmorphism
- **JavaScript (ES6+)** - Módulos, Async/Await, Fetch API
- **Service Workers** - Cache, Background Sync, Push Notifications
- **Web App Manifest** - Instalação como app nativo
- **LocalStorage** - Persistência de sessão

---

## 📱 Responsividade

O app é totalmente responsivo:

| Breakpoint | Largura | Layout |
|------------|---------|--------|
| Mobile | < 768px | Bottom navigation |
| Tablet | 768px - 1023px | Sidebar fixo |
| Desktop | 1024px+ | Sidebar expandido |
| TV/4K | 1920px+ | Grid adaptativo |

---

## 🚀 Como Executar

### Opção 1: Servidor Python (recomendado)

```bash
cd amz-app
python3 -m http.server 8080
```

Acesse: http://localhost:8080

### Opção 2: Servidor Node.js (http-server)

```bash
npm install -g http-server
cd amz-app
http-server -p 8080
```

### Opção 3: VS Code (Live Server)

1. Instale a extensão "Live Server"
2. Clique com botão direito em `index.html`
3. Selecione "Open with Live Server"

### Opção 4: Docker

```bash
docker run -p 8080:80 -v $(pwd):/usr/share/nginx/html nginx:alpine
```

---

## 📦 Deploy

### Render.com

1. Crie um novo Static Site
2. Conecte seu repositório Git
3. Configure:
   - Build Command: (deixe em branco)
   - Publish Directory: `/`
4. Deploy!

### Netlify

1. Arraste a pasta do projeto para https://app.netlify.com/drop
2. Ou conecte seu repositório Git

### Vercel

```bash
npm i -g vercel
cd amz-app
vercel --prod
```

---

## 🔧 Configurações Avançadas

### Feature Flags

```javascript
// config.js
FEATURES: {
  OAUTH_GOOGLE: true,      // Login com Google
  OAUTH_APPLE: true,       // Login com Apple
  OFFLINE_MODE: true,      // Funcionar offline
  PUSH_NOTIFICATIONS: false // Notificações push
}
```

### Configurações de Mock

```javascript
// config.js
MOCK: {
  DELAY: [200, 800],      // Delay simulado (min, max) em ms
  ERROR_RATE: 0.05,        // Taxa de erro simulada (0-1)
  DEBUG: true              // Logs no console
}
```

---

## 🔐 Segurança

- Tokens JWT com expiração
- Refresh token automático
- Proteção contra XSS (escapamento de dados)
- HTTPS obrigatório em produção
- Sanitização de inputs

---

## 📝 Scripts Úteis

### Limpar cache do Service Worker

```javascript
// No console do navegador
navigator.serviceWorker.getRegistrations().then(regs => {
  regs.forEach(reg => reg.unregister());
});
caches.keys().then(names => {
  names.forEach(name => caches.delete(name));
});
```

### Verificar modo atual

```javascript
// No console do navegador
console.log('Modo:', CONFIG.MODE);
console.log('É desenvolvimento?', CONFIG.isDev());
console.log('É produção?', CONFIG.isProd());
```

---

## 🐛 Debug

Em modo desenvolvimento, o app exibe logs detalhados:

```
[AMZ] Modo: development
[AMZ] Usando MockService
[AMZ] Login simulado: admin@amz.app
```

Para desativar logs:
```javascript
MOCK: {
  DEBUG: false
}
```

---

## 📄 Licença

Este projeto é propriedade da Glef - Gestões & Soluções Inteligente. Todos os direitos reservados.

---

## 🤝 Contribuição

1. Faça um fork do projeto
2. Crie uma branch: `git checkout -b feature/nova-feature`
3. Commit suas mudanças: `git commit -m 'Adiciona nova feature'`
4. Push para a branch: `git push origin feature/nova-feature`
5. Abra um Pull Request

---

## 📞 Suporte

Em caso de dúvidas ou problemas:

- Email: suporte@glef.app
- Documentação: https://docs.glef.app
- Issues: https://github.com/GlefGestoes/base-teste-app

---

**Versão:** 1.0.0  
**Última atualização:** 2026
