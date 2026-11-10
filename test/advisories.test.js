'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { check, ADVISORIES, SEVERITY_RANK } = require('../lib/advisories');
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

const OCT = ['GHSA-2464-fhr4-w9xw', 'GHSA-673q-mjm6-r5xr', 'GHSA-p3m5-59mp-jv5r'];
const NOV_ALL_16 = ['GHSA-7qx7-33qx-rqx2', 'GHSA-f3mh-rxg3-f5g2', 'GHSA-mfr8-8qww-v76h', 'GHSA-pc58-hwjq-p385',
  'GHSA-rhh4-g77r-r9qj', 'GHSA-vc7v-qv4w-wrv8', 'GHSA-vvgp-ww4w-46vf'];
const NOV_15 = ['GHSA-7qx7-33qx-rqx2', 'GHSA-f3mh-rxg3-f5g2', 'GHSA-pc58-hwjq-p385'];
const ids = (v) => (check('next', v) ? check('next', v).advisories.map((a) => a.id).sort() : []);
const sorted = (...lists) => lists.flat().sort();

test('next: October ranges per OSV still hold', () => {
  assert.deepEqual(ids('10.0.0'), ['GHSA-2464-fhr4-w9xw', 'GHSA-pc58-hwjq-p385']);
  assert.deepEqual(ids('12.3.4'), ['GHSA-2464-fhr4-w9xw', 'GHSA-pc58-hwjq-p385']);
  assert.deepEqual(ids('13.0.0'), ['GHSA-2464-fhr4-w9xw', 'GHSA-p3m5-59mp-jv5r', 'GHSA-pc58-hwjq-p385']);
  assert.deepEqual(ids('15.5.27'), sorted('GHSA-2464-fhr4-w9xw', 'GHSA-p3m5-59mp-jv5r', NOV_15));
  assert.deepEqual(ids('15.5.28'), NOV_15);
  assert.deepEqual(ids('16.0.0'), sorted(OCT, 'GHSA-7qx7-33qx-rqx2', 'GHSA-f3mh-rxg3-f5g2', 'GHSA-pc58-hwjq-p385', 'GHSA-rhh4-g77r-r9qj'));
  assert.deepEqual(ids('16.3.6'), sorted(OCT, NOV_ALL_16.filter((id) => id !== 'GHSA-vvgp-ww4w-46vf')));
  assert.deepEqual(ids('16.4.0'), sorted(OCT, NOV_ALL_16));
  assert.deepEqual(ids('16.4.1-canary.3'), sorted(OCT, NOV_ALL_16));
  assert.deepEqual(ids('16.4.1'), NOV_ALL_16);
});

test('next: clean versions', () => {
  assert.deepEqual(ids('15.5.29'), []);
  assert.deepEqual(ids('15.6.0'), []);
  assert.deepEqual(ids('16.4.5'), []);
  assert.deepEqual(ids('16.5.0'), []);
});

test('next: every November advisory hits 16.4.4 and clears at 16.4.5', () => {
  for (const id of NOV_ALL_16) {
    assert.ok(ids('16.4.4').includes(id), `${id} at 16.4.4`);
    assert.ok(!ids('16.4.5').includes(id), `${id} at 16.4.5`);
  }
  assert.deepEqual(ids('16.4.4'), NOV_ALL_16);
  assert.equal(check('next', '16.4.4').fixedVersion, '16.4.5');
});

test('next: the 15.x November advisories hit 15.5.28 and clear at 15.5.29', () => {
  assert.deepEqual(ids('15.5.28'), NOV_15);
  assert.deepEqual(ids('15.0.0').filter((id) => NOV_15.includes(id)), NOV_15);
  assert.equal(check('next', '15.5.28').fixedVersion, '15.5.29');
  assert.deepEqual(ids('15.5.29'), []);
  for (const id of ['GHSA-rhh4-g77r-r9qj', 'GHSA-vvgp-ww4w-46vf', 'GHSA-vc7v-qv4w-wrv8', 'GHSA-mfr8-8qww-v76h']) {
    assert.ok(!ids('15.5.28').includes(id), `${id} is 16.x only`);
  }
});

test('next: November advisories with a later lower bound', () => {
  const has = (v, id) => ids(v).includes(id);
  assert.ok(!has('16.3.9', 'GHSA-vvgp-ww4w-46vf'));
  assert.ok(has('16.4.0', 'GHSA-vvgp-ww4w-46vf'));
  assert.ok(!has('16.2.9', 'GHSA-mfr8-8qww-v76h'));
  assert.ok(has('16.3.0', 'GHSA-mfr8-8qww-v76h'));
  assert.ok(!has('16.1.9', 'GHSA-vc7v-qv4w-wrv8'));
  assert.ok(has('16.2.0', 'GHSA-vc7v-qv4w-wrv8'));
  assert.ok(!has('14.2.3', 'GHSA-f3mh-rxg3-f5g2'));
  assert.ok(!has('14.2.3', 'GHSA-7qx7-33qx-rqx2'));
  assert.ok(has('15.0.0', 'GHSA-f3mh-rxg3-f5g2'));
  assert.ok(has('15.0.0', 'GHSA-7qx7-33qx-rqx2'));
});

test('next: GHSA-pc58-hwjq-p385 has no lower bound on the 15.x line', () => {
  assert.deepEqual(ids('14.2.3'), ['GHSA-2464-fhr4-w9xw', 'GHSA-p3m5-59mp-jv5r', 'GHSA-pc58-hwjq-p385']);
  assert.deepEqual(ids('9.5.5'), ['GHSA-pc58-hwjq-p385']);
  assert.equal(check('next', '9.5.5').fixedVersion, '15.5.29');
});

test('next: November advisories are medium and link to the Next.js advisory', () => {
  for (const id of NOV_ALL_16) {
    const adv = ADVISORIES.find((a) => a.id === id);
    assert.ok(adv, id);
    assert.equal(adv.severity, 'medium');
    assert.equal(adv.url, `https://github.com/vercel/next.js/security/advisories/${id}`);
    assert.match(adv.title, /^Next\.js: /);
  }
  assert.ok(SEVERITY_RANK.medium < SEVERITY_RANK.high);
});

test('next: suggested fix stays in the same line where one exists', () => {
  assert.equal(check('next', '16.3.6').fixedVersion, '16.4.5');
  assert.equal(check('next', '16.0.0').fixedVersion, '16.4.5');
  assert.equal(check('next', '16.4.1').fixedVersion, '16.4.5');
  assert.equal(check('next', '15.3.0').fixedVersion, '15.5.29');
  assert.equal(check('next', '14.2.3').fixedVersion, '15.5.29');
  assert.equal(check('next', '10.2.0').fixedVersion, '15.5.29');
});

test('unwatched packages and bad versions are ignored', () => {
  assert.equal(check('react', '19.2.0'), null);
  assert.equal(check('next', 'workspace:*'), null);
  assert.equal(check('next', ''), null);
});
