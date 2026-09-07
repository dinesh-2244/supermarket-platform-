/**
 * `stores` — public surface. Owns: Store, StoreSettings, DeliveryZone,
 * DeliveryArea and `resolveServiceability`.
 *
 * This file is the ONLY entry point other modules and `app/` may import;
 * `service.ts`, `repo.ts` and `domain/` are module-private.
 */
export {
  captureServiceabilityRequest,
  createArea,
  createStore,
  type CreateStoreInput,
  createZone,
  getSettings,
  getStore,
  listAreas,
  listStores,
  listZones,
  moduleDescriptor,
  resolveServiceability,
  updateArea,
  updatePosMode,
  updateSettings,
  updateStore,
  type UpdateStoreInput,
  updateZone,
  type AreaRecord,
  type SettingsRecord,
  type StoreRecord,
  type ZoneRecord,
} from './service';

export {
  normalizeLocality,
  normalizePincode,
  resolveServiceabilityFrom,
  type AreaCandidate,
  type EditableSettings,
  type ModuleDescriptor,
  type ServiceabilityInput,
  type ServiceabilityResult,
  type ServiceableResult,
  type UnserviceableResult,
} from './domain/index';
