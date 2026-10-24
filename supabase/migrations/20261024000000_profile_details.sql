-- Development first. Existing rows keep empty contact fields; no demo import.
begin;
alter table public.profiles
    add column city text not null default '' check (char_length(city) <= 40),
    add column about text not null default '' check (char_length(about) <= 200),
    add column phone text not null default '' check (phone = '' or phone ~ '^05[0-9]{9}$');
grant update (city, about, phone) on public.profiles to authenticated;
comment on column public.profiles.phone is
    'Private, self-reported contact number. Not verified or publicly readable.';
commit;
