'use strict';

const os = require('os');
const path = require('path');
const advisories = require('./advisories');
const semver = require('./semver');

const PROMO =
  "iKnowMyMac's Package Watch watches every project on your Mac for this and other advisories and fixes them with Undo: https://iknowmymac.com/?utm_source=rsc-check";

const ADD = {
  npm: { cmd: 'npm install', dev: '-D' },
  pnpm: { cmd: 'pnpm add', dev: '-D' },
  yarn: { cmd: 'yarn add', dev: '-D' },
  bun: { cmd: 'bun add', dev: '--dev' },
};
const INSTALL = { npm: 'npm install', pnpm: 'pnpm install', yarn: 'yarn install', bun: 'bun install' };
const OVERRIDE_FIELD = { npm: '"overrides"', pnpm: '"pnpm.overrides"', yarn: '"resolutions"', bun: '"overrides"' };

function tildify(p, home = os.homedir()) {
  if (p === home) return '~';
  if (home && p.startsWith(home + path.sep)) return '~' + p.slice(home.length);
  return p;
}

// Fix steps for one project: { commands: [...], notes: [...] }
function fixFor(project) {
  const pm = ADD[project.packageManager] ? project.packageManager : 'npm';
  const commands = [];
  const notes = [];
  const prod = [];
  const dev = [];
  let reinstall = false;
  for (const f of project.findings) {
    const spec = `${f.name}@${f.fixedVersion}`;
    const from = semver.parse(f.version);
    const to = semver.parse(f.fixedVersion);
    if (from && to && to.major > from.major) {
      notes.push(`No fix was published for ${f.name} ${from.major}.x. ${f.fixedVersion} is a major upgrade, so check the release notes first.`);
    }
    if (f.lockfileHasFix) {
      reinstall = true;
      notes.push(`The lockfile already has ${f.name} ${f.lockfileHasFix}. The installed copy is older, so reinstall.`);
    } else if (f.dependency === 'direct') {
      (f.saveField === 'devDependencies' ? dev : prod).push(spec);
    } else if (f.dependency === 'workspace') {
      notes.push(`${f.name} is declared by a workspace package. Run "${ADD[pm].cmd} ${spec}" in that package's folder.`);
    } else {
      const via = f.via.length ? `Pulled in by ${f.via.slice(0, 3).join(', ')}${f.via.length > 3 ? ' and others' : ''}. ` : '';
      notes.push(`${via}Update that package, or pin ${f.name} to ${f.fixedVersion} or later with ${OVERRIDE_FIELD[pm]} in package.json.`);
    }
  }
  const uniq = (a) => [...new Set(a)];
  if (prod.length) commands.push(`${ADD[pm].cmd} ${uniq(prod).join(' ')}`);
  if (dev.length) commands.push(`${ADD[pm].cmd} ${ADD[pm].dev} ${uniq(dev).join(' ')}`);
  if (reinstall && !prod.length && !dev.length) commands.push(INSTALL[pm]);
  return { packageManager: pm, commands, notes: uniq(notes) };
}

function colorizer(enabled) {
  const wrap = (code) => (s) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  return { bold: wrap('1'), dim: wrap('2'), red: wrap('31'), yellow: wrap('33'), green: wrap('32') };
}

function sourcesLabel(f) {
  return f.sources.map((s) => (s === 'installed' ? 'installed in node_modules' : s)).join(', ');
}

