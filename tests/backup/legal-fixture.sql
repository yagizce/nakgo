-- B7-A3 testleri için #125 (b25013e, 20261117000000_legal_archive.sql) yasal tablolarının sentetik kopyası.
-- Tablo yapıları, hash fonksiyonu, zincir tetikleyicisi, değişmezlik korumaları ve imha mantığı birebir alınmıştır.
-- Farklar yalnız test edilebilirlik içindir: auth.uid() yerine açık parametre, now() yerine p_now (saat simülasyonu).
-- Gerçek veri yoktur; production ya da DEV'e uygulanmaz.
create schema if not exists private;
create table private.retention_runs (id bigint generated always as identity primary key, ran_at timestamptz not null default now(), counts jsonb not null);
create table private.legal_policies (
 code text primary key check(code ~ '^[a-z_]{3,40}$'),
 label text not null, legal_record boolean not null,
 retain_days integer check(retain_days between 1 and 36500),
 basis text not null default '', approved_by uuid, approved_at timestamptz
);
create table private.legal_records (
 id bigint generated always as identity primary key,
 policy text not null references private.legal_policies(code),
 listing_id bigint, user_id uuid,
 reason text not null, basis text not null default '', request_no text not null default '', contact_basis text not null default '',
 opened_by uuid not null, opened_at timestamptz not null default now(),
 status text not null default 'open' check(status in('open','closed')),
 closed_by uuid, closed_at timestamptz, close_reason text,
 snapshot jsonb not null, snapshot_sha256 text not null check(snapshot_sha256 ~ '^[0-9a-f]{64}$'),
 check(listing_id is not null or user_id is not null),
 check((status='closed')=(closed_at is not null and closed_by is not null and close_reason is not null))
);
create table private.legal_holds (
 id bigint generated always as identity primary key,
 record_id bigint not null references private.legal_records(id) on delete cascade,
 scope text not null check(scope in('listing','user')), listing_id bigint, user_id uuid, reason text not null,
 opened_by uuid not null, opened_at timestamptz not null default now(),
 released_by uuid, released_at timestamptz, release_reason text
);
create sequence private.legal_access_log_id;
create table private.legal_access_log (
 id bigint primary key, at timestamptz not null default now(), actor uuid, action text not null, record_id bigint,
 detail jsonb not null default '{}', prev_hash text not null, row_hash text not null
);
create sequence private.legal_destructions_id;
create table private.legal_destructions (
 id bigint primary key, at timestamptz not null default now(), record_no bigint not null, policy text not null, retain_days integer not null,
 opened_month date not null, closed_month date not null, holds_removed integer not null,
 cause text not null check(cause in('retention_expired','manual_expired')), actor uuid,
 check((cause='retention_expired')=(actor is null)), prev_hash text not null, row_hash text not null
);
create function private.legal_hash(j jsonb) returns text language sql immutable set search_path='' as $$
 select encode(pg_catalog.sha256(convert_to((j-'row_hash')::text,'UTF8')),'hex')
$$;
create function private.legal_chain() returns trigger language plpgsql security definer set search_path='' set timezone='UTC' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(7310,case when tg_table_name='legal_access_log' then 1 else 2 end);
 if tg_table_name='legal_access_log' then
  new.id:=nextval('private.legal_access_log_id');
  new.prev_hash:=coalesce((select row_hash from private.legal_access_log order by id desc limit 1),'');
 else
  new.id:=nextval('private.legal_destructions_id');
  new.prev_hash:=coalesce((select row_hash from private.legal_destructions order by id desc limit 1),'');
 end if;
 new.row_hash:='';
 new.row_hash:=private.legal_hash(to_jsonb(new));
 return new;
end $$;
create function private.legal_append_only() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' and current_setting('nakgo.legal_purge',true)='on' then return old; end if;
 raise exception 'Append-only legal table' using errcode='42501';
end $$;
create function private.legal_record_guard() returns trigger language plpgsql set search_path='' as $$
declare fixed text[]:=array['status','closed_by','closed_at','close_reason'];
begin
 if tg_op='DELETE' then
  if current_setting('nakgo.legal_purge',true)='on' then return old; end if;
  raise exception 'Legal records are removed only by destruction' using errcode='42501';
 end if;
 if old.status<>'open' or new.status<>'closed' or (to_jsonb(new)-fixed)<>(to_jsonb(old)-fixed) then
  raise exception 'Legal record is immutable' using errcode='42501';
 end if;
 return new;
end $$;
create function private.legal_hold_guard() returns trigger language plpgsql set search_path='' as $$
declare fixed text[]:=array['released_by','released_at','release_reason'];
begin
 if tg_op='DELETE' then
  if current_setting('nakgo.legal_purge',true)='on' then return old; end if;
  raise exception 'Legal holds are removed only by destruction' using errcode='42501';
 end if;
 if old.released_at is not null or new.released_at is null or (to_jsonb(new)-fixed)<>(to_jsonb(old)-fixed) then
  raise exception 'Legal hold is immutable' using errcode='42501';
 end if;
 return new;
