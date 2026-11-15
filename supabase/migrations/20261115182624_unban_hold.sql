-- 1) Ban kaldırılınca, bandan önceki askıya alma geri gelir (account_moderation.suspended_before_ban).
-- 2) Yasal saklama (KVKK m.5/2-ç ve e; Silme Yönetmeliği m.7): saklamadaki ilan hesap silinince silinmez,
--    yalnız yayından kalkar. Saklama kaldırılınca, silinmiş hesabın ilanları 8 gün beklemeden bir sonraki
--    gece temizliğinde (periyodik imha) silinir. Diğer kişisel veriler hesap silinince hemen silinmeye devam eder.
begin;
alter table private.account_moderation add column suspended_before_ban boolean not null default false;

create or replace function public.nakgo_admin_moderate(p_kind text,p_target text,p_action text,p_reason text,p_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); target_user uuid; target_listing bigint; v bigint; desired boolean; current_state boolean; reason_value text:=btrim(coalesce(p_reason,''));
 m private.account_moderation; is_admin boolean; is_owner boolean;
begin
 if not private.is_nakgo_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 if p_revision is null or p_revision<0 or char_length(reason_value) not between 3 and 500 then raise exception 'Invalid moderation' using errcode='22023'; end if;
 if p_kind='user' and p_action in('suspend','resume','ban','unban','delete','grant_admin','revoke_admin') then
  if p_target!~'^[0-9a-f-]{36}$' then raise exception 'Invalid target' using errcode='22023'; end if;
  target_user:=p_target::uuid;
  if not exists(select 1 from public.profiles where id=target_user) then raise exception 'User unavailable' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_user::text,7290));
  -- Serialise administrator changes so the last administrator can never be removed by two admins at once.
  perform pg_catalog.pg_advisory_xact_lock(7291);
  select coalesce(bool_or(active),false),coalesce(bool_or(active and owner),false) into is_admin,is_owner from private.admin_members where user_id=target_user;
  if target_user=actor or is_owner then raise exception 'Protected administrator' using errcode='42501'; end if;
  if is_admin and p_action<>'revoke_admin' then raise exception 'Protected administrator' using errcode='42501'; end if;
  insert into private.account_moderation(user_id) values(target_user) on conflict do nothing;
  select * into m from private.account_moderation where user_id=target_user for update;v:=m.revision;
  if v<>p_revision then raise exception 'Moderation changed; refresh' using errcode='40001'; end if;
  if m.deleted_at is not null then raise exception 'Account deleted' using errcode='22023'; end if;
  if p_action in('suspend','resume') then
   desired:=p_action='suspend';
   if m.banned then raise exception 'Account banned' using errcode='22023'; end if;
   if m.suspended=desired then return jsonb_build_object('revision',v,'changed',false); end if;
   update private.account_moderation set suspended=desired,revision=v+1,reason=reason_value,updated_at=now() where user_id=target_user;
  elsif p_action in('ban','unban') then
   desired:=p_action='ban';
   if m.banned=desired then return jsonb_build_object('revision',v,'changed',false); end if;
   -- Ban kalkınca bandan önceki askıya alma durumu geri gelir.
   update private.account_moderation set banned=desired,
    suspended=case when desired then true else m.suspended_before_ban end,
    suspended_before_ban=case when desired then m.suspended else false end,
    revision=v+1,reason=reason_value,updated_at=now() where user_id=target_user;
   perform private.auth_lock(target_user,desired);
   if desired then update public.listings set status='closed' where owner_id=target_user and status='active'; end if;
  elsif p_action='delete' then
   update private.account_moderation set banned=true,suspended=true,deleted_at=now(),deleted_by_self=false,revision=v+1,reason=reason_value,updated_at=now() where user_id=target_user;
   perform private.erase_account(target_user);
  elsif p_action='grant_admin' then
   if is_admin then return jsonb_build_object('revision',v,'changed',false); end if;
   if m.suspended or m.banned or not exists(select 1 from auth.users where id=target_user and email_confirmed_at is not null) then raise exception 'Account not eligible' using errcode='22023'; end if;
   insert into private.admin_members(user_id,active,granted_at,granted_by) values(target_user,true,now(),actor)
    on conflict(user_id) do update set active=true,granted_at=now(),granted_by=actor;
   update private.account_moderation set revision=v+1,reason=reason_value,updated_at=now() where user_id=target_user;
  else
   if not is_admin then return jsonb_build_object('revision',v,'changed',false); end if;
   if (select count(*) from private.admin_members where active)<=1 then raise exception 'Last administrator' using errcode='42501'; end if;
   update private.admin_members set active=false where user_id=target_user;
   update private.account_moderation set revision=v+1,reason=reason_value,updated_at=now() where user_id=target_user;
  end if;
 elsif p_kind='listing' and p_action in('hold','release') then
  -- Legal hold: the nightly cleanup leaves this listing, its log and decisions untouched until released.
  if p_target!~'^[0-9]{1,15}$' then raise exception 'Invalid target' using errcode='22023'; end if;
  target_listing:=p_target::bigint;desired:=p_action='hold';
  perform 1 from public.listings where id=target_listing for update;
  if not found then raise exception 'Listing unavailable' using errcode='22023'; end if;
  insert into private.listing_moderation(listing_id) values(target_listing) on conflict do nothing;
  select revision,hold into v,current_state from private.listing_moderation where listing_id=target_listing for update;
  if v<>p_revision then raise exception 'Moderation changed; refresh' using errcode='40001'; end if;
  if current_state=desired then return jsonb_build_object('revision',v,'changed',false); end if;
  update private.listing_moderation set hold=desired,hold_reason=case when desired then reason_value else '' end,revision=v+1,updated_at=now() where listing_id=target_listing;
 elsif p_kind='listing' and p_action in('remove','restore') then
  if p_target!~'^[0-9]{1,15}$' then raise exception 'Invalid target' using errcode='22023'; end if;
  target_listing:=p_target::bigint;desired:=p_action='remove';
  perform 1 from public.listings where id=target_listing for update;
  if not found then raise exception 'Listing unavailable' using errcode='22023'; end if;
  insert into private.listing_moderation(listing_id) values(target_listing) on conflict do nothing;
  select revision,removed into v,current_state from private.listing_moderation where listing_id=target_listing for update;
  if v<>p_revision then raise exception 'Moderation changed; refresh' using errcode='40001'; end if;
  if current_state=desired then return jsonb_build_object('revision',v,'changed',false); end if;
  update private.listing_moderation set removed=desired,revision=v+1,reason=reason_value,updated_at=now() where listing_id=target_listing;
  -- Restore means unlock into closed state; never republish expired listings.
  update public.listings set status=case when desired then 'archived' else 'closed' end where id=target_listing;
 else raise exception 'Invalid action' using errcode='22023'; end if;
 insert into private.admin_audit(actor_id,target,action,reason,revision) values(actor,p_target,p_action,reason_value,v+1);
 return jsonb_build_object('revision',v+1,'changed',true);
