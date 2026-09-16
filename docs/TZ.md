# Техническое задание (архив)

> Исходный документ заказчика, версия 2026-09-14. Оставлен как есть — по нему
> сверялись при разработке.
>
> **Описывает прежнюю архитектуру на Firebase.** Проект с тех пор переехал на
> собственный сервер: см. [архитектуру](ARCHITECTURE.md) и раздел «История» в
> [решениях](DECISIONS.md). Расхождения между этим текстом и реализацией
> разобраны там же.
>
> Извлечён из артефакта:
> https://claude.ai/code/artifact/e2b42702-dc81-4772-881d-de70d04f356e

---

Realtime Inventory Sync

 Техническое задание

# Реалтайм-база FB-инвентаря

 Расширение в каждом профиле AdsPower при открытии Ads Manager само подтягивает все FB-ассеты (БМ / кабинеты / страницы / пиксели со всеми полями) в общую базу и постоянно их обновляет. База — веб-приложение на Firebase.

 ✓ Сбор данных — рабочий код-каркас в комплекте
 ✓ UI-приложение — предоставляется (нужен порт)
 ◐ Firebase, деплой и сборка — задача исполнителя
 ◐ Расширение — каркас готов, собрать

 Стек: Firebase (Firestore + Hosting + Functions) + Chrome MV3-расширение. К ТЗ прилагается рабочий код-каркас сбора и текущее приложение (см. §13). Версия ТЗ: 2026-09-14.

 1Задача
 2Архитектура
 3Что предоставляется готовым
 4Firebase: что включить
 5Модель данных (Firestore)
 6Расширение (MV3)
 7Cloud Function приёма
 8Ключ аккаунта
 9Порт приложения на Firestore
 10Доступы и безопасность
 11Деплой по шагам
 12Каналы обновления и доступы
 13Входные материалы

## 01Задача

 Собрать связку из трёх компонентов: браузерное расширение (Chrome MV3), онлайн-база данных + бэкенд (Firebase) и веб-приложение (таблица/карточки, предоставляется готовым — нужен порт на Firebase).

 Расширение при открытии рекламного аккаунта Facebook (Ads Manager) в профиле AdsPower должно автоматически считывать все связанные объекты аккаунта — бизнес-менеджеры, рекламные кабинеты, страницы, пиксели со всеми полями (статусы, лимиты, траты, даты и т.д.) — и отправлять их в базу, обновляя записи в реальном времени. Расширение ставится по умолчанию во все профили AdsPower; аккаунт обновляется в момент открытия.

## 02Архитектура

