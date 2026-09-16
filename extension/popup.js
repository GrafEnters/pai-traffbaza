/**
 * popup.js — что показывает окошко расширения.
 *
 * Расширение работает молча в фоне, и раньше понять, отправились ли данные,
 * можно было только через консоль страницы. Здесь виден итог последнего
 * прогона: когда, что нашлось и приняла ли база.
 */

"use strict";

const STATE_LABELS = {
  ok: "Работает",
  error: "Ошибка",
  idle: "Ждёт",
};

/** «5 минут назад» вместо голой отметки времени */
function ago(ts) {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return "только что";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  return `${Math.round(hours / 24)} дн назад`;
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g,
    (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"}[c]));

function render(status) {
  const out = document.getElementById("out");
  const hint = document.getElementById("hint");

  if (!status) {
    out.innerHTML = '<span class="badge s-idle">Ещё не запускался</span>' +
      '<div class="msg">Открой Ads Manager в профиле AdsPower — сбор пойдёт сам.</div>';
    hint.textContent = "Расширение работает в фоне: кнопок нажимать не нужно.";
    return;
  }

  const state = STATE_LABELS[status.state] ? status.state : "idle";
  const c = status.counts;
  // сокращения те же, что в самой базе: БМ · РК · ФП · PX
  const chips = c ? `<div class="counts">
      <span class="chip">БМ <b>${c.bm}</b></span>
      <span class="chip">РК <b>${c.aa}</b></span>
      <span class="chip">ФП <b>${c.fp}</b></span>
      <span class="chip">PX <b>${c.px}</b></span>
    </div>` : "";

  const rows = [];
  if (status.fbname || status.fbid) {
    rows.push(`<div class="kv"><span>Аккаунт</span><span>${esc(status.fbname || status.fbid)}</span></div>`);
  }
  rows.push(`<div class="kv"><span>Проверка</span><span>${esc(ago(status.at))}</span></div>`);
  if (status.host) {
    rows.push(`<div class="kv"><span>База</span><span>${esc(status.host)}</span></div>`);
  }

  out.innerHTML =
    `<span class="badge s-${state}">${STATE_LABELS[state]}</span>` +
    `<div class="msg">${esc(status.message || "")}</div>` +
    chips + rows.join("");

  hint.textContent = status.state === "error" ?
    "Если ошибка повторяется, покажи это администратору базы." :
    "Один аккаунт отправляется не чаще раза в час.";
}

chrome.storage.local.get("laststatus")
    .then((data) => render(data && data.laststatus))
    .catch(() => render(null));
