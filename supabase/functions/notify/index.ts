// Cofre a Dois — envio de notificações push (Web Push).
//
// Chamadas:
//  - {type:"record", record}  pelo gatilho da base de dados quando alguém cria uma despesa
//                             partilhada ou um acerto (avisa a outra pessoa);
//  - {type:"daily"}           pelo pg_cron todos os dias (contas a vencer e orçamentos);
//  - {type:"test"}            pela app, com a sessão do utilizador (envia um teste só para ele).
// "record" e "daily" exigem o cabeçalho x-cofre-secret; "test" exige um JWT válido.
// As chaves VAPID e o segredo vêm do Supabase Vault através de public.notify_config().
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const APP_URL = "https://cofre-a-dois-mocha.vercel.app";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

let cfg: Record<string, string> | null = null;
async function config() {
  if (cfg) return cfg;
  const { data, error } = await db.rpc("notify_config");
  if (error) throw error;
  cfg = data as Record<string, string>;
  webpush.setVapidDetails(APP_URL, cfg.vapid_public, cfg.vapid_private);
  return cfg;
}

const EUR = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });
const eur = (v: number) => EUR.format(v);
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const MAB = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const fShort = (s: string) => `${+s.slice(8, 10)} ${MAB[+s.slice(5, 7) - 1]}`;
const lisbonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date());
const addDays = (s: string, n: number) => {
  const d = new Date(s + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// mesma regra de divisão que a app (js/app.js → shares)
// deno-lint-ignore no-explicit-any
function shares(e: any): { u1: number; u2: number } {
  if (e.scope === "pessoal") return { u1: e.owner === "u1" ? e.amount : 0, u2: e.owner === "u2" ? e.amount : 0 };
  const s = e.split || { type: "equal" };
  let a: number;
  if (s.type === "percent") a = r2(e.amount * s.value / 100);
  else if (s.type === "fixed") a = r2(Math.min(s.value, e.amount));
  else a = r2(e.amount / 2);
  return { u1: a, u2: r2(e.amount - a) };
}

type Payload = { title: string; body: string; tag?: string; url?: string };
type Pref = "partner" | "due" | "budget" | null;

// envia para todos os dispositivos de uma pessoa (respeitando as preferências de cada dispositivo)
async function sendToUser(userId: string, p: Payload, pref: Pref): Promise<number> {
  await config();
  const { data: subs } = await db.from("push_subscriptions").select("endpoint,p256dh,auth,prefs").eq("user_id", userId);
  let sent = 0;
  for (const s of subs || []) {
    if (pref && s.prefs && s.prefs[pref] === false) continue;
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ ...p, url: p.url || APP_URL + "/" }),
        { TTL: 60 * 60 * 24 },
      );
      sent++;
      await db.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).eq("endpoint", s.endpoint);
    } catch (err) {
      // deno-lint-ignore no-explicit-any
      const code = (err as any)?.statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      else console.error("push falhou", code, (err as Error)?.message);
    }
  }
  return sent;
}

// marca um aviso como enviado; devolve false se já tinha sido enviado antes
async function once(userId: string, key: string): Promise<boolean> {
  const { error } = await db.from("notification_log").insert({ user_id: userId, key });
  return !error;
}

async function members(hid: string) {
  const { data } = await db.from("members").select("user_id,slot,display_name").eq("household_id", hid);
  return data || [];
}

// ---------- aviso imediato: despesa partilhada ou acerto criado pela outra pessoa ----------
// deno-lint-ignore no-explicit-any
async function onRecord(r: any) {
  if (!r || r.visibility !== "shared") return;
  const ms = await members(r.household_id);
  const actor = ms.find((m) => m.user_id === r.updated_by);
  const name = (slot: string) => ms.find((m) => m.slot === slot)?.display_name || "A outra pessoa";
  const d = r.data || {};
  for (const m of ms) {
    if (actor && m.user_id === actor.user_id) continue; // não avisa quem fez
    let p: Payload | null = null;
    if (r.kind === "expense") {
      if (String(r.id).startsWith("rec_")) return;
      const mine = shares(d)[m.slot as "u1" | "u2"];
      const who = actor ? actor.display_name : name(d.payer);
      p = {
        title: `💸 ${who} registou uma despesa`,
        body: `${d.desc} · ${eur(d.amount)}${mine ? ` · a tua parte ${eur(mine)}` : ""}`,
        tag: "exp-" + r.id,
      };
    } else if (r.kind === "settlement") {
      p = {
        title: "🤝 Acerto de contas",
        body: `${name(d.from)} pagou ${eur(d.amount)} a ${d.to === m.slot ? "ti" : name(d.to)}${d.note ? ` (${d.note})` : ""}`,
        tag: "set-" + r.id,
      };
    }
    if (p) await sendToUser(m.user_id, p, "partner");
  }
  if (r.kind === "expense") await budgetCheck(r.household_id, d.cat, ms);
}

