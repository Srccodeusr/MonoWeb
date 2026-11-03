'use strict';
// npm run configure -- --panel https://panel.example.com --key <secret> [--port 3100] [--allow <panel-ip>]
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const arg = n => { const a = process.argv.slice(2); const i = a.indexOf('--' + n); return i > -1 ? a[i + 1] || '' : ''; };
const panel = arg('panel').replace(/\/+$/, ''), key = arg('key');
if (!panel || !key) { console.error('Usage: npm run configure -- --panel <url> --key <secret> [--port 3100] [--allow <panel-ip>]'); process.exit(1); }
if (key.length < 32) { console.error('The secret from the panel must be at least 32 characters.'); process.exit(1); }
const file = path.join(process.cwd(), '.env');
let src = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : fs.readFileSync(path.join(process.cwd(), '.env.example'), 'utf8');
const set = (k, v) => { src = new RegExp(`^${k}=.*$`, 'm').test(src) ? src.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`) : src.trimEnd() + `\n${k}=${v}\n`; };
set('DAEMON_SECRET', key);
if (arg('port')) set('DAEMON_PORT', arg('port'));
if (arg('allow')) set('ALLOWED_IPS', arg('allow'));
fs.writeFileSync(file, src, { mode: 0o600 });
console.log(`Wrote ${file} (fingerprint ${crypto.createHash('sha256').update(key).digest('hex').slice(0, 8)}). Start with: npm start`);
