'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scan } = require('../lib/scan');
const { fixFor } = require('../lib/report');
const { FIXTURES, fixture, findingsOf } = require('./helpers');

const result = scan(FIXTURES, { home: '/nonexistent-home' });
const byName = Object.fromEntries(result.projects.map((p) => [path.relative(FIXTURES, p.path), p]));

test('finds every fixture project and nothing inside node_modules or hidden folders', () => {
  const names = Object.keys(byName).sort();
  assert.ok(names.every((n) => !n.split(path.sep).includes('node_modules')), names.join(', '));
  assert.ok(names.every((n) => !n.split(path.sep).some((s) => s.startsWith('.'))), names.join(', '));
  for (const n of ['npm-v1', 'npm-v3', 'npm-v2-shrinkwrap', 'pnpm-v5', 'pnpm-v6', 'pnpm-v9', 'pnpm-v9/apps/web',
    'yarn-classic', 'yarn-berry', 'bun-lock', 'bun-lockb', 'installed-stale', 'clean', 'fixed-15', 'edges', 'nm-skip']) {
    assert.ok(byName[n], `missing ${n}`);
  }
});

test('clean and fixed projects have no findings', () => {
  assert.equal(byName.clean.findings.length, 0);
  assert.equal(byName['fixed-15'].findings.length, 0);
  assert.equal(byName['npm-v2-shrinkwrap'].findings.length, 1);
  assert.equal(byName['nm-skip'].findings.length, 0);
});

test('npm v1: direct next and indirect react-server-dom-webpack', () => {
  const f = findingsOf(byName['npm-v1']);
  assert.equal(f['next@16.3.6'].dependency, 'direct');
  assert.equal(f['next@16.3.6'].fixedVersion, '16.4.5');
  assert.equal(f['react-server-dom-webpack@19.2.0'].dependency, 'indirect');
  assert.deepEqual(f['react-server-dom-webpack@19.2.0'].via, ['rsc-lib']);
  assert.equal(f['react-server-dom-webpack@19.2.0'].fixedVersion, '19.2.9');
  assert.deepEqual(fixFor(byName['npm-v1']).commands, ['npm install next@16.4.5']);
});

test('npm v3: dev dependency gets -D, nested fixed copy is not reported', () => {
  const p = byName['npm-v3'];
  const f = findingsOf(p);
  assert.deepEqual(Object.keys(f).sort(), ['next@15.3.0', 'react-server-dom-parcel@19.0.8']);
  assert.equal(f['next@15.3.0'].fixedVersion, '15.5.29');
  assert.deepEqual(fixFor(p).commands, ['npm install -D next@15.5.29']);
});

test('version edges: 19.0.8 and 19.3.0 affected, 19.0.9 and 19.3.1 not', () => {
  const f = findingsOf(byName.edges);
  assert.deepEqual(Object.keys(f).sort(), ['react-server-dom-turbopack@19.3.0', 'react-server-dom-webpack@19.0.8']);
  assert.equal(f['react-server-dom-turbopack@19.3.0'].fixedVersion, '19.3.1');
  assert.equal(f['react-server-dom-webpack@19.0.8'].fixedVersion, '19.0.9');
  assert.deepEqual(f['react-server-dom-webpack@19.0.8'].via, ['a']);
});

test('pnpm projects use pnpm commands', () => {
  assert.deepEqual(fixFor(byName['pnpm-v6']).commands, ['pnpm add next@16.4.5']);
  assert.deepEqual(Object.keys(findingsOf(byName['pnpm-v6'])).sort(), ['next@16.3.6', 'react-server-dom-webpack@19.3.0']);
  assert.deepEqual(fixFor(byName['pnpm-v5']).commands, ['pnpm add next@15.5.29']);
  assert.match(fixFor(byName['pnpm-v5']).notes.join(' '), /No fix was published for next 13\.x/);
  assert.deepEqual(fixFor(byName['pnpm-v6']).notes.filter((n) => n.includes('major')), []);
});

