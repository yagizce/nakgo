-- B3-c2: ilan için tamsayı revision. B3-c'deki updated_at (milisaniye) karşılaştırmasının yerine geçer.
--
-- Neden: zaman damgası sürüm kimliği değildir. Aynı milisaniyeye düşen iki farklı sürüm aynı değeri taşıyabilir; işlem
-- başlangıç saati (now()) bir sonraki yazmadan geride kalabilir; saat geri ayarlanabilir. Tamsayı revision her
-- güncellemede tetikleyiciyle tam 1 artar, iki sürüm asla aynı değeri taşımaz.
--
-- Atomiklik: listing_update_v1 satırı FOR UPDATE ile kilitler ve revision'ı kilit altında karşılaştırır; aynı revision'ı
-- okuyan iki istemciden ikincisi birincinin işlemi bitene kadar bekler, sonra artmış revision'ı görür ve conflict alır.
--
-- v0 de korunur: revision v0 güncellemelerinde de (RLS ile doğrudan tablo, yönetici, hesap silme) aynı tetikleyiciyle
-- artar; v0 ile yapılmış bir değişiklik v1 istemcisinin eski sürümle yazmasını engeller. v0 istemcisi sütunu görmez ve
-- yazamaz (sütun yetkisi verilmez); v0 sözleşmesi ve RLS değişmez. Tetikleyicileri bilerek kapatan bakım yazmaları
-- (session_replication_role=replica) revision'ı artırmaz; bunlar ilanı karartır ve karartılmış ilan v1'de güncellenemez.
begin;
alter table public.listings add column revision bigint not null default 0 check(revision>=0);
comment on column public.listings.revision is 'Her güncellemede 1 artar (tetikleyici). API v1 eşzamanlı düzenleme denetimi. İstemci yazamaz.';

create function private.listing_revision() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then new.revision:=0; else new.revision:=old.revision+1; end if;
 return new;
end $$;
revoke all on function private.listing_revision() from public,anon,authenticated;
create trigger listings_revision before insert or update on public.listings for each row execute function private.listing_revision();

-- Üye yanıtına revision: yalnız kendi ilanında (başkasının ilanında null). Diğer alanlar aynı.
create or replace function private.api_listing_json(l public.listings,p_member boolean,p_actor uuid,p_detail boolean) returns jsonb
language sql stable as $$
 select jsonb_build_object('id',l.id,'kind',l.kind,
   'from',jsonb_build_object('city',l.from_city,'district',l.from_district),
   'to',jsonb_build_object('city',l.to_city,'district',l.to_district),
   'vehicle',l.vehicle,'body',l.body,'amount',l.amount,'cargo',l.cargo,'items',l.items,
   'date',jsonb_build_object('on',l.available_on,'until',l.available_until,'time',l.available_time,'text',l.loading_text),
   'status',l.status,'created_at',private.api_ts(l.created_at),'has_photo',l.image_data<>'')
 ||case when p_member then jsonb_build_object('owner_label',l.owner_label,'note',l.note,'mine',l.owner_id=p_actor,
   'expires_at',private.api_ts(l.expires_at),'updated_at',private.api_ts(l.updated_at),'contact_allowed',l.contact_consent,
   'revision',case when l.owner_id=p_actor then l.revision end) else '{}'::jsonb end
 ||case when p_member and p_detail then jsonb_build_object('photo',nullif(l.image_data,'')) else '{}'::jsonb end $$;

-- Güncelleme: p_revision artık tamsayı (yayımlanmamış B3-c imzası değişir; v1 henüz hiçbir istemcide açık değil).
drop function api.listing_update_v1(bigint,text,jsonb);
create function api.listing_update_v1(p_id bigint,p_revision bigint,p_changes jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; keys text[]; sets text; r public.listings; st text; msg text; hn text;
begin
 perform private.api_begin('listing_update_v1');
 actor:=private.api_actor(true);
 if p_id is null or p_id<1 or p_revision is null or p_revision<0 or p_changes is null or jsonb_typeof(p_changes)<>'object' then perform private.api_raise('invalid_argument'); end if;
 select array_agg(k) into keys from jsonb_object_keys(p_changes) k;
 if keys is null or not keys <@ (private.api_listing_fields()||'status'::text) then perform private.api_raise('invalid_argument'); end if;
 select * into r from public.listings l where l.id=p_id and l.owner_id=actor and l.redacted_at is null for update;
 if not found then perform private.api_raise('not_found'); end if;
 if r.revision<>p_revision then perform private.api_raise('conflict'); end if;
 select string_agg(format('%1$I=x.%1$I',k),',') into sets from unnest(keys) k;
 begin
  execute format('update public.listings l set %s from jsonb_populate_record(null::public.listings,$1) x where l.id=$2 returning l.*',sets)
   using p_changes,p_id into r;
 exception when others then
  get stacked diagnostics st=returned_sqlstate,msg=message_text,hn=pg_exception_hint;
  perform private.api_rethrow(st,msg,hn);
 end;
 return private.api_ok(jsonb_build_object('listing',private.api_listing_json(r,true,actor,true)));
end $$;
revoke all on function api.listing_update_v1(bigint,bigint,jsonb) from public,anon,authenticated;
grant execute on function api.listing_update_v1(bigint,bigint,jsonb) to authenticated;
commit;
