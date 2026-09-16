/**
 * live.js — живые обновления через WebSocket.
 *
 * Заменяет onSnapshot из Firestore: браузер подписывается на коллекции, сервер
 * при каждой записи шлёт подписчикам изменившийся документ. Клиент держит у
 * себя кэш коллекции и отдаёт приложению полный список — форму, которую оно ждёт.
 *
 * Про Amvera: их прокси пропускает WebSocket, но таймауты простоя нигде не
 * описаны, поэтому здесь есть ping каждые 30 секунд и обрыв мёртвых соединений.
 * Клиент, если сокет не поднялся, сам переходит на периодический опрос.
 */

"use strict";

const {WebSocketServer} = require("ws");

const PING_MS = 30000;

class Live {
  /**
   * @param {object} opts
   * @param {import("http").Server} opts.server общий http-сервер
   * @param {(req: any) => object|null} opts.authenticate вернуть пользователя по запросу или null
   */
  constructor({server, authenticate}) {
    this.authenticate = authenticate;
    this.wss = new WebSocketServer({server, path: "/api/live"});
    this.wss.on("connection", (socket, req) => this.onConnection(socket, req));
    this.timer = setInterval(() => this.heartbeat(), PING_MS);
    this.timer.unref?.();
  }

  onConnection(socket, req) {
    const user = this.authenticate(req);
    if (!user) {
      // 4001 — своё «не вошёл»: клиент по нему поймёт, что надо на экран входа
      socket.close(4001, "unauthorized");
      return;
    }
    socket.user = user;
    socket.subs = new Set();
    socket.alive = true;

    socket.on("pong", () => {
      socket.alive = true;
    });

    socket.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch (e) {
        return;
      }
      if (Array.isArray(msg.sub)) {
        for (const c of msg.sub) if (typeof c === "string") socket.subs.add(c);
      }
      if (Array.isArray(msg.unsub)) {
        for (const c of msg.unsub) socket.subs.delete(c);
      }
      if (msg.ping) this.send(socket, {t: "pong"});
    });

    socket.on("error", () => {});
    this.send(socket, {t: "hello", user: {email: user.email, role: user.role}});
  }

  heartbeat() {
    for (const socket of this.wss.clients) {
      if (socket.alive === false) {
        socket.terminate();
        continue;
      }
      socket.alive = false;
      try {
        socket.ping();
      } catch (e) { /* закрывается — переживём */ }
    }
  }

  send(socket, payload) {
    if (socket.readyState !== socket.OPEN) return;
    try {
      socket.send(JSON.stringify(payload));
    } catch (e) { /* соединение отвалилось */ }
  }

  /** разослать изменение подписчикам коллекции */
  broadcast(collection, event) {
    for (const socket of this.wss.clients) {
      if (!socket.subs || !socket.subs.has(collection)) continue;
      this.send(socket, event);
    }
  }

  /** сколько сейчас открытых соединений — для /api/health */
  get connections() {
    return this.wss.clients.size;
  }

  close() {
    clearInterval(this.timer);
    for (const socket of this.wss.clients) socket.terminate();
    return new Promise((resolve) => this.wss.close(resolve));
  }
}

module.exports = {Live};