flowchart LR
 A["AdsPower профиль
+ расширение"] -->|"открыт Ads Manager"| B["content script:
снять EAAB-токен
+ Graph API v24"]
 B -->|"POST инвентарь"| C["Cloud Function
(проверяет секрет)"]
 C -->|"upsert по FB-id"| D[("Firestore:
аккаунты + ассеты")]
 D -->|"live onSnapshot"| E["Веб-приложение
(таблица / карточки)"]

- Расширение (в профиле AdsPower) — снимает токен и данные, шлёт на бэкенд.

- Cloud Function — единственная точка записи. Проверяет общий секрет, кладёт данные в Firestore. Так ключи Firestore не светятся в расширении и клиент не может писать что попало.

- Firestore — база (аккаунты + ассеты). Пишет только функция, читает приложение.

- Веб-приложение — готовый UI (таблица/карточки/дашборд аккаунта), предоставляется; читает Firestore вживую.

## 03Что предоставляется готовым — не писать заново

- Механизм сбора (Graph API v24, снятие EAAB-токена, обход рёбер БМ, авто-отбрасывание несуществующих полей) — предоставляется рабочим код-каркасом. Готовые строки полей — в §5.

- Полный список полей по каждой сущности (кабинет / БМ / страница / пиксель / аккаунт) — ~90 полей. В §5 и в коде сборщика.

- UI-приложение (таблица + виды + карточка-дашборд аккаунта + плоские колонки + роли admin/manager/viewer + лог + аналитика) — предоставляется. Написано в стиле Firestore (коллекции/документы/onSnapshot), поэтому переезд = замена «слоя хранилища» (§9), а не переписывание.

## 04Firebase: что включить

- Создать проект Firebase.

- Firestore Database (native mode) — хранилище.

- Authentication — Email/Password (для команды: админ/менеджер/просмотр). Роль через custom claims или коллекцию users.

- Cloud Functions (или 2nd-gen / Cloud Run) — приёмник от расширения.

- Hosting — выложить веб-приложение (статический index.html).

 Бесплатного тарифа (Spark/Blaze с лимитами) на старте хватает: объёмы маленькие (тысячи аккаунтов × десятки полей).

## 05Модель данных (Firestore)

 Структура ровно как в текущем приложении (оно её и ждёт):

 Коллекция | Документ | Смысл | 

 tables/{tid} | описание таблицы: name, order, cols{colId:{name,type,opts,order}}, deleted | Аккаунты, БМы, Лички(кабинеты), ФП, Пиксели… | 

 tables/{tid}/rows/{rid} | строка: { c:{colId:val}, o, at, by, uat, uby } | сами данные (1 документ = 1 запись) | 

 views/{vid} | {table, name, order, filters, sort, hidden, colorBy} | виды/фильтры таблиц | 

 log/{key} | {items:[…]} | лог действий (опц.) | 

 Детерминированные id — ключ к «обновлению без дублей». Документы ассетов адресуем по FB-id, а не автогенерацией. Тогда повторный сбор того же аккаунта перезаписывает, а не плодит копии:

- аккаунт: tables/t_acc/rows/fb_<fbUserId>

- кабинет: tables/t_ads/rows/aa_<accountId>

- БМ: tables/t_bm/rows/bm_<bmId>, страница: fp_<pageId>, пиксель: px_<pixelId>

- связь с аккаунтом — поле c.c_acc = ["fb_<fbUserId>"] (тип link на таблицу Аккаунты).

### Поля, которые тянет сбор (готовые строки Graph API v24)

 Точные наборы полей (лишнее авто-отбрасывается на лету):

 поля Graph API по сущностям

me (аккаунт/VIA):
 id,name,first_name,last_name,picture{url,width,height},link,friends.summary(true)

ad account (кабинет / личка):
 id,account_id,name,business{id,name},account_status,disable_reason,currency,
 amount_spent,spend_cap,balance,adtrust_dsl,created_time,age,timezone_name,
 is_prepay_account,funding_source_details{id,display_string,type},user_tasks,
 min_daily_budget,min_campaign_group_spend_cap,is_personal,business_name,
 business_country_code,business_city,business_state,business_zip,business_street,
 business_street2,opportunity_score
 // ВАЖНО: суммы (amount_spent/spend_cap/balance/min_*) — в ЦЕНТАХ (÷100).
 // adtrust_dsl (спенд-лимит аккаунта) — уже в ДОЛЛАРАХ.
 // account_status/disable_reason — числовые коды (мэппинг в коде).

business (БМ):
 id,name,verification_status,two_factor_type,created_time,updated_time,
 primary_page{id,name},is_hidden,link,profile_picture_uri
 + рёбра: /{id}/owned_ad_accounts, /client_ad_accounts, /owned_pages,
 /client_pages, /adspixels, /owned_data_sources, /client_data_sources,
 /owned_businesses, /business_users

page (ФП):
 id,name,username,link,category,category_list{id,name},tasks,is_published,
 verification_status,fan_count,followers_count,talking_about_count,created_time,
 picture{url,width,height},cover{source,id},engagement{count,social_sentence},
 business{id,name},about,description,general_info,website,phone,
 location{city,country,street,zip,latitude,longitude},single_line_address,
 connected_instagram_account{id,username},instagram_business_account{id,username}

pixel (Пиксель / dataset):
 id,name,last_fired_time,creation_time,is_unavailable,owner_business{id,name},
 owner_ad_account{id,name},data_use_setting,enable_automatic_matching,
 automatic_matching_fields,first_party_cookie_status,is_created_by_business,
 has_1p_pixel_event,is_crm,code,description,usage,event_stats,event_time_min,
 event_time_max,valid_entries,matched_entries,duplicate_entries,match_rate_approx

 Русские названия колонок + типы для каждого поля приложены отдельным планом (JSON — см. §13).

## 06Расширение (MV3)

 Content-script на страницах Ads Manager / Business Suite. Снимает токен из HTML (логика — в приложенном код-каркасе), бьёт Graph API с host_permissions, шлёт результат на Cloud Function. Firestore-ключи в расширении не хранятся.

 manifest.json

{
 "manifest_version": 3,
 "name": "Ad Inventory Sync",
 "version": "1.0.0",
 "description": "Автосбор FB-инвентаря в базу при открытии Ads Manager",
 "permissions": ["storage"],
 "host_permissions": [
 "https://*.facebook.com/*",
 "https://graph.facebook.com/*",
 "https://<ПРОЕКТ>.cloudfunctions.net/*"
 ],
 "content_scripts": [
 {
 "matches": [
 "https://*.facebook.com/adsmanager/*",
 "https://business.facebook.com/*"
 ],
 "js": ["collect.js"],
 "run_at": "document_idle"
 }
 ]
}

 collect.js — логика сбора (порт рабочего сборщика) + отправка

// Один прогон на загрузку вкладки; не чаще раза в час на аккаунт.
const ENDPOINT = "https://<ПРОЕКТ>.cloudfunctions.net/ingest";
const SHARED_SECRET = "<ОБЩИЙ-СЕКРЕТ>"; // проверяется функцией
const G = "https://graph.facebook.com/v24.0/";

const splitTop = s => { const o=[]; let d=0,c=""; for (const ch of s){
 if(ch==="{")d++; else if(ch==="}")d--; if(ch===","&&d===0){o.push(c);c="";} else c+=ch; }
 if(c)o.push(c); return o; };
const stripField = (f,bad) => splitTop(f).filter(p=>p.split("{")[0].trim()!==bad).join(",");

async function g(path, params){
 try{ const r=await fetch(G+path+"?"+params,{credentials:"include"}); return await r.json(); }
 catch(e){ return {error:{message:String(e)}}; }
}
// GET с авто-отбрасыванием несуществующих в v24 полей (одно «плохое» поле не рушит запрос)
async function gf(tok, path, fields, extra){
 let f=fields;
 for(let i=0;i<20;i++){
 const j=await g(path, "access_token="+tok+"&fields="+encodeURIComponent(f)+(extra?("&"+extra):""));
 const m=(j&&j.error&&j.error.message||"").match(/nonexisting field \(([^)]+)\)/);
 if(m){ const nf=stripField(f,m[1]); if(nf===f||!nf) return j; f=nf; continue; }
 return j;
 }
 return {data:[]};
}
async function paged(tok, path, fields){
 let out=[],guard=0,j=await gf(tok,path,fields,"limit=100");
 while(j&&j.data){ out=out.concat(j.data); if(!j.paging||!j.paging.next||++guard>25) break;
 try{ j=await (await fetch(j.paging.next,{credentials:"include"})).json(); }catch(e){ break; } }
 return out;
}
function grabToken(){
 const set=new Set(); const re=/EAA[A-Za-z0-9]{30,}/g; let m;
 while((m=re.exec(document.documentElement.innerHTML))) set.add(m[0]);
 const rank=t=>t.startsWith("EAAB")?3:t.startsWith("EAAG")?2:t.startsWith("EAAI")?1:0;
 return [...set].sort((a,b)=>(rank(b)-rank(a))||(b.length-a.length))[0]||"";
}

const AA="id,account_id,name,business{id,name},account_status,disable_reason,currency,amount_spent,spend_cap,balance,adtrust_dsl,created_time,age,timezone_name,is_prepay_account,funding_source_details{id,display_string,type},user_tasks,min_daily_budget,min_campaign_group_spend_cap,is_personal,business_name,business_country_code,business_city,business_state,business_zip,business_street,business_street2,opportunity_score";
const BM="id,name,verification_status,two_factor_type,created_time,updated_time,primary_page{id,name},is_hidden,link,profile_picture_uri";
const PG="id,name,username,link,category,category_list{id,name},tasks,is_published,verification_status,fan_count,followers_count,talking_about_count,created_time,picture{url,width,height},cover{source,id},engagement{count,social_sentence},business{id,name},about,description,general_info,website,phone,location{city,country,street,zip,latitude,longitude},single_line_address,connected_instagram_account{id,username},instagram_business_account{id,username}";
const PX="id,name,last_fired_time,creation_time,is_unavailable,owner_business{id,name},owner_ad_account{id,name},data_use_setting,enable_automatic_matching,automatic_matching_fields,first_party_cookie_status,is_created_by_business,has_1p_pixel_event,is_crm,code,description,usage,event_stats,event_time_min,event_time_max,valid_entries,matched_entries,duplicate_entries,match_rate_approx";

async function collect(){
 const tok=grabToken(); if(!tok) return null;
 const me=await gf(tok,"me","id,name,first_name,last_name,picture{url,width,height},link,friends.summary(true)");
 if(me.error) return null;
 const out={user:me, friends:(me.friends&&me.friends.summary||{}).total_count??null,
 businesses:[], ad_accounts:[], pages:[], pixels:[]};
 const seenA=new Set(),seenP=new Set(),seenX=new Set();
 const pushA=(a,bm,cl)=>{const id=String(a.account_id||a.id||""); if(id&&!seenA.has(id)){seenA.add(id);
 out.ad_accounts.push(Object.assign({},a,{id,bm:bm||"",client:!!cl}));}};
 const pushP=(p,bm)=>{if(p&&p.id&&!seenP.has(p.id)){seenP.add(p.id); out.pages.push(Object.assign({},p,{bm:bm||""}));}};
 const pushX=(x,bm)=>{if(x&&x.id&&!seenX.has(x.id)){seenX.add(x.id); out.pixels.push(Object.assign({},x,{bm:bm||""}));}};
 for(const bm of await paged(tok,"me/businesses",BM)){
 out.businesses.push(bm);
 for(const a of await paged(tok,bm.id+"/owned_ad_accounts",AA)) pushA(a,bm.id,false);
 for(const a of await paged(tok,bm.id+"/client_ad_accounts",AA)) pushA(a,bm.id,true);
 for(const p of await paged(tok,bm.id+"/owned_pages",PG)) pushP(p,bm.id);
 for(const p of await paged(tok,bm.id+"/client_pages",PG)) pushP(p,bm.id);
 for(const e of ["adspixels","owned_data_sources","client_data_sources"])
 for(const x of await paged(tok,bm.id+"/"+e,PX)) pushX(x,bm.id);
 bm.child_businesses=await paged(tok,bm.id+"/owned_businesses","id,name,verification_status");
 bm.users=await paged(tok,bm.id+"/business_users","id,name,email,role");
 }
 for(const a of await paged(tok,"me/adaccounts",AA)) pushA(a,"",false);
 for(const p of await paged(tok,"me/accounts",PG)) pushP(p,"");
 return out;
}

// не долбить чаще раза в час на один FB-аккаунт
async function throttled(fbid){
 const k="lastsync_"+fbid, now=Date.now();
 const st=await chrome.storage.local.get(k);
 if(st[k]&&now-st[k]<3600e3) return false;
 await chrome.storage.local.set({[k]:now}); return true;
}

(async ()=>{
 try{
 const inv=await collect(); if(!inv||!inv.user) return;
 if(!await throttled(inv.user.id)) return;
 await fetch(ENDPOINT,{method:"POST",headers:{"Content-Type":"application/json"},
 body:JSON.stringify({secret:SHARED_SECRET, inv})});
 }catch(e){ /* тихо: сбор best-effort */ }
})();

 Проверить на реальном профиле

 Content-script читает токен из HTML и бьёт graph.facebook.com. В большинстве профилей это работает из isolated world (есть host_permissions). Если в каком-то раскладе токен не виден из isolated world — переключить content-script в "world":"MAIN" (MV3 это умеет) или инжектить <script>. Первый прогон разобрать по факту.

## 07Cloud Function приёма (upsert без дублей)

 Единственная точка записи в Firestore. Проверяет секрет, раскладывает инвентарь по документам с детерминированными id (§5), конвертирует центы/коды в человеческий вид. Полная логика раскладки/мэппинга приложена (Python-референс + JS — см. §13), тут скелет:

 functions/index.js — скелет

const {onRequest} = require("firebase-functions/v2/https");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
initializeApp();
const db = getFirestore();
const SECRET = process.env.SYNC_SECRET;

const NOW = () => new Date().toISOString();
const money = v => { const n=Number(v); return Number.isFinite(n)?(n/100).toFixed(2):""; };
const STATUS = {1:"активна",2:"отключена",3:"не оплачен",7:"на проверке риска",8:"ожидает оплаты",9:"грейс-период",100:"ожидает закрытия",101:"закрыта"};

exports.ingest = onRequest(async (req, res) => {
 if (req.method !== "POST" || (req.body||{}).secret !== SECRET) return res.status(403).end();
 const inv = req.body.inv; const u = inv.user; if (!u || !u.id) return res.status(400).end();
 const acc = "fb_" + u.id;
 const batch = db.batch();

 // аккаунт (мержим, чтобы не затирать созданные вручную поля/креды)
 batch.set(db.doc(`tables/t_acc/rows/${acc}`), {
 c: { c_fbid:String(u.id), c_fbname:u.name||"", c_via_first:u.first_name||"",
 c_via_last:u.last_name||"", c_via_link:u.link||"",
 c_via_avatar:((u.picture||{}).data||{}).url||"", c_friends:inv.friends??null,
 c_counts:`БМ ${inv.businesses.length} · РК ${inv.ad_accounts.length} · ФП ${inv.pages.length} · PX ${inv.pixels.length}`,
 c_collected: NOW().slice(0,10) },
 uat: NOW(), uby: "авто-синк"
 }, {merge:true});

 // кабинеты (пример поля лимита adtrust_dsl -> «Лимит РК»)
 for (const a of inv.ad_accounts) {
 batch.set(db.doc(`tables/t_ads/rows/aa_${a.account_id||a.id}`), {
 c: { c_account_id:String(a.account_id||a.id), c_name:a.name||"",
 c_account_status: STATUS[a.account_status]||"", c_currency:a.currency||"",
 c_amount_spent: money(a.amount_spent), c_balance: money(a.balance),
 c_spend_limit: a.adtrust_dsl!=null?String(Number(a.adtrust_dsl).toFixed(2)):"",
 c_bm:String(a.bm||""), c_acc:[acc] },
 uat: NOW(), uby: "авто-синк"
 }, {merge:true});
 }
 // ... аналогично t_bm / t_fp / t_pixel (полный маппинг приложен, §13)

 await batch.commit();
 res.json({ok:true, counts:{bm:inv.businesses.length, aa:inv.ad_accounts.length, fp:inv.pages.length, px:inv.pixels.length}});
});

 {merge:true} важен: авто-синк не должен затирать поля, которые пользователи заполняют вручную (логины/пароли, заметки и прочие ручные поля).

## 08Ключ аккаунта

 Из Graph API расширение получает FB-id аккаунта — это стабильный ключ. Все документы (аккаунт и его ассеты) адресуются по FB-id (§5), поэтому повторный сбор того же аккаунта перезаписывает записи, а не плодит дубли. Имя профиля AdsPower на странице Facebook недоступно; если оно нужно как подпись — проставляется отдельным сопоставлением по FB-id (не входит в основной контур, код связки приложен — §13).

## 09Порт приложения на Firestore

 Текущий прототип приложения — один index.html, размещённый как Claude Artifact и использующий его встроенное хранилище. Оно берётся так: const db = await claude.use('db') и дальше db.collection(...), db.doc(...), .get/.set/.update/.onSnapshot, .where/.orderBy/.limit. Это тот же интерфейс, что у Firestore. Нужен тонкий адаптер: заменить получение db на Firestore SDK. Остальной код (таблица/виды/карточка/дашборд/роли) не трогаем.

 index.html — заменить блок инициализации хранилища

<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc,
 deleteDoc, onSnapshot, query, where, orderBy, limit }
 from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const app = initializeApp({ /* firebaseConfig из консоли */ });
const fs = getFirestore(app);

// адаптер под интерфейс, который ждёт приложение:
window.__DB__ = {
 collection: (path) => {
 const ref = collection(fs, path);
 return {
 onSnapshot: (cb, err) => onSnapshot(ref, s => cb({docs:
 s.docs.map(d => ({id:d.id, exists:true, data:()=>d.data()}))}), err),
 add: async (data) => { const r = doc(ref); await setDoc(r,data); return {id:r.id}; },
 get: async () => { const s=await getDocs(ref); return {docs:
 s.docs.map(d=>({id:d.id, exists:true, data:()=>d.data()}))}; },
 };
 },
 doc: (path) => { const r = doc(fs, path); return {
 get: async () => { const s=await getDoc(r); return {exists:s.exists(), data:()=>s.data()}; },
 set: (data) => setDoc(r, data, {merge:false}),
 update: (data) => updateDoc(r, data),
 delete: () => deleteDoc(r),
 };},
};
</script>

 Затем в коде приложения: вместо db = await claude.use('db') написать db = window.__DB__. Пара мест потребует внимания:

- update с вложенным c. Приложение зовёт update({c:{[colId]:val}}) и рассчитывает, что мержится ТОЛЬКО одно поле внутри c. В Firestore это затрёт весь c — использовать точечный путь: updateDoc(r, {[`c.${colId}`]: val, uat, uby}). (В адаптере можно распознавать такой вызов и превращать в dot-path.)

- Роли. Сейчас роль определяется чтением спец-документов (adminzone/managerzone). На Firebase — через Firebase Auth (custom claim role) либо коллекцию users/{uid}={role}. Заменить функцию определения роли.

- Скачивание CSV — сейчас через среду текущего прототипа; на вебе заменить на обычный Blob+<a download> (тривиально).

 Полный index.html приложен (§13) — останется вставить адаптер и firebaseConfig.

## 10Доступы и безопасность

 В базе — пароли и 2FA открытым текстом

 В аккаунтах хранятся логины, пароли FB/почты, 2FA, recovery. Это чувствительно. База должна быть закрыта только для команды и только по HTTPS.

- Firestore rules: чтение/запись — только аутентифицированным (команда). Клиентскую запись максимально закрыть: данные пишет только Cloud Function (admin SDK, мимо правил). Приложению дать write на пользовательские правки (по роли), но не «всё подряд».

- Расширение не содержит ключей Firestore — только URL функции и общий секрет; шлёт лишь FB-данные ассетов (не креды).

- Роли: admin (всё + аналитика + переименование), manager (правит данные, лимит удалений, без аналитики), viewer (только чтение) — логика ролей в приложении уже есть, привязать к Firebase Auth.

- Секрет функции — в переменных окружения (SYNC_SECRET), не в репозитории.

 firestore.rules — старт

rules_version = '2';
service cloud.firestore {
 match /databases/{db}/documents {
 function signedIn() { return request.auth != null; }
 function role() { return request.auth.token.role; }
 match /{document=**} {
 allow read: if signedIn(); // команда видит всё
 allow write: if signedIn() && role() in ['admin','manager']; // ручные правки
 // массовый импорт от расширения идёт через Cloud Function (admin SDK), мимо этих правил
 }
 }
}

## 11Деплой по шагам

- Создать Firebase-проект; включить Firestore, Auth (Email/Password), Functions, Hosting.

- Завести пользователей команды в Auth, проставить роли (custom claims admin/manager/viewer).

- firebase init (firestore, functions, hosting). Выложить firestore.rules.

- Вставить в приложение адаптер (§9) + firebaseConfig → firebase deploy --only hosting.

- Задать SYNC_SECRET, задеплоить функцию ingest (§7) → firebase deploy --only functions.

- Собрать расширение (§6): подставить URL функции и секрет. Протестировать на одном профиле, глянуть, что данные долетели в Firestore.

- Добавить расширение в AdsPower как расширение по умолчанию для всех профилей.

## 12Каналы обновления и доступы (настроить один раз)

 Firebase поднимается один раз; дальше деплой инкрементальный. Нужно обеспечить два независимых канала обновления:

### A. Данные и структура таблиц — без деплоя

 Изменения данных и колонок — это записи в Firestore, не в код. Должны быть возможны тремя путями, ни один не требует выкладки:

- пользователями прямо в приложении (по ролям);

- расширением (авто-сбор при открытии аккаунта);

- служебным скриптом (Node/Python) со service-account-ключом Firebase — запись в Firestore напрямую.

### B. Код приложения (index.html) — быстрый деплой

 Изменения кода приложения требуют выкладки. Настроить один из способов быстрого деплоя (без ручной пересборки проекта каждый раз):

- CLI-токен: firebase login:ci → правка index.html и деплой одной командой firebase deploy --only hosting;

- Git-автодеплой: репозиторий + GitHub Action (Firebase Hosting) с секретом service-account → push в main выкладывается автоматически.

 Итог по доступам

 Предоставить: доступ на деплой (CLI-токен или репозиторий с автодеплоем) и service-account-ключ для записи в Firestore из служебных скриптов. После этого обновление данных идёт без деплоя, а обновление кода — одной командой/пушем.

## 13Входные материалы (приложены к ТЗ)

 Вместе с этим ТЗ передаются готовые артефакты:

- полный текущий index.html приложения (UI целиком);

- JSON-план всех колонок: colId → русское имя, тип, из какого Graph-поля, формат (кабинет/БМ/страница/пиксель/аккаунт);

- полный маппинг для Cloud Function (центы→доллары, коды статусов/причин, сводки БМ, даты, пиксель-метрики) — рабочий Python-референс для портирования на JS;

- collect.js расширения (выше — рабочий каркас, доведу под финальный домен функции);

- код связки AdsPower uid ↔ FB-id (опционально — чтобы подписывать аккаунт именем профиля).

 Исполнителю остаётся: поднять Firebase, вставить конфиги/секрет, задеплоить, собрать расширение и раздать его в AdsPower. Архитектура и весь прикладной код — в этом документе и приложениях.

Realtime-синхронизация FB-инвентаря · техническое задание · v1