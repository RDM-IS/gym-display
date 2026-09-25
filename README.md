# gym-display

The iPad workout display for ACOS (`gym.rdm.is`). React + Vite, deployed to
Cloudflare Pages behind Cloudflare Access.

## This repository is public

Public since 2026-09-25. Its full history was scanned first: no credential, key
or `.env` value has ever been committed, and every fixture that looks like
health data is synthetic — checked against the real training log for zero
matches.

**Keep it that way.** Fixtures use invented values outside the real range. Never
paste a real session's loads, RPE or bodyweight into a test.

## Build and CI

```bash
npm ci
npm run build   # tsc -b && vite build — the same command Cloudflare Pages runs
npm test        # vitest; does NOT type-check
```

`npm run build` is the gate, not `npm test`. Vitest never type-checks, which is
how two merges reached `main` in September 2026 with type errors that stopped
Pages from publishing anything. CI runs the build on every pull request and
every push to `main`, and `main` will not accept a merge until it passes.

On a push to `main`, CI also publishes the commit sha to an SSM parameter over
GitHub OIDC, which is how ACOS's drift alarm knows whether the live site is
current. The build stamps the same sha into `/version.json` and a
`<meta name="commit-sha">` tag.
