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
