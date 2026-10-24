/**
 * Hedge Client Adapter for Old Dashboard UI (dashboard.html)
 * Implements window.hedgeClient using DerivBrowserClient + FourBotStrategy
 */

class HedgeClientAdapter {
  constructor() {
    this.client = new DerivBrowserClient();
    this.strategy = null;
    this.logBuffer = [];
    this.bot21LogBuffer = [];
    this.MAX_LOGS = 100;

    // Patch console.log and error to capture log buffer for UI
    const origLog = console.log;
    const origErr = console.error;

    console.log = (...args) => {
      origLog.apply(console, args);
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
      const time = new Date().toLocaleTimeString();
      const line = `[${time}] ${msg}`;
      this.logBuffer.unshift(line);
      if (this.logBuffer.length > this.MAX_LOGS) this.logBuffer.pop();

      if (msg.includes('[Bot') || msg.includes('Trade')) {
        this.bot21LogBuffer.unshift(line);
        if (this.bot21LogBuffer.length > this.MAX_LOGS) this.bot21LogBuffer.pop();
      }
    };

    console.error = (...args) => {
      origErr.apply(console, args);
      const msg = args.map(a => typeof a === 'object' ? (a.message || JSON.stringify(a)) : a).join(' ');
      const time = new Date().toLocaleTimeString();
      const line = `[${time}] ❌ ${msg}`;
      this.logBuffer.unshift(line);
      if (this.logBuffer.length > this.MAX_LOGS) this.logBuffer.pop();

      // Show error in live trading terminal
      this.bot21LogBuffer.unshift(line);
      if (this.bot21LogBuffer.length > this.MAX_LOGS) this.bot21LogBuffer.pop();
    };

    // Initialize strategy immediately so UI cards render without waiting for connection!
    this.initStrategy();

    // Auto connect if saved credentials exist
    const appId = localStorage.getItem('hedge_app_id') || localStorage.getItem('deriv_app_id') || '1089';
    const token = localStorage.getItem('hedge_api_token') || localStorage.getItem('deriv_api_token') || '';
    if (token) {
      setTimeout(() => this.connect(appId, token), 300);
    }
  }

  async connect(appId, token) {
    if (appId) {
      localStorage.setItem('hedge_app_id', appId);
      localStorage.setItem('deriv_app_id', appId);
    }
    if (token) {
      localStorage.setItem('hedge_api_token', token);
      localStorage.setItem('deriv_api_token', token);
    }

    try {
      await this.client.connect(appId, token);
      this.initStrategy();
      return { success: true };
    } catch(err) {
      console.error('HedgeClient Connect Error:', err.message);
      throw err;
    }
  }

  initStrategy() {
    if (!window.FourBotStrategy) return;
    if (!this.strategy) {
      this.strategy = new FourBotStrategy();
      this.strategy.onStart(this.client);

      // Subscribe symbols if client is ready
      const symbols = [...new Set(this.strategy.strategies.map(s => s.symbol || 'R_100'))];
      symbols.forEach(sym => {
        if (this.client && this.client.isConnected) {
          this.client.subscribeTicks(sym);
        }
      });

      // Forward ticks
      this.client.on('tick', (tick) => {
        if (this.strategy) {
          this.strategy.onTick({
            quote: parseFloat(tick.quote),
            symbol: tick.symbol,
            epoch: tick.epoch
          }).catch(() => {});
        }
      });

      // Forward live contract updates immediately for zero-latency cashout
      this.client.on('contractUpdate', (poc) => {
        if (this.strategy && poc && poc.contract_id) {
          this.strategy.strategies.forEach(s => {
            if (s.isRunning && String(s.activeContractId) === String(poc.contract_id) && typeof s.onContractUpdate === 'function') {
              s.onContractUpdate(poc);
            }
          });
        }
      });
    } else {
      // Re-bind client across all strategies if needed
      this.strategy.strategies.forEach(s => {
        if (!s.client) s.client = this.client;
      });
    }
  }

