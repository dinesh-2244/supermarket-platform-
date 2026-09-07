# Compile fixtures

Deliberately-illegal TypeScript, compiled _on demand_ by a test rather than by
`npm run typecheck`. `tsconfig.json` excludes this directory, so a fixture that
must not compile cannot break the repository-wide typecheck.

See `tests/unit/transaction-handle.test.ts`.
