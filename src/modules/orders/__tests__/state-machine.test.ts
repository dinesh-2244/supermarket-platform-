import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../platform/index';
import {
  assertTransition,
  canCancelByStore,
  checkTransition,
  computeVariance,
  ORDER_STATUSES,
  requiresDiscrepancyNote,
  TRANSITIONS,
  type OrderStatus,
  type TransitionContext,
} from '../state-machine';

/** No variance anywhere: the guard's uninteresting case, so edges are the subject. */
const CLEAN: TransitionContext = {
  priceVarianceFlagged: false,
  customerConfirmedRevisedAmount: false,
};

/** Every edge the table declares, flattened to `from → to` pairs. */
const LEGAL = new Set(
  ORDER_STATUSES.flatMap((from) => TRANSITIONS[from].map((rule) => `${from}->${rule.to}`)),
);

describe('order state machine — the table', () => {
  it('covers every status', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...ORDER_STATUSES].sort());
    expect(ORDER_STATUSES).toHaveLength(12);
  });

  it('declares exactly the lifecycle from architecture §11', () => {
    const edges = [...LEGAL].sort();

    expect(edges).toEqual(
      [
        // The happy path, one step at a time.
        'PLACED->ACCEPTED',
        'ACCEPTED->PICKING',
        'PICKING->PICKED',
        'PICKED->BILLED_IN_POS',
        'BILLED_IN_POS->PACKED',
        'PACKED->OUT_FOR_DELIVERY',
        'OUT_FOR_DELIVERY->DELIVERED',
        'DELIVERED->CLOSED',
        // The audited store correction, from every pre-dispatch state.
        'PLACED->CANCELLED_BY_STORE',
        'ACCEPTED->CANCELLED_BY_STORE',
        'PICKING->CANCELLED_BY_STORE',
        'PICKED->CANCELLED_BY_STORE',
        'BILLED_IN_POS->CANCELLED_BY_STORE',
        'PACKED->CANCELLED_BY_STORE',
        // A failed delivery can be retried once or written off.
        'OUT_FOR_DELIVERY->DELIVERY_FAILED',
        'DELIVERY_FAILED->OUT_FOR_DELIVERY',
        'DELIVERY_FAILED->CLOSED_UNDELIVERED',
      ].sort(),
    );
  });

  it.each(['CLOSED', 'CANCELLED_BY_STORE', 'CLOSED_UNDELIVERED'] as const)(
    '%s is terminal',
    (status) => {
      expect(TRANSITIONS[status]).toEqual([]);
    },
  );

  it('gives every legal edge an event (R7)', () => {
    // D1/D7: a transition event for *every* edge. The first version emitted only
    // the four names the bus already declared and left the rest silent, which is
    // the omission this asserts against — a table entry with no event is now a
    // type error as well as a test failure.
    const silent = ORDER_STATUSES.flatMap((from) =>
      TRANSITIONS[from]
        .filter((rule) => (rule.emits as string | null) === null)
        .map((rule) => `${from}->${rule.to}`),
    );

    expect(silent).toEqual([]);
  });

  it('names every event distinctly per arrival state', () => {
    // Two edges may legitimately share an event — DELIVERY_FAILED and PACKED
    // both dispatch — but an arrival state must always announce the same thing,
    // or a subscriber cannot tell what happened from the name.
    const byArrival = new Map<OrderStatus, Set<string>>();
    for (const from of ORDER_STATUSES) {
      for (const rule of TRANSITIONS[from]) {
        const seen = byArrival.get(rule.to) ?? new Set<string>();
        seen.add(rule.emits);
        byArrival.set(rule.to, seen);
      }
    }

    for (const [arrival, events] of byArrival) {
      expect(events.size, `${arrival} announces more than one event`).toBe(1);
    }
  });

  it('lets nothing re-enter PLACED — an order is placed exactly once', () => {
    expect([...LEGAL].filter((edge) => edge.endsWith('->PLACED'))).toEqual([]);
  });

  it('has no customer-cancel edge anywhere (R4)', () => {
    // The only way out early is the audited store correction, and only staff
    // can reach `cancelByStore`. A `CANCELLED_BY_CUSTOMER` value does not exist
    // in the enum either — this asserts the table agrees.
    expect(ORDER_STATUSES).not.toContain('CANCELLED_BY_CUSTOMER' as OrderStatus);
    for (const edge of LEGAL) {
      expect(edge).not.toContain('CANCELLED_BY_CUSTOMER');
    }
  });

  it('stamps a timestamp on every arrival that has a column for it', () => {
    // `OUT_FOR_DELIVERY -> DELIVERY_FAILED` is the one edge with no column; a
    // retry re-stamps `dispatchedAt`, which is the intent (last dispatch wins).
    const unstamped = ORDER_STATUSES.flatMap((from) =>
      TRANSITIONS[from].filter((rule) => rule.stamps === null).map((rule) => `${from}->${rule.to}`),
    );

    expect(unstamped).toEqual(['OUT_FOR_DELIVERY->DELIVERY_FAILED']);
  });
});

