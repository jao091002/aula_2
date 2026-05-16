class DatabaseManager {
  constructor(storageKey = 'imc_db') {
    this.storageKey = storageKey;
    this.db = this.initialize();
    this.maxRecords = 1000;
    this.syncInterval = 30000; // 30 segundos
    this.startAutoSync();
  }

  /**
   * Inicializa o banco de dados
   * @returns {Object} Estrutura do banco
   */
  initialize() {
    const stored = this.getStoredData();
    if (stored && this.validateSchema(stored)) {
      return stored;
    }
    return this.createSchema();
  }

  /**
   * Cria schema padrão do banco
   * @returns {Object} Schema inicial
   */
  createSchema() {
    return {
      version: '2.0',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      users: {},
      globalStats: {
        totalCalculations: 0,
        averageBmi: 0,
        lastUpdated: null
      },
      backups: []
    };
  }

  /**
   * Valida estrutura do banco
   * @param {Object} data - Dados a validar
   * @returns {boolean}
   */
  validateSchema(data) {
    return data && 
           typeof data === 'object' && 
           data.version && 
           data.users && 
           typeof data.users === 'object';
  }

  /**
   * Obtém dados armazenados
   * @returns {Object|null}
   */
  getStoredData() {
    try {
      const data = localStorage.getItem(this.storageKey);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error('❌ Erro ao ler dados:', e);
      return null;
    }
  }

  /**
   * Salva dados com validação
   * @returns {boolean}
   */
  save() {
    try {
      this.db.updated = new Date().toISOString();
      localStorage.setItem(this.storageKey, JSON.stringify(this.db));
      this.syncWithServer();
      return true;
    } catch (e) {
      console.error('❌ Erro ao salvar:', e);
      return false;
    }
  }

  /**
   * Sincroniza com servidor (dados.json)
   */
  syncWithServer() {
    try {
      fetch('dados.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.db)
      }).catch(() => {}); // Silent fail
    } catch (e) {}
  }

  /**
   * Inicia sincronização automática
   */
  startAutoSync() {
    this.syncTimer = setInterval(() => this.syncWithServer(), this.syncInterval);
  }

  /**
   * Para sincronização automática
   */
  stopAutoSync() {
    clearInterval(this.syncTimer);
  }

  /**
   * Sanitiza entrada para segurança
   * @param {*} input - Entrada a sanitizar
   * @returns {*} Entrada sanitizada
   */
  sanitize(input) {
    if (typeof input === 'string') {
      return input
        .trim()
        .replace(/[<>\"']/g, '')
        .substring(0, 100);
    }
    if (typeof input === 'number') {
      return Math.max(0, Math.min(999, Number(input)));
    }
    return input;
  }

  /**
   * Obtém ID único para usuário
   * @returns {string}
   */
  getUserId() {
    let userId = localStorage.getItem('imc_user_id');
    if (!userId) {
      userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('imc_user_id', userId);
    }
    return userId;
  }

  /**
   * Cria/obtém usuário
   * @param {string} userId
   * @returns {Object}
   */
  ensureUser(userId) {
    userId = this.sanitize(userId);
    if (!this.db.users[userId]) {
      this.db.users[userId] = {
        id: userId,
        created: new Date().toISOString(),
        lastAccess: new Date().toISOString(),
        calculations: [],
        stats: {
          total: 0,
          averageBmi: 0,
          minBmi: null,
          maxBmi: null
        }
      };
    }
    this.db.users[userId].lastAccess = new Date().toISOString();
    return this.db.users[userId];
  }

  /**
   * Adiciona cálculo de IMC
   * @param {Object} data - {peso, altura, bmi, classificacao}
   * @returns {Object|null}
   */
  addCalculation(data) {
    try {
      const userId = this.getUserId();
      const user = this.ensureUser(userId);

      const calculation = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        peso: this.sanitize(parseFloat(data.peso)),
        altura: this.sanitize(parseFloat(data.altura)),
        bmi: this.sanitize(parseFloat(data.bmi)),
        classificacao: {
          text: this.sanitize(data.classificacao.text),
          color: /^#[0-9A-F]{6}$/i.test(data.classificacao.color) 
            ? data.classificacao.color 
            : '#00d4ff'
        }
      };

      // Limite de registros por usuário
      if (user.calculations.length >= 500) {
        user.calculations.shift();
      }

      user.calculations.unshift(calculation);
      this.updateUserStats(userId);
      this.updateGlobalStats();
      this.save();

      return calculation;
    } catch (e) {
      console.error('❌ Erro ao adicionar cálculo:', e);
      return null;
    }
  }

  /**
   * Atualiza estatísticas do usuário
   * @param {string} userId
   */
  updateUserStats(userId) {
    const user = this.db.users[userId];
    if (!user || user.calculations.length === 0) return;

    const bmis = user.calculations.map(c => c.bmi);
    user.stats.total = bmis.length;
    user.stats.averageBmi = (bmis.reduce((a, b) => a + b, 0) / bmis.length).toFixed(2);
    user.stats.minBmi = Math.min(...bmis).toFixed(2);
    user.stats.maxBmi = Math.max(...bmis).toFixed(2);
  }

  /**
   * Atualiza estatísticas globais
   */
  updateGlobalStats() {
    const allCalcs = Object.values(this.db.users)
      .flatMap(u => u.calculations);
    
    this.db.globalStats.totalCalculations = allCalcs.length;
    
    if (allCalcs.length > 0) {
      const bmis = allCalcs.map(c => c.bmi);
      this.db.globalStats.averageBmi = (bmis.reduce((a, b) => a + b, 0) / bmis.length).toFixed(2);
    }
    
    this.db.globalStats.lastUpdated = new Date().toISOString();
  }

  /**
   * Obtém histórico do usuário
   * @returns {Array}
   */
  getUserHistory() {
    const userId = this.getUserId();
    const user = this.db.users[userId];
    return user ? user.calculations : [];
  }

  /**
   * Obtém todos os usuários (admin)
   * @returns {Array}
   */
  getAllUsers() {
    return Object.values(this.db.users)
      .map(u => ({
        id: u.id.substring(0, 15) + '...',
        created: u.created,
        totalCalcs: u.calculations.length,
        avgBmi: u.stats.averageBmi,
        lastAccess: u.lastAccess
      }))
      .sort((a, b) => new Date(b.lastAccess) - new Date(a.lastAccess));
  }

  /**
   * Obtém estatísticas globais
   * @returns {Object}
   */
  getGlobalStats() {
    return {
      totalUsers: Object.keys(this.db.users).length,
      totalCalculations: this.db.globalStats.totalCalculations,
      averageBmi: this.db.globalStats.averageBmi,
      lastUpdated: this.db.globalStats.lastUpdated
    };
  }

  /**
   * Cria backup
   * @returns {Object}
   */
  createBackup() {
    const backup = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      data: JSON.parse(JSON.stringify(this.db))
    };
    
    if (this.db.backups.length >= 10) {
      this.db.backups.shift();
    }
    
    this.db.backups.push(backup);
    this.save();
    
    return backup;
  }

  /**
   * Restaura backup
   * @param {number} backupId
   * @returns {boolean}
   */
  restoreBackup(backupId) {
    const backup = this.db.backups.find(b => b.id === backupId);
    if (!backup) return false;
    
    this.db = JSON.parse(JSON.stringify(backup.data));
    this.save();
    return true;
  }

  /**
   * Exporta dados em CSV
   * @returns {string}
   */
  exportToCSV() {
    const userId = this.getUserId();
    const user = this.db.users[userId];
    
    if (!user || user.calculations.length === 0) {
      return 'Data/Hora,Peso (kg),Altura (m),IMC,Classificação\n';
    }

    const header = 'Data/Hora,Peso (kg),Altura (m),IMC,Classificação\n';
    const rows = user.calculations
      .map(c => `"${c.timestamp}",${c.peso},${c.altura},${c.bmi},"${c.classificacao.text}"`)
      .join('\n');
    
    return header + rows;
  }

  /**
   * Limpa histórico do usuário
   * @returns {boolean}
   */
  clearUserHistory() {
    const userId = this.getUserId();
    const user = this.db.users[userId];
    if (user) {
      user.calculations = [];
      user.stats = { total: 0, averageBmi: 0, minBmi: null, maxBmi: null };
      this.updateGlobalStats();
      this.save();
      return true;
    }
    return false;
  }

  /**
   * Remove usuário (admin)
   * @param {string} userId
   * @returns {boolean}
   */
  removeUser(userId) {
    if (this.db.users[userId]) {
      delete this.db.users[userId];
      this.updateGlobalStats();
      this.save();
      return true;
    }
    return false;

    
  }

  /**
   * Obtém estatísticas de uso
   * @returns {Object}
   */
  getUsageStats() {
    const users = Object.values(this.db.users);
    const totalCalcs = users.reduce((sum, u) => sum + u.calculations.length, 0);
    const activeUsers = users.filter(u => {
      const lastAccess = new Date(u.lastAccess);
      const hourAgo = new Date(Date.now() - 3600000);
      return lastAccess > hourAgo;
    }).length;

    return {
      totalUsers: users.length,
      activeUsers,
      totalCalculations: totalCalcs,
      averageCalcsPerUser: (totalCalcs / Math.max(1, users.length)).toFixed(2),
      topUser: users.length > 0 
        ? users.reduce((max, u) => u.calculations.length > max.calculations.length ? u : max).id.substring(0, 15)
        : 'N/A'
    };
  }
}

// Inicializa gerenciador global
const db = new DatabaseManager();
