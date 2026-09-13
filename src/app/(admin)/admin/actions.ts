'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { signIn, signOut, requirePrincipal } from '@/auth';
import { isAppError, ValidationError } from '@/modules/platform';
import { safeNextPath } from '@/modules/admin';
import { MAX_PAISE, parseRupeesToPaise } from './price-parser';
import {
  changeOwnPassword,
  confirmTotpEnrolment,
  createUser,
  disableTotp,
  resetPassword,
  setUserActive,
  updateUser,
} from '@/modules/identity';
import {
  createArea,
  createStore,
  createZone,
  updateArea,
  updateSettings,
  updateStore,
  updateZone,
} from '@/modules/stores';
import {
  addProductImage,
  createCategory,
  listProductImages,
  createProduct,
  deactivateProduct,
  removeProductImage,
  reorderProductImages,
  updateCategory,
  updateProduct,
} from '@/modules/catalog';
import { setListed, setPrice } from '@/modules/pricing';
import { adjustStock, reconcileStock, runStockImport } from '@/modules/inventory';
import { confirmRevisedAmount, correctOrder } from '@/modules/orders';
import { updateProductRequestStatus, type ProductRequestStatus } from '@/modules/product-requests';

/**
 * Server actions for the back office.
 *
 * **Every one of these re-checks authorization.** `requirePrincipal()` reads the
 * session from the database on each call, and the module service it hands the
 * principal to runs `authorize(...)` itself. Middleware only redirects (it runs
 * on the edge with no database), and the layout only hides nav — neither is the
 * boundary. A POST straight at one of these actions from outside the UI hits the
 * same check as a click.
 *
 * Failures come back as a string rather than an exception so the screen can show
 * the real reason. A leading `!` marks an error, which is what `<Notice>` reads.
 */
type ActionState = string | undefined;

async function run(work: () => Promise<string>): Promise<string> {
  try {
    return await work();
  } catch (error) {
    // Domain errors carry a message meant for a person; anything else does not.
    if (isAppError(error)) return `!${error.message}`;
    throw error;
  }
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(form: FormData, key: string): string | undefined {
  const value = text(form, key);
  return value === '' ? undefined : value;
}

/**
 * Read a whole number, requiring the **entire** field to be one.
 *
 * `Number.parseInt` reads a leading prefix and stops: `'1.9'` became 1 and
 * `'10junk'` became 10, and the resulting integer then sailed through every
 * downstream domain check because by then it *was* a valid integer. Silently
 * turning a mistyped 1.9 into a stock movement of 1 is worse than refusing it.
 */
function int(form: FormData, key: string, label = key): number {
  const raw = text(form, key);
  if (raw === '') throw new ValidationError(`${label} is required`, { field: key });
  if (!/^[+-]?\d+$/.test(raw)) {
    throw new ValidationError(`${label} must be a whole number, not "${raw}"`, {
      field: key,
      value: raw,
    });
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > MAX_PAISE) {
    throw new ValidationError(`${label} is out of range`, { field: key, value: raw });
  }
  return value;
}

function checked(form: FormData, key: string): boolean {
  return form.get(key) !== null;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export async function signInAction(_state: ActionState, form: FormData): Promise<string> {
  const email = text(form, 'email');
  const password = text(form, 'password');
  const totp = text(form, 'totp');
  const next = text(form, 'next');

  try {
    await signIn('credentials', { email, password, totp, redirect: false });
  } catch {
    // One message for every failure — the form must not tell an attacker which
    // addresses have accounts.
    return '!That email and password do not match an active account.';
  }
  redirect(safeNextPath(next));
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/admin/sign-in' });
}

export async function changePasswordAction(_state: ActionState, form: FormData): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    await changeOwnPassword(principal, text(form, 'current'), text(form, 'next'));
    return 'Password changed. Your other sessions are unaffected.';
  });
}

/**
 * Finish enrolling a second factor.
 *
 * The secret arrives back in the form because nothing stored it: it was minted
 * when the page rendered and is only written once a code proves the
 * authenticator holds the same one.
 */
