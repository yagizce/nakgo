-- Silinen hesaplarda ve 8 günlük temizlikte sahibin yazdığı serbest metin de silinir:
-- loading_text ("yükleme zamanı" metni) yer tutucuya çevrilir (CHECK null'a izin vermez), ilçeler boşaltılır.
-- Yasal saklama ve denetim kayıtları kuralları değişmez: yalnız bu üç alan listeye eklenir.
begin;
create or replace function private.erase_account(p_user uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform set_config('lock_timeout','10s',true);
 -- Erasure is not user activity: skip the activity guards only inside this transaction.
 alter table public.listings disable trigger moderation_listing;
 alter table public.profiles disable trigger moderation_profile;
 update public.listings l set status=case when l.status='active' then 'closed' else l.status end,note='',image_data='',contact_phone=null,contact_consent=false,
  owner_label='NakGo kullanıcısı',cargo=case when l.kind='load' then 'Silindi' else '' end,items='[]',
  loading_text=case when l.loading_text is not null then 'Silindi' end,from_district=null,to_district=null,redacted_at=coalesce(l.redacted_at,now())
 where l.owner_id=p_user;
 update public.profiles set display_name='Silinmiş hesap',city='',about='',phone='' where id=p_user;
 alter table public.listings enable trigger moderation_listing;
 alter table public.profiles enable trigger moderation_profile;
 delete from public.listing_favorites where user_id=p_user;
 delete from public.route_alerts where user_id=p_user;
 delete from public.listing_conversations where owner_id=p_user or guest_id=p_user;
 update public.transport_jobs set listing_snapshot=listing_snapshot-'cargo'-'owner'-'dateText',carrier_label='NakGo kullanıcısı' where owner_id=p_user or carrier_id=p_user;
 delete from public.carrier_document_files where owner_id=p_user;
 delete from public.carrier_applications where owner_id=p_user;
 update private.admin_members set active=false where user_id=p_user;
 update auth.users set email='silindi-'||p_user::text||'@nakgo.invalid',phone=null,raw_user_meta_data='{}'::jsonb where id=p_user;
 if to_regclass('auth.identities') is not null then execute 'delete from auth.identities where user_id=$1' using p_user; end if;
 perform private.auth_lock(p_user,true);
end $$;
revoke all on function private.erase_account(uuid) from public,anon,authenticated;

create or replace function private.retention_run() returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb:='{}'; n bigint;
begin
 -- One run at a time: a second concurrent call does nothing. Every step below is also safe to repeat.
 if not pg_catalog.pg_try_advisory_xact_lock(7300) then return jsonb_build_object('skipped',true); end if;
 perform set_config('lock_timeout','10s',true);
 -- Cleanup writes are not user activity: skip the user guards only inside this transaction.
 alter table public.listings disable trigger listings_write_guard, disable trigger moderation_listing;
 update public.listings l set note='',image_data='',contact_phone=null,contact_consent=false,
  owner_label='NakGo kullanıcısı',cargo=case when l.kind='load' then 'Silindi' else '' end,items='[]',
  loading_text=case when l.loading_text is not null then 'Silindi' end,from_district=null,to_district=null,redacted_at=now()
 where l.redacted_at is null
  and (case when l.status='active' then l.expires_at else least(l.expires_at,l.updated_at) end)<now()-interval '8 days'
  and not exists(select 1 from private.listing_moderation m where m.listing_id=l.id and (m.hold or (m.removed and m.updated_at>=now()-interval '1 year')));
 get diagnostics n=row_count; c:=c||jsonb_build_object('listings_redacted',n);
 alter table public.listings enable trigger listings_write_guard, enable trigger moderation_listing;
 delete from public.listings l where l.redacted_at<now()-interval '1 year' and not exists(select 1 from private.listing_moderation m where m.listing_id=l.id and m.hold);
 get diagnostics n=row_count; c:=c||jsonb_build_object('listings_deleted',n);

 update public.transport_jobs set listing_snapshot=listing_snapshot-'cargo'-'owner'-'dateText',carrier_label='NakGo kullanıcısı'
 where (listing_snapshot?'cargo' or listing_snapshot?'owner' or listing_snapshot?'dateText' or carrier_label<>'NakGo kullanıcısı')
  and (((status in('no','withdrawn') or stage=3) and updated_at<now()-interval '30 days')
   or (status='wait' and expires_at<now()-interval '30 days'));
 get diagnostics n=row_count; c:=c||jsonb_build_object('jobs_redacted',n);

 delete from public.listing_conversations;
 get diagnostics n=row_count; c:=c||jsonb_build_object('conversations_deleted',n);

 delete from private.admin_audit a where a.created_at<now()-interval '1 year' and not exists(select 1 from private.listing_moderation m where m.hold and m.listing_id::text=a.target);
 get diagnostics n=row_count; c:=c||jsonb_build_object('admin_audit_deleted',n);
 delete from private.account_moderation where not suspended and deleted_at is null and updated_at<now()-interval '1 year';
 get diagnostics n=row_count; c:=c||jsonb_build_object('account_moderation_deleted',n);
 delete from private.listing_moderation where not removed and not hold and updated_at<now()-interval '1 year';
 get diagnostics n=row_count; c:=c||jsonb_build_object('listing_moderation_deleted',n);

 -- Deleted accounts: the anonymised remainder goes one year after deletion (cascades to profile and listings).
 delete from auth.users u where u.id in(select user_id from private.account_moderation where deleted_at<now()-interval '1 year')
  and not exists(select 1 from public.listings l join private.listing_moderation m on m.listing_id=l.id where l.owner_id=u.id and m.hold);
 get diagnostics n=row_count; c:=c||jsonb_build_object('accounts_purged',n);
 delete from private.access_log a where a.at<now()-interval '1 year' and not exists(select 1 from private.listing_moderation m where m.hold and m.listing_id=a.listing_id);
 get diagnostics n=row_count; c:=c||jsonb_build_object('access_log_deleted',n);
 delete from private.retention_runs where ran_at<now()-interval '3 years';
 insert into private.retention_runs(counts) values(c);
 return c;
end $$;
revoke all on function private.retention_run() from public,anon,authenticated;

-- Daha önce temizlenmiş satırlar (koruma tetikleyicileri retention_run'daki gibi yalnız bu işlemde kapalı).
alter table public.listings disable trigger listings_write_guard, disable trigger moderation_listing;
update public.listings set loading_text=case when loading_text is not null then 'Silindi' end,from_district=null,to_district=null
 where redacted_at is not null and (loading_text is distinct from case when loading_text is not null then 'Silindi' end or from_district is not null or to_district is not null);
alter table public.listings enable trigger listings_write_guard, enable trigger moderation_listing;
commit;
