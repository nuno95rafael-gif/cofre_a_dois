# Cofre a Dois

App web (PWA) para as finanças de um casal:

- **Espaço Casal** (os dois veem): despesas partilhadas com divisão 50/50, percentagem ou valor fixo,
  estado pago / por pagar, saldo entre os dois e "acertar contas", gastos fixos (mensais a anuais),
  orçamentos por categoria e objetivos de poupança.
- **Espaço Pessoal** (só o próprio vê): despesas e fixos pessoais, ganhos (fixos, por unidade
  como consultas, ou pontuais), balanço do mês, orçamentos e objetivos pessoais.
- Fotos de talões e faturas, notas, pesquisa, despesas frequentes, modo claro/escuro,
  formato próprio para telemóvel e para computador.

## Arquitetura

- **Frontend estático**: `index.html`, `css/app.css`, `js/app.js` (interface) e `js/cloud.js`
  (autenticação, cofre do casal e sincronização). Não há passo de build.
  A biblioteca `supabase-js` está incluída em `js/vendor/` (licença MIT).
- **Supabase**: autenticação por email + palavra-passe, base de dados Postgres e Storage (fotos).
  - `households` / `members`: cada cofre tem no máximo 2 pessoas (`u1` cria, `u2` entra com código).
  - `records`: um registo JSON por item (`kind` = expense, recurring, settlement, template, budget,
    goal, income_source, income_entry, category), com `visibility` = `shared` ou `private`.
  - As políticas **RLS** garantem que os registos `private` só são visíveis para o dono,
    e os `shared` para os dois membros do cofre. O mesmo vale para as fotos
    (`<cofre>/shared/...` vs `<cofre>/<u1|u2>/...`).
  - O esquema completo está em `supabase/migrations/`.
- **Vercel**: alojamento estático (`vercel.json`).

## Configuração

1. Aplicar por ordem as migrações em `supabase/migrations/` no projeto Supabase.
2. Em *Authentication → Sign In / Providers → Email*, desativar **Confirm email**
   (o servidor de email incluído no Supabase só envia emails para membros da organização),
   ou configurar um SMTP próprio.
3. Em *Authentication → URL Configuration*, pôr o **Site URL** com o endereço do Vercel.
4. Preencher `js/config.js` com o URL do projeto e a chave pública (*publishable* / *anon*).
   Estes valores são públicos por natureza; a segurança vem das políticas RLS.

## Desenvolvimento local

Qualquer servidor estático serve, por exemplo:

```sh
python3 -m http.server 8080
```

## Notificações (Web Push)

- A app pede autorização em *Definições → Notificações* e guarda a subscrição do dispositivo
  (`push_subscriptions`, via `save_push_subscription`). No iPhone só funciona com a app
  instalada no ecrã principal (iOS 16.4+).
- A Edge Function `supabase/functions/notify` envia os avisos:
  - imediatos, por um gatilho em `records` (despesa partilhada ou acerto criado pela outra pessoa);
  - diários às 09:00 UTC, pelo `pg_cron` (contas a vencer em 3 dias / em atraso, orçamentos ≥ 80% e ≥ 100%).
- Segredos no **Supabase Vault** (`vapid_public`, `vapid_private`, `notify_secret`) — nunca no repositório.
  A chave pública VAPID está também em `js/config.js` (é pública por natureza).
