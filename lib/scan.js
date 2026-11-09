'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const advisories = require('./advisories');
const { LOCKFILES } = require('./lockfiles');

const WATCHED = new Set(advisories.PACKAGES);

// Folder names never walked into, anywhere.
const SKIP_ANYWHERE = new Set([
  'node_modules',
  'bower_components',
  'jspm_packages',
  'Pods',
  'DerivedData',
  'Caches',
  '__pycache__',
  // Test fixtures hold sample lockfiles, not apps that run.
  'fixtures',
  '__fixtures__',
]);
// Folder names skipped directly under the home folder.
const SKIP_IN_HOME = new Set(['Library', 'Applications']);
// Folder names skipped directly under "/".
const SKIP_IN_FS_ROOT = new Set([
  'System', 'Library', 'Applications', 'Volumes', 'private', 'dev', 'proc', 'sys',
  'bin', 'sbin', 'usr', 'etc', 'var', 'tmp', 'cores', 'opt', 'snap', 'boot', 'lib', 'lib64', 'run',
]);

const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function shouldSkip(name, parent, home) {
  if (name.startsWith('.')) return true;
  if (SKIP_ANYWHERE.has(name)) return true;
  if (parent === home && SKIP_IN_HOME.has(name)) return true;
  if (parent === path.parse(parent).root && SKIP_IN_FS_ROOT.has(name)) return true;
  return false;
}

// Nearest lockfile above a folder, to know which package manager a
// workspace member uses.
function packageManagerAbove(dir) {
  let cur = path.dirname(dir);
  for (let i = 0; i < 12; i++) {
    for (const [file, info] of Object.entries(LOCKFILES)) {
      if (fs.existsSync(path.join(cur, file))) return info.pm;
    }
    if (fs.existsSync(path.join(cur, 'bun.lockb'))) return 'bun';
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return null;
}

function analyzeProject(dir, names, warnings) {
  const project = {
    path: dir,
    packageManager: null,
    lockfiles: [],
    bunLockb: names.has('bun.lockb'),
    declared: new Map(), // name -> field in package.json
    findings: [],
  };

  let pkg = null;
  if (names.has('package.json')) {
    try {
      pkg = readJson(path.join(dir, 'package.json'));
    } catch (err) {
      warnings.push(`Could not read ${path.join(dir, 'package.json')}: ${err.message}`);
    }
  }
  if (pkg && typeof pkg === 'object') {
    for (const field of DEP_FIELDS) {
      const deps = pkg[field];
      if (!deps || typeof deps !== 'object') continue;
      for (const name of Object.keys(deps)) {
        if (WATCHED.has(name) && !project.declared.has(name)) project.declared.set(name, field);
      }
    }
  }

  // name -> version -> Set(source)
  const seen = new Map();
  const add = (name, version, source) => {
    if (!seen.has(name)) seen.set(name, new Map());
    const byVersion = seen.get(name);
    if (!byVersion.has(version)) byVersion.set(version, new Set());
    byVersion.get(version).add(source);
  };
  const parents = new Map();
  const workspaceDeps = new Set();

  // Installed copies: what actually runs.
  if (names.has('node_modules')) {
    for (const name of WATCHED) {
      try {
        const installed = readJson(path.join(dir, 'node_modules', name, 'package.json'));
        if (installed && typeof installed.version === 'string') add(name, installed.version, 'installed');
      } catch {
        // not installed
      }
    }
  }

  for (const [file, info] of Object.entries(LOCKFILES)) {
    if (!names.has(file)) continue;
    project.lockfiles.push(file);
    if (!project.packageManager) project.packageManager = info.pm;
    let text;
    try {
      text = fs.readFileSync(path.join(dir, file), 'utf8');
    } catch (err) {
      warnings.push(`Could not read ${path.join(dir, file)}: ${err.message}`);
      continue;
    }
    if (!text.includes('next') && !text.includes('react-server-dom-')) continue;
    let result;
    try {
      result = info.parse(text, WATCHED);
    } catch (err) {
      warnings.push(`Could not parse ${path.join(dir, file)}: ${err.message}`);
      continue;
    }
    for (const [name, versions] of result.versions) {
      for (const v of versions) add(name, v, file);
    }
    for (const [key, ps] of result.parents) {
      if (!parents.has(key)) parents.set(key, new Set());
      for (const p of ps) parents.get(key).add(p);
    }
    for (const name of result.workspaceDeps) workspaceDeps.add(name);
  }

  if (!project.packageManager) {
    if (project.bunLockb) project.packageManager = 'bun';
    else if (pkg && typeof pkg.packageManager === 'string') project.packageManager = pkg.packageManager.split('@')[0];
  }

  for (const [name, byVersion] of seen) {
    for (const [version, sources] of byVersion) {
      const hit = advisories.check(name, version);
      if (!hit) continue;
      let dependency = 'indirect';
      if (project.declared.has(name)) dependency = 'direct';
      else if (workspaceDeps.has(name)) dependency = 'workspace';
      // A lockfile already holding a clean version while the installed copy is
      // affected means a reinstall is enough.
      let lockfileHasFix = null;
      if (sources.size === 1 && sources.has('installed')) {
        for (const [v2, s2] of byVersion) {
          if (v2 !== version && !s2.has('installed') && !advisories.check(name, v2)) lockfileHasFix = v2;
        }
      }
      project.findings.push({
        name,
        version,
        fixedVersion: hit.fixedVersion,
        advisories: hit.advisories,
        dependency,
        saveField: project.declared.get(name) || null,
        via: dependency === 'indirect'
          ? [...new Set([...(parents.get(`${name}@${version}`) || []), ...(parents.get(`${name}@*`) || [])])].sort()
          : [],
        sources: [...sources],
        lockfileHasFix,
      });
    }
  }

  if (project.findings.length && !project.packageManager) {
    project.packageManager = packageManagerAbove(dir) || 'npm';
  }
  return project;
}

function scan(root, options = {}) {
  const started = process.hrtime.bigint();
  const maxDepth = options.maxDepth ?? 8;
  const home = options.home ?? os.homedir();
  const warnings = [];
  const projects = [];
  let rootPath;
  try {
    rootPath = fs.realpathSync(path.resolve(root));
    if (!fs.statSync(rootPath).isDirectory()) throw new Error('not a folder');
  } catch (err) {
    const e = new Error(`Cannot scan ${root}: ${err.code === 'ENOENT' ? 'no such folder' : err.message}`);
    e.code = 'BAD_ROOT';
    throw e;
  }
  let unreadable = 0;

  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      unreadable++;
      return;
    }
    const names = new Set(entries.map((e) => e.name));
    const isProject = names.has('package.json') || names.has('bun.lockb') ||
      Object.keys(LOCKFILES).some((f) => names.has(f));
    if (isProject) projects.push(analyzeProject(dir, names, warnings));
    if (depth >= maxDepth) return;
    for (const e of entries) {
      // Dirent.isDirectory() is false for symlinks, so links are never followed.
      if (!e.isDirectory() || shouldSkip(e.name, dir, home)) continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(rootPath, 0);

  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  return {
    root: rootPath,
    projects,
    affected: projects.filter((p) => p.findings.length),
    bunLockb: projects.filter((p) => p.bunLockb).map((p) => p.path),
    unreadable,
    warnings,
    durationMs,
  };
}

module.exports = { scan, shouldSkip };
