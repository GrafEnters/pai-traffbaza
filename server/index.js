/**
 * index.js — сервер базы FB-инвентаря.
 *
 * Один процесс делает всё: отдаёт веб-приложение, обслуживает его API,
 * держит WebSocket для живых обновлений и принимает инвентарь от расширения.
 *
 * Переменные окружения:
 *   DATABASE_URL     строка подключения к PostgreSQL (или PGHOST/PGUSER/…)
 *   SESSION_SECRET   ключ подписи сессионных cookie (обязателен)
 *   SYNC_SECRET      общий секрет с расширением (обязателен для приёма)
 *   PORT             порт; на Amvera должен совпадать с containerPort
 *
 * Слушаем 0.0.0.0: на Amvera приложение на localhost недоступно снаружи.
 */

"use strict";

const path = require("path");
const http = require("http");
const express = require("express");

const {Store} = require("./lib/store");
const {Auth} = require("./lib/auth");
const {Live} = require("./lib/live");
const {buildRoutes} = require("./lib/routes");
const {buildIngest} = require("./lib/ingest");
const {bootstrap} = require("./lib/bootstrap");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, "..", "public");

/** за прокси Amvera оригинальная схема приходит заголовком */
const isSecure = (req) =>
  req.secure || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";

async function createServer(options) {
  const opts = options || {};
  const sessionSecret = opts.sessionSecret || process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET не задан — без него сессии подделываются");
  }
  const syncSecret = opts.syncSecret || process.env.SYNC_SECRET || "";
  if (!syncSecret) {
    console.warn("[server] SYNC_SECRET не задан — приём от расширения отключён");
  }

  const store = new Store(opts.store || {});
  await store.init();

  // пустая база сама по себе бесполезна: разложим схему таблиц при первом
  // запуске и, если попросили, заведём первого администратора
  if (opts.bootstrap !== false) {
    try {
      await bootstrap(store, {admin: opts.bootstrapAdmin || process.env.BOOTSTRAP_ADMIN});
    } catch (e) {
      console.error("[bootstrap] не удалось подготовить базу:", e.message || e);
    }
  }

  const auth = new Auth(store, sessionSecret);
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(express.json({limit: "8mb"}));

  const server = http.createServer(app);

  const live = new Live({
    server,
    authenticate: (req) => {
      const payload = auth.readToken(req);
      return payload ? {id: payload.uid, email: payload.email, role: payload.role} : null;
    },
  });
  // Каждая запись в базу уезжает подписчикам коллекции.
  // Внутреннее событие хранилища переводим в короткий формат провода —
  // ровно тот, что разбирает adapter.js на стороне браузера.
  store.onChange = (collection, event) => live.broadcast(collection, {
    t: event.type,
    c: event.collection,
    id: event.id,
    data: event.data,
  });

  app.use("/api/ingest", buildIngest({store, secret: syncSecret}));
  app.use("/api", buildRoutes({store, auth, live, secure: isSecure}));

  app.use(express.static(PUBLIC_DIR, {index: "index.html", extensions: ["html"]}));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });

  return {app, server, store, auth, live};
}

async function main() {
  const {server, store, live} = await createServer();
  await new Promise((resolve) => server.listen(PORT, "0.0.0.0", resolve));
  console.log(`[server] слушаю 0.0.0.0:${PORT}, приложение из ${PUBLIC_DIR}`);

  const shutdown = async (signal) => {
    console.log(`[server] ${signal} — останавливаюсь`);
    try {
      await live.close();
      await new Promise((resolve) => server.close(resolve));
      await store.close();
    } catch (e) {
      console.error("[server] при остановке:", e);
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

if (require.main === module) {
  main().catch((e) => {
    console.error("[server] не смог запуститься:", e);
    process.exit(1);
  });
}

module.exports = {createServer};
