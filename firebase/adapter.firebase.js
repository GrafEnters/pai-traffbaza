/**
 * adapter.firebase.js — слой хранилища для варианта на Firebase.
 *
 * Это запасной вариант: рабочая версия проекта живёт на своём сервере
 * (см. server/ и public/adapter.js). Файл сохранён целиком, чтобы при
 * необходимости можно было вернуться на Firebase, ничего не переписывая.
 * Как его подключить — в firebase/README.md.
 *
 * Приложение писалось под интерфейс claude.use('db') — коллекции, документы,
 * onSnapshot, get/set/update/delete. Здесь этот интерфейс собирается поверх
 * Firestore (compat SDK), а сверху добавляется вход по email/паролю и роль.
 *
 * Что важно в этом переносе:
 *   * .update() приложения — это ГЛУБОКИЙ merge: оно шлёт {c:{colId:val}} ожидая,
 *     что остальные ячейки останутся, и {cols:{colId:{order:5}}} ожидая, что у
 *     колонки сохранятся name/type. Обычный updateDoc с точечным путём второй
 *     случай ломает, поэтому .update() реализован как set(..., {merge:true}).
 *   * null в .update() означает «убрать поле» (снять пометку удаления, очистить
 *     ячейку, удалить колонку) — превращаем в FieldValue.delete().
 *   * Массивы при merge заменяются целиком — ровно это и нужно фильтрам,
 *     скрытым колонкам и колонкам-связям.
 *
 * Глобалы наружу: window.__DB__, window.__AUTH__, window.__downloads__.
 */

(function () {
  "use strict";

  var cfg = window.__FIREBASE_CONFIG__ || {};
  var configured = cfg.apiKey && String(cfg.apiKey).indexOf("ЗАМЕНИ") !== 0;

  if (!configured) {
    window.__CONFIG_MISSING__ = true;
    document.addEventListener("DOMContentLoaded", function () {
      var m = document.getElementById("main");
      if (m) {
        m.innerHTML = '<div class="empty">Не заполнен <b>firebase-config.js</b>.' +
          "<br>Вставь туда firebaseConfig из консоли Firebase и обнови страницу.</div>";
      }
    });
    return;
  }

  firebase.initializeApp(cfg);
  var fs = firebase.firestore();
  var auth = firebase.auth();
  var DELETE = firebase.firestore.FieldValue.delete();

  // Локальная разработка: если в конфиге есть блок emulator, работаем против
  // эмуляторов Firebase, а не против боевого проекта. В проде его просто нет.
  if (cfg.emulator) {
    if (cfg.emulator.firestore) {
      var hp = String(cfg.emulator.firestore).split(":");
      fs.useEmulator(hp[0], Number(hp[1]));
    }
    if (cfg.emulator.auth) {
      auth.useEmulator(cfg.emulator.auth, {disableWarnings: true});
    }
    console.info("[adapter] режим эмулятора:", cfg.emulator);
  }

  /* ---------- хранилище ---------- */

  // null -> удалить поле; объекты обходим вглубь; массивы оставляем как есть
  function conv(v) {
    if (v === null) return DELETE;
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      var out = {};
      for (var k in v) {
        if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = conv(v[k]);
      }
      return out;
    }
    return v;
  }

  function snapDoc(d) {
    return {
      id: d.id,
      exists: d.exists,
      data: function () {
        return d.data();
      },
    };
  }

  function wrapDoc(ref) {
    return {
      get: function () {
        return ref.get().then(function (s) {
          return {exists: s.exists, data: function () {
            return s.data();
          }};
        });
      },
      set: function (data, opts) {
        return opts ? ref.set(data, opts) : ref.set(data);
      },
      update: function (data) {
        return ref.set(conv(data), {merge: true});
      },
      delete: function () {
        return ref.delete();
      },
    };
  }

  function wrapCol(ref) {
    return {
      onSnapshot: function (cb, err) {
        return ref.onSnapshot(function (s) {
          cb({docs: s.docs.map(snapDoc)});
        }, err);
      },
      add: function (data) {
        return ref.add(data).then(function (r) {
          return {id: r.id};
        });
      },
      get: function () {
        return ref.get().then(function (s) {
          return {docs: s.docs.map(snapDoc)};
        });
      },
    };
  }

  window.__DB__ = {
    collection: function (path) {
      return wrapCol(fs.collection(path));
    },
    doc: function (path) {
      return wrapDoc(fs.doc(path));
    },
  };

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

  window.__AUTH__ = {
    onChange: function (fn) {
      return auth.onAuthStateChanged(fn);
    },
    user: function () {
      return auth.currentUser;
    },
    signOut: function () {
      return auth.signOut();
    },
    // роль: сначала custom claim (его же читают правила), потом users/{uid}
    getRole: function () {
      var u = auth.currentUser;
      if (!u) return Promise.reject(new Error("не вошёл"));
      return u.getIdTokenResult(true).then(function (tok) {
        var claim = tok && tok.claims && tok.claims.role;
        if (claim === "admin" || claim === "manager" || claim === "viewer") return claim;
        return fs.doc("users/" + u.uid).get().then(function (s) {
          var r = s.exists ? (s.data() || {}).role : null;
          return (r === "admin" || r === "manager" || r === "viewer") ? r : "viewer";
        }).catch(function () {
          return "viewer";
        });
      });
    },
  };

  /* ---------- экран входа ---------- */

  var loginEl = null;

  var AUTH_ERRORS = {
    "auth/invalid-email": "Похоже, в адресе опечатка",
    "auth/user-not-found": "Такого пользователя нет — попроси админа завести",
    "auth/wrong-password": "Неверный пароль",
    "auth/invalid-credential": "Неверная почта или пароль",
    "auth/too-many-requests": "Слишком много попыток — подожди минуту",
    "auth/network-request-failed": "Нет связи с Firebase",
    "auth/user-disabled": "Доступ отключён администратором",
  };

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
    var err = wrap.querySelector("#lerr");
    var btn = wrap.querySelector("#lbtn");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = wrap.querySelector("#lemail").value.trim();
      var pass = wrap.querySelector("#lpass").value;
      err.textContent = "";
      btn.disabled = true;
      btn.textContent = "Захожу…";
      auth.signInWithEmailAndPassword(email, pass).catch(function (e2) {
        err.textContent = AUTH_ERRORS[e2 && e2.code] || ("Не вышло: " + ((e2 && e2.code) || ""));
      }).then(function () {
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

  auth.onAuthStateChanged(function (u) {
    if (u) hideLogin(); else showLogin();
  });

  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-signout]");
    if (b) {
      e.preventDefault();
      window.__AUTH__.signOut().then(function () {
        location.reload();
      });
    }
  });
})();