// ---------- orçamentos (80% e 100%, uma vez por mês cada) ----------
// deno-lint-ignore no-explicit-any
async function budgetCheck(hid: string, onlyCat: string | null, ms: any[]) {
  const month = lisbonToday().slice(0, 7);
  const { data: rows } = await db.from("records").select("kind,visibility,owner_slot,data")
    .eq("household_id", hid).in("kind", ["budget", "expense", "category"]);
  const all = rows || [];
  const catName = (id: string) => all.find((x) => x.kind === "category" && x.data.id === id)?.data.name || id;
  for (const b of all.filter((x) => x.kind === "budget")) {
    const bd = b.data;
    if (onlyCat && bd.cat !== onlyCat) continue;
    if (!(bd.limit > 0)) continue;
    const spent = all.filter((x) => x.kind === "expense" && x.data.cat === bd.cat && String(x.data.date).slice(0, 7) === month &&
      (bd.scope === "partilhada" ? x.data.scope === "partilhada" : (x.data.scope === "pessoal" && x.data.owner === bd.owner)))
      .reduce((a, x) => a + Number(x.data.amount || 0), 0);
    const p = spent / bd.limit;
    if (p < 0.8) continue;
    const level = p >= 1 ? 100 : 80;
    const who = bd.scope === "partilhada" ? ms : ms.filter((m) => m.slot === bd.owner);
    for (const m of who) {
      if (!(await once(m.user_id, `bud${level}:${bd.id}:${month}`))) continue;
      await sendToUser(m.user_id, {
        title: level === 100 ? `⛔ Orçamento ultrapassado` : `⚠ Orçamento a ${Math.round(p * 100)}%`,
        body: `${catName(bd.cat)}${bd.scope === "partilhada" ? " (casal)" : ""}: ${eur(spent)} de ${eur(bd.limit)} este mês`,
        tag: `bud-${bd.id}`,
      }, "budget");
    }
  }
}

// ---------- resumo diário: contas a vencer (3 dias) e em atraso ----------
async function daily() {
  const today = lisbonToday(), lim = addDays(today, 3);
  const { data: hs } = await db.from("households").select("id");
  for (const h of hs || []) {
    const ms = await members(h.id);
    const { data: rows } = await db.from("records").select("kind,id,visibility,owner_slot,data")
      .eq("household_id", h.id).in("kind", ["expense", "recurring"]);
    const recs = new Map((rows || []).filter((x) => x.kind === "recurring").map((x) => [x.id, x.data]));
    // deno-lint-ignore no-explicit-any
    const isAuto = (e: any) => e.recurringId && e.autoPay !== false && recs.get(e.recurringId)?.autoPay !== false;
    const unpaid = (rows || []).filter((x) => x.kind === "expense" && x.data.status !== "pago" && !isAuto(x.data));
    for (const m of ms) {
      const mine = unpaid.filter((x) => x.visibility === "shared" || x.owner_slot === m.slot);
      const soon = mine.filter((x) => x.data.date >= today && x.data.date <= lim);
      const late = mine.filter((x) => x.data.date < today);
      const fresh = [];
      for (const x of soon) if (await once(m.user_id, `due:${x.id}:${x.data.date}`)) fresh.push(x);
      for (const x of late) if (await once(m.user_id, `late:${x.id}`)) fresh.push(x);
      if (fresh.length) {
        fresh.sort((a, b) => a.data.date.localeCompare(b.data.date));
        const list = fresh.slice(0, 4).map((x) => `${x.data.desc} ${eur(x.data.amount)} (${x.data.date < today ? "em atraso" : fShort(x.data.date)})`).join(" · ");
        await sendToUser(m.user_id, {
          title: fresh.length === 1 ? "⏳ Conta por pagar" : `⏳ ${fresh.length} contas por pagar`,
          body: list + (fresh.length > 4 ? " …" : ""),
          tag: "due-" + today,
        }, "due");
      }
    }
    await budgetCheck(h.id, null, ms);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "método" }, 405);
  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { /* vazio */ }
  try {
    if (body.type === "test") {
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: { user } } = await db.auth.getUser(token);
      if (!user) return json({ error: "sessão" }, 401);
      const sent = await sendToUser(user.id, {
        title: "🔔 Cofre a Dois",
        body: "As notificações estão a funcionar neste dispositivo!",
        tag: "test",
      }, null);
      return json({ sent });
    }
    const c = await config();
    if (!c.notify_secret || req.headers.get("x-cofre-secret") !== c.notify_secret) return json({ error: "não autorizado" }, 401);
    if (body.type === "record") await onRecord(body.record);
    else if (body.type === "daily") await daily();
    else return json({ error: "tipo" }, 400);
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
