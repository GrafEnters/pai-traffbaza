/**
 * paths.js — разбор путей документов и коллекций.
 *
 * Пути те же, что были в Firestore, потому что приложение обращается к базе
 * именно ими: коллекция — нечётное число сегментов, документ — чётное.
 *   коллекция: "tables", "views", "log", "tables/t_acc/rows"
 *   документ:  "tables/t_acc", "views/v_acc_all", "tables/t_acc/rows/fb_123"
 */

"use strict";

/** коллекции, к которым приложению вообще можно обращаться */
const ALLOWED_ROOTS = new Set(["tables", "views", "log", "limits"]);

class PathError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function segments(path) {
  const parts = String(path || "").split("/").filter((s) => s.length > 0);
  for (const p of parts) {
    if (p === "." || p === "..") throw new PathError("недопустимый путь");
  }
  return parts;
}

/** проверить, что корень пути разрешён (служебные users через это API не ходят) */
function checkRoot(parts) {
  if (!parts.length || !ALLOWED_ROOTS.has(parts[0])) {
    throw new PathError(`коллекция «${parts[0] || ""}» недоступна`);
  }
}

/** "tables/t_acc/rows" -> {collection: "tables/t_acc/rows", root: "tables"} */
function parseCollection(path) {
  const parts = segments(path);
  if (parts.length === 0 || parts.length % 2 === 0) {
    throw new PathError("это путь документа, а не коллекции");
  }
  checkRoot(parts);
  return {collection: parts.join("/"), root: parts[0]};
}

/** "tables/t_acc/rows/fb_1" -> {collection: "tables/t_acc/rows", id: "fb_1", root: "tables"} */
function parseDoc(path) {
  const parts = segments(path);
  if (parts.length < 2 || parts.length % 2 !== 0) {
    throw new PathError("это путь коллекции, а не документа");
  }
  checkRoot(parts);
  return {
    collection: parts.slice(0, -1).join("/"),
    id: parts[parts.length - 1],
    root: parts[0],
  };
}

module.exports = {parseCollection, parseDoc, PathError, ALLOWED_ROOTS};
