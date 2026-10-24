const fs = require('fs');

const html = fs.readFileSync('C:/Users/ADMIN/Desktop/HEDGE-BOT-main/8-Hedge-Bot/public/index.html', 'utf8');

console.log('1. Has toggleSection accumulator:', html.includes("toggleSection('accumulator')"));
console.log('2. Has accumulator-section div:', html.includes('id="accumulator-section"'));
console.log('3. Has bot.id >= 86 in createCard:', html.includes('bot.id >= 86 && bot.id <= 95'));

const m = html.match(/id="accumulator-section"[\s\S]*?style="([^"]*)"/);
if (m) {
  console.log('4. Accumulator section style:', m[1]);
}

const btns = html.match(/<button[^>]*Accumulator[^>]*>[\s\S]*?<\/button>/gi);
console.log('5. Accumulator buttons:', btns);
