/**
 * suites.js — что именно проверяем.
 *
 * Главные риски этого проекта и есть предмет проверки:
 *   * слияние: правка одной ячейки не должна сносить соседние, а авто-синк
 *     не должен затирать логины и пароли, заполненные руками;
 *   * права: viewer не пишет, менеджер не сносит таблицы, лог не стирается;
 *   * живой канал: правка одного человека доезжает до другого;
 *   * приёмник: секрет, повторный сбор без дублей, связи между таблицами.
 */

"use strict";

const path = require("path");
const fs = require("fs");
const WS = require("ws");

const {ok, section, throws, until, makeClient} = require("./helpers");
const {deepMerge} = require("../lib/merge");
const {canWrite} = require("../lib/auth");
const {parseDoc, parseCollection} = require("../lib/paths");
const {inventoryRecords} = require("../lib/mapping");
const {seedSchemaIfEmpty, createFirstAdmin} = require("../lib/bootstrap");

/* ---------------- 1. слияние ---------------- */

function mergeSuite() {
  section("слияние (правила частичного обновления)");

  ok("новое поле добавляется",
      deepMerge({a: 1}, {b: 2}).b === 2);
  ok("существующее заменяется",
      deepMerge({a: 1}, {a: 2}).a === 2);

  const cells = deepMerge(
      {c: {c_name: "Аккаунт", c_login: "log", c_fbpass: "pass"}},
      {c: {c_status: "active"}});
  ok("правка ячейки не сносит соседние",
      cells.c.c_login === "log" && cells.c.c_fbpass === "pass" && cells.c.c_status === "active",
      cells.c);

  const cleared = deepMerge({c: {a: 1, b: 2}}, {c: {a: null}});
  ok("null удаляет ячейку", !("a" in cleared.c) && cleared.c.b === 2, cleared.c);

  const col = deepMerge(
      {cols: {c_x: {name: "Имя", type: "select", order: 10, opts: {choices: [{id: "a"}]}}}},
      {cols: {c_x: {order: 15}}});
  ok("перестановка колонки сохраняет name/type",
      col.cols.c_x.name === "Имя" && col.cols.c_x.type === "select" && col.cols.c_x.order === 15,
      col.cols.c_x);
  ok("перестановка сохраняет варианты списка",
      col.cols.c_x.opts.choices[0].id === "a");

  const dropped = deepMerge({cols: {a: {name: "A"}, b: {name: "B"}}}, {cols: {a: null}});
  ok("null удаляет колонку целиком",
      !("a" in dropped.cols) && dropped.cols.b.name === "B", dropped.cols);

  const arr = deepMerge({filters: [1, 2, 3]}, {filters: [9]});
  ok("массив заменяется целиком, а не сливается",
      arr.filters.length === 1 && arr.filters[0] === 9, arr.filters);

  const src = {c: {a: 1}};
  deepMerge(src, {c: {b: 2}});
  ok("исходный объект не мутируется", !("b" in src.c), src.c);

  section("разбор путей");
  ok("документ таблицы", parseDoc("tables/t_acc").collection === "tables");
  ok("документ строки",
      parseDoc("tables/t_acc/rows/fb_1").collection === "tables/t_acc/rows" &&
      parseDoc("tables/t_acc/rows/fb_1").id === "fb_1");
  ok("коллекция строк", parseCollection("tables/t_acc/rows").collection === "tables/t_acc/rows");
  ok("путь коллекции не годится как документ", !!(() => {
    try {
      parseDoc("tables");
      return false;
    } catch (e) {
      return true;
    }
  })());
  ok("служебная коллекция users закрыта", !!(() => {
    try {
      parseCollection("users");
      return false;
    } catch (e) {
      return true;
    }
  })());
  ok("выход из дерева путём .. запрещён", !!(() => {
    try {
      parseDoc("tables/../users/x");
      return false;
    } catch (e) {
      return true;
    }
  })());

  section("права по ролям");
  ok("viewer не пишет", !canWrite("viewer", "tables/t_acc/rows", "update"));
  ok("manager правит строки", canWrite("manager", "tables/t_acc/rows", "update"));
  ok("manager удаляет строки", canWrite("manager", "tables/t_acc/rows", "delete"));
  ok("manager НЕ удаляет таблицу", !canWrite("manager", "tables", "delete"));
  ok("admin удаляет таблицу", canWrite("admin", "tables", "delete"));
  ok("лог не стирает даже admin", !canWrite("admin", "log", "delete"));
  ok("manager пишет в лог", canWrite("manager", "log", "update"));
}

