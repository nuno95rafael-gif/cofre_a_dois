-- Funções auxiliares das políticas RLS passam para um esquema não exposto pela API
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.my_slot(hid uuid)
returns text language sql stable security definer set search_path = public as $$
  select slot from public.members where household_id = hid and user_id = auth.uid()
$$;
create or replace function private.is_member(hid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where household_id = hid and user_id = auth.uid())
$$;
create or replace function private.can_see(hid uuid, vis text, owner text)
returns boolean language sql stable security definer set search_path = public as $$
  select private.is_member(hid) and (vis = 'shared' or owner = private.my_slot(hid))
$$;
create or replace function private.can_use_photo(path text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare parts text[]; hid uuid;
begin
  parts := string_to_array(path, '/');
  if array_length(parts, 1) <> 3 then return false; end if;
  begin hid := parts[1]::uuid; exception when others then return false; end;
  return private.is_member(hid) and (parts[2] = 'shared' or parts[2] = private.my_slot(hid));
end $$;
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

drop policy "membros veem o seu cofre" on public.households;
drop policy "membros veem os membros do cofre" on public.members;
drop policy "ler registos visíveis" on public.records;
drop policy "criar registos" on public.records;
drop policy "alterar registos" on public.records;
drop policy "apagar registos" on public.records;
drop policy "fotos: ler" on storage.objects;
drop policy "fotos: enviar" on storage.objects;
drop policy "fotos: alterar" on storage.objects;
drop policy "fotos: apagar" on storage.objects;

create policy "membros veem o seu cofre" on public.households
  for select to authenticated using (private.is_member(id));
create policy "membros veem os membros do cofre" on public.members
  for select to authenticated using (private.is_member(household_id));
create policy "ler registos visíveis" on public.records
  for select to authenticated using (private.can_see(household_id, visibility, owner_slot));
create policy "criar registos" on public.records
  for insert to authenticated with check (private.can_see(household_id, visibility, owner_slot));
create policy "alterar registos" on public.records
  for update to authenticated
  using (private.can_see(household_id, visibility, owner_slot))
  with check (private.can_see(household_id, visibility, owner_slot));
create policy "apagar registos" on public.records
  for delete to authenticated using (private.can_see(household_id, visibility, owner_slot));
create policy "fotos: ler" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and private.can_use_photo(name));
create policy "fotos: enviar" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and private.can_use_photo(name));
create policy "fotos: alterar" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and private.can_use_photo(name))
  with check (bucket_id = 'photos' and private.can_use_photo(name));
create policy "fotos: apagar" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and private.can_use_photo(name));

drop function public.can_see(uuid, text, text);
drop function public.my_slot(uuid);
drop function public.is_member(uuid);
drop function public.can_use_photo(text);
