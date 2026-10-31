-- SPEC §15.2 — Postman API partner card on Admin › Integrations.
-- Non-secret config only (workspace + collection IDs). POSTMAN_API_KEY lives in the server env / Supabase Vault.
insert into integrations(code, name, kind, mode, status, config)
values ('postman', 'Postman API Network', 'api_partner', 'live', 'not_configured',
        '{"workspace_id": null, "collection_ids": {"public_v1": null, "supplier_v1": null}, "monitor_id": null}'::jsonb)
on conflict (code) do nothing;
