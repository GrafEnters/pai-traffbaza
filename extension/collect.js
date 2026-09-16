// collect.js — content-script расширения (Chrome MV3).
// Ставится на страницы Ads Manager / Business Suite. При загрузке страницы:
//   1) снимает EAAB-токен из HTML,
//   2) бьёт Graph API v24 по аккаунту (БМ, кабинеты, страницы, пиксели),
//   3) POST-ит собранный инвентарь на Cloud Function (единственная точка записи).
// Firestore-ключи в расширении НЕ хранятся — только URL функции и общий секрет,
// и оба лежат в config.js (см. config.example.js).
// Поля авто-отбрасываются, если недоступны в v24 (одно «плохое» поле не рушит запрос).

const CFG = self.__SYNC_CONFIG__ || {};
const ENDPOINT = CFG.endpoint || "";
const SHARED_SECRET = CFG.secret || "";
const DEBUG = !!CFG.debug;
const G = "https://graph.facebook.com/v24.0/";

const log = (...a) => { if (DEBUG) console.log("[inventory-sync]", ...a); };

// --- разбор списка полей по запятым на ВЕРХНЕМ уровне (вложенные {...} не трогаем) ---
const splitTop = s => { const o = []; let d = 0, c = ""; for (const ch of s) {
  if (ch === "{") d++; else if (ch === "}") d--; if (ch === "," && d === 0) { o.push(c); c = ""; } else c += ch; }
  if (c) o.push(c); return o; };
const stripField = (f, bad) => splitTop(f).filter(p => p.split("{")[0].trim() !== bad).join(",");

async function g(path, params) {
  try { const r = await fetch(G + path + "?" + params, { credentials: "include" }); return await r.json(); }
  catch (e) { return { error: { message: String(e) } }; }
}
// GET с авто-отбрасыванием несуществующих в v24 полей
async function gf(tok, path, fields, extra) {
  let f = fields;
  for (let i = 0; i < 20; i++) {
    const j = await g(path, "access_token=" + tok + "&fields=" + encodeURIComponent(f) + (extra ? ("&" + extra) : ""));
    const m = (j && j.error && j.error.message || "").match(/nonexisting field \(([^)]+)\)/);
    if (m) { const nf = stripField(f, m[1]); if (nf === f || !nf) return j; f = nf; continue; }
    return j;
  }
  return { data: [] };
}
async function paged(tok, path, fields) {
  let out = [], guard = 0, j = await gf(tok, path, fields, "limit=100");
  while (j && j.data) { out = out.concat(j.data); if (!j.paging || !j.paging.next || ++guard > 25) break;
    try { j = await (await fetch(j.paging.next, { credentials: "include" })).json(); } catch (e) { break; } }
  return out;
}
function grabToken() {
  const set = new Set(); const re = /EAA[A-Za-z0-9]{30,}/g; let m;
  while ((m = re.exec(document.documentElement.innerHTML))) set.add(m[0]);
  const rank = t => t.startsWith("EAAB") ? 3 : t.startsWith("EAAG") ? 2 : t.startsWith("EAAI") ? 1 : 0;
  return [...set].sort((a, b) => (rank(b) - rank(a)) || (b.length - a.length))[0] || "";
}

// --- МАКСИМАЛЬНЫЕ наборы полей Graph API v24 (лишнее авто-отбрасывается) ---
const AA = "id,account_id,name,business{id,name},account_status,disable_reason,currency,amount_spent,spend_cap,balance,adtrust_dsl,created_time,age,timezone_name,is_prepay_account,funding_source_details{id,display_string,type},user_tasks,min_daily_budget,min_campaign_group_spend_cap,is_personal,business_name,business_country_code,business_city,business_state,business_zip,business_street,business_street2,opportunity_score";
const BM = "id,name,verification_status,two_factor_type,created_time,updated_time,primary_page{id,name},is_hidden,link,profile_picture_uri";
const PG = "id,name,username,link,category,category_list{id,name},tasks,is_published,verification_status,fan_count,followers_count,talking_about_count,created_time,picture{url,width,height},cover{source,id},engagement{count,social_sentence},business{id,name},about,description,general_info,website,phone,location{city,country,street,zip,latitude,longitude},single_line_address,connected_instagram_account{id,username},instagram_business_account{id,username}";
const PX = "id,name,last_fired_time,creation_time,is_unavailable,owner_business{id,name},owner_ad_account{id,name},data_use_setting,enable_automatic_matching,automatic_matching_fields,first_party_cookie_status,is_created_by_business,has_1p_pixel_event,is_crm,code,description,usage,event_stats,event_time_min,event_time_max,valid_entries,matched_entries,duplicate_entries,match_rate_approx";

