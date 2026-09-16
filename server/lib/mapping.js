/**
 * mapping.js — раскладка собранного инвентаря по документам базы.
 *
 * Принимает JSON, который собрал collect.js расширения:
 *   {user, friends, businesses[], ad_accounts[], pages[], pixels[]}
 * и возвращает список записей [{collection, id, data}] для слияния в базу.
 *
 * Правила (их легко нарушить при правке, поэтому они здесь же):
 *   * денежные поля Graph API приходят в ЦЕНТАХ -> делим на 100, пишем числом
 *     в долларах, чтобы колонка сортировалась как число, а не как текст;
 *   * adtrust_dsl уже в долларах;
 *   * account_status / disable_reason — числовые коды, разворачиваем в текст;
 *   * все id пишем строкой: длинные числа теряют точность;
 *   * связи c_acc / c_bm — массивы вида ["fb_<id>"] / ["bm_<id>"], это формат
 *     колонки-ссылки в приложении;
 *   * пустые ячейки не пишем вовсе, иначе слияние затрёт пустотой то, что
 *     человек заполнил руками (логины, пароли, заметки).
 *
 * Логика перенесена без изменений из варианта на Firebase и покрыта
 * тестами в test/mapping.test.js.
 */

"use strict";

/* ---------- справочники кодов ---------- */

const STATUS = {
  1: "активна", 2: "отключена", 3: "не оплачен", 7: "на проверке риска",
  8: "ожидает оплаты", 9: "грейс-период", 100: "ожидает закрытия",
  101: "закрыта", 201: "актив", 202: "закрыт",
};

const DISABLE = {
  0: "", 1: "нарушение реклполитики", 2: "проверка IP", 3: "риск по оплате",
  4: "серый аккаунт закрыт", 5: "AFC-ревью", 6: "проверка бизнеса",
  7: "перманентно закрыт", 8: "неиспользуемый (реселлер)", 9: "неиспользуемый",
};

/* ---------- форматтеры ---------- */

const NOW = () => new Date().toISOString();
const TODAY = () => NOW().slice(0, 10);
const d10 = (s) => String(s || "").slice(0, 10);

/**
 * Число или null. Осторожно: Number("") === 0, поэтому пустое значение
 * отсекаем ДО приведения — иначе отсутствующая сумма записалась бы нулём.
 */
const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** центы -> доллары числом */
const money = (v) => {
  const n = num(v);
  return n === null ? null : Math.round(n) / 100;
};

/** spend_cap: 0 означает «лимита нет» */
const cap = (v) => {
  const n = num(v);
  return (n === null || n === 0) ? null : Math.round(n) / 100;
};

/** adtrust_dsl уже в долларах */
const dsl = (v) => {
  const n = num(v);
  return n === null ? null : Math.round(n * 100) / 100;
};

const st = (s) => {
  if (s === null || s === undefined || s === "") return "";
  const k = String(s);
  return STATUS[k] !== undefined ? STATUS[k] : `код ${k}`;
};

const dis = (d) => {
  if (d === null || d === undefined || d === "") return "";
  const k = String(d);
  return DISABLE[k] !== undefined ? DISABLE[k] : `код ${k}`;
};

/** способ оплаты: "Visa *1234 (CREDIT_CARD)" */
function funding(a) {
  const f = a.funding_source_details;
  if (f && typeof f === "object") {
    const s = f.display_string || "";
    const t = f.type || "";
    return (s + (t ? ` (${t})` : "")).trim();
  }
  return "";
}

