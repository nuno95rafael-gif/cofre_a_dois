-- Cofre a Dois — esquema inicial
-- Um "agregado" (household) tem no máximo 2 membros: u1 (quem cria) e u2 (quem entra com o código).
-- Todos os dados da app vivem na tabela "records" (um registo JSON por item),
-- com visibilidade "shared" (os dois veem) ou "private" (só o dono vê).

create extension if not exists pgcrypto;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Cofre a Dois',
  invite_code text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 6)),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  slot text not null check (slot in ('u1','u2')),
  display_name text not null check (char_length(display_name) between 1 and 40),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (household_id, slot),
  unique (user_id) -- cada pessoa pertence a um só cofre
);

create table public.records (
  household_id uuid not null references public.households(id) on delete cascade,
  kind text not null check (kind in ('expense','recurring','settlement','template','budget','goal','income_source','income_entry','category')),
  id text not null check (char_length(id) between 1 and 120),
  visibility text not null check (visibility in ('shared','private')),
  owner_slot text check (owner_slot in ('u1','u2')),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (household_id, kind, id),
  check (visibility = 'shared' or owner_slot is not null)
);
create index records_household_idx on public.records (household_id);

-- ---------- funções auxiliares (security definer para evitar recursão nas políticas) ----------
create or replace function public.my_slot(hid uuid)
returns text language sql stable security definer set search_path = public as $$
  select slot from public.members where household_id = hid and user_id = auth.uid()
$$;

create or replace function public.is_member(hid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where household_id = hid and user_id = auth.uid())
$$;

create or replace function public.can_see(hid uuid, vis text, owner text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_member(hid) and (vis = 'shared' or owner = public.my_slot(hid))
$$;

create or replace function public.touch_record()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger records_touch before insert or update on public.records
  for each row execute function public.touch_record();

-- Criar cofre (quem cria fica como u1)
create or replace function public.create_household(p_display_name text)
returns public.households language plpgsql security definer set search_path = public as $$
declare h public.households;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    raise exception 'Já pertences a um cofre';
  end if;
  insert into public.households (created_by) values (auth.uid()) returning * into h;
  insert into public.members (household_id, user_id, slot, display_name)
    values (h.id, auth.uid(), 'u1', trim(p_display_name));
  return h;
end $$;

-- Entrar num cofre com o código (fica como u2)
create or replace function public.join_household(p_code text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'Sessão inválida'; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    raise exception 'Já pertences a um cofre';
  end if;
  select id into hid from public.households where invite_code = upper(trim(p_code));
  if hid is null then raise exception 'Código inválido'; end if;
  if (select count(*) from public.members where household_id = hid) >= 2 then
    raise exception 'Este cofre já tem duas pessoas';
  end if;
  insert into public.members (household_id, user_id, slot, display_name)
    values (hid, auth.uid(), 'u2', trim(p_display_name));
  return hid;
end $$;

revoke all on function public.create_household(text) from public, anon;
revoke all on function public.join_household(text, text) from public, anon;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.join_household(text, text) to authenticated;
revoke all on function public.my_slot(uuid) from public, anon;
revoke all on function public.is_member(uuid) from public, anon;
revoke all on function public.can_see(uuid, text, text) from public, anon;
grant execute on function public.my_slot(uuid) to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.can_see(uuid, text, text) to authenticated;

-- ---------- RLS ----------
alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.records enable row level security;

create policy "membros veem o seu cofre" on public.households
  for select to authenticated using (public.is_member(id));

create policy "membros veem os membros do cofre" on public.members
  for select to authenticated using (public.is_member(household_id));
create policy "cada um muda o seu nome" on public.members
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "ler registos visíveis" on public.records
  for select to authenticated using (public.can_see(household_id, visibility, owner_slot));
create policy "criar registos" on public.records
  for insert to authenticated with check (public.can_see(household_id, visibility, owner_slot));
create policy "alterar registos" on public.records
  for update to authenticated
  using (public.can_see(household_id, visibility, owner_slot))
  with check (public.can_see(household_id, visibility, owner_slot));
create policy "apagar registos" on public.records
  for delete to authenticated using (public.can_see(household_id, visibility, owner_slot));

-- Tempo real (o Realtime respeita as políticas RLS acima)
alter publication supabase_realtime add table public.records;
alter publication supabase_realtime add table public.members;

-- ---------- Fotos (Storage) ----------
-- Caminho: <household_id>/shared/<id>.jpg  ou  <household_id>/<u1|u2>/<id>.jpg (privadas)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create or replace function public.can_use_photo(path text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare parts text[]; hid uuid;
begin
  parts := string_to_array(path, '/');
  if array_length(parts, 1) <> 3 then return false; end if;
  begin hid := parts[1]::uuid; exception when others then return false; end;
  return public.is_member(hid) and (parts[2] = 'shared' or parts[2] = public.my_slot(hid));
end $$;
revoke all on function public.can_use_photo(text) from public, anon;
grant execute on function public.can_use_photo(text) to authenticated;

create policy "fotos: ler" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.can_use_photo(name));
create policy "fotos: enviar" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.can_use_photo(name));
create policy "fotos: alterar" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and public.can_use_photo(name))
  with check (bucket_id = 'photos' and public.can_use_photo(name));
create policy "fotos: apagar" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.can_use_photo(name));
