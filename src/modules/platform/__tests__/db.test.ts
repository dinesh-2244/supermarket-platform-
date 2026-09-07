import { describe, expect, it } from 'vitest';
import { evaluateMigrationState, EXPECTED_MIGRATIONS, type MigrationAttempt } from '../db/index';

const attempt = (
  name: string,
  overrides: Partial<Omit<MigrationAttempt, 'name'>> = {},
): MigrationAttempt => ({ name, finished: true, rolledBack: false, ...overrides });

/**
 * R5 — the old check counted rows in `_prisma_migrations` whose `finished_at`
 * was null. An *empty* table has none of those, so a fresh or wrong schema
 * reported `current`; so did a database missing a migration this build ships.
 */
describe('platform/db — migration state', () => {
  it('is current when every expected migration has a successful attempt', () => {
    expect(evaluateMigrationState([attempt('a'), attempt('b')], ['a', 'b'])).toBe('current');
  });

  it('is pending for an empty history', () => {
    expect(evaluateMigrationState([], ['a'])).toBe('pending');
  });

  it('is pending when an expected migration has never been attempted', () => {
    expect(evaluateMigrationState([attempt('a')], ['a', 'b'])).toBe('pending');
  });

  it('is pending while an attempt is unfinished or failed part-way', () => {
    expect(evaluateMigrationState([attempt('a', { finished: false })], ['a'])).toBe('pending');
  });

  it('is pending when the only attempt for a migration was rolled back', () => {
    expect(evaluateMigrationState([attempt('a', { rolledBack: true })], ['a'])).toBe('pending');
  });

  it('is current when a rolled-back attempt was resolved by a later successful one', () => {
    expect(
      evaluateMigrationState(
        [attempt('a', { finished: false, rolledBack: true }), attempt('a')],
        ['a'],
      ),
    ).toBe('current');
  });

  it('tolerates a database that is ahead of this build', () => {
    expect(evaluateMigrationState([attempt('a'), attempt('b')], ['a'])).toBe('current');
  });

  it('defaults to the migrations bundled with this build', () => {
    expect(EXPECTED_MIGRATIONS.length).toBeGreaterThan(0);
    expect(evaluateMigrationState([])).toBe('pending');
    expect(evaluateMigrationState(EXPECTED_MIGRATIONS.map((name) => attempt(name)))).toBe(
      'current',
    );
  });
});
