const fs = require('fs');
const path = require('path');

const derivClientPath = 'C:/Users/ADMIN/Desktop/HEDGE-BOT-main/8-Hedge-Bot/public/js/deriv-client.js';
const fourBotPath = 'C:/Users/ADMIN/Desktop/HEDGE-BOT-main/8-Hedge-Bot/public/js/4bot-browser.js';

// ==========================================
// 1. UPDATE DERIV-CLIENT.JS
// ==========================================
let dc = fs.readFileSync(derivClientPath, 'utf8');

// Replace checkContract with zero-API pure cache lookup
const checkContractRegex = /async checkContract\(contractId\)[\s\S]*?\n  \}/;
const newCheckContract = `async checkContract(contractId) {
    if (!contractId) return null;

    // Zero API calls: Read from push stream cache (eliminates rate limit completely)
    if (this.openContractsCache.has(contractId)) {
      const cached = this.openContractsCache.get(contractId);
      if (cached && cached.is_sold) {
        // Retain briefly so multiple checks can read the exit, then delete
        setTimeout(() => this.openContractsCache.delete(contractId), 10000);
      }
      return cached;
    }

    // Default open state while awaiting Deriv push event
    return { is_sold: false, profit: 0, status: 'open' };
  }`;

if (checkContractRegex.test(dc)) {
  dc = dc.replace(checkContractRegex, newCheckContract);
  console.log('✅ checkContract updated in deriv-client.js');
} else {
  console.log('❌ Failed to match checkContract in deriv-client.js');
}

// In buy(), ensure cache is initialized immediately
const buyEndRegex = /const cid = buyRes\.buy\.contract_id;[\s\S]*?return \{ contract_id: cid \};/;
const newBuyEnd = `const cid = buyRes.buy.contract_id;
    // Initialize cache immediately so checkContract never returns null or polls
    this.openContractsCache.set(cid, { is_sold: false, profit: 0, status: 'open' });
    // Subscribe to contract push updates ONCE
    this.send({ proposal_open_contract: 1, contract_id: cid, subscribe: 1 }).catch(() => {});
    return { contract_id: cid };`;

if (buyEndRegex.test(dc)) {
  dc = dc.replace(buyEndRegex, newBuyEnd);
  console.log('✅ buy() cache init updated in deriv-client.js');
} else {
  console.log('❌ Failed to match buyEnd in deriv-client.js');
}

fs.writeFileSync(derivClientPath, dc, 'utf8');

// ==========================================
// 2. UPDATE 4BOT-BROWSER.JS
// ==========================================
let fb = fs.readFileSync(fourBotPath, 'utf8');

// A. SubStrategy: remove auto-stop on takeProfit/stopLoss
fb = fb.replace(
  /if \(this\.sessionProfit >= this\.takeProfit \|\| this\.sessionProfit <= this\.stopLoss\) \{[\s\S]*?return;\s*\}/,
  `// Target profit/loss limits removed - runs unlimited until user clicks Stop`
);

// B. OddEvenPatternBot:
// 1. In onTick: release stake on sold, remove auto-stops
const oddEvenOnTickOld = /const p = parseFloat\(c\.profit\);[\s\S]*?if \(this\.totalStake >= this\.maxTotalStake && this\.pendingContracts\.size === 0\) \{[\s\S]*?this\.stop\(\);[\s\S]*?\}/;
const oddEvenOnTickNew = `const p = parseFloat(c.profit);
                    this.sessionProfit += p;
                    this.profit = this.sessionProfit;
                    // Release active stake so trading runs unlimited
                    this.totalStake = Math.max(0, this.totalStake - this.stake);

                    const result = p >= 0 ? "✅ PROFIT" : "❌ LOSS";
                    console.log(\`🎯 [Bot \${this.id}] Trade ID: \${cid} → \${result} (\${p.toFixed(2)} USD)\`);
                    // Unlimited: no auto-stop on stake or profit limits`;

if (oddEvenOnTickOld.test(fb)) {
  fb = fb.replace(oddEvenOnTickOld, oddEvenOnTickNew);
  console.log('✅ OddEvenPatternBot.onTick updated for unlimited');
} else {
  console.log('⚠️ Could not match OddEvenPatternBot.onTick');
}

