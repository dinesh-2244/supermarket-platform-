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
  getStorefrontSettings,
  getStore,
  isDeliverableArea,
  listAreas,
  listServiceableAreas,
  listStores,
  listZones,
  moduleDescriptor,
  resolveServiceability,
  slotGridFor,
  updateArea,
  updatePosMode,
  updateSettings,
  updateStore,
  type UpdateStoreInput,
  updateZone,
  type AreaRecord,
  type SettingsRecord,
  type StorefrontArea,
  type StorefrontSettings,
  type SlotGrid,
  type StoreRecord,
  type ZoneRecord,
} from './service';

export {
  EDITABLE_SETTINGS_FIELDS,
  type EditableSettingsField,
  normalizeLocality,
  pickEditableSettings,
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

export {
  isBookableSlot,
  localDayStart,
  SLOT_HORIZON_DAYS,
  SLOT_LEAD_MINUTES,
  slotEndOf,
  slotGrid,
  zoneOffsetMs,
  type Slot,
  type SlotGridInput,
} from './domain/slots';
