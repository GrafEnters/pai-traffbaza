/**
 * devdb.js — создание локальной базы в правильной кодировке.
 *
 * Нужен только для локального запуска и тестов. Встроенный PostgreSQL берёт
 * кодировку из локали машины, и на русской Windows это оказывается WIN1251.
 * В такой базе падает запись любого символа за её пределами: стрелки «→»
 * в логе действий, значок корзины у удалённых записей и прочее.
 *
 * Поэтому базу для разработки создаём явно в UTF8 — как на боевом сервере.
 */

"use strict";

const {Client} = require("pg");

async function ensureUtf8Database({port, user, password, database, host}) {
  const client = new Client({
    host: host || "127.0.0.1",
    port,
    user,
    password,
    database: "postgres",
  });
  await client.connect();
  try {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
    if (!exists.rows.length) {
      // template0 нужен, чтобы задать кодировку, отличную от локали кластера
      await client.query(
          `CREATE DATABASE "${database}" WITH ENCODING 'UTF8' ` +
          "LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0");
    }
    const enc = await client.query(
        "SELECT pg_encoding_to_char(encoding) AS enc FROM pg_database WHERE datname = $1",
        [database]);
    return enc.rows[0] ? enc.rows[0].enc : null;
  } finally {
    await client.end();
  }
}

module.exports = {ensureUtf8Database};
