const fs = require('fs');

const files = [
  'C:/Users/ADMIN/Desktop/HEDGE-BOT-main/8-Hedge-Bot/public/index.html',
  'C:/Users/ADMIN/Desktop/HEDGE-BOT-main/8-Hedge-Bot/public/dashboard.html'
];

for (const f of files) {
  if (fs.existsSync(f)) {
    let html = fs.readFileSync(f, 'utf8');
    html = html.replace('src="js/deriv-client.js"', 'src="js/deriv-client.js?v=2.1"');
    html = html.replace('src="js/4bot-browser.js"', 'src="js/4bot-browser.js?v=2.1"');
    html = html.replace('src="js/hedge-client.js"', 'src="js/hedge-client.js?v=2.1"');
    fs.writeFileSync(f, html, 'utf8');
    console.log('Cache-busted:', f);
  }
}
