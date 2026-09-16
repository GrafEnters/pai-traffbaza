/**
 * auth.js — вход по почте и паролю, роли, подписанная cookie сессии.
 *
 * Без внешних зависимостей: пароли хешируются встроенным scrypt, сессия —
 * это подписанный HMAC-ом маленький JSON в httpOnly-cookie. Нативных модулей
 * нет, поэтому сборка на Amvera не зависит от компилятора.
 *
 * Роли повторяют прежние правила Firestore:
 *   admin   — всё, включая архив таблиц и аналитику;
 *   manager — правит данные, не удаляет таблицы;
 *   viewer  — только чтение.
 */

"use strict";

const crypto = require("crypto");

const COOKIE = "sid";
const SESSION_DAYS = 30;
const ROLES = ["admin", "manager", "viewer"];

/* ---------- пароли ---------- */

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

function verifyPassword(password, stored) {
  try {
    const [algo, saltB64, hashB64] = String(stored || "").split("$");
    if (algo !== "scrypt" || !saltB64 || !hashB64) return false;
    const salt = Buffer.from(saltB64, "base64url");
    const expected = Buffer.from(hashB64, "base64url");
    const actual = crypto.scryptSync(String(password), salt, expected.length);
    return crypto.timingSafeEqual(expected, actual);
  } catch (e) {
    return false;
  }
}

/* ---------- сессия ---------- */

function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function unsign(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  const [body, mac] = parts;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch (e) {
    return null;
  }
  if (!payload || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
  return payload;
}

/** разобрать заголовок Cookie (без сторонних парсеров) */
function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

class Auth {
  constructor(store, secret) {
    if (!secret) throw new Error("SESSION_SECRET не задан");
    this.store = store;
    this.secret = secret;
  }

  makeToken(user) {
    return sign({
      uid: user.id,
      email: user.email,
      role: user.role,
      exp: Date.now() + SESSION_DAYS * 864e5,
    }, this.secret);
  }

  readToken(req) {
    const cookies = parseCookies(req.headers.cookie);
    return unsign(cookies[COOKIE], this.secret);
  }

  setCookie(res, token, secure) {
    const bits = [
      `${COOKIE}=${token}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${SESSION_DAYS * 24 * 3600}`,
    ];
    if (secure) bits.push("Secure");
    res.setHeader("Set-Cookie", bits.join("; "));
  }

  clearCookie(res) {
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  }

  /** проверить пару почта/пароль, вернуть пользователя или null */
  async check(email, password) {
    const user = await this.store.findUserByEmail(email);
    if (!user) {
      // тратим столько же времени, сколько на реальной проверке,
      // чтобы по скорости ответа нельзя было перебирать существующие адреса
      crypto.scryptSync(String(password), "timing", 64);
      return null;
    }
    if (!verifyPassword(password, user.password_hash)) return null;
    return {id: user.id, email: user.email, role: user.role};
  }

  /** middleware: требуется вход */
  requireUser() {
    return (req, res, next) => {
      const payload = this.readToken(req);
      if (!payload) return res.status(401).json({error: "нужен вход"});
      req.user = {id: payload.uid, email: payload.email, role: payload.role};
      next();
    };
  }
}

/**
 * Право на запись — серверный аналог прежних правил Firestore.
 *
 * Различать таблицу и её строки важно: у документа таблицы коллекция «tables»,
 * а у строки — «tables/<id>/rows». Менеджеру строки удалять можно, а таблицу нет.
 *
 * @param {string} role роль пользователя
 * @param {string} collection коллекция документа, например "tables" или "tables/t_acc/rows"
 * @param {string} op create | update | delete
 */
function canWrite(role, collection, op) {
  if (!ROLES.includes(role)) return false;
  if (role === "viewer") return false;
  const root = String(collection || "").split("/")[0];
  // лог не стирает никто: в нём лежат копии удалённых записей
  if (root === "log" && op === "delete") return false;
  // убрать документ самой таблицы может только админ; строки — и менеджер
  if (collection === "tables" && op === "delete") return role === "admin";
  return true;
}

module.exports = {
  Auth, hashPassword, verifyPassword, canWrite, parseCookies, unsign, sign, ROLES, COOKIE,
};
