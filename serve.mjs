#!/usr/bin/env node
/**
 * Zero-dependency local server for Anaglyph Studio.
 *
 *   node serve.mjs            → picks a free port, opens your browser
 *   node serve.mjs 3000       → use port 3000
 *   node serve.mjs --no-open  → do not launch a browser
 *
 * Nothing to install. Works on Windows, macOS and Linux.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP = '/anaglyph-studio/';

const args = process.argv.slice(2);
const noOpen = args.includes('--no-open');
const wanted = Number(args.find(a => /^\d+$/.test(a))) || 8000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }

  let file = path.join(ROOT, urlPath);
  // Never serve outside the project directory.
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    file = path.join(file, 'index.html');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>404</h1><p>Not found: ' + urlPath +
        '</p><p><a href="' + APP + '">Go to Anaglyph Studio</a></p>');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  try {
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref();
  } catch { /* headless box, or no browser — the printed URL still works */ }
}

/** Try the requested port, then walk upward if something already has it.
 *  Both handlers are one-shot and each cancels the other, otherwise a retry
 *  leaves the previous attempt's listener attached and the success banner
 *  prints once per port tried. */
function listen(port, attemptsLeft) {
  const onError = (err) => {
    server.removeListener('listening', onListening);
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log('  port ' + port + ' is busy, trying ' + (port + 1) + '…');
      listen(port + 1, attemptsLeft - 1);
    } else {
      console.error('\n  Could not start the server: ' + err.message + '\n');
      process.exit(1);
    }
  };
  const onListening = () => {
    server.removeListener('error', onError);
    const url = 'http://localhost:' + port + APP;
    console.log('\n  Anaglyph Studio is running.\n');
    console.log('    ' + url);
    // On a remote/VM/WSL box localhost may not be the right host.
    const nets = Object.values(os.networkInterfaces()).flat()
      .filter(n => n && n.family === 'IPv4' && !n.internal);
    for (const n of nets) console.log('    http://' + n.address + ':' + port + APP + '   (from another device)');
    console.log('\n  Press Ctrl+C to stop.\n');
    if (!noOpen) openBrowser(url);
  };
  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port);
}

listen(wanted, 20);
