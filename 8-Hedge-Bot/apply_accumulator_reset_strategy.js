const fs = require('fs');
const path = require('path');

const basePath = 'C:/Users/ADMIN/Desktop/HEDGE-BOT-main/8-Hedge-Bot';
const derivClientPath = path.join(basePath, 'public/js/deriv-client.js');
const fourBotPath = path.join(basePath, 'public/js/4bot-browser.js');
const indexHtmlPath = path.join(basePath, 'public/index.html');
const dashHtmlPath = path.join(basePath, 'public/dashboard.html');

console.log('--- 1. Updating deriv-client.js ---');
let derivClient = fs.readFileSync(derivClientPath, 'utf8');

// Replace sellContract and add getAccumulatorProposal
const oldSell = `  // ── Sell Contract (Accumulator cashout) ───────────────────────────
  async sellContract(contractId) {
    if (!contractId) return null;
    return await this.send({ sell: contractId, price: 0 });
  }`;

const newSellAndProposal = `  // ── Sell Contract (Accumulator cashout) ───────────────────────────
  async sellContract(contractId) {
    if (!contractId) return null;
    try {
      const res = await this.send({ sell: contractId, price: 0 });
      if (res && res.sell) {
        const cached = this.openContractsCache.get(contractId) || {};
        this.openContractsCache.set(contractId, {
          ...cached,
          is_sold: true,
          status: 'sold'
        });
      }
      return res;
    } catch (err) {
      console.warn('Sell contract notice:', err.message || err);
      throw err;
    }
  }

  // ── Accumulator Proposal / Market Stats Check ─────────────────
  async getAccumulatorProposal(symbol, stake = 1, growthRate = 0.05) {
    if (!this.isConnected) return null;
    const cleanSymbol = (symbol || this.activeSymbol || 'R_100').trim();
    const rate = parseFloat(growthRate) || 0.05;
    const amount = parseFloat(stake) || 1.0;

    const propReq = {
      proposal: 1,
      amount: amount,
      basis: 'stake',
      contract_type: 'ACCU',
      currency: this.currency || 'USD',
      growth_rate: rate
    };
    if (this.token && this.token.startsWith('pat_')) {
      propReq.underlying_symbol = cleanSymbol;
    } else {
      propReq.symbol = cleanSymbol;
    }

    try {
      const res = await this.send(propReq);
      if (res && res.proposal) {
        const details = res.proposal.contract_details || {};
        const ticksStayedIn = details.ticks_stayed_in || res.proposal.ticks_stayed_in || [];
        const currentTicks = ticksStayedIn.length > 0 ? ticksStayedIn[ticksStayedIn.length - 1] : 0;
        return {
          id: res.proposal.id,
          ask_price: res.proposal.ask_price,
          spot: res.proposal.spot,
          current_ticks: currentTicks,
          ticks_stayed_in: ticksStayedIn
        };
      }
    } catch (err) {
      // Ignore transient errors
    }
    return null;
  }`;

if (derivClient.includes('// ── Sell Contract (Accumulator cashout)')) {
  derivClient = derivClient.replace(oldSell, newSellAndProposal);
  fs.writeFileSync(derivClientPath, derivClient, 'utf8');
  console.log('✅ deriv-client.js updated successfully!');
} else {
  console.log('⚠️ Could not find oldSell in deriv-client.js');
}

console.log('--- 2. Updating 4bot-browser.js ---');
let fourBot = fs.readFileSync(fourBotPath, 'utf8');

