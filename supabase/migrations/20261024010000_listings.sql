-- Marketplace foundations: development first, no demo-data import.
begin;
create function public.nakgo_listing_items_valid(items jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item jsonb;
begin
 if jsonb_typeof(items)<>'array' or jsonb_array_length(items)>6 then return false; end if;
 for item in select value from jsonb_array_elements(items) loop
  if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'n') is distinct from 'string'
   or char_length(trim(item->>'n')) not between 1 and 40
   or jsonb_typeof(item->'q') is distinct from 'number'
   or (item->>'q')::numeric<=0 or (item->>'q')::numeric>9007199254740991
   or (item->>'u') is null or (item->>'u') not in ('ton','kg','palet','koli','adet','m³')
   or (item - array['n','q','u'])<>'{}'::jsonb then return false; end if;
 end loop;
 return true;
end $$;
revoke all on function public.nakgo_listing_items_valid(jsonb) from public;
grant execute on function public.nakgo_listing_items_valid(jsonb) to authenticated;

create table public.listings (
 id bigint generated always as identity primary key check (id<=9007199254740991),
 owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 kind text not null check(kind in ('load','truck')),
 from_city text not null check(from_city in ('Adana','Adıyaman','Afyonkarahisar','Ağrı','Aksaray','Amasya','Ankara','Antalya','Ardahan','Artvin','Aydın','Balıkesir','Bartın','Batman','Bayburt','Bilecik','Bingöl','Bitlis','Bolu','Burdur','Bursa','Çanakkale','Çankırı','Çorum','Denizli','Diyarbakır','Düzce','Edirne','Elazığ','Erzincan','Erzurum','Eskişehir','Gaziantep','Giresun','Gümüşhane','Hakkari','Hatay','Iğdır','Isparta','İstanbul','İzmir','Kahramanmaraş','Karabük','Karaman','Kars','Kastamonu','Kayseri','Kırıkkale','Kırklareli','Kırşehir','Kilis','Kocaeli','Konya','Kütahya','Malatya','Manisa','Mardin','Mersin','Muğla','Muş','Nevşehir','Niğde','Ordu','Osmaniye','Rize','Sakarya','Samsun','Siirt','Sinop','Sivas','Şanlıurfa','Şırnak','Tekirdağ','Tokat','Trabzon','Tunceli','Uşak','Van','Yalova','Yozgat','Zonguldak')),
 to_city text not null check(to_city in ('Adana','Adıyaman','Afyonkarahisar','Ağrı','Aksaray','Amasya','Ankara','Antalya','Ardahan','Artvin','Aydın','Balıkesir','Bartın','Batman','Bayburt','Bilecik','Bingöl','Bitlis','Bolu','Burdur','Bursa','Çanakkale','Çankırı','Çorum','Denizli','Diyarbakır','Düzce','Edirne','Elazığ','Erzincan','Erzurum','Eskişehir','Gaziantep','Giresun','Gümüşhane','Hakkari','Hatay','Iğdır','Isparta','İstanbul','İzmir','Kahramanmaraş','Karabük','Karaman','Kars','Kastamonu','Kayseri','Kırıkkale','Kırklareli','Kırşehir','Kilis','Kocaeli','Konya','Kütahya','Malatya','Manisa','Mardin','Mersin','Muğla','Muş','Nevşehir','Niğde','Ordu','Osmaniye','Rize','Sakarya','Samsun','Siirt','Sinop','Sivas','Şanlıurfa','Şırnak','Tekirdağ','Tokat','Trabzon','Tunceli','Uşak','Van','Yalova','Yozgat','Zonguldak')),
 vehicle text not null check(vehicle in ('Tır','Kırkayak','Kamyon','Kamyonet','Panelvan','Tanker','Lowbed','Konteyner')),
 body text not null check(body in ('Tenteli','Kapalı kasa','Açık kasa','Frigorifik','Damperli','Tanker','Lowbed','Konteyner')),
 amount numeric not null check(amount>0 and amount<=9007199254740991),
 cargo text not null default '' check(char_length(cargo)<=120),
 note text not null default '' check(char_length(note)<=1000),
 owner_label text not null check(char_length(trim(owner_label)) between 1 and 60),
 available_on date not null,
 available_until date,
 items jsonb not null default '[]' check(public.nakgo_listing_items_valid(items)),
 status text not null default 'active' check(status in ('active','closed','archived')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(from_city<>to_city),
 check(available_until is null or available_until>=available_on),
 check((kind='load' and char_length(trim(cargo))>0) or (kind='truck' and cargo='' and items='[]'::jsonb))
);
create index listings_owner_created on public.listings(owner_id,created_at desc);
create index listings_active_route on public.listings(kind,from_city,to_city,available_on) where status='active';

create function public.nakgo_listing_write_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
 if tg_op='UPDATE' then
  if new.id<>old.id or new.owner_id<>old.owner_id or new.kind<>old.kind or new.created_at<>old.created_at then
   raise exception 'Listing identity is immutable' using errcode='23514';
  end if;
 end if;
 if new.status='active' and coalesce(new.available_until,new.available_on)<(now() at time zone 'Europe/Istanbul')::date then
  raise exception 'An active listing requires a current availability date' using errcode='23514';
 end if;
 new.updated_at=now();
 return new;
end $$;
revoke all on function public.nakgo_listing_write_guard() from public;
create trigger listings_write_guard before insert or update on public.listings
 for each row execute function public.nakgo_listing_write_guard();

alter table public.listings enable row level security;
revoke all on public.listings from public,anon,authenticated;
grant select on public.listings to authenticated;
grant insert(kind,from_city,to_city,vehicle,body,amount,cargo,note,owner_label,available_on,available_until,items) on public.listings to authenticated;
grant update(from_city,to_city,vehicle,body,amount,cargo,note,owner_label,available_on,available_until,items,status) on public.listings to authenticated;
grant usage on sequence public.listings_id_seq to authenticated;
create policy listings_read on public.listings for select to authenticated using (
 owner_id=(select auth.uid()) or
 (status='active' and coalesce(available_until,available_on)>=(now() at time zone 'Europe/Istanbul')::date)
);
create policy listings_create_own on public.listings for insert to authenticated
 with check(owner_id=(select auth.uid()) and status='active');
create policy listings_update_own on public.listings for update to authenticated
 using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
comment on table public.listings is 'Authenticated marketplace listings; private profile contacts are never copied here. No anonymous read or client hard-delete.';
commit;
