'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');
const { fixture } = require('./helpers');
const { PROMO } = require('../lib/report');

const BIN = path.join(__dirname, '..', 'bin', 'rsc-check.js');
const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });

test('exit 0 and a clean summary for a clean project', () => {
  const r = run(fixture('clean'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /No affected versions found in 1 project/);
  assert.ok(r.stdout.trimEnd().endsWith(PROMO));
});

test('exit 1 with fix commands for an affected project', () => {
  const r = run(fixture('npm-v1'));
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /next@16\.3\.6 → 16\.4\.5/);
  assert.match(r.stdout, /Fix: npm install next@16\.4\.5/);
  assert.match(r.stdout, /1 project needs an update/);
  assert.match(r.stdout, /pulled in by rsc-lib/);
  assert.equal(r.stdout.split('\n').filter((l) => l.includes('iknowmymac.com')).length, 1);
  assert.doesNotMatch(r.stdout, /\x1b\[/);
});

test('--json has no promo line and parses', () => {
  const r = run(fixture('pnpm-v6'), '--json');
  assert.equal(r.status, 1, r.stderr);
  const data = JSON.parse(r.stdout);
  assert.equal(data.projectsAffected, 1);
  assert.equal(data.affected[0].packageManager, 'pnpm');
  assert.deepEqual(data.affected[0].fix.commands, ['pnpm add next@16.4.5']);
  assert.ok(!r.stdout.includes('iknowmymac.com'));
});

test('exit 2 on a missing path or a bad option', () => {
  assert.equal(run('/definitely/not/here').status, 2);
  assert.equal(run('--nope').status, 2);
  assert.equal(run('--depth', 'x').status, 2);
});

test('--help and --version', () => {
  assert.equal(run('--help').status, 0);
  assert.match(run('--version').stdout, /^\d+\.\d+\.\d+\n$/);
});

test('output text follows the copy rules', () => {
  const r = run(fixture());
  for (const bad of ['—', '!', ' safe', 'secure', 'protect']) {
    assert.ok(!r.stdout.toLowerCase().includes(bad), `output contains "${bad}"`);
  }
});

test('medium advisories are listed after critical and high, one line per severity', () => {
  const r = run(fixture('npm-v1'));
  const lines = r.stdout.split('\n');
  const i = lines.findIndex((l) => l.includes('next@16.3.6 → 16.4.5'));
  const block = [];
  for (let j = i + 1; /^ {4}/.test(lines[j]); j++) block.push(lines[j]);
  const sevs = block.filter((l) => /^ {4}\S/.test(l)).map((l) => l.trim().split(' ')[0]);
  assert.deepEqual(sevs, ['critical', 'high', 'medium']);
  assert.equal(block[0], '    critical GHSA-673q-mjm6-r5xr, GHSA-2464-fhr4-w9xw');
  assert.equal(block[1], '    high GHSA-p3m5-59mp-jv5r');
  assert.equal(block.join(' ').match(/GHSA-/g).length, 9);
  assert.ok(block.every((l) => l.length <= 80), block.join('\n'));
});

test('the advisory list names CVE numbers, and --json carries them', () => {
  const r = run(fixture('pnpm-v6'));
  assert.match(r.stdout, /GHSA-f3mh-rxg3-f5g2 \(CVE-2026-119346\)/);
  const data = JSON.parse(run(fixture('pnpm-v6'), '--json').stdout);
  const xqc2 = data.advisoryData.advisories.find((a) => a.id === 'GHSA-xqc2-xf4c-x3h3');
  assert.equal(xqc2.cve, 'CVE-2026-126187');
  assert.equal(data.advisoryData.advisories.find((a) => a.id === 'GHSA-673q-mjm6-r5xr').cve, null);
});