export async function enrolTotpAction(_state: ActionState, form: FormData): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    await confirmTotpEnrolment(principal, {
      secret: text(form, 'secret'),
      code: text(form, 'code'),
      password: text(form, 'password'),
    });
    revalidatePath('/admin/two-factor');
    return 'Two-factor authentication is on. You will need a code the next time you sign in.';
  });
}

export async function disableTotpAction(_state: ActionState, form: FormData): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    await disableTotp(principal, { code: text(form, 'code'), password: text(form, 'password') });
    revalidatePath('/admin/two-factor');
    return 'Two-factor authentication is off. Your password alone signs you in again.';
  });
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function createUserAction(_state: ActionState, form: FormData): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    const role = text(form, 'role');
    const storeId = optionalText(form, 'storeId') ?? null;
    const user = await createUser(principal, {
      email: text(form, 'email'),
      name: text(form, 'name'),
      password: text(form, 'password'),
      role: role === 'SUPER_ADMIN' || role === 'STORE_MANAGER' ? role : 'STORE_STAFF',
      storeId: role === 'SUPER_ADMIN' ? null : storeId,
    });
    revalidatePath('/admin/users');
    return `Created ${user.email}.`;
  });
}

export async function setUserActiveAction(_state: ActionState, form: FormData): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    const user = await setUserActive(principal, text(form, 'userId'), checked(form, 'isActive'));
    revalidatePath('/admin/users');
    return `${user.email} is now ${user.isActive ? 'active' : 'disabled'}.`;
  });
}

export async function updateUserRoleAction(_state: ActionState, form: FormData): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    const role = text(form, 'role');
    const user = await updateUser(principal, text(form, 'userId'), {
      role: role === 'SUPER_ADMIN' || role === 'STORE_MANAGER' ? role : 'STORE_STAFF',
      storeId: role === 'SUPER_ADMIN' ? null : (optionalText(form, 'storeId') ?? null),
    });
    revalidatePath('/admin/users');
    return `${user.email} is now ${user.role}. Their sessions were ended.`;
  });
}

export async function resetPasswordAction(_state: ActionState, form: FormData): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    await resetPassword(principal, text(form, 'userId'), text(form, 'password'));
    revalidatePath('/admin/users');
    return 'Password reset. Their sessions were ended.';
  });
}

// ---------------------------------------------------------------------------
// Stores, zones and areas
// ---------------------------------------------------------------------------

export async function createStoreAction(_state: ActionState, form: FormData): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    const store = await createStore(principal, {
      code: text(form, 'code'),
      name: text(form, 'name'),
      addressJson: {
        line1: text(form, 'line1'),
        city: text(form, 'city'),
        pincode: text(form, 'pincode'),
      },
    });
    revalidatePath('/admin/stores');
    return `Created ${store.code} · ${store.name}.`;
  });
}

export async function updateStoreAction(_state: ActionState, form: FormData): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    const store = await updateStore(principal, text(form, 'storeId'), {
      name: text(form, 'name'),
      isActive: checked(form, 'isActive'),
    });
    revalidatePath('/admin/stores');
    return `${store.code} updated.`;
  });
}

export async function updateSettingsAction(_state: ActionState, form: FormData): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    const substitutionPolicy = text(form, 'substitutionPolicy');
    await updateSettings(principal, text(form, 'storeId'), {
      deliveryFeePaise: int(form, 'deliveryFeePaise'),
      minOrderPaise: int(form, 'minOrderPaise'),
      slotLengthMinutes: int(form, 'slotLengthMinutes'),
      slotCapacity: int(form, 'slotCapacity'),
      priceVariancePercentBp: int(form, 'priceVariancePercentBp'),
      priceVarianceAbsCapPaise: int(form, 'priceVarianceAbsCapPaise'),
      lowStockThreshold: int(form, 'lowStockThreshold'),
      isAcceptingOrders: checked(form, 'isAcceptingOrders'),
      ...(substitutionPolicy === 'NONE' ||
      substitutionPolicy === 'ASK_CUSTOMER' ||
      substitutionPolicy === 'STAFF_DISCRETION'
        ? { substitutionPolicy }
        : {}),
    });
    revalidatePath('/admin/stores');
    return 'Settings saved.';
  });
}

