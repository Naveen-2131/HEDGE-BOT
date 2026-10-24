const fs = require('fs');
const path = require('path');

const basePath = 'C:/Users/ADMIN/Desktop/HEDGE-BOT-main/8-Hedge-Bot';
const derivClientPath = path.join(basePath, 'public/js/deriv-client.js');
const fourBotPath = path.join(basePath, 'public/js/4bot-browser.js');
const indexHtmlPath = path.join(basePath, 'public/index.html');
const dashHtmlPath = path.join(basePath, 'public/dashboard.html');

console.log('--- 1. Updating deriv-client.js with Global POC Stream & fetchOpenContract ---');
let derivClient = fs.readFileSync(derivClientPath, 'utf8');

// Replace proposal_open_contract handler with String key Map storage
const oldPocHandler = /case 'proposal_open_contract':[\s\S]*?break;/;
const newPocHandler = `case 'proposal_open_contract':
        if (msg.proposal_open_contract) {
          const poc = msg.proposal_open_contract;
          const cidStr = String(poc.contract_id);
          const isSold = Boolean(poc.is_sold || poc.status !== 'open');
          const ticks = (poc.tick_passed !== undefined && poc.tick_passed !== null)
            ? (parseInt(poc.tick_passed, 10) || 0)
            : 0;

          const data = {
            contract_id: poc.contract_id,
            is_sold: isSold,
            profit: parseFloat(poc.profit || 0),
            status: poc.status,
            tick_passed: ticks,
            is_valid_to_sell: Boolean(poc.is_valid_to_sell)
          };

          this.openContractsCache.set(cidStr, data);
          // Also set numeric key to guarantee both string and number work
          this.openContractsCache.set(poc.contract_id, data);

          this.emit('contractUpdate', poc);
        }
        break;`;

derivClient = derivClient.replace(oldPocHandler, newPocHandler);

// Add global proposal_open_contract subscription call upon authorization
if (!derivClient.includes('subscribeOpenContractsGlobal()')) {
  const authSuccessPattern = `this.emit('balanceUpdate', { balance: this.balance, currency: this.currency });`;
  const globalSubCode = `this.emit('balanceUpdate', { balance: this.balance, currency: this.currency });
        this.subscribeOpenContractsGlobal();`;
  derivClient = derivClient.replace(new RegExp(authSuccessPattern, 'g'), globalSubCode);

  const globalSubFunc = `
  // ── Global Open Contracts Push Subscription ───────────────────
  subscribeOpenContractsGlobal() {
    if (this._hasSubscribedOpenContracts) return;
    this._hasSubscribedOpenContracts = true;
    console.log('[DerivWS] Subscribing to global open contracts stream...');
    this.send({ proposal_open_contract: 1, subscribe: 1 }).catch(() => {
      this._hasSubscribedOpenContracts = false;
    });
  }

  async fetchOpenContract(contractId) {
    if (!this.isConnected || !contractId) return null;
    const cidNum = parseInt(contractId, 10);
    try {
      const res = await this.send({ proposal_open_contract: 1, contract_id: cidNum });
      if (res && res.proposal_open_contract) {
        const poc = res.proposal_open_contract;
        const cidStr = String(poc.contract_id);
        const isSold = Boolean(poc.is_sold || poc.status !== 'open');
        const ticks = (poc.tick_passed !== undefined && poc.tick_passed !== null)
          ? (parseInt(poc.tick_passed, 10) || 0)
          : 0;

        const data = {
          contract_id: poc.contract_id,
          is_sold: isSold,
          profit: parseFloat(poc.profit || 0),
          status: poc.status,
          tick_passed: ticks,
          is_valid_to_sell: Boolean(poc.is_valid_to_sell)
        };
        this.openContractsCache.set(cidStr, data);
        this.openContractsCache.set(poc.contract_id, data);
        return data;
      }
    } catch(e) {}
    return null;
  }
`;
  derivClient = derivClient.replace('  // ── Main Connect Method', globalSubFunc + '\n  // ── Main Connect Method');
  console.log('✅ Added subscribeOpenContractsGlobal & fetchOpenContract to deriv-client.js');
}

