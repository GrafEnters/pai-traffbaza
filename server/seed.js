/**
 * seed.js — создаёт в базе структуру таблиц и виды, которые ждёт приложение.
 *
 * Запуск (строка подключения из панели Amvera или локальная):
 *   set DATABASE_URL=postgres://user:pass@host:5432/db
 *   node server/seed.js            # создать недостающее, существующее не трогать
 *   node server/seed.js --force    # перезаписать описания таблиц и видов
 *
 * Данные (строки таблиц) скрипт не трогает никогда.
 */

"use strict";

const {Store} = require("./lib/store");
const {TABLES, VIEWS} = require("../scripts/schema");

const FORCE = process.argv.includes("--force");
const NOW = () => new Date().toISOString();

async function main() {
  const store = new Store();
  await store.init();

  let created = 0; let updated = 0; let skipped = 0;
  for (const [tid, def] of Object.entries(TABLES)) {
    const existing = await store.getDoc("tables", tid);
    if (existing.exists && !FORCE) {
      skipped++;
      continue;
    }
    const body = {name: def.name, order: def.order, deleted: false, cols: def.cols};
    if (existing.exists) {
      await store.updateDoc("tables", tid, body);
      updated++;
      console.log(`  ~ tables/${tid} — описание обновлено (${Object.keys(def.cols).length} колонок)`);
    } else {
      await store.setDoc("tables", tid, {...body, at: NOW(), by: "seed"});
      created++;
      console.log(`  + tables/${tid} «${def.name}» — ${Object.keys(def.cols).length} колонок`);
    }
  }
  console.log(`Таблицы: создано ${created}, обновлено ${updated}, пропущено ${skipped}`);

  let vcreated = 0; let vskipped = 0;
  for (const [vid, def] of Object.entries(VIEWS)) {
    const existing = await store.getDoc("views", vid);
    if (existing.exists && !FORCE) {
      vskipped++;
      continue;
    }
    await store.setDoc("views", vid, def);
    vcreated++;
    console.log(`  + views/${vid} «${def.name}» -> ${def.table}`);
  }
  console.log(`Виды: записано ${vcreated}, пропущено ${vskipped}`);

  await store.close();
  console.log("Готово. Открывай приложение — таблицы уже на месте.");
}

main().catch((e) => {
  console.error("Сид упал:", e.message || e);
  console.error("Проверь DATABASE_URL и что база доступна.");
  process.exit(1);
});
