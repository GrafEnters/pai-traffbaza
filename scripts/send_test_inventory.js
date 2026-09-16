/**
 * send_test_inventory.js — проверить задеплоенную функцию ingest, не открывая Facebook.
 *
 * Шлёт в функцию синтетический инвентарь с теми же полями, что собирает
 * расширение, и печатает ответ. Удобно сразу после деплоя: видно, дошло ли,
 * принимается ли секрет и сколько документов записалось.
 *
 * Запуск:
 *   node scripts/send_test_inventory.js <URL функции> <секрет>
 *   node scripts/send_test_inventory.js https://ingest-xxx-uc.a.run.app мой-секрет
 *
 * После прогона в базе появится аккаунт «Тестовый инвентарь» (FB ID 999000111)
 * со своими БМ / кабинетом / страницей — удали его из приложения, когда проверишь.
 */

const [, , url, secret] = process.argv;

if (!url || !secret) {
  console.error("Использование: node scripts/send_test_inventory.js <URL функции> <секрет>");
  process.exit(1);
}

const INV = {
  user: {
    id: "999000111", name: "Тестовый инвентарь", first_name: "Тест", last_name: "Инвентарь",
    link: "https://facebook.com/test", picture: {data: {url: "https://example/avatar.jpg"}},
  },
  friends: 42,
  businesses: [{
    id: "BM999", name: "Тестовый БМ", verification_status: "not_verified",
    created_time: "2025-05-05T00:00:00+0000",
    users: [{name: "Тест", email: "test@example.com", role: "ADMIN"}],
    child_businesses: [],
  }],
  ad_accounts: [{
    id: "act_999", account_id: "999", name: "Тестовый кабинет", account_status: 1,
    disable_reason: 0, currency: "USD", amount_spent: "123400", spend_cap: "0",
    balance: "1000", adtrust_dsl: 250, created_time: "2025-07-07T00:00:00+0000",
    age: 300, timezone_name: "Europe/Kiev", user_tasks: ["MANAGE"], bm: "BM999",
  }],
  pages: [{
    id: "PG999", name: "Тестовая страница", username: "testpage", fan_count: 123,
    is_published: true, created_time: "2025-08-08T00:00:00+0000", bm: "BM999",
  }],
  pixels: [{
    id: "PX999", name: "Тестовый пиксель", creation_time: "2025-09-09T00:00:00+0000",
    owner_business: {id: "BM999", name: "Тестовый БМ"}, bm: "BM999",
  }],
};

(async () => {
  console.log(`Шлю тестовый инвентарь в ${url}`);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({secret, inv: INV}),
    });
  } catch (e) {
    console.error("Не достучался до функции:", e.message);
    console.error("Проверь URL и что функция задеплоена.");
    process.exit(1);
  }

  const text = await res.text();
  console.log(`HTTP ${res.status}`);
  console.log(text || "(пустой ответ)");

  if (res.status === 403) {
    console.error("\n403 — функция не приняла секрет. Сверь его с тем, что задан в SYNC_SECRET:");
    console.error("  firebase functions:secrets:access SYNC_SECRET");
    process.exit(1);
  }
  if (!res.ok) {
    console.error("\nФункция ответила ошибкой — смотри логи: firebase functions:log");
    process.exit(1);
  }
  console.log("\nГотово. Открой приложение: должен появиться аккаунт «Тестовый инвентарь»");
  console.log("с 1 БМ, 1 кабинетом, 1 страницей и 1 пикселем. Потом удали его из базы.");
})();
