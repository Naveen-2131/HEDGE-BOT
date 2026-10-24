const fs = require('fs');
const path = require('path');

const basePath = 'C:/Users/ADMIN/Desktop/HEDGE-BOT-main/8-Hedge-Bot';
const derivClientPath = path.join(basePath, 'public/js/deriv-client.js');
const hedgeClientPath = path.join(basePath, 'public/js/hedge-client.js');
const fourBotPath = path.join(basePath, 'public/js/4bot-browser.js');
const indexHtmlPath = path.join(basePath, 'public/index.html');
const dashHtmlPath = path.join(basePath, 'public/dashboard.html');

console.log('--- 1. Updating deriv-client.js with derivWS.js methods and events ---');
let derivClient = fs.readFileSync(derivClientPath, 'utf8');

// Ensure msg_type switch has all handlers: proposal, buy, proposal_open_contract, sell
const oldMsgSwitch = /switch\s*\(msg\.msg_type\)\s*\{[\s\S]*?break;\s*\}/;
const newMsgSwitch = `switch (msg.msg_type) {
      case 'balance':
        if (msg.balance) {
          this.balance = parseFloat(msg.balance.balance);
          this.currency = msg.balance.currency;
          this.emit('balanceUpdate', { balance: this.balance, currency: this.currency });
        }
        break;

      case 'tick':
        if (msg.tick) this.emit('tick', msg.tick);
        break;

      case 'proposal':
        if (msg.proposal) {
          this.emit('proposal', {
            ...msg.proposal,
            echo_req: msg.echo_req
          });
        }
        break;

      case 'buy':
        if (msg.buy) {
          this.emit('buy', {
            ...msg.buy,
            echo_req: msg.echo_req
          });
        }
        break;

      case 'proposal_open_contract':
        if (msg.proposal_open_contract) {
          const poc = msg.proposal_open_contract;
          const cidStr = String(poc.contract_id);
          const isSold = Boolean(poc.is_sold || poc.status !== 'open');

          let ticks = 0;
          const p = parseFloat(poc.profit || 0);
          const s = parseFloat(poc.buy_price || poc.stake || 1.0);
          const g = parseFloat(poc.growth_rate || 0.05);
          if (p > 0 && s > 0 && g > 0) {
            ticks = Math.round(Math.log((p + s) / s) / Math.log(1 + g));
          }
          if (poc.tick_stream && Array.isArray(poc.tick_stream)) {
            const stTicks = Math.max(0, poc.tick_stream.length - 1);
            if (stTicks > ticks) ticks = stTicks;
          }
          if (poc.tick_passed !== undefined && poc.tick_passed !== null) {
            const tp = parseInt(poc.tick_passed, 10) || 0;
            if (tp > ticks) ticks = tp;
          }

          const data = {
            contract_id: poc.contract_id,
            is_sold: isSold,
            profit: p,
            status: poc.status,
            tick_passed: ticks,
            ticks: ticks,
            growth_rate: g,
            stake: s,
            is_valid_to_sell: Boolean(poc.is_valid_to_sell)
          };

          this.openContractsCache.set(cidStr, data);
          this.openContractsCache.set(poc.contract_id, data);

          this.emit('proposalOpenContract', poc);
          this.emit('contractUpdate', poc);
        }
        break;

      case 'sell':
        if (msg.sell) {
          this.emit('sell', {
            ...msg.sell,
            echo_req: msg.echo_req
          });
        }
        break;
    }`;

derivClient = derivClient.replace(oldMsgSwitch, newMsgSwitch);

