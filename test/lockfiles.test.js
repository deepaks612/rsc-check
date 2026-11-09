'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { parseNpm, parsePnpm, parseYarn, parseBun, stripJsonc } = require('../lib/lockfiles');
const { PACKAGES } = require('../lib/advisories');
const { fixture } = require('./helpers');

const WATCHED = new Set(PACKAGES);
const read = (...p) => fs.readFileSync(fixture(...p), 'utf8');
const versions = (r) => Object.fromEntries([...r.versions].map(([k, v]) => [k, [...v].sort()]));
const parents = (r, key) => [...(r.parents.get(key) || [])].sort();

test('package-lock.json v1', () => {
  const r = parseNpm(read('npm-v1', 'package-lock.json'), WATCHED);
  assert.deepEqual(versions(r), { next: ['16.3.6'], 'react-server-dom-webpack': ['19.2.0'] });
  assert.deepEqual(parents(r, 'react-server-dom-webpack@19.2.0'), ['rsc-lib']);
});

test('package-lock.json v3 with nested copies', () => {
  const r = parseNpm(read('npm-v3', 'package-lock.json'), WATCHED);
  assert.deepEqual(versions(r), {
    next: ['15.3.0'],
    'react-server-dom-parcel': ['19.0.8'],
    'react-server-dom-webpack': ['19.0.9'],
  });
  assert.deepEqual(parents(r, 'react-server-dom-parcel@19.0.8'), ['parcel-rsc']);
  assert.deepEqual(parents(r, 'react-server-dom-webpack@19.0.9'), ['other']);
});

test('npm-shrinkwrap.json v2', () => {
  const r = parseNpm(read('npm-v2-shrinkwrap', 'npm-shrinkwrap.json'), WATCHED);
  assert.deepEqual(versions(r), { next: ['16.4.0'] });
});

test('npm v2/v3 workspace entries count as workspace deps, and npm aliases use the real name', () => {
  const text = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': { name: 'root', workspaces: ['apps/*'] },
      'apps/web': { name: 'web', dependencies: { next: '16.2.0' } },
      'node_modules/web': { resolved: 'apps/web', link: true },
      'node_modules/next': { version: '16.2.0' },
      'node_modules/old-next': { name: 'next', version: '14.0.0' },
    },
  });
  const r = parseNpm(text, WATCHED);
  assert.deepEqual(versions(r), { next: ['14.0.0', '16.2.0'] });
  assert.deepEqual([...r.workspaceDeps], ['next']);
});

test('pnpm-lock.yaml v5', () => {
  const r = parsePnpm(read('pnpm-v5', 'pnpm-lock.yaml'), WATCHED);
  assert.deepEqual(versions(r), { next: ['13.4.0'] });
});

test('pnpm-lock.yaml v6', () => {
  const r = parsePnpm(read('pnpm-v6', 'pnpm-lock.yaml'), WATCHED);
  assert.deepEqual(versions(r), { next: ['16.3.6'], 'react-server-dom-webpack': ['19.3.0'] });
  assert.deepEqual(parents(r, 'react-server-dom-webpack@19.3.0'), ['rsc-kit']);
});

test('pnpm-lock.yaml v9 with importers, snapshots and peer ranges ignored', () => {
  const r = parsePnpm(read('pnpm-v9', 'pnpm-lock.yaml'), WATCHED);
  assert.deepEqual(versions(r), { next: ['16.0.0'], 'react-server-dom-turbopack': ['19.1.9'] });
  assert.deepEqual(parents(r, 'react-server-dom-turbopack@19.1.9'), ['next']);
  assert.deepEqual(parents(r, 'next@16.0.0'), []);
  assert.deepEqual([...r.workspaceDeps], ['next']);
});

test('yarn.lock classic', () => {
  const r = parseYarn(read('yarn-classic', 'yarn.lock'), WATCHED);
  assert.deepEqual(versions(r), { next: ['16.2.0'], 'react-server-dom-turbopack': ['19.1.9'] });
  assert.deepEqual(parents(r, 'react-server-dom-turbopack@19.1.9'), ['rsc-framework']);
});

test('yarn.lock berry with workspaces', () => {
  const r = parseYarn(read('yarn-berry', 'yarn.lock'), WATCHED);
  assert.deepEqual(versions(r), { next: ['15.5.27'] });
  assert.deepEqual([...r.workspaceDeps], ['next']);
  assert.deepEqual(parents(r, 'next@15.5.27'), []);
});

test('bun.lock (JSONC)', () => {
  const r = parseBun(read('bun-lock', 'bun.lock'), WATCHED);
  assert.deepEqual(versions(r), { next: ['16.4.0'], 'react-server-dom-webpack': ['19.3.0'] });
  assert.deepEqual(parents(r, 'react-server-dom-webpack@19.3.0'), ['waku-like']);
});

test('stripJsonc keeps strings intact', () => {
  const out = stripJsonc('{"a": "x // not a comment, }", /* c */ "b": [1, 2,], // end\n}');
  assert.deepEqual(JSON.parse(out), { a: 'x // not a comment, }', b: [1, 2] });
});

test('npm v1: nested copies resolve to the right parent', () => {
  const text = JSON.stringify({
    lockfileVersion: 1,
    dependencies: {
      'react-server-dom-webpack': { version: '19.2.9' },
      a: { version: '1.0.0', requires: { 'react-server-dom-webpack': '19.2.0' }, dependencies: { 'react-server-dom-webpack': { version: '19.2.0' } } },
      b: { version: '1.0.0', requires: { 'react-server-dom-webpack': '^19.2.9' } },
    },
  });
  const r = parseNpm(text, WATCHED);
  assert.deepEqual(parents(r, 'react-server-dom-webpack@19.2.0'), ['a']);
  assert.deepEqual(parents(r, 'react-server-dom-webpack@19.2.9'), ['b']);
});

test('bun.lock: nested copies resolve to the right parent', () => {
  const text = `{
    "lockfileVersion": 1,
    "packages": {
      "react-server-dom-webpack": ["react-server-dom-webpack@19.2.9", "", {}, "sha512-a"],
      "@x/a": ["@x/a@1.0.0", "", { "dependencies": { "react-server-dom-webpack": "19.2.0" } }, "sha512-b"],
      "@x/a/react-server-dom-webpack": ["react-server-dom-webpack@19.2.0", "", {}, "sha512-c"],
      "b": ["b@1.0.0", "", { "dependencies": { "react-server-dom-webpack": "^19.2.9" } }, "sha512-d"],
    },
  }`;
  const r = parseBun(text, WATCHED);
  assert.deepEqual(versions(r), { 'react-server-dom-webpack': ['19.2.0', '19.2.9'] });
  assert.deepEqual(parents(r, 'react-server-dom-webpack@19.2.0'), ['@x/a']);
  assert.deepEqual(parents(r, 'react-server-dom-webpack@19.2.9'), ['b']);
});
