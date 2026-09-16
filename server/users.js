/**
 * users.js — завести члена команды и выдать роль.
 *
 * Пользователи и роли лежат в самой базе, отдельной консоли для них нет,
 * поэтому всё делается этим скриптом.
 *
 * Запуск:
 *   set DATABASE_URL=postgres://user:pass@host:5432/db
 *   node server/users.js add polina@example.com admin
 *   node server/users.js add buyer@example.com manager СвойПароль
 *   node server/users.js role buyer@example.com viewer
 *   node server/users.js password buyer@example.com НовыйПароль
 *   node server/users.js list
 *   node server/users.js remove buyer@example.com
 *
 * Роли: admin (всё + аналитика + переименование), manager (правит данные,
 * лимит 10 удалений в день), viewer (только чтение).
 * Если пароль не указан, скрипт сгенерирует его и покажет один раз.
 */

"use strict";

const crypto = require("crypto");
const {Store} = require("./lib/store");
const {hashPassword, ROLES} = require("./lib/auth");

const randomPassword = () => crypto.randomBytes(9).toString("base64url");

function usage() {
  console.error([
    "Использование:",
    "  node server/users.js add <почта> <роль> [пароль]",
    "  node server/users.js role <почта> <роль>",
    "  node server/users.js password <почта> [пароль]",
    "  node server/users.js list",
    "  node server/users.js remove <почта>",
    `Роли: ${ROLES.join(", ")}`,
  ].join("\n"));
  process.exit(1);
}

async function main() {
  const [cmd, email, arg3, arg4] = process.argv.slice(2);
  if (!cmd) usage();

  const store = new Store();
  await store.init();

  try {
    if (cmd === "list") {
      const users = await store.listUsers();
      if (!users.length) {
        console.log("Пользователей пока нет. Заведи первого: node server/users.js add <почта> admin");
      } else {
        console.log("Команда:");
        for (const u of users) console.log(`  ${u.email}  ->  ${u.role}`);
      }
      return;
    }

    if (!email) usage();

    if (cmd === "add") {
      const role = arg3 || "viewer";
      if (!ROLES.includes(role)) {
        console.error(`Роль должна быть одной из: ${ROLES.join(", ")}`);
        process.exit(1);
      }
      const password = arg4 || randomPassword();
      await store.upsertUser({email, passwordHash: hashPassword(password), role});
      console.log(`${email} заведён с ролью ${role}`);
      if (!arg4) console.log(`Пароль (показывается один раз): ${password}`);
      return;
    }

    if (cmd === "role") {
      if (!ROLES.includes(arg3)) {
        console.error(`Роль должна быть одной из: ${ROLES.join(", ")}`);
        process.exit(1);
      }
      const existing = await store.findUserByEmail(email);
      if (!existing) {
        console.error(`Нет такого пользователя: ${email}`);
        process.exit(1);
      }
      await store.upsertUser({email, role: arg3});
      console.log(`${email} -> ${arg3}. Пусть перезайдёт, чтобы роль подхватилась.`);
      return;
    }

    if (cmd === "password") {
      const existing = await store.findUserByEmail(email);
      if (!existing) {
        console.error(`Нет такого пользователя: ${email}`);
        process.exit(1);
      }
      const password = arg3 || randomPassword();
      await store.upsertUser({email, passwordHash: hashPassword(password)});
      console.log(`Пароль для ${email} обновлён`);
      if (!arg3) console.log(`Новый пароль (показывается один раз): ${password}`);
      return;
    }

    if (cmd === "remove") {
      const removed = await store.deleteUser(email);
      console.log(removed ? `${email} удалён` : `Нет такого пользователя: ${email}`);
      return;
    }

    usage();
  } finally {
    await store.close();
  }
}

main().catch((e) => {
  console.error("Не получилось:", e.message || e);
  process.exit(1);
});
