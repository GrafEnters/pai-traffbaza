/**
 * adapter.test.js — сквозная проверка слоя хранилища на эмуляторах Firebase.
 *
 * Запуск:  cd tests && npm test
 * (поднимает эмуляторы Auth + Firestore, гоняет тест, гасит эмуляторы)
 *
 * Тест грузит НАСТОЯЩИЙ public/adapter.js в Node с лёгкими заглушками браузера,
 * поэтому проверяется именно тот код, который поедет на Hosting. Проверяем:
 *   1) правила Firestore: viewer читает, но не пишет; manager/admin пишут;
 *   2) глубокий merge в .update() — правка одной ячейки не сносит соседние,
 *      правка одной колонки не сносит её name/type (на этом ломался бы
 *      обычный updateDoc с точечным путём);
 *   3) null в .update() удаляет поле (снятие пометки удаления, очистка ячейки,
 *      удаление колонки);
 *   4) onSnapshot отдаёт данные в форме, которую ждёт приложение;
 *   5) авто-синк из Cloud Function пишет с merge и НЕ затирает ручные поля
 *      (логины, пароли, байер), а повторный сбор обновляет, а не дублирует.
 */

const path = require("path");
const fs = require("fs");


const PROJECT = "demo-inventory";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8399";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9399";

const admin = require("firebase-admin");
const firebase = require("firebase/compat/app");
require("firebase/compat/firestore");
require("firebase/compat/auth");

const {TABLES} = require("../../scripts/schema");
const {_internals} = require("../functions/index");

