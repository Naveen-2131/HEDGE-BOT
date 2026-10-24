const fs = require('fs');
const path = require('path');

const basePath = 'C:/Users/ADMIN/Desktop/HEDGE-BOT-main/8-Hedge-Bot';
const derivClientPath = path.join(basePath, 'public/js/deriv-client.js');
const fourBotPath = path.join(basePath, 'public/js/4bot-browser.js');
const indexHtmlPath = path.join(basePath, 'public/index.html');
const dashHtmlPath = path.join(basePath, 'public/dashboard.html');

console.log('--- 1. Fixing deriv-client.js (Use ONLY tick_passed for Accumulator) ---');
let derivClient = fs.readFileSync(derivClientPath, 'utf8');

// Replace tick calculation in proposal_open_contract
const oldPocCalc = `          const ticks = Math.max(
            parseInt(poc.tick_passed, 10) || 0,
            parseInt(poc.tick_count, 10) || 0
          );`;

const newPocCalc = `          // In Deriv ACCU contracts, tick_passed is how many ticks survived since entry (0, 1, 2...).
          // NEVER use tick_count here because tick_count is contract max duration (e.g. 50)!
          const ticks = (poc.tick_passed !== undefined && poc.tick_passed !== null)
            ? (parseInt(poc.tick_passed, 10) || 0)
            : 0;`;

if (derivClient.includes(oldPocCalc)) {
  derivClient = derivClient.replace(oldPocCalc, newPocCalc);
  fs.writeFileSync(derivClientPath, derivClient, 'utf8');
  console.log('✅ deriv-client.js fixed: using strictly tick_passed (no 50 ticks bug)!');
} else {
  // Direct regex replacement if whitespace differed
  derivClient = derivClient.replace(/const ticks = Math\.max\([\s\S]*?\);/, newPocCalc);
  fs.writeFileSync(derivClientPath, derivClient, 'utf8');
  console.log('✅ deriv-client.js fixed via regex!');
}

console.log('--- 2. Updating 4bot-browser.js (Check currentTicks > 0 and correct ticks calculation) ---');
let fourBot = fs.readFileSync(fourBotPath, 'utf8');

// Replace checkAndSellContract in 4bot-browser.js
const oldCheckAndSell = `    // Instant Zero-Delay Auto-Cashout
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
    }`;

const newCheckAndSell = `    // Instant Zero-Delay Auto-Cashout
    checkAndSellContract(c) {
        if (!this.isRunning || !this.waitingForExit || !this.activeContractId) return;
        const cid = this.activeContractId;

        // ACCU contracts: ONLY use tick_passed. Never use tick_count (which is 50)!
        const currentTicks = (c.tick_passed !== undefined && c.tick_passed !== null)
            ? (parseInt(c.tick_passed, 10) || 0)
            : (this.ticksPassed || 0);
        this.ticksPassed = currentTicks;

        const cycleLabel = \`Cyc \${this.cyclesCompleted + 1}/\${this.maxCycles || '∞'}\`;
        if (currentTicks > 0) {
            this.updateBadge(\`⚡ Tick \${currentTicks}/\${this.targetTicks} | \${cycleLabel}\`, '#06b6d4');
        }

        // Target ticks reached -> Cashout immediately! (Must be > 0 ticks to never sell at entry tick)
        if (this.targetTicks > 0 && currentTicks >= this.targetTicks && currentTicks > 0 && !this.isSelling) {
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
    }`;

if (fourBot.includes('parseInt(c.tick_count, 10) || 0')) {
  fourBot = fourBot.replace(oldCheckAndSell, newCheckAndSell);
  fs.writeFileSync(fourBotPath, fourBot, 'utf8');
  console.log('✅ 4bot-browser.js fixed: accurate tick_passed cashout!');
} else {
  fourBot = fourBot.replace(/checkAndSellContract\(c\) \{[\s\S]*?\}\n\n    handleContractFinished/, newCheckAndSell + '\n\n    handleContractFinished');
  fs.writeFileSync(fourBotPath, fourBot, 'utf8');
  console.log('✅ 4bot-browser.js fixed via regex!');
}

