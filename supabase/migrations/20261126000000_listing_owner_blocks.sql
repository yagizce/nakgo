begin;
set local lock_timeout = '5s';

create table private.listing_owner_blocks (
 id uuid primary key default gen_random_uuid(),
 viewer_id uuid not null references auth.users(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 owner_label text not null,
 created_at timestamptz not null default now(),
 unique (viewer_id, owner_id),
 check (viewer_id <> owner_id)
);
create index listing_owner_blocks_owner_idx on private.listing_owner_blocks(owner_id);
alter table private.listing_owner_blocks enable row level security;
revoke all on private.listing_owner_blocks from public, anon, authenticated;

-- İstemci yalnız kendi engel durumunu sorgulayabilir. Sahip kimliği ilan yanıtına eklenmez.
create function private.viewer_blocks_listing_owner(p_owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from private.listing_owner_blocks b
  where b.viewer_id = auth.uid() and b.owner_id = p_owner);
$$;
revoke all on function private.viewer_blocks_listing_owner(uuid) from public, anon, authenticated;
grant execute on function private.viewer_blocks_listing_owner(uuid) to authenticated;

create policy listings_exclude_blocked_owners on public.listings as restrictive
 for select to authenticated using (not private.viewer_blocks_listing_owner(owner_id));

-- SECURITY DEFINER kullanan okuma yolları RLS kontrolünü açıkça uygular.
create or replace view private.api_visible_listings as
 select l.id,l.kind from public.listings l
 where l.status='active' and l.expires_at>now()
  and (l.loading_text is not null or coalesce(l.available_until,l.available_on)>=(now() at time zone 'Europe/Istanbul')::date)
  and not exists(select 1 from private.listing_moderation m where m.listing_id=l.id and m.removed)
  and not private.account_suspended(l.owner_id)
  and not private.viewer_blocks_listing_owner(l.owner_id);

-- Diğer görünürlük ve iletişim kurallarının mevcut gövdeleri üzerinden ek denetim yap.
do $$
declare f record; body text;
begin
 for f in select * from (values
  ('public.nakgo_public_listings(bigint)', 'and (p_before is null or l.id<p_before)',
   'and not private.viewer_blocks_listing_owner(l.owner_id) and (p_before is null or l.id<p_before)'),
  ('public.nakgo_listing_contact(bigint,text)', 'or private.account_suspended(l.owner_id) then',
   'or private.account_suspended(l.owner_id) or private.viewer_blocks_listing_owner(l.owner_id) then'),
  ('public.nakgo_set_favorite(bigint,boolean)', 'or private.account_suspended(l.owner_id) or ',
   'or private.account_suspended(l.owner_id) or private.viewer_blocks_listing_owner(l.owner_id) or ')
 ) as edits(signature, original, replacement) loop
  body := pg_get_functiondef(f.signature::regprocedure);
  if length(body) - length(replace(body, f.original, '')) <> length(f.original) then
   raise exception 'Unexpected definition: %', f.signature;
  end if;
  execute replace(body, f.original, f.replacement);
 end loop;
end $$;

create function public.nakgo_block_listing_owner(p_listing_id bigint) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
 actor uuid := private.api_actor(false);
 target uuid;
 label text;
 block_id uuid;
begin
 if p_listing_id is null or p_listing_id < 1 then
  raise exception 'Invalid listing' using errcode = '22023';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 7312));
 select l.owner_id, l.owner_label into target, label from public.listings l where l.id = p_listing_id;
 if not found or target = actor then raise exception 'Listing unavailable' using errcode = '42501'; end if;
 select b.id into block_id from private.listing_owner_blocks b where b.viewer_id = actor and b.owner_id = target;
 if found then return block_id; end if;
 if not exists(select 1 from private.api_visible_listings v where v.id = p_listing_id) then
  raise exception 'Listing unavailable' using errcode = '42501';
 end if;
 if (select count(*) from private.listing_owner_blocks b where b.viewer_id = actor) >= 200 then
  raise exception 'Block limit reached' using errcode = '54000';
 end if;
 insert into private.listing_owner_blocks(viewer_id, owner_id, owner_label)
 values (actor, target, coalesce(nullif(label, ''), 'NakGo üyesi')) returning id into block_id;
 return block_id;
end $$;

create function public.nakgo_list_listing_owner_blocks() returns table(id uuid, owner_label text)
language sql security definer set search_path = '' as $$
 select b.id,b.owner_label from private.listing_owner_blocks b
 where b.viewer_id = private.api_actor(false) order by b.created_at desc,b.id;
$$;

create function public.nakgo_unblock_listing_owner(p_block_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.api_actor(false);
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 7312));
 delete from private.listing_owner_blocks b where b.viewer_id = actor and b.id = p_block_id;
end $$;

revoke all on function public.nakgo_block_listing_owner(bigint), public.nakgo_list_listing_owner_blocks(),
 public.nakgo_unblock_listing_owner(uuid) from public, anon, authenticated;
grant execute on function public.nakgo_block_listing_owner(bigint), public.nakgo_list_listing_owner_blocks(),
 public.nakgo_unblock_listing_owner(uuid) to authenticated;

commit;