const newAccumulatorBotClass = `class AccumulatorBot {
    constructor(id, config = {}) {
        this.id = id;
        this.name = config.name || \`Accumulator Bot \${id - 85}\`;
        this.bot = null;
        this.isRunning = false;

        this.symbol = config.symbol || 'R_100';
        this.growthRate = parseFloat(config.growthRate) || 0.05; // 1% to 5% (0.01 - 0.05)
        this.baseStake = parseFloat(config.stake) || 1.0;
        this.stake = this.baseStake;
        this.targetTicks = parseInt(config.targetTicks) || 10;
        this.maxCycles = parseInt(config.maxCycles) || 10;
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
                                // Already at 0 ticks!
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

                            // Trigger buy on genuine reset:
                            // 1. currentTicks === 0 AND we previously saw active ticks, OR
                            // 2. stats length increased (new run started) AND currentTicks is 0 or 1
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

    async onTick(tick, now) {
        if (!this.isRunning) return;
        if (tick.symbol && tick.symbol !== this.symbol) return;

        // If in an active contract, check contract state
        if (this.activeContractId && this.waitingForExit) {
            const cid = this.activeContractId;
            const c = this.bot.checkContract(cid);
            if (!c) return;

            const cycleLabel = \`Cyc \${this.cyclesCompleted + 1}/\${this.maxCycles || '∞'}\`;

            // 1. Contract Finished (Won, Sold or Lost/Crashed)
            if (c.is_sold || c.status === 'lost' || c.status === 'won' || c.status === 'sold') {
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
                console.log(\`🎯 [Bot \${this.id}] \${this.name} Contract #\${cid} \${isWin ? '✅ WIN' : '❌ CRASH/LOSS'} | Profit: \${p.toFixed(2)} | Total: \${this.sessionProfit.toFixed(2)} | Cycle: \${this.cyclesCompleted}/\${this.maxCycles || '∞'}\`);

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

                // Next Cycle: Wait for ongoing market tick count to reset to 0
                this.updateBadge(\`\${isWin ? '✅ Win' : '❌ Loss'} | Waiting 0...\`, isWin ? '#10b981' : '#ef4444');
                setTimeout(() => {
                    if (this.isRunning && !this.waitingForExit && !this.activeContractId) {
                        this.waitForResetAndTrade();
                    }
                }, 1000);
                return;
            }

            // 2. Auto Cashout Rule: Target Ticks reached
            const currentTicks = c.tick_passed || 0;
            if (currentTicks > 0) {
                this.updateBadge(\`⚡ Tick \${currentTicks}/\${this.targetTicks} | \${cycleLabel}\`, '#06b6d4');
            }

            if (!this.isSelling && this.targetTicks > 0 && currentTicks >= this.targetTicks && c.is_valid_to_sell) {
                this.isSelling = true;
                console.log(\`⚡ [Bot \${this.id}] \${this.name} Target \${currentTicks}/\${this.targetTicks} ticks reached! Cashing out immediately...\`);
                this.updateBadge(\`💰 Cashing Out (\${currentTicks}/\${this.targetTicks})...\`, '#10b981');
                try {
                    await this.bot.sellContract(cid);
                } catch(err) {
                    console.error(\`[Bot \${this.id}] Cashout Error:\`, err.message || err);
                    this.isSelling = false;
                }
            }
            return;
        }

        // If idle and not in contract and not waiting for reset, initiate reset check
        if (!this.waitingForExit && !this.activeContractId && !this.isWaitingForReset) {
            this.waitForResetAndTrade();
        }
    }

    async executeTrade() {
        if (!this.isRunning || this.waitingForExit || this.activeContractId) return;
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

// Replace class AccumulatorBot block in fourBot
const accuClassRegex = /class AccumulatorBot\s*\{[\s\S]*?\n\}\n\nclass FourBotStrategy/;
if (accuClassRegex.test(fourBot)) {
  fourBot = fourBot.replace(accuClassRegex, newAccumulatorBotClass + '\n\nclass FourBotStrategy');
  fs.writeFileSync(fourBotPath, fourBot, 'utf8');
  console.log('✅ 4bot-browser.js updated successfully!');
} else {
  console.log('⚠️ Could not match accuClassRegex in 4bot-browser.js');
}

console.log('--- 3. Updating index.html & dashboard.html ---');
const htmlFiles = [indexHtmlPath, dashHtmlPath];
for (const fp of htmlFiles) {
  let html = fs.readFileSync(fp, 'utf8');

  // Add accu badge under profit display if not present
  if (!html.includes('id="accu-badge-${bot.id}"')) {
    const targetProfitStr = '<div class="profit-display" id="profit-${bot.id}">$0.00</div>';
    const replacementStr = '<div class="profit-display" id="profit-${bot.id}">$0.00</div>\n                    <div class="accu-status-badge" id="accu-badge-${bot.id}" style="text-align:center; font-size:0.8rem; font-weight:700; color:#94a3b8; margin-top:-6px; margin-bottom:10px; letter-spacing:0.5px;">IDLE</div>';
    html = html.replace(targetProfitStr, replacementStr);
    console.log(`✅ Added accu-badge to ${path.basename(fp)}`);
  }

  // Bump version to 7.0 for cache busting
  html = html.replace(/\?v=[0-9.]+/g, '?v=7.0');
  fs.writeFileSync(fp, html, 'utf8');
  console.log(`✅ ${path.basename(fp)} version bumped to 7.0`);
}

console.log('🎉 Accumulator reset strategy integration complete!');