/* ---------------- 2. API и права ---------------- */

async function apiSuite(ctx) {
  const {baseUrl} = ctx;
  const admin = makeClient(baseUrl);
  const manager = makeClient(baseUrl);
  const viewer = makeClient(baseUrl);
  const guest = makeClient(baseUrl);

  section("вход");
  const bad = await admin.call("POST", "/api/auth/login", {email: "admin@test.local", password: "неверный"});
  ok("неверный пароль -> 401", bad.status === 401, bad);

  const login = await admin.call("POST", "/api/auth/login", {email: "admin@test.local", password: "adminpass"});
  ok("верный пароль -> 200", login.status === 200, login);
  ok("роль вернулась", login.data && login.data.role === "admin", login.data);

  await manager.call("POST", "/api/auth/login", {email: "manager@test.local", password: "managerpass"});
  await viewer.call("POST", "/api/auth/login", {email: "viewer@test.local", password: "viewerpass"});

  const me = await manager.call("GET", "/api/auth/me");
  ok("кто я — отдаёт роль", me.data && me.data.role === "manager", me.data);

  section("доступ без входа");
  const anon = await guest.call("GET", guest.col("tables"));
  ok("без входа читать нельзя", anon.status === 401, anon.status);
  const anonWrite = await guest.call("PUT", guest.doc("tables/t_hack"), {data: {name: "x"}});
  ok("без входа писать нельзя", anonWrite.status === 401, anonWrite.status);

  section("права ролей на запись");
  await admin.call("PUT", admin.doc("tables/t_acc"), {
    data: {name: "Аккаунты", order: 10, deleted: false, cols: {c_name: {name: "Имя", type: "text", order: 10}}},
  });

  const viewerRead = await viewer.call("GET", viewer.doc("tables/t_acc"));
  ok("viewer читает", viewerRead.status === 200 && viewerRead.data.exists, viewerRead.status);
  const viewerWrite = await viewer.call("PATCH", viewer.doc("tables/t_acc"), {data: {name: "Взломано"}});
  ok("viewer не пишет -> 403", viewerWrite.status === 403, viewerWrite.status);

  const mgrRow = await manager.call("POST", manager.col("tables/t_acc/rows"), {c: {c_name: "Ручная"}, o: 10});
  ok("manager создаёт запись", mgrRow.status === 200 && !!mgrRow.data.id, mgrRow);
  const mgrDelRow = await manager.call("DELETE", manager.doc(`tables/t_acc/rows/${mgrRow.data.id}`));
  ok("manager удаляет запись", mgrDelRow.status === 200, mgrDelRow.status);
  const mgrDelTable = await manager.call("DELETE", manager.doc("tables/t_acc"));
  ok("manager НЕ удаляет таблицу -> 403", mgrDelTable.status === 403, mgrDelTable.status);

  section("правка данных через API");
  const rowPath = "tables/t_acc/rows/fb_TEST";
  await admin.call("PUT", admin.doc(rowPath), {
    data: {c: {c_fbname: "Polina", c_login: "polina@mail", c_fbpass: "секрет", c_buyer: "@b1"}, o: 10},
  });

  await admin.call("PATCH", admin.doc(rowPath), {data: {c: {c_status: "active"}, uby: "Админ"}});
  let row = (await admin.call("GET", admin.doc(rowPath))).data.data;
  ok("ячейка записалась", row.c.c_status === "active");
  ok("соседние ячейки уцелели", row.c.c_login === "polina@mail" && row.c.c_fbpass === "секрет", row.c);
  ok("служебное поле обновилось", row.uby === "Админ");

  await admin.call("PATCH", admin.doc(rowPath), {data: {c: {c_status: null}}});
  row = (await admin.call("GET", admin.doc(rowPath))).data.data;
  ok("null очищает ячейку", !("c_status" in row.c));

  await admin.call("PATCH", admin.doc(rowPath), {data: {del: true}});
  ok("пометка удаления ставится",
      (await admin.call("GET", admin.doc(rowPath))).data.data.del === true);
  await admin.call("PATCH", admin.doc(rowPath), {data: {del: null}});
  ok("возврат из корзины снимает пометку",
      !("del" in (await admin.call("GET", admin.doc(rowPath))).data.data));

  section("колонки");
  await admin.call("PATCH", admin.doc("tables/t_acc"), {
    data: {cols: {c_test: {name: "Тестовая", type: "select", order: 500, opts: {choices: [{id: "a", label: "А"}]}}}},
  });
  await admin.call("PATCH", admin.doc("tables/t_acc"), {data: {cols: {c_test: {order: 15}}}});
  const tbl = (await admin.call("GET", admin.doc("tables/t_acc"))).data.data;
  ok("перестановка сохранила имя и тип колонки",
      tbl.cols.c_test.name === "Тестовая" && tbl.cols.c_test.type === "select" && tbl.cols.c_test.order === 15,
      tbl.cols.c_test);
  ok("исходная колонка на месте", !!tbl.cols.c_name);
  await admin.call("PATCH", admin.doc("tables/t_acc"), {data: {cols: {c_test: null}}});
  ok("колонка удалена",
      !("c_test" in (await admin.call("GET", admin.doc("tables/t_acc"))).data.data.cols));

  section("лог действий");
  await manager.call("PUT", manager.doc("log/2026-09-17~admin~x"), {data: {items: [{text: "проверка"}]}});
  ok("лог пишется",
      (await manager.call("GET", manager.doc("log/2026-09-17~admin~x"))).data.exists);

  // Приложение пишет в лог стрелки, а в заголовки удалённых записей — значок
  // корзины. В базе с кодировкой не UTF8 такая запись падает с ошибкой 500,
  // поэтому проверяем прямо здесь: это уже ломалось.
  const tricky = "изменение «Байер»: — → @buyer · 🗑 удалено ✓";
  const wrote = await manager.call("PUT", manager.doc("log/2026-09-17~admin~unicode"),
      {data: {items: [{text: tricky}]}});
  ok("лог со стрелкой, значком корзины и эмодзи сохраняется", wrote.status === 200, wrote);
  const readBack = await manager.call("GET", manager.doc("log/2026-09-17~admin~unicode"));
  ok("такой текст читается обратно без потерь",
      readBack.data.exists && readBack.data.data.items[0].text === tricky,
      readBack.data && readBack.data.data);
  const logDel = await admin.call("DELETE", admin.doc("log/2026-09-17~admin~x"));
  ok("лог нельзя удалить даже админу -> 403", logDel.status === 403, logDel.status);

  section("защита путей");
  const badPath = await admin.call("GET", admin.doc("users/anything"));
  ok("служебная коллекция users недоступна", badPath.status === 400, badPath.status);
  const colAsDoc = await admin.call("GET", admin.doc("tables"));
  ok("путь коллекции не принимается как документ", colAsDoc.status === 400, colAsDoc.status);

  ctx.clients = {admin, manager, viewer};
}

