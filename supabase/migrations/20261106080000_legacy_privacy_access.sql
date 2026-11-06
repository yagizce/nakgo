begin;
-- Existing general-admin user browsing must respect the new privacy scope too.
do $$ declare definition text;needle text:='elsif p_section=''users'' then';begin
 definition:=pg_get_functiondef('public.nakgo_admin_page(text,integer,text)'::regprocedure);
 if strpos(definition,needle)=0 then raise exception 'Unexpected admin user branch';end if;
 execute replace(definition,needle,needle||E'\n if not exists(select 1 from private.data_access_grants where user_id=auth.uid() and capability=''privacy_cases'') then raise exception ''Privacy access denied'' using errcode=''42501'';end if;');
end $$;
commit;
