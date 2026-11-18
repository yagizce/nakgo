-- Şikâyet (ilan ve ilan sahibi hesap). v0 tabloları, RLS ve mevcut fonksiyonlar DEĞİŞMEZ; yalnız ekleme.
--
--  * Kimlik oturumdan (auth.uid()); şikâyet eden argüman olarak alınmaz. Askıdaki hesap şikâyet gönderemez.
--  * Bağ sunucuda doğrulanır: ilan bugün herkese görünür olmalı (private.api_visible_listings) ve şikâyet edenin kendi
--    ilanı olmamalı. Hesap şikâyeti de bir ilan üzerinden yapılır; hesap kimliği istemciden alınmaz, ilan sahibinden
--    sunucuda okunur (v1 sahip kimliği vermez).
--  * Tekrar: aynı kişinin aynı ilan (ya da aynı hesap) için açık/incelenen tek şikâyeti olur; ikinci gönderim aynı
--    kaydı döner (created=false). Sınır: kişi başına 10/saat, 30/24 saat (yeni kayıtlar; tekrar sayılmaz).
--  * Gizlilik: tablo private şemasında, RLS açık, istemci rollerine kapalı. İlan sahibi şikâyeti göremez; şikâyet eden
--    yalnız kendi gönderdiği kaydın kimliğini ve durumunu alır. İçerik yalnız yöneticiye (private.is_nakgo_admin).
--  * Yönetici incelemesi mevcut modelle: revision (eşzamanlı değişiklikte PT409/HTTP 409; 40001 değil, aşağıya bkz.), 3–500 karakter gerekçe, private.admin_audit.
--  * Şikâyetler otomatik silinmez (yasal/denetim kaydı). Saklama süresi ayrı karardır (docs/api/contract-v1.md).
begin;
create table private.listing_reports (
 id bigint generated always as identity primary key,
 reporter_id uuid references auth.users(id) on delete set null,
 subject text not null check(subject in('listing','account')),
 listing_id bigint not null check(listing_id>0),
 account_id uuid references auth.users(id) on delete set null,
 reason text not null check(reason in('fake','fraud','inappropriate','wrong_info','other')),
 note text not null default '' check(char_length(note)<=200),
 status text not null default 'open' check(status in('open','reviewing','resolved','rejected')),
 revision bigint not null default 0 check(revision>=0),
 reviewed_by uuid references auth.users(id) on delete set null,
 reviewed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index listing_reports_open_listing on private.listing_reports(reporter_id,listing_id)
 where subject='listing' and status in('open','reviewing');
create unique index listing_reports_open_account on private.listing_reports(reporter_id,account_id)
 where subject='account' and status in('open','reviewing');
create index listing_reports_reporter_recent on private.listing_reports(reporter_id,created_at);
create index listing_reports_status on private.listing_reports(status,id);
comment on table private.listing_reports is 'Kullanıcı şikâyetleri. Yalnız yönetici okur; şikâyet edilen göremez. Otomatik silinmez.';
alter table private.listing_reports enable row level security;
revoke all on private.listing_reports from public,anon,authenticated;
revoke all on sequence private.listing_reports_id_seq from public,anon,authenticated;

create function private.report_json(r private.listing_reports) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'subject',r.subject,'listing_id',r.listing_id,'reason',r.reason,'status',r.status,
  'created_at',private.api_ts(r.created_at)) $$;

-- Tek iş kuralı; v0 ve v1 bunu çağırır. Kimlik ve askı denetimi çağırandadır.
create function private.report_create(p_actor uuid,p_listing_id bigint,p_subject text,p_reason text,p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.listings; r private.listing_reports; n text:=btrim(regexp_replace(coalesce(p_note,''),'[[:cntrl:]]+',' ','g'));
begin
 if p_actor is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_listing_id is null or p_listing_id<1 or p_listing_id>9007199254740991 or p_subject is null or p_subject not in('listing','account')
  or p_reason is null or p_reason not in('fake','fraud','inappropriate','wrong_info','other') or char_length(n)>200 then
  raise exception 'Invalid report' using errcode='22023'; end if;
 select * into l from public.listings where id=p_listing_id;
 if not found or l.redacted_at is not null or not exists(select 1 from private.api_visible_listings v where v.id=l.id) then
  raise exception 'Listing unavailable' using errcode='42501'; end if;
 if l.owner_id=p_actor then raise exception 'Own listing' using errcode='42501'; end if;
 -- Aynı kişinin eşzamanlı gönderimleri sırayla: tekrar ve sınır denetimi yarışmaz.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_actor::text,7301));
 select * into r from private.listing_reports x where x.reporter_id=p_actor and x.subject=p_subject and x.status in('open','reviewing')
  and ((p_subject='listing' and x.listing_id=p_listing_id) or (p_subject='account' and x.account_id=l.owner_id)) limit 1;
 if found then return jsonb_build_object('report',private.report_json(r),'created',false); end if;
 if (select count(*) from private.listing_reports x where x.reporter_id=p_actor and x.created_at>now()-interval '1 hour')>=10
  or (select count(*) from private.listing_reports x where x.reporter_id=p_actor and x.created_at>now()-interval '24 hours')>=30 then
  raise exception 'Report limit' using errcode='54000'; end if;
 insert into private.listing_reports(reporter_id,subject,listing_id,account_id,reason,note)
  values(p_actor,p_subject,p_listing_id,l.owner_id,p_reason,n) returning * into r;
 return jsonb_build_object('report',private.report_json(r),'created',true);
