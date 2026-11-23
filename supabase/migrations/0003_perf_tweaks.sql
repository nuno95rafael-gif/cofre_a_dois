drop policy "cada um muda o seu nome" on public.members;
create policy "cada um muda o seu nome" on public.members
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create index if not exists households_created_by_idx on public.households (created_by);
-- a chave primária (household_id, kind, id) já serve as pesquisas por household_id
drop index if exists public.records_household_idx;
