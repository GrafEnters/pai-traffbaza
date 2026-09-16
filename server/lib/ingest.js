/**
 * ingest.js — приёмник инвентаря от расширения.
 *
 * Единственная точка, куда пишет расширение. Доступа к базе у него нет:
 * только адрес этого эндпоинта и общий секрет. Шлёт оно исключительно
 * FB-данные ассетов, никаких логинов и паролей.
 *
 * Запрос приходит со страницы facebook.com, то есть кросс-доменный, поэтому
 * здесь свои заголовки CORS и обработка префлайта. Разрешаем любой источник
 * осознанно: защищает секрет, а не происхождение запроса.
 */

"use strict";

const express = require("express");
const {inventoryRecords} = require("./mapping");

function buildIngest({store, secret}) {
  const router = express.Router();

  router.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });

  router.post("/", async (req, res) => {
    if (!secret) {
      console.error("[ingest] SYNC_SECRET не задан — приём отключён");
      return res.status(503).json({error: "приём не настроен"});
    }
    const body = req.body || {};
    if (body.secret !== secret) {
      console.warn("[ingest] отклонён запрос с неверным секретом");
      return res.status(403).json({error: "forbidden"});
    }

    const inv = body.inv;
    if (!inv || !inv.user || !inv.user.id) {
      return res.status(400).json({error: "inv.user.id обязателен"});
    }

    let records;
    try {
      records = inventoryRecords(inv);
    } catch (e) {
      console.error("[ingest] не смог разложить инвентарь:", e);
      return res.status(400).json({error: "bad inventory"});
    }

    try {
      await store.mergeMany(records);
    } catch (e) {
      console.error("[ingest] запись в базу упала:", e);
      return res.status(500).json({error: "write failed"});
    }

    const counts = {
      bm: (inv.businesses || []).length,
      aa: (inv.ad_accounts || []).length,
      fp: (inv.pages || []).length,
      px: (inv.pixels || []).length,
    };
    console.log(`[ingest] fb_${inv.user.id} -> ${records.length} документов`, counts);
    res.json({ok: true, written: records.length, counts});
  });

  router.all("/", (req, res) => res.status(405).json({error: "POST only"}));

  return router;
}

module.exports = {buildIngest};