export async function createZoneAction(_state: ActionState, form: FormData): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    const zone = await createZone(principal, {
      storeId: text(form, 'storeId'),
      name: text(form, 'name'),
    });
    revalidatePath('/admin/zones');
    return `Added zone ${zone.name}.`;
  });
}

export async function updateZoneAction(_state: ActionState, form: FormData): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    await updateZone(principal, text(form, 'zoneId'), { isActive: checked(form, 'isActive') });
    revalidatePath('/admin/zones');
    return 'Zone updated.';
  });
}

export async function createAreaAction(_state: ActionState, form: FormData): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    const hints = text(form, 'matchHints');
    const area = await createArea(principal, {
      zoneId: text(form, 'zoneId'),
      name: text(form, 'name'),
      pincode: optionalText(form, 'pincode') ?? null,
      matchHints: hints === '' ? [] : hints.split(',').map((hint) => hint.trim()),
    });
    revalidatePath('/admin/zones');
    return `Added area ${area.name}.`;
  });
}

export async function updateAreaAction(_state: ActionState, form: FormData): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    await updateArea(principal, text(form, 'areaId'), { isActive: checked(form, 'isActive') });
    revalidatePath('/admin/zones');
    return 'Area updated.';
  });
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export async function createCategoryAction(_state: ActionState, form: FormData): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    const category = await createCategory(principal, {
      name: text(form, 'name'),
      parentId: optionalText(form, 'parentId') ?? null,
    });
    revalidatePath('/admin/categories');
    return `Added ${category.name}.`;
  });
}

export async function updateCategoryAction(_state: ActionState, form: FormData): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    await updateCategory(principal, text(form, 'categoryId'), {
      isActive: checked(form, 'isActive'),
      parentId: optionalText(form, 'parentId') ?? null,
    });
    revalidatePath('/admin/categories');
    return 'Category updated.';
  });
}

export async function createProductAction(_state: ActionState, form: FormData): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    const product = await createProduct(principal, {
      sku: text(form, 'sku'),
      name: text(form, 'name'),
      packSize: text(form, 'packSize'),
      categoryId: text(form, 'categoryId'),
      brand: optionalText(form, 'brand') ?? null,
    });
    revalidatePath('/admin/products');
    return `Added ${product.name} (${product.sku}).`;
  });
}

export async function updateProductAction(_state: ActionState, form: FormData): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    const productId = text(form, 'productId');
    const isActive = checked(form, 'isActive');
    if (!isActive) {
      const product = await deactivateProduct(principal, productId);
      revalidatePath('/admin/products');
      return `${product.name} deactivated.`;
    }
    const product = await updateProduct(principal, productId, { isActive: true });
    revalidatePath('/admin/products');
    return `${product.name} activated.`;
  });
}

export async function deactivateProductAction(
  _state: ActionState,
  form: FormData,
): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    const product = await deactivateProduct(principal, text(form, 'productId'));
    revalidatePath('/admin/products');
    return `${product.name} deactivated.`;
  });
}

/** The full edit — name, brand, pack size and category, not just the toggle. */
export async function editProductAction(_state: ActionState, form: FormData): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    const productId = text(form, 'productId');
    const isActive = checked(form, 'isActive');
    const product = await updateProduct(principal, productId, {
      name: text(form, 'name'),
      brand: optionalText(form, 'brand') ?? null,
      packSize: text(form, 'packSize'),
      categoryId: text(form, 'categoryId'),
      ...(isActive ? { isActive: true } : {}),
    });
    if (!isActive) {
      await deactivateProduct(principal, productId);
    }
    revalidatePath('/admin/products');
    return `${product.name} saved.`;
  });
}

