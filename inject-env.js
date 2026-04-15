// inject-env.js — Netlify build step
// Replaces placeholder tokens in static HTML files with real env var values.
// Keeps secrets out of source code while keeping the site fully static (no bundler needed).
//
// Required Netlify env vars:
//   FIREBASE_API_KEY      — Firebase Web API key (public client identifier)
//   GOOGLE_MAPS_API_KEY   — Google Maps JavaScript API key

const fs = require('fs');

const FIREBASE_API_KEY    = process.env.FIREBASE_API_KEY    || '';
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';

if (!FIREBASE_API_KEY)    console.warn('[inject-env] WARNING: FIREBASE_API_KEY is not set');
if (!GOOGLE_MAPS_API_KEY) console.warn('[inject-env] WARNING: GOOGLE_MAPS_API_KEY is not set');

const FILES = ['index.html', 'admin.html', 'start.html', 'track.html', 'admin-module.js'];

let totalReplacements = 0;
for (const file of FILES) {
  if (!fs.existsSync(file)) { console.log(`[inject-env] Skipping ${file} (not found)`); continue; }
  let content = fs.readFileSync(file, 'utf8');
  const before = content;
  content = content.replace(/__FIREBASE_API_KEY__/g,    FIREBASE_API_KEY);
  content = content.replace(/__GOOGLE_MAPS_API_KEY__/g, GOOGLE_MAPS_API_KEY);
  if (content !== before) {
    fs.writeFileSync(file, content, 'utf8');
    const count = (before.match(/__FIREBASE_API_KEY__|__GOOGLE_MAPS_API_KEY__/g) || []).length;
    totalReplacements += count;
    console.log(`[inject-env] ${file} — replaced ${count} token(s)`);
  } else {
    console.log(`[inject-env] ${file} — no tokens found (already injected or no placeholders)`);
  }
}
console.log(`[inject-env] Done. ${totalReplacements} total replacements across ${FILES.length} files.`);
