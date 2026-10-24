const fs = require('fs');
const path = require('path');

const basePath = 'C:/Users/ADMIN/Desktop/HEDGE-BOT-main/8-Hedge-Bot';
const derivClientPath = path.join(basePath, 'public/js/deriv-client.js');
const hedgeClientPath = path.join(basePath, 'public/js/hedge-client.js');
const fourBotPath = path.join(basePath, 'public/js/4bot-browser.js');
const indexHtmlPath = path.join(basePath, 'public/index.html');
const dashHtmlPath = path.join(basePath, 'public/dashboard.html');

console.log('--- 1. Updating deriv-client.js ---');
let derivClient = fs.readFileSync(derivClientPath, 'utf8');

// Ensure proposal_open_contract takes Math.max of tick_passed and tick_count
const oldPocHandler = `      case 'proposal_open_contract':
        if (msg.proposal_open_contract) {
          const poc = msg.proposal_open_contract;
          const isSold = Boolean(poc.is_sold || poc.status !== 'open');
          const ticks = poc.tick_passed !== undefined ? poc.tick_passed : (poc.tick_count || 0);
          this.openContractsCache.set(poc.contract_id, {
            is_sold: isSold,
            profit: parseFloat(poc.profit || 0),
            status: poc.status,
            tick_passed: ticks,
            is_valid_to_sell: Boolean(poc.is_valid_to_sell)
          });
          this.emit('contractUpdate', poc);
        }
        break;`;

const newPocHandler = `      case 'proposal_open_contract':
        if (msg.proposal_open_contract) {
          const poc = msg.proposal_open_contract;
          const isSold = Boolean(poc.is_sold || poc.status !== 'open');
          const ticks = Math.max(
            parseInt(poc.tick_passed, 10) || 0,
            parseInt(poc.tick_count, 10) || 0
          );
          this.openContractsCache.set(poc.contract_id, {
            is_sold: isSold,
            profit: parseFloat(poc.profit || 0),
            status: poc.status,
            tick_passed: ticks,
            tick_count: ticks,
            is_valid_to_sell: Boolean(poc.is_valid_to_sell)
          });
          this.emit('contractUpdate', poc);
        }
        break;`;

if (derivClient.includes("poc.tick_passed !== undefined ? poc.tick_passed : (poc.tick_count || 0)")) {
  derivClient = derivClient.replace(oldPocHandler, newPocHandler);
  fs.writeFileSync(derivClientPath, derivClient, 'utf8');
  console.log('✅ deriv-client.js tick calculation enhanced!');
} else {
  console.log('ℹ️ deriv-client.js already has enhanced tick calculation or pattern differed.');
}

console.log('--- 2. Updating hedge-client.js ---');
let hedgeClient = fs.readFileSync(hedgeClientPath, 'utf8');

// Forward contractUpdate directly to active accumulator bots
const oldTickForward = `      // Forward ticks
      this.client.on('tick', (tick) => {
        if (this.strategy) {
          this.strategy.onTick({
            quote: parseFloat(tick.quote),
            symbol: tick.symbol,
            epoch: tick.epoch
          }).catch(() => {});
        }
      });`;

const newTickAndContractForward = `      // Forward ticks
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
            if (s.isRunning && s.activeContractId === poc.contract_id && typeof s.onContractUpdate === 'function') {
              s.onContractUpdate(poc);
            }
          });
        }
      });`;

if (!hedgeClient.includes("this.client.on('contractUpdate'")) {
  hedgeClient = hedgeClient.replace(oldTickForward, newTickAndContractForward);
  fs.writeFileSync(hedgeClientPath, hedgeClient, 'utf8');
  console.log('✅ hedge-client.js now forwards contractUpdate immediately!');
} else {
  console.log('ℹ️ hedge-client.js already forwards contractUpdate.');
}

console.log('--- 3. Updating 4bot-browser.js ---');
let fourBot = fs.readFileSync(fourBotPath, 'utf8');

