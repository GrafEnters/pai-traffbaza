/**
 * config.example.js — скопируй в config.js и подставь свои значения.
 *
 * endpoint — адрес приёмника на твоём сервере. Это домен приложения в Amvera
 *            плюс /api/ingest, например:
 *            https://inventory-ivanov.amvera.io/api/ingest
 *            Обязательно https: Chrome не пустит расширение на http.
 *
 * secret   — то же значение, что задано переменной SYNC_SECRET у приложения
 *            в панели Amvera.
 *
 * debug    — true выводит ход сбора в консоль страницы Ads Manager.
 *
 * Для локальной проверки (npm run dev в папке server) подойдёт:
 *   endpoint: "http://127.0.0.1:3000/api/ingest", secret: "dev-sync-secret"
 *   и добавь "http://127.0.0.1:3000/*" в host_permissions манифеста.
 *
 * config.js в репозиторий не коммитим (он в .gitignore): в нём лежит секрет,
 * а расширение раздаётся в AdsPower уже собранным.
 */

self.__SYNC_CONFIG__ = {
  endpoint: "https://ЗАМЕНИ-НА-ДОМЕН/api/ingest",
  secret: "ЗАМЕНИ-НА-ОБЩИЙ-СЕКРЕТ",
  debug: false,
};
