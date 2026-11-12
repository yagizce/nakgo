-- Recent listings (24h view), 8-day cleanup, archive, one-year retention and legal hold. Synthetic rows only; everything rolls back.
begin;
do $$
declare admin uuid:=(select user_id from private.admin_members where active limit 1); owner uuid:=gen_random_uuid(); t0 timestamptz:=statement_timestamp();
 l_new bigint; l_old bigint; l_gone bigint; l_8a bigint; l_8b bigint; l_y1 bigint; l_y2 bigint; l_hold bigint; l_hold2 bigint; r jsonb; c jsonb; c2 jsonb; red timestamptz; d date:=current_date-400;
begin
 if admin is null then raise exception 'One administrator required'; end if;
 insert into auth.users(id,email_confirmed_at) values(owner,t0);
 perform set_config('request.jwt.claim.sub',owner::text,true);
 insert into public.profiles(id,display_name,account_type) values(owner,'Arşiv Deneme','carrier');
 set local role authenticated;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,contact_phone,contact_consent,note) values('load','Hakkari','Ardahan','Tır','Tenteli',1,'Yük','Arşiv Deneme','bugün','+905551112233',true,'Gizli not') returning id into l_new;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text) values('load','Hakkari','Ardahan','Tır','Tenteli',1,'Yük','Arşiv Deneme','bugün') returning id into l_old;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text) values('load','Hakkari','Ardahan','Tır','Tenteli',1,'Yük','Arşiv Deneme','bugün') returning id into l_gone;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,contact_phone,contact_consent) values('load','Hakkari','Kilis','Kamyon','Tenteli',1,'Yük','Arşiv Deneme','bugün','+905551112233',true) returning id into l_8a;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,contact_phone,contact_consent) values('load','Hakkari','Kilis','Kamyon','Tenteli',1,'Yük','Arşiv Deneme','bugün','+905551112233',true) returning id into l_8b;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text) values('load','Hakkari','Kilis','Kamyon','Tenteli',1,'Yük','Arşiv Deneme','bugün') returning id into l_y1;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text) values('load','Hakkari','Kilis','Kamyon','Tenteli',1,'Yük','Arşiv Deneme','bugün') returning id into l_y2;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text,contact_phone,contact_consent) values('load','Hakkari','Kilis','Kamyon','Tenteli',1,'Yük','Arşiv Deneme','bugün','+905551112233',true) returning id into l_hold;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,loading_text) values('load','Hakkari','Kilis','Kamyon','Tenteli',1,'Yük','Arşiv Deneme','bugün') returning id into l_hold2;
 reset role;
 -- Back-date synthetic rows (identity and timestamps are normally immutable).
 alter table public.listings disable trigger listings_write_guard, disable trigger moderation_listing;
 update public.listings set created_at=t0-interval '25 hours',expires_at=t0-interval '19 hours' where id=l_old;
 update public.listings set created_at=t0-interval '10 days',updated_at=t0-interval '9 days',expires_at=t0-interval '9 days',status='closed' where id=l_8a;
 update public.listings set created_at=t0-interval '8 days',updated_at=t0-interval '7 days',expires_at=t0-interval '7 days',status='closed' where id=l_8b;
 update public.listings set created_at=t0-interval '400 days',expires_at=t0-interval '380 days',status='closed',redacted_at=t0-interval '366 days',contact_phone=null,note='' where id=l_y1;
 update public.listings set created_at=t0-interval '400 days',expires_at=t0-interval '380 days',status='closed',redacted_at=t0-interval '364 days' where id=l_y2;
 update public.listings set created_at=t0-interval '420 days',updated_at=t0-interval '410 days',expires_at=t0-interval '410 days',status='closed' where id=l_hold;
 update public.listings set created_at=t0-interval '420 days',expires_at=t0-interval '410 days',status='closed',redacted_at=t0-interval '400 days' where id=l_hold2;
 alter table public.listings enable trigger listings_write_guard, enable trigger moderation_listing;
 insert into private.access_log(at,user_id,action,listing_id) values(t0-interval '400 days',owner,'listing_create',l_hold),(t0-interval '400 days',owner,'listing_create',l_y1);
 insert into private.daily_stats(day,listings,loads,trucks,users) values(d,7,7,0,1) on conflict(day) do nothing;

 perform set_config('request.jwt.claim.sub',admin::text,true);
 perform public.nakgo_admin_moderate('listing',l_gone::text,'remove','Deneme kaldırma',0);
 -- 1) Recent listings: last 24 hours only; older and admin-removed listings are hidden but not deleted.
 r:=public.nakgo_admin_page('listings',0,'','','{"recent":"24h","owner":"Arşiv Deneme"}');
 if not r @> jsonb_build_array(jsonb_build_object('id',l_new)) or r @> jsonb_build_array(jsonb_build_object('id',l_old)) or r @> jsonb_build_array(jsonb_build_object('id',l_gone))
  or r @> jsonb_build_array(jsonb_build_object('id',l_8a)) then raise exception 'FAIL recent filter %',r; end if;
 if (select count(*) from public.listings where id in(l_old,l_gone))<>2 then raise exception 'FAIL recent view deleted rows'; end if;
 begin perform public.nakgo_admin_page('listings',0,'','','{"recent":"48h"}');raise exception 'FAIL bad recent value';exception when invalid_parameter_value then null;end;

 -- Legal hold before cleanup.
 perform public.nakgo_admin_moderate('listing',l_hold::text,'hold','Savcılık talebi',0);
 perform public.nakgo_admin_moderate('listing',l_hold2::text,'hold','Savcılık talebi',0);

 -- 2) 8-day cleanup: ended 9 days ago is cleaned, 7 days ago is not; held listing untouched.
 c:=private.retention_run();
 if (select redacted_at from public.listings where id=l_8a) is null or (select contact_phone from public.listings where id=l_8a) is not null
  or (select owner_label from public.listings where id=l_8a)<>'NakGo kullanıcısı' then raise exception 'FAIL 8-day cleanup %',c; end if;
 if (select redacted_at from public.listings where id=l_8b) is not null or (select contact_phone from public.listings where id=l_8b) is null then raise exception 'FAIL cleaned too early'; end if;
 if (select redacted_at from public.listings where id=l_hold) is not null then raise exception 'FAIL held listing cleaned'; end if;
 -- Archive shows cleaned rows only, without personal data; ordinary users cannot read it.
 r:=public.nakgo_admin_page('archive',0,'','',jsonb_build_object('id',l_8a::text));
 if jsonb_array_length(r)<>1 or (r->0->>'purge_at')::timestamptz<>(select redacted_at+interval '1 year' from public.listings where id=l_8a) or r::text ~ '(contact_phone|owner_label|905551112233|Arşiv Deneme)' then raise exception 'FAIL archive %',r; end if;
 r:=public.nakgo_admin_page('retention',0,'');
 if (r->>'held')::int<1 or jsonb_array_length(r->'runs')<1 then raise exception 'FAIL retention summary %',r; end if;
 -- Repeat run: nothing is processed twice.
 red:=(select redacted_at from public.listings where id=l_8a);
 c2:=private.retention_run();
 if (c2->>'listings_redacted')::int<>0 or (c2->>'listings_deleted')::int<>0 or (select redacted_at from public.listings where id=l_8a)<>red then raise exception 'FAIL repeat run %',c2; end if;

 -- 3) One year: cleaned 366 days ago is deleted (with its old log), 364 days is kept; held listing and its log stay; daily totals stay.
 if exists(select 1 from public.listings where id=l_y1) or not exists(select 1 from public.listings where id=l_y2) then raise exception 'FAIL one-year deletion'; end if;
 if exists(select 1 from private.access_log where listing_id=l_y1 and at<t0-interval '1 year') or not exists(select 1 from private.access_log where listing_id=l_hold and at<t0-interval '1 year') then raise exception 'FAIL log retention'; end if;
 if not exists(select 1 from public.listings where id=l_hold2) then raise exception 'FAIL held archive deleted'; end if;
 if not exists(select 1 from public.listings where id=l_hold) or (select listings from private.daily_stats where day=d)<>7 then raise exception 'FAIL hold or statistics'; end if;
 r:=public.nakgo_admin_page('archive',0,'','hold');
 if r @> jsonb_build_array(jsonb_build_object('id',l_hold)) then raise exception 'FAIL uncleaned held listing listed as archive'; end if;
 -- Release: next run cleans it (ended long ago) and then the one-year clock starts.
 perform public.nakgo_admin_moderate('listing',l_hold::text,'release','Talep kapandı',1);
 c:=private.retention_run();
 if (select redacted_at from public.listings where id=l_hold) is null or exists(select 1 from private.access_log where listing_id=l_hold and at<t0-interval '1 year') then raise exception 'FAIL release %',c; end if;
 if not exists(select 1 from private.admin_audit where target=l_hold::text and action='hold') then raise exception 'FAIL hold audited'; end if;

 -- Unauthorised access.
 perform set_config('request.jwt.claim.sub',owner::text,true);
 begin perform public.nakgo_admin_page('archive',0,'');raise exception 'FAIL archive open';exception when insufficient_privilege then null;end;
 begin perform public.nakgo_admin_page('retention',0,'');raise exception 'FAIL retention open';exception when insufficient_privilege then null;end;
 begin perform public.nakgo_admin_moderate('listing',l_8b::text,'hold','Kendim',0);raise exception 'FAIL user hold';exception when insufficient_privilege then null;end;
end $$;
rollback;
select 'PASS: 24h recent view, 8-day cleanup, archive, one-year retention, repeat run and legal hold; all changes rolled back' as result;
