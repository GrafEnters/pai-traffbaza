# Запасной вариант: то же самое на Firebase

Рабочая версия проекта живёт на своём сервере (см. [`server/`](../server) и
[`amvera.yml`](../amvera.yml)). Эта папка — законченный и проверенный вариант
на Firebase, сделанный раньше. Он никуда не подключён и ничего не ломает,
лежит на случай, если понадобится уйти с Amvera.

Что здесь:

| Файл | Что это |
| --- | --- |
| `functions/` | Cloud Function `ingest` и её тесты раскладки инвентаря |
| `firestore.rules` | правила доступа: чтение команде, запись админу и менеджеру |
| `adapter.firebase.js` | слой хранилища для браузера поверх Firestore |
| `firebase-config.js` | публичный конфиг веб-приложения |
| `seed.js`, `set_role.js` | сид схемы таблиц и выдача ролей через admin SDK |
| `tests/` | сквозные тесты на эмуляторах Firebase |
| `firebase.json`, `.firebaserc` | конфигурация проекта и деплоя |
| `deploy-hosting.yml.example` | автодеплой хостинга из GitHub Actions |

## Чем этот вариант отличается от текущего

Приложение (`public/index.html`) в обоих вариантах **одно и то же**: оно
обращается к хранилищу только через `window.__DB__` и `window.__AUTH__`.
Отличаются два места.

**Первое — какой адаптер подключён.** Сейчас в начале `public/index.html` стоит:

```html
<script src="adapter.js"></script>
```

Для Firebase туда нужно вернуть SDK и этот адаптер:

```html
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js"></script>
<script src="firebase-config.js"></script>
<script src="adapter.js"></script>
```

и положить `adapter.firebase.js` и `firebase-config.js` в `public/` под именами
`adapter.js` и `firebase-config.js`.

**Второе — сообщения о недоступном хранилище** в `boot()`: там упоминается
`adapter.js`, а в варианте на Firebase упоминался `firebase-config.js`. Это
косметика, на работу не влияет.

Всё остальное общее: схема таблиц ([`scripts/schema.js`](../scripts/schema.js)),
логика раскладки инвентаря, расширение. В расширении меняется только адрес
эндпоинта в `config.js`.

## Что было проверено

Оба набора тестов проходили до переезда:

```bash
cd firebase/functions && npm install && npm test   # 56 проверок раскладки
cd firebase/tests && npm install && npm test       # 38 сквозных на эмуляторах
```

Второй набор поднимает эмуляторы Auth и Firestore, грузит `adapter.firebase.js`
и проверяет правила, роли, глубокое слияние и живые обновления.

Зависимости (`node_modules`) удалены, перед запуском нужен `npm install`.

## Почему ушли с Firebase

Не из-за технических проблем: вариант рабочий. Для Cloud Functions требуется
тариф с оплатой по факту и привязанной картой Google, а у бесплатной квоты
Firestore есть суточный предел на чтения — приложение подписано на все строки
всех таблиц, и каждое открытие страницы вычитывает базу целиком. На своём
сервере обоих ограничений нет.
