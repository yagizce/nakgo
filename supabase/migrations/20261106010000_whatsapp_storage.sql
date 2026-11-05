-- Future tuples only; retain complete source, permission and audit evidence.
begin;
do $patch$
declare original text;changed text;needle text;replacement text;
begin
 if (select encode(sha256(convert_to(replace(prosrc,chr(13)||chr(10),chr(10)),'UTF8')),'hex') from pg_proc where oid='private.wa_change_core(bigint,integer,text,jsonb,text)'::regprocedure)<>'f755f4fe09be9be03b9b5a46c6e4cc1432c0208359a34426941f991b4ac19397' then raise exception 'Reviewed validator body changed';end if;
 original:=pg_get_functiondef('private.wa_change_core(bigint,integer,text,jsonb,text)'::regprocedure);
 changed:=original;
 foreach needle in array array[
  'update private.wa_drafts set fields=f,status=''published'',listing_id=listing,legal_basis=btrim(p_basis),reviewed_by=auth.uid(),reviewed_at=now() where id=d.id;',
  'update private.wa_drafts set status=case when p_action=''withdraw'' then ''withdrawn'' else ''rejected'' end where id=d.id;',
  'update private.wa_drafts set fields=f,status=''draft'',legal_basis=null,reviewed_by=null,reviewed_at=null where id=d.id;'
 ] loop
  if (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 then raise exception 'Unexpected reviewed draft mutation';end if;
  replacement:=replace(needle,' where id=d.id;',',revision=revision+1,updated_at=now() where id=d.id returning * into d;');
  changed:=replace(changed,needle,replacement);
 end loop;
 needle:='update private.wa_drafts set revision=revision+1,updated_at=now() where id=d.id returning * into d;';
 if (length(changed)-length(replace(changed,needle,'')))/length(needle)<>1 then raise exception 'Unexpected reviewed revision mutation';end if;
 changed:=replace(changed,needle,'');
 -- All validators, actor checks, consent rules and before/after audit remain byte-identical.
 execute changed;
end $patch$;
-- Avoid storing medium JSON uncompressed merely because it is below 2 KB.
-- PostgreSQL compresses new tuples; no old data rewrite, row deletion or audit shortening.
alter table private.wa_drafts set (toast_tuple_target=1024);
alter table private.wa_audit set (toast_tuple_target=1024);
-- Cover still-active WhatsApp listings that predate the dedupe-key migration.
-- Cache metadata only: preserve all existing publications and all existing keys.
insert into private.wa_publication_keys(fingerprint,listing_id,expires_at)
 select distinct on (private.wa_listing_key(l)) private.wa_listing_key(l),l.id,l.expires_at
 from public.listings l where l.status='active' and l.expires_at>statement_timestamp()
 and exists(select 1 from private.wa_drafts d where d.listing_id=l.id and d.status='published')
 order by private.wa_listing_key(l),l.published_at,l.id
 on conflict(fingerprint) do nothing;
commit;
