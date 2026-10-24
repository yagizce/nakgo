-- Keep the existing single compressed JPEG with its listing for atomic writes.
begin;
alter table public.listings add column image_data text not null default ''
 check (image_data='' or (kind='load' and char_length(image_data)<60000 and image_data ~ '^data:image/jpeg;base64,/9j/[A-Za-z0-9+/]*={0,2}$'));
grant insert(image_data),update(image_data) on public.listings to authenticated;
commit;
