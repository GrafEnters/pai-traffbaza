/**
 * bootstrap.js — первичное наполнение пустой базы при старте.
 *
 * Схема таблиц описана кодом (scripts/schema.js), а пустая база без неё
 * бесполезна: приложение покажет «нет таблиц». Поэтому при первом запуске
 * сервер раскладывает схему сам — не нужно ни внешнего доступа к базе,
 * ни отдельного запуска скрипта.
 *
 * Работает только на пустой базе: если таблицы уже есть, ничего не трогаем.
 * Изменить схему позже можно скриптом `npm run seed -- --force`.
 *
 * Первый админ заводится, если задана переменная BOOTSTRAP_ADMIN:
 *   BOOTSTRAP_ADMIN=polina@example.com:ПарольПосложнее
 *   BOOTSTRAP_ADMIN=polina@example.com      (пароль сгенерируется и попадёт в лог)
 * Срабатывает только когда пользователей ещё нет. После первого входа
 * переменную стоит убрать из настроек.
 */

"use strict";

const crypto = require("crypto");
const {hashPassword} = require("./auth");
const {TABLES, VIEWS} = require("../../scripts/schema");

const NOW = () => new Date().toISOString();

/** разложить схему таблиц и виды, если база пустая */
async function seedSchemaIfEmpty(store) {
  const existing = await store.countCollection("tables");
  if (existing > 0) return {seeded: false, tables: existing};

  console.log("[bootstrap] база пустая — раскладываю схему таблиц");
  for (const [tid, def] of Object.entries(TABLES)) {
    await store.setDoc("tables", tid, {
      name: def.name,
      order: def.order,
      deleted: false,
      cols: def.cols,
      at: NOW(),
      by: "bootstrap",
    });
  }
  for (const [vid, def] of Object.entries(VIEWS)) {
    await store.setDoc("views", vid, def);
  }
  const counts = {
    tables: Object.keys(TABLES).length,
    views: Object.keys(VIEWS).length,
  };
  console.log(`[bootstrap] готово: таблиц ${counts.tables}, видов ${counts.views}`);
  return {seeded: true, ...counts};
}

/** завести первого админа, если пользователей ещё нет */
async function createFirstAdmin(store, spec) {
  if (!spec) return {created: false, reason: "BOOTSTRAP_ADMIN не задан"};

  const users = await store.listUsers();
  if (users.length) return {created: false, reason: "пользователи уже есть"};

  const idx = String(spec).indexOf(":");
  const email = (idx < 0 ? spec : spec.slice(0, idx)).trim();
  const given = idx < 0 ? "" : spec.slice(idx + 1);
  if (!email || !email.includes("@")) {
    console.error(`[bootstrap] BOOTSTRAP_ADMIN не похож на почту: ${spec}`);
    return {created: false, reason: "плохой формат"};
  }

  const password = given || crypto.randomBytes(9).toString("base64url");
  await store.upsertUser({email, passwordHash: hashPassword(password), role: "admin"});

  console.log(`[bootstrap] заведён администратор ${email}`);
  if (!given) {
    console.log(`[bootstrap] пароль (показывается один раз): ${password}`);
  }
  console.log("[bootstrap] войди в приложение и убери BOOTSTRAP_ADMIN из настроек");
  return {created: true, email};
}

/** полный первичный запуск */
async function bootstrap(store, options) {
  const opts = options || {};
  const schema = await seedSchemaIfEmpty(store);
  const admin = await createFirstAdmin(store, opts.admin);
  return {schema, admin};
}

module.exports = {bootstrap, seedSchemaIfEmpty, createFirstAdmin};
