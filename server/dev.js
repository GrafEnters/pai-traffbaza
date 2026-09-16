/**
 * dev.js — запуск всей связки локально, без установки PostgreSQL.
 *
 * Поднимает встроенный PostgreSQL (бинарник из node_modules), создаёт схему
 * таблиц, заводит админа и запускает сервер. Удобно посмотреть приложение
 * вживую и проверить расширение до деплоя.
 *
 * Запуск:  cd server && npm run dev
 *
 * По умолчанию база временная и стирается при выходе. Чтобы данные сохранялись
 * между запусками, добавь --keep: каталог базы ляжет в server/.devdata.
 */

"use strict";

const os = require("os");
const path = require("path");
const fs = require("fs");

const pgModule = require("embedded-postgres");
const EmbeddedPostgres = pgModule.default || pgModule;

const {createServer} = require("./index");
const {ensureUtf8Database} = require("./lib/devdb");
const {hashPassword} = require("./lib/auth");

const KEEP = process.argv.includes("--keep");
const PG_PORT = Number(process.env.DEV_PG_PORT || 54331);
const HTTP_PORT = Number(process.env.PORT || 3000);
const DB_NAME = "inventory";
const ADMIN_EMAIL = process.env.DEV_ADMIN || "admin@local";
const ADMIN_PASSWORD = process.env.DEV_PASSWORD || "admin12345";
const SYNC_SECRET = process.env.SYNC_SECRET || "dev-sync-secret";

async function main() {
  const dataDir = KEEP ?
    path.join(__dirname, ".devdata") :
    path.join(os.tmpdir(), `inventory-dev-${Date.now()}`);
  const fresh = !fs.existsSync(path.join(dataDir, "PG_VERSION"));

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "password",
    port: PG_PORT,
    persistent: KEEP,
  });

  console.log(`PostgreSQL: ${KEEP ? dataDir : "временная база"} на порту ${PG_PORT}`);
  if (fresh) await pg.initialise();
  await pg.start();
  const enc = await ensureUtf8Database({
    port: PG_PORT, user: "postgres", password: "password", database: DB_NAME,
  });
  console.log(`База ${DB_NAME}, кодировка ${enc}`);

  const connectionString = `postgres://postgres:password@127.0.0.1:${PG_PORT}/${DB_NAME}`;
  const {server, store, live} = await createServer({
    sessionSecret: process.env.SESSION_SECRET || "dev-session-secret-please-change",
    syncSecret: SYNC_SECRET,
    store: {connectionString},
  });
  // схему разложит сам сервер при первом запуске (см. lib/bootstrap.js)
  const existingAdmin = await store.findUserByEmail(ADMIN_EMAIL);
  if (!existingAdmin) {
    await store.upsertUser({
      email: ADMIN_EMAIL, passwordHash: hashPassword(ADMIN_PASSWORD), role: "admin",
    });
  }

  await new Promise((resolve) => server.listen(HTTP_PORT, "127.0.0.1", resolve));
  console.log([
    "",
    `Приложение:  http://127.0.0.1:${HTTP_PORT}`,
    `Вход:        ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`,
    `Приём:       http://127.0.0.1:${HTTP_PORT}/api/ingest  (секрет: ${SYNC_SECRET})`,
    KEEP ? "Данные сохраняются между запусками (--keep)" : "База временная: остановишь — всё сотрётся",
    "",
  ].join("\n"));

  const shutdown = async () => {
    console.log("\nОстанавливаюсь…");
    try {
      await live.close();
      await new Promise((resolve) => server.close(resolve));
      await store.close();
      await pg.stop();
      if (!KEEP) fs.rmSync(dataDir, {recursive: true, force: true});
    } catch (e) { /* выходим в любом случае */ }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error("Локальный запуск не удался:", e);
  process.exit(1);
});
