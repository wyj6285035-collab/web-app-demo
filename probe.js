'use strict';
// Optional monitoring agent (cf-probe). Starts only when CFSM_SECRET and CFSM_URL are set.
// Failures here never affect the web app.
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

const ARCH = { x64: 'amd64', arm64: 'arm64', ia32: '386' }[process.arch];
const VERSION = process.env.CFSM_VERSION || 'v1.1.3';
const DIR = process.env.CFSM_DIR || path.join(os.tmpdir(), 'cfsm');

function get(url, dest, cb, depth = 0) {
  https.get(url, { headers: { 'user-agent': 'node' } }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth < 5) {
      res.resume();
      return get(res.headers.location, dest, cb, depth + 1);
    }
    if (res.statusCode !== 200) { res.resume(); return cb(new Error('HTTP ' + res.statusCode)); }
    const out = fs.createWriteStream(dest, { mode: 0o755 });
    res.pipe(out);
    out.on('finish', () => out.close(() => cb()));
    out.on('error', cb);
  }).on('error', cb);
}

function run(bin, conf) {
  const p = spawn(bin, ['run', '-config', conf], { stdio: ['ignore', 'inherit', 'inherit'] });
  p.on('error', (e) => console.error('[probe] spawn error:', e.message));
  p.on('exit', (code) => {
    console.error('[probe] exited with', code, '- restarting in 30s');
    setTimeout(() => run(bin, conf), 30000).unref();
  });
}

function start() {
  const { CFSM_ID = '', CFSM_SECRET, CFSM_URL } = process.env;
  if (!CFSM_SECRET || !CFSM_URL) return;
  if (!ARCH) return console.error('[probe] unsupported arch', process.arch);
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const conf = path.join(DIR, 'config.conf');
    const kv = {
      SERVER_ID: CFSM_ID,
      SECRET: CFSM_SECRET,
      WORKER_URL: CFSM_URL,
      COLLECT_INTERVAL: process.env.CFSM_COLLECT_INTERVAL || '0',
      REPORT_INTERVAL: process.env.CFSM_INTERVAL || '60',
      RESET_DAY: '1',
      CONNECTION_MODE: process.env.CFSM_CONNECTION_MODE || 'auto',
      PING_MODE: 'tcp',
      CONFIG_MD5: 'none',
      AUTO_UPDATE: '0',
    };
    fs.writeFileSync(conf, Object.entries(kv).map(([k, v]) => `${k}="${v}"`).join('\n') + '\n', { mode: 0o600 });
    const bin = path.join(DIR, 'cf-probe');
    const url = `https://github.com/huilang-me/cfsm-agent/releases/download/${VERSION}/cf-probe-linux-${ARCH}`;
    const go = () => { console.log('[probe] starting'); run(bin, conf); };
    if (fs.existsSync(bin)) return go();
    get(url, bin + '.tmp', (err) => {
      if (err) return console.error('[probe] download failed:', err.message);
      fs.renameSync(bin + '.tmp', bin);
      go();
    });
  } catch (e) {
    console.error('[probe] disabled:', e.message);
  }
}

module.exports = { start };
