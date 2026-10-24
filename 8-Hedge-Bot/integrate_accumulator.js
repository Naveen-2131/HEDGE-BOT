const fs = require('fs');
const path = require('path');

const basePath = 'C:/Users/ADMIN/Desktop/HEDGE-BOT-main/8-Hedge-Bot/public';

console.log('>>> STARTING ACCUMULATOR BOTS INTEGRATION <<<');

// ====================================================================
// 1. UPDATE DERIV-CLIENT.JS
// ====================================================================
const dcPath = path.join(basePath, 'js/deriv-client.js');
let dc = fs.readFileSync(dcPath, 'utf8').replace(/\r\n/g, '\n');

// A. Update proposal_open_contract in _handleMessage
const oldPocHandler = `      case 'proposal_open_contract':
        if (msg.proposal_open_contract) {
          const poc = msg.proposal_open_contract;
          this.openContractsCache.set(poc.contract_id, {
            is_sold: Boolean(poc.is_sold || poc.status !== 'open'),
            profit: parseFloat(poc.profit || 0),
            status: poc.status
          });
          this.emit('contractUpdate', poc);
        }
        break;`;

const newPocHandler = `      case 'proposal_open_contract':
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

if (dc.includes(oldPocHandler)) {
  dc = dc.replace(oldPocHandler, newPocHandler);
  console.log('✅ deriv-client.js: POC handler updated with tick_passed & is_valid_to_sell');
} else {
  console.log('⚠️ Could not match oldPocHandler in deriv-client.js');
}

// B. Add buyAccumulator and sellContract methods to DerivBrowserClient
const methodsToAdd = `  // ── Sell Contract (Accumulator cashout) ───────────────────────────
  async sellContract(contractId) {
    if (!contractId) return null;
    return await this.send({ sell: contractId, price: 0 });
  }

  // ── Accumulator Direct Buy ──────────────────────────────────────
  async buyAccumulator(symbol, stake, growthRate) {
    const cleanSymbol = symbol || this.activeSymbol || 'R_100';
    const rate = parseFloat(growthRate) || 0.05;
    const amount = parseFloat(parseFloat(stake).toFixed(2)) || 1.0;

    const req = {
      buy: 1,
      price: amount,
      parameters: {
        amount: amount,
        basis: 'stake',
        contract_type: 'ACCU',
        currency: this.currency || 'USD',
        growth_rate: rate
      }
    };
    if (this.token && this.token.startsWith('pat_')) {
      req.parameters.underlying_symbol = cleanSymbol;
    } else {
      req.parameters.symbol = cleanSymbol;
    }

    let buyRes;
    try {
      buyRes = await this.send(req);
    } catch(directErr) {
      // Fallback: 2-step Proposal -> Buy
      const propReq = {
        proposal: 1,
        amount: amount,
        basis: 'stake',
        contract_type: 'ACCU',
        currency: this.currency || 'USD',
        growth_rate: rate
      };
      if (this.token && this.token.startsWith('pat_')) propReq.underlying_symbol = cleanSymbol;
      else propReq.symbol = cleanSymbol;

      const propRes = await this.send(propReq);
      if (propRes.error) throw new Error(propRes.error.message || 'Accumulator proposal error');
      if (!propRes.proposal) throw new Error('Accumulator proposal missing');
      buyRes = await this.send({ buy: propRes.proposal.id, price: amount });
    }

    if (buyRes.error) throw new Error(buyRes.error.message || 'Accumulator buy error');
    const cid = buyRes.buy.contract_id;

    // Cache initial state
    this.openContractsCache.set(cid, {
      is_sold: false,
      profit: 0,
      status: 'open',
      tick_passed: 0,
      is_valid_to_sell: false
    });

    // Auto-subscribe to stream updates
    this.send({ proposal_open_contract: 1, contract_id: cid, subscribe: 1 }).catch(() => {});
    return { contract_id: cid };
  }

