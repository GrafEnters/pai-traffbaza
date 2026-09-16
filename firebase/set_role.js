/**
 * set_role.js — выдать члену команды роль в базе.
 *
 * Роль пишется двумя способами сразу:
 *   1) custom claim `role` в Firebase Auth — его читают правила Firestore и приложение;
 *   2) документ users/{uid} — запасной путь, если токен ещё не обновился.
 *
 * Запуск:
 *   set GOOGLE_APPLICATION_CREDENTIALS=C:\путь\serviceAccount.json
 *   node scripts/set_role.js polina@example.com admin
 *   node scripts/set_role.js --list
 *
 * Роли: admin (всё + аналитика + переименование), manager (правит данные,
 * лимит 10 удалений в день), viewer (только чтение).
 *
 * Пользователь должен уже существовать в Authentication (заводится в консоли
 * Firebase, Email/Password). После смены роли ему нужно перезайти в приложение.
 */

const admin = require("firebase-admin");

const ROLES = ["admin", "manager", "viewer"];

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_CONFIG) {
  console.error("Нет ключа. Задай GOOGLE_APPLICATION_CREDENTIALS=<путь к serviceAccount.json>");
  process.exit(1);
}

admin.initializeApp({credential: admin.credential.applicationDefault()});

async function list() {
  const res = await admin.auth().listUsers(1000);
  if (!res.users.length) {
    console.log("В Authentication пока нет пользователей.");
    return;
  }
  console.log("Пользователи и роли:");
  for (const u of res.users) {
    const role = (u.customClaims || {}).role || "— (viewer по умолчанию)";
    console.log(`  ${u.email || u.uid}  ->  ${role}`);
  }
}

async function setRole(email, role) {
  const user = await admin.auth().getUserByEmail(email);
  await admin.auth().setCustomUserClaims(user.uid, {role});
  await admin.firestore().doc(`users/${user.uid}`).set({
    email: user.email || "",
    role,
    at: new Date().toISOString(),
  }, {merge: true});
  console.log(`${email} -> ${role}. Пусть перезайдёт в приложение, чтобы роль подхватилась.`);
}

(async () => {
  const args = process.argv.slice(2);
  if (args.includes("--list")) {
    await list();
    process.exit(0);
  }
  const [email, role] = args;
  if (!email || !role) {
    console.error("Использование: node scripts/set_role.js <email> <admin|manager|viewer>");
    console.error("               node scripts/set_role.js --list");
    process.exit(1);
  }
  if (!ROLES.includes(role)) {
    console.error(`Роль должна быть одной из: ${ROLES.join(", ")}`);
    process.exit(1);
  }
  await setRole(email, role);
  process.exit(0);
})().catch((e) => {
  console.error("Не получилось:", e.message || e);
  process.exit(1);
});
