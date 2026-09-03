# Contributing to Loadout

Thanks for your interest in contributing.

## Setup

```bash
git clone https://github.com/VirajMishra1/loadout.git
cd loadout
npm ci
npm run verify
```

## Development

```bash
npm run dev -- <command>     # run from source via tsx
npm test                     # vitest
npm run lint                 # eslint
npm run format               # prettier
npm run typecheck            # tsc --noEmit
npm run verify               # normal CI gate
npm run verify:full          # release gate, including coverage
```

## Before opening a PR

1. Run `npm run verify:full` — it must pass.
2. If you changed CLI commands, run `npm run check:evidence` to ensure docs stay in sync.
3. Write tests for new behavior. Coverage floors are enforced.
4. Keep commits atomic. Follow the existing commit message style (`fix:`, `feat:`, `chore:`, `refactor:`).

## Security

If you find a security issue, **do not open a public issue**. Follow the private reporting process in [SECURITY.md](SECURITY.md).

## Code style

- Match existing patterns. No new abstractions for one-off operations.
- TypeScript strict mode. Type everything.
- No hardcoded secrets, no command injection, no path traversal.
- Prefer editing existing files over creating new ones.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