let failed = 0;
const results = [];
function ok(name, cond, extra) {
  if (cond) {
    results.push(`  ok  ${name}`);
  } else {
    failed++;
    results.push(`  FAIL ${name}${extra !== undefined ? ` -> ${JSON.stringify(extra)}` : ""}`);
  }
}
function section(t) {
  results.push(`\n${t}`);
}
async function throws(fn) {
  try {
    await fn();
    return false;
  } catch (e) {
    return true;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- admin SDK: заводим пользователей и данные в обход правил ---------- */

admin.initializeApp({projectId: PROJECT});
const adb = admin.firestore();
const aauth = admin.auth();

async function makeUser(email, role) {
  let u;
  try {
    u = await aauth.getUserByEmail(email);
  } catch (e) {
    u = await aauth.createUser({email, password: "password123", emailVerified: true});
  }
  if (role) {
    await aauth.setCustomUserClaims(u.uid, {role});
    await adb.doc(`users/${u.uid}`).set({email, role}, {merge: true});
  }
  return u;
}

/* ---------- грузим настоящий adapter.js в Node ---------- */

function loadAdapter() {
  // компат-инстансы создаём сами и направляем на эмуляторы, потом подменяем
  // initializeApp, чтобы адаптер не создавал второе приложение
  const app = firebase.initializeApp({apiKey: "fake-api-key", projectId: PROJECT, authDomain: `${PROJECT}.firebaseapp.com`});
  const store = firebase.firestore();
  const [fsHost, fsPort] = process.env.FIRESTORE_EMULATOR_HOST.split(":");
  store.useEmulator(fsHost, Number(fsPort));
  const auth = firebase.auth();
  auth.useEmulator(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, {disableWarnings: true});
  firebase.initializeApp = () => app;

  const listeners = {};
  const documentStub = {
    addEventListener: (ev, fn) => {
      (listeners[ev] = listeners[ev] || []).push(fn);
    },
    getElementById: () => null,
    createElement: () => ({setAttribute() {}, appendChild() {}, click() {}, remove() {}, querySelector: () => null}),
    body: null,
  };
  const windowStub = {
    __FIREBASE_CONFIG__: {apiKey: "fake-api-key", projectId: PROJECT},
  };
  // ВАЖНО: запускаем adapter.js в ТОМ ЖЕ realm, что и SDK. Через vm.createContext
  // объекты получали бы чужой Object.prototype, и Firestore ругался бы на них
  // ("custom Object object") — это была бы поломка теста, а не приложения.
  const code = fs.readFileSync(path.join(__dirname, "..", "adapter.firebase.js"), "utf8");
  // eslint-disable-next-line no-new-func
  new Function("window", "document", "firebase", code)(windowStub, documentStub, firebase);
  return {win: windowStub, auth, store};
}

/* ---------- сценарий ---------- */

(async () => {
  const {win, auth} = loadAdapter();
  ok("adapter.js поднял слой хранилища", !!win.__DB__ && !!win.__AUTH__);
  const db = win.__DB__;

  await makeUser("admin@test.local", "admin");
  await makeUser("manager@test.local", "manager");
  await makeUser("viewer@test.local", "viewer");

  const signIn = (email) => auth.signInWithEmailAndPassword(email, "password123");

  /* --- 1. роли и правила --- */
  section("роли и правила Firestore");

  await signIn("viewer@test.local");
  await sleep(300);
  ok("роль читается из custom claim", (await win.__AUTH__.getRole()) === "viewer");

  // подготовим таблицу от имени admin SDK (как это делает seed.js)
  await adb.doc("tables/t_acc").set({
    name: TABLES.t_acc.name, order: 10, deleted: false, cols: TABLES.t_acc.cols,
  });

  const readAsViewer = await db.doc("tables/t_acc").get();
  ok("viewer видит таблицу", readAsViewer.exists && readAsViewer.data().name === "Аккаунты");
  ok("viewer не может писать", await throws(() =>
    db.doc("tables/t_acc").update({name: "Взломано"})));

  await signIn("manager@test.local");
  await sleep(300);
  ok("роль manager", (await win.__AUTH__.getRole()) === "manager");
  ok("manager может создать запись", !(await throws(() =>
    db.collection("tables/t_acc/rows").add({c: {c_fbname: "Ручной"}, o: 10}))));

  await signIn("admin@test.local");
  await sleep(300);
  ok("роль admin", (await win.__AUTH__.getRole()) === "admin");

  /* --- 2. глубокий merge ячеек --- */
  section("правка ячеек (deep merge)");

  const rid = "fb_TESTUSER";
  const rowPath = `tables/t_acc/rows/${rid}`;
  await db.doc(rowPath).set({
    c: {c_fbname: "Polina", c_login: "polina@mail", c_fbpass: "секрет", c_buyer: "@buyer1"},
    o: 10, at: new Date().toISOString(),
  });

  await db.doc(rowPath).update({c: {c_status: "active"}, uat: "2026-09-17", uby: "Админ"});
  let row = (await db.doc(rowPath).get()).data();
  ok("новая ячейка записалась", row.c.c_status === "active");
  ok("соседние ячейки уцелели", row.c.c_login === "polina@mail" && row.c.c_fbpass === "секрет",
      Object.keys(row.c));
  ok("служебные поля обновились", row.uby === "Админ");

  await db.doc(rowPath).update({c: {c_status: null}});
  row = (await db.doc(rowPath).get()).data();
  ok("null очищает ячейку", !("c_status" in row.c));
  ok("очистка не тронула остальное", row.c.c_fbname === "Polina" && row.c.c_buyer === "@buyer1");

  /* --- 3. корзина: пометка и снятие --- */
  section("корзина");
  await db.doc(rowPath).update({del: true, uat: "2026-09-17"});
  ok("запись помечена удалённой", (await db.doc(rowPath).get()).data().del === true);
  await db.doc(rowPath).update({del: null, uat: "2026-09-17"});
  ok("возврат из корзины снимает пометку", !("del" in (await db.doc(rowPath).get()).data()));

  /* --- 4. глубокий merge колонок --- */
  section("правка колонок (deep merge)");

  await db.doc("tables/t_acc").update({cols: {c_test: {name: "Тестовая", type: "select", order: 500,
    opts: {choices: [{id: "a", label: "А", color: "green"}]}}}});
  let tbl = (await db.doc("tables/t_acc").get()).data();
  ok("колонка добавилась", tbl.cols.c_test && tbl.cols.c_test.type === "select");
  ok("остальные колонки на месте", Object.keys(tbl.cols).length === Object.keys(TABLES.t_acc.cols).length + 1,
      Object.keys(tbl.cols).length);

  // это главный случай: приложение шлёт ТОЛЬКО {order} при перестановке колонок
  await db.doc("tables/t_acc").update({cols: {c_test: {order: 15}}});
  tbl = (await db.doc("tables/t_acc").get()).data();
  ok("перестановка сохранила order", tbl.cols.c_test.order === 15);
  ok("перестановка НЕ снесла name/type колонки",
      tbl.cols.c_test.name === "Тестовая" && tbl.cols.c_test.type === "select", tbl.cols.c_test);
  ok("перестановка НЕ снесла варианты select",
      (((tbl.cols.c_test.opts || {}).choices || [])[0] || {}).label === "А", tbl.cols.c_test.opts);

  // ширина колонки: приложение шлёт opts целиком
  await db.doc("tables/t_acc").update({cols: {c_test: {opts: {choices: [{id: "a", label: "А", color: "green"}], width: 220}}}});
  tbl = (await db.doc("tables/t_acc").get()).data();
  ok("ширина колонки записалась", tbl.cols.c_test.opts.width === 220);

  await db.doc("tables/t_acc").update({cols: {c_test: null}});
  tbl = (await db.doc("tables/t_acc").get()).data();
  ok("null удаляет колонку целиком", !("c_test" in tbl.cols));
  ok("удаление колонки не тронуло остальные",
      Object.keys(tbl.cols).length === Object.keys(TABLES.t_acc.cols).length);

  /* --- 5. виды --- */
  section("виды");
  await db.doc("views/v_test").set({table: "t_acc", name: "Тест", order: 0, filters: [], sort: null, hidden: [], colorBy: null});
  await db.doc("views/v_test").update({filters: [{col: "c_status", op: "is", val: "active"}], sort: {col: "c_fbname", dir: "asc"}});
  let view = (await db.doc("views/v_test").get()).data();
  ok("фильтры записались", view.filters.length === 1 && view.filters[0].col === "c_status");
  await db.doc("views/v_test").update({filters: [], sort: null});
  view = (await db.doc("views/v_test").get()).data();
  ok("массив фильтров заменяется целиком", Array.isArray(view.filters) && view.filters.length === 0);
  ok("сортировка снимается через null", !("sort" in view));

  /* --- 6. onSnapshot --- */
  section("живое обновление");
  const seen = [];
  const unsub = db.collection("tables/t_acc/rows").onSnapshot((s) => {
    seen.push(s.docs.map((d) => ({id: d.id, exists: d.exists, name: (d.data().c || {}).c_fbname})));
  }, (e) => {
    results.push(`  FAIL onSnapshot упал -> ${e && e.code}`);
    failed++;
  });
  await sleep(600);
  const first = seen[seen.length - 1] || [];
  ok("onSnapshot отдал строки в ожидаемой форме",
      first.some((d) => d.id === rid && d.exists === true && d.name === "Polina"), first);
  await db.doc(rowPath).update({c: {c_fbname: "Polina Updated"}});
  await sleep(600);
  const last = seen[seen.length - 1] || [];
  ok("onSnapshot увидел правку вживую",
      last.some((d) => d.id === rid && d.name === "Polina Updated"), last);
  unsub();

  /* --- 7. авто-синк поверх ручных данных --- */
  section("авто-синк (как пишет Cloud Function)");

  const INV = {
    user: {id: "TESTUSER", name: "Polina FB", first_name: "Polina", last_name: "FB"},
    friends: 100,
    businesses: [{id: "BM1", name: "БМ один", created_time: "2025-01-01T00:00:00+0000"}],
    ad_accounts: [{id: "act_1", account_id: "1", name: "Кабинет", account_status: 1,
      amount_spent: "5000", bm: "BM1"}],
    pages: [], pixels: [],
  };

  // ingest пишет admin SDK-ом: ровно то же, что делает функция
  async function runIngest(inv) {
    const batch = adb.batch();
    for (const [tid, did, cells] of _internals.mapInventory(inv)) {
      batch.set(adb.doc(`tables/${tid}/rows/${did}`),
          {c: cells, uat: new Date().toISOString(), uby: "авто-синк"}, {merge: true});
    }
    await batch.commit();
  }

  await runIngest(INV);
  row = (await db.doc(rowPath).get()).data();
  ok("авто-синк заполнил поля из FB", row.c.c_fbname === "Polina FB" && row.c.c_fbid === "TESTUSER");
  ok("авто-синк НЕ затёр логин", row.c.c_login === "polina@mail", row.c.c_login);
  ok("авто-синк НЕ затёр пароль", row.c.c_fbpass === "секрет");
  ok("авто-синк НЕ затёр байера", row.c.c_buyer === "@buyer1");
  ok("подпись авто-синка проставлена", row.uby === "авто-синк");

  const adsBefore = (await adb.collection("tables/t_ads/rows").get()).size;
  await runIngest({...INV, ad_accounts: [{...INV.ad_accounts[0], amount_spent: "9900"}]});
  const adsAfter = await adb.collection("tables/t_ads/rows").get();
  ok("повторный сбор не плодит дубли", adsAfter.size === adsBefore, {adsBefore, after: adsAfter.size});
  const aa = adsAfter.docs.find((d) => d.id === "aa_1");
  ok("повторный сбор обновил сумму", aa && aa.data().c.c_amount_spent === 99, aa && aa.data().c.c_amount_spent);
  ok("кабинет связан с аккаунтом", aa && aa.data().c.c_acc[0] === "fb_TESTUSER");
  ok("кабинет связан с БМ", aa && aa.data().c.c_bm[0] === "bm_BM1");

  /* --- 8. лог не удаляется --- */
  section("лог действий");
  await db.doc("log/2026-09-17~admin~test").set({items: [{at: "2026-09-17T10:00:00Z", by: "Админ", text: "проверка"}]});
  ok("лог пишется", (await db.doc("log/2026-09-17~admin~test").get()).exists);
  ok("лог нельзя удалить даже админу", await throws(() => db.doc("log/2026-09-17~admin~test").delete()));

  /* --- вывод --- */
  console.log(results.join("\n"));
  console.log(failed ? `\n${failed} проверок упало` : `\nвсе ${results.filter((r) => r.startsWith("  ok")).length} проверок прошли`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.log(results.join("\n"));
  console.error("\nтест упал:", e);
  process.exit(1);
});