  getStatus() {
    if (!this.strategy) this.initStrategy();
    if (!this.strategy) return { error: 'Initializing', connected: this.client.isConnected };

    const bots = this.strategy.strategies.map(s => {
      const baseConfig = {
        stake: s.baseStake || s.stake || 0.35,
        symbol: s.symbol || 'R_100',
        prediction: s.prediction,
        stopLoss: s.stopLoss,
        takeProfit: s.takeProfit,
        martingaleStakes: s.martingaleStakes || [],
        triggerDigit: s.triggerDigit !== undefined ? s.triggerDigit : 5,
        triggerOperator: s.triggerOperator || '=',
        duration: s.duration || 1
      };

      if (s.id === 31 || s.id === 32 || s.id === 33 || s.id === 34) {
        baseConfig.pattern = (s.tradePattern || []).join(', ');
        baseConfig.interval = s.minInterval;
        baseConfig.maxTotalStake = s.maxTotalStake;
        baseConfig.isRandom = s.isRandom;
        if (s.id === 33 || s.id === 34) baseConfig.barrier = s.barrier;
      }

      if (s.id >= 35 && s.id <= 44) {
        baseConfig.consecutiveCount = s.consecutiveCount;
        baseConfig.martingaleStakes = (s.martingaleStakes || []).join(', ');
      }

      if (s.id === 75) {
        baseConfig.digits = (s.predictionDigits || []).join(', ');
        baseConfig.tradeInterval = s.tradeInterval;
        baseConfig.maxTotalStake = s.maxTotalStake;
      }

      if ((s.id >= 86 && s.id <= 95) || (s.id >= 96 && s.id <= 109)) {
        baseConfig.growthRate = s.growthRate;
        baseConfig.targetTicks = s.targetTicks;
        baseConfig.maxCycles = s.maxCycles;
      }

        if (s.id >= 76 && s.id <= 85) {
        baseConfig.higherBarrier = s.higherBarrier;
        baseConfig.lowerBarrier = s.lowerBarrier;
        baseConfig.triggerDigit = s.triggerDigit;
        baseConfig.triggerOperator = s.triggerOperator;
        baseConfig.martingaleStakes = s.martingaleStakes;
        baseConfig.duration = s.duration;
      }

      return {
        id: s.id,
        name: s.name,
        isRunning: s.isRunning,
        profit: s.sessionProfit || s.profit || 0,
        config: baseConfig
      };
    });

    const totalProfit = this.strategy.strategies.reduce((a, b) => a + (b.sessionProfit || b.profit || 0), 0);

    return {
      bots,
      totalProfit,
      connected: this.client.isConnected && this.client.isAuthorized
    };
  }

  updateBot(id, config) {
    if (!this.strategy) return;
    const numId = parseInt(id, 10);
    const bot = this.strategy.strategies.find(s => s.id === numId);
    if (!bot) return;

    if (config.symbol) {
      bot.symbol = config.symbol;
      this.client.subscribeTicks(config.symbol);
    }
    if (config.stake !== undefined && !isNaN(parseFloat(config.stake))) {
      const st = parseFloat(config.stake);
      bot.baseStake = st;
      bot.stake = st;
    }
    if (config.duration !== undefined && !isNaN(parseInt(config.duration))) {
      bot.duration = parseInt(config.duration);
    }
    if (config.prediction !== undefined) bot.prediction = config.prediction;
    if (config.barrier !== undefined) bot.barrier = config.barrier;
    if (config.higherBarrier !== undefined) bot.higherBarrier = config.higherBarrier;
    if (config.lowerBarrier !== undefined) bot.lowerBarrier = config.lowerBarrier;
      if (config.growthRate !== undefined && !isNaN(parseFloat(config.growthRate))) {
        bot.growthRate = parseFloat(config.growthRate);
      }
      if (config.targetTicks !== undefined && !isNaN(parseInt(config.targetTicks))) {
        bot.targetTicks = parseInt(config.targetTicks);
      }
      if (config.maxCycles !== undefined && !isNaN(parseInt(config.maxCycles))) {
        bot.maxCycles = parseInt(config.maxCycles);
      }

    if (config.takeProfit !== undefined && !isNaN(parseFloat(config.takeProfit))) {
      bot.takeProfit = parseFloat(config.takeProfit);
    }
    if (config.stopLoss !== undefined && !isNaN(parseFloat(config.stopLoss))) {
      bot.stopLoss = parseFloat(config.stopLoss);
    }
    if (typeof bot.updateConfig === 'function') {
      bot.updateConfig(config);
    }

    if (config.triggerDigit !== undefined && !isNaN(parseInt(config.triggerDigit))) {
      bot.triggerDigit = parseInt(config.triggerDigit);
    }
    if (config.triggerOperator) bot.triggerOperator = config.triggerOperator;

    if (config.martingaleStakes && typeof config.martingaleStakes === 'string') {
      const arr = config.martingaleStakes.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
      if (arr.length > 0) {
        bot.martingaleStakes = arr;
        bot.maxMartingaleLevel = arr.length - 1;
      }
    }
    if (config.martingaleStr && typeof config.martingaleStr === 'string') {
      const arr = config.martingaleStr.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
      if (arr.length > 0) {
        bot.martingaleStakes = arr;
        bot.maxMartingaleLevel = arr.length - 1;
      }
    }

    if (config.pattern !== undefined) {
      if (typeof config.pattern === 'string') {
        bot.tradePattern = config.pattern.split(',').map(p => p.trim()).filter(Boolean);
      } else if (Array.isArray(config.pattern)) {
        bot.tradePattern = config.pattern;
      }
    }

    if (config.consecutiveCount !== undefined && !isNaN(parseInt(config.consecutiveCount))) {
      bot.consecutiveCount = parseInt(config.consecutiveCount);
    }

    if (config.digits && typeof config.digits === 'string') {
      bot.predictionDigits = config.digits.split(',').map(d => parseInt(d.trim())).filter(n => !isNaN(n));
    }

    if (config.maxTotalStake !== undefined && !isNaN(parseFloat(config.maxTotalStake))) {
      bot.maxTotalStake = parseFloat(config.maxTotalStake);
    }

    if (config.interval !== undefined && !isNaN(parseInt(config.interval))) {
      bot.minInterval = parseInt(config.interval);
    }
    if (config.tradeInterval !== undefined && !isNaN(parseInt(config.tradeInterval))) {
      bot.tradeInterval = parseInt(config.tradeInterval);
    }

    console.log(`✅ [Bot ${id}] Configuration Updated.`);
  }

