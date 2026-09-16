/**
 * adapter.js — слой хранилища и вход в приложение.
 *
 * Приложение писалось под интерфейс коллекций и документов с живой подпиской
 * (collection/doc, onSnapshot, get/set/update/delete). Здесь этот интерфейс
 * собирается поверх нашего API: обычные HTTP-запросы плюс WebSocket, по
 * которому сервер присылает изменения.
 *
 * Что важно в этом слое:
 *   * .update() — ГЛУБОКОЕ слияние. Приложение шлёт {c:{colId:val}} ожидая,
 *     что остальные ячейки останутся, и {cols:{colId:{order:5}}} ожидая, что у
 *     колонки сохранятся name/type. Слияние делает сервер, здесь только запрос.
 *   * onSnapshot отдаёт приложению ПОЛНЫЙ список документов при каждом
 *     изменении, поэтому адаптер держит кэш коллекции и обновляет его дельтами.
 *   * Подписка оформляется ДО первой выборки, а пришедшие тем временем
 *     изменения буферизуются — иначе правка в этот момент потерялась бы.
 *   * Если WebSocket не поднялся (прокси, сеть, блокировщик), адаптер сам
 *     переходит на периодический опрос: медленнее, но работает.
 *
 * Глобалы наружу: window.__DB__, window.__AUTH__, window.__downloads__.
 */