`;

if (!dc.includes('buyAccumulator(')) {
  dc = dc.replace('  async checkContract(contractId) {', methodsToAdd + '  async checkContract(contractId) {');
  console.log('✅ deriv-client.js: buyAccumulator and sellContract added');
}

fs.writeFileSync(dcPath, dc, 'utf8');


// ====================================================================
// 2. UPDATE 4BOT-BROWSER.JS (ADD AccumulatorBot CLASS + BOTS 86-95)
// ====================================================================
const fbPath = path.join(basePath, 'js/4bot-browser.js');
let fb = fs.readFileSync(fbPath, 'utf8').replace(/\r\n/g, '\n');

const accumulatorBotClass = `class AccumulatorBot {
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
        this.cyclesCompleted = 0;
        this.tradeCount = 0;
        this.sessionProfit = 0;
        this.profit = 0;
        this.processedContracts = new Set();
        this.lastTradeTime = 0;
        this.minInterval = 1000;
    }

    onStart(bot) {
        this.bot = bot;
        console.log(\`[Bot \${this.id}] \${this.name} Loaded. Growth: \${(this.growthRate * 100).toFixed(0)}%, Target Ticks: \${this.targetTicks}\`);
    }

    start() {
        if (!this.isRunning) {
            this.isRunning = true;
            this.resetSession();
            console.log(\`[Bot \${this.id}] \${this.name} STARTED.\`);
            this.executeTrade();
        }
    }

    stop() {
        this.isRunning = false;
        this.waitingForExit = false;
        this.isSelling = false;
        console.log(\`[Bot \${this.id}] \${this.name} STOPPED. Session Profit: \$\${this.sessionProfit.toFixed(2)}\`);
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
        this.processedContracts.clear();
    }

    async onTick(tick, now) {
        if (!this.isRunning) return;
        if (tick.symbol && tick.symbol !== this.symbol) return;

        // If in an active contract, check contract state
        if (this.activeContractId && this.waitingForExit) {
            const cid = this.activeContractId;
            const c = this.bot.checkContract(cid);
            if (!c) return;

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
                console.log(\`🎯 [Bot \${this.id}] \${this.name} Contract #\${cid} \${isWin ? '✅ WIN' : '❌ CRASH/LOSS'} | Profit: \$\${p.toFixed(2)} | Total: \$\${this.sessionProfit.toFixed(2)} | Cycle: \${this.cyclesCompleted}/\${this.maxCycles || '∞'}\`);

                this.activeContractId = null;
                this.waitingForExit = false;
                this.isSelling = false;

                // Check Take Profit / Stop Loss limits
                if (this.takeProfit > 0 && this.sessionProfit >= this.takeProfit) {
                    console.log(\`[Bot \${this.id}] \${this.name} Target TP reached (\$\${this.sessionProfit.toFixed(2)}). Stopping.\`);
                    this.stop();
                    return;
                }
                if (this.stopLoss < 0 && this.sessionProfit <= this.stopLoss) {
                    console.log(\`[Bot \${this.id}] \${this.name} Stop Loss reached (\$\${this.sessionProfit.toFixed(2)}). Stopping.\`);
                    this.stop();
                    return;
                }

                // Check Max Cycles limit
                if (this.maxCycles > 0 && this.cyclesCompleted >= this.maxCycles) {
                    console.log(\`[Bot \${this.id}] \${this.name} Max Cycles (\${this.maxCycles}) reached. Stopping.\`);
                    this.stop();
                    return;
                }

                // Next Cycle Trigger after small 1.5s delay
                setTimeout(() => {
                    if (this.isRunning && !this.waitingForExit) {
                        this.executeTrade();
                    }
                }, 1500);
                return;
            }

            // 2. Auto Cashout Rule: Target Ticks reached
            const currentTicks = c.tick_passed || 0;
            if (!this.isSelling && this.targetTicks > 0 && currentTicks >= this.targetTicks && c.is_valid_to_sell) {
                this.isSelling = true;
                console.log(\`⚡ [Bot \${this.id}] \${this.name} Target \${currentTicks}/\${this.targetTicks} ticks reached! Cashing out now...\`);
                try {
                    await this.bot.sellContract(cid);
                } catch(err) {
                    console.error(\`[Bot \${this.id}] Cashout Error:\`, err.message || err);
                    this.isSelling = false;
                }
            }
            return;
        }

        // If idle and not in contract, start trade
        if (!this.waitingForExit && !this.activeContractId) {
            if (now - this.lastTradeTime >= this.minInterval) {
                this.executeTrade();
            }
        }
    }

    async executeTrade() {
        if (!this.isRunning || this.waitingForExit) return;
        this.waitingForExit = true;
        this.lastTradeTime = Date.now();
        this.isSelling = false;

        const growthPercent = (this.growthRate * 100).toFixed(0);
        console.log(\`🚀 [Bot \${this.id}] \${this.name} Buying ACCU (\${growthPercent}% Growth, Symbol: \${this.symbol}, Stake: \$\${this.stake})...\`);

        try {
            const trade = await this.bot.buyAccumulator(this.symbol, this.stake, this.growthRate);
            if (trade && trade.contract_id) {
                this.activeContractId = trade.contract_id;
                this.tradeCount++;
                console.log(\`💰 [Bot \${this.id}] \${this.name} Contract Started #\${trade.contract_id}\`);
            } else {
                this.waitingForExit = false;
            }
        } catch(e) {
            console.error(\`❌ [Bot \${this.id}] \${this.name} Buy Failed:\`, e.message || e);
            this.waitingForExit = false;
            setTimeout(() => {
                if (this.isRunning && !this.waitingForExit) this.executeTrade();
            }, 3000);
        }
    }
}

`;

if (!fb.includes('class AccumulatorBot')) {
  fb = fb.replace('class FourBotStrategy {', accumulatorBotClass + 'class FourBotStrategy {');
  console.log('✅ 4bot-browser.js: AccumulatorBot class added');
}

// Add Bots 86-95 inside FourBotStrategy constructor
const accumulatorBotsLoop = `        // 86-95 Accumulator Bots (10 Instances)
        for (let i = 1; i <= 10; i++) {
            const botId = 85 + i;
            this.strategies.push(new AccumulatorBot(botId, {
                name: \`Accumulator Bot \${i}\`,
                symbol: 'R_100',
                growthRate: 0.05,
                stake: 1.0,
                targetTicks: 10,
                maxCycles: 10,
                takeProfit: 50,
                stopLoss: -30
            }));
        }
    }`;

if (!fb.includes('86-95 Accumulator Bots')) {
  fb = fb.replace(/\s*\}\s*onStart\(bot\) \{/, '\n' + accumulatorBotsLoop + '\n\n    onStart(bot) {');
  console.log('✅ 4bot-browser.js: Bots 86-95 added to FourBotStrategy');
}

fs.writeFileSync(fbPath, fb, 'utf8');


// ====================================================================
// 3. UPDATE HEDGE-CLIENT.JS
// ====================================================================
const hcPath = path.join(basePath, 'js/hedge-client.js');
let hc = fs.readFileSync(hcPath, 'utf8').replace(/\r\n/g, '\n');

// In updateBot:
const updateBotAccu = `      if (config.growthRate !== undefined && !isNaN(parseFloat(config.growthRate))) {
        bot.growthRate = parseFloat(config.growthRate);
      }
      if (config.targetTicks !== undefined && !isNaN(parseInt(config.targetTicks))) {
        bot.targetTicks = parseInt(config.targetTicks);
      }
      if (config.maxCycles !== undefined && !isNaN(parseInt(config.maxCycles))) {
        bot.maxCycles = parseInt(config.maxCycles);
      }`;

if (!hc.includes('config.growthRate !== undefined')) {
  hc = hc.replace('if (config.lowerBarrier !== undefined) bot.lowerBarrier = config.lowerBarrier;',
    'if (config.lowerBarrier !== undefined) bot.lowerBarrier = config.lowerBarrier;\n' + updateBotAccu);
  console.log('✅ hedge-client.js: updateBot updated with Accumulator parameters');
}

// In getStatus:
const getStatusAccu = `        if (s.id >= 86 && s.id <= 95) {
          baseConfig.growthRate = s.growthRate;
          baseConfig.targetTicks = s.targetTicks;
          baseConfig.maxCycles = s.maxCycles;
        }`;

if (!hc.includes('s.id >= 86 && s.id <= 95')) {
  hc = hc.replace('if (s.id >= 76 && s.id <= 85) {', getStatusAccu + '\n\n        if (s.id >= 76 && s.id <= 85) {');
  console.log('✅ hedge-client.js: getStatus updated for Bots 86-95');
}

fs.writeFileSync(hcPath, hc, 'utf8');


// ====================================================================
// 4. UPDATE DASHBOARD.HTML & INDEX.HTML
// ====================================================================
const htmlFiles = [
  path.join(basePath, 'dashboard.html'),
  path.join(basePath, 'index.html')
];

for (const hp of htmlFiles) {
  let html = fs.readFileSync(hp, 'utf8').replace(/\r\n/g, '\n');

  // A. Replace the single redirect button with toggleSection button
  html = html.replace(
    /onclick="window\.location\.href='\/accumulator\/index\.html'">📊 ACCUMULATOR BOT<\/button>/g,
    `onclick="toggleSection('accumulator')" style="background-color: #06b6d4; font-weight: 700;">⚡ ACCUMULATOR BOTS (86-95)</button>`
  );
  html = html.replace(
    /onclick="window\.location\.href='\/accumulator\/index\.html'">📊 Accumulator Bot<\/button>/g,
    `onclick="toggleSection('accumulator')" style="background-color: #06b6d4; flex: 1; min-width: 150px; padding: 10px; font-weight: 700;">⚡ Accumulator Bots</button>`
  );

  // B. Add the Accumulator section div before Hedge Match Section
  const accuSectionHtml = `    <!-- Accumulator Bots Section (86-95) -->
    <div id="accumulator-section"
        style="display:none; margin-bottom: 40px; border: 1px solid #06b6d4; padding: 20px; border-radius: 12px; background: rgba(6, 182, 212, 0.03);">
        <h2 style="color: #06b6d4; margin-top: 0; display:flex; justify-content:space-between; align-items:center;">
            <span>⚡ Accumulator Bots (86-95)</span>
            <small style="font-size:0.9rem; color:#a1a1aa; font-weight:normal;">Auto Cashout Growth Trading</small>
        </h2>
        <div class="grid" id="accumulator-grid"></div>
    </div>\n\n`;

  if (!html.includes('id="accumulator-section"')) {
    html = html.replace('    <!-- Hedge Match Bot Section -->', accuSectionHtml + '    <!-- Hedge Match Bot Section -->');
    console.log(`✅ ${path.basename(hp)}: Accumulator Section HTML added`);
  }

  // C. In updateDashboard routing:
  const accuGridRouting = `                else if (bot.id >= 76 && bot.id <= 85) container = document.getElementById('hedgehilo-grid');
                else if (bot.id >= 86 && bot.id <= 95) container = document.getElementById('accumulator-grid');`;

  if (!html.includes("bot.id >= 86 && bot.id <= 95")) {
    html = html.replace(
      "else if (bot.id >= 76 && bot.id <= 85) container = document.getElementById('hedgehilo-grid');",
      accuGridRouting
    );
    console.log(`✅ ${path.basename(hp)}: updateDashboard routing added for Bots 86-95`);
  }

  // D. In createCard: add Accumulator Bot template
  const accuCardTemplate = `            } else if (bot.id >= 86 && bot.id <= 95) {
                div.innerHTML = \`
                    <div class="card-header">
                        <span><span class="status-dot" id="status-\${bot.id}"></span> \${bot.name}</span>
                        <small>ID: \${bot.id}</small>
                    </div>
                    <div class="checkbox-wrapper" style="justify-content: flex-end;">
                         <label style="font-size: 0.9rem; color: #06b6d4; cursor: pointer;">
                            <input type="checkbox" class="bot-check" value="\${bot.id}"> Select to Start
                         </label>
                    </div>
                    <div class="profit-display" id="profit-\${bot.id}">\$0.00</div>
                    
                    <div class="form-group">
                        <label>Select Accumulator Market</label>
                        <input type="search" id="symbol-\${bot.id}" value="\${bot.config.symbol || 'R_100'}" list="marketList" placeholder="Select Market">
                    </div>

                    <div class="form-group">
                        <label>Growth Rate Per Tick</label>
                        <select id="growthRate-\${bot.id}" style="width:100%; padding:8px; background:var(--bg-card); color:#fff; border:1px solid var(--border); border-radius:6px;">
                            <option value="0.01" \${bot.config.growthRate == 0.01 ? 'selected' : ''}>1% Growth</option>
                            <option value="0.02" \${bot.config.growthRate == 0.02 ? 'selected' : ''}>2% Growth</option>
                            <option value="0.03" \${bot.config.growthRate == 0.03 ? 'selected' : ''}>3% Growth</option>
                            <option value="0.04" \${bot.config.growthRate == 0.04 ? 'selected' : ''}>4% Growth</option>
                            <option value="0.05" \${(!bot.config.growthRate || bot.config.growthRate == 0.05) ? 'selected' : ''}>5% Growth</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label>Base Stake (\$)</label>
                        <input type="number" step="0.1" id="stake-\${bot.id}" value="\${bot.config.stake || 1.0}">
                    </div>

                    <div class="form-group">
                        <label>Total Ticks (Auto Cashout)</label>
                        <input type="number" id="targetTicks-\${bot.id}" value="\${bot.config.targetTicks || 10}" min="1" max="250">
                    </div>

                    <div class="form-group">
                        <label>Max Cycles (0 = ∞)</label>
                        <input type="number" id="maxCycles-\${bot.id}" value="\${bot.config.maxCycles !== undefined ? bot.config.maxCycles : 10}" min="0">
                    </div>

                    <div class="form-row" style="display:flex; gap:10px;">
                        <div class="form-group" style="flex:1;">
                            <label>Session TP (\$)</label>
                            <input type="number" step="1" id="takeProfit-\${bot.id}" value="\${bot.config.takeProfit || 50}">
                        </div>
                        <div class="form-group" style="flex:1;">
                            <label>Session SL (\$)</label>
                            <input type="number" step="1" id="stopLoss-\${bot.id}" value="\${bot.config.stopLoss !== undefined ? bot.config.stopLoss : -30}">
                        </div>
                    </div>

                    <button class="btn btn-start-all" id="btn-toggle-\${bot.id}" onclick="toggleBot(\${bot.id})">Start</button>
                \`;`;

  if (!html.includes('else if (bot.id >= 86 && bot.id <= 95)')) {
    html = html.replace(
      '} else if (bot.id >= 76 && bot.id <= 85) {',
      accuCardTemplate + '\n            } else if (bot.id >= 76 && bot.id <= 85) {'
    );
    console.log(`✅ ${path.basename(hp)}: createCard Accumulator template added`);
  }

  // E. In updateBot: handle accumulator fields
  const updateBotAccuCode = `            } else if (id >= 86 && id <= 95) {
                const growthRate = document.getElementById(\`growthRate-\${id}\`) ? document.getElementById(\`growthRate-\${id}\`).value : '0.05';
                const targetTicks = document.getElementById(\`targetTicks-\${id}\`) ? document.getElementById(\`targetTicks-\${id}\`).value : '10';
                const maxCycles = document.getElementById(\`maxCycles-\${id}\`) ? document.getElementById(\`maxCycles-\${id}\`).value : '10';
                const takeProfit = document.getElementById(\`takeProfit-\${id}\`) ? document.getElementById(\`takeProfit-\${id}\`).value : '50';
                const stopLoss = document.getElementById(\`stopLoss-\${id}\`) ? document.getElementById(\`stopLoss-\${id}\`).value : '-30';

                window.hedgeClient.updateBot(id, {
                    stake, symbol, growthRate, targetTicks, maxCycles, takeProfit, stopLoss
                });`;

  if (!html.includes('else if (id >= 86 && id <= 95)')) {
    html = html.replace(
      '} else if (id >= 76 && id <= 85) {',
      updateBotAccuCode + '\n            } else if (id >= 76 && id <= 85) {'
    );
    console.log(`✅ ${path.basename(hp)}: updateBot Accumulator fields added`);
  }

  // F. Bump version to 3.0 for fresh cache-bust
  html = html.replace(/\?v=2\.[0-9]+/g, '?v=3.0');

  fs.writeFileSync(hp, html, 'utf8');
}

console.log('🎉 ALL ACCUMULATOR BOTS INTEGRATED SUCCESSFULLY!');