  startBot(id) {
    if (!this.strategy) this.initStrategy();
    if (!this.strategy) return;
    const numId = parseInt(id, 10);
    const bot = this.strategy.strategies.find(s => s.id === numId);
    if (!bot || bot.isRunning) return;

    if (!this.client.isConnected || !this.client.isAuthorized) {
      const savedToken = localStorage.getItem('hedge_api_token') || localStorage.getItem('deriv_api_token') || '';
      const savedAppId = localStorage.getItem('hedge_app_id') || localStorage.getItem('deriv_app_id') || '1089';
      if (!savedToken) {
        alert('⚠️ Please enter your Deriv API Token in Settings to start trading!');
        if (typeof openSettings === 'function') openSettings();
        return;
      }
      console.log(`[Bot ${id}] Connecting to Deriv before starting trade...`);
      this.connect(savedAppId, savedToken).then(() => {
        bot.start();
      }).catch(err => {
        alert(`❌ Deriv Connection Failed: ${err.message || err}. Please verify your API Token.`);
      });
      return;
    }

    bot.start();
  }

  stopBot(id) {
    if (!this.strategy) return;
    const numId = parseInt(id, 10);
    const bot = this.strategy.strategies.find(s => s.id === numId);
    if (bot && bot.isRunning) bot.stop();
  }

  startAll() {
    if (!this.strategy) this.initStrategy();
    if (!this.strategy) return;

    if (!this.client.isConnected || !this.client.isAuthorized) {
      const savedToken = localStorage.getItem('hedge_api_token') || localStorage.getItem('deriv_api_token') || '';
      const savedAppId = localStorage.getItem('hedge_app_id') || localStorage.getItem('deriv_app_id') || '1089';
      if (!savedToken) {
        alert('⚠️ Please enter your Deriv API Token in Settings to start trading!');
        if (typeof openSettings === 'function') openSettings();
        return;
      }
      console.log('Connecting to Deriv before starting all bots...');
      this.connect(savedAppId, savedToken).then(() => {
        this.strategy.strategies.forEach(b => { if (!b.isRunning) b.start(); });
      }).catch(err => {
        alert(`❌ Deriv Connection Failed: ${err.message || err}`);
      });
      return;
    }

    this.strategy.strategies.forEach(b => { if (!b.isRunning) b.start(); });
  }

  stopAll() {
    if (!this.strategy) return;
    this.strategy.strategies.forEach(b => { if (b.isRunning) b.stop(); });
  }

  getLogs() {
    return { logs: this.logBuffer };
  }

  getBot21Logs() {
    return { logs: this.bot21LogBuffer };
  }
}

window.hedgeClient = new HedgeClientAdapter();
