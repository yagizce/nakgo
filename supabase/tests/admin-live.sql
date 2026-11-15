-- Live admin page and Call/WhatsApp counting. Synthetic accounts and rows only; everything rolls back.
begin;
do $$
declare admin uuid:=(select user_id from private.admin_members where active limit 1);
 owner uuid:=gen_random_uuid(); reader uuid:=gen_random_uuid(); at timestamptz:=statement_timestamp();
 l_load bigint; l_truck bigint; l_gone bigint; l_old bigint; r jsonb; before jsonb; before_truck jsonb;
begin
 if admin is null then raise exception 'One administrator required'; end if;
 insert into auth.users(id,email_confirmed_at) values(owner,at),(reader,at);
 perform set_config('request.jwt.claim.sub',admin::text,true);
 before:=public.nakgo_admin_live('');before_truck:=public.nakgo_admin_live('truck');
 perform set_config('request.jwt.claim.sub',owner::text,true);
 set local role authenticated;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,loading_text,contact_phone,contact_consent,owner_label)
  values('load','Hakkari','Kilis','Tır','Tenteli',1,'Yük','bugün','+905321234567',true,'Canlı Deneme') returning id into l_load;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,owner_label,available_on,contact_phone,contact_consent)
  values('truck','Hakkari','Iğdır','Kamyon','Tenteli',1,'','Canlı Deneme',current_date+1,'+905321234567',true) returning id into l_truck;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,loading_text,owner_label)
  values('load','Hakkari','Kilis','Tır','Tenteli',1,'Yük','bugün','Canlı Deneme') returning id into l_gone;
 insert into public.listings(kind,from_city,to_city,vehicle,body,amount,cargo,loading_text,owner_label)
  values('load','Hakkari','Kilis','Tır','Tenteli',1,'Yük','bugün','Canlı Deneme') returning id into l_old;
 -- The owner's own number is never counted.
 if public.nakgo_listing_contact(l_load,'call') is distinct from '+905321234567' then raise exception 'FAIL owner contact'; end if;
 reset role;
 alter table public.listings disable trigger user;
 update public.listings set created_at=at-interval '3 days',expires_at=at-interval '3 days' where id=l_old;
 alter table public.listings enable trigger user;
 perform set_config('request.jwt.claim.sub',admin::text,true);
 perform public.nakgo_admin_moderate('listing',l_gone::text,'remove','Canlı deneme',0);
 if (public.nakgo_admin_live('')->>'calls')::int<>(before->>'calls')::int then raise exception 'FAIL owner click counted'; end if;

 -- Reader: two calls and one WhatsApp; no channel (older app) and refused listings are not counted.
 perform set_config('request.jwt.claim.sub',reader::text,true);
 set local role authenticated;
 perform public.nakgo_listing_contact(l_load,'call');
 perform public.nakgo_listing_contact(l_load,'call');
 perform public.nakgo_listing_contact(l_truck,'whatsapp');
 perform public.nakgo_listing_contact(l_load);
 perform public.nakgo_listing_contact(l_load,'sms');
 begin perform public.nakgo_listing_contact(l_gone,'call');raise exception 'FAIL removed listing contact';exception when insufficient_privilege then null;end;
 begin perform count(*) from private.contact_clicks;raise exception 'FAIL clicks readable';exception when insufficient_privilege then null;end;
 begin perform public.nakgo_admin_live('');raise exception 'FAIL reader live access';exception when insufficient_privilege then null;end;
 reset role;
 begin perform public.nakgo_admin_live('');raise exception 'FAIL non-admin live access';exception when insufficient_privilege then null;end;

 perform set_config('request.jwt.claim.sub',admin::text,true);
 set local role authenticated;
 r:=public.nakgo_admin_live('');
 if (r->>'calls')::int-(before->>'calls')::int<>2 or (r->>'whatsapp')::int-(before->>'whatsapp')::int<>1 then raise exception 'FAIL click counts % %',before,r; end if;
 if (r->>'today')::int-(before->>'today')::int<>3 or (r->>'last_hour')::int-(before->>'last_hour')::int<>3 then raise exception 'FAIL today counts %',r; end if;
 if (r->>'active')::int-(before->>'active')::int<>2 then raise exception 'FAIL active count %',r; end if;
 if jsonb_array_length(r->'hours')<>24 or jsonb_array_length(r->'minutes')<>60 or (r->'minutes'->>59)::int<1 then raise exception 'FAIL series %',r; end if;
 if not r->'recent' @> jsonb_build_array(jsonb_build_object('id',l_load)) or r->'recent' @> jsonb_build_array(jsonb_build_object('id',l_gone))
  or r->'recent' @> jsonb_build_array(jsonb_build_object('id',l_old)) then raise exception 'FAIL recent feed %',r->'recent'; end if;
 if r::text like '%Canlı Deneme%' or r::text like '%+90%' then raise exception 'FAIL personal data in live page'; end if;
 if (r->'from_cities'->>'Hakkari')::int-coalesce((before->'from_cities'->>'Hakkari')::int,0)<>2 or (r->'to_cities'->>'Iğdır')::int<1 then raise exception 'FAIL city counts %',r; end if;
 r:=public.nakgo_admin_live('truck');
 if (r->>'calls')::int<>(before_truck->>'calls')::int or (r->>'whatsapp')::int-(before_truck->>'whatsapp')::int<>1 then raise exception 'FAIL truck filter %',r; end if;
 if r->'recent' @> jsonb_build_array(jsonb_build_object('id',l_load)) or not r->'recent' @> jsonb_build_array(jsonb_build_object('id',l_truck)) then raise exception 'FAIL kind filter %',r; end if;
 begin perform public.nakgo_admin_live('other');raise exception 'FAIL invalid kind';exception when invalid_parameter_value then null;end;
 reset role;
end $$;
rollback;