function dependencyLabel(f) {
  if (f.dependency === 'direct') return 'direct dependency';
  if (f.dependency === 'workspace') return 'workspace dependency';
  return f.via.length ? `pulled in by ${f.via.slice(0, 3).join(', ')}${f.via.length > 3 ? ', ...' : ''}` : 'pulled in by another package';
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function formatText(result, { version, color = false, home = os.homedir() } = {}) {
  const c = colorizer(color);
  const sev = (s) => (s === 'critical' ? c.red(s) : s === 'high' ? c.yellow(s) : s);
  const out = [];
  out.push(c.bold(`rsc-check ${version}`));
  out.push(`Checks for React Server Components and Next.js versions with known advisories (data from ${advisories.DATA_DATE}).`);
  out.push('Runs offline. Nothing is sent anywhere. Nothing is changed.');
  out.push(`Scanned ${tildify(result.root, home)}`);
  out.push('');

  const byPm = new Map();
  const seenAdvisories = new Map();
  for (const project of result.affected) {
    out.push(c.bold(tildify(project.path, home)));
    for (const f of project.findings) {
      out.push(`  ${f.name}@${f.version} → ${c.green(f.fixedVersion)}  ${c.dim(`(${dependencyLabel(f)}; ${sourcesLabel(f)})`)}`);
      const advs = [...f.advisories].sort((a, b) => advisories.SEVERITY_RANK[b.severity] - advisories.SEVERITY_RANK[a.severity]);
      out.push(`    ${advs.map((a) => `${sev(a.severity)} ${a.id}`).join(', ')}`);
      for (const a of advs) seenAdvisories.set(a.id, a);
    }
    const fix = fixFor(project);
    for (const cmd of fix.commands) {
      out.push(`  Fix: ${cmd}`);
      if (!byPm.has(fix.packageManager)) byPm.set(fix.packageManager, new Set());
      byPm.get(fix.packageManager).add(cmd);
    }
    for (const note of fix.notes) out.push(`  ${note}`);
    out.push('');
  }

  const n = result.affected.length;
  const total = result.projects.length;
  const took = result.durationMs < 1000 ? `${Math.max(1, Math.round(result.durationMs))} ms` : `${(result.durationMs / 1000).toFixed(1)} s`;
  if (n) {
    out.push(c.bold(`${plural(n, 'project needs', 'projects need')} an update (${plural(total, 'project', 'projects')} scanned in ${took}).`));
  } else {
    out.push(c.bold(`No affected versions found in ${plural(total, 'project', 'projects')} (scanned in ${took}).`));
  }

  if (byPm.size) {
    out.push('');
    out.push('Upgrade commands, run in each project folder listed above:');
    for (const [pm, cmds] of byPm) {
      for (const cmd of cmds) out.push(`  ${pm.padEnd(5)} ${cmd}`);
    }
  }

  if (seenAdvisories.size) {
    out.push('');
    out.push('Advisories:');
    for (const a of seenAdvisories.values()) {
      out.push(`  ${a.id}  ${a.title}`);
      out.push(`    ${c.dim(a.url)}`);
    }
  }

  const notes = [];
  if (result.bunLockb.length) {
    notes.push(`Skipped bun.lockb in ${plural(result.bunLockb.length, 'project', 'projects')}: it is a binary file. Installed copies in node_modules were still checked.`);
  }
  if (result.warnings.length) {
    notes.push(`${plural(result.warnings.length, 'file', 'files')} could not be read. Run with --json to see them.`);
  }
  if (notes.length) {
    out.push('');
    for (const note of notes) out.push(note);
  }

  out.push('');
  out.push(PROMO);
  return out.join('\n') + '\n';
}

function formatJson(result, { version } = {}) {
  const advisoryJson = (a) => ({ id: a.id, severity: a.severity, title: a.title, url: a.url });
  return JSON.stringify(
    {
      tool: 'rsc-check',
      version,
      advisoryData: {
        date: advisories.DATA_DATE,
        advisories: advisories.ADVISORIES.map((a) => ({
          ...advisoryJson(a),
          source: a.source,
          affected: Object.fromEntries(
            Object.entries(a.affected).map(([name, ranges]) => [name, ranges.map(([introduced, fixed]) => ({ introduced, fixed }))]),
          ),
        })),
      },
      root: result.root,
      projectsScanned: result.projects.length,
      projectsAffected: result.affected.length,
      durationMs: Math.round(result.durationMs),
      affected: result.affected.map((p) => {
        const fix = fixFor(p);
        return {
          path: p.path,
          packageManager: fix.packageManager,
          lockfiles: p.lockfiles,
          findings: p.findings.map((f) => ({
            package: f.name,
            version: f.version,
            fixedVersion: f.fixedVersion,
            dependency: f.dependency,
            via: f.via,
            sources: f.sources,
            lockfileHasFix: f.lockfileHasFix,
            advisories: f.advisories.map(advisoryJson),
          })),
          fix: { commands: fix.commands, notes: fix.notes },
        };
      }),
      skippedBunLockb: result.bunLockb,
      warnings: result.warnings,
    },
    null,
    2,
  ) + '\n';
}

module.exports = { formatText, formatJson, fixFor, tildify, PROMO };
