-- ADDON-41 rule 5: Admin › Payment settings is editable by finance and the owner (was owner only). Fresh 2FA and audit unchanged.
do $p$
declare f text; v_def text; v_new text;
begin
  foreach f in array array['save_company_bank_account(jsonb)', 'delete_company_bank_account(uuid)'] loop
    if to_regprocedure(f) is null then continue; end if;
    v_def := pg_get_functiondef(f::regprocedure);
    v_new := replace(v_def, 'if not is_admin() then raise exception ''FORBIDDEN: only an Admin can change the company bank accounts''; end if;',
                            'if not (is_admin() or can(''finance'', ''edit'')) then raise exception ''FORBIDDEN: only finance or the owner can change the company bank accounts''; end if;');
    if v_new = v_def then raise exception '% not patched', f; end if;
    execute v_new;
  end loop;
end $p$;
