-- Catalogue search (D3). Additive: an extension and two indexes, no table change.
--
-- `pg_trgm` gives trigram similarity, which is what makes a typed "basmti" find
-- "Basmati Rice" without an external search service. The GIN indexes are what
-- keep `ILIKE '%…%'` and `similarity()` off a sequential scan as the catalogue
-- grows; without them the query plan is a full table scan on every keystroke.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Product_name_trgm_idx" ON "Product" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_brand_trgm_idx" ON "Product" USING GIN ("brand" gin_trgm_ops);