// Add methods: buyAccumulatorDirect, buyContract, requestAccumulatorProposal, subscribeOpenContract, sellContract, forgetAllSubscriptions, getPortfolio
const derivMethodsToAdd = `
  // ── Exact methods from derivWS.js for AccumulatorBotEngine ──────
  buyAccumulatorDirect({ symbol, stake, growthRate, currency = 'USD' }) {
    const cleanSymbol = (symbol || 'R_100').trim();
    const rate = parseFloat(growthRate) || 0.05;
    const amount = parseFloat(stake) || 1.0;
    const curr = currency || this.currency || 'USD';

    const req = {
      buy: 1,
      price: amount,
      parameters: {
        amount: amount,
        basis: 'stake',
        contract_type: 'ACCU',
        currency: curr,
        underlying_symbol: cleanSymbol,
        growth_rate: rate
      }
    };
    if (this.token && !this.token.startsWith('pat_')) {
      req.parameters.symbol = cleanSymbol;
    }
    return this.send(req);
  }

  buyContract(proposalId, price) {
    return this.send({
      buy: proposalId,
      price: parseFloat(price)
    });
  }

  requestAccumulatorProposal({ symbol, stake, growthRate, currency = 'USD' }) {
    const cleanSymbol = (symbol || 'R_100').trim();
    const rate = parseFloat(growthRate) || 0.05;
    const amount = parseFloat(stake) || 1.0;
    const curr = currency || this.currency || 'USD';

    const req = {
      proposal: 1,
      amount: amount,
      basis: 'stake',
      contract_type: 'ACCU',
      currency: curr,
      underlying_symbol: cleanSymbol,
      growth_rate: rate
    };
    if (this.token && !this.token.startsWith('pat_')) {
      req.symbol = cleanSymbol;
    }
    return this.send(req);
  }

  subscribeOpenContract(contractId) {
    if (this._isSubscribedToOpenContracts) {
      return Promise.resolve({ already_subscribed: true });
    }
    this._isSubscribedToOpenContracts = true;
    console.log('[DerivWS] Subscribing to global proposal_open_contract stream...');
    return this.send({
      proposal_open_contract: 1,
      subscribe: 1
    }).catch(err => {
      this._isSubscribedToOpenContracts = false;
      throw err;
    });
  }

  sellContract(contractId) {
    if (!contractId) return Promise.reject(new Error('Missing contractId'));
    const cid = parseInt(contractId, 10);
    console.log(\`[DerivWS] >>> EXECUTING SELL CONTRACT #\${cid} <<<\`);
    return this.send({
      sell: cid,
      price: 0
    });
  }

  forgetAllSubscriptions() {
    return this.send({ forget_all: 'proposal' }).catch(() => {});
  }

  getPortfolio() {
    return this.send({ portfolio: 1 });
  }
`;

// Insert methods right before checkContract
if (!derivClient.includes('buyAccumulatorDirect({')) {
  derivClient = derivClient.replace('  async checkContract(contractId)', derivMethodsToAdd + '\n  async checkContract(contractId)');
}

fs.writeFileSync(derivClientPath, derivClient, 'utf8');
console.log('✅ deriv-client.js updated successfully!');

console.log('--- 2. Building 10 Separate Accumulator Bots in 4bot-browser.js ---');
let fourBot = fs.readFileSync(fourBotPath, 'utf8');

