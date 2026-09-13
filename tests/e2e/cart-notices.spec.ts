import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * R1 — the notices a basket mutation produces, seen by the shopper who caused
 * them.
 *
 * These cannot be proved by asserting on a service's return value, because the
 * defect was *between* the service and the screen: the service reported the
 * price move correctly and the action threw the report away, and by the time the
 * page revalidated a second time the snapshot had already been brought up to
 * date and there was nothing left to report. Only a browser sees that.
 *
 * Two browser contexts on purpose. The shop assistant changing a price is a
 * different person in a different session, and doing it in the shopper's own
 * context would replace the customer cookie with a staff one — which is a
 * different test entirely (N1).
 */
const SEED_ADMIN = 'admin@munderfresh.local';
const SEED_PASSWORD = 'DevPassw0rd!';

/**
 * Products are addressed by SKU, not by name.
 *
 * The listings table's product cell holds the name *and* a "history" link, and
 * their text is concatenated into one accessible name with nothing between them
 * — so neither an exact name match nor a substring one is safe (a substring
 * would also match "Potato" against the "Potato Chips Classic" row). The SKU
 * cell contains exactly one thing.
 */
interface Fixture {
  readonly name: string;
  readonly sku: string;
}

/** Listed and stocked at S2, unlisted at S1 — and used by no other spec. */
const FIXTURE: Fixture = { name: 'Green Tea Bags', sku: '8901234500189' };

/** A second line, so a removal can leave something behind to report about. */
const COMPANION: Fixture = { name: 'Filter Coffee Powder', sku: '8901234500172' };

/**
 * Enough lines that their notices together run well past 600 characters.
 *
 * All listed and stocked at S2 by the seed. Deliberately not the two products
 * S2 leaves off its shelves, and not the low-stock fixture the back-office suite
 * adjusts.
 */
const BULK: readonly Fixture[] = [
  { name: 'Toor Dal', sku: '8901234500028' },
  { name: 'Whole Wheat Atta', sku: '8901234500035' },
  { name: 'Iodised Salt', sku: '8901234500059' },
  { name: 'Sugar', sku: '8901234500066' },
  { name: 'Banana Robusta', sku: '8901234500073' },
  { name: 'Tomato', sku: '8901234500080' },
  { name: 'Onion', sku: '8901234500097' },
  { name: 'Toned Milk', sku: '8901234500110' },
  { name: 'Curd', sku: '8901234500127' },
  { name: 'Marie Biscuits', sku: '8901234500165' },
];
/** Indiranagar is S2's area. */
const AREA = 'Indiranagar 1st Stage';

async function pickArea(page: Page, areaName: string): Promise<void> {
  await page.goto('/locality');
  await page
    .locator('form')
    .filter({ hasText: areaName })
    .getByRole('button', { name: 'Deliver here' })
    .click();
  await expect(page).toHaveURL(/\/$|\/\?/);
}

/** A second, staff-side browser: the shop changing its own mind about a price. */
async function openBackOffice(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/admin/sign-in');
  await page.getByLabel('Email').fill(SEED_ADMIN);
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin(\?|$)/);

  await selectFixtureStore(page);
  return page;
}

/**
 * Point the back office at the same shop the shopper is buying from.
 *
 * Navigated by the switcher's own href, so the store id stays out of this file —
 * it is a uuid the seed mints, and hardcoding one would tie the suite to the
 * database it was written against.
 *
 * The confirmation is the switcher's *selected* state, not the fixture's row.
 * The row is on both stores' pages (S1 carries the listing too, unlisted), so
 * asserting on it passes while the click's navigation is still in flight — which
 * is how this read S1's price for an S2 basket and reported a price that had not
 * moved.
 */
async function selectFixtureStore(admin: Page, product: Fixture = FIXTURE): Promise<void> {
  await admin.goto('/admin/listings');
  const link = admin.getByRole('link', { name: /^S2 · / });
  const href = await link.getAttribute('href');
  expect(href, 'the S2 switcher link').not.toBeNull();

  await admin.goto(href ?? '');
  await expect(admin.getByRole('link', { name: /^S2 · / })).toHaveAttribute('aria-current', 'page');
  await expect(listingRow(admin, product).first()).toBeVisible();
}

