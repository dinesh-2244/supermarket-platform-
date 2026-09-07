/**
 * The one place the process is deliberately killed.
 *
 * Next.js catches whatever `instrumentation.register()` throws and carries on
 * listening, so printing "Refusing to start" and rethrowing left a server up
 * that answered every request with a 500 — the exact "confusing runtime error"
 * boot validation exists to prevent, plus a health endpoint that never went
 * green and an operator with no non-zero exit code to alert on.
 *
 * Kept in its own module so a test can mock it instead of taking the runner
 * down with it.
 */
export function haltProcess(exitCode = 1): never {
  // stdout/stderr writes are already flushed synchronously for a TTY and pipes
  // on exit; `exitCode` is set first so any `beforeExit` listener sees it.
  process.exitCode = exitCode;
  process.exit(exitCode);
}
