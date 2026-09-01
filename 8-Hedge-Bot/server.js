/**
 * Robust Express static server for Render.com deployment
 * All trading logic runs client-side in the browser
 * Multi-path Static Server for Render.com deployment
 * Automatically resolves public directory regardless of repo folder structure
 */
const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3001;
const publicDir = path.join(__dirname, 'public');
// Candidate locations where public files might exist
const candidates = [
  path.join(__dirname, 'public'),
  path.join(__dirname, '..', 'public'),
  path.join(process.cwd(), 'public'),
  path.join(process.cwd(), '8-Hedge-Bot', 'public'),
  __dirname,
  process.cwd()
];
// Serve all static files from /public
app.use(express.static(publicDir));
// Route handlers for specific html requests
app.get('/', (req, res) => {
  sendFirstAvailableFile(res, ['index.html', 'dashboard.html', 'hedge-dashboard.html']);
// Serve static assets from all existing candidate directories
candidates.forEach(dir => {
  if (fs.existsSync(dir)) {
    app.use(express.static(dir));
  }
});
app.get('/hedge-dashboard.html', (req, res) => {
  sendFirstAvailableFile(res, ['index.html', 'dashboard.html', 'hedge-dashboard.html']);
});
app.get('/dashboard.html', (req, res) => {
  sendFirstAvailableFile(res, ['index.html', 'dashboard.html', 'hedge-dashboard.html']);
});
function sendFirstAvailableFile(res, fileList) {
  for (const filename of fileList) {
    const fullPath = path.join(publicDir, filename);