/**
 * The `<tr>` for one product on the listings page.
 *
 * Anchored on the whole cell, not a substring of it. The product cell also holds
 * a "history" link, so its accessible name is `<product> history` — which rules
 * out `exact: true`, and a bare substring would match "Potato" against the
 * "Potato Chips Classic" row and act on the wrong listing.
 */
function listingRow(admin: Page, product: Fixture = FIXTURE): ReturnType<Page['locator']> {
  return admin
    .locator('tr')
    .filter({ has: admin.getByRole('cell', { name: product.sku, exact: true }) });
}

/**
 * Each assertion is scoped to its own form's notice.
 *
 * The page's first `role="status"` is whichever form was submitted last, so a
 * price change straight after a listing change reads the listing change's
 * message and the helper reports a failure that never happened.
 */
interface Price {
  readonly mrpPaise: number;
  readonly sellingPricePaise: number;
}

function priceForm(admin: Page, product: Fixture = FIXTURE): ReturnType<Page['locator']> {
  return listingRow(admin, product).locator('form').filter({ hasText: 'Set price' });
}

async function currentPrice(admin: Page, product: Fixture = FIXTURE): Promise<Price> {
  const form = priceForm(admin, product);
  const mrpRupees = Number(await form.getByLabel('MRP (₹)').inputValue());
  const sellingRupees = Number(await form.getByLabel('Selling price (₹)').inputValue());
  return {
    mrpPaise: Math.round(mrpRupees * 100),
    sellingPricePaise: Math.round(sellingRupees * 100),
  };
}

/**
 * Both fields, in one submit.
 *
 * `setPrice` refuses a selling price above MRP, and the seed prices a listing at
 * a discount off its MRP — so raising the selling price alone is refused for a
 * reason that has nothing to do with what is being tested. Sending both together
 * also means a restore never passes through an invalid intermediate state.
 */
async function setPrice(admin: Page, price: Price, product: Fixture = FIXTURE): Promise<void> {
  const form = priceForm(admin, product);
  await form.getByLabel('MRP (₹)').fill((price.mrpPaise / 100).toFixed(2));
  await form.getByLabel('Selling price (₹)').fill((price.sellingPricePaise / 100).toFixed(2));
  await form.getByRole('button', { name: 'Set price' }).click();
  await expect(form.getByRole('status')).toContainText(/Price saved/i);
}

async function setListed(admin: Page, listed: boolean, product: Fixture = FIXTURE): Promise<void> {
  const form = listingRow(admin, product).locator('form').filter({ hasText: 'Listed' });
  const box = form.getByLabel('Listed');
  if (listed) await box.check();
  else await box.uncheck();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByRole('status')).toContainText(/saved|updated|listed/i);
}

/** Put the fixture back the way the seed left it, whatever the test did. */
async function restore(admin: Page, price: Price): Promise<void> {
  await selectFixtureStore(admin);
  await setListed(admin, true);
  await setPrice(admin, price);
}

