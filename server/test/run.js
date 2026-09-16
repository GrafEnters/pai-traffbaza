/**
 * run.js — прогон тестов сервера.
 *
 * Поднимает НАСТОЯЩИЙ PostgreSQL (бинарник из node_modules, ни Docker, ни
 * установленная база не нужны), запускает сервер на свободном порту, заводит
 * трёх пользователей с разными ролями и гоняет проверки. После себя всё гасит.
 *
 * Запуск: cd server && npm test
 */

"use strict";

const os = require("os");
const path = require("path");
const fs = require("fs");

const pgModule = require("embedded-postgres");
const EmbeddedPostgres = pgModule.default || pgModule;

const {createServer} = require("../index");
const {ensureUtf8Database} = require("../lib/devdb");
const {hashPassword} = require("../lib/auth");
const {state, ok, section} = require("./helpers");
const suites = require("./suites");

const PG_PORT = 54330;
const DB_NAME = "inventory_test";
const SYNC_SECRET = "test-sync-secret";
const SESSION_SECRET = "test-session-secret-0123456789";

/** заглушаем шумный вывод initdb, чтобы в логе теста были видны результаты */
function quiet(fn) {
  const write = process.stdout.write.bind(process.stdout);
  const errWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  return Promise.resolve()
      .then(fn)
      .finally(() => {
        process.stdout.write = write;
        process.stderr.write = errWrite;
      });
}

async function main() {
  const dataDir = path.join(os.tmpdir(), `inventory-pg-${Date.now()}`);
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "password",
    port: PG_PORT,
    persistent: false,
  });

  console.log("Поднимаю PostgreSQL для тестов…");
  await quiet(async () => {
    await pg.initialise();
    await pg.start();
  });
  const encoding = await ensureUtf8Database({
    port: PG_PORT, user: "postgres", password: "password", database: DB_NAME,
  });
  console.log(`База тестов в кодировке ${encoding}`);
  // отдельная пустая база — на ней проверяем первичное наполнение
  await ensureUtf8Database({
    port: PG_PORT, user: "postgres", password: "password", database: `${DB_NAME}_fresh`,
  });

  const connectionString =
    `postgres://postgres:password@127.0.0.1:${PG_PORT}/${DB_NAME}`;

  let ctx = {};
  let server; let store; let live;
  try {
    const built = await createServer({
      sessionSecret: SESSION_SECRET,
      syncSecret: SYNC_SECRET,
      bootstrap: false, // схему тесты раскладывают сами, автосев тут не нужен
      store: {connectionString},
    });
    server = built.server;
    store = built.store;
    live = built.live;

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const {port} = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`Сервер поднят на ${baseUrl}\n`);

    await store.upsertUser({email: "admin@test.local", passwordHash: hashPassword("adminpass"), role: "admin"});
    await store.upsertUser({email: "manager@test.local", passwordHash: hashPassword("managerpass"), role: "manager"});
    await store.upsertUser({email: "viewer@test.local", passwordHash: hashPassword("viewerpass"), role: "viewer"});

    ctx = {
      baseUrl, store, secret: SYNC_SECRET,
      freshUrl: `postgres://postgres:password@127.0.0.1:${PG_PORT}/${DB_NAME}_fresh`,
    };

    suites.mergeSuite();
    await suites.apiSuite(ctx);
    await suites.adapterSuite(ctx);
    await suites.ingestSuite(ctx);
    await suites.bootstrapSuite(ctx);
  } catch (e) {
    state.failed++;
    state.lines.push(`\n  FAIL прогон прервался: ${e && e.stack ? e.stack : e}`);
  } finally {
    console.log(state.lines.join("\n"));
    try {
      if (live) await live.close();
      if (server) await new Promise((resolve) => server.close(resolve));
      if (store) await store.close();
    } catch (e) { /* гасим молча */ }
    await quiet(() => pg.stop()).catch(() => {});
    fs.rmSync(dataDir, {recursive: true, force: true});
  }

  console.log(state.failed ?
    `\n${state.failed} проверок упало (прошло ${state.passed})` :
    `\nвсе ${state.passed} проверок прошли`);
  process.exit(state.failed ? 1 : 0);
}

main().catch((e) => {
  console.error("Тесты не запустились:", e);
  process.exit(1);
});