const accumulatorEngineAnd10Bots = `
// ============================================================================
// ACCUMULATOR BOT ENGINE (Direct from desktop deriv-accumulator-bot working code)
// ============================================================================
class AccumulatorBotBase {
  constructor(id, initialConfig = {}) {
    this.id = id;
    this.name = initialConfig.name || \`Accumulator Bot \${id - 85}\`;
    this.client = null;
    this.isRunning = false;
    this.state = 'IDLE';

    this.config = {
      symbol: initialConfig.symbol || 'R_100',
      growthRate: parseFloat(initialConfig.growthRate) || 0.05,
      baseStake: parseFloat(initialConfig.stake) || 1.0,
      targetTicks: parseInt(initialConfig.targetTicks, 10) || 10,
      globalTakeProfit: parseFloat(initialConfig.takeProfit) || 50.0,
      globalStopLoss: Math.abs(parseFloat(initialConfig.stopLoss)) || 30.0,
      maxCycles: parseInt(initialConfig.maxCycles, 10) !== undefined ? parseInt(initialConfig.maxCycles, 10) : 10
    };

    // Compatibility fields for Hedge Bot dashboard
    this.baseStake = this.config.baseStake;
    this.stake = this.config.baseStake;
    this.symbol = this.config.symbol;
    this.growthRate = this.config.growthRate;
    this.targetTicks = this.config.targetTicks;
    this.maxCycles = this.config.maxCycles;
    this.takeProfit = this.config.globalTakeProfit;
    this.stopLoss = -this.config.globalStopLoss;

    this.currentStake = this.config.baseStake;
    this.activeProposalId = null;
    this.activeContractId = null;
    this.activeContract = null;
    this.cooldownTimer = null;
    this.crashPollTimer = null;
    this._crashBuyTriggered = false;
    this.isImmediateNextBuy = false;
    this.cyclesCompleted = 0;
    this.isSelling = false;
    this._processedContractId = null;

    this.stats = {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      totalPnL: 0.0,
      currentWinStreak: 0,
      currentLossStreak: 0,
      maxWinStreak: 0,
      maxLossStreak: 0,
      tradeHistory: []
    };
  }

  updateBadge(text, color = '#94a3b8') {
    const el = document.getElementById(\`accu-badge-\${this.id}\`);
    if (el) {
      el.textContent = text;
      el.style.color = color;
    }
  }

  updateProfitDisplay() {
    const pEl = document.getElementById(\`profit-\${this.id}\`);
    if (pEl) {
      const val = this.stats.totalPnL;
      pEl.textContent = \`\${val >= 0 ? '+' : ''}$\${val.toFixed(2)}\`;
      pEl.className = \`profit-display \${val >= 0 ? 'profit-pos' : 'profit-neg'}\`;
    }
  }

  syncConfigFromUI() {
    const tEl = document.getElementById(\`targetTicks-\${this.id}\`);
    if (tEl && !isNaN(parseInt(tEl.value, 10))) {
      this.config.targetTicks = parseInt(tEl.value, 10);
      this.targetTicks = this.config.targetTicks;
    }
    const mEl = document.getElementById(\`maxCycles-\${this.id}\`);
    if (mEl && !isNaN(parseInt(mEl.value, 10))) {
      this.config.maxCycles = parseInt(mEl.value, 10);
      this.maxCycles = this.config.maxCycles;
    }
    const sEl = document.getElementById(\`stake-\${this.id}\`);
    if (sEl && !isNaN(parseFloat(sEl.value))) {
      this.config.baseStake = parseFloat(sEl.value);
      this.baseStake = this.config.baseStake;
      this.stake = this.config.baseStake;
      this.currentStake = this.config.baseStake;
    }
    const gEl = document.getElementById(\`growthRate-\${this.id}\`);
    if (gEl && !isNaN(parseFloat(gEl.value))) {
      this.config.growthRate = parseFloat(gEl.value);
      this.growthRate = this.config.growthRate;
    }
    const symEl = document.getElementById(\`symbol-\${this.id}\`);
    if (symEl && symEl.value) {
      this.config.symbol = symEl.value;
      this.symbol = this.config.symbol;
    }
    const tpEl = document.getElementById(\`takeProfit-\${this.id}\`);
    if (tpEl && !isNaN(parseFloat(tpEl.value))) {
      this.config.globalTakeProfit = parseFloat(tpEl.value);
      this.takeProfit = this.config.globalTakeProfit;
    }
    const slEl = document.getElementById(\`stopLoss-\${this.id}\`);
    if (slEl && !isNaN(parseFloat(slEl.value))) {
      this.config.globalStopLoss = Math.abs(parseFloat(slEl.value));
      this.stopLoss = -this.config.globalStopLoss;
    }
  }

  updateConfig(newConfig = {}) {
    if (newConfig.symbol) { this.config.symbol = newConfig.symbol; this.symbol = newConfig.symbol; }
    if (newConfig.growthRate !== undefined) { this.config.growthRate = parseFloat(newConfig.growthRate); this.growthRate = this.config.growthRate; }
    if (newConfig.stake !== undefined) { this.config.baseStake = parseFloat(newConfig.stake); this.baseStake = this.config.baseStake; this.stake = this.config.baseStake; }
    if (newConfig.targetTicks !== undefined) { this.config.targetTicks = parseInt(newConfig.targetTicks, 10); this.targetTicks = this.config.targetTicks; }
    if (newConfig.maxCycles !== undefined) { this.config.maxCycles = parseInt(newConfig.maxCycles, 10); this.maxCycles = this.config.maxCycles; }
    if (newConfig.takeProfit !== undefined) { this.config.globalTakeProfit = parseFloat(newConfig.takeProfit); this.takeProfit = this.config.globalTakeProfit; }
    if (newConfig.stopLoss !== undefined) { this.config.globalStopLoss = Math.abs(parseFloat(newConfig.stopLoss)); this.stopLoss = -this.config.globalStopLoss; }

    if (this.state === 'IDLE') {
      this.currentStake = this.config.baseStake;
    }
  }

  onStart(client) {
    this.client = client;
    this.bindClientEvents();
    console.log(\`[Bot \${this.id}] \${this.name} Engine initialized for \${this.config.symbol} (\${(this.config.growthRate * 100).toFixed(0)}% Growth, Target \${this.config.targetTicks} Ticks).\`);
  }

  bindClientEvents() {
    if (!this.client) return;
    this.client.on('proposal', (proposal) => this.onProposalReceived(proposal));
    this.client.on('buy', (buyInfo) => this.onBuyExecuted(buyInfo));
    this.client.on('proposalOpenContract', (poc) => this.onOpenContractUpdate(poc));
    this.client.on('contractUpdate', (poc) => this.onOpenContractUpdate(poc));
    this.client.on('sell', (sellInfo) => {
      if (this.activeContract) this.onContractCompleted(this.activeContract);
    });
  }

  start() {
    if (this.isRunning) return;
    this.syncConfigFromUI();

    if (!this.client || !this.client.isConnected) {
      console.error(\`[Bot \${this.id}] Cannot start: Client is not connected.\`);
      return;
    }

    this.isRunning = true;
    this.state = 'PREPARING';
    this.currentStake = this.config.baseStake;
    this.cyclesCompleted = 0;
    this._crashBuyTriggered = false;
    this.isImmediateNextBuy = false;
    this._processedContractId = null;
    this.isSelling = false;

    console.log(\`[Bot \${this.id}] \${this.name} STARTED. Target: \${this.config.targetTicks} Ticks, Max Cycles: \${this.config.maxCycles || '∞'}\`);
    this.updateBadge(\`⏳ Waiting for Tick 0...\`, '#f59e0b');

    // Subscribe ticks for symbol and trigger next trade
    this.client.subscribeTicks(this.config.symbol).catch(() => {});
    this.triggerNextTrade();
  }

  stop(reason = 'User Requested') {
    this.isRunning = false;
    this.state = 'STOPPED';
    this.stopCrashMonitoring();
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = null;
    }
    this.updateBadge(\`Stopped (Done: \${this.cyclesCompleted}/\${this.config.maxCycles || '∞'})\`, '#94a3b8');
    console.log(\`[Bot \${this.id}] \${this.name} STOPPED (\${reason}). Session PnL: $\${this.stats.totalPnL.toFixed(2)}\`);
  }

  startCrashMonitoring() {
    this.stopCrashMonitoring();
    this._crashBuyTriggered = false;

    const cycleLabel = \`Cyc \${this.cyclesCompleted + 1}/\${this.config.maxCycles || '∞'}\`;
    this.updateBadge(\`⏳ Waiting for Tick 0 | \${cycleLabel}\`, '#f59e0b');

    const poll = () => {
      if (this.state !== 'WAITING_FOR_CRASH' || !this.isRunning) {
        this.stopCrashMonitoring();
        return;
      }
      this.client.requestAccumulatorProposal({
        symbol: this.config.symbol,
        stake: this.currentStake,
        growthRate: this.config.growthRate,
        currency: this.client.currency || 'USD'
      }).catch(() => {});
    };

    poll();
    this.crashPollTimer = setInterval(poll, 1200);
  }

  stopCrashMonitoring() {
    if (this.crashPollTimer) {
      clearInterval(this.crashPollTimer);
      this.crashPollTimer = null;
    }
  }

  triggerNextTrade() {
    if (!this.isRunning) return;

    if (this.checkRiskLimits()) return;

    if (!this.client.isConnected) {
      console.error(\`[Bot \${this.id}] Client disconnected. Pausing trade.\`);
      return;
    }

    if (!this.isImmediateNextBuy && this.state !== 'WAITING_FOR_CRASH') {
      this.state = 'WAITING_FOR_CRASH';
      this._crashBuyTriggered = false;
      console.log(\`[Bot \${this.id}] \${this.name} Waiting for \${this.config.symbol} tick count to reset to 0...\`);
      this.startCrashMonitoring();
      return;
    }

    this.isImmediateNextBuy = false;
    this.executeBuy();
  }

  executeBuy() {
    if (!this.isRunning) return;
    if (this.checkRiskLimits()) return;

    this.stopCrashMonitoring();
    this.state = 'PREPARING';
    this.isSelling = false;
    this._processedContractId = null;

    const growthPercent = (this.config.growthRate * 100).toFixed(0);
    const cycleLabel = \`Cycle \${this.cyclesCompleted + 1}/\${this.config.maxCycles || '∞'}\`;
    console.log(\`🚀 [Bot \${this.id}] \${this.name} Buying ACCU (\${growthPercent}% Growth | \${this.config.symbol} | Stake: $\${this.currentStake} | Target: \${this.config.targetTicks} Ticks | \${cycleLabel})...\`);
    this.updateBadge(\`🚀 Buying (\${cycleLabel})...\`, '#6366f1');

    this.client.buyAccumulatorDirect({
      symbol: this.config.symbol,
      stake: this.currentStake,
      growthRate: this.config.growthRate,
      currency: this.client.currency || 'USD'
    }).then(res => {
      if (res && res.buy && res.buy.contract_id) {
        console.log(\`💰 [Bot \${this.id}] \${this.name} Buy order confirmed! Contract #\${res.buy.contract_id}\`);
        this.onBuyExecuted(res.buy);
      }
    }).catch(directErr => {
      console.warn(\`⚠️ [Bot \${this.id}] Direct buy notice: \${directErr.message || directErr}. Trying proposal method...\`);
      // Fallback 2-step Proposal -> Buy
      this.client.requestAccumulatorProposal({
        symbol: this.config.symbol,
        stake: this.currentStake,
        growthRate: this.config.growthRate,
        currency: this.client.currency || 'USD'
      }).then(propRes => {
        const propId = propRes.proposal ? propRes.proposal.id : this.activeProposalId;
        if (!propId) throw new Error('Proposal ID not received');
        return this.client.buyContract(propId, this.currentStake);
      }).then(buyRes => {
        if (buyRes && buyRes.buy && buyRes.buy.contract_id) {
          console.log(\`💰 [Bot \${this.id}] \${this.name} Proposal buy confirmed! Contract #\${buyRes.buy.contract_id}\`);
          this.onBuyExecuted(buyRes.buy);
        }
      }).catch(buyErr => {
        console.error(\`❌ [Bot \${this.id}] \${this.name} Buy Failed: \${buyErr.message || buyErr}\`);
        this.updateBadge(\`❌ Buy Failed\`, '#ef4444');
        setTimeout(() => {
          if (this.isRunning) this.triggerNextTrade();
        }, 3000);
      });
    });
  }

  onProposalReceived(proposal) {
    if (proposal && proposal.id) {
      this.activeProposalId = proposal.id;
    }

    if (this.state !== 'WAITING_FOR_CRASH') return;

    // Check that proposal matches this bot's symbol
    const reqSymbol = proposal?.echo_req?.underlying_symbol || proposal?.echo_req?.symbol;
    if (reqSymbol && reqSymbol !== this.config.symbol) {
      return;
    }

    const stats = proposal?.contract_details?.ticks_stayed_in || proposal?.ticks_stayed_in;
    if (!stats || !Array.isArray(stats) || stats.length === 0) return;

    const currentRunTicks = stats[stats.length - 1];
    const cycleLabel = \`Cyc \${this.cyclesCompleted + 1}/\${this.config.maxCycles || '∞'}\`;
    if (currentRunTicks > 0) {
      this.updateBadge(\`⏳ Wait 0 (Curr: \${currentRunTicks}) | \${cycleLabel}\`, '#f59e0b');
    }

    if (currentRunTicks === 0) {
      if (this._crashBuyTriggered) return;
      this._crashBuyTriggered = true;

      this.stopCrashMonitoring();
      const prevRunTicks = stats.length >= 2 ? stats[stats.length - 2] : '?';
      console.log(\`💥 [Bot \${this.id}] \${this.name} (\${this.config.symbol}) Market crashed after \${prevRunTicks} ticks! Count reset to 0 — Buying NOW!\`);
      this.executeBuy();
    }
  }

  onBuyExecuted(buyInfo) {
    if (!this.isRunning) return;

    this.state = 'IN_CONTRACT';
    const contractId = buyInfo.contract_id;
    this.activeContractId = contractId;
    this.activeContract = null;
    this.isSelling = false;
    this._processedContractId = null;

    const cycleLabel = \`Cycle \${this.cyclesCompleted + 1}/\${this.config.maxCycles || '∞'}\`;
    this.updateBadge(\`⚡ Tick 0/\${this.config.targetTicks} | \${cycleLabel}\`, '#06b6d4');

    this.client.subscribeOpenContract(contractId).catch(() => {});
  }

  onOpenContractUpdate(poc) {
    if (this.activeContractId && String(poc.contract_id) !== String(this.activeContractId)) {
      return;
    }

    this.activeContract = poc;

    if (!this.isRunning) return;

    // 1. Contract Finished Check (Sold / Won / Lost / Expired)
    if (poc.is_sold === 1 || poc.status === 'won' || poc.status === 'lost' || poc.status === 'sold' || poc.is_expired === 1) {
      if (this._processedContractId === poc.contract_id) return;
      this._processedContractId = poc.contract_id;

      this.onContractCompleted(poc);
      return;
    }

    if (poc.status !== 'open') return;

    // 2. Accurate Ticks calculation
    let currentTicks = 0;
    const p = parseFloat(poc.profit || 0);
    const s = parseFloat(poc.buy_price || poc.stake || this.currentStake || 1.0);
    const g = parseFloat(poc.growth_rate || this.config.growthRate || 0.05);
    if (p > 0 && s > 0 && g > 0) {
      currentTicks = Math.round(Math.log((p + s) / s) / Math.log(1 + g));
    }
    if (poc.tick_stream && Array.isArray(poc.tick_stream)) {
      const st = Math.max(0, poc.tick_stream.length - 1);
      if (st > currentTicks) currentTicks = st;
    }
    if (poc.tick_passed !== undefined && poc.tick_passed !== null) {
      const tp = parseInt(poc.tick_passed, 10) || 0;
      if (tp > currentTicks) currentTicks = tp;
    }

    const cycleLabel = \`Cyc \${this.cyclesCompleted + 1}/\${this.config.maxCycles || '∞'}\`;
    if (currentTicks > 0) {
      this.updateBadge(\`⚡ Tick \${currentTicks}/\${this.config.targetTicks} | \${cycleLabel}\`, '#06b6d4');
    }

    // Prevent selling at entry tick (tick 0)
    if (!poc.is_valid_to_sell || currentTicks === 0) return;

    // 3. TARGET TICKS AUTO CASHOUT:
    if (this.config.targetTicks > 0 && currentTicks >= this.config.targetTicks && !this.isSelling) {
      this.isSelling = true;
      console.log(\`⚡ [Bot \${this.id}] \${this.name} Target REACHED (\${currentTicks}/\${this.config.targetTicks} ticks)! CASHING OUT NOW...\`);
      this.updateBadge(\`💰 Cashing Out (\${currentTicks}/\${this.config.targetTicks})...\`, '#10b981');

      this.client.sellContract(poc.contract_id).then(res => {
        console.log(\`✅ [Bot \${this.id}] \${this.name} Cashout SUCCESS for contract #\${poc.contract_id}!\`);
      }).catch(err => {
        console.error(\`❌ [Bot \${this.id}] \${this.name} Cashout Error: \${err.message || err}\`);
        setTimeout(() => {
          if (this.isRunning && String(this.activeContractId) === String(poc.contract_id)) {
            this.isSelling = false;
          }
        }, 400);
      });
      return;
    }
  }

  onContractCompleted(poc) {
    this.activeContract = null;
    this.activeContractId = null;
    this.isSelling = false;

    if (!poc) return;

    const isWin = poc.status === 'won' || (parseFloat(poc.profit) > 0);
    const profitLoss = parseFloat(poc.profit || (isWin ? (poc.sell_price - poc.stake) : -poc.stake));
    const ticksSurvived = poc.tick_passed ?? poc.tick_count ?? 0;

    this.stats.totalTrades += 1;
    this.stats.totalPnL += profitLoss;

    if (isWin) {
      this.stats.wins += 1;
      this.stats.currentWinStreak += 1;
      this.stats.currentLossStreak = 0;
      this.isImmediateNextBuy = false; // After WIN: wait for ongoing market tick count to finish
      console.log(\`🎯 [Bot \${this.id}] \${this.name} Contract #\${poc.contract_id} ✅ WON (+$$\${profitLoss.toFixed(2)} | \${ticksSurvived} Ticks) | Total PnL: $$\${this.stats.totalPnL.toFixed(2)}\`);
      this.updateBadge(\`✅ Win +$$\${profitLoss.toFixed(2)} | Waiting 0...\`, '#10b981');
    } else {
      this.stats.losses += 1;
      this.stats.currentLossStreak += 1;
      this.stats.currentWinStreak = 0;
      console.log(\`🎯 [Bot \${this.id}] \${this.name} Contract #\${poc.contract_id} ❌ LOSS (-$$\${Math.abs(profitLoss).toFixed(2)}) | Total PnL: $$\${this.stats.totalPnL.toFixed(2)}\`);
      this.updateBadge(\`❌ Crash (-$$\${Math.abs(profitLoss).toFixed(2)}) | Waiting 0...\`, '#ef4444');
    }

    this.updateProfitDisplay();
    this.cyclesCompleted = (this.cyclesCompleted || 0) + 1;
    this.state = 'IDLE';

    // Check risk limits (TP, SL, Max Cycles)
    if (this.checkRiskLimits()) return;

    if (!this.isRunning) return;

    // Trigger next trade: wait for market reset to 0
    setTimeout(() => {
      if (this.isRunning && !this.activeContractId) {
        this.triggerNextTrade();
      }
    }, 1000);
  }

  checkRiskLimits() {
    if (this.config.globalTakeProfit > 0 && this.stats.totalPnL >= this.config.globalTakeProfit) {
      console.log(\`🏆 [Bot \${this.id}] \${this.name} Global TP reached (+$$\${this.stats.totalPnL.toFixed(2)}). Stopping bot.\`);
      this.updateBadge(\`🏆 TP Reached (+$$\${this.stats.totalPnL.toFixed(2)})\`, '#10b981');
      this.stop('Take Profit Reached');
      return true;
    }

    if (this.config.globalStopLoss > 0 && this.stats.totalPnL <= -Math.abs(this.config.globalStopLoss)) {
      console.log(\`🛑 [Bot \${this.id}] \${this.name} Global SL reached (-$$\${Math.abs(this.stats.totalPnL).toFixed(2)}). Stopping bot.\`);
      this.updateBadge(\`🛑 SL Reached (-$$\${Math.abs(this.stats.totalPnL).toFixed(2)})\`, '#ef4444');
      this.stop('Stop Loss Reached');
      return true;
    }

    if (this.config.maxCycles > 0 && (this.cyclesCompleted || 0) >= this.config.maxCycles) {
      console.log(\`🏁 [Bot \${this.id}] \${this.name} Max cycles reached (\${this.cyclesCompleted}/\${this.config.maxCycles}). Stopping bot.\`);
      this.updateBadge(\`🏁 Completed: \${this.cyclesCompleted}/\${this.config.maxCycles} Cycles\`, '#10b981');
      this.stop('Max Cycles Reached');
      return true;
    }

    return false;
  }

  async onTick(tick) {
    // Tick event forwarder (optional backup)
  }
}

// ============================================================================
// 10 SEPARATE ACCUMULATOR BOTS (Bots 1 to 10 / IDs 86 to 95)
// ============================================================================
class AccumulatorBot1 extends AccumulatorBotBase {
  constructor(id = 86, config = {}) {
    super(id, { name: 'Accumulator Bot 1', symbol: 'R_100', ...config });
  }
}

class AccumulatorBot2 extends AccumulatorBotBase {
  constructor(id = 87, config = {}) {
    super(id, { name: 'Accumulator Bot 2', symbol: 'R_10', ...config });
  }
}

class AccumulatorBot3 extends AccumulatorBotBase {
  constructor(id = 88, config = {}) {
    super(id, { name: 'Accumulator Bot 3', symbol: 'R_75', ...config });
  }
}

class AccumulatorBot4 extends AccumulatorBotBase {
  constructor(id = 89, config = {}) {
    super(id, { name: 'Accumulator Bot 4', symbol: 'R_25', ...config });
  }
}

class AccumulatorBot5 extends AccumulatorBotBase {
  constructor(id = 90, config = {}) {
    super(id, { name: 'Accumulator Bot 5', symbol: 'R_50', ...config });
  }
}

class AccumulatorBot6 extends AccumulatorBotBase {
  constructor(id = 91, config = {}) {
    super(id, { name: 'Accumulator Bot 6', symbol: '1HZ100V', ...config });
  }
}

class AccumulatorBot7 extends AccumulatorBotBase {
  constructor(id = 92, config = {}) {
    super(id, { name: 'Accumulator Bot 7', symbol: '1HZ10V', ...config });
  }
}

class AccumulatorBot8 extends AccumulatorBotBase {
  constructor(id = 93, config = {}) {
    super(id, { name: 'Accumulator Bot 8', symbol: '1HZ75V', ...config });
  }
}

class AccumulatorBot9 extends AccumulatorBotBase {
  constructor(id = 94, config = {}) {
    super(id, { name: 'Accumulator Bot 9', symbol: '1HZ25V', ...config });
  }
}

class AccumulatorBot10 extends AccumulatorBotBase {
  constructor(id = 95, config = {}) {
    super(id, { name: 'Accumulator Bot 10', symbol: '1HZ50V', ...config });
  }
}
`;

