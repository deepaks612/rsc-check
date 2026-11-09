'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { check } = require('../lib/advisories');
const semver = require('../lib/semver');

const RSC = ['react-server-dom-webpack', 'react-server-dom-parcel', 'react-server-dom-turbopack'];

test('semver ordering, prereleases sort before the release', () => {
  assert.equal(semver.compare('19.0.8', '19.0.9'), -1);
  assert.equal(semver.compare('19.1.10', '19.1.9'), 1);
  assert.equal(semver.compare('16.4.1-canary.0', '16.4.1'), -1);
  assert.equal(semver.compare('1.0.0-alpha', '1.0.0-alpha.1'), -1);
  assert.equal(semver.compare('1.0.0-alpha.beta', '1.0.0-beta'), -1);
  assert.equal(semver.compare('1.0.0-2', '1.0.0-11'), -1);
  assert.equal(semver.compare('1.0.0+build', '1.0.0'), 0);
  assert.equal(semver.parse('not-a-version'), null);
});

for (const name of RSC) {
  test(`${name}: range edges`, () => {
    const expect = {
      '18.3.1': null,
      '19.0.0': '19.0.9',
      '19.0.8': '19.0.9',
      '19.0.9': null,
      '19.1.0': '19.1.10',
      '19.1.9': '19.1.10',
      '19.1.10': null,
      '19.2.0': '19.2.9',
      '19.2.8': '19.2.9',
      '19.2.9': null,
      '19.3.0': '19.3.1',
      '19.3.1': null,
      '19.4.0': null,
    };
    for (const [v, fixed] of Object.entries(expect)) {
      const hit = check(name, v);
      assert.equal(hit ? hit.fixedVersion : null, fixed, `${name}@${v}`);
      if (hit) assert.deepEqual(hit.advisories.map((a) => a.id), ['GHSA-xqc2-xf4c-x3h3']);
    }
  });
}

test('next: ranges and advisories per OSV', () => {
  const ids = (v) => (check('next', v) ? check('next', v).advisories.map((a) => a.id).sort() : []);
  assert.deepEqual(ids('9.5.5'), []);
  assert.deepEqual(ids('10.0.0'), ['GHSA-2464-fhr4-w9xw']);
  assert.deepEqual(ids('12.3.4'), ['GHSA-2464-fhr4-w9xw']);
  assert.deepEqual(ids('13.0.0'), ['GHSA-2464-fhr4-w9xw', 'GHSA-p3m5-59mp-jv5r']);
  assert.deepEqual(ids('15.5.27'), ['GHSA-2464-fhr4-w9xw', 'GHSA-p3m5-59mp-jv5r']);
  assert.deepEqual(ids('15.5.28'), []);
  assert.deepEqual(ids('15.6.0'), []);
  assert.deepEqual(ids('16.0.0'), ['GHSA-2464-fhr4-w9xw', 'GHSA-673q-mjm6-r5xr', 'GHSA-p3m5-59mp-jv5r']);
  assert.deepEqual(ids('16.3.6'), ['GHSA-2464-fhr4-w9xw', 'GHSA-673q-mjm6-r5xr', 'GHSA-p3m5-59mp-jv5r']);
  assert.deepEqual(ids('16.4.0'), ['GHSA-2464-fhr4-w9xw', 'GHSA-673q-mjm6-r5xr', 'GHSA-p3m5-59mp-jv5r']);
  assert.deepEqual(ids('16.4.1-canary.3'), ['GHSA-2464-fhr4-w9xw', 'GHSA-673q-mjm6-r5xr', 'GHSA-p3m5-59mp-jv5r']);
  assert.deepEqual(ids('16.4.1'), []);
  assert.deepEqual(ids('16.4.5'), []);
});

test('next: suggested fix stays in the same line where one exists', () => {
  assert.equal(check('next', '16.3.6').fixedVersion, '16.4.1');
  assert.equal(check('next', '16.0.0').fixedVersion, '16.4.1');
  assert.equal(check('next', '15.3.0').fixedVersion, '15.5.28');
  assert.equal(check('next', '14.2.3').fixedVersion, '15.5.28');
  assert.equal(check('next', '10.2.0').fixedVersion, '15.5.28');
});

test('unwatched packages and bad versions are ignored', () => {
  assert.equal(check('react', '19.2.0'), null);
  assert.equal(check('next', 'workspace:*'), null);
  assert.equal(check('next', ''), null);
});