// 2. In OddEvenPatternBot.executeTrade: remove maxTotalStake guard
fb = fb.replace(
  /async executeTrade\(\) \{\s*if \(!this\.isRunning \|\| this\.isTrading \|\| this\.totalStake >= this\.maxTotalStake\) return;/,
  `async executeTrade() {\n        if (!this.isRunning || this.isTrading) return;`
);

// C. OverUnderPatternBot:
// 1. In onTick: release stake on sold, remove auto-stops
const overUnderOnTickOld = /const p = parseFloat\(c\.profit\);[\s\S]*?if \(this\.totalStake >= this\.maxTotalStake && this\.pendingContracts\.size === 0\) \{[\s\S]*?this\.stop\(\);[\s\S]*?\}/;
const overUnderOnTickNew = `const p = parseFloat(c.profit);
                    this.sessionProfit += p;
                    this.profit = this.sessionProfit;
                    this.totalStake = Math.max(0, this.totalStake - this.stake);

                    const result = p >= 0 ? "✅ PROFIT" : "❌ LOSS";
                    console.log(\`🎯 [Bot \${this.id}] \${info.type} \${info.barrier} → \${result} (\${p.toFixed(2)} USD)\`);
                    // Unlimited: no auto-stop on stake or profit limits`;

if (overUnderOnTickOld.test(fb)) {
  fb = fb.replace(overUnderOnTickOld, overUnderOnTickNew);
  console.log('✅ OverUnderPatternBot.onTick updated for unlimited');
} else {
  console.log('⚠️ Could not match OverUnderPatternBot.onTick');
}

// 2. In OverUnderPatternBot.executeTrade: remove maxTotalStake guard
fb = fb.replace(
  /async executeTrade\(\) \{\s*if \(!this\.isRunning \|\| this\.isTrading \|\| this\.totalStake >= this\.maxTotalStake\) return;/,
  `async executeTrade() {\n        if (!this.isRunning || this.isTrading) return;`
);
// Also remove inside loop: if (this.totalStake >= this.maxTotalStake) break;
fb = fb.replace(/if \(this\.totalStake >= this\.maxTotalStake\) break;/, '// Unlimited stake');

// D. HigherLowerPatternBot:
// In executeTrade: ensure barrier is strictly 1 (+1 for higher, -1 for lower)
fb = fb.replace(
  /const barrierVal = \(this\.barrier \|\| '0\.1'\)\.toString\(\)\.replace\(\/\^\[\+-\]\/, ''\);/,
  `const barrierVal = (this.barrier || '1').toString().replace(/^[+-]/, '') || '1';`
);

// In executeTrade: remove maxTotalStake guard
fb = fb.replace(
  /async executeTrade\(\) \{\s*if \(!this\.isRunning \|\| this\.isTrading \|\| this\.totalStake >= this\.maxTotalStake\) return;/,
  `async executeTrade() {\n        if (!this.isRunning || this.isTrading) return;`
);
fb = fb.replace(/if \(this\.totalStake \+ this\.stake > this\.maxTotalStake\) break;/, '// Unlimited stake');

// E. RiseFallPatternBot:
// 1. In onTick: release stake on sold, remove auto-stops
const riseFallOnTickOld = /const p = parseFloat\(c\.profit\);[\s\S]*?if \(this\.totalStake >= this\.maxTotalStake && this\.pendingContracts\.size === 0\) \{[\s\S]*?this\.stop\(\);[\s\S]*?\}/;
const riseFallOnTickNew = `const p = parseFloat(c.profit);
                    this.sessionProfit += p;
                    this.profit = this.sessionProfit;
                    this.totalStake = Math.max(0, this.totalStake - this.stake);

                    const result = p >= 0 ? "✅ PROFIT" : "❌ LOSS";
                    console.log(\`🎯 [Bot \${this.id}] Trade ID: \${cid} → \${result} (\${p.toFixed(2)} USD)\`);
                    // Unlimited: no auto-stop on stake or profit limits`;

if (riseFallOnTickOld.test(fb)) {
  fb = fb.replace(riseFallOnTickOld, riseFallOnTickNew);
  console.log('✅ RiseFallPatternBot.onTick updated for unlimited');
} else {
  console.log('⚠️ Could not match RiseFallPatternBot.onTick');
}

// 2. In RiseFallPatternBot.executeTrade: remove maxTotalStake guard
fb = fb.replace(
  /async executeTrade\(\) \{\s*if \(!this\.isRunning \|\| this\.isTrading \|\| this\.totalStake >= this\.maxTotalStake\) return;/,
  `async executeTrade() {\n        if (!this.isRunning || this.isTrading) return;`
);

// F. DigitDifferPatternBot:
// 1. Remove auto-stop on profit/loss
fb = fb.replace(
  /if \(this\.sessionProfit >= this\.takeProfit \|\| this\.sessionProfit <= this\.stopLoss\) \{\s*console\.log\(`\[Bot \${this\.id}\] Target reached[\s\S]*?this\.stop\(\);\s*\}/,
  `// Unlimited: no auto-stop on profit/loss limits`
);

// G. HedgeMatchBot:
// Remove maxTotalStake auto-stop
fb = fb.replace(
  /if \(!this\.isRunning \|\| \(this\.totalStake >= this\.maxTotalStake && this\.openContracts\.size === 0\)\) \{\s*console\.log\(`\[Bot \${this\.id}\] All contracts finished\. Stopping\.\`\);\s*this\.stop\(\);\s*\}/,
  `// Unlimited: no auto-stop on max stake`
);

// H. HedgeHigherLowerBot:
// 1. Use HIGHER and LOWER (not CALL and PUT)
const hedgeHiLoOldBuy = /this\.bot\.buy\('CALL', currentStake, duration, this\.durationUnit, hBarrier, this\.symbol\),\s*this\.bot\.buy\('PUT', currentStake, duration, this\.durationUnit, lBarrier, this\.symbol\)/;
const hedgeHiLoNewBuy = `this.bot.buy('HIGHER', currentStake, duration, this.durationUnit, hBarrier, this.symbol),\n                this.bot.buy('LOWER', currentStake, duration, this.durationUnit, lBarrier, this.symbol)`;
if (hedgeHiLoOldBuy.test(fb)) {
  fb = fb.replace(hedgeHiLoOldBuy, hedgeHiLoNewBuy);
  console.log('✅ HedgeHigherLowerBot updated to use HIGHER and LOWER contracts');
} else {
  console.log('⚠️ Could not match HedgeHigherLowerBot CALL/PUT buy');
}

// 2. Ensure barriers default to strictly 1 (+1 and -1)
fb = fb.replace(
  /const hVal = \(this\.higherBarrier \|\| '0\.1'\)\.toString\(\)\.replace\(\/\^\[\+-\]\/, ''\);/,
  `const hVal = (this.higherBarrier || '1').toString().replace(/^[+-]/, '') || '1';`
);
fb = fb.replace(
  /const lVal = \(this\.lowerBarrier \|\| '0\.1'\)\.toString\(\)\.replace\(\/\^\[\+-\]\/, ''\);/,
  `const lVal = (this.lowerBarrier || '1').toString().replace(/^[+-]/, '') || '1';`
);

// 3. Remove auto-stop on profit/loss in HedgeHigherLowerBot
fb = fb.replace(
  /if \(this\.sessionProfit >= this\.takeProfit \|\| this\.sessionProfit <= this\.stopLoss\) \{\s*console\.log\(`\[Bot \${this\.id}\] Target reached\. Session Profit:[\s\S]*?this\.stop\(\);\s*\}/,
  `// Unlimited: no auto-stop on profit/loss limits`
);

// I. FourBotStrategy: Differ bots consecutiveCount: 3 (was 4)
fb = fb.replace(/consecutiveCount: 4,/g, 'consecutiveCount: 3,');

// J. Suppress any rate-limit or minor tick error logging so Live Terminal is clean
fb = fb.replace(
  /console\.error\(`\[Bot \$\{this\.id\}\] Error in Tick:`, e\.message \|\| e\);/g,
  `if (!e.message || !e.message.includes('rate limit')) console.error(\`[Bot \${this.id}] Error in Tick:\`, e.message || e);`
);

// Ensure default barrier in HedgeHigherLowerBot is +1 / -1
fb = fb.replace("config.higherBarrier || '+0.1'", "config.higherBarrier || '+1'");
fb = fb.replace("config.lowerBarrier || '-0.1'", "config.lowerBarrier || '-1'");

fs.writeFileSync(fourBotPath, fb, 'utf8');
console.log('✅ 4bot-browser.js written successfully');

// ==========================================
// 3. UPDATE HTML FILES (index.html, dashboard.html)
// ==========================================
const htmlFiles = [
  'C:/Users/ADMIN/Desktop/HEDGE-BOT-main/8-Hedge-Bot/public/index.html',
  'C:/Users/ADMIN/Desktop/HEDGE-BOT-main/8-Hedge-Bot/public/dashboard.html'
];
for (const f of htmlFiles) {
  if (fs.existsSync(f)) {
    let content = fs.readFileSync(f, 'utf8');
    content = content.replace(/value\s*:\s*'\+0\.1'/g, "value : '+1'");
    content = content.replace(/value\s*:\s*'-0\.1'/g, "value : '-1'");
    fs.writeFileSync(f, content, 'utf8');
    console.log('✅ Updated default barrier fallbacks in', f);
  }
}