// Replace class AccumulatorBot in 4bot-browser.js
const oldAccumulatorClassRegex = /class AccumulatorBot\s*\{[\s\S]*?\n\}\n\nclass FourBotStrategy/;
fourBot = fourBot.replace(oldAccumulatorClassRegex, accumulatorEngineAnd10Bots + '\n\nclass FourBotStrategy');

// Now update FourBotStrategy to push the 10 separate bots
const oldPushLoop = /\/\/ 86-95 Accumulator Bots:[\s\S]*?this\.strategies\.push\(new AccumulatorBot\(botId[\s\S]*?\}\s*\}/;

const newPush10SeparateBots = `// 86-95 Accumulator Bots: 10 SEPARATE INDEPENDENT BOTS
        this.strategies.push(new AccumulatorBot1(86, { symbol: 'R_100', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new AccumulatorBot2(87, { symbol: 'R_10', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new AccumulatorBot3(88, { symbol: 'R_75', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new AccumulatorBot4(89, { symbol: 'R_25', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new AccumulatorBot5(90, { symbol: 'R_50', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new AccumulatorBot6(91, { symbol: '1HZ100V', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new AccumulatorBot7(92, { symbol: '1HZ10V', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new AccumulatorBot8(93, { symbol: '1HZ75V', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new AccumulatorBot9(94, { symbol: '1HZ25V', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new AccumulatorBot10(95, { symbol: '1HZ50V', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
    }`;

