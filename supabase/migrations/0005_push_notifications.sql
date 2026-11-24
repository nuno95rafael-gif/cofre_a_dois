-- Notificações push (Web Push). Os segredos (chaves VAPID e o segredo partilhado com a função)
-- vivem no Supabase Vault com os nomes: vapid_public, vapid_private, notify_secret.
-- NÃO estão neste ficheiro.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- subscrições (um registo por dispositivo)
create table public.push_subscriptions (
  endpoint text primary key check (endpoint like 'https://%' and char_length(endpoint) < 1000),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  prefs jsonb not null default '{"partner":true,"due":true,"budget":true}',
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
create index push_subscriptions_household_idx on public.push_subscriptions (household_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;
grant update (prefs) on public.push_subscriptions to authenticated;
create policy "ver as minhas subscrições" on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "mudar as minhas preferências" on public.push_subscriptions
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "apagar as minhas subscrições" on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

-- guardar a subscrição deste dispositivo (substitui outra com o mesmo endpoint, p.ex. outra conta no mesmo telemóvel)
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_prefs jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  select household_id into hid from public.members where user_id = auth.uid();
  if hid is null then raise exception 'Sem cofre'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (endpoint, user_id, household_id, p256dh, auth, prefs)
  values (p_endpoint, auth.uid(), hid, p_p256dh, p_auth,
          coalesce(p_prefs, '{"partner":true,"due":true,"budget":true}'::jsonb));
end $$;
revoke all on function public.save_push_subscription(text, text, text, jsonb) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, jsonb) to authenticated;

-- registo do que já foi avisado (para não repetir); só o servidor lhe acede
create table public.notification_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.notification_log enable row level security;
revoke all on public.notification_log from anon, authenticated;

-- configuração para a função "notify" (só o servidor, com a service role)
create or replace function public.notify_config()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets where name in ('vapid_public', 'vapid_private', 'notify_secret')
$$;
revoke all on function public.notify_config() from public, anon, authenticated;
grant execute on function public.notify_config() to service_role;

-- aviso imediato quando alguém cria uma despesa partilhada ou um acerto
create or replace function private.notify_on_record()
returns trigger language plpgsql security definer set search_path = '' as $$
declare sec text;
begin
  if new.visibility <> 'shared' or new.kind not in ('expense', 'settlement') then return new; end if;
  if new.kind = 'expense' and new.id like 'rec\_%' then return new; end if; -- gerada por gasto fixo
  select decrypted_secret into sec from vault.decrypted_secrets where name = 'notify_secret';
  if sec is null then return new; end if;
  perform net.http_post(
    url := 'https://bfseukytmycwizxzxuur.supabase.co/functions/v1/notify',
    body := jsonb_build_object('type', 'record', 'record', to_jsonb(new)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cofre-secret', sec));
  return new;
exception when others then
  return new; -- uma falha nos avisos nunca impede de guardar
end $$;
revoke all on function private.notify_on_record() from public, anon, authenticated;
create trigger records_notify after insert on public.records
  for each row execute function private.notify_on_record();

-- resumo diário às 09:00 UTC (09:00 em Portugal no inverno, 10:00 no verão)
select cron.schedule('cofre-notify-daily', '0 9 * * *', $cron$
  select net.http_post(
    url := 'https://bfseukytmycwizxzxuur.supabase.co/functions/v1/notify',
    body := '{"type":"daily"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cofre-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'notify_secret')))
$cron$);