describe('checkTransition — every pair, legal and illegal', () => {
  const pairs = ORDER_STATUSES.flatMap((from) => ORDER_STATUSES.map((to) => [from, to] as const));

  it('considers all 144 ordered pairs', () => {
    expect(pairs).toHaveLength(144);
  });

  it.each(pairs)('%s -> %s agrees with the table', (from, to) => {
    const check = checkTransition(from, to, CLEAN);

    if (LEGAL.has(`${from}->${to}`)) {
      expect(check.ok).toBe(true);
      // Narrowed, so the rule really is the one the table holds.
      if (check.ok) expect(check.rule.to).toBe(to);
    } else {
      expect(check.ok).toBe(false);
      if (!check.ok) expect(check.reason).toBe(`An order cannot go from ${from} to ${to}`);
    }
  });

  it('rejects a self-transition', () => {
    expect(checkTransition('PLACED', 'PLACED', CLEAN).ok).toBe(false);
  });

  it('rejects skipping a step', () => {
    expect(checkTransition('PLACED', 'PACKED', CLEAN).ok).toBe(false);
    expect(checkTransition('PLACED', 'DELIVERED', CLEAN).ok).toBe(false);
  });

  it('rejects going backwards', () => {
    expect(checkTransition('PICKED', 'PICKING', CLEAN).ok).toBe(false);
    expect(checkTransition('DELIVERED', 'OUT_FOR_DELIVERY', CLEAN).ok).toBe(false);
  });

  it('rejects cancelling once the order is with the rider', () => {
    for (const from of ['OUT_FOR_DELIVERY', 'DELIVERED', 'CLOSED', 'CLOSED_UNDELIVERED'] as const) {
      expect(checkTransition(from, 'CANCELLED_BY_STORE', CLEAN).ok).toBe(false);
    }
  });
});

describe('the variance guard on PACKED -> OUT_FOR_DELIVERY', () => {
  it('blocks a flagged order that nobody has confirmed', () => {
    const check = checkTransition('PACKED', 'OUT_FOR_DELIVERY', {
      priceVarianceFlagged: true,
      customerConfirmedRevisedAmount: false,
    });

    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toMatch(/confirm the revised amount/i);
  });

  it('allows it once the revised amount is confirmed', () => {
    expect(
      checkTransition('PACKED', 'OUT_FOR_DELIVERY', {
        priceVarianceFlagged: true,
        customerConfirmedRevisedAmount: true,
      }).ok,
    ).toBe(true);
  });

  it('allows an unflagged order whether or not anyone confirmed anything', () => {
    expect(
      checkTransition('PACKED', 'OUT_FOR_DELIVERY', {
        priceVarianceFlagged: false,
        customerConfirmedRevisedAmount: false,
      }).ok,
    ).toBe(true);
    expect(
      checkTransition('PACKED', 'OUT_FOR_DELIVERY', {
        priceVarianceFlagged: false,
        customerConfirmedRevisedAmount: true,
      }).ok,
    ).toBe(true);
  });

  it('does not gate the cancellation out of PACKED', () => {
    // A flagged order must still be correctable — the guard exists to stop it
    // going *out*, not to trap it.
    expect(
      checkTransition('PACKED', 'CANCELLED_BY_STORE', {
        priceVarianceFlagged: true,
        customerConfirmedRevisedAmount: false,
      }).ok,
    ).toBe(true);
  });
});