end $$;
revoke all on function private.report_json(private.listing_reports),private.report_create(uuid,bigint,text,text,text) from public,anon,authenticated;

-- v0: bugünkü istemci (api şeması canlıda açılana kadar).
create function public.nakgo_report_listing(p_listing_id bigint,p_subject text,p_reason text,p_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then
  raise exception 'Verified account required' using errcode='42501'; end if;
 perform private.require_activity(actor);
 return private.report_create(actor,p_listing_id,p_subject,p_reason,p_note);
end $$;
revoke all on function public.nakgo_report_listing(bigint,text,text,text) from public,anon;
grant execute on function public.nakgo_report_listing(bigint,text,text,text) to authenticated;

-- v1
create function api.report_create_v1(p_listing_id bigint,p_subject text,p_reason text,p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; result jsonb; st text; msg text; hn text;
begin
 perform private.api_begin('report_create_v1');
 actor:=private.api_actor(true);
 begin result:=private.report_create(actor,p_listing_id,p_subject,p_reason,p_note);
 exception when others then
  get stacked diagnostics st=returned_sqlstate,msg=message_text,hn=pg_exception_hint;
  perform private.api_rethrow(st,msg,hn);
 end;
 return private.api_ok(result);
end $$;
revoke all on function api.report_create_v1(bigint,text,text,text) from public,anon,authenticated;
grant execute on function api.report_create_v1(bigint,text,text,text) to authenticated;

-- Yönetici: liste (durum süzgeci, 20'lik sayfa + 1 fazlası "daha var" için) ve durum kararı.
create function public.nakgo_admin_reports(p_status text default '',p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare f text:=coalesce(p_status,''); result jsonb;
begin
 if not private.is_nakgo_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 if f not in('','open','reviewing','resolved','rejected') or p_offset is null or p_offset<0 or p_offset>100000 then
  raise exception 'Invalid query' using errcode='22023'; end if;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.id desc),'[]'::jsonb) into result from
 (select r.id,r.subject,r.listing_id,r.reason,r.note,r.status,r.revision,r.created_at,r.updated_at,r.reviewed_at,
   r.reporter_id,coalesce(rp.display_name,'Kullanıcı') reporter_label,r.account_id,coalesce(ap.display_name,l.owner_label,'Kullanıcı') account_label,
   l.kind,l.from_city,l.to_city,l.status listing_status,
   (select count(*) from private.listing_reports x where x.listing_id=r.listing_id and x.status in('open','reviewing')) open_on_listing
  from private.listing_reports r left join public.listings l on l.id=r.listing_id
   left join public.profiles rp on rp.id=r.reporter_id left join public.profiles ap on ap.id=r.account_id
  where f='' or r.status=f order by r.id desc limit 21 offset p_offset) t;
 return result;
end $$;
revoke all on function public.nakgo_admin_reports(text,integer) from public,anon;
grant execute on function public.nakgo_admin_reports(text,integer) to authenticated;

create function public.nakgo_admin_report_set(p_id bigint,p_status text,p_reason text,p_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); r private.listing_reports; reason_value text:=btrim(coalesce(p_reason,''));
begin
 if not private.is_nakgo_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 if p_id is null or p_id<1 or p_status is null or p_status not in('open','reviewing','resolved','rejected')
  or p_revision is null or p_revision<0 or char_length(reason_value) not between 3 and 500 then
  raise exception 'Invalid moderation' using errcode='22023'; end if;
 select * into r from private.listing_reports where id=p_id for update;
 if not found then raise exception 'Report unavailable' using errcode='22023'; end if;
 -- PT409 (HTTP 409): PostgREST 40001'i serileştirme hatası sayıp işlemi yeniden dener; değişmeyen revision'da sonsuz döngü olur.
 if r.revision<>p_revision then raise exception 'Moderation changed; refresh' using errcode='PT409'; end if;
 if r.status=p_status then return jsonb_build_object('revision',r.revision,'changed',false); end if;
 update private.listing_reports set status=p_status,revision=r.revision+1,reviewed_by=actor,reviewed_at=now(),updated_at=now() where id=p_id;
 insert into private.admin_audit(actor_id,target,action,reason,revision) values(actor,'report:'||p_id,'report_'||p_status,reason_value,r.revision+1);
 return jsonb_build_object('revision',r.revision+1,'changed',true);
end $$;
revoke all on function public.nakgo_admin_report_set(bigint,text,text,bigint) from public,anon;
grant execute on function public.nakgo_admin_report_set(bigint,text,text,bigint) to authenticated;
commit;
