-- Link a security to a bond instrument (docs/specs/polish-retail-bonds.md
-- section 12.1). A linked security is priced by the bond engine and never by a
-- quote provider; the link is refused unless the two currencies agree
-- (INV-PRICE-001), which the application checks in the write's own transaction.
--
-- bond_instruments is global reference data that a user backup does not carry,
-- so the restore keeps this column only where the instrument exists on the
-- target deployment and writes NULL otherwise (backend/src/backup).
--
-- Expand only: one nullable column, no default, nothing reads it until the
-- writer ships. ON DELETE RESTRICT keeps an instrument from being deleted from
-- under a security that points at it. The partial index serves the daily
-- fan-out ("every linked security") and the RESTRICT check.
ALTER TABLE securities
  ADD COLUMN IF NOT EXISTS bond_instrument_id UUID NULL;

ALTER TABLE securities
  DROP CONSTRAINT IF EXISTS fk_securities_bond_instrument;
ALTER TABLE securities
  ADD CONSTRAINT fk_securities_bond_instrument
  FOREIGN KEY (bond_instrument_id) REFERENCES bond_instruments(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_securities_bond_instrument
  ON securities(bond_instrument_id)
  WHERE bond_instrument_id IS NOT NULL;
