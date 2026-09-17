/**
 * routes.js — REST-интерфейс базы и вход.
 *
 * Набор операций ровно тот, что нужен приложению, и не шире:
 *   GET    /api/collection?path=tables            список документов
 *   POST   /api/collection?path=tables/t1/rows    создать документ с новым id
 *   GET    /api/doc?path=tables/t1                прочитать документ
 *   PUT    /api/doc?path=tables/t1                записать целиком
 *   PATCH  /api/doc?path=tables/t1                частично слить (см. merge.js)
 *   DELETE /api/doc?path=tables/t1                удалить
 *
 * Путь передаётся параметром запроса, а не частью маршрута: в нём есть слэши
 * и такие символы, как «~» в ключах лога, и разбирать это как URL-путь
 * только напрашиваться на ошибки.
 */

"use strict";

const express = require("express");
const {parseCollection, parseDoc, PathError} = require("./paths");
const {canWrite} = require("./auth");
const {buildTeam} = require("./team");

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function buildRoutes({store, auth, live, secure}) {
  const router = express.Router();
  const needUser = auth.requireUser();

  /* ---------- вход ---------- */

  router.post("/auth/login", wrap(async (req, res) => {
    const {email, password} = req.body || {};
    if (!email || !password) {
      return res.status(400).json({error: "нужны почта и пароль"});
    }
    const user = await auth.check(email, password);
    if (!user) return res.status(401).json({error: "неверная почта или пароль"});
    auth.setCookie(res, auth.makeToken(user), secure(req));
    res.json({email: user.email, role: user.role});
  }));

  router.post("/auth/logout", (req, res) => {
    auth.clearCookie(res);
    res.json({ok: true});
  });

  router.get("/auth/me", (req, res) => {
    const payload = auth.readToken(req);
    if (!payload) return res.status(401).json({error: "нужен вход"});
    res.json({email: payload.email, role: payload.role});
  });

  /* ---------- команда ---------- */

  // управление людьми вынесено отдельным модулем: там свои правила,
  // включая защиту от удаления последнего администратора
  router.use("/team", buildTeam({store, auth}));

  /* ---------- коллекции ---------- */

  router.get("/collection", needUser, wrap(async (req, res) => {
    const {collection} = parseCollection(req.query.path);
    const docs = await store.listCollection(collection);
    res.json({docs});
  }));

  router.post("/collection", needUser, wrap(async (req, res) => {
    const {collection} = parseCollection(req.query.path);
    if (!canWrite(req.user.role, collection, "create")) {
      return res.status(403).json({error: "нет прав на запись"});
    }
    const id = await store.addDoc(collection, req.body || {});
    res.json({id});
  }));

  /* ---------- документы ---------- */

  router.get("/doc", needUser, wrap(async (req, res) => {
    const {collection, id} = parseDoc(req.query.path);
    const doc = await store.getDoc(collection, id);
    res.json(doc);
  }));

  router.put("/doc", needUser, wrap(async (req, res) => {
    const {collection, id} = parseDoc(req.query.path);
    if (!canWrite(req.user.role, collection, "update")) {
      return res.status(403).json({error: "нет прав на запись"});
    }
    const body = req.body || {};
    const data = body.data === undefined ? body : body.data;
    if (body.merge) await store.updateDoc(collection, id, data);
    else await store.setDoc(collection, id, data);
    res.json({ok: true});
  }));

  router.patch("/doc", needUser, wrap(async (req, res) => {
    const {collection, id} = parseDoc(req.query.path);
    if (!canWrite(req.user.role, collection, "update")) {
      return res.status(403).json({error: "нет прав на запись"});
    }
    const body = req.body || {};
    const data = body.data === undefined ? body : body.data;
    await store.updateDoc(collection, id, data);
    res.json({ok: true});
  }));

  router.delete("/doc", needUser, wrap(async (req, res) => {
    const {collection, id} = parseDoc(req.query.path);
    if (!canWrite(req.user.role, collection, "delete")) {
      return res.status(403).json({error: "нет прав на удаление"});
    }
    const removed = await store.deleteDoc(collection, id);
    res.json({ok: true, removed});
  }));

  /* ---------- служебное ---------- */

  router.get("/health", wrap(async (req, res) => {
    let db = "ok";
    try {
      await store.pool.query("SELECT 1");
    } catch (e) {
      db = "нет связи с базой";
    }
    res.json({ok: db === "ok", db, live: live ? live.connections : 0});
  }));

  /* ---------- обработка ошибок ---------- */

  router.use((err, req, res, next) => {
    if (err instanceof PathError) return res.status(400).json({error: err.message});
    console.error("[api]", err);
    res.status(500).json({error: "внутренняя ошибка"});
  });

  return router;
}

module.exports = {buildRoutes};
