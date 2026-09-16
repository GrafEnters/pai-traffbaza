/**
 * helpers.js — мелочь для тестов: проверки и HTTP-клиент, помнящий cookie.
 */

"use strict";

const state = {failed: 0, passed: 0, lines: []};

function ok(name, cond, extra) {
  if (cond) {
    state.passed++;
    state.lines.push(`  ok  ${name}`);
  } else {
    state.failed++;
    state.lines.push(`  FAIL ${name}${extra !== undefined ? ` -> ${safe(extra)}` : ""}`);
  }
}

function safe(v) {
  try {
    return JSON.stringify(v);
  } catch (e) {
    return String(v);
  }
}

function section(title) {
  state.lines.push(`\n${title}`);
}

async function throws(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** дождаться условия, чтобы не привязываться к фиксированным паузам */
async function until(fn, timeoutMs, stepMs) {
  const limit = Date.now() + (timeoutMs || 4000);
  for (;;) {
    let value;
    try {
      value = await fn();
    } catch (e) {
      value = false;
    }
    if (value) return value;
    if (Date.now() > limit) return false;
    await sleep(stepMs || 50);
  }
}

/** клиент, который хранит cookie сессии — как браузер */
function makeClient(baseUrl) {
  let cookie = "";
  async function call(method, path, body) {
    const headers = {"Accept": "application/json"};
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    let data = null;
    try {
      data = await res.json();
    } catch (e) { /* пустой ответ */ }
    return {status: res.status, data, ok: res.ok};
  }
  return {
    call,
    get cookie() {
      return cookie;
    },
    clearCookie() {
      cookie = "";
    },
    doc: (path) => `/api/doc?path=${encodeURIComponent(path)}`,
    col: (path) => `/api/collection?path=${encodeURIComponent(path)}`,
  };
}

module.exports = {ok, section, throws, sleep, until, makeClient, state};