// Enhance checkContract to check string and number
const checkContractRegex = /async checkContract\(contractId\) \{[\s\S]*?return null;\s*\}/;
const newCheckContract = `async checkContract(contractId) {
    if (!contractId) return null;
    const key = String(contractId);
    if (this.openContractsCache.has(key)) {
      const cached = this.openContractsCache.get(key);
      if (cached && cached.is_sold) {
        setTimeout(() => {
          this.openContractsCache.delete(key);
          this.openContractsCache.delete(parseInt(contractId, 10));
        }, 10000);
      }
      return cached;
    }
    if (this.openContractsCache.has(parseInt(contractId, 10))) {
      return this.openContractsCache.get(parseInt(contractId, 10));
    }
    return null;
  }`;
derivClient = derivClient.replace(checkContractRegex, newCheckContract);

// Enhance sellContract with robust parseInt
const sellContractRegex = /async sellContract\(contractId\) \{[\s\S]*?\}\n\s*\}/;
const newSellContract = `async sellContract(contractId) {
    if (!contractId) return null;
    const cidNum = parseInt(contractId, 10);
    console.log(\`[DerivWS] >>> CALLING DERIV SELL for Contract #\${cidNum} <<<\`);
    try {
      const res = await this.send({ sell: cidNum, price: 0 });
      console.log(\`[DerivWS] Deriv SELL confirmation for #\${cidNum}:\`, res);
      if (res && res.sell) {
        const key = String(cidNum);
        const cached = this.openContractsCache.get(key) || {};
        const updated = {
          ...cached,
          is_sold: true,
          status: 'sold'
        };
        this.openContractsCache.set(key, updated);
        this.openContractsCache.set(cidNum, updated);
      }
      return res;
    } catch (err) {
      console.warn(\`[DerivWS] Sell notice for #\${cidNum}:\`, err.message || err);
      throw err;
    }
  }`;
derivClient = derivClient.replace(sellContractRegex, newSellContract + '\n  }');

fs.writeFileSync(derivClientPath, derivClient, 'utf8');
console.log('✅ deriv-client.js updated successfully!');

console.log('--- 2. Updating 4bot-browser.js with Active 400ms Heartbeat & String Normalization ---');
let fourBot = fs.readFileSync(fourBotPath, 'utf8');

