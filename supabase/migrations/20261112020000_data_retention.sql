-- Data retention by legal periods. One daily job (03:00 Istanbul) runs private.retention_run():
--  * ended listings: personal fields cleared 8 days after the end (KVKK m.7);
--    a moderated listing is held 1 year first; cleared rows are deleted after 1 more year;
--  * closed transport jobs: names and cargo text removed from the snapshot after 30 days;
--  * retired in-app messaging: conversations and messages deleted;
--  * moderation/admin records: 1 year after they were closed;
--  * access log (login, listing create/update with IP): kept 1 year (5651 m.5/3);
--  * run log (counts only, no content): kept 3 years.
begin;
alter table public.listings add column redacted_at timestamptz;
-- No column grant: clients cannot read or write redacted_at. A cleared listing is gone for its owner too.
alter policy listings_read on public.listings using(
 (owner_id=(select auth.uid()) and redacted_at is null) or (status='active' and expires_at>now()
  and (loading_text is not null or coalesce(available_until,available_on)>=(now() at time zone 'Europe/Istanbul')::date)));
alter policy listings_update_own on public.listings using(owner_id=(select auth.uid()) and redacted_at is null);

create table private.access_log (
 id bigint generated always as identity primary key,
 at timestamptz not null default now(),
 user_id uuid,
 action text not null check(action in ('login','listing_create','listing_update')),
 ip inet
);
create index access_log_at on private.access_log(at);
create table private.retention_runs (
 id bigint generated always as identity primary key,
 ran_at timestamptz not null default now(),
 counts jsonb not null
);
create index retention_runs_at on private.retention_runs(ran_at);
alter table private.access_log enable row level security;
alter table private.retention_runs enable row level security;
revoke all on private.access_log,private.retention_runs from public,anon,authenticated;

-- Client IP as forwarded to PostgREST; null when absent or malformed.
create function private.request_ip() returns inet language plpgsql stable set search_path='' as $$
declare h json; v text;
begin
 h:=nullif(current_setting('request.headers',true),'')::json;
 v:=btrim(coalesce(h->>'cf-connecting-ip',split_part(h->>'x-forwarded-for',',',1),h->>'x-real-ip'));
 return nullif(v,'')::inet;
exception when others then return null;
end $$;

create function private.log_listing_write() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is not null then
  insert into private.access_log(user_id,action,ip)
  values(auth.uid(),case tg_op when 'INSERT' then 'listing_create' else 'listing_update' end,private.request_ip());
 end if;
 return null;
end $$;
create trigger listings_access_log after insert or update on public.listings
 for each row execute function private.log_listing_write();

-- Sign-ins are recorded from Auth sessions. A logging failure must never block a sign-in.
create function private.log_login() returns trigger language plpgsql security definer set search_path='' as $$
begin
 begin
  insert into private.access_log(at,user_id,action,ip) values(coalesce(new.created_at,now()),new.user_id,'login',new.ip);
 exception when others then null;
 end;
 return null;
end $$;
do $$ begin
 if to_regclass('auth.sessions') is not null then
  create trigger nakgo_access_log after insert on auth.sessions for each row execute function private.log_login();
 end if;
end $$;

create function private.retention_run() returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb:='{}'; n bigint;
begin
 perform set_config('lock_timeout','10s',true);
 -- Cleanup writes are not user activity: skip the user guards only inside this transaction.
 alter table public.listings disable trigger listings_write_guard, disable trigger moderation_listing;
 update public.listings l set note='',image_data='',contact_phone=null,contact_consent=false,
  owner_label='NakGo kullanıcısı',cargo=case when l.kind='load' then 'Silindi' else '' end,items='[]',redacted_at=now()
 where l.redacted_at is null
  and (case when l.status='active' then l.expires_at else least(l.expires_at,l.updated_at) end)<now()-interval '8 days'
  and not exists(select 1 from private.listing_moderation m where m.listing_id=l.id and m.removed and m.updated_at>=now()-interval '1 year');
 get diagnostics n=row_count; c:=c||jsonb_build_object('listings_redacted',n);
 alter table public.listings enable trigger listings_write_guard, enable trigger moderation_listing;
 delete from public.listings where redacted_at<now()-interval '1 year';
 get diagnostics n=row_count; c:=c||jsonb_build_object('listings_deleted',n);

 update public.transport_jobs set listing_snapshot=listing_snapshot-'cargo'-'owner'-'dateText',carrier_label='NakGo kullanıcısı'
 where (listing_snapshot?'cargo' or listing_snapshot?'owner' or listing_snapshot?'dateText' or carrier_label<>'NakGo kullanıcısı')
  and (((status in('no','withdrawn') or stage=3) and updated_at<now()-interval '30 days')
   or (status='wait' and expires_at<now()-interval '30 days'));
 get diagnostics n=row_count; c:=c||jsonb_build_object('jobs_redacted',n);

 delete from public.listing_conversations;
 get diagnostics n=row_count; c:=c||jsonb_build_object('conversations_deleted',n);

 delete from private.admin_audit where created_at<now()-interval '1 year';
 get diagnostics n=row_count; c:=c||jsonb_build_object('admin_audit_deleted',n);
 delete from private.account_moderation where not suspended and updated_at<now()-interval '1 year';
 get diagnostics n=row_count; c:=c||jsonb_build_object('account_moderation_deleted',n);
 delete from private.listing_moderation where not removed and updated_at<now()-interval '1 year';
 get diagnostics n=row_count; c:=c||jsonb_build_object('listing_moderation_deleted',n);

 delete from private.access_log where at<now()-interval '1 year';
 get diagnostics n=row_count; c:=c||jsonb_build_object('access_log_deleted',n);
 delete from private.retention_runs where ran_at<now()-interval '3 years';
 insert into private.retention_runs(counts) values(c);
 return c;
end $$;
revoke all on function private.request_ip(),private.log_listing_write(),private.log_login(),private.retention_run() from public,anon,authenticated;

-- 00:00 UTC = 03:00 Istanbul. Local test databases have no pg_cron and skip the schedule.
do $$ begin
 if exists(select 1 from pg_available_extensions where name='pg_cron') then
  create extension if not exists pg_cron;
  perform cron.schedule('nakgo-retention','0 0 * * *','select private.retention_run()');
 end if;
end $$;
commit;