end $$;
revoke all on function public.nakgo_admin_moderate(text,text,text,text,bigint) from public,anon;
grant execute on function public.nakgo_admin_moderate(text,text,text,text,bigint) to authenticated;

create or replace function private.erase_account(p_user uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform set_config('lock_timeout','10s',true);
 -- Erasure is not user activity: skip the activity guards only inside this transaction.
 alter table public.listings disable trigger moderation_listing;
 alter table public.profiles disable trigger moderation_profile;
 update public.listings l set status=case when l.status='active' then 'closed' else l.status end,note='',image_data='',contact_phone=null,contact_consent=false,
  owner_label='NakGo kullanıcısı',cargo=case when l.kind='load' then 'Silindi' else '' end,items='[]',
  loading_text=case when l.loading_text is not null then 'Silindi' end,from_district=null,to_district=null,redacted_at=coalesce(l.redacted_at,now())
 where l.owner_id=p_user
  and not exists(select 1 from private.listing_moderation m where m.listing_id=l.id and m.hold);
 -- Yasal saklamadaki ilan (KVKK m.5/2-ç,e): içerik korunur, yalnız yayından kalkar. Saklama kalkınca gece temizliği siler.
 update public.listings l set status='closed' where l.owner_id=p_user and l.status='active';
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
  and ((case when l.status='active' then l.expires_at else least(l.expires_at,l.updated_at) end)<now()-interval '8 days'
   or exists(select 1 from private.account_moderation am where am.user_id=l.owner_id and am.deleted_at is not null))
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
commit;
