const fs = require('fs');
const path = require('path');

const publicDir = 'C:/Users/ADMIN/Desktop/HEDGE-BOT-main/8-Hedge-Bot/public';

console.log('>>> UPDATING ACCUMULATOR BOTS: CUSTOM OPTIONS & DISTINCT SYMBOLS <<<');

// ====================================================================
// 1. UPDATE 4BOT-BROWSER.JS (DISTINCT SYMBOLS FOR BOTS 86-95)
// ====================================================================
const fbPath = path.join(publicDir, 'js/4bot-browser.js');
let fb = fs.readFileSync(fbPath, 'utf8').replace(/\r\n/g, '\n');

const oldAccuLoopRegex = /\/\/ 86-95 Accumulator Bots[\s\S]*?this\.strategies\.push\(new AccumulatorBot\(botId, \{[\s\S]*?\}\)\);\s*\}/;

const newAccuLoop = `// 86-95 Accumulator Bots (10 Instances with distinct symbols)
        const accuSymbols = ['R_100', 'R_10', 'R_75', 'R_25', 'R_50', '1HZ100V', '1HZ10V', '1HZ75V', '1HZ25V', '1HZ50V'];
        for (let i = 1; i <= 10; i++) {
            const botId = 85 + i;
            const sym = accuSymbols[i - 1] || 'R_100';
            this.strategies.push(new AccumulatorBot(botId, {
                name: \`Accumulator Bot \${i}\`,
                symbol: sym,
                growthRate: 0.05,
                stake: 1.0,
                targetTicks: 10,
                maxCycles: 10,
                takeProfit: 50,
                stopLoss: -30
            }));
        }`;

if (oldAccuLoopRegex.test(fb)) {
  fb = fb.replace(oldAccuLoopRegex, newAccuLoop);
  console.log('✅ 4bot-browser.js: Updated Bots 86-95 with distinct symbols (R_100, R_10, R_75, etc.)');
} else {
  console.log('❌ Could not match oldAccuLoopRegex in 4bot-browser.js');
}

fs.writeFileSync(fbPath, fb, 'utf8');


// ====================================================================
// 2. UPDATE INDEX.HTML & DASHBOARD.HTML
// ====================================================================
const htmlFiles = [
  path.join(publicDir, 'index.html'),
  path.join(publicDir, 'dashboard.html')
];