describe('assertTransition', () => {
  it('returns the rule for a legal edge', () => {
    expect(assertTransition('PLACED', 'ACCEPTED', CLEAN)).toMatchObject({
      to: 'ACCEPTED',
      stamps: 'acceptedAt',
    });
  });

  it('throws ConflictError for an illegal edge, carrying both states', () => {
    expect(() => assertTransition('CLOSED', 'ACCEPTED', CLEAN)).toThrow(ConflictError);
    try {
      assertTransition('CLOSED', 'ACCEPTED', CLEAN);
      expect.unreachable('an illegal edge must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).message).toContain('CLOSED');
    }
  });

  it('throws when the edge exists but its guard refuses', () => {
    expect(() =>
      assertTransition('PACKED', 'OUT_FOR_DELIVERY', {
        priceVarianceFlagged: true,
        customerConfirmedRevisedAmount: false,
      }),
    ).toThrow(ConflictError);
  });
});

describe('canCancelByStore', () => {
  it.each(['PLACED', 'ACCEPTED', 'PICKING', 'PICKED', 'BILLED_IN_POS', 'PACKED'] as const)(
    'allows a correction from %s',
    (from) => {
      expect(canCancelByStore(from)).toBe(true);
    },
  );

  it.each([
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'CLOSED',
    'CANCELLED_BY_STORE',
    'DELIVERY_FAILED',
    'CLOSED_UNDELIVERED',
  ] as const)('refuses a correction from %s', (from) => {
    expect(canCancelByStore(from)).toBe(false);
  });

  it('agrees with the table exactly', () => {
    for (const from of ORDER_STATUSES) {
      expect(canCancelByStore(from)).toBe(LEGAL.has(`${from}->CANCELLED_BY_STORE`));
    }
  });
});

describe('requiresDiscrepancyNote', () => {
  it('requires one once a POS bill exists', () => {
    expect(requiresDiscrepancyNote('BILLED_IN_POS')).toBe(true);
    expect(requiresDiscrepancyNote('PACKED')).toBe(true);
  });

  it('does not require one before billing', () => {
    expect(requiresDiscrepancyNote('PLACED')).toBe(false);
    expect(requiresDiscrepancyNote('PICKED')).toBe(false);
  });
});

describe('computeVariance', () => {
  const tolerance = { percentBp: 500, absCapPaise: 5000 };

  it('is not flagged when the POS total matches the estimate', () => {
    expect(
      computeVariance({ estimatedTotalPaise: 50_000, posFinalTotalPaise: 50_000, ...tolerance }),
    ).toEqual({ overagePaise: 0, thresholdPaise: 2500, flagged: false });
  });

  it('is not flagged when the POS total is lower — being charged less is not a discrepancy', () => {
    expect(
      computeVariance({ estimatedTotalPaise: 50_000, posFinalTotalPaise: 41_000, ...tolerance }),
    ).toMatchObject({ overagePaise: 0, flagged: false });
  });

  it('takes the percentage when it is the lower threshold', () => {
    // 5 % of ₹500 = ₹25 < the ₹50 cap.
    const result = computeVariance({
      estimatedTotalPaise: 50_000,
      posFinalTotalPaise: 52_000,
      ...tolerance,
    });

    expect(result).toEqual({ overagePaise: 2000, thresholdPaise: 2500, flagged: false });
  });

  it('takes the absolute cap when it is the lower threshold', () => {
    // 5 % of ₹5000 = ₹250, capped at ₹50 — a big basket cannot drift further
    // in absolute terms just because it is big.
    const result = computeVariance({
      estimatedTotalPaise: 500_000,
      posFinalTotalPaise: 506_000,
      ...tolerance,
    });

    expect(result).toEqual({ overagePaise: 6000, thresholdPaise: 5000, flagged: true });
  });

  it('is not flagged exactly at the threshold, and is one paise over it', () => {
    const at = computeVariance({
      estimatedTotalPaise: 50_000,
      posFinalTotalPaise: 52_500,
      ...tolerance,
    });
    const over = computeVariance({
      estimatedTotalPaise: 50_000,
      posFinalTotalPaise: 52_501,
      ...tolerance,
    });

    expect(at.flagged).toBe(false);
    expect(over.flagged).toBe(true);
  });

  it('floors the percentage threshold rather than admitting a fractional paise', () => {
    // 5 % of 1 paise is 0.05 — the threshold is 0, so any overage is flagged.
    expect(
      computeVariance({ estimatedTotalPaise: 1, posFinalTotalPaise: 2, ...tolerance }),
    ).toEqual({ overagePaise: 1, thresholdPaise: 0, flagged: true });
  });

  it('treats a zero tolerance as zero, not as "no limit"', () => {
    expect(
      computeVariance({
        estimatedTotalPaise: 50_000,
        posFinalTotalPaise: 50_001,
        percentBp: 0,
        absCapPaise: 0,
      }).flagged,
    ).toBe(true);
  });
});
