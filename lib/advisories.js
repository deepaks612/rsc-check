'use strict';

const semver = require('./semver');

// Advisory data, embedded so the tool works offline.
// Ranges are OSV SEMVER events: a version is affected when
// introduced <= version < fixed for any pair.
//
// Sources:
//   GHSA-xqc2-xf4c-x3h3 (CVE-2026-126187): React repository advisory. Not in OSV on
//     2026-11-09; https://api.osv.dev/v1/vulns/GHSA-xqc2-xf4c-x3h3 from 2026-11-10, same ranges.
//   CVE numbers: OSV aliases, or the cve_id GitHub assigned on the advisory itself.
//     GHSA-673q has none yet. GHSA-2464 is left without one: the CVE GitHub links
//     (CVE-2026-96889) is Red Hat's record for the underlying librsvg bug.
//   GHSA-673q-mjm6-r5xr, GHSA-2464-fhr4-w9xw, GHSA-p3m5-59mp-jv5r:
//     https://api.osv.dev/v1/vulns/<id>, fetched 2026-11-09.
//   GHSA-f3mh-rxg3-f5g2, GHSA-7qx7-33qx-rqx2, GHSA-pc58-hwjq-p385,
//   GHSA-rhh4-g77r-r9qj, GHSA-vvgp-ww4w-46vf, GHSA-vc7v-qv4w-wrv8,
//   GHSA-mfr8-8qww-v76h: Next.js GitHub repository advisories published
//     2026-11-03, read 2026-11-11 from
//     https://api.github.com/repos/vercel/next.js/security-advisories/<id>.
//     Not in OSV on 2026-11-11. GitHub's "<= last affected" ranges are
//     written here as [introduced, fixed) pairs.

const DATA_DATE = '2026-11-11';

const RSC_RANGES = [
  ['19.0.0', '19.0.9'],
  ['19.1.0', '19.1.10'],
  ['19.2.0', '19.2.9'],
  ['19.3.0', '19.3.1'],
];

const NOV_SOURCE = 'Next.js GitHub repository advisory (not in OSV on 2026-11-11)';
const nextAdvisory = (id, cve, title, ranges) => ({
  id,
  cve,
  severity: 'medium',
  title: `Next.js: ${title}`,
  url: `https://github.com/vercel/next.js/security/advisories/${id}`,
  source: NOV_SOURCE,
  affected: { next: ranges },
});

