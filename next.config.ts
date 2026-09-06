import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Standalone output is what docker/Dockerfile copies into the runtime image.
  output: 'standalone',
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
