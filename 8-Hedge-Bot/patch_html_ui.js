const fs = require('fs');
const path = require('path');

const files = [
  'C:/Users/ADMIN/Desktop/HEDGE-BOT-main/8-Hedge-Bot/public/index.html',
  'C:/Users/ADMIN/Desktop/HEDGE-BOT-main/8-Hedge-Bot/public/dashboard.html'
];

for (const f of files) {
  let content = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

  // 1. Replace the top redirect buttons with toggleSection('accumulator')
  content = content.replace(
    /<button class="btn-start-all"[^>]*onclick="window\.location\.href='\/accumulator\/index\.html'"[^>]*>.*?<\/button>/g,
    '<button class="btn-start-all" style="background-color: #06b6d4; font-weight: 700;" onclick="toggleSection(\'accumulator\')">⚡ ACCUMULATOR BOTS</button>'
  );

  content = content.replace(
    /<button class="btn"[^>]*onclick="window\.location\.href='\/accumulator\/index\.html'"[^>]*>.*?<\/button>/g,
    '<button class="btn" style="background-color: #06b6d4; flex: 1; min-width: 150px; padding: 10px; font-weight: 700;" onclick="toggleSection(\'accumulator\')">📁 Accumulator Bots</button>'
  );

  // 2. Ensure Accumulator section exists and is clearly visible
  const accuSectionHtml = `    <!-- Accumulator Bots Section (86-95) -->
    <div id="accumulator-section"
        style="display: block; margin-bottom: 40px; border: 2px solid #06b6d4; padding: 20px; border-radius: 12px; background: rgba(6, 182, 212, 0.05);">
        <h2 style="color: #06b6d4; margin-top: 0; display:flex; justify-content:space-between; align-items:center;">
            <span>⚡ Accumulator Bots (86-95)</span>
            <small style="font-size:0.9rem; color:#a1a1aa; font-weight:normal;">Auto Cashout Growth Trading (1% - 5%)</small>
        </h2>
        <div class="grid" id="accumulator-grid"></div>
    </div>\n\n`;

  if (content.includes('id="accumulator-section"')) {
    // Replace existing section with open one
    content = content.replace(/<!-- Accumulator Bots Section[\s\S]*?<\/div>\s*<\/div>/, accuSectionHtml.trim());
  } else {
    // Insert before Over Bots section or after global header
    content = content.replace('    <!-- Over Bots Section -->', accuSectionHtml + '    <!-- Over Bots Section -->');
  }

  // 3. In updateDashboard: make sure container routing has accumulator-grid
  if (!content.includes("else if (bot.id >= 86 && bot.id <= 95)")) {
    content = content.replace(
      "else if (bot.id >= 76 && bot.id <= 85) container = document.getElementById('hedgehilo-grid');",
      "else if (bot.id >= 76 && bot.id <= 85) container = document.getElementById('hedgehilo-grid');\n                else if (bot.id >= 86 && bot.id <= 95) container = document.getElementById('accumulator-grid');"
    );
  }

  // 4. In createCard: add Accumulator Bot template
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
                        <select id="symbol-\${bot.id}" style="width:100%; padding:8px; background:var(--bg-card); color:#fff; border:1px solid var(--border); border-radius:6px;">
                            <option value="R_100" \${(bot.config.symbol === 'R_100' || !bot.config.symbol) ? 'selected' : ''}>Volatility 100 Index (R_100)</option>
                            <option value="R_10" \${bot.config.symbol === 'R_10' ? 'selected' : ''}>Volatility 10 Index (R_10)</option>
                            <option value="R_25" \${bot.config.symbol === 'R_25' ? 'selected' : ''}>Volatility 25 Index (R_25)</option>
                            <option value="R_50" \${bot.config.symbol === 'R_50' ? 'selected' : ''}>Volatility 50 Index (R_50)</option>
                            <option value="R_75" \${bot.config.symbol === 'R_75' ? 'selected' : ''}>Volatility 75 Index (R_75)</option>
                            <option value="1HZ100V" \${bot.config.symbol === '1HZ100V' ? 'selected' : ''}>Volatility 100 (1s) Index</option>
                            <option value="1HZ10V" \${bot.config.symbol === '1HZ10V' ? 'selected' : ''}>Volatility 10 (1s) Index</option>
                            <option value="1HZ25V" \${bot.config.symbol === '1HZ25V' ? 'selected' : ''}>Volatility 25 (1s) Index</option>
                            <option value="1HZ50V" \${bot.config.symbol === '1HZ50V' ? 'selected' : ''}>Volatility 50 (1s) Index</option>
                            <option value="1HZ75V" \${bot.config.symbol === '1HZ75V' ? 'selected' : ''}>Volatility 75 (1s) Index</option>
                        </select>
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

  if (!content.includes('else if (bot.id >= 86 && bot.id <= 95)')) {
    content = content.replace(
      '} else if (bot.id >= 76 && bot.id <= 85) {',
      accuCardTemplate + '\n            } else if (bot.id >= 76 && bot.id <= 85) {'
    );
  }

  // 5. In updateBot: handle accumulator fields
  const updateBotAccuCode = `            } else if (id >= 86 && id <= 95) {
                const growthRate = document.getElementById(\`growthRate-\${id}\`) ? document.getElementById(\`growthRate-\${id}\`).value : '0.05';
                const targetTicks = document.getElementById(\`targetTicks-\${id}\`) ? document.getElementById(\`targetTicks-\${id}\`).value : '10';
                const maxCycles = document.getElementById(\`maxCycles-\${id}\`) ? document.getElementById(\`maxCycles-\${id}\`).value : '10';
                const takeProfit = document.getElementById(\`takeProfit-\${id}\`) ? document.getElementById(\`takeProfit-\${id}\`).value : '50';
                const stopLoss = document.getElementById(\`stopLoss-\${id}\`) ? document.getElementById(\`stopLoss-\${id}\`).value : '-30';

                window.hedgeClient.updateBot(id, {
                    stake, symbol, growthRate, targetTicks, maxCycles, takeProfit, stopLoss
                });`;

  if (!content.includes('else if (id >= 86 && id <= 95)')) {
    content = content.replace(
      '} else if (id >= 76 && id <= 85) {',
      updateBotAccuCode + '\n            } else if (id >= 76 && id <= 85) {'
    );
  }

  // 6. Bump cache buster to ?v=4.0
  content = content.replace(/\?v=[0-9.]+/g, '?v=4.0');

  fs.writeFileSync(f, content, 'utf8');
  console.log('✅ Patched UI in:', f);
}
