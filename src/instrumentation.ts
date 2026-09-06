/**
 * Runs once, on server startup, before the first request is handled.
 *
 * This is where the app **fails closed**: `getConfig()` validates the whole
 * environment with Zod, so a missing or malformed variable stops the process
 * here with a readable message rather than surfacing later as a confusing
 * runtime error on some unrelated request (architecture §22).
 */
export async function register(): Promise<void> {
  // Only the Node.js server runtime boots the kernel; the edge runtime has no
  // database or logger.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { getConfig, getLogger, registerEventHandlers } = await import('@/modules/platform');

  try {
    const config = getConfig();
    registerEventHandlers();
    getLogger().info({ appEnv: config.APP_ENV }, 'Application configuration loaded');
  } catch (error) {
    // Written to stderr directly: the logger itself depends on config.
    console.error(
      '\n[boot] Refusing to start — the environment is invalid.\n' +
        'Copy .env.example to .env and fill in the required values.\n',
    );
    console.error(error instanceof Error ? error.message : error);
    throw error;
  }
}