/* ---------------- 3. живой канал через настоящий adapter.js ---------------- */

async function adapterSuite(ctx) {
  const {baseUrl, clients} = ctx;
  section("клиентский слой хранилища (настоящий adapter.js)");

  const cookie = clients.admin.cookie;
  const url = new URL(baseUrl);

  // cookie-aware fetch и WebSocket: в браузере это делает сам движок
  const fetchWithCookie = (input, init) => {
    const opts = Object.assign({}, init);
    opts.headers = Object.assign({}, (init && init.headers) || {}, {Cookie: cookie});
    const target = String(input).startsWith("http") ? String(input) : baseUrl + String(input);
    return fetch(target, opts);
  };
  class TestWebSocket extends WS {
    constructor(u) {
      super(u, {headers: {Cookie: cookie}});
    }
  }
  const locationStub = {
    protocol: "http:", host: url.host, href: baseUrl,
    reload() {},
  };
  const documentStub = {
    addEventListener() {},
    getElementById: () => null,
    createElement: () => ({setAttribute() {}, appendChild() {}, click() {}, remove() {}, querySelector: () => null}),
    body: null,
  };
  const windowStub = {};

  const code = fs.readFileSync(path.join(__dirname, "..", "..", "public", "adapter.js"), "utf8");
  // тот же realm, что и у теста: иначе объекты получат чужой прототип
  // eslint-disable-next-line no-new-func
  new Function("window", "document", "location", "fetch", "WebSocket", code)(
      windowStub, documentStub, locationStub, fetchWithCookie, TestWebSocket);

  ok("adapter.js поднял хранилище", !!windowStub.__DB__ && !!windowStub.__AUTH__);
  const db = windowStub.__DB__;

  const role = await windowStub.__AUTH__.getRole();
  ok("адаптер узнал роль", role === "admin", role);

  // подписка: приложение ждёт полный список документов при каждом изменении
  const snapshots = [];
  const unsub = db.collection("tables/t_acc/rows").onSnapshot((snap) => {
    snapshots.push(snap.docs.map((d) => ({id: d.id, name: (d.data().c || {}).c_fbname})));
  }, (e) => {
    ok("onSnapshot не должен падать", false, String(e && e.message));
  });

  const gotFirst = await until(() => snapshots.length > 0 &&
    snapshots[snapshots.length - 1].some((d) => d.id === "fb_TEST"));
  ok("первый снимок пришёл и содержит запись", !!gotFirst,
      snapshots[snapshots.length - 1]);

  // правка другим человеком должна доехать по живому каналу
  await clients.manager.call("PATCH", clients.manager.doc("tables/t_acc/rows/fb_TEST"),
      {data: {c: {c_fbname: "Изменено другим"}}});
  const gotLive = await until(() => {
    const last = snapshots[snapshots.length - 1] || [];
    return last.some((d) => d.id === "fb_TEST" && d.name === "Изменено другим");
  });
  ok("правка другого человека доехала вживую", !!gotLive, snapshots[snapshots.length - 1]);

  // создание новой записи тоже
  const created = await clients.manager.call("POST", clients.manager.col("tables/t_acc/rows"),
      {c: {c_fbname: "Новая строка"}, o: 20});
  const gotNew = await until(() => {
    const last = snapshots[snapshots.length - 1] || [];
    return last.some((d) => d.id === created.data.id);
  });
  ok("новая запись появилась вживую", !!gotNew);

  // и удаление
  await clients.manager.call("DELETE", clients.manager.doc(`tables/t_acc/rows/${created.data.id}`));
  const gotGone = await until(() => {
    const last = snapshots[snapshots.length - 1] || [];
    return !last.some((d) => d.id === created.data.id);
  });
  ok("удаление доехало вживую", !!gotGone);

  section("операции адаптера");
  await db.doc("tables/t_acc/rows/fb_TEST").update({c: {c_note: "через адаптер"}});
  const viaAdapter = await db.doc("tables/t_acc/rows/fb_TEST").get();
  ok("update через адаптер сработал", viaAdapter.data().c.c_note === "через адаптер");
  ok("update через адаптер не снёс соседей", viaAdapter.data().c.c_fbpass === "секрет");
  ok("get.exists — свойство, а не функция", viaAdapter.exists === true);

  const added = await db.collection("tables/t_acc/rows").add({c: {c_fbname: "Через add"}, o: 30});
  ok("add вернул id", !!added.id);
  await db.doc(`tables/t_acc/rows/${added.id}`).delete();
  ok("delete отработал",
      !(await db.doc(`tables/t_acc/rows/${added.id}`).get()).exists);

  const all = await db.collection("tables").get();
  ok("get коллекции отдаёт документы в ожидаемой форме",
      all.docs.length > 0 && typeof all.docs[0].data === "function" && all.docs[0].exists === true);

  unsub();
  ctx.adapterWindow = windowStub;
}

