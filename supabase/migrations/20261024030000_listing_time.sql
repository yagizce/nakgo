begin;
alter table public.listings add column available_time text not null default ''
 check(available_time='' or available_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
grant insert(available_time),update(available_time) on public.listings to authenticated;
commit;