const bulletproofAccumulatorClass = `class AccumulatorBot {
    constructor(id, config = {}) {
        this.id = id;
        this.name = config.name || \`Accumulator Bot \${id - 85}\`;
        this.bot = null;
        this.isRunning = false;

        this.symbol = config.symbol || 'R_100';
        this.growthRate = parseFloat(config.growthRate) || 0.05; // 1% to 5% (0.01 - 0.05)
        this.baseStake = parseFloat(config.stake) || 1.0;
        this.stake = this.baseStake;
        this.targetTicks = parseInt(config.targetTicks, 10) || 10;
        this.maxCycles = parseInt(config.maxCycles, 10) || 10;
        this.takeProfit = parseFloat(config.takeProfit) || 50;
        this.stopLoss = parseFloat(config.stopLoss) || -30;

        this.activeContractId = null;
        this.isSelling = false;
        this.waitingForExit = false;
        this.isWaitingForReset = false;
        this.resetPollTimer = null;
        this.isPollingReset = false;
        this._initialStatsLen = null;
        this._seenActiveTick = false;
        this.contractHeartbeatTimer = null;
        this._lastFetchTime = 0;
        this.ticksPassed = 0;

        this.cyclesCompleted = 0;
        this.tradeCount = 0;
        this.sessionProfit = 0;
        this.profit = 0;
        this.processedContracts = new Set();
        this.lastTradeTime = 0;
        this.minInterval = 1000;
    }

    updateBadge(text, color = '#94a3b8') {
        const el = document.getElementById(\`accu-badge-\${this.id}\`);
        if (el) {
            el.textContent = text;
            el.style.color = color;
        }
    }

    onStart(bot) {
        this.bot = bot;
        console.log(\`[Bot \${this.id}] \${this.name} Loaded. Growth: \${(this.growthRate * 100).toFixed(0)}%, Target Ticks: \${this.targetTicks}, Max Cycles: \${this.maxCycles || '∞'}\`);
    }

    start() {
        if (!this.isRunning) {
            this.syncConfigFromUI();
            this.isRunning = true;
            this.resetSession();
            console.log(\`[Bot \${this.id}] \${this.name} STARTED. Target: \${this.targetTicks} Ticks, Max Cycles: \${this.maxCycles || '∞'}\`);
            this.updateBadge(\`⏳ Waiting for Tick 0...\`, '#f59e0b');
            this.waitForResetAndTrade();
        }
    }

    stop() {
        this.isRunning = false;
        this.stopResetMonitoring();
        this.stopContractHeartbeat();
        this.waitingForExit = false;
        this.isSelling = false;
        this.updateBadge(\`Stopped (Done: \${this.cyclesCompleted}/\${this.maxCycles || '∞'})\`, '#94a3b8');
        console.log(\`[Bot \${this.id}] \${this.name} STOPPED. Session Profit: \${this.sessionProfit.toFixed(2)}\`);
    }

    resetSession() {
        this.cyclesCompleted = 0;
        this.tradeCount = 0;
        this.sessionProfit = 0;
        this.profit = 0;
        this.stake = this.baseStake;
        this.activeContractId = null;
        this.waitingForExit = false;
        this.isSelling = false;
        this.isWaitingForReset = false;
        this.ticksPassed = 0;
        this._initialStatsLen = null;
        this._seenActiveTick = false;
        this.processedContracts.clear();
        this.stopResetMonitoring();
        this.stopContractHeartbeat();
    }

    syncConfigFromUI() {
        const tEl = document.getElementById(\`targetTicks-\${this.id}\`);
        if (tEl && !isNaN(parseInt(tEl.value, 10))) {
            this.targetTicks = parseInt(tEl.value, 10);
        }
        const mEl = document.getElementById(\`maxCycles-\${this.id}\`);
        if (mEl && !isNaN(parseInt(mEl.value, 10))) {
            this.maxCycles = parseInt(mEl.value, 10);
        }
        const sEl = document.getElementById(\`stake-\${this.id}\`);
        if (sEl && !isNaN(parseFloat(sEl.value))) {
            this.baseStake = parseFloat(sEl.value);
            this.stake = this.baseStake;
        }
        const gEl = document.getElementById(\`growthRate-\${this.id}\`);
        if (gEl && !isNaN(parseFloat(gEl.value))) {
            this.growthRate = parseFloat(gEl.value);
        }
        const symEl = document.getElementById(\`symbol-\${this.id}\`);
        if (symEl && symEl.value) {
            this.symbol = symEl.value;
        }
    }

    waitForResetAndTrade() {
        if (!this.isRunning) return;
        this.stopResetMonitoring();
        this.stopContractHeartbeat();

        this.isWaitingForReset = true;
        this.waitingForExit = false;
        this.activeContractId = null;
        this.isSelling = false;
        this.ticksPassed = 0;
        this._initialStatsLen = null;
        this._seenActiveTick = false;

        const cycleLabel = \`Cyc \${this.cyclesCompleted + 1}/\${this.maxCycles || '∞'}\`;
        this.updateBadge(\`⏳ Waiting for Tick 0 | \${cycleLabel}\`, '#f59e0b');
        console.log(\`[Bot \${this.id}] \${this.name} Monitoring \${this.symbol} for crash/reset to 0 (\${cycleLabel})...\`);

        const pollCrash = async () => {
            if (!this.isRunning || !this.isWaitingForReset || this.waitingForExit || this.activeContractId) {
                this.stopResetMonitoring();
                return;
            }

            if (this.isPollingReset) return;
            this.isPollingReset = true;

            try {
                if (this.bot && typeof this.bot.getAccumulatorProposal === 'function') {
                    const res = await this.bot.getAccumulatorProposal(this.symbol, this.stake, this.growthRate);
                    if (res && res.ticks_stayed_in && Array.isArray(res.ticks_stayed_in)) {
                        const stats = res.ticks_stayed_in;
                        const currentTicks = stats.length > 0 ? stats[stats.length - 1] : 0;

                        if (this._initialStatsLen === null) {
                            this._initialStatsLen = stats.length;
                            if (currentTicks > 0) {
                                this._seenActiveTick = true;
                                this.updateBadge(\`⏳ Wait 0 (Curr: \${currentTicks}) | \${cycleLabel}\`, '#f59e0b');
                            } else {
                                console.log(\`💥 [Bot \${this.id}] \${this.name} Market is at 0 ticks! Buying \${cycleLabel} NOW!\`);
                                this.stopResetMonitoring();
                                this.executeTrade();
                                return;
                            }
                        } else {
                            if (currentTicks > 0) {
                                this._seenActiveTick = true;
                                this.updateBadge(\`⏳ Wait 0 (Curr: \${currentTicks}) | \${cycleLabel}\`, '#f59e0b');
                            }

                            const isReset = (currentTicks === 0 && this._seenActiveTick) || 
                                            (stats.length > this._initialStatsLen && currentTicks <= 1);

                            if (isReset) {
                                console.log(\`💥 [Bot \${this.id}] \${this.name} Market reset to 0! Buying \${cycleLabel} NOW!\`);
                                this.stopResetMonitoring();
                                this.executeTrade();
                                return;
                            }
                        }
                    }
                }
            } catch(e) {
                // Ignore transient errors
            } finally {
                this.isPollingReset = false;
            }
        };

        pollCrash();
        this.resetPollTimer = setInterval(pollCrash, 1200);
    }

    stopResetMonitoring() {
        this.isWaitingForReset = false;
        if (this.resetPollTimer) {
            clearInterval(this.resetPollTimer);
            this.resetPollTimer = null;
        }
        this.isPollingReset = false;
    }

    // Active 400ms Heartbeat to guarantee immediate cashout
    startContractHeartbeat(cid) {
        this.stopContractHeartbeat();
        const cidStr = String(cid);
        this._lastFetchTime = Date.now();

        this.contractHeartbeatTimer = setInterval(async () => {
            if (!this.isRunning || !this.waitingForExit || String(this.activeContractId) !== cidStr) {
                this.stopContractHeartbeat();
                return;
            }

            // 1. In-memory check
            const c = this.bot.checkContract(cid);
            if (c) {
                if (c.is_sold || c.status === 'lost' || c.status === 'won' || c.status === 'sold') {
                    this.stopContractHeartbeat();
                    this.handleContractFinished(c);
                    return;
                }
                const currentTicks = (c.tick_passed !== undefined && c.tick_passed !== null)
                    ? (parseInt(c.tick_passed, 10) || 0)
                    : (this.ticksPassed || 0);

                if (currentTicks > 0) {
                    this.ticksPassed = currentTicks;
                    const cycleLabel = \`Cyc \${this.cyclesCompleted + 1}/\${this.maxCycles || '∞'}\`;
                    this.updateBadge(\`⚡ Tick \${currentTicks}/\${this.targetTicks} | \${cycleLabel}\`, '#06b6d4');
                }

                if (this.targetTicks > 0 && currentTicks >= this.targetTicks && currentTicks > 0) {
                    this.checkAndSellContract(c);
                    return;
                }
            }

            // 2. Active Deriv fetch every 1.2s as fallback
            const now = Date.now();
            if (now - this._lastFetchTime >= 1200) {
                this._lastFetchTime = now;
                if (this.bot && typeof this.bot.fetchOpenContract === 'function') {
                    try {
                        const fresh = await this.bot.fetchOpenContract(cid);
                        if (fresh) {
                            if (fresh.is_sold || fresh.status === 'lost' || fresh.status === 'won' || fresh.status === 'sold') {
                                this.stopContractHeartbeat();
                                this.handleContractFinished(fresh);
                            } else {
                                this.checkAndSellContract(fresh);
                            }
                        }
                    } catch(e) {}
                }
            }
        }, 400);
    }

    stopContractHeartbeat() {
        if (this.contractHeartbeatTimer) {
            clearInterval(this.contractHeartbeatTimer);
            this.contractHeartbeatTimer = null;
        }
    }

    // Direct callback from Deriv WebSocket proposal_open_contract push stream
    onContractUpdate(poc) {
        if (!this.isRunning || !this.waitingForExit || !this.activeContractId) return;
        if (String(poc.contract_id) !== String(this.activeContractId)) return;

        const isSold = Boolean(poc.is_sold || poc.status === 'sold' || poc.status === 'won' || poc.status === 'lost');
        if (isSold) {
            this.stopContractHeartbeat();
            this.handleContractFinished(poc);
            return;
        }

        this.checkAndSellContract(poc);
    }

    async onTick(tick, now) {
        if (!this.isRunning) return;
        if (tick.symbol && tick.symbol !== this.symbol) return;

        if (this.activeContractId && this.waitingForExit) {
            const cid = this.activeContractId;
            const c = this.bot.checkContract(cid);
            if (!c) return;

            if (c.is_sold || c.status === 'lost' || c.status === 'won' || c.status === 'sold') {
                this.stopContractHeartbeat();
                this.handleContractFinished(c);
                return;
            }

            this.checkAndSellContract(c);
            return;
        }

        if (!this.waitingForExit && !this.activeContractId && !this.isWaitingForReset) {
            this.waitForResetAndTrade();
        }
    }

    // Target ticks reached -> Cashout immediately!
    checkAndSellContract(c) {
        if (!this.isRunning || !this.waitingForExit || !this.activeContractId) return;
        const cid = this.activeContractId;

        const currentTicks = (c.tick_passed !== undefined && c.tick_passed !== null)
            ? (parseInt(c.tick_passed, 10) || 0)
            : (this.ticksPassed || 0);
        this.ticksPassed = currentTicks;

        const cycleLabel = \`Cyc \${this.cyclesCompleted + 1}/\${this.maxCycles || '∞'}\`;
        if (currentTicks > 0) {
            this.updateBadge(\`⚡ Tick \${currentTicks}/\${this.targetTicks} | \${cycleLabel}\`, '#06b6d4');
        }

        // Auto cashout when currentTicks >= targetTicks AND currentTicks > 0
        if (this.targetTicks > 0 && currentTicks >= this.targetTicks && currentTicks > 0 && !this.isSelling) {
            this.isSelling = true;
            console.log(\`⚡ [Bot \${this.id}] \${this.name} Target REACHED (\${currentTicks}/\${this.targetTicks} ticks)! CASHING OUT NOW...\`);
            this.updateBadge(\`💰 Cashing Out (\${currentTicks}/\${this.targetTicks})...\`, '#10b981');

            this.bot.sellContract(cid).then(res => {
                console.log(\`✅ [Bot \${this.id}] \${this.name} Cashout successfully sent for contract #\${cid}!\`);
            }).catch(err => {
                console.error(\`❌ [Bot \${this.id}] \${this.name} Cashout Error:\`, err.message || err);
                // Retry after 400ms if contract is still open
                setTimeout(() => {
                    if (this.waitingForExit && String(this.activeContractId) === String(cid)) {
                        const check = this.bot.checkContract(cid);
                        if (check && !check.is_sold) {
                            this.isSelling = false;
                            this.checkAndSellContract(check);
                        }
                    }
                }, 400);
            });
        }
    }

    handleContractFinished(c) {
        const cid = this.activeContractId || c.contract_id;
        if (!cid) return;
        this.stopContractHeartbeat();

        const cidStr = String(cid);
        if (this.processedContracts.has(cidStr)) {
            this.activeContractId = null;
            this.waitingForExit = false;
            this.isSelling = false;
            return;
        }
        this.processedContracts.add(cidStr);

        const p = parseFloat(c.profit || 0);
        this.sessionProfit += p;
        this.profit = this.sessionProfit;
        this.cyclesCompleted++;

        const isWin = p > 0;
        console.log(\`🎯 [Bot \${this.id}] \${this.name} Contract #\${cid} \${isWin ? '✅ WIN' : '❌ CRASH/LOSS'} | Profit: $\${p.toFixed(2)} | Total: $\${this.sessionProfit.toFixed(2)} | Cycle: \${this.cyclesCompleted}/\${this.maxCycles || '∞'}\`);

        this.activeContractId = null;
        this.waitingForExit = false;
        this.isSelling = false;
        this.ticksPassed = 0;

        // Update UI profit display
        const pEl = document.getElementById(\`profit-\${this.id}\`);
        if (pEl) {
            pEl.textContent = \`\${this.sessionProfit >= 0 ? '+' : ''}$\${this.sessionProfit.toFixed(2)}\`;
            pEl.className = \`profit-display \${this.sessionProfit >= 0 ? 'profit-pos' : 'profit-neg'}\`;
        }

        // Check TP / SL
        if (this.takeProfit > 0 && this.sessionProfit >= this.takeProfit) {
            console.log(\`🏆 [Bot \${this.id}] \${this.name} Target TP reached (\${this.sessionProfit.toFixed(2)}). Stopping.\`);
            this.updateBadge(\`🏆 TP Reached: +$\${this.sessionProfit.toFixed(2)}\`, '#10b981');
            this.stop();
            return;
        }
        if (this.stopLoss < 0 && this.sessionProfit <= this.stopLoss) {
            console.log(\`🛑 [Bot \${this.id}] \${this.name} Stop Loss reached (\${this.sessionProfit.toFixed(2)}). Stopping.\`);
            this.updateBadge(\`🛑 SL Reached: $\${this.sessionProfit.toFixed(2)}\`, '#ef4444');
            this.stop();
            return;
        }

        // Check Max Cycles
        if (this.maxCycles > 0 && this.cyclesCompleted >= this.maxCycles) {
            console.log(\`🏁 [Bot \${this.id}] \${this.name} Max Cycles (\${this.maxCycles}) completed! Stopping.\`);
            this.updateBadge(\`🏁 Completed: \${this.cyclesCompleted}/\${this.maxCycles} Cycles\`, '#10b981');
            this.stop();
            return;
        }

        // Next Cycle: Wait for ongoing market tick count to reset to 0
        this.updateBadge(\`\${isWin ? '✅ Win' : '❌ Loss'} | Waiting 0...\`, isWin ? '#10b981' : '#ef4444');
        setTimeout(() => {
            if (this.isRunning && !this.waitingForExit && !this.activeContractId) {
                this.waitForResetAndTrade();
            }
        }, 1000);
    }

    async executeTrade() {
        if (!this.isRunning || this.waitingForExit || this.activeContractId) return;
        this.syncConfigFromUI();
        this.stopResetMonitoring();
        this.stopContractHeartbeat();
        this.waitingForExit = true;
        this.lastTradeTime = Date.now();
        this.isSelling = false;
        this.ticksPassed = 0;

        const growthPercent = (this.growthRate * 100).toFixed(0);
        const cycleLabel = \`Cycle \${this.cyclesCompleted + 1}/\${this.maxCycles || '∞'}\`;
        console.log(\`🚀 [Bot \${this.id}] \${this.name} Buying ACCU (\${growthPercent}% Growth, Symbol: \${this.symbol}, Stake: \${this.stake}, Target Ticks: \${this.targetTicks}, \${cycleLabel})...\`);
        this.updateBadge(\`🚀 Buying (\${cycleLabel})...\`, '#6366f1');

        try {
            const trade = await this.bot.buyAccumulator(this.symbol, this.stake, this.growthRate);
            if (trade && trade.contract_id) {
                this.activeContractId = trade.contract_id;
                this.tradeCount++;
                console.log(\`💰 [Bot \${this.id}] \${this.name} Contract Started #\${trade.contract_id}\`);
                this.updateBadge(\`⚡ Tick 0/\${this.targetTicks} | \${cycleLabel}\`, '#06b6d4');
                // Start immediate 400ms heartbeat
                this.startContractHeartbeat(trade.contract_id);
            } else {
                this.waitingForExit = false;
                this.waitForResetAndTrade();
            }
        } catch(e) {
            console.error(\`❌ [Bot \${this.id}] \${this.name} Buy Failed:\`, e.message || e);
            this.waitingForExit = false;
            this.updateBadge(\`❌ Buy Failed\`, '#ef4444');
            setTimeout(() => {
                if (this.isRunning && !this.waitingForExit) {
                    this.waitForResetAndTrade();
                }
            }, 3000);
        }
    }
}`;

const accuClassRegex = /class AccumulatorBot\s*\{[\s\S]*?\n\}\n\nclass FourBotStrategy/;
fourBot = fourBot.replace(accuClassRegex, bulletproofAccumulatorClass + '\n\nclass FourBotStrategy');
fs.writeFileSync(fourBotPath, fourBot, 'utf8');
console.log('✅ 4bot-browser.js updated with active heartbeat cashout!');

console.log('--- 3. Updating cache-busting version in HTML files ---');
const htmlFiles = [indexHtmlPath, dashHtmlPath];
for (const fp of htmlFiles) {
  let html = fs.readFileSync(fp, 'utf8');
  html = html.replace(/\?v=[0-9.]+/g, '?v=10.0');
  fs.writeFileSync(fp, html, 'utf8');
  console.log(`✅ ${path.basename(fp)} bumped to v10.0`);
}

console.log('🎉 Bulletproof cashout installation complete!');
