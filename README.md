# smtp-test

A zero-dependency Node.js script that tests SMTP connectivity by sending real emails across all common port and TLS combinations.

Given a host, it runs every sensible combination of port, encryption, and authentication — and tells you which ones work.

## Combinations tested

| Port | Transport | Notes |
|------|-----------|-------|
| 25   | Plain     | No encryption |
| 25   | STARTTLS  | Upgrade to TLS after connect |
| 587  | STARTTLS  | Standard submission port |
| 465  | Implicit TLS | TLS from first byte |

If credentials are provided, each combination is tested twice: once anonymous and once authenticated, giving up to 8 tests per run.

## Requirements

Node.js 18+ (uses only built-in modules: `net`, `tls`, `crypto`, `readline`).

No `npm install` needed.

## Usage

```
node smtp-test.js <host> <from> <to> [options]
```

### Options

| Flag | Description |
|------|-------------|
| `--user <user>` | AUTH LOGIN username |
| `--pass <pass>` | AUTH LOGIN password (prompted interactively if `--user` is set without this) |
| `--helo <name>` | EHLO hostname (default: domain from `<from>` address) |
| `--timeout <ms>` | Per-attempt socket timeout (default: 10000) |
| `--verbose` | Print the full SMTP conversation for each attempt |

### Examples

```sh
# Anonymous only — 4 combinations
node smtp-test.js smtp.example.com sender@example.org recipient@example.org

# With auth — 8 combinations (anonymous + authenticated for each)
node smtp-test.js smtp.example.com sender@example.org recipient@example.org --user me@example.org

# Password on the command line (e.g. in CI)
node smtp-test.js smtp.example.com sender@example.org recipient@example.org --user me@example.org --pass secret

# Debug a specific failure
node smtp-test.js smtp.example.com sender@example.org recipient@example.org --verbose
```

## Docker

If you don't have Node.js installed locally:

```sh
./docker-smtp-test.sh smtp.example.com sender@example.org recipient@example.org
```

This runs the script in a disposable `node:22-alpine` container. The wrapper mounts `smtp-test.js` read-only and forwards all arguments.

## Output

Progress and results go to stderr. A successful run looks like:

```
SMTP test: smtp.example.com | sender@example.org -> recipient@example.org
Running 8 combinations...

  25/plain                 FAIL  connect ECONNREFUSED
  25/plain+auth            FAIL  connect ECONNREFUSED
  25/STARTTLS              FAIL  connect ECONNREFUSED
  25/STARTTLS+auth         FAIL  connect ECONNREFUSED
  587/STARTTLS             OK
  587/STARTTLS+auth        OK
  465/implicit-TLS         OK
  465/implicit-TLS+auth    OK

--- Summary ---
  4 passed, 4 failed
```

Each successful attempt delivers an email whose subject identifies the combination that sent it (e.g. `SMTP Test [587/STARTTLS+auth] a1b2c3d4`), so you can confirm which paths actually reached the inbox.

## Notes

- TLS certificate validation is enforced. Self-signed certificates will cause failures.
- Authentication uses AUTH LOGIN. PLAIN and CRAM-MD5 are not implemented.
- The password prompt hides input when running in a terminal.

## Licence

MIT
