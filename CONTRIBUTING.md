# Contributing to memok-ai

Thanks for contributing.

## Development Setup

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

## Pull Request Checklist

Before opening a PR:

- Keep changes focused (one problem per PR when possible)
- Add or update tests for behavior changes
- Run `npm run lint`, `npm run build`, and `npm test`
- Update docs when CLI/plugin behavior changes
- If you change install steps or installer env vars, update both [README.md](README.md) and [README.zh-CN.md](README.zh-CN.md) in the same PR
- Include a clear summary: what changed, why, and how it was verified

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
