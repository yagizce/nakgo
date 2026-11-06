begin;
create function public.nakgo_close_listing(p_id bigint,p_status text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare l public.listings;
begin
 perform private.require_activity(auth.uid());
 if p_status is null or p_status not in ('closed','archived') then raise exception 'Invalid close action' using errcode='22023';end if;
 select * into l from public.listings where id=p_id and owner_id=auth.uid() and status='active'
 and expires_at>statement_timestamp() and content_redacted_at is null for update;
 if not found then raise exception 'Listing unavailable' using errcode='42501';end if;
 update public.listings set status=p_status where id=p_id;
 return jsonb_build_object('id',p_id,'status',p_status);
end $$;
revoke all on function public.nakgo_close_listing(bigint,text) from public,anon;
grant execute on function public.nakgo_close_listing(bigint,text) to authenticated;
commit;
