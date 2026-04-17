# Contributing to memok-ai

Thanks for contributing.

## Development Setup

- Node.js **≥20** (LTS recommended); OpenClaw gateway **≥2026.3.24** when developing the plugin (see `openclaw.compat` in [package.json](package.json)).

```bash
npm install
cp .env.example .env
```

Useful commands:

```bash
npm run lint
npm run build
npm test
npm run dev -- --help
```

Formatting and linting use [Biome](https://biomejs.dev/) (`biome.json` at repo root). CI runs `npm run lint` before build.

## Security and dependencies

- Run `npm audit` periodically; review `npm audit fix` output before applying (semver and breaking changes).
- [Dependabot](https://docs.github.com/en/code-security/dependabot) opens weekly npm update PRs (see [.github/dependabot.yml](.github/dependabot.yml)).

## Pull Request Checklist

Before opening a PR:

- Keep changes focused (one problem per PR when possible)
- Add or update tests for behavior changes
- Run `npm run lint`, `npm run build`, and `npm test`
- Update docs when CLI/plugin behavior changes
- If you change install steps or installer env vars, update both [README.md](README.md) and [README.zh-CN.md](README.zh-CN.md) in the same PR
- Include a clear summary: what changed, why, and how it was verified

## SQLite connections

Production code opens on-disk databases via [`src/sqlite/openSqlite.ts`](src/sqlite/openSqlite.ts), which sets `busy_timeout` and WAL (`journal_mode`) to reduce lock contention under concurrent gateway or cron use. Tests may still use `better-sqlite3` in-memory databases directly.

## Code Style

- TypeScript + Node.js ESM
- Prefer small, composable functions
- Keep JSON output contracts stable unless migration is documented
- Avoid destructive or backward-incompatible SQLite changes without migration notes

## Testing Guidance

- Add unit tests for new logic and edge cases
- Prefer deterministic tests (inject functions/randomness where needed)
- For SQLite-related code, use temporary databases per test

## Commit Messages

Follow existing history style:

- `feat(...): ...`
- `fix(...): ...`
- `refactor(...): ...`

Keep subject concise and explain motivation in body when needed.

## Reporting Issues

For bugs, please include:

- Repro steps
- Expected vs actual behavior
- Relevant config (`openclaw.plugin.json` / plugin config snippet)
- Logs/errors
- Runtime versions (Node, OpenClaw)
