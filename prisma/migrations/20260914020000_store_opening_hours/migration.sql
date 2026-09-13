-- Opening hours per store, as minutes after local midnight. The delivery-slot
-- grid offers only windows inside them (decision 2026-09-14: the published
-- "Daily 10 AM–8 PM" must be enforced, not copy). Defaults are those hours.
ALTER TABLE "StoreSettings"
  ADD COLUMN "openMinuteOfDay" INTEGER NOT NULL DEFAULT 600,
  ADD COLUMN "closeMinuteOfDay" INTEGER NOT NULL DEFAULT 1200;