console.log('--- 3. Adding Select All button next to Accumulator Bots heading in HTML files ---');
const htmlFiles = [indexHtmlPath, dashHtmlPath];

const oldHeadingRegex = /<h2 style="color: #06b6d4; margin-top: 0; display:flex; justify-content:space-between; align-items:center;">\s*<span>⚡ Accumulator Bots \(86-95\)<\/span>\s*<small[\s\S]*?<\/small>\s*<\/h2>/;

const newHeadingHtml = `<h2 style="color: #06b6d4; margin-top: 0; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <div style="display:flex; align-items:center; gap:12px;">
                <span>⚡ Accumulator Bots (86-95)</span>
                <button type="button" id="btnSelectAllAccu" onclick="toggleSelectAllAccu()" style="background:#0891b2; color:#ffffff; border:none; padding:6px 14px; border-radius:6px; font-size:0.85rem; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:6px; box-shadow:0 2px 6px rgba(6, 182, 212, 0.3); transition:all 0.2s ease;">
                    <input type="checkbox" id="chkSelectAllAccu" style="cursor:pointer; pointer-events:none; margin:0;" />
                    <span id="lblSelectAllAccu">Select All</span>
                </button>
            </div>
            <small style="font-size:0.9rem; color:#a1a1aa; font-weight:normal;">Auto Cashout Growth Trading (1% - 5%)</small>
        </h2>`;

const selectAllScript = `
        function toggleSelectAllAccu() {
            const chk = document.getElementById('chkSelectAllAccu');
            const lbl = document.getElementById('lblSelectAllAccu');
            const grid = document.getElementById('accumulator-grid');
            if (!grid) return;

            const isChecked = chk ? !chk.checked : true;
            if (chk) chk.checked = isChecked;
            if (lbl) lbl.textContent = isChecked ? 'Deselect All' : 'Select All';

            const checks = grid.querySelectorAll('.bot-check');
            checks.forEach(c => {
                c.checked = isChecked;
            });
        }
`;

for (const fp of htmlFiles) {
  let html = fs.readFileSync(fp, 'utf8');

  // Replace heading
  if (oldHeadingRegex.test(html)) {
    html = html.replace(oldHeadingRegex, newHeadingHtml);
    console.log(`✅ Replaced Accumulator heading with Select All button in ${path.basename(fp)}`);
  } else if (!html.includes('id="btnSelectAllAccu"')) {
    html = html.replace('<span>⚡ Accumulator Bots (86-95)</span>', `<div style="display:flex; align-items:center; gap:12px;">
                <span>⚡ Accumulator Bots (86-95)</span>
                <button type="button" id="btnSelectAllAccu" onclick="toggleSelectAllAccu()" style="background:#0891b2; color:#ffffff; border:none; padding:6px 14px; border-radius:6px; font-size:0.85rem; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:6px; box-shadow:0 2px 6px rgba(6, 182, 212, 0.3); transition:all 0.2s ease;">
                    <input type="checkbox" id="chkSelectAllAccu" style="cursor:pointer; pointer-events:none; margin:0;" />
                    <span id="lblSelectAllAccu">Select All</span>
                </button>
            </div>`);
    console.log(`✅ Inserted Select All button into heading in ${path.basename(fp)}`);
  }

  // Add toggleSelectAllAccu function if not present
  if (!html.includes('function toggleSelectAllAccu()')) {
    html = html.replace('    </script>\n</body>', selectAllScript + '\n    </script>\n</body>');
    console.log(`✅ Added toggleSelectAllAccu function to ${path.basename(fp)}`);
  }

  // Bump version to 9.0 for cache busting
  html = html.replace(/\?v=[0-9.]+/g, '?v=9.0');
  fs.writeFileSync(fp, html, 'utf8');
  console.log(`✅ ${path.basename(fp)} version bumped to 9.0`);
}

console.log('🎉 Fix complete!');