fourBot = fourBot.replace(oldPushLoop, newPush10SeparateBots);
fs.writeFileSync(fourBotPath, fourBot, 'utf8');
console.log('✅ 4bot-browser.js updated with 10 separate accumulator bots!');

console.log('--- 3. Updating hedge-client.js getStatus and updateBot ---');
let hedgeClient = fs.readFileSync(hedgeClientPath, 'utf8');

// Update updateBot to call bot.updateConfig
const oldUpdateBotEnd = `    if (config.takeProfit !== undefined && !isNaN(parseFloat(config.takeProfit))) {
      bot.takeProfit = parseFloat(config.takeProfit);
    }
    if (config.stopLoss !== undefined && !isNaN(parseFloat(config.stopLoss))) {
      bot.stopLoss = parseFloat(config.stopLoss);
    }`;

const newUpdateBotEnd = `    if (config.takeProfit !== undefined && !isNaN(parseFloat(config.takeProfit))) {
      bot.takeProfit = parseFloat(config.takeProfit);
    }
    if (config.stopLoss !== undefined && !isNaN(parseFloat(config.stopLoss))) {
      bot.stopLoss = parseFloat(config.stopLoss);
    }
    if (typeof bot.updateConfig === 'function') {
      bot.updateConfig(config);
    }`;

if (!hedgeClient.includes('bot.updateConfig(config)')) {
  hedgeClient = hedgeClient.replace(oldUpdateBotEnd, newUpdateBotEnd);
  fs.writeFileSync(hedgeClientPath, hedgeClient, 'utf8');
  console.log('✅ hedge-client.js updated with bot.updateConfig!');
}

console.log('--- 4. Cache busting HTML files ---');
const htmlFiles = [indexHtmlPath, dashHtmlPath];
for (const fp of htmlFiles) {
  let html = fs.readFileSync(fp, 'utf8');
  html = html.replace(/\?v=[0-9.]+/g, '?v=12.0');
  fs.writeFileSync(fp, html, 'utf8');
  console.log(`✅ ${path.basename(fp)} version bumped to 12.0`);
}

console.log('🎉 Integration of Desktop working Accumulator Engine complete!');
