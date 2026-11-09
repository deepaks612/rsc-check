'use strict';

// Lockfile readers. Each returns:
//   versions:      Map<name, Set<version>>      for the watched packages only
//   parents:       Map<"name@version", Set<parent>>
//                  packages that depend on that exact copy; "name@*" when
//                  the lockfile does not say which copy a parent gets
//   workspaceDeps: Set<name>                    watched packages declared by a workspace package
// No YAML or JSONC dependency: pnpm and yarn files are read line by line,
// bun.lock has its comments and trailing commas removed before JSON.parse.

const semver = require('./semver');

function createResult(watched) {
  const versions = new Map();
  const parents = new Map();
  const workspaceDeps = new Set();
  return {
    versions,
    parents,
    workspaceDeps,
    watched: (name) => watched.has(name),
    addVersion(name, version) {
      const v = semver.parse(version);
      if (!watched.has(name) || !v) return;
      if (!versions.has(name)) versions.set(name, new Set());
      versions.get(name).add(v.raw);
    },
    addParent(name, version, parent) {
      if (!watched.has(name) || !parent || parent === name) return;
      const v = semver.parse(version || '');
      const key = `${name}@${v ? v.raw : '*'}`;
      if (!parents.has(key)) parents.set(key, new Set());
      parents.get(key).add(parent);
    },
  };
}

function finish(r) {
  return { versions: r.versions, parents: r.parents, workspaceDeps: r.workspaceDeps };
}

// "@scope/name@1.2.3" -> ["@scope/name", "1.2.3"]. Uses the first "@" after the name.
function splitSpec(spec) {
  const at = spec.indexOf('@', spec.startsWith('@') ? 1 : 0);
  if (at <= 0) return [spec, ''];
  return [spec.slice(0, at), spec.slice(at + 1)];
}

