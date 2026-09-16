/**
 * seed.js — создаёт в Firestore структуру таблиц и виды, которые ждёт приложение.
 *
 * Запуск (нужен service-account-ключ Firebase):
 *   set GOOGLE_APPLICATION_CREDENTIALS=C:\путь\serviceAccount.json
 *   node scripts/seed.js            # создать недостающее, существующее не трогать
 *   node scripts/seed.js --force    # перезаписать описания таблиц и видов
 *
 * Данные (строки tables/<t>/rows) скрипт НЕ трогает никогда.
 */

const admin = require("firebase-admin");
const {TABLES, VIEWS} = require("./schema");

const FORCE = process.argv.includes("--force");

// против эмулятора ключ не нужен — хватает FIRESTORE_EMULATOR_HOST
const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;

if (!EMULATOR && !process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_CONFIG) {
  console.error("Нет ключа. Задай GOOGLE_APPLICATION_CREDENTIALS=<путь к serviceAccount.json>");
  process.exit(1);
}

admin.initializeApp(EMULATOR ?
  {projectId: process.env.GCLOUD_PROJECT || "demo-inventory"} :
  {credential: admin.credential.applicationDefault()});
const db = admin.firestore();

const NOW = () => new Date().toISOString();

async function seedTables() {
  let created = 0; let updated = 0; let skipped = 0;
  for (const [tid, def] of Object.entries(TABLES)) {
    const ref = db.doc(`tables/${tid}`);
    const snap = await ref.get();
    if (snap.exists && !FORCE) {
      skipped++;
      continue;
    }
    const body = {
      name: def.name,
      order: def.order,
      deleted: false,
      cols: def.cols,
      at: NOW(),
      by: "seed",
    };
    // при --force обновляем описание, но не сбрасываем дату создания
    if (snap.exists) {
      delete body.at;
      delete body.by;
      await ref.set(body, {merge: true});
      updated++;
      console.log(`  ~ tables/${tid} — описание обновлено (${Object.keys(def.cols).length} колонок)`);
    } else {
      await ref.set(body);
      created++;
      console.log(`  + tables/${tid} «${def.name}» — ${Object.keys(def.cols).length} колонок`);
    }
  }
  console.log(`Таблицы: создано ${created}, обновлено ${updated}, пропущено ${skipped}`);
}

async function seedViews() {
  let created = 0; let skipped = 0;
  for (const [vid, def] of Object.entries(VIEWS)) {
    const ref = db.doc(`views/${vid}`);
    const snap = await ref.get();
    if (snap.exists && !FORCE) {
      skipped++;
      continue;
    }
    await ref.set(def);
    created++;
    console.log(`  + views/${vid} «${def.name}» -> ${def.table}`);
  }
  console.log(`Виды: записано ${created}, пропущено ${skipped}`);
}

(async () => {
  console.log(`Проект: ${admin.app().options.projectId || "(из ключа)"}${FORCE ? " · режим --force" : ""}`);
  await seedTables();
  await seedViews();
  console.log("Готово. Открывай приложение — таблицы уже на месте.");
  process.exit(0);
})().catch((e) => {
  console.error("Сид упал:", e);
  process.exit(1);
});
