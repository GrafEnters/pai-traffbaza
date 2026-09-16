/**
 * merge.js — семантика частичного обновления документа.
 *
 * Приложение шлёт частичные объекты и ждёт ГЛУБОКОГО слияния:
 *   * {c: {c_status: "active"}}      — меняет одну ячейку, соседние не трогает;
 *   * {cols: {c_x: {order: 15}}}     — двигает колонку, сохраняя её name/type/opts;
 *   * {del: null}                    — убирает поле целиком (возврат из корзины);
 *   * {filters: [...]}               — массив заменяется целиком, а не сливается.
 *
 * Правила ровно те же, что были на Firestore, и покрыты тестами (test/merge.test.js).
 * Ошибиться здесь легко, а последствие — затёртые вручную заполненные пароли,
 * поэтому логика вынесена в отдельный модуль и используется и API, и приёмником.
 */

"use strict";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Слить patch в target по правилам выше. Ничего не мутирует.
 * @param {object|undefined} target текущее содержимое документа
 * @param {object} patch частичное обновление
 * @returns {object} новое содержимое
 */
function deepMerge(target, patch) {
  const out = isPlainObject(target) ? {...target} : {};
  if (!isPlainObject(patch)) return out;
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value === null) {
      delete out[key];
      continue;
    }
    if (value === undefined) continue;
    if (isPlainObject(value)) {
      out[key] = deepMerge(out[key], value);
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Убрать null-значения из объекта, не удаляя ничего (для операции set).
 * При полной записи null означает просто «пустое поле», а не «удалить».
 */
function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (isPlainObject(value)) {
    const out = {};
    for (const k of Object.keys(value)) {
      if (value[k] === undefined) continue;
      out[k] = stripUndefined(value[k]);
    }
    return out;
  }
  return value;
}

module.exports = {deepMerge, stripUndefined, isPlainObject};