const stripQuotes = (s) => s.replace(/^["']|["']$/g, '');

// Key of a YAML-ish "key: value" or "key:" line. Handles quoted keys.
function lineKey(t) {
  if (t.startsWith('"') || t.startsWith("'")) {
    const end = t.indexOf(t[0], 1);
    if (end > 0) return t.slice(1, end);
  }
  const m = /^(.*?):(\s|$)/.exec(t);
  return m ? m[1] : t.replace(/:$/, '');
}

// Value of a YAML-ish "key: value" line.
function lineValue(t) {
  let rest;
  if (t.startsWith('"') || t.startsWith("'")) {
    rest = t.slice(t.indexOf(t[0], 1) + 1);
  } else {
    const m = /^.*?:(\s|$)/.exec(t);
    rest = m ? t.slice(m[0].length - (m[1] ? 1 : 0)) : '';
  }
  return stripQuotes(rest.replace(/^:?\s*/, '').trim());
}

// ---------------------------------------------------------------- npm

// Node's lookup: <from>/node_modules/<dep>, then each folder above.
function resolveNpm(packages, fromKey, dep) {
  let base = fromKey;
  for (;;) {
    const candidate = `${base ? `${base}/` : ''}node_modules/${dep}`;
    if (packages[candidate] && !packages[candidate].link) return packages[candidate];
    if (!base) return null;
    const idx = base.lastIndexOf('node_modules/');
    base = idx < 0 ? '' : base.slice(0, idx).replace(/\/$/, '');
  }
}

function realNpmVersion(entry) {
  const v = entry && entry.version;
  if (typeof v === 'string' && v.startsWith('npm:')) return splitSpec(v.slice(4));
  return [null, v];
}

function parseNpm(text, watched) {
  const r = createResult(watched);
  const data = JSON.parse(text);
  if (data && data.packages && typeof data.packages === 'object') {
    const packages = data.packages;
    for (const [key, entry] of Object.entries(packages)) {
      if (!entry || typeof entry !== 'object' || entry.link) continue;
      const nm = key.lastIndexOf('node_modules/');
      const name = entry.name || (nm >= 0 ? key.slice(nm + 'node_modules/'.length) : key || '(root)');
      if (nm >= 0) r.addVersion(name, entry.version);
      for (const field of ['dependencies', 'optionalDependencies', 'devDependencies']) {
        const deps = entry[field];
        if (!deps || typeof deps !== 'object') continue;
        for (const dep of Object.keys(deps)) {
          const target = resolveNpm(packages, key, dep);
          const realName = (target && target.name) || dep;
          if (!r.watched(realName)) continue;
          if (nm >= 0) r.addParent(realName, target && target.version, name);
          else if (key !== '') r.workspaceDeps.add(realName);
        }
      }
    }
  } else if (data && data.dependencies && typeof data.dependencies === 'object') {
    // lockfileVersion 1: nested "dependencies", "requires" resolved through the parent chain.
    const walk = (deps, scope) => {
      for (const [alias, entry] of Object.entries(deps)) {
        if (!entry || typeof entry !== 'object') continue;
        const [aliasOf, version] = realNpmVersion(entry);
        const realName = aliasOf || alias;
        r.addVersion(realName, version);
        const inner = entry.dependencies && typeof entry.dependencies === 'object' ? [...scope, entry.dependencies] : scope;
        for (const dep of Object.keys(entry.requires || {})) {
          for (let i = inner.length - 1; i >= 0; i--) {
            if (inner[i][dep]) {
              const [depAliasOf, depVersion] = realNpmVersion(inner[i][dep]);
              r.addParent(depAliasOf || dep, depVersion, realName);
              break;
            }
          }
        }
        if (inner !== scope) walk(entry.dependencies, inner);
      }
    };
    walk(data.dependencies, [data.dependencies]);
  }
  return finish(r);
}

// ---------------------------------------------------------------- pnpm

function parsePnpmKey(key, lockVersion) {
  let k = key.replace(/^\//, '');
  if (lockVersion >= 6) {
    const paren = k.indexOf('(');
    if (paren > 0) k = k.slice(0, paren);
    const at = k.lastIndexOf('@');
    if (at <= 0) return null;
    return { name: k.slice(0, at), version: k.slice(at + 1) };
  }
  // v5: /name/version_peers or /@scope/name/version_peers
  const slash = k.lastIndexOf('/');
  if (slash <= 0) return null;
  return { name: k.slice(0, slash), version: k.slice(slash + 1).split('_')[0] };
}

function parsePnpm(text, watched) {
  const r = createResult(watched);
  const vm = /^lockfileVersion:\s*['"]?([\d.]+)/m.exec(text);
  const lockVersion = vm ? parseFloat(vm[1]) : 6;
  let section = null;
  let importer = null;
  let pkgName = null;
  let sub = null;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      section = lineKey(t);
      importer = null;
      pkgName = null;
      sub = null;
      continue;
    }
    if (section === 'importers') {
      if (indent === 2) {
        importer = lineKey(t);
        sub = null;
      } else if (indent === 4) {
        sub = lineKey(t);
      } else if (indent === 6 && importer && importer !== '.' && /^(dev|optional)?[dD]ependencies$/.test(sub || '')) {
        const dep = lineKey(t);
        if (r.watched(dep)) r.workspaceDeps.add(dep);
      }
      continue;
    }
    if (section === 'packages' || section === 'snapshots') {
      if (indent === 2) {
        const parsed = parsePnpmKey(lineKey(t), lockVersion);
        pkgName = parsed ? parsed.name : null;
        sub = null;
        if (parsed) r.addVersion(parsed.name, parsed.version);
      } else if (indent === 4) {
        sub = lineKey(t);
      } else if (indent === 6 && pkgName && (sub === 'dependencies' || sub === 'optionalDependencies')) {
        // "name: 19.3.0(react@19.2.0)" (v6+) or "name: 19.3.0_peerhash" (v5)
        const version = lineValue(t).split('(')[0].split('_')[0];
        r.addParent(lineKey(t), version, pkgName);
      }
    }
  }
  return finish(r);
}

// ---------------------------------------------------------------- yarn

function parseYarn(text, watched) {
  const r = createResult(watched);
  const blocks = [];
  const byDescriptor = new Map();
  let block = null;
  let sub = null;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      block = null;
      sub = null;
      if (!t.endsWith(':') || t.startsWith('__metadata')) continue;
      const descriptors = t.slice(0, -1).split(/,\s*/).map(stripQuotes);
      const workspace = descriptors.find((d) => d.includes('@workspace:'));
      block = {
        descriptors,
        name: splitSpec(descriptors[0])[0],
        version: null,
        deps: [],
        workspace: Boolean(workspace),
        rootWorkspace: Boolean(workspace && /@workspace:\.$/.test(workspace)),
      };
      blocks.push(block);
      for (const d of descriptors) byDescriptor.set(d, block);
      continue;
    }
    if (!block) continue;
    if (indent === 2) {
      sub = null;
      if (/^version[:\s]/.test(t)) {
        block.version = stripQuotes(t.replace(/^version:?\s*/, ''));
      } else if (/^resolution:/.test(t)) {
        const res = stripQuotes(t.replace(/^resolution:\s*/, ''));
        block.name = splitSpec(res)[0];
        if (res.includes('@workspace:')) {
          block.workspace = true;
          block.rootWorkspace = /@workspace:\.$/.test(res);
        }
      } else if (/^(dependencies|optionalDependencies):?$/.test(t)) {
        sub = 'deps';
      }
    } else if (indent === 4 && sub === 'deps') {
      // classic: "@next/env" "16.3.6"   berry: "@next/env": "npm:16.3.6"
      let name;
      let range;
      if (t.startsWith('"')) {
        const end = t.indexOf('"', 1);
        name = t.slice(1, end);
        range = t.slice(end + 1);
      } else {
        const m = /^([^\s:]+):?\s*(.*)$/.exec(t);
        name = m ? m[1] : t;
        range = m ? m[2] : '';
      }
      range = stripQuotes(range.replace(/^:?\s*/, '').trim());
      block.deps.push({ name, descriptor: `${name}@${range}` });
    }
  }
  for (const b of blocks) {
    if (b.version) r.addVersion(b.name, b.version);
    for (const dep of b.deps) {
      if (b.workspace) {
        if (!b.rootWorkspace && r.watched(dep.name)) r.workspaceDeps.add(dep.name);
        continue;
      }
      const target = byDescriptor.get(dep.descriptor);
      r.addParent(target ? target.name : dep.name, target && target.version, b.name);
    }
  }
  return finish(r);
}

