alter table public.members
  add column avatar_path text
  check (avatar_path is null or avatar_path ~ '^[0-9a-f-]{36}/shared/avatar_u[12]_[A-Za-z0-9-]+\.jpg$');

-- cada pessoa só pode alterar o seu nome e a sua foto (não o cofre, o lugar ou o utilizador)
revoke update on public.members from authenticated, anon;
grant update (display_name, avatar_path) on public.members to authenticated;