for (const hp of htmlFiles) {
  let html = fs.readFileSync(hp, 'utf8').replace(/\r\n/g, '\n');

  // A. Replace createCard accumulator template or inject it before the final 'else'
  const accuCardTemplate = `            } else if (bot.id >= 86 && bot.id <= 95) {
                const growthRate = bot.config.growthRate || 0.05;
                const symbols = [
                    { code: 'R_100', name: 'Volatility 100 Index (R_100)' },
                    { code: 'R_10', name: 'Volatility 10 Index (R_10)' },
                    { code: 'R_75', name: 'Volatility 75 Index (R_75)' },
                    { code: 'R_25', name: 'Volatility 25 Index (R_25)' },
                    { code: 'R_50', name: 'Volatility 50 Index (R_50)' },
                    { code: '1HZ100V', name: 'Volatility 100 (1s) Index' },
                    { code: '1HZ10V', name: 'Volatility 10 (1s) Index' },
                    { code: '1HZ75V', name: 'Volatility 75 (1s) Index' },
                    { code: '1HZ25V', name: 'Volatility 25 (1s) Index' },
                    { code: '1HZ50V', name: 'Volatility 50 (1s) Index' }
                ];
                const defaultSyms = ['R_100', 'R_10', 'R_75', 'R_25', 'R_50', '1HZ100V', '1HZ10V', '1HZ75V', '1HZ25V', '1HZ50V'];
                const currentSymbol = bot.config.symbol || defaultSyms[bot.id - 86] || 'R_100';

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
                        <label>SELECT ACCUMULATOR MARKET</label>
                        <select id="symbol-\${bot.id}" style="width:100%; padding:9px; background:#1e1e38; color:#fff; border:1px solid #3b3b6d; border-radius:6px; font-weight:600;">
                            \${symbols.map(s => \`<option value="\${s.code}" \${s.code === currentSymbol ? 'selected' : ''}>\${s.name}</option>\`).join('')}
                        </select>
                    </div>

                    <div class="form-group">
                        <label>GROWTH RATE PER TICK</label>
                        <select id="growthRate-\${bot.id}" style="width:100%; padding:9px; background:#1e1e38; color:#fff; border:1px solid #3b3b6d; border-radius:6px; font-weight:600;">
                            <option value="0.01" \${growthRate == 0.01 ? 'selected' : ''}>1%</option>
                            <option value="0.02" \${growthRate == 0.02 ? 'selected' : ''}>2%</option>
                            <option value="0.03" \${growthRate == 0.03 ? 'selected' : ''}>3%</option>
                            <option value="0.04" \${growthRate == 0.04 ? 'selected' : ''}>4%</option>
                            <option value="0.05" \${(!growthRate || growthRate == 0.05) ? 'selected' : ''}>5%</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label>BASE STAKE (\$)</label>
                        <input type="number" step="0.1" id="stake-\${bot.id}" value="\${bot.config.stake || 1}">
                    </div>

                    <div class="form-group">
                        <label>TOTAL TICKS</label>
                        <input type="number" id="targetTicks-\${bot.id}" value="\${bot.config.targetTicks || 10}" min="1" max="250">
                    </div>

                    <div class="form-group">
                        <label>MAX CYCLES (0 = ∞)</label>
                        <input type="number" id="maxCycles-\${bot.id}" value="\${bot.config.maxCycles !== undefined ? bot.config.maxCycles : 10}" min="0">
                    </div>

                    <div class="form-row" style="display:flex; gap:10px;">
                        <div class="form-group" style="flex:1;">
                            <label>SESSION TP (\$)</label>
                            <input type="number" step="1" id="takeProfit-\${bot.id}" value="\${bot.config.takeProfit || 50}">
                        </div>
                        <div class="form-group" style="flex:1;">
                            <label>SESSION SL (\$)</label>
                            <input type="number" step="1" id="stopLoss-\${bot.id}" value="\${Math.abs(bot.config.stopLoss !== undefined ? bot.config.stopLoss : 30)}">
                        </div>
                    </div>

                    <div class="card-actions">
                        <button class="btn btn-toggle" id="btn-toggle-\${bot.id}" onclick="toggleBot(\${bot.id}, \${bot.isRunning})">Start</button>
                    </div>
                \`;`;

  // Remove any previous accumulator block if present
  html = html.replace(/} else if \(bot\.id >= 86 && bot\.id <= 95\) \{[\s\S]*?`\s*;/g, '');

  // Insert before the final else {
  const finalElse = `            } else {
                div.innerHTML = \`
                    <div class="card-header">`;

  if (html.includes(finalElse)) {
    html = html.replace(finalElse, accuCardTemplate + '\n' + finalElse);
    console.log(`✅ ${path.basename(hp)}: Clean Accumulator card template inserted before final else`);
  } else {
    console.log(`❌ Could not find finalElse in ${path.basename(hp)}`);
  }

  // B. In updateBot: handle accumulator fields cleanly
  html = html.replace(/} else if \(id >= 86 && id <= 95\) \{[\s\S]*?\}\s*;/g, '');

  const updateBotAccuCode = `            } else if (id >= 86 && id <= 95) {
                const growthRate = document.getElementById(\`growthRate-\${id}\`) ? document.getElementById(\`growthRate-\${id}\`).value : '0.05';
                const targetTicks = document.getElementById(\`targetTicks-\${id}\`) ? document.getElementById(\`targetTicks-\${id}\`).value : '10';
                const maxCycles = document.getElementById(\`maxCycles-\${id}\`) ? document.getElementById(\`maxCycles-\${id}\`).value : '10';
                const takeProfit = document.getElementById(\`takeProfit-\${id}\`) ? document.getElementById(\`takeProfit-\${id}\`).value : '50';
                const slVal = document.getElementById(\`stopLoss-\${id}\`) ? document.getElementById(\`stopLoss-\${id}\`).value : '30';
                const stopLoss = -Math.abs(parseFloat(slVal) || 30);

                window.hedgeClient.updateBot(id, {
                    stake, symbol, growthRate, targetTicks, maxCycles, takeProfit, stopLoss
                });
            }`;

  const updateBotFinalElse = `            } else {
                const duration = document.getElementById(\`duration-\${id}\`)`;

  if (html.includes(updateBotFinalElse)) {
    html = html.replace(updateBotFinalElse, updateBotAccuCode + '\n' + updateBotFinalElse);
    console.log(`✅ ${path.basename(hp)}: Clean updateBot Accumulator logic inserted`);
  } else {
    console.log(`❌ Could not find updateBotFinalElse in ${path.basename(hp)}`);
  }

  // Bump version to 5.0 for clean cache-busting
  html = html.replace(/\?v=[0-9.]+/g, '?v=5.0');

  fs.writeFileSync(hp, html, 'utf8');
}

console.log('🎉 ACCUMULATOR CUSTOM OPTIONS PATCH COMPLETED!');
