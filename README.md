# rsc-check

Finds JavaScript projects on your Mac that use a React Server Components or Next.js version with a known critical advisory. For each one it tells you the version to upgrade to and the command to run.

```sh
npx rsc-check
```

That scans your home folder. To scan one folder:

```sh
npx rsc-check ~/code
```

Node 18 or later. Works on macOS and Linux.

## What it checks

| Package | Advisory | Severity | Affected | Fixed in |
| --- | --- | --- | --- | --- |
| `react-server-dom-webpack`, `react-server-dom-parcel`, `react-server-dom-turbopack` | [GHSA-xqc2-xf4c-x3h3](https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3) | critical | 19.0.0 to 19.0.8, 19.1.0 to 19.1.9, 19.2.0 to 19.2.8, 19.3.0 | 19.0.9, 19.1.10, 19.2.9, 19.3.1 |
| `next` | [GHSA-673q-mjm6-r5xr](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr) | critical | 16.0.0 to 16.4.0 | 16.4.1 |
| `next` | [GHSA-2464-fhr4-w9xw](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw) | critical | 10.0.0 to 15.5.27, 16.0.0 to 16.4.0 | 15.5.28, 16.4.1 |
| `next` | [GHSA-p3m5-59mp-jv5r](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r) | high | 13.0.0 to 15.5.27, 16.0.0 to 16.4.0 | 15.5.28, 16.4.1 |

Next.js ships its own copy of the React Server Components code, so a Next.js app is checked through the `next` version.

The `next` ranges come from [OSV](https://osv.dev). The React ranges come from the React advisory. Both were read on 9 November 2026 and are built into the tool.

## How it works

It walks the folder you give it, up to 8 levels deep. A folder with a `package.json` or a lockfile is a project. For each project it reads:

- the installed copy in `node_modules`, because that is the code that runs
- `package-lock.json` and `npm-shrinkwrap.json` (lockfile v1, v2 and v3)
- `pnpm-lock.yaml` (v5 to v9)
- `yarn.lock` (classic and Berry)
- `bun.lock`

`bun.lockb` is a binary file, so it is skipped and the output says so. The installed copy is still checked.

It does not walk into `node_modules`, hidden folders such as `.git` or `.Trash`, `~/Library`, or test `fixtures` folders. It never follows symlinks.

## Example output

```
rsc-check 1.0.0
Checks for React Server Components and Next.js versions with known advisories (data from 2026-11-09).
Runs offline. Nothing is sent anywhere. Nothing is changed.
Scanned ~

~/code/dashboard
  next@16.3.6 → 16.4.1  (direct dependency; installed in node_modules)
    critical GHSA-673q-mjm6-r5xr, critical GHSA-2464-fhr4-w9xw, high GHSA-p3m5-59mp-jv5r
  Fix: npm install
  The lockfile already has next 16.4.1. The installed copy is older, so reinstall.

~/code/shop
  next@16.3.6 → 16.4.1  (direct dependency; pnpm-lock.yaml)
    critical GHSA-673q-mjm6-r5xr, critical GHSA-2464-fhr4-w9xw, high GHSA-p3m5-59mp-jv5r
  react-server-dom-webpack@19.3.0 → 19.3.1  (pulled in by rsc-kit; pnpm-lock.yaml)
    critical GHSA-xqc2-xf4c-x3h3
  Fix: pnpm add next@16.4.1
  Pulled in by rsc-kit. Update that package, or pin react-server-dom-webpack to 19.3.1 or later with "pnpm.overrides" in package.json.

2 projects need an update (3 projects scanned in 6 ms).

Upgrade commands, run in each project folder listed above:
  npm   npm install
  pnpm  pnpm add next@16.4.1
```

The full output also lists each advisory with its link.

## Options

```
npx rsc-check [path]   scan path (default: your home folder)
  --json               machine-readable output
  --depth <n>          how many folders deep to look (default: 8)
  --no-color           plain text
```

Exit code 0 means nothing affected, 1 means at least one project is affected, 2 means an error. You can use it in CI:

```sh
npx rsc-check . --depth 3
```

## What it does not do

- It makes no network requests. The advisory data is in the package. No telemetry.
- It only reads files. It does not change, install or delete anything.
- It does not check your deployed servers. Check what you run in production too.
- It only knows the four advisories above.

## How to fix

1. Go to each project folder in the output.
2. Run the `Fix:` command. For a direct dependency that is `npm install next@16.4.1`, `pnpm add next@16.4.1`, `yarn add next@16.4.1` or `bun add next@16.4.1`.
3. If a package is pulled in by something else, update that package. If it has no fixed release yet, pin the fixed version with `overrides` (npm, bun), `pnpm.overrides` (pnpm) or `resolutions` (yarn) in `package.json`, then reinstall.
4. Run `npx rsc-check` again to confirm.
5. Redeploy.

## License

MIT

Made by the developer of iKnowMyMac, a menu bar app that keeps an eye on the projects on your Mac: https://iknowmymac.com/?utm_source=rsc-check
