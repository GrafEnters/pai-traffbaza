/**
 * team.js — управление командой из приложения.
 *
 * Раньше людей заводили скриптом по строке подключения к базе. Это значит
 * держать доступ к базе на ноутбуке и повторять процедуру при каждом новом
 * байере, поэтому здесь то же самое, но через интерфейс — и только для
 * администратора.
 *
 * Главное, что тут защищено, — возможность запереть самого себя снаружи.
 * Нельзя удалить или понизить себя, нельзя убрать последнего администратора:
 * после такой ошибки в базу было бы не попасть вообще, и чинить пришлось бы
 * руками через SQL.
 *
 * Почта проверяется на собаку не из педантизма: поле входа в приложении
 * почтовое, и пользователь с логином без собаки просто не смог бы войти.
 */

"use strict";

const express = require("express");
const {hashPassword, ROLES} = require("./auth");

const MIN_PASSWORD = 8;

const normEmail = (v) => String(v || "").trim().toLowerCase();
const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

/** записать событие в общий лог действий — он же показывается в приложении */
async function logTeamEvent(store, actor, text) {
  const key = `${new Date().toISOString().slice(0, 10)}~team`;
  try {
    const cur = await store.getDoc("log", key);
    const items = (cur.exists && Array.isArray(cur.data.items) ? cur.data.items : []).slice(-499);
    items.push({at: new Date().toISOString(), by: actor, table: null, row: null, text});
    await store.setDoc("log", key, {items});
  } catch (e) {
    console.error("[team] не смог записать в лог:", e.message || e);
  }
}

function buildTeam({store, auth}) {
  const router = express.Router();

  // всё в этом разделе — только для администратора
  router.use(auth.requireUser(), (req, res, next) => {
    if (req.user.role !== "admin") {
      return res.status(403).json({error: "управлять командой может только админ"});
    }
    next();
  });

  const countAdmins = async () => {
    const users = await store.listUsers();
    return users.filter((u) => u.role === "admin").length;
  };

  /* ---------- список ---------- */

  router.get("/", wrap(async (req, res) => {
    const users = await store.listUsers();
    res.json({
      users: users.map((u) => ({email: u.email, role: u.role, at: u.created_at})),
      me: req.user.email,
    });
  }));

  /* ---------- добавить ---------- */

  router.post("/", wrap(async (req, res) => {
    const email = normEmail((req.body || {}).email);
    const role = (req.body || {}).role || "viewer";
    const password = String((req.body || {}).password || "");

    if (!looksLikeEmail(email)) {
      return res.status(400).json({error: "нужен адрес почты — по нему человек будет входить"});
    }
    if (!ROLES.includes(role)) {
      return res.status(400).json({error: "неизвестная роль"});
    }
    if (password.length < MIN_PASSWORD) {
      return res.status(400).json({error: `пароль короче ${MIN_PASSWORD} символов`});
    }
    if (await store.findUserByEmail(email)) {
      return res.status(409).json({error: "такой человек уже заведён"});
    }

    await store.upsertUser({email, passwordHash: hashPassword(password), role});
    await logTeamEvent(store, req.user.email, `в команду добавлен ${email} с ролью ${role}`);
    res.json({ok: true, email, role});
  }));

  /* ---------- изменить роль или пароль ---------- */

  router.patch("/", wrap(async (req, res) => {
    const email = normEmail((req.body || {}).email);
    const role = (req.body || {}).role;
    const password = (req.body || {}).password;

    const user = await store.findUserByEmail(email);
    if (!user) return res.status(404).json({error: "нет такого человека"});

    const patch = {email};
    const done = [];

    if (role !== undefined && role !== null && role !== user.role) {
      if (!ROLES.includes(role)) {
        return res.status(400).json({error: "неизвестная роль"});
      }
      if (email === normEmail(req.user.email) && role !== "admin") {
        return res.status(400).json({error: "нельзя снять роль админа с самого себя"});
      }
      if (user.role === "admin" && role !== "admin" && (await countAdmins()) <= 1) {
        return res.status(400).json({error: "это последний админ — сначала назначь другого"});
      }
      patch.role = role;
      done.push(`роль изменена на ${role}`);
    }

    if (password !== undefined && password !== null && password !== "") {
      if (String(password).length < MIN_PASSWORD) {
        return res.status(400).json({error: `пароль короче ${MIN_PASSWORD} символов`});
      }
      patch.passwordHash = hashPassword(String(password));
      done.push("сменён пароль");
    }

    if (!done.length) return res.json({ok: true, changed: false});

    await store.upsertUser(patch);
    await logTeamEvent(store, req.user.email, `${email}: ${done.join(", ")}`);
    res.json({ok: true, changed: true});
  }));

  /* ---------- удалить ---------- */

  router.delete("/", wrap(async (req, res) => {
    const email = normEmail(req.query.email);
    const user = await store.findUserByEmail(email);
    if (!user) return res.status(404).json({error: "нет такого человека"});

    if (email === normEmail(req.user.email)) {
      return res.status(400).json({error: "нельзя удалить самого себя"});
    }
    if (user.role === "admin" && (await countAdmins()) <= 1) {
      return res.status(400).json({error: "это последний админ — сначала назначь другого"});
    }

    await store.deleteUser(email);
    await logTeamEvent(store, req.user.email, `из команды удалён ${email}`);
    res.json({ok: true});
  }));

  router.use((err, req, res, next) => {
    console.error("[team]", err);
    res.status(500).json({error: "внутренняя ошибка"});
  });

  return router;
}

module.exports = {buildTeam, MIN_PASSWORD, looksLikeEmail};
