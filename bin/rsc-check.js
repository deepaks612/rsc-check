#!/usr/bin/env node
'use strict';

const os = require('os');
const { scan } = require('../lib/scan');
const { formatText, formatJson } = require('../lib/report');
const { version } = require('../package.json');

const HELP = `rsc-check ${version}

Finds JavaScript projects with React Server Components or Next.js versions
affected by GHSA-xqc2-xf4c-x3h3, GHSA-673q-mjm6-r5xr, GHSA-2464-fhr4-w9xw
and GHSA-p3m5-59mp-jv5r, and says what to upgrade to.

Usage:
  npx @deepaks612/rsc-check [path]   Scan path (default: your home folder)

Options:
  --json         Machine-readable output
  --depth <n>    How many folders deep to look (default: 8)
  --no-color     Plain text output
  -v, --version  Print the version
  -h, --help     Print this help

Exit codes: 0 nothing affected, 1 something affected, 2 error.
Runs offline. Reads files only. Changes nothing.
`;

function main(argv) {
  let root = null;
  let json = false;
  let color = process.stdout.isTTY && !process.env.NO_COLOR;
  let maxDepth = 8;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      process.stdout.write(HELP);
      return 0;
    } else if (a === '-v' || a === '--version') {
      process.stdout.write(`${version}\n`);
      return 0;
    } else if (a === '--json') {
      json = true;
    } else if (a === '--no-color') {
      color = false;
    } else if (a === '--depth' || a.startsWith('--depth=')) {
      const raw = a.includes('=') ? a.split('=')[1] : argv[++i];
      maxDepth = Number(raw);
      if (!Number.isInteger(maxDepth) || maxDepth < 0) {
        process.stderr.write(`rsc-check: --depth needs a whole number, got "${raw}"\n`);
        return 2;
      }
    } else if (a.startsWith('-')) {
      process.stderr.write(`rsc-check: unknown option ${a}\nRun rsc-check --help for usage.\n`);
      return 2;
    } else if (root === null) {
      root = a;
    } else {
      process.stderr.write('rsc-check: give one path at most\n');
      return 2;
    }
  }

  let result;
  try {
    result = scan(root || os.homedir(), { maxDepth });
  } catch (err) {
    process.stderr.write(`rsc-check: ${err.message}\n`);
    return 2;
  }
  process.stdout.write(json ? formatJson(result, { version }) : formatText(result, { version, color }));
  return result.affected.length ? 1 : 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  process.stderr.write(`rsc-check: ${err && err.stack ? err.stack : err}\n`);
  process.exitCode = 2;
}
