const fs = require('fs');
const path = require('path');

const publicDir = 'C:/Users/ADMIN/Desktop/HEDGE-BOT-main/8-Hedge-Bot/public';
const files = [
  path.join(publicDir, 'index.html'),
  path.join(publicDir, 'dashboard.html')
];

const growthStyles = `
        /* Accumulator Growth Pills */
        .growth-grid {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 6px;
            margin-top: 4px;
        }
        .growth-option {
            padding: 10px 4px;
            text-align: center;
            background: rgba(15, 23, 42, 0.7);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 8px;
            font-size: 0.95rem;
            font-weight: 700;
            color: #94a3b8;
            cursor: pointer;
            user-select: none;
            transition: all 0.2s ease;
        }
        .growth-option:hover {
            border-color: #6366f1;
            color: #ffffff;
            background: rgba(99, 102, 241, 0.12);
        }
        .growth-option.active {
            background: rgba(99, 102, 241, 0.25);
            border: 2px solid #6366f1;
            color: #ffffff;
            box-shadow: 0 0 12px rgba(99, 102, 241, 0.4);
        }
`;

const selectGrowthRateFunc = `
        function selectGrowthRate(botId, rate) {
            const input = document.getElementById(\`growthRate-\${botId}\`);
            if (input) input.value = rate;

            const grid = document.getElementById(\`growthGrid-\${botId}\`);
            if (grid) {
                const opts = grid.querySelectorAll('.growth-option');
                opts.forEach(el => {
                    const pct = Math.round(rate * 100) + '%';
                    if (el.textContent.trim() === pct) {
                        el.classList.add('active');
                    } else {
                        el.classList.remove('active');
                    }
                });
            }

            if (typeof updateBot === 'function') {
                updateBot(botId);
            }
        }
`;

for (const fp of files) {
  let html = fs.readFileSync(fp, 'utf8').replace(/\r\n/g, '\n');

  // 1. Add growthStyles before </style> if not already added
  if (!html.includes('.growth-grid {')) {
    html = html.replace('    </style>', growthStyles + '\n    </style>');
    console.log(`✅ ${path.basename(fp)}: Added .growth-grid CSS styles`);
  }

  // 2. Add selectGrowthRateFunc before </script>
  if (!html.includes('function selectGrowthRate(')) {
    html = html.replace('    </script>\n</body>', selectGrowthRateFunc + '\n    </script>\n</body>');
    console.log(`✅ ${path.basename(fp)}: Added selectGrowthRate function`);
  }

  // 3. Update createCard accumulator template with growth pills
  const oldGrowthSelectRegex = /<div class="form-group">\s*<label>GROWTH RATE PER TICK<\/label>[\s\S]*?<\/select>\s*<\/div>/;

  const newGrowthPills = `<div class="form-group">
                        <label>GROWTH RATE PER TICK</label>
                        <input type="hidden" id="growthRate-\${bot.id}" value="\${growthRate}">
                        <div class="growth-grid" id="growthGrid-\${bot.id}">
                            <div class="growth-option \${Math.abs(growthRate - 0.01) < 0.001 ? 'active' : ''}" onclick="selectGrowthRate(\${bot.id}, 0.01)">1%</div>
                            <div class="growth-option \${Math.abs(growthRate - 0.02) < 0.001 ? 'active' : ''}" onclick="selectGrowthRate(\${bot.id}, 0.02)">2%</div>
                            <div class="growth-option \${Math.abs(growthRate - 0.03) < 0.001 ? 'active' : ''}" onclick="selectGrowthRate(\${bot.id}, 0.03)">3%</div>
                            <div class="growth-option \${Math.abs(growthRate - 0.04) < 0.001 ? 'active' : ''}" onclick="selectGrowthRate(\${bot.id}, 0.04)">4%</div>
                            <div class="growth-option \${(!growthRate || Math.abs(growthRate - 0.05) < 0.001) ? 'active' : ''}" onclick="selectGrowthRate(\${bot.id}, 0.05)">5%</div>
                        </div>
                    </div>`;

  if (oldGrowthSelectRegex.test(html)) {
    html = html.replace(oldGrowthSelectRegex, newGrowthPills);
    console.log(`✅ ${path.basename(fp)}: Replaced Growth select with 1%-5% pills`);
  } else {
    console.log(`⚠️ Could not match oldGrowthSelectRegex in ${path.basename(fp)}`);
  }

  // Bump version to 6.0 for clean cache-busting
  html = html.replace(/\?v=[0-9.]+/g, '?v=6.0');

  fs.writeFileSync(fp, html, 'utf8');
}

console.log('🎉 Growth rate pills integration complete!');
