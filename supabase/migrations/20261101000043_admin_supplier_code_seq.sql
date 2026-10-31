-- Seeded suppliers used explicit codes (OCT-1101 … OCT-1129) without advancing seq_supplier_code,
-- so the first supplier created in Admin collided with OCT-1101. Move the sequence past the highest code.
select setval('seq_supplier_code',
  greatest((select coalesce(max(nullif(regexp_replace(code, '\D', '', 'g'), '')::bigint), 1100) from suppliers), 1100) + 1, false);
