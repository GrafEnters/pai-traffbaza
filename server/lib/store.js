/**
 * store.js — доступ к PostgreSQL.
 *
 * Все документы базы лежат в одной таблице `docs`, адресуемые парой
 * (коллекция, id) — ровно так, как приложение к ним обращается. Содержимое
 * документа хранится в jsonb, потому что набор колонок у таблиц свободный и
 * меняется пользователями на ходу.
 *
 * Слияние при частичном обновлении делается в Node, а не в SQL: семантика
 * непростая (см. merge.js), и держать её в одном протестированном месте
 * надёжнее, чем размазывать по jsonb-операторам.
 */

"use strict";

const crypto = require("crypto");
const {Pool} = require("pg");
const {deepMerge, stripUndefined} = require("./merge");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS docs (
  collection text        NOT NULL,
  id         text        NOT NULL,
  data       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS docs_collection_idx ON docs (collection);

CREATE TABLE IF NOT EXISTS users (
  id            text        PRIMARY KEY,
  email         text        NOT NULL UNIQUE,
  password_hash text        NOT NULL,
  role          text        NOT NULL DEFAULT 'viewer',
  created_at    timestamptz NOT NULL DEFAULT now()
);
`;

/** случайный id документа — аналог автогенерации Firestore */
const newId = () => crypto.randomBytes(12).toString("base64url");

/**
 * Нужен ли TLS для этого подключения.
 *
 * У Amvera два разных адреса одной и той же базы:
 *   * внутренний (amvera-…-cnpg-…-rw) — из соседнего контейнера, TLS там нет;
 *   * внешний (…db-msk0.amvera.tech) — с ноутбука, и вот он требует SSL.
 * Оба содержат слово «amvera», поэтому различаем именно по домену: включить
 * TLS там, где его не предлагают, — и подключение просто не установится.
 *
 * Принудительно задаётся переменной PGSSL=1 или PGSSL=0.
 */
function needsSsl(url) {
  const force = process.env.PGSSL;
  if (force === "1" || force === "true") return true;
  if (force === "0" || force === "false") return false;
  if (/sslmode=require|sslmode=verify/.test(url)) return true;
  return /amvera\.tech|\.db-[a-z0-9]+\.amvera/.test(url);
}

function buildPool(options) {
  const opts = options || {};
  if (opts.pool) return opts.pool;
  const url = opts.connectionString || process.env.DATABASE_URL;
  if (url) {
    // сертификат у них собственный, поэтому цепочку не проверяем,
    // но само шифрование канала остаётся
    const ssl = needsSsl(url) ? {rejectUnauthorized: false} : undefined;
    return new Pool({connectionString: url, ssl, max: 10});
  }
  return new Pool({
    host: process.env.PGHOST || "127.0.0.1",
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "",
    database: process.env.PGDATABASE || "postgres",
    max: 10,
  });
}

class Store {
  constructor(options) {
    this.pool = buildPool(options);
    /** вызывается после каждой записи: (collection, event) */
    this.onChange = (options && options.onChange) || null;
  }

  /**
   * Создать схему и проверить базу.
   *
   * С повторами: при деплое контейнер приложения может подняться раньше, чем
   * база начнёт принимать подключения. Без ожидания процесс падал бы, и Amvera
   * крутила бы его в цикле перезапусков, пугая ошибками в логе.
   */
  async init(attempts = 10) {
    for (let i = 1; ; i++) {
      try {
        await this.pool.query(SCHEMA);
        break;
      } catch (e) {
        if (i >= attempts) {
          console.error("[store] база так и не ответила:", e.message || e);
          throw e;
        }
        const waitMs = Math.min(1000 * i, 5000);
        console.warn(`[store] база не отвечает (попытка ${i}/${attempts}), жду ${waitMs} мс: ${e.message || e}`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    this.encoding = await this.checkEncoding();
  }

  /**
   * Кодировка базы должна быть UTF8.
   * В базе лежит русский текст со стрелками, значками и эмодзи (лог действий,
   * пометка корзины). Если база создана, например, в WIN1251, такие записи не
   * сохраняются и запрос падает с ошибкой — молча и не сразу, поэтому лучше
   * предупредить громко при старте.
   */
  async checkEncoding() {
    try {
      const r = await this.pool.query("SHOW server_encoding");
      const enc = r.rows[0] && r.rows[0].server_encoding;
      if (enc && enc.toUpperCase() !== "UTF8") {
        console.error(
            `[store] ВНИМАНИЕ: кодировка базы ${enc}, а нужна UTF8. ` +
            "Часть символов (стрелки в логе, значок корзины) сохранить не выйдет. " +
            "Пересоздай базу с ENCODING 'UTF8'.");
      }
      return enc || null;
    } catch (e) {
      return null;
    }
  }

  async close() {
    await this.pool.end();
  }

  notify(collection, event) {
    if (this.onChange) {
      try {
        this.onChange(collection, event);
      } catch (e) {
        console.error("[store] слушатель изменений упал:", e);
      }
    }
  }

  /* ---------- чтение ---------- */

  async getDoc(collection, id) {
    const r = await this.pool.query(
        "SELECT data FROM docs WHERE collection = $1 AND id = $2", [collection, id]);
    if (!r.rows.length) return {exists: false, data: null};
    return {exists: true, data: r.rows[0].data};
  }

  async listCollection(collection) {
    const r = await this.pool.query(
        "SELECT id, data FROM docs WHERE collection = $1 ORDER BY id", [collection]);
    return r.rows.map((row) => ({id: row.id, data: row.data}));
  }

  /** сколько документов в коллекции — для служебных проверок */
  async countCollection(collection) {
    const r = await this.pool.query(
        "SELECT count(*)::int AS n FROM docs WHERE collection = $1", [collection]);
    return r.rows[0].n;
  }

  /* ---------- запись ---------- */

  /** полная запись документа (создать или заменить целиком) */
  async setDoc(collection, id, data) {
    const clean = stripUndefined(data || {});
    await this.pool.query(
        `INSERT INTO docs (collection, id, data) VALUES ($1, $2, $3)
         ON CONFLICT (collection, id) DO UPDATE SET data = $3, updated_at = now()`,
        [collection, id, JSON.stringify(clean)]);
    this.notify(collection, {type: "change", collection, id, data: clean});
    return clean;
  }

  /**
   * Частичное обновление с глубоким слиянием (см. merge.js).
   * Читает и пишет в одной транзакции, чтобы две одновременные правки
   * разных ячеек не затёрли друг друга.
   */
  async updateDoc(collection, id, patch) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const cur = await client.query(
          "SELECT data FROM docs WHERE collection = $1 AND id = $2 FOR UPDATE",
          [collection, id]);
      const base = cur.rows.length ? cur.rows[0].data : {};
      const merged = deepMerge(base, stripUndefined(patch || {}));
      await client.query(
          `INSERT INTO docs (collection, id, data) VALUES ($1, $2, $3)
           ON CONFLICT (collection, id) DO UPDATE SET data = $3, updated_at = now()`,
          [collection, id, JSON.stringify(merged)]);
      await client.query("COMMIT");
      this.notify(collection, {type: "change", collection, id, data: merged});
      return merged;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  /** создать документ со сгенерированным id */
  async addDoc(collection, data) {
    const id = newId();
    await this.setDoc(collection, id, data);
    return id;
  }

  async deleteDoc(collection, id) {
    const r = await this.pool.query(
        "DELETE FROM docs WHERE collection = $1 AND id = $2", [collection, id]);
    if (r.rowCount) this.notify(collection, {type: "delete", collection, id});
    return r.rowCount > 0;
  }

  /**
   * Пакетное слияние — этим пишет приёмник инвентаря.
   * Всё в одной транзакции: либо аккаунт со всеми ассетами лёг, либо ничего.
   */
  async mergeMany(records) {
    if (!records.length) return [];
    const client = await this.pool.connect();
    const events = [];
    try {
      await client.query("BEGIN");
      for (const {collection, id, data} of records) {
        const cur = await client.query(
            "SELECT data FROM docs WHERE collection = $1 AND id = $2 FOR UPDATE",
            [collection, id]);
        const base = cur.rows.length ? cur.rows[0].data : {};
        const merged = deepMerge(base, stripUndefined(data));
        await client.query(
            `INSERT INTO docs (collection, id, data) VALUES ($1, $2, $3)
             ON CONFLICT (collection, id) DO UPDATE SET data = $3, updated_at = now()`,
            [collection, id, JSON.stringify(merged)]);
        events.push({type: "change", collection, id, data: merged});
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    for (const ev of events) this.notify(ev.collection, ev);
    return events;
  }

  /* ---------- пользователи ---------- */

  async findUserByEmail(email) {
    const r = await this.pool.query(
        "SELECT id, email, password_hash, role FROM users WHERE email = $1",
        [String(email || "").trim().toLowerCase()]);
    return r.rows[0] || null;
  }

  async findUserById(id) {
    const r = await this.pool.query(
        "SELECT id, email, password_hash, role FROM users WHERE id = $1", [id]);
    return r.rows[0] || null;
  }

  async upsertUser({email, passwordHash, role}) {
    const mail = String(email).trim().toLowerCase();
    const existing = await this.findUserByEmail(mail);
    if (existing) {
      const r = await this.pool.query(
          `UPDATE users SET role = COALESCE($2, role),
                            password_hash = COALESCE($3, password_hash)
           WHERE id = $1 RETURNING id, email, role`,
          [existing.id, role || null, passwordHash || null]);
      return r.rows[0];
    }
    const r = await this.pool.query(
        `INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, $4)
         RETURNING id, email, role`,
        [newId(), mail, passwordHash, role || "viewer"]);
    return r.rows[0];
  }

  async listUsers() {
    const r = await this.pool.query(
        "SELECT email, role, created_at FROM users ORDER BY created_at");
    return r.rows;
  }

  async deleteUser(email) {
    const r = await this.pool.query(
        "DELETE FROM users WHERE email = $1", [String(email).trim().toLowerCase()]);
    return r.rowCount > 0;
  }
}

module.exports = {Store, newId, SCHEMA};