(function () {
  "use strict";

  var API = "/api";
  var POLL_MS = 7000; // как часто опрашивать, если живой канал недоступен

  /* ---------- запросы ---------- */

  function request(method, url, body) {
    var opts = {
      method: method,
      credentials: "same-origin",
      headers: {"Accept": "application/json"},
    };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (res) {
      if (res.status === 204) return null;
      return res.json().catch(function () {
        return null;
      }).then(function (data) {
        if (res.ok) return data;
        var err = new Error((data && data.error) || ("HTTP " + res.status));
        err.code = res.status === 403 ? "permission-denied" :
          res.status === 401 ? "unauthenticated" : ("http-" + res.status);
        err.status = res.status;
        throw err;
      });
    });
  }

  var q = function (path) {
    return API + "/doc?path=" + encodeURIComponent(path);
  };
  var qc = function (path) {
    return API + "/collection?path=" + encodeURIComponent(path);
  };

  /* ---------- живой канал ---------- */

  var live = {
    socket: null,
    ready: false,
    subs: {},          // путь коллекции -> {cb, err, cache, buffer, started}
    reconnectMs: 1000,
    pollTimer: null,
    polling: false,
  };

  function wsUrl() {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    return proto + "//" + location.host + API + "/live";
  }

  function connect() {
    if (live.socket || !Object.keys(live.subs).length) return;
    var socket;
    try {
      socket = new WebSocket(wsUrl());
    } catch (e) {
      startPolling();
      return;
    }
    live.socket = socket;

    socket.onopen = function () {
      live.ready = true;
      live.reconnectMs = 1000;
      stopPolling();
      var paths = Object.keys(live.subs);
      if (paths.length) socket.send(JSON.stringify({sub: paths}));
      // после разрыва данные могли уйти вперёд — перечитываем целиком
      for (var i = 0; i < paths.length; i++) refresh(paths[i]);
    };

    socket.onmessage = function (ev) {
      var msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      if (msg.t === "change" || msg.t === "delete") applyEvent(msg);
    };

    socket.onclose = function (ev) {
      live.socket = null;
      live.ready = false;
      if (ev && ev.code === 4001) {
        // сервер говорит, что мы не вошли — пусть решает экран входа
        if (window.__AUTH__) window.__AUTH__.refresh();
        return;
      }
      if (!Object.keys(live.subs).length) return;
      // пока канал лежит, данные не должны застывать
      startPolling();
      setTimeout(connect, live.reconnectMs);
      live.reconnectMs = Math.min(live.reconnectMs * 2, 30000);
    };

    socket.onerror = function () {
      try {
        socket.close();
      } catch (e) { /* уже закрыт */ }
    };
  }

  function applyEvent(msg) {
    var sub = live.subs[msg.c];
    if (!sub) return;
    if (!sub.started) {
      // первая выборка ещё не пришла — придержим, применим после неё
      sub.buffer.push(msg);
      return;
    }
    if (msg.t === "delete") delete sub.cache[msg.id];
    else sub.cache[msg.id] = msg.data;
    emit(msg.c);
  }

  function emit(path) {
    var sub = live.subs[path];
    if (!sub || !sub.started) return;
    var docs = Object.keys(sub.cache).map(function (id) {
      var data = sub.cache[id];
      return {
        id: id,
        exists: true,
        data: function () {
          return data;
        },
      };
    });
    try {
      sub.cb({docs: docs});
    } catch (e) {
      console.error("[adapter] обработчик снимка упал:", e);
    }
  }

  function refresh(path) {
    var sub = live.subs[path];
    if (!sub) return Promise.resolve();
    return request("GET", qc(path)).then(function (res) {
      if (!live.subs[path]) return;
      var cache = {};
      (res.docs || []).forEach(function (d) {
        cache[d.id] = d.data;
      });
      sub.cache = cache;
      sub.started = true;
      // накопленные за время выборки изменения
      var buffered = sub.buffer;
      sub.buffer = [];
      buffered.forEach(function (msg) {
        if (msg.t === "delete") delete sub.cache[msg.id];
        else sub.cache[msg.id] = msg.data;
      });
      emit(path);
    }).catch(function (e) {
      if (sub.err) sub.err(e);
    });
  }

  function startPolling() {
    if (live.pollTimer) return;
    live.polling = true;
    live.pollTimer = setInterval(function () {
      Object.keys(live.subs).forEach(refresh);
    }, POLL_MS);
  }

  function stopPolling() {
    if (!live.pollTimer) return;
    clearInterval(live.pollTimer);
    live.pollTimer = null;
    live.polling = false;
  }

  function subscribe(path, cb, err) {
    live.subs[path] = {cb: cb, err: err, cache: {}, buffer: [], started: false};
    if (live.ready && live.socket) {
      live.socket.send(JSON.stringify({sub: [path]}));
      refresh(path);
    } else {
      connect();
      // если сокет не встанет, первая выборка всё равно должна случиться
      refresh(path);
    }
    return function unsubscribe() {
      delete live.subs[path];
      if (live.ready && live.socket) {
        try {
          live.socket.send(JSON.stringify({unsub: [path]}));
        } catch (e) { /* канал уже закрыт */ }
      }
      if (!Object.keys(live.subs).length) stopPolling();
    };
  }

  /* ---------- интерфейс хранилища ---------- */

  function wrapDoc(path) {
    return {
      get: function () {
        return request("GET", q(path)).then(function (res) {
          var data = res && res.data;
          return {
            exists: !!(res && res.exists),
            data: function () {
              return data;
            },
          };
        });
      },
      set: function (data, opts) {
        return request("PUT", q(path), {data: data, merge: !!(opts && opts.merge)});
      },
      update: function (data) {
        return request("PATCH", q(path), {data: data});
      },
      delete: function () {
        return request("DELETE", q(path));
      },
    };
  }

  function wrapCol(path) {
    return {
      onSnapshot: function (cb, err) {
        return subscribe(path, cb, err);
      },
      add: function (data) {
        return request("POST", qc(path), data || {});
      },
      get: function () {
        return request("GET", qc(path)).then(function (res) {
          return {
            docs: (res.docs || []).map(function (d) {
              return {
                id: d.id,
                exists: true,
                data: function () {
                  return d.data;
                },
              };
            }),
          };
        });
      },
    };
  }

  window.__DB__ = {collection: wrapCol, doc: wrapDoc};

  /* ---------- скачивание файлов ---------- */

  window.__downloads__ = {
    save: function (opts) {
      try {
        var filename = (opts && opts.filename) || "export.txt";
        var type = /\.json$/i.test(filename) ? "application/json" : "text/csv;charset=utf-8";
        var blob = new Blob([(opts && opts.data) || ""], {type: type});
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 5000);
        return Promise.resolve();
      } catch (e) {
        return Promise.reject({code: String((e && e.message) || e)});
      }
    },
  };

  /* ---------- вход и роль ---------- */

  var currentUser = null;
  var listeners = [];

  function notify() {
    listeners.forEach(function (fn) {
      try {
        fn(currentUser);
      } catch (e) {
        console.error("[adapter] обработчик входа упал:", e);
      }
    });
  }

  function loadUser() {
    return request("GET", API + "/auth/me").then(function (me) {
      currentUser = me;
      hideLogin();
      notify();
      return me;
    }).catch(function () {
      currentUser = null;
      showLogin();
      notify();
      return null;
    });
  }

  window.__AUTH__ = {
    onChange: function (fn) {
      listeners.push(fn);
      if (currentUser !== null) fn(currentUser);
      return function () {
        listeners = listeners.filter(function (x) {
          return x !== fn;
        });
      };
    },
    user: function () {
      return currentUser;
    },
    refresh: loadUser,
    signOut: function () {
      return request("POST", API + "/auth/logout").then(function () {
        location.reload();
      });
    },
    getRole: function () {
      if (currentUser && currentUser.role) return Promise.resolve(currentUser.role);
      return loadUser().then(function (me) {
        if (!me) throw new Error("не вошёл");
        return me.role || "viewer";
      });
    },
  };

  /* ---------- экран входа ---------- */

  var loginEl = null;

  function buildLogin() {
    var wrap = document.createElement("div");
    wrap.id = "loginveil";
    wrap.setAttribute("style", [
      "position:fixed", "inset:0", "z-index:200", "background:var(--bg)",
      "display:flex", "align-items:center", "justify-content:center", "padding:20px",
    ].join(";"));
    wrap.innerHTML =
      '<form id="loginform" style="background:var(--surface);border:1px solid var(--line);' +
      "border-radius:14px;box-shadow:var(--shadow);padding:26px 26px 20px;width:min(380px,100%)\">" +
      '<div style="font-family:var(--disp);font-size:16px;margin-bottom:4px">traff<span style="color:var(--accent)">braza</span> база</div>' +
      '<div class="hint" style="margin-bottom:16px">Вход для команды. Доступ выдаёт админ.</div>' +
      '<label style="display:block;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);font-weight:800;margin-bottom:5px">Почта</label>' +
      '<input id="lemail" type="email" autocomplete="username" required style="width:100%;border:1px solid var(--line);border-radius:8px;background:var(--bg);padding:9px 11px;margin-bottom:12px">' +
      '<label style="display:block;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);font-weight:800;margin-bottom:5px">Пароль</label>' +
      '<input id="lpass" type="password" autocomplete="current-password" required style="width:100%;border:1px solid var(--line);border-radius:8px;background:var(--bg);padding:9px 11px;margin-bottom:14px">' +
      '<div id="lerr" style="color:var(--c-red);font-size:12.5px;font-weight:700;min-height:18px;margin-bottom:8px"></div>' +
      '<button class="btn" id="lbtn" type="submit" style="width:100%;padding:10px">Войти</button>' +
      "</form>";
    document.body.appendChild(wrap);

    var form = wrap.querySelector("#loginform");
    var errBox = wrap.querySelector("#lerr");
    var btn = wrap.querySelector("#lbtn");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = wrap.querySelector("#lemail").value.trim();
      var pass = wrap.querySelector("#lpass").value;
      errBox.textContent = "";
      btn.disabled = true;
      btn.textContent = "Захожу…";
      request("POST", API + "/auth/login", {email: email, password: pass})
          .then(function (me) {
            currentUser = me;
            hideLogin();
            notify();
            connect();
          })
          .catch(function (e2) {
            errBox.textContent = e2.status === 401 ? "Неверная почта или пароль" :
              (e2.message || "Не вышло войти");
          })
          .then(function () {
            btn.disabled = false;
            btn.textContent = "Войти";
          });
    });
    return wrap;
  }

  function showLogin() {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", showLogin);
      return;
    }
    if (!loginEl) loginEl = buildLogin();
    loginEl.hidden = false;
    var f = loginEl.querySelector("#lemail");
    if (f) f.focus();
  }

  function hideLogin() {
    if (loginEl) loginEl.hidden = true;
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-signout]");
    if (b) {
      e.preventDefault();
      window.__AUTH__.signOut();
    }
  });

  // с этого всё начинается: кто вошёл — тот и увидит базу
  loadUser();
})();
