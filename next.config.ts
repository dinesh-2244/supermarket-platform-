import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Standalone output is what docker/Dockerfile copies into the runtime image.
  output: 'standalone',
  // Pin the trace root to this project. Without it Next walks up to the nearest
  // ancestor holding a lockfile, which can be a stray file outside the repo and
  // silently changes what the standalone bundle contains.
  outputFileTracingRoot: projectRoot,
  // `pg` and the Prisma driver adapter are Node-only — `pg-connection-string`
  // reaches for `fs` and `pgpass` for `path`, neither of which exists in a
  // bundle. Prisma 7 puts them on the request path for the first time, so they
  // have to be left as real `require()`s in the server build rather than
  // traced into it. `@prisma/client` is already on Next's own default list;
  // its new driver-adapter dependencies are not.
  serverExternalPackages: ['pg', '@prisma/adapter-pg'],
  /**
   * Keep `pg` out of the **edge** bundle as well.
   *
   * `serverExternalPackages` covers the Node server build only; the edge build
   * cannot have externals at all. Because `src/middleware.ts` exists, Next also
   * compiles `src/instrumentation.ts` for edge, and follows the
   * `await import('@/modules/platform')` inside it even though that line is
   * unreachable there — `register()` returns early unless
   * `NEXT_RUNTIME === 'nodejs'`. Resolving `pg` to an empty module ends the
   * chain at its source rather than stubbing `fs`, `path` and `stream`
   * individually, and it is only ever applied to a build that cannot execute
   * the code in question.
   */
  webpack: (config: { resolve?: { alias?: Record<string, unknown> } }, { nextRuntime }) => {
    if (nextRuntime === 'edge') {
      config.resolve ??= {};
      config.resolve.alias = { ...config.resolve.alias, pg: false, '@prisma/adapter-pg': false };
    }
    return config;
  },
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: {
    // Linting is a separate, stricter CI gate (`npm run lint`); don't run it twice.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Same reasoning: `npm run typecheck` is the gate.
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