// ---------------------------------------------------------------- bun

// Calls fn(ch, i) for characters outside strings; fn returns the text to keep
// and may move the index forward. Characters inside strings are kept as is.
function mapOutsideStrings(text, fn) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      out += ch;
      if (ch === '\\') out += text[++i] || '';
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out += ch;
      continue;
    }
    const res = fn(ch, i);
    out += res.keep;
    i = res.next;
  }
  return out;
}

function stripJsonc(text) {
  const noComments = mapOutsideStrings(text, (ch, i) => {
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      return { keep: '\n', next: nl < 0 ? text.length : nl };
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      return { keep: ' ', next: end < 0 ? text.length : end + 1 };
    }
    return { keep: ch, next: i };
  });
  return mapOutsideStrings(noComments, (ch, i) => {
    if (ch !== ',') return { keep: ch, next: i };
    let j = i + 1;
    while (j < noComments.length && /\s/.test(noComments[j])) j++;
    return { keep: noComments[j] === '}' || noComments[j] === ']' ? '' : ch, next: i };
  });
}

// "a/@scope/b/next" -> ["a", "@scope/b", "next"]
function bunKeyNames(key) {
  const parts = key.split('/');
  const names = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith('@') && i + 1 < parts.length) names.push(`${parts[i]}/${parts[++i]}`);
    else names.push(parts[i]);
  }
  return names;
}

function parseBun(text, watched) {
  const r = createResult(watched);
  const data = JSON.parse(stripJsonc(text));
  if (data && data.workspaces && typeof data.workspaces === 'object') {
    for (const [key, ws] of Object.entries(data.workspaces)) {
      if (key === '' || !ws) continue;
      for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        for (const dep of Object.keys(ws[field] || {})) {
          if (r.watched(dep)) r.workspaceDeps.add(dep);
        }
      }
    }
  }
  const packages = data && data.packages && typeof data.packages === 'object' ? data.packages : {};
  const info = (entry) => {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string') return null;
    let [name, version] = splitSpec(entry[0]);
    if (version.startsWith('npm:')) version = version.slice(4);
    return { name, version };
  };
  for (const [key, entry] of Object.entries(packages)) {
    const pkg = info(entry);
    if (!pkg || pkg.version.startsWith('workspace:')) continue;
    r.addVersion(pkg.name, pkg.version);
    const meta = entry.find((x, i) => i > 0 && x && typeof x === 'object' && !Array.isArray(x));
    if (!meta) continue;
    const path = bunKeyNames(key);
    for (const field of ['dependencies', 'optionalDependencies']) {
      for (const dep of Object.keys(meta[field] || {})) {
        let target = null;
        for (let k = path.length; k >= 0 && !target; k--) {
          target = info(packages[[...path.slice(0, k), dep].join('/')]);
        }
        r.addParent(target ? target.name : dep, target && target.version, pkg.name);
      }
    }
  }
  return finish(r);
}

const LOCKFILES = {
  'package-lock.json': { pm: 'npm', parse: parseNpm },
  'npm-shrinkwrap.json': { pm: 'npm', parse: parseNpm },
  'pnpm-lock.yaml': { pm: 'pnpm', parse: parsePnpm },
  'yarn.lock': { pm: 'yarn', parse: parseYarn },
  'bun.lock': { pm: 'bun', parse: parseBun },
};

module.exports = { LOCKFILES, parseNpm, parsePnpm, parseYarn, parseBun, stripJsonc, splitSpec };
