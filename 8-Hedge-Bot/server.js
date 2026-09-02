const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const candidates = [
  path.join(__dirname, 'public'),
  path.join(process.cwd(), 'public'),
  __dirname
];

candidates.forEach(d => { if (fs.existsSync(d)) app.use(express.static(d)); });

app.get('*', (req, res) => {
  for (const d of candidates) {
    for (const f of ['index.html', 'dashboard.html', 'hedge-dashboard.html']) {
      const p = path.join(d, f);
      if (fs.existsSync(p)) return res.sendFile(p);
    }
  }
  res.status(404).send('Not Found');
});

app.listen(PORT, () => console.log('Server running on port ' + PORT));