/* ---------------- 4. приёмник инвентаря ---------------- */

async function ingestSuite(ctx) {
  const {baseUrl, secret, clients} = ctx;
  section("приёмник инвентаря");

  const INV = {
    user: {id: "555000111", name: "Ingest Probe", first_name: "Ingest"},
    friends: 77,
    businesses: [{id: "BM77", name: "Probe BM", created_time: "2025-02-02T00:00:00+0000",
      users: [], child_businesses: []}],
    ad_accounts: [{id: "act_88", account_id: "88", name: "Probe AA", account_status: 1,
      currency: "USD", amount_spent: "250000", adtrust_dsl: 500, bm: "BM77"}],
    pages: [{id: "PG99", name: "Probe Page", fan_count: 5, bm: "BM77"}],
    pixels: [],
  };

  const post = (body, origin) => fetch(`${baseUrl}/api/ingest`, {
    method: "POST",
    headers: {"Content-Type": "application/json", "Origin": origin || "https://www.facebook.com"},
    body: JSON.stringify(body),
  });

  const wrong = await post({secret: "неверный", inv: INV});
  ok("неверный секрет -> 403", wrong.status === 403, wrong.status);

  const noUser = await post({secret, inv: {user: {}}});
  ok("инвентарь без user.id -> 400", noUser.status === 400, noUser.status);

  const preflight = await fetch(`${baseUrl}/api/ingest`, {
    method: "OPTIONS",
    headers: {
      "Origin": "https://www.facebook.com",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  ok("префлайт CORS разрешён",
      preflight.status === 204 && !!preflight.headers.get("access-control-allow-origin"),
      preflight.status);

  const good = await post({secret, inv: INV});
  const body = await good.json();
  ok("верный секрет -> 200", good.status === 200, good.status);
  ok("ответ со счётчиками",
      body.ok === true && body.counts.aa === 1 && body.counts.bm === 1 && body.counts.fp === 1, body);
  ok("записано 4 документа", body.written === 4, body.written);

  const c = clients.admin;
  const acc = (await c.call("GET", c.doc("tables/t_acc/rows/fb_555000111"))).data;
  ok("аккаунт лёг по детерминированному id", acc.exists);
  ok("сводка ассетов посчитана", acc.data.c.c_counts === "БМ 1 · РК 1 · ФП 1 · PX 0", acc.data.c.c_counts);

  const aa = (await c.call("GET", c.doc("tables/t_ads/rows/aa_88"))).data;
  ok("сумма переведена в доллары", aa.data.c.c_amount_spent === 2500, aa.data.c.c_amount_spent);
  ok("лимит из adtrust_dsl", aa.data.c.c_spend_limit === 500);
  ok("связь с аккаунтом", aa.data.c.c_acc[0] === "fb_555000111");
  ok("связь с БМ", aa.data.c.c_bm[0] === "bm_BM77");

  section("повторный сбор и ручные поля");
  await c.call("PATCH", c.doc("tables/t_acc/rows/fb_555000111"),
      {data: {c: {c_login: "ручной@логин", c_fbpass: "ручной-пароль", c_buyer: "@probe"}}});

  const before = (await c.call("GET", c.col("tables/t_ads/rows"))).data.docs.length;
  const again = await post({secret,
    inv: {...INV, ad_accounts: [{...INV.ad_accounts[0], amount_spent: "999900", account_status: 2}]}});
  ok("повторный приём -> 200", again.status === 200);
  const after = (await c.call("GET", c.col("tables/t_ads/rows"))).data.docs.length;
  ok("дублей не появилось", after === before, {before, after});

  const aa2 = (await c.call("GET", c.doc("tables/t_ads/rows/aa_88"))).data;
  ok("сумма обновилась", aa2.data.c.c_amount_spent === 9999, aa2.data.c.c_amount_spent);
  ok("статус обновился", aa2.data.c.c_account_status === "отключена");

  const acc2 = (await c.call("GET", c.doc("tables/t_acc/rows/fb_555000111"))).data;
  ok("авто-синк не затёр логин", acc2.data.c.c_login === "ручной@логин");
  ok("авто-синк не затёр пароль", acc2.data.c.c_fbpass === "ручной-пароль");
  ok("авто-синк не затёр байера", acc2.data.c.c_buyer === "@probe");

  section("раскладка инвентаря без сети");
  const recs = inventoryRecords(INV);
  ok("записи адресуются в нужные коллекции",
      recs[0].collection === "tables/t_acc/rows" && recs[0].id === "fb_555000111", recs[0]);
  const empties = recs.filter((r) => Object.values(r.data.c)
      .some((v) => v === "" || v === null || (Array.isArray(v) && !v.length)));
  ok("пустых ячеек не пишем", empties.length === 0, empties.length);
}

/* ---------------- 5. первичное наполнение пустой базы ---------------- */

async function bootstrapSuite(ctx) {
  const {store} = ctx;
  section("первичное наполнение");

  // база уже не пустая (её наполнили предыдущие проверки) — сев должен молчать
  const skipped = await seedSchemaIfEmpty(store);
  ok("на непустой базе схему не перезаписываем", skipped.seeded === false, skipped);

  // и админа не заводим, раз пользователи уже есть
  const noAdmin = await createFirstAdmin(store, "someone@test.local:pass");
  ok("второго админа поверх существующих не создаём", noAdmin.created === false, noAdmin);

  // а на чистой базе схема должна разложиться целиком
  const fresh = new (require("../lib/store").Store)({connectionString: ctx.freshUrl});
  await fresh.init();
  try {
    const seeded = await seedSchemaIfEmpty(fresh);
    ok("на пустой базе схема раскладывается", seeded.seeded === true, seeded);
    ok("создано 8 таблиц", seeded.tables === 8, seeded.tables);
    ok("создано 10 видов", seeded.views === 10, seeded.views);

    const acc = await fresh.getDoc("tables", "t_acc");
    ok("таблица аккаунтов на месте", acc.exists && acc.data.name === "Аккаунты");
    ok("у неё есть колонки", Object.keys(acc.data.cols || {}).length > 20,
        Object.keys(acc.data.cols || {}).length);

    const admin = await createFirstAdmin(fresh, "first@test.local:firstpass");
    ok("первый админ заводится", admin.created === true, admin);
    const user = await fresh.findUserByEmail("first@test.local");
    ok("и получает роль admin", user && user.role === "admin", user && user.role);

    const second = await createFirstAdmin(fresh, "second@test.local:x");
    ok("повторный вызов уже ничего не делает", second.created === false, second);

    const bad = await createFirstAdmin(fresh, "не-почта");
    ok("кривой BOOTSTRAP_ADMIN отбрасывается", bad.created === false, bad);
  } finally {
    await fresh.close();
  }
}

module.exports = {mergeSuite, apiSuite, adapterSuite, ingestSuite, bootstrapSuite};