async function addToBasket(page: Page, product: string): Promise<void> {
  await page.goto(`/search?q=${encodeURIComponent(product)}`);
  await page.locator('article a[href^="/p/"]').filter({ hasText: product }).first().click();
  await expect(page).toHaveURL(/\/p\//);
  const addForm = page.locator('form').filter({ hasText: 'Add to basket' });
  await addForm.getByRole('button', { name: 'Add to basket' }).click();
  await expect(addForm.getByRole('status')).toContainText(/in your basket/i);
}

async function addFixtureToBasket(page: Page): Promise<void> {
  await pickArea(page, AREA);
  await addToBasket(page, FIXTURE.name);
}

test.describe.serial('R1 — the shopper is told what the revalidation found', () => {
  /**
   * R1 residual — the notice used to die with the row that asked for it.
   *
   * The remove button's form is *inside* the row it removes, so a notice
   * returned from that action is unmounted by the very revalidation that
   * produced it. A shopper who removed one line was never told that another
   * line's price had moved — and the price had already been consumed, so no
   * later page load would tell them either.
   */
  test('removing one line still reports a price move on a line being kept', async ({
    page,
    browser,
  }) => {
    const admin = await openBackOffice(browser);
    const original = await currentPrice(admin);
    const raised = original.sellingPricePaise + 5_000;

    try {
      // Two lines: the one whose price will move, and the one to be removed.
      await addFixtureToBasket(page);
      await addToBasket(page, COMPANION.name);

      await page.goto('/cart');
      const kept = page.locator('li').filter({ hasText: FIXTURE.name });
      const doomed = page.locator('li').filter({ hasText: COMPANION.name });
      await expect(kept).toBeVisible();
      await expect(doomed).toBeVisible();

      await setPrice(admin, { mrpPaise: raised + 10_000, sellingPricePaise: raised });

      // Remove the *other* line. Its form disappears with it, which is the whole
      // point — the notice has to survive somewhere that is not that row.
      await doomed.locator('form').filter({ hasText: 'Remove' }).getByRole('button').click();

      await expect(doomed).toHaveCount(0);
      await expect(page.getByRole('status').filter({ hasText: /changed from/i })).toContainText(
        FIXTURE.name,
      );
      await expect(kept.getByText(`₹${(raised / 100).toFixed(2)} each`)).toBeVisible();
    } finally {
      await restore(admin, original);
      await admin.context().close();
    }
  });

  /**
   * R1 residual (round 3) — more notices than a header can hold.
   *
   * The round-2 transport was a cookie, and a cookie is a response header, so it
   * had a length limit and a basket with enough affected lines silently lost the
   * ones past it. Raising the limit moves the boundary rather than removing it,
   * which is why the evidence now lives on the cart row. This basket's combined
   * notice text is comfortably over the 600 characters that used to be the cut,
   * and **every** product must still be named.
   */
  test('names every affected line when the notices run past any header limit', async ({
    page,
    browser,
  }) => {
    test.slow();
    const admin = await openBackOffice(browser);
    const originals = new Map<Fixture, Price>();

    try {
      await pickArea(page, AREA);
      for (const product of BULK) await addToBasket(page, product.name);
      await page.goto('/cart');

      // Every line's price moves while the basket sits open.
      // One navigation: the listings page carries every product this store
      // sells, so the rows are all already on screen.
      await selectFixtureStore(admin, BULK[0] ?? FIXTURE);
      for (const product of BULK) {
        const before = await currentPrice(admin, product);
        originals.set(product, before);
        const raised = before.sellingPricePaise + 5_000;
        await setPrice(admin, { mrpPaise: raised + 10_000, sellingPricePaise: raised }, product);
      }

      // Remove one of them — the case that unmounts the submitting row.
      const removed = BULK[0]?.name ?? '';
      await page
        .locator('li')
        .filter({ hasText: removed })
        .locator('form')
        .filter({ hasText: 'Remove' })
        .getByRole('button')
        .click();

      await expect(page.locator('li').filter({ hasText: removed })).toHaveCount(0);

      // Each surviving product is named in full. Not most of them, and not the
      // first few plus a count — the failure this replaces cut a sentence
      // mid-word and dropped the last product entirely.
      const notice = page.getByRole('status').filter({ hasText: /changed from/i });
      for (const product of BULK.slice(1)) {
        await expect(notice, `${product.name} is named`).toContainText(product.name);
        await expect(
          notice.getByText(
            new RegExp(`${product.name} changed from .+ to .+ uses the new price`, 'i'),
          ),
          `${product.name}'s sentence is complete`,
        ).toBeVisible();
      }

      // …and the text really is past the old limit, so this passes on merit
      // rather than because the basket happened to be small.
      const text = (await notice.textContent()) ?? '';
      expect(text.length, 'the notice is longer than the old 600-character cut').toBeGreaterThan(
        600,
      );
    } finally {
      await selectFixtureStore(admin, BULK[0] ?? FIXTURE);
      for (const [product, price] of originals) {
        await setPrice(admin, price, product);
      }
      await admin.context().close();
    }
  });

  test('a removal that empties the basket still says what it found', async ({ page, browser }) => {
    const admin = await openBackOffice(browser);
    const original = await currentPrice(admin);

    try {
      await addFixtureToBasket(page);
      await addToBasket(page, COMPANION.name);
      await page.goto('/cart');

      // The companion is delisted, then the shopper removes the other line
      // themselves. The basket ends empty, with the least on screen to explain
      // itself and the most that needs explaining.
      await setListed(admin, false);
      await page
        .locator('li')
        .filter({ hasText: COMPANION.name })
        .locator('form')
        .filter({ hasText: 'Remove' })
        .getByRole('button')
        .click();

      await expect(page.getByText(/your basket is empty/i)).toBeVisible();
      await expect(
        page.getByRole('status').filter({ hasText: /no longer sold at your shop/i }),
      ).toContainText(FIXTURE.name);
    } finally {
      await restore(admin, original);
      await admin.context().close();
    }
  });

  test('a quantity change reports the price move it discovered', async ({ page, browser }) => {
    const admin = await openBackOffice(browser);
    const original = await currentPrice(admin);
    const raised = original.sellingPricePaise + 5_000;

    try {
      await addFixtureToBasket(page);

      // The basket is on screen, showing the old price, and then the shop
      // changes it. The order matters: loading /cart is itself a revalidation,
      // so a page opened *after* the change would consume the notice and this
      // would be testing nothing. A tab left open is the real case.
      await page.goto('/cart');
      const row = page.locator('li').filter({ hasText: FIXTURE.name });
      await expect(
        row.getByText(`₹${(original.sellingPricePaise / 100).toFixed(2)} each`),
      ).toBeVisible();

      // A price *rise* on purpose: being charged more without being told is the
      // half of this that actually costs the shopper something.
      await setPrice(admin, { mrpPaise: raised + 10_000, sellingPricePaise: raised });

      // The shopper knows nothing about any of that; they simply change the
      // quantity, on the page they were already looking at. This submission is
      // the *only* response that can tell them, because it is the one whose
      // revalidation consumed the difference — the re-render behind it finds an
      // already-updated snapshot and has nothing left to say.
      const incBtn = row.getByRole('button', { name: /increase quantity/i });
      await incBtn.click();

      // Basket level, not the row's own form. Every mutation's notices go to the
      // same place, because the remove button's form does not survive its own
      // action and two homes for one kind of message is how one of them rots.
      const notice = page.getByRole('status').filter({ hasText: /changed from/i });
      await expect(notice).toContainText(FIXTURE.name);
      await expect(notice).toContainText(/uses the new price/i);

      // …and the basket really is priced at the new price, not merely narrating.
      await page.goto('/cart');
      await expect(row.getByText(`₹${(raised / 100).toFixed(2)} each`)).toBeVisible();
    } finally {
      await restore(admin, original);
      await admin.context().close();
    }
  });

  test('a basket emptied by a delisting says what went, not just that it is empty', async ({
    page,
    browser,
  }) => {
    const admin = await openBackOffice(browser);
    const original = await currentPrice(admin);

    try {
      await addFixtureToBasket(page);
      await setListed(admin, false);

      await page.goto('/cart');
      // Both halves matter: the shop is honest that the basket is empty, and it
      // says where the thing the shopper chose actually went.
      await expect(page.getByText(/your basket is empty/i)).toBeVisible();
      await expect(
        page.getByRole('status').filter({ hasText: /no longer sold here/i }),
      ).toContainText(FIXTURE.name);
    } finally {
      await restore(admin, original);
      await admin.context().close();
    }
  });
});