export async function addProductImageAction(_state: ActionState, form: FormData): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    await addProductImage(principal, text(form, 'productId'), {
      url: text(form, 'url'),
      alt: optionalText(form, 'alt') ?? null,
    });
    revalidatePath('/admin/products');
    return 'Image added.';
  });
}

export async function removeProductImageAction(
  _state: ActionState,
  form: FormData,
): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    await removeProductImage(principal, text(form, 'imageId'));
    revalidatePath('/admin/products');
    return 'Image removed.';
  });
}

/** Move one image up or down; the service rewrites every sort key in one tx. */
export async function moveProductImageAction(_state: ActionState, form: FormData): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    const productId = text(form, 'productId');
    const imageId = text(form, 'imageId');
    const direction = text(form, 'direction') === 'up' ? -1 : 1;

    const current = (await listProductImages(principal, productId)).map((image) => image.id);
    const index = current.indexOf(imageId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= current.length) return 'Already at the end.';

    const reordered = [...current];
    reordered[index] = current[target]!;
    reordered[target] = current[index]!;

    await reorderProductImages(principal, productId, reordered);
    revalidatePath('/admin/products');
    return 'Image moved.';
  });
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export async function setPriceAction(_state: ActionState, form: FormData): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();

    // The form displays/inputs rupees with decimals (MRP (₹) and Selling price (₹)).
    // If rupee inputs are present, strictly parse to integer paise before reading paise.
    if (form.has('mrp') && !form.has('mrpPaise')) {
      const paise = parseRupeesToPaise(text(form, 'mrp'), 'mrp', 'MRP');
      form.set('mrpPaise', String(paise));
    }

    if (form.has('sellingPrice') && !form.has('sellingPricePaise')) {
      const paise = parseRupeesToPaise(text(form, 'sellingPrice'), 'sellingPrice', 'Selling price');
      form.set('sellingPricePaise', String(paise));
    }

    await setPrice(principal, text(form, 'storeId'), text(form, 'productId'), {
      mrpPaise: int(form, 'mrpPaise', 'MRP'),
      sellingPricePaise: int(form, 'sellingPricePaise', 'Selling price'),
      reason: optionalText(form, 'reason') ?? null,
    });
    revalidatePath('/admin/listings');
    return 'Price saved.';
  });
}

export async function setListedAction(_state: ActionState, form: FormData): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    await setListed(
      principal,
      text(form, 'storeId'),
      text(form, 'productId'),
      checked(form, 'isListed'),
    );
    revalidatePath('/admin/listings');
    return 'Listing updated.';
  });
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export async function adjustStockAction(_state: ActionState, form: FormData): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    const result = await adjustStock(principal, {
      storeId: text(form, 'storeId'),
      productId: text(form, 'productId'),
      delta: int(form, 'delta', 'Change by'),
      note: optionalText(form, 'note') ?? null,
    });
    revalidatePath('/admin/inventory');
    return `Stock is now ${String(result.balanceAfter)}.`;
  });
}

export async function reconcileStockAction(_state: ActionState, form: FormData): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    const result = await reconcileStock(principal, {
      storeId: text(form, 'storeId'),
      productId: text(form, 'productId'),
      counted: int(form, 'counted', 'Counted quantity'),
      note: optionalText(form, 'note') ?? null,
    });
    revalidatePath('/admin/inventory');
    return result === null
      ? 'The count matched. Nothing to change.'
      : `Reconciled to ${String(result.balanceAfter)} (${String(result.delta)}).`;
  });
}