end $$;
create trigger legal_access_log_chain before insert on private.legal_access_log for each row execute function private.legal_chain();
create trigger legal_destructions_chain before insert on private.legal_destructions for each row execute function private.legal_chain();
create trigger legal_access_log_append before update or delete on private.legal_access_log for each row execute function private.legal_append_only();
create trigger legal_destructions_append before update or delete on private.legal_destructions for each row execute function private.legal_append_only();
create trigger legal_records_guard before update or delete on private.legal_records for each row execute function private.legal_record_guard();
create trigger legal_holds_guard before update or delete on private.legal_holds for each row execute function private.legal_hold_guard();

insert into private.legal_policies(code,label,legal_record,retain_days,basis,approved_by,approved_at) values
 ('legal_access_log','Yasal erişim günlüğü',false,30,'test',gen_random_uuid(),'2026-01-01Z'),
 ('destruction_record','İmha tutanağı',false,365,'test',gen_random_uuid(),'2026-01-01Z'),
 ('court_order','Mahkeme talebi',true,10,'test',gen_random_uuid(),'2026-01-01Z'),
 ('pending_policy','Onay bekleyen',true,10,'test',null,null);

create function private.legal_log(p_action text,p_record bigint,p_at timestamptz) returns void language sql set search_path='' as $$
 insert into private.legal_access_log(at,action,record_id,prev_hash,row_hash) values(p_at,p_action,p_record,'','');
$$;
create function private.t_open(p_policy text,p_at timestamptz) returns bigint language plpgsql set search_path='' as $$
declare s jsonb:=jsonb_build_object('listing',pg_catalog.gen_random_uuid()); rid bigint;
begin
 insert into private.legal_records(policy,listing_id,reason,opened_by,opened_at,snapshot,snapshot_sha256)
 values(p_policy,1,'test kaydı',pg_catalog.gen_random_uuid(),p_at,s,encode(pg_catalog.sha256(convert_to(s::text,'UTF8')),'hex')) returning id into rid;
 return rid;
end $$;
create function private.t_close(p_record bigint,p_at timestamptz) returns void language plpgsql set search_path='' as $$
begin
 if exists(select 1 from private.legal_holds where record_id=p_record and released_at is null) then raise exception 'Active hold'; end if;
 update private.legal_records set status='closed',closed_by=pg_catalog.gen_random_uuid(),closed_at=p_at,close_reason='kapandı' where id=p_record and status='open';
end $$;
create function private.t_destroy(p_record bigint,p_now timestamptz) returns void language plpgsql set search_path='' set timezone='UTC' as $$
declare r private.legal_records; days integer; n integer;
begin
 select * into r from private.legal_records where id=p_record for update;
 select retain_days into days from private.legal_policies where code=r.policy and approved_at is not null;
 if r.status<>'closed' or days is null or r.closed_at+days*interval '1 day'>p_now
  or exists(select 1 from private.legal_holds where record_id=p_record and released_at is null) then raise exception 'Record not destroyable'; end if;
 select count(*) into n from private.legal_holds where record_id=p_record;
 perform set_config('nakgo.legal_purge','on',true);
 delete from private.legal_records where id=p_record;
 perform set_config('nakgo.legal_purge','off',true);
 insert into private.legal_destructions(at,record_no,policy,retain_days,opened_month,closed_month,holds_removed,cause,actor,prev_hash,row_hash)
 values(p_now,p_record,r.policy,days,date_trunc('month',r.opened_at)::date,date_trunc('month',r.closed_at)::date,n,'retention_expired',null,'','');
end $$;
-- retention_run'ın yasal bölümü (ran_at = p_now).
create function private.t_retention(p_now timestamptz) returns jsonb language plpgsql set search_path='' set timezone='UTC' as $$
declare c jsonb:='{}'; n bigint; r record; days integer;
begin
 n:=0;
 for r in select x.id from private.legal_records x join private.legal_policies p on p.code=x.policy
  where x.status='closed' and p.approved_at is not null and x.closed_at+p.retain_days*interval '1 day'<=p_now
   and not exists(select 1 from private.legal_holds h where h.record_id=x.id and h.released_at is null) order by x.id loop
  perform private.t_destroy(r.id,p_now); n:=n+1;
 end loop;
 c:=c||jsonb_build_object('legal_destroyed',n);
 select retain_days into days from private.legal_policies where code='legal_access_log' and approved_at is not null;
 if days is not null then
  perform set_config('nakgo.legal_purge','on',true);
  delete from private.legal_access_log where at<p_now-days*interval '1 day';
  get diagnostics n=row_count; c:=c||jsonb_build_object('legal_access_log_deleted',n);
  perform set_config('nakgo.legal_purge','off',true);
 end if;
 days:=null;
 select retain_days into days from private.legal_policies where code='destruction_record' and approved_at is not null;
 if days is not null then
  perform set_config('nakgo.legal_purge','on',true);
  delete from private.legal_destructions where at<p_now-days*interval '1 day';
  get diagnostics n=row_count; c:=c||jsonb_build_object('destructions_deleted',n);
  perform set_config('nakgo.legal_purge','off',true);
 end if;
 insert into private.retention_runs(ran_at,counts) values(p_now,c);
 return c;
end $$;
