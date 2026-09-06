import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">Supermarket Platform</h1>
      <p className="text-neutral-600 dark:text-neutral-400">
        Phase 1 foundation skeleton. No storefront or admin features are built yet — see{' '}
        <code className="rounded bg-neutral-100 px-1 py-0.5 dark:bg-neutral-800">
          docs/phase-0-architecture.md
        </code>
        .
      </p>
      <div>
        <Button asChild>
          <a href="/api/health">Health check</a>
        </Button>
      </div>
    </main>
  );
}