/** убрать пустые ячейки, чтобы merge не писал мусор поверх ручных данных */
function clean(cells) {
  const out = {};
  for (const k of Object.keys(cells)) {
    const v = cells[k];
    if (v === "" || v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

/* ---------- детерминированные id документов ---------- */

const accDoc = (fbUserId) => `fb_${fbUserId}`;
const aaDoc = (accountId) => `aa_${accountId}`;
const bmDoc = (bmId) => `bm_${bmId}`;
const fpDoc = (pageId) => `fp_${pageId}`;
const pxDoc = (pixelId) => `px_${pixelId}`;

/** ссылка на строку таблицы «БМы» в формате колонки link */
const bmLink = (bm) => (bm ? [bmDoc(String(bm))] : null);

/* ---------- маппинг сущностей -> ячейки документа ---------- */

function mapAccount(inv) {
  const u = inv.user || {};
  const pic = (((u.picture || {}).data) || {}).url || "";
  const b = inv.businesses || [];
  const a = inv.ad_accounts || [];
  const p = inv.pages || [];
  const x = inv.pixels || [];
  return ["t_acc", accDoc(String(u.id || "")), clean({
    c_fbid: String(u.id || ""),
    c_fbname: u.name || "",
    c_via_first: u.first_name || "",
    c_via_last: u.last_name || "",
    c_via_link: u.link || "",
    c_via_avatar: pic,
    c_friends: num(inv.friends),
    c_counts: `БМ ${b.length} · РК ${a.length} · ФП ${p.length} · PX ${x.length}`,
    c_collected: TODAY(),
  })];
}

function mapAdAccount(a, acc) {
  return ["t_ads", aaDoc(String(a.account_id || a.id)), clean({
    c_act_id: String(a.id || ""),
    c_account_id: String(a.account_id || ""),
    c_name: a.name || "",
    c_account_status: st(a.account_status),
    c_disable_reason: dis(a.disable_reason),
    c_currency: a.currency || "",
    c_amount_spent: money(a.amount_spent),
    c_spend_cap: cap(a.spend_cap),
    c_spend_limit: dsl(a.adtrust_dsl),
    c_balance: money(a.balance),
    c_created_time: d10(a.created_time),
    c_age: num(a.age),
    c_timezone_name: a.timezone_name || "",
    c_is_prepay: !!a.is_prepay_account,
    c_funding_details: funding(a),
    c_user_tasks: (a.user_tasks || []).join(", "),
    c_min_daily_budget: money(a.min_daily_budget),
    c_min_camp_spend_cap: money(a.min_campaign_group_spend_cap),
    c_is_personal: !!a.is_personal,
    c_is_client: !!a.client,
    c_biz_name: a.business_name || "",
    c_biz_country: a.business_country_code || "",
    c_biz_city: a.business_city || "",
    c_bm: bmLink(a.bm),
    c_acc: [acc],
  })];
}

function mapBusiness(b, acc, adAccounts, pages, pixels) {
  const aa = adAccounts.filter((x) => x.bm === b.id)
      .map((x) => `${x.name || ""} (${st(x.account_status)})`);
  const pg = pages.filter((x) => x.bm === b.id)
      .map((x) => `${x.name || ""} (${x.fan_count || 0} фан.)`);
  const px = pixels.filter((x) => x.bm === b.id).map((x) => x.name || "");
  const users = (b.users || [])
      .map((u) => `${u.name || ""} <${u.email || ""}> ${u.role || ""}`.trim())
      .join("; ");
  const child = (b.child_businesses || []).map((x) => x.name || "").join("; ");
  const pp = (b.primary_page && typeof b.primary_page === "object")
      ? (b.primary_page.name || "") : "";
  return ["t_bm", bmDoc(String(b.id)), clean({
    c_bm_id: String(b.id),
    c_bm_name: b.name || "",
    c_verif_status: b.verification_status || "",
    c_two_factor: b.two_factor_type || "",
    c_created_time: d10(b.created_time),
    c_updated_time: d10(b.updated_time),
    c_primary_page: pp,
    c_is_hidden: !!b.is_hidden,
    c_link: b.link || "",
    c_profile_pic: b.profile_picture_uri || "",
    c_owned_adaccounts: aa.join("; "),
    c_owned_pages: pg.join("; "),
    c_owned_pixels: px.join("; "),
    c_business_users: users,
    c_owned_businesses: child,
    c_acc: [acc],
  })];
}

function mapPage(p, acc) {
  const picu = (((p.picture || {}).data) || {}).url || "";
  const cov = (p.cover && typeof p.cover === "object") ? (p.cover.source || "") : "";
  const eng = (p.engagement && typeof p.engagement === "object") ? p.engagement.count : "";
  const catl = (p.category_list || [])
      .filter((c) => c && typeof c === "object").map((c) => c.name || "").join("; ");
  const l = p.location;
  const loc = (l && typeof l === "object")
      ? ["city", "country"].map((k) => l[k]).filter(Boolean).join(", ") : "";
  const ig = (p.instagram_business_account && typeof p.instagram_business_account === "object")
      ? (p.instagram_business_account.username || p.instagram_business_account.id || "")
      : "";
  return ["t_fp", fpDoc(String(p.id)), clean({
    c_page_id: String(p.id),
    c_name: p.name || "",
    c_username: p.username || "",
    c_link: p.link || "",
    c_category: p.category || "",
    c_category_list: catl,
    c_tasks: (p.tasks || []).join(", "),
    c_is_published: !!p.is_published,
    c_verification_status: p.verification_status || "",
    c_fan_count: num(p.fan_count),
    c_followers_count: num(p.followers_count),
    c_talking_about_count: num(p.talking_about_count),
    c_created_time: d10(p.created_time),
    c_picture: picu,
    c_cover: cov,
    c_engagement: (eng === "" || eng === null || eng === undefined) ? "" : String(eng),
    c_instagram: ig,
    c_about: p.about || "",
    c_description: p.description || "",
    c_website: p.website || "",
    c_phone: p.phone || "",
    c_location: loc,
    c_single_line_address: p.single_line_address || "",
    c_bm: bmLink(p.bm),
    c_acc: [acc],
  })];
}

function mapPixel(x, acc) {
  const ownerBm = (x.owner_business && typeof x.owner_business === "object")
      ? x.owner_business.id : "";
  return ["t_pixel", pxDoc(String(x.id)), clean({
    c_pixel_id: String(x.id),
    c_name: x.name || "",
    c_is_unavailable: !!x.is_unavailable,
    c_last_fired_time: d10(x.last_fired_time),
    c_creation_time: d10(x.creation_time),
    c_data_use_setting: x.data_use_setting || "",
    c_enable_automatic_matching: !!x.enable_automatic_matching,
    c_first_party_cookie_status: x.first_party_cookie_status || "",
    c_is_created_by_business: !!x.is_created_by_business,
    c_has_1p_pixel_event: !!x.has_1p_pixel_event,
    c_is_crm: !!x.is_crm,
    c_code: String(x.code || "").slice(0, 280),
    c_description: x.description || "",
    c_bm: bmLink(x.bm || ownerBm),
    c_acc: [acc],
  })];
}

/** разложить инвентарь одного аккаунта в список записей [tableId, docId, cells] */
function mapInventory(inv) {
  const u = inv.user || {};
  const acc = accDoc(String(u.id));
  const ads = inv.ad_accounts || [];
  const bms = inv.businesses || [];
  const pages = inv.pages || [];
  const pixels = inv.pixels || [];
  const out = [mapAccount(inv)];
  for (const a of ads) out.push(mapAdAccount(a, acc));
  for (const b of bms) out.push(mapBusiness(b, acc, ads, pages, pixels));
  for (const p of pages) out.push(mapPage(p, acc));
  for (const x of pixels) out.push(mapPixel(x, acc));
  return out;
}

/** разложить инвентарь в записи для базы: [{collection, id, data}] */
function inventoryRecords(inv) {
  return mapInventory(inv).map(([tid, docId, cells]) => ({
    collection: `tables/${tid}/rows`,
    id: docId,
    data: {c: cells, uat: NOW(), uby: "авто-синк"},
  }));
}

module.exports = {
  inventoryRecords, mapInventory, money, cap, dsl, num, st, dis, clean, funding,
  accDoc, aaDoc, bmDoc, fpDoc, pxDoc, NOW, TODAY,
};
