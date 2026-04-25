#!/usr/bin/env node
'use strict';

const net = require('net');
const tls = require('tls');
const readline = require('readline');
const { randomUUID } = require('crypto');

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------
function usage() {
  console.error(`
Usage: node smtp-test.js <host> <from> <to> [options]

Runs all sensible port/TLS/auth combinations against <host> and reports
which ones successfully deliver mail.

Combinations tested:
  Port 25   - plain (no TLS)
  Port 25   - STARTTLS
  Port 587  - STARTTLS
  Port 465  - implicit TLS

If --user is provided, each combination is tested twice: anonymous and
authenticated. If --user is given without --pass, the password is prompted.

Options:
  --user <user>       AUTH LOGIN username
  --pass <pass>       AUTH LOGIN password (prompted if --user set without this)
  --helo <name>       EHLO hostname (default: domain from <from> address)
  --timeout <ms>      Per-attempt socket timeout in ms (default: 10000)
  --verbose           Print full SMTP conversation for each attempt

Examples:
  node smtp-test.js smtp.example.com sender@example.org recipient@example.org
  node smtp-test.js smtp.example.com sender@example.org recipient@example.org --user sender@example.org
  node smtp-test.js smtp.example.com sender@example.org recipient@example.org --user me --pass secret --verbose
`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
if (args.length < 3 || args[0].startsWith('--')) usage();

const host = args[0];
const from = args[1];
const to   = args[2];
const opts = {
  user: null,
  pass: null,
  helo: null,
  timeout: 10000,
  verbose: false,
};

for (let i = 3; i < args.length; i++) {
  switch (args[i]) {
    case '--user':    opts.user = args[++i]; break;
    case '--pass':    opts.pass = args[++i]; break;
    case '--helo':    opts.helo = args[++i]; break;
    case '--timeout': opts.timeout = parseInt(args[++i], 10); break;
    case '--verbose': opts.verbose = true; break;
    default:
      console.error(`Unknown option: ${args[i]}`);
      usage();
  }
}

if (!opts.helo) {
  const atIdx = from.indexOf('@');
  if (atIdx === -1) {
    console.error('Error: <from> must be a valid email address (used to derive EHLO domain).');
    process.exit(1);
  }
  opts.helo = from.slice(atIdx + 1);
}

// ---------------------------------------------------------------------------
// Password prompt (hidden input when TTY)
// ---------------------------------------------------------------------------
async function promptPassword() {
  return new Promise(resolve => {
    process.stderr.write('Password: ');
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    let pw = '';
    const onData = chunk => {
      for (const ch of chunk.toString()) {
        if (ch === '\n' || ch === '\r') {
          if (process.stdin.isTTY) process.stdin.setRawMode(false);
          process.stderr.write('\n');
          process.stdin.removeListener('data', onData);
          resolve(pw);
          return;
        } else if (ch === '\x7f' || ch === '\b') {
          pw = pw.slice(0, -1);
        } else if (ch === '\x03') {
          // Ctrl-C
          if (process.stdin.isTTY) process.stdin.setRawMode(false);
          process.stderr.write('\n');
          process.exit(1);
        } else {
          pw += ch;
        }
      }
    };
    process.stdin.on('data', onData);
  });
}

// ---------------------------------------------------------------------------
// Test matrix
// ---------------------------------------------------------------------------
const COMBOS = [
  { port: 25,  tls: 'none',     label: '25/plain' },
  { port: 25,  tls: 'starttls', label: '25/STARTTLS' },
  { port: 587, tls: 'starttls', label: '587/STARTTLS' },
  { port: 465, tls: 'implicit', label: '465/implicit-TLS' },
];

// ---------------------------------------------------------------------------
// Message generation
// ---------------------------------------------------------------------------
function buildMessage(combo, auth) {
  const id = randomUUID().slice(0, 8);
  const ts = new Date().toISOString();
  const subject = `SMTP Test [${combo.label}${auth ? '+auth' : ''}] ${id}`;
  const boundary = `----=_Part_${randomUUID().replace(/-/g, '')}`;

  const body = [
    `From: SMTP Test <${from}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${opts.helo}>`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    `X-Mailer: smtp-test/1.0`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    `SMTP connectivity test`,
    ``,
    `  ID:     ${id}`,
    `  Time:   ${ts}`,
    `  Host:   ${host}:${combo.port}`,
    `  TLS:    ${combo.tls}`,
    `  Auth:   ${auth ? opts.user : 'anonymous'}`,
    `  From:   ${from}`,
    `  To:     ${to}`,
    ``,
    `If you received this, the mail path is working.`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">`,
    `<h2 style="color:#1a1a1a;border-bottom:2px solid #c8a951;padding-bottom:8px">SMTP Test</h2>`,
    `<table style="width:100%;border-collapse:collapse;font-size:14px">`,
    `<tr><td style="padding:4px 8px;color:#666">ID</td><td style="padding:4px 8px"><code>${id}</code></td></tr>`,
    `<tr><td style="padding:4px 8px;color:#666">Time</td><td style="padding:4px 8px">${ts}</td></tr>`,
    `<tr><td style="padding:4px 8px;color:#666">Host</td><td style="padding:4px 8px">${host}:${combo.port}</td></tr>`,
    `<tr><td style="padding:4px 8px;color:#666">TLS</td><td style="padding:4px 8px">${combo.tls}</td></tr>`,
    `<tr><td style="padding:4px 8px;color:#666">Auth</td><td style="padding:4px 8px">${auth ? opts.user : 'anonymous'}</td></tr>`,
    `<tr><td style="padding:4px 8px;color:#666">From</td><td style="padding:4px 8px">${from}</td></tr>`,
    `<tr><td style="padding:4px 8px;color:#666">To</td><td style="padding:4px 8px">${to}</td></tr>`,
    `</table>`,
    `<p style="color:#888;font-size:12px;margin-top:16px">If you received this, the mail path is working.</p>`,
    `</div>`,
    ``,
    `--${boundary}--`,
  ].join('\r\n');

  return { subject, body };
}

// ---------------------------------------------------------------------------
// Single SMTP attempt
// ---------------------------------------------------------------------------
async function attempt(combo, auth) {
  const { subject, body } = buildMessage(combo, auth);
  const tag = `${combo.label}${auth ? '+auth' : ''}`;
  const log = opts.verbose
    ? (dir, line) => console.error(`    ${dir} ${line.trimEnd()}`)
    : () => {};

  let socket;
  let buffer = '';

  function send(line) {
    log('C:', line);
    socket.write(line + '\r\n');
  }

  function waitFor(code) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${code}`)), opts.timeout);

      function onData(chunk) {
        buffer += chunk.toString();
        const lines = buffer.split('\r\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line) continue;
          log('S:', line);
          const rc = parseInt(line.slice(0, 3), 10);
          const cont = line[3] === '-';
          if (!cont) {
            clearTimeout(timer);
            socket.removeListener('data', onData);
            if (String(rc).startsWith(String(code).charAt(0))) {
              resolve({ code: rc, text: line });
            } else {
              reject(new Error(`${line}`));
            }
            return;
          }
        }
      }

      socket.on('data', onData);
    });
  }

  function upgradeToTLS() {
    return new Promise((resolve, reject) => {
      const tlsSock = tls.connect(
        { socket, servername: host, rejectUnauthorized: true },
        () => {
          log('--', `TLS: ${tlsSock.getProtocol()} ${tlsSock.getCipher()?.name || ''}`);
          socket = tlsSock;
          resolve();
        }
      );
      tlsSock.on('error', reject);
    });
  }

  // connect
  if (combo.tls === 'implicit') {
    socket = tls.connect(
      { host, port: combo.port, rejectUnauthorized: true },
      () => log('--', `TLS: ${socket.getProtocol()} ${socket.getCipher()?.name || ''}`)
    );
  } else {
    socket = net.connect({ host, port: combo.port });
  }

  socket.setTimeout(opts.timeout);
  socket.on('timeout', () => { socket.destroy(new Error('Socket timeout')); });

  await new Promise((resolve, reject) => {
    socket.once(combo.tls === 'implicit' ? 'secureConnect' : 'connect', resolve);
    socket.once('error', reject);
  });

  try {
    await waitFor(220);

    send(`EHLO ${opts.helo}`);
    await waitFor(250);

    if (combo.tls === 'starttls') {
      send('STARTTLS');
      await waitFor(220);
      await upgradeToTLS();
      send(`EHLO ${opts.helo}`);
      await waitFor(250);
    }

    if (auth) {
      send('AUTH LOGIN');
      await waitFor(334);
      send(Buffer.from(opts.user).toString('base64'));
      await waitFor(334);
      send(Buffer.from(opts.pass).toString('base64'));
      await waitFor(235);
    }

    send(`MAIL FROM:<${from}>`);
    await waitFor(250);

    send(`RCPT TO:<${to}>`);
    await waitFor(250);

    send('DATA');
    await waitFor(354);

    const stuffed = body.replace(/\r\n\./g, '\r\n..');
    socket.write(stuffed + '\r\n.\r\n');
    log('C:', '[message body]');
    log('C:', '.');
    await waitFor(250);

    send('QUIT');
    try { await waitFor(221); } catch { /* some servers just close */ }

    return { tag, status: 'OK', subject };
  } finally {
    socket.destroy();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function run() {
  if (opts.user && !opts.pass) {
    opts.pass = await promptPassword();
    if (!opts.pass) {
      console.error('No password provided, aborting.');
      process.exit(1);
    }
  }

  const hasAuth = !!(opts.user && opts.pass);

  const plan = [];
  for (const combo of COMBOS) {
    plan.push({ combo, auth: false });
    if (hasAuth) plan.push({ combo, auth: true });
  }

  console.error(`\nSMTP test: ${host} | ${from} -> ${to}`);
  console.error(`Running ${plan.length} combination${plan.length === 1 ? '' : 's'}...\n`);

  const results = [];
  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));

  for (const { combo, auth } of plan) {
    const tag = `${combo.label}${auth ? '+auth' : ''}`;
    process.stderr.write(`  ${pad(tag, 24)} `);
    try {
      const r = await attempt(combo, auth);
      results.push(r);
      console.error('\x1b[32mOK\x1b[0m');
    } catch (err) {
      results.push({ tag, status: 'FAIL', error: err.message });
      console.error(`\x1b[31mFAIL\x1b[0m  ${err.message}`);
    }
  }

  // Summary
  console.error('\n--- Summary ---');
  const ok = results.filter(r => r.status === 'OK');
  const fail = results.filter(r => r.status !== 'OK');
  console.error(`  ${ok.length} passed, ${fail.length} failed\n`);
}

run().catch(err => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
