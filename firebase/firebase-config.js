/**
 * firebase-config.js — публичный конфиг веб-приложения.
 *
 * Возьми его в консоли Firebase: Project settings -> General -> Your apps ->
 * Web app -> SDK setup and configuration -> Config. Скопируй значения сюда.
 *
 * Эти ключи не секрет: доступ к данным защищают правила Firestore и вход по
 * паролю (см. firestore.rules). Секрет расширения сюда НЕ кладём.
 */

window.__FIREBASE_CONFIG__ = {
  apiKey: "ЗАМЕНИ-apiKey",
  authDomain: "ЗАМЕНИ-НА-ID-ПРОЕКТА.firebaseapp.com",
  projectId: "ЗАМЕНИ-НА-ID-ПРОЕКТА",
  storageBucket: "ЗАМЕНИ-НА-ID-ПРОЕКТА.appspot.com",
  messagingSenderId: "ЗАМЕНИ-senderId",
  appId: "ЗАМЕНИ-appId",
};