const enhancedAccumulatorBotClass = `class AccumulatorBot {
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
        this._initialStatsLen = null;
        this._seenActiveTick = false;
        this.processedContracts.clear();
        this.stopResetMonitoring();
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

        this.isWaitingForReset = true;
        this.waitingForExit = false;
        this.activeContractId = null;
        this.isSelling = false;
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
                // Ignore transient network errors during poll
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

    // Direct real-time callback from Deriv WebSocket proposal_open_contract push stream
    onContractUpdate(poc) {
        if (!this.isRunning || !this.waitingForExit) return;
        if (poc.contract_id !== this.activeContractId) return;

        const isSold = Boolean(poc.is_sold || poc.status === 'sold' || poc.status === 'won' || poc.status === 'lost');
        if (isSold) {
            this.handleContractFinished(poc);
            return;
        }

        this.checkAndSellContract(poc);
    }

    // Called on every price tick event as redundant safety check
    async onTick(tick, now) {
        if (!this.isRunning) return;
        if (tick.symbol && tick.symbol !== this.symbol) return;

        if (this.activeContractId && this.waitingForExit) {
            const cid = this.activeContractId;
            const c = this.bot.checkContract(cid);
            if (!c) return;

            if (c.is_sold || c.status === 'lost' || c.status === 'won' || c.status === 'sold') {
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

    // Instant Zero-Delay Auto-Cashout
    checkAndSellContract(c) {
        if (!this.isRunning || !this.waitingForExit || !this.activeContractId) return;
        const cid = this.activeContractId;

        const currentTicks = Math.max(
            parseInt(c.tick_passed, 10) || 0,
            parseInt(c.tick_count, 10) || 0
        );

        const cycleLabel = \`Cyc \${this.cyclesCompleted + 1}/\${this.maxCycles || '∞'}\`;
        if (currentTicks > 0) {
            this.updateBadge(\`⚡ Tick \${currentTicks}/\${this.targetTicks} | \${cycleLabel}\`, '#06b6d4');
        }

        // Target ticks reached -> Cashout immediately!
        if (this.targetTicks > 0 && currentTicks >= this.targetTicks && !this.isSelling) {
            this.isSelling = true;
            console.log(\`⚡ [Bot \${this.id}] \${this.name} Target REACHED (\${currentTicks}/\${this.targetTicks} ticks)! CASHING OUT NOW...\`);
            this.updateBadge(\`💰 Cashing Out (\${currentTicks}/\${this.targetTicks})...\`, '#10b981');

            this.bot.sellContract(cid).then(res => {
                console.log(\`✅ [Bot \${this.id}] \${this.name} Cashout successfully sent for contract #\${cid}!\`);
            }).catch(err => {
                console.error(\`❌ [Bot \${this.id}] \${this.name} Cashout Error:\`, err.message || err);
                // Reset isSelling after 500ms to allow immediate retry if contract is still open
                setTimeout(() => {
                    if (this.waitingForExit && this.activeContractId === cid) {
                        const check = this.bot.checkContract(cid);
                        if (check && !check.is_sold) {
                            this.isSelling = false;
                            this.checkAndSellContract(check);
                        }
                    }
                }, 500);
            });
        }
    }

    handleContractFinished(c) {
        const cid = this.activeContractId || c.contract_id;
        if (!cid) return;
        if (this.processedContracts.has(cid)) {
            this.activeContractId = null;
            this.waitingForExit = false;
            this.isSelling = false;
            return;
        }
        this.processedContracts.add(cid);

        const p = parseFloat(c.profit || 0);
        this.sessionProfit += p;
        this.profit = this.sessionProfit;
        this.cyclesCompleted++;

        const isWin = p > 0;
        console.log(\`🎯 [Bot \${this.id}] \${this.name} Contract #\${cid} \${isWin ? '✅ WIN' : '❌ CRASH/LOSS'} | Profit: $\${p.toFixed(2)} | Total: $\${this.sessionProfit.toFixed(2)} | Cycle: \${this.cyclesCompleted}/\${this.maxCycles || '∞'}\`);

        this.activeContractId = null;
        this.waitingForExit = false;
        this.isSelling = false;

        // Update UI profit display
        const pEl = document.getElementById(\`profit-\${this.id}\`);
        if (pEl) {
            pEl.textContent = \`\${this.sessionProfit >= 0 ? '+' : ''}$\${this.sessionProfit.toFixed(2)}\`;
            pEl.className = \`profit-display \${this.sessionProfit >= 0 ? 'profit-pos' : 'profit-neg'}\`;
        }

        // Check Take Profit / Stop Loss limits
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

        // Check Max Cycles limit
        if (this.maxCycles > 0 && this.cyclesCompleted >= this.maxCycles) {
            console.log(\`🏁 [Bot \${this.id}] \${this.name} Max Cycles (\${this.maxCycles}) completed! Stopping.\`);
            this.updateBadge(\`🏁 Completed: \${this.cyclesCompleted}/\${this.maxCycles} Cycles\`, '#10b981');
            this.stop();
            return;
        }

        // Next Cycle: Wait for tick 0
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
        this.waitingForExit = true;
        this.lastTradeTime = Date.now();
        this.isSelling = false;

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

// Replace class AccumulatorBot in 4bot-browser.js
const accuClassRegex = /class AccumulatorBot\s*\{[\s\S]*?\n\}\n\nclass FourBotStrategy/;
if (accuClassRegex.test(fourBot)) {
  fourBot = fourBot.replace(accuClassRegex, enhancedAccumulatorBotClass + '\n\nclass FourBotStrategy');
  fs.writeFileSync(fourBotPath, fourBot, 'utf8');
  console.log('✅ 4bot-browser.js enhanced with zero-latency cashout!');
} else {
  console.log('⚠️ Could not match accuClassRegex in 4bot-browser.js');
}

console.log('--- 4. Updating index.html & dashboard.html inputs ---');
const htmlFiles = [indexHtmlPath, dashHtmlPath];
for (const fp of htmlFiles) {
  let html = fs.readFileSync(fp, 'utf8');

  // Add onchange="updateBot(${bot.id})" to targetTicks input if not present
  html = html.replace(
    'id="targetTicks-${bot.id}" value="${bot.config.targetTicks || 10}" min="1" max="250"',
    'id="targetTicks-${bot.id}" value="${bot.config.targetTicks || 10}" min="1" max="250" onchange="updateBot(${bot.id})"'
  );

  // Add onchange="updateBot(${bot.id})" to maxCycles input if not present
  html = html.replace(
    'id="maxCycles-${bot.id}" value="${bot.config.maxCycles !== undefined ? bot.config.maxCycles : 10}" min="0"',
    'id="maxCycles-${bot.id}" value="${bot.config.maxCycles !== undefined ? bot.config.maxCycles : 10}" min="0" onchange="updateBot(${bot.id})"'
  );

  // Bump version to 8.0 for cache busting
  html = html.replace(/\?v=[0-9.]+/g, '?v=8.0');
  fs.writeFileSync(fp, html, 'utf8');
  console.log(`✅ ${path.basename(fp)} version bumped to 8.0 with dynamic input triggers`);
}

console.log('🎉 Instant Cashout Fix applied successfully!');
