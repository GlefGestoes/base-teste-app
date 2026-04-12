/**
 * ============================================
 * MOCK SERVICE
 * Simula API para desenvolvimento local
 * ============================================
 * 
 * Este serviço retorna dados fictícios para permitir
 * desenvolvimento sem backend ativo.
 */

const MockService = {
  // ==========================================
  // DADOS MOCKADOS
  // ==========================================
  
	USERS: (() => {
	  try {
		return JSON.parse(localStorage.getItem('amz_mock_users')) || [
		  { id: 1, name: 'Administrador', email: 'glef.gestoes@gmail.com', password: '!@#Amz_App', role: 'administrador', avatar: null },
		  { id: 2, name: 'João Vendedor', email: 'vendedor@amz.app', password: 'vendedor123', role: 'vendedor', avatar: null },
		  { id: 3, name: 'Maria Técnica', email: 'tecnico@amz.app', password: 'tecnico123', role: 'tecnico', avatar: null },
		  { id: 4, name: 'Carlos Cliente', email: 'cliente@amz.app', password: 'cliente123', role: 'cliente', avatar: null }
		];
	  } catch {
		return [];
	  }
	})(),

  GENERATORS: [
    { id: 'G-001', name: 'Principal - Alfa', client: 'Indústria XYZ Ltda', status: 'online', temperature: 72, power: 85, voltage: 220, current: 45, fuel: 78, hours: 1247, lastMaintenance: '2024-01-15' },
    { id: 'G-002', name: 'Secundário - Beta', client: 'Comércio ABC', status: 'online', temperature: 68, power: 62, voltage: 220, current: 32, fuel: 45, hours: 892, lastMaintenance: '2024-02-01' },
    { id: 'G-003', name: 'Backup - Gama', client: 'Hospital São Lucas', status: 'offline', temperature: 25, power: 0, voltage: 0, current: 0, fuel: 92, hours: 2341, lastMaintenance: '2023-12-20' },
    { id: 'G-004', name: 'Emergência - Delta', client: 'Shopping Center', status: 'alert', temperature: 89, power: 95, voltage: 218, current: 52, fuel: 23, hours: 567, lastMaintenance: '2024-02-20' },
    { id: 'G-005', name: 'Industrial - Épsilon', client: 'Fábrica Metalúrgica', status: 'error', temperature: 105, power: 0, voltage: 0, current: 0, fuel: 15, hours: 4521, lastMaintenance: '2023-11-10' },
    { id: 'G-006', name: 'Reserva - Zeta', client: 'Escola Técnica', status: 'online', temperature: 65, power: 45, voltage: 220, current: 22, fuel: 88, hours: 445, lastMaintenance: '2024-02-25' }
  ],

  ALERTS: [
    { id: 1, type: 'error', title: 'Temperatura Crítica', description: 'Gerador G-005 excedeu temperatura máxima (105°C)', generatorId: 'G-005', date: new Date(Date.now() - 1000 * 60 * 5).toISOString(), read: false },
    { id: 2, type: 'warning', title: 'Nível de Combustível Baixo', description: 'Gerador G-004 está com apenas 23% de combustível', generatorId: 'G-004', date: new Date(Date.now() - 1000 * 60 * 30).toISOString(), read: false },
    { id: 3, type: 'info', title: 'Manutenção Preventiva', description: 'Gerador G-003 está programado para manutenção', generatorId: 'G-003', date: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), read: true },
    { id: 4, type: 'warning', title: 'Queda de Tensão Detectada', description: 'Flutuação de tensão no gerador G-002', generatorId: 'G-002', date: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(), read: true },
    { id: 5, type: 'success', title: 'Manutenção Concluída', description: 'Gerador G-001 passou por manutenção preventiva', generatorId: 'G-001', date: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), read: true }
  ],

  CLIENTS: [
    { id: 1, name: 'Indústria XYZ Ltda', email: 'contato@industriaxyz.com.br', phone: '(11) 3333-4444', type: 'empresa', document: '12.345.678/0001-90', address: 'Av. Industrial, 1000 - São Paulo, SP', generators: 2, contract: 'Ativo', createdAt: '2023-01-15' },
    { id: 2, name: 'Comércio ABC', email: 'admin@comercioabc.com.br', phone: '(11) 2222-3333', type: 'empresa', document: '98.765.432/0001-10', address: 'Rua Comercial, 500 - São Paulo, SP', generators: 1, contract: 'Ativo', createdAt: '2023-03-20' },
    { id: 3, name: 'Hospital São Lucas', email: 'infra@hospitalsaolucas.org', phone: '(11) 4444-5555', type: 'instituicao', document: '56.789.012/0001-34', address: 'Av. da Saúde, 2000 - São Paulo, SP', generators: 1, contract: 'Ativo', createdAt: '2022-08-10' },
    { id: 4, name: 'Shopping Center', email: 'manutencao@shoppingcenter.com', phone: '(11) 5555-6666', type: 'empresa', document: '34.567.890/0001-12', address: 'Av. do Shopping, 3000 - São Paulo, SP', generators: 1, contract: 'Ativo', createdAt: '2023-06-05' },
    { id: 5, name: 'Fábrica Metalúrgica', email: 'contato@metalurgica.com.br', phone: '(11) 6666-7777', type: 'empresa', document: '78.901.234/0001-56', address: 'Rua da Indústria, 1500 - São Paulo, SP', generators: 1, contract: 'Suspenso', createdAt: '2022-11-30' },
    { id: 6, name: 'Escola Técnica', email: 'direcao@escolatecnica.edu.br', phone: '(11) 7777-8888', type: 'instituicao', document: '90.123.456/0001-78', address: 'Av. da Educação, 800 - São Paulo, SP', generators: 1, contract: 'Ativo', createdAt: '2023-09-12' }
  ],

  ACTIVITIES: [
    { id: 1, user: 'Administrador', action: 'login', description: 'Login realizado com sucesso', date: new Date(Date.now() - 1000 * 60 * 5).toISOString() },
    { id: 2, user: 'Sistema', action: 'alert', description: 'Alerta de temperatura crítica no G-005', date: new Date(Date.now() - 1000 * 60 * 15).toISOString() },
    { id: 3, user: 'Maria Técnica', action: 'update', description: 'Atualizou dados do gerador G-002', date: new Date(Date.now() - 1000 * 60 * 45).toISOString() },
    { id: 4, user: 'João Vendedor', action: 'create', description: 'Novo cliente: Escola Técnica', date: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString() },
    { id: 5, user: 'Sistema', action: 'maintenance', description: 'Manutenção preventiva agendada para G-003', date: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString() }
  ],

  // ==========================================
  // MÉTODOS PÚBLICOS
  // ==========================================

  /**
   * Simula delay de rede
   */
  async delay() {
    const [min, max] = window.CONFIG?.MOCK?.DELAY || [200, 800];
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * Simula erro aleatório
   */
  shouldError() {
    const rate = window.CONFIG?.MOCK?.ERROR_RATE || 0;
    return Math.random() < rate;
  },

  /**
   * Gera resposta de sucesso
   */
  success(data) {
    return { success: true, data };
  },

  /**
   * Gera resposta de erro
   */
  error(message) {
    return { success: false, error: message };
  },

  // ==========================================
  // ENDPOINTS
  // ==========================================

  /**
   * Login
   */
  async login(email, password) {
    await this.delay();
    
    if (this.shouldError()) {
      return this.error('Erro de conexão simulado');
    }

	//Recarrega do localStorage para garantir que pegou o novo cadastro
    const currentUsers = this.getUsers();
	// Procura no array atualizado
    const user = currentUsers.find(u => u.email === email && u.password === password);
	
    
    if (!user) {
      return this.error('Credenciais inválidas');
    }

    const token = this.generateToken(user);
    const refreshToken = this.generateRefreshToken();

    return this.success({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
		isPending: user.isPending,
        avatar: user.avatar
      },
      token,
      refreshToken,
      expiresIn: 3600
    });
  },
  
  /**
 * Registro de novo usuário
 */
	async register(user) {
	  await this.delay();

	  if (this.shouldError()) {
		return this.error('Erro de conexão simulado');
	  }

		const currentUsers = this.getUsers();

	  // verifica se email já existe
	  const exists = currentUsers.find(u => u.email === user.email);
	  if (exists) {
		return this.error('Email já cadastrado');
	  }

	  const newUser = {
		id: Date.now(),
		name: user.name,
		email: user.email,
		password: user.password,
		role: user.role || 'cliente',
		isPending: user.isPending || false,
		avatar: null
	  };

	  currentUsers.push(newUser);

	  // sincroniza memória + storage
	  this.USERS = currentUsers;
	  this.saveUsers(currentUsers);

	  return this.success({
		id: newUser.id,
		name: newUser.name,
		email: newUser.email,
		role: newUser.role,
		isPending: newUser.isPending
	  });
	},

  /**
   * Obtém perfil do usuário
   */
	async getProfile() {
	  await this.delay();
	  
	  const token = localStorage.getItem(window.CONFIG?.AUTH?.TOKEN_KEY);
	  if (!token) return this.error('Não autenticado');

	  const payload = JSON.parse(atob(token.split('.')[1]));

	  const users = this.getUsers(); // ✅ correto
	  const user = users.find(u => u.id === payload.sub);

	  if (!user) return this.error('Usuário não encontrado');

	  return this.success({
		id: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
		avatar: user.avatar
	  });
	},

  /**
   * Lista geradores
   */
  async getGenerators() {
    await this.delay();
    return this.success(this.GENERATORS);
  },

  /**
   * Obtém detalhes de um gerador
   */
  async getGenerator(id) {
    await this.delay();
    const generator = this.GENERATORS.find(g => g.id === id);
    if (!generator) return this.error('Gerador não encontrado');
    return this.success(generator);
  },

  /**
   * Lista alertas
   */
  async getAlerts() {
    await this.delay();
    return this.success(this.ALERTS);
  },

  /**
   * Lista clientes
   */
  async getClients() {
    await this.delay();
    return this.success(this.CLIENTS);
  },

  /**
   * Obtém detalhes de um cliente
   */
  async getClient(id) {
    await this.delay();
    const client = this.CLIENTS.find(c => c.id === parseInt(id));
    if (!client) return this.error('Cliente não encontrado');
    return this.success(client);
  },

  /**
   * Lista atividades
   */
  async getActivities() {
    await this.delay();
    return this.success(this.ACTIVITIES);
  },

  /**
   * Resumo do dashboard
   */
  async getDashboardSummary() {
    await this.delay();
    
    const totalGenerators = this.GENERATORS.length;
    const online = this.GENERATORS.filter(g => g.status === 'online').length;
    const alerts = this.ALERTS.filter(a => !a.read).length;
    const totalClients = this.CLIENTS.length;

    return this.success({
      stats: {
        generators: { total: totalGenerators, online, offline: totalGenerators - online },
        alerts: { total: this.ALERTS.length, unread: alerts },
        clients: { total: totalClients, active: totalClients },
        maintenance: { pending: 3, completed: 12 }
      },
      recentGenerators: this.GENERATORS.slice(0, 4),
      recentAlerts: this.ALERTS.slice(0, 5),
      recentActivities: this.ACTIVITIES.slice(0, 5)
    });
  },
  
  // ==========================================
	// HELPERS DE STORAGE
	// ==========================================

	getUsers() {
	  try {
		return JSON.parse(localStorage.getItem('amz_mock_users')) || this.USERS;
	  } catch {
		return this.USERS;
	  }
	},

	saveUsers(users) {
	  this.USERS = users;
	  localStorage.setItem('amz_mock_users', JSON.stringify(users));
	},

  // ==========================================
  // UTILITÁRIOS
  // ==========================================

  generateToken(user) {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({
      sub: user.id,
      email: user.email,
      role: user.role,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600
    }));
    const signature = btoa('mock-signature');
    return `${header}.${payload}.${signature}`;
  },

  generateRefreshToken() {
    return btoa(`refresh-${Date.now()}-${Math.random()}`);
  }
};

// Exporta globalmente
window.MockService = MockService;

