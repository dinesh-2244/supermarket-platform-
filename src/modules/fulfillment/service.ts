/**
 * Use-cases for `fulfillment`. Services open transactions, enforce authorization and
 * emit domain events; they are the only thing `index.ts` exposes.
 *
 * Phase 1 is a skeleton — this module emits order.picked, order.billed, order.delivered once its use-cases exist.
 */
import { descriptor, type ModuleDescriptor } from './domain/index';

/** What this module owns and is allowed to depend on (§4). */
export function moduleDescriptor(): ModuleDescriptor {
  return descriptor;
}