test('pnpm v9 workspace: root marks next as a workspace dependency', () => {
  const f = findingsOf(byName['pnpm-v9']);
  assert.equal(f['next@16.0.0'].dependency, 'workspace');
  assert.equal(f['react-server-dom-turbopack@19.1.9'].dependency, 'indirect');
  assert.deepEqual(f['react-server-dom-turbopack@19.1.9'].via, ['next']);
});

test('yarn classic and berry', () => {
  const classic = findingsOf(byName['yarn-classic']);
  assert.equal(classic['next@16.2.0'].dependency, 'direct');
  assert.deepEqual(classic['react-server-dom-turbopack@19.1.9'].via, ['rsc-framework']);
  assert.deepEqual(fixFor(byName['yarn-classic']).commands, ['yarn add next@16.4.5']);
  const berry = findingsOf(byName['yarn-berry']);
  assert.equal(berry['next@15.5.27'].dependency, 'workspace');
  assert.equal(berry['next@15.5.27'].fixedVersion, '15.5.29');
  assert.equal(byName['yarn-berry'].packageManager, 'yarn');
});

test('bun.lock is read, bun.lockb is skipped but the installed copy is checked', () => {
  assert.deepEqual(fixFor(byName['bun-lock']).commands, ['bun add next@16.4.5']);
  assert.ok(findingsOf(byName['bun-lock'])['react-server-dom-webpack@19.3.0']);
  assert.ok(result.bunLockb.includes(fixture('bun-lockb')));
  const f = findingsOf(byName['bun-lockb']);
  assert.deepEqual(f['next@16.3.6'].sources, ['installed']);
  assert.equal(byName['bun-lockb'].packageManager, 'bun');
});

test('installed copy older than the lockfile asks for a reinstall', () => {
  const p = byName['installed-stale'];
  const f = findingsOf(p);
  assert.deepEqual(Object.keys(f), ['next@16.3.6']);
  assert.deepEqual(f['next@16.3.6'].sources, ['installed']);
  assert.equal(f['next@16.3.6'].lockfileHasFix, '16.4.5');
  assert.deepEqual(fixFor(p).commands, ['npm install']);
});

test('workspace member without its own lockfile uses the package manager above it', () => {
  // pnpm-v9/apps/web has no node_modules and no lockfile, so it has no findings.
  assert.equal(byName['pnpm-v9/apps/web'].findings.length, 0);
});

test('symlink loops are not followed', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rsc-check-'));
  try {
    const app = path.join(tmp, 'app');
    fs.mkdirSync(path.join(app, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(app, 'package.json'), '{"dependencies":{"next":"16.3.6"}}');
    fs.writeFileSync(path.join(app, 'package-lock.json'),
      '{"lockfileVersion":3,"packages":{"node_modules/next":{"version":"16.3.6"}}}');
    fs.symlinkSync(tmp, path.join(app, 'sub', 'loop'));
    fs.symlinkSync(app, path.join(tmp, 'app-link'));
    const r = scan(tmp, { home: '/nonexistent-home' });
    assert.equal(r.projects.length, 1);
    assert.equal(r.affected.length, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('depth limit stops the walk', () => {
  const r = scan(FIXTURES, { maxDepth: 0, home: '/nonexistent-home' });
  assert.equal(r.projects.length, 0);
  const r1 = scan(FIXTURES, { maxDepth: 1, home: '/nonexistent-home' });
  assert.ok(!r1.projects.some((p) => p.path.endsWith(path.join('apps', 'web'))));
});

test('Library is skipped directly under home', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rsc-check-home-'));
  try {
    const lib = path.join(tmp, 'Library', 'proj');
    fs.mkdirSync(lib, { recursive: true });
    fs.writeFileSync(path.join(lib, 'package-lock.json'),
      '{"lockfileVersion":3,"packages":{"node_modules/next":{"version":"16.3.6"}}}');
    const real = fs.realpathSync(tmp);
    assert.equal(scan(tmp, { home: real }).projects.length, 0);
    assert.equal(scan(tmp, { home: '/nonexistent-home' }).projects.length, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a missing root throws', () => {
  assert.throws(() => scan('/definitely/not/here'), /no such folder/);
});

test('fixtures folders below the root are skipped', () => {
  const r = scan(require('path').join(__dirname), { home: '/nonexistent-home' });
  assert.equal(r.projects.length, 0);
});