async function collect() {
  const tok = grabToken(); if (!tok) { log("токен не найден на странице"); return null; }
  const me = await gf(tok, "me", "id,name,first_name,last_name,picture{url,width,height},link,friends.summary(true)");
  if (me.error) { log("me упал:", me.error); return null; }
  const out = {
    user: me, friends: (me.friends && me.friends.summary || {}).total_count ?? null,
    businesses: [], ad_accounts: [], pages: [], pixels: [],
  };
  const seenA = new Set(), seenP = new Set(), seenX = new Set();
  const pushA = (a, bm, cl) => { const id = String(a.account_id || a.id || ""); if (id && !seenA.has(id)) { seenA.add(id);
    out.ad_accounts.push(Object.assign({}, a, { id, bm: bm || "", client: !!cl })); } };
  const pushP = (p, bm) => { if (p && p.id && !seenP.has(p.id)) { seenP.add(p.id); out.pages.push(Object.assign({}, p, { bm: bm || "" })); } };
  const pushX = (x, bm) => { if (x && x.id && !seenX.has(x.id)) { seenX.add(x.id); out.pixels.push(Object.assign({}, x, { bm: bm || "" })); } };
  for (const bm of await paged(tok, "me/businesses", BM)) {
    out.businesses.push(bm);
    for (const a of await paged(tok, bm.id + "/owned_ad_accounts", AA)) pushA(a, bm.id, false);
    for (const a of await paged(tok, bm.id + "/client_ad_accounts", AA)) pushA(a, bm.id, true);
    for (const p of await paged(tok, bm.id + "/owned_pages", PG)) pushP(p, bm.id);
    for (const p of await paged(tok, bm.id + "/client_pages", PG)) pushP(p, bm.id);
    for (const e of ["adspixels", "owned_data_sources", "client_data_sources"])
      for (const x of await paged(tok, bm.id + "/" + e, PX)) pushX(x, bm.id);
    bm.child_businesses = await paged(tok, bm.id + "/owned_businesses", "id,name,verification_status");
    bm.users = await paged(tok, bm.id + "/business_users", "id,name,email,role");
  }
  for (const a of await paged(tok, "me/adaccounts", AA)) pushA(a, "", false);
  for (const p of await paged(tok, "me/accounts", PG)) pushP(p, "");
  return out;
}

// не долбить чаще раза в час на один FB-аккаунт.
// Отметку ставим ТОЛЬКО после удачной отправки: если функция недоступна,
// следующая вкладка должна попробовать снова, а не ждать час впустую.
const syncKey = fbid => "lastsync_" + fbid;
async function shouldSync(fbid) {
  const k = syncKey(fbid);
  const st = await chrome.storage.local.get(k);
  return !(st[k] && Date.now() - st[k] < 3600e3);
}
async function markSynced(fbid) {
  await chrome.storage.local.set({ [syncKey(fbid)]: Date.now() });
}

(async () => {
  try {
    if (!ENDPOINT || !SHARED_SECRET || ENDPOINT.indexOf("ЗАМЕНИ") >= 0) {
      log("не настроен config.js — сбор пропущен");
      return;
    }
    // токен снимаем сразу, но сначала дешёвая проверка: не синкали ли недавно
    const tokPeek = grabToken(); if (!tokPeek) { log("токен не найден на странице"); return; }
    const me = await gf(tokPeek, "me", "id");
    if (!me || !me.id) { log("me не отдался — пропускаем"); return; }
    if (!await shouldSync(me.id)) { log("уже синкали этот аккаунт в последний час"); return; }

    const inv = await collect(); if (!inv || !inv.user) return;
    log("собрано:", {
      bm: inv.businesses.length, aa: inv.ad_accounts.length,
      fp: inv.pages.length, px: inv.pixels.length,
    });
    const r = await fetch(ENDPOINT, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: SHARED_SECRET, inv }),
    });
    if (r.ok) await markSynced(inv.user.id);
    log("ответ функции:", r.status, await r.text().catch(() => ""));
  } catch (e) { log("сбор упал:", e); /* сбор best-effort — тихо */ }
})();
