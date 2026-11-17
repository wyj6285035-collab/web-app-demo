'use strict';
const http = require('http');
const net = require('net');
const dgram = require('dgram');
const { WebSocketServer } = require('ws');
const probe = require('./probe');

const PORT = parseInt(process.env.PORT || '3000', 10);
const UUID = (process.env.UUID || '').trim().toLowerCase();
const WSPATH = process.env.WSPATH || '/api/ws';

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(UUID)) {
  console.error('[fatal] env UUID is missing or invalid');
  process.exit(1);
}
const ID = Buffer.from(UUID.replace(/-/g, ''), 'hex');

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Web App Demo</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:60px auto;padding:0 16px;color:#222}</style>
</head><body><h1>Web App Demo</h1><p>Service is running.</p></body></html>`;

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/health' || url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', uptime: Math.round(process.uptime()) }));
  }
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(PAGE);
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not Found');
});

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

server.on('upgrade', (req, socket, head) => {
  if (req.url.split('?')[0] !== WSPATH) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => handle(ws));
});

function parseHeader(buf) {
  if (buf.length < 24) throw new Error('short header');
  const ver = buf[0];
  if (!buf.subarray(1, 17).equals(ID)) throw new Error('bad id');
  let p = 17;
  const optLen = buf[p++];
  p += optLen;
  const cmd = buf[p++];
  const port = buf.readUInt16BE(p); p += 2;
  const atyp = buf[p++];
  let host;
  if (atyp === 1) { host = Array.from(buf.subarray(p, p + 4)).join('.'); p += 4; }
  else if (atyp === 2) { const l = buf[p++]; host = buf.subarray(p, p + l).toString(); p += l; }
  else if (atyp === 3) {
    const parts = [];
    for (let i = 0; i < 8; i++) parts.push(buf.readUInt16BE(p + i * 2).toString(16));
    host = parts.join(':'); p += 16;
  } else throw new Error('bad atyp');
  if (p > buf.length) throw new Error('short header');
  return { ver, cmd, host, port, rest: buf.subarray(p) };
}

function handle(ws) {
  let started = false;
  let remote = null;
  const close = () => { try { ws.close(); } catch (_) {} if (remote) { try { remote.destroy ? remote.destroy() : remote.close(); } catch (_) {} } };
  ws.on('error', close);
  ws.on('close', close);

  ws.once('message', (msg) => {
    let h;
    try { h = parseHeader(Buffer.from(msg)); } catch (e) { return ws.terminate(); }
    started = true;
    ws.send(Buffer.from([h.ver, 0]));

    if (h.cmd === 1) {
      const sock = net.connect({ host: h.host, port: h.port });
      remote = sock;
      sock.setNoDelay(true);
      if (h.rest.length) sock.write(h.rest);
      ws.on('message', (d) => { if (!sock.write(Buffer.from(d))) ws._socket && ws._socket.pause(); });
      sock.on('drain', () => ws._socket && ws._socket.resume());
      sock.on('data', (d) => {
        ws.send(d);
        if (ws.bufferedAmount > 4 * 1024 * 1024) { sock.pause(); waitDrain(ws, () => sock.resume()); }
      });
      sock.on('error', close);
      sock.on('close', close);
    } else if (h.cmd === 2) {
      // UDP over the stream: [len16][payload] frames. Restricted to DNS.
      if (h.port !== 53) return ws.terminate();
      const sock = dgram.createSocket(net.isIPv6(h.host) ? 'udp6' : 'udp4');
      remote = sock;
      let pending = Buffer.alloc(0);
      const feed = (d) => {
        pending = Buffer.concat([pending, d]);
        while (pending.length >= 2) {
          const l = pending.readUInt16BE(0);
          if (pending.length < 2 + l) break;
          sock.send(pending.subarray(2, 2 + l), h.port, h.host);
          pending = pending.subarray(2 + l);
        }
      };
      sock.on('message', (m) => { const len = Buffer.alloc(2); len.writeUInt16BE(m.length); ws.send(Buffer.concat([len, m])); });
      sock.on('error', close);
      if (h.rest.length) feed(h.rest);
      ws.on('message', (d) => feed(Buffer.from(d)));
    } else {
      ws.terminate();
    }
  });
}

function waitDrain(ws, cb) {
  const t = setInterval(() => {
    if (ws.readyState !== 1) { clearInterval(t); return; }
    if (ws.bufferedAmount < 1024 * 1024) { clearInterval(t); cb(); }
  }, 20);
}

server.listen(PORT, '0.0.0.0', () => console.log(`[app] listening on :${PORT}`));
probe.start();
