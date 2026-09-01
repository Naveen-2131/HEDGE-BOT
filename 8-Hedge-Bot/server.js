/**
 * Simple Express static server for Render.com deployment
 * All trading logic runs client-side in the browser
 */
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Serve all static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// Default route → hedge-dashboard.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'hedge-dashboard.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Hedge Bot Dashboard running on http://localhost:${PORT}`);
});