export async function importStockAction(_state: ActionState, form: FormData): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) return '!Choose a CSV file first.';

    const content = await file.text();
    const mode = text(form, 'mode') === 'delta' ? 'delta' : 'set';
    const result = await runStockImport(principal, {
      storeId: text(form, 'storeId'),
      filename: file.name,
      content,
      mode,
      byteLength: file.size,
      dryRun: checked(form, 'dryRun'),
    });

    revalidatePath('/admin/inventory');

    // Errors first, whatever the outcome. A dry run that found problems is not a
    // successful preview: reporting it as "0 row(s) would change" hid the very
    // reason the real import would be refused, and a mixed file previewed only
    // its valid rows although one bad row rejects the whole file.
    if (!result.ok) {
      const first = result.errors
        .slice(0, 3)
        .map((error) => `line ${String(error.line)}: ${error.message}`)
        .join('; ');
      const more = result.errors.length > 3 ? ` …and ${String(result.errors.length - 3)} more` : '';
      const lead =
        result.outcome === 'dry-run'
          ? 'Dry run — nothing was written, and this file would be refused'
          : 'Nothing was imported';
      return `!${lead} — ${String(result.errors.length)} problem(s). ${first}${more}`;
    }
    if (result.outcome === 'dry-run') {
      // The per-row diff, not just a count: "12 rows would change" is not enough
      // for anyone to decide whether to apply the file. Each line names the SKU
      // and what it would do to that item's stock.
      const preview = result.changes
        .slice(0, 25)
        .map(
          (change) =>
            `line ${String(change.line)} ${change.sku}: ${String(change.currentStock)} → ${String(
              change.newStock,
            )} (${change.delta > 0 ? '+' : ''}${String(change.delta)})`,
        )
        .join('\n');
      const more =
        result.changes.length > 25 ? `\n…and ${String(result.changes.length - 25)} more` : '';

      return (
        `Dry run — nothing was written. ${String(result.changes.length)} row(s) would change, ` +
        `${String(result.unchanged.length)} unchanged.` +
        (preview === '' ? '' : `\n${preview}${more}`)
      );
    }
    return `Imported ${String(result.applied)} row(s).`;
  });
}

/**
 * The audited store correction (D6, R4).
 *
 * The only way an order ends early, and the reason is mandatory — the service
 * refuses a blank one rather than this form doing it, so a POST straight at the
 * action is held to the same rule as a click. `order:cancel` is manager-only, so
 * a staff member reaching this gets a denial from the grant table.
 */
export async function cancelOrderAction(_state: ActionState, form: FormData): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    const orderId = text(form, 'orderId');
    const result = await correctOrder(
      principal,
      orderId,
      text(form, 'reason'),
      optionalText(form, 'discrepancyNote') ?? null,
    );

    revalidatePath('/admin/orders');
    revalidatePath(`/admin/orders/${orderId}`);

    if (result.restored.length === 0) {
      return `Order ${result.orderNumber} cancelled. No stock needed restoring.`;
    }
    const units = result.restored.reduce((sum, line) => sum + line.qty, 0);
    return `Order ${result.orderNumber} cancelled. Restored ${String(units)} unit(s) across ${String(result.restored.length)} line(s).`;
  });
}

/**
 * Record that the customer has agreed to a revised amount (D6, R6).
 *
 * This is the input to the `PACKED → OUT_FOR_DELIVERY` guard, not the guard —
 * the state machine owns that, and it stays shut until this is set.
 */
export async function confirmRevisedAmountAction(
  _state: ActionState,
  form: FormData,
): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    const orderId = text(form, 'orderId');
    await confirmRevisedAmount(principal, orderId);

    revalidatePath('/admin/orders');
    revalidatePath(`/admin/orders/${orderId}`);
    return 'Recorded — the order can now leave PACKED.';
  });
}

/**
 * Update the triage status of a product request (Phase 5.5).
 */
export async function updateProductRequestStatusAction(
  _state: ActionState,
  form: FormData,
): Promise<string> {
  return run(async () => {
    const principal = await requirePrincipal();
    const requestId = text(form, 'requestId');
    const toStatus = text(form, 'toStatus') as ProductRequestStatus;
    const note = optionalText(form, 'note');

    if (toStatus === 'DECLINED' && (!note || note.trim().length === 0)) {
      throw new ValidationError('Declining a request needs a reason');
    }

    await updateProductRequestStatus(principal, requestId, toStatus, note);
    revalidatePath('/admin/product-requests');
    return `Request status updated to ${toStatus}.`;
  });
}
