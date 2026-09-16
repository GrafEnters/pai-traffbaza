/**
 * test.js — проверка раскладки инвентаря без Firebase и без сети.
 * Запуск: node functions/test.js   (нужен `npm i` в functions/)
 *
 * Проверяем то, на чём легко ошибиться при портировании:
 * центы/доллары, коды статусов, формат связей, детерминированные id,
 * отсутствие пустых ячеек (иначе merge затирал бы ручные данные пустотой).
 */

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "test-project";

const {_internals} = require("./index");
const {mapInventory, money, cap, dsl, st, dis} = _internals;

let failed = 0;
function ok(name, cond, extra) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${extra !== undefined ? ` -> ${JSON.stringify(extra)}` : ""}`);
  }
}

/* ---------- форматтеры ---------- */

console.log("форматтеры");
ok("центы -> доллары числом", money("123456") === 1234.56, money("123456"));
ok("пустые деньги -> null", money("") === null && money(null) === null);
ok("spend_cap 0 = лимита нет", cap("0") === null && cap(0) === null);
ok("spend_cap значение", cap("5000") === 50);
ok("adtrust_dsl уже в долларах", dsl("250") === 250 && dsl(1500.5) === 1500.5);
ok("статус 1 -> активна", st(1) === "активна" && st("1") === "активна");
ok("неизвестный статус -> код", st(42) === "код 42");
ok("пустой статус -> пусто", st("") === "" && st(null) === "");
ok("disable_reason 0 -> пусто", dis(0) === "");
ok("disable_reason 1 -> текст", dis(1) === "нарушение реклполитики");

/* ---------- инвентарь ---------- */

const INV = {
  user: {
    id: "100077712345678", name: "Polina Test", first_name: "Polina", last_name: "Test",
    link: "https://facebook.com/pt", picture: {data: {url: "https://cdn/pic.jpg"}},
  },
  friends: 412,
  businesses: [{
    id: "9001", name: "Main BM", verification_status: "verified", two_factor_type: "none",
    created_time: "2024-03-11T10:00:00+0000", updated_time: "2026-01-02T10:00:00+0000",
    primary_page: {id: "5001", name: "Primary Page"}, is_hidden: false,
    link: "https://business.facebook.com/9001", profile_picture_uri: "https://cdn/bm.jpg",
    users: [{name: "Polina", email: "p@example.com", role: "ADMIN"}],
    child_businesses: [{id: "9002", name: "Child BM"}],
  }],
  ad_accounts: [{
    id: "act_7001", account_id: "7001", name: "Кабинет 1", account_status: 1, disable_reason: 0,
    currency: "USD", amount_spent: "123456", spend_cap: "0", balance: "2500",
    adtrust_dsl: 250, created_time: "2025-06-01T12:00:00+0000", age: 380,
    timezone_name: "Europe/Kiev", is_prepay_account: true,
    funding_source_details: {display_string: "Visa *1234", type: "CREDIT_CARD"},
    user_tasks: ["MANAGE", "ADVERTISE"], min_daily_budget: "100",
    is_personal: 0, business_name: "ООО Ромашка", business_country_code: "UA",
    business_city: "Kyiv", bm: "9001", client: false,
  }, {
    id: "act_7002", account_id: "7002", name: "Личка без БМ", account_status: 2,
    disable_reason: 1, currency: "EUR", amount_spent: "0", bm: "", client: true,
  }],
  pages: [{
    id: "5001", name: "Primary Page", username: "primary", link: "https://fb.com/primary",
    category: "Shopping", category_list: [{id: "1", name: "Retail"}], tasks: ["MANAGE"],
    is_published: true, fan_count: 1500, followers_count: 1600,
    created_time: "2024-05-05T00:00:00+0000", picture: {data: {url: "https://cdn/pg.jpg"}},
    cover: {source: "https://cdn/cover.jpg"}, engagement: {count: 17},
    location: {city: "Kyiv", country: "Ukraine", zip: "01001"},
    instagram_business_account: {id: "ig1", username: "primary_ig"}, bm: "9001",
  }, {
    id: "5002", name: "Личная страница", bm: "",
  }],
  pixels: [{
    id: "3001", name: "PX main", is_unavailable: false,
    last_fired_time: "2026-09-10T08:30:00+0000", creation_time: "2025-01-02T00:00:00+0000",
    data_use_setting: "ADVERTISING_AND_ANALYTICS", enable_automatic_matching: true,
    owner_business: {id: "9001", name: "Main BM"}, code: "x".repeat(400), bm: "9001",
  }],
};

const recs = mapInventory(INV);
const byId = Object.fromEntries(recs.map(([tid, did, cells]) => [did, {tid, cells}]));

console.log("\nраскладка");
ok("всего записей: 1 акк + 2 РК + 1 БМ + 2 ФП + 1 PX", recs.length === 7, recs.length);
ok("id аккаунта детерминированный", !!byId["fb_100077712345678"]);
ok("id кабинета по account_id", byId["aa_7001"] && byId["aa_7001"].tid === "t_ads");
ok("id БМ", !!byId["bm_9001"]);
ok("id страницы", !!byId["fp_5001"]);
ok("id пикселя", !!byId["px_3001"]);

const acc = byId["fb_100077712345678"].cells;
console.log("\nаккаунт");
ok("fbid строкой", acc.c_fbid === "100077712345678");
ok("друзья числом", acc.c_friends === 412);
ok("сводка ассетов", acc.c_counts === "БМ 1 · РК 2 · ФП 2 · PX 1", acc.c_counts);
ok("аватар вытащен из picture.data.url", acc.c_via_avatar === "https://cdn/pic.jpg");
ok("дата сбора заполнена", /^\d{4}-\d{2}-\d{2}$/.test(acc.c_collected));

const aa = byId["aa_7001"].cells;
console.log("\nкабинет");
ok("потрачено в долларах числом", aa.c_amount_spent === 1234.56, aa.c_amount_spent);
ok("задолженность в долларах", aa.c_balance === 25);
ok("spend_cap = 0 выброшен", !("c_spend_cap" in aa));
ok("лимит из adtrust_dsl", aa.c_spend_limit === 250);
ok("статус текстом", aa.c_account_status === "активна");
ok("disable_reason 0 выброшен", !("c_disable_reason" in aa));
ok("дата обрезана до YYYY-MM-DD", aa.c_created_time === "2025-06-01");
ok("способ оплаты собран", aa.c_funding_details === "Visa *1234 (CREDIT_CARD)", aa.c_funding_details);
ok("права строкой", aa.c_user_tasks === "MANAGE, ADVERTISE");
ok("связь с аккаунтом — массив", Array.isArray(aa.c_acc) && aa.c_acc[0] === "fb_100077712345678");
ok("связь с БМ — массив", Array.isArray(aa.c_bm) && aa.c_bm[0] === "bm_9001", aa.c_bm);
ok("is_personal стал булевым", aa.c_is_personal === false);

const aa2 = byId["aa_7002"].cells;
ok("кабинет без БМ: связи нет", !("c_bm" in aa2));
ok("клиентский помечен", aa2.c_is_client === true);
ok("disable_reason 1 текстом", aa2.c_disable_reason === "нарушение реклполитики");

const bm = byId["bm_9001"].cells;
console.log("\nБМ");
ok("сводка кабинетов с их статусами", bm.c_owned_adaccounts === "Кабинет 1 (активна)", bm.c_owned_adaccounts);
ok("сводка страниц с фанами", bm.c_owned_pages === "Primary Page (1500 фан.)", bm.c_owned_pages);
ok("пиксели БМ", bm.c_owned_pixels === "PX main");
ok("люди в БМ", bm.c_business_users === "Polina <p@example.com> ADMIN", bm.c_business_users);
ok("дочерние БМ", bm.c_owned_businesses === "Child BM");
ok("основная страница — имя", bm.c_primary_page === "Primary Page");

const fp = byId["fp_5001"].cells;
console.log("\nстраница");
ok("подкатегории", fp.c_category_list === "Retail");
ok("локация город+страна", fp.c_location === "Kyiv, Ukraine", fp.c_location);
ok("обложка", fp.c_cover === "https://cdn/cover.jpg");
ok("вовлечённость строкой", fp.c_engagement === "17");
ok("instagram по username", fp.c_instagram === "primary_ig");
ok("связь с БМ", fp.c_bm[0] === "bm_9001");
ok("страница без БМ: связи нет", !("c_bm" in byId["fp_5002"].cells));

const px = byId["px_3001"].cells;
console.log("\nпиксель");
ok("код обрезан до 280", px.c_code.length === 280);
ok("связь с БМ", px.c_bm[0] === "bm_9001");
ok("дата срабатывания обрезана", px.c_last_fired_time === "2026-09-10");

console.log("\nобщее");
const emptyCells = recs.filter(([, , cells]) =>
  Object.values(cells).some((v) => v === "" || v === null || v === undefined ||
    (Array.isArray(v) && !v.length)));
ok("пустых ячеек нет ни в одной записи", emptyCells.length === 0, emptyCells.length);
const badIds = recs.filter(([, , c]) =>
  ["c_fbid", "c_account_id", "c_bm_id", "c_page_id", "c_pixel_id", "c_act_id"]
      .some((k) => k in c && typeof c[k] !== "string"));
ok("все id — строки", badIds.length === 0);

console.log(failed ? `\n${failed} проверок упало` : "\nвсе проверки прошли");
process.exit(failed ? 1 : 0);