const ADVISORIES = [
  {
    id: 'GHSA-xqc2-xf4c-x3h3',
    cve: 'CVE-2026-126187',
    severity: 'critical',
    title: 'Remote code execution in React Server Components (no login needed)',
    url: 'https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3',
    source: 'https://api.osv.dev/v1/vulns/GHSA-xqc2-xf4c-x3h3',
    affected: {
      'react-server-dom-webpack': RSC_RANGES,
      'react-server-dom-parcel': RSC_RANGES,
      'react-server-dom-turbopack': RSC_RANGES,
    },
  },
  {
    id: 'GHSA-673q-mjm6-r5xr',
    severity: 'critical',
    title: 'Next.js: remote code execution in "use cache" functions that return typed arrays',
    url: 'https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr',
    source: 'https://api.osv.dev/v1/vulns/GHSA-673q-mjm6-r5xr',
    affected: {
      next: [['16.0.0', '16.4.1']],
    },
  },
  {
    id: 'GHSA-2464-fhr4-w9xw',
    severity: 'critical',
    title: 'Next.js: remote code execution in the Image Optimization API with SVG files',
    url: 'https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw',
    source: 'https://api.osv.dev/v1/vulns/GHSA-2464-fhr4-w9xw',
    affected: {
      next: [
        ['10.0.0', '15.5.28'],
        ['16.0.0', '16.4.1'],
      ],
    },
  },
  {
    id: 'GHSA-p3m5-59mp-jv5r',
    cve: 'CVE-2026-94482',
    severity: 'high',
    title: 'Next.js: denial of service in App Router with Server Actions',
    url: 'https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r',
    source: 'https://api.osv.dev/v1/vulns/GHSA-p3m5-59mp-jv5r',
    affected: {
      next: [
        ['13.0.0', '15.5.28'],
        ['16.0.0', '16.4.1'],
      ],
    },
  },
  nextAdvisory('GHSA-f3mh-rxg3-f5g2', 'CVE-2026-119346', 'HttpOnly cookie exposure through an internal header on Edge runtime routes', [
    ['15.0.0', '15.5.29'],
    ['16.0.0', '16.4.5'],
  ]),
  nextAdvisory('GHSA-7qx7-33qx-rqx2', 'CVE-2026-119347', 'SVG rejection bypass in image optimization', [
    ['15.0.0', '15.5.29'],
    ['16.0.0', '16.4.5'],
  ]),
  nextAdvisory('GHSA-pc58-hwjq-p385', 'CVE-2026-119348', 'cross-client response injection when self-hosted apps forward fetched responses', [
    ['0.0.0', '15.5.29'],
    ['16.0.0', '16.4.5'],
  ]),
  nextAdvisory('GHSA-rhh4-g77r-r9qj', 'CVE-2026-119349', 'cross-user cache disclosure and poisoning in "use cache" with binary arguments', [
    ['16.0.0', '16.4.5'],
  ]),
  nextAdvisory('GHSA-vvgp-ww4w-46vf', 'CVE-2026-119350', 'cache poisoning of shared fallback shells through placeholder route params', [
    ['16.4.0', '16.4.5'],
  ]),
  nextAdvisory('GHSA-vc7v-qv4w-wrv8', 'CVE-2026-119351', 'cache leak across root param values in nested "use cache" functions', [
    ['16.2.0', '16.4.5'],
  ]),
  nextAdvisory('GHSA-mfr8-8qww-v76h', 'CVE-2026-119790', 'information disclosure across root params when "use cache" runs through unstable_cache()', [
    ['16.3.0', '16.4.5'],
  ]),
];

const PACKAGES = [...new Set(ADVISORIES.flatMap((a) => Object.keys(a.affected)))];

const SEVERITY_RANK = { critical: 3, high: 2, moderate: 1, medium: 1, low: 0 };

function matchRange(version, ranges) {
  for (const [introduced, fixed] of ranges) {
    if (semver.compare(version, introduced) >= 0 && semver.compare(version, fixed) < 0) {
      return fixed;
    }
  }
  return null;
}

// Returns { advisories: [...], fixedVersion } or null when the version is not affected.
function check(name, version) {
  const v = semver.parse(version);
  if (!v) return null;
  const hits = [];
  for (const adv of ADVISORIES) {
    const ranges = adv.affected[name];
    if (!ranges) continue;
    const fixed = matchRange(v, ranges);
    if (fixed) hits.push({ advisory: adv, fixed });
  }
  if (!hits.length) return null;
  return {
    advisories: hits.map((h) => h.advisory),
    fixedVersion: lowestCleanVersion(name, hits.map((h) => h.fixed)),
  };
}

// Highest of the per-advisory fixes, then bumped until no advisory matches.
function lowestCleanVersion(name, fixes) {
  let candidate = fixes.reduce((a, b) => (semver.compare(a, b) >= 0 ? a : b));
  for (let guard = 0; guard < 20; guard++) {
    const next = [];
    for (const adv of ADVISORIES) {
      const ranges = adv.affected[name];
      if (!ranges) continue;
      const f = matchRange(semver.parse(candidate), ranges);
      if (f) next.push(f);
    }
    if (!next.length) return candidate;
    candidate = next.reduce((a, b) => (semver.compare(a, b) >= 0 ? a : b));
  }
  return candidate;
}

module.exports = { ADVISORIES, PACKAGES, DATA_DATE, SEVERITY_RANK, check };
