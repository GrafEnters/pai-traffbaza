/**
 * schema.js — описание таблиц базы (то, что ждёт приложение).
 *
 * Документ таблицы: tables/{tid} = {name, order, deleted, cols:{colId:{name,type,order,opts}}}
 * Строка данных:    tables/{tid}/rows/{rid} = {c:{colId:значение}, o, at, by, uat, uby}
 *
 * Типы колонок приложения: text | longtext | number | checkbox | date | select | link | id | card
 * ВАЖНО: тип `link` — это связь со строкой другой таблицы (значение = массив id строк),
 * а НЕ URL. Ссылки-URL (аватар, ссылка на БМ, сайт ФП) хранятся как text.
 *
 * Колонки, помеченные [авто], заполняет Cloud Function ingest при каждом сборе.
 * Остальные — ручные: авто-синк пишет с merge и их не трогает.
 */

const COL = (name, type, order, opts) => (opts ? {name, type, order, opts} : {name, type, order});
const LINK = (name, table, order) => ({name, type: "link", order, opts: {table}});
const SELECT = (name, order, choices) => ({name, type: "select", order, opts: {choices}});

/* ---------- таблица «Аккаунты» (VIA) ---------- */

const ACC_STATUS = [
  {id: "active", label: "актив", color: "green"},
  {id: "farming", label: "фарм", color: "blue"},
  {id: "checkpoint", label: "чекпоинт", color: "red"},
  {id: "risk", label: "риск", color: "yellow"},
  {id: "ban", label: "бан", color: "gray"},
  {id: "sold", label: "передан", color: "purple"},
  {id: "archive", label: "архив", color: "gray"},
];

const ACC_SRC = [
  // id 'farm' используется экраном аналитики — не переименовывать
  {id: "farm", label: "Фарм", color: "blue"},
  {id: "buy", label: "Куплен", color: "purple"},
  {id: "reg", label: "Саморег", color: "teal"},
];

const ACC_VERT = [
  {id: "nutra", label: "Нутра", color: "green"},
  {id: "gambling", label: "Гемблинг", color: "red"},
  {id: "betting", label: "Беттинг", color: "orange"},
  {id: "dating", label: "Дейтинг", color: "pink"},
  {id: "crypto", label: "Крипта", color: "yellow"},
  {id: "ecom", label: "Товарка", color: "blue"},
  {id: "apps", label: "Приложения", color: "teal"},
  {id: "other", label: "Другое", color: "gray"},
];

const T_ACC = {
  name: "Аккаунты",
  order: 10,
  cols: {
    // главная колонка: по ней подписываются записи в ссылках и поиске
    c_fbname: COL("Имя профиля (FB)", "text", 10),              // [авто]
    c_fbid: COL("FB ID", "id", 20),                             // [авто]
    c_status: SELECT("Статус", 30, ACC_STATUS),
    c_src: SELECT("Источник", 40, ACC_SRC),
    c_warm: COL("Прогрет", "checkbox", 50),
    c_vert: SELECT("Вертикаль", 60, ACC_VERT),
    c_buyer: COL("Байер", "text", 70),
    c_counts: COL("Ассеты (сводка)", "text", 80),               // [авто]
    c_collected: COL("Последний сбор", "date", 90),             // [авто]
    c_friends: COL("Друзей", "number", 100),                    // [авто]
    c_via_first: COL("Имя", "text", 110),                       // [авто]
    c_via_last: COL("Фамилия", "text", 120),                    // [авто]
    c_via_link: COL("Ссылка на профиль", "text", 130),          // [авто]
    c_via_avatar: COL("Аватар (URL)", "text", 140),             // [авто]
    c_adspower: COL("Профиль AdsPower", "text", 150),
    c_proxy: COL("Прокси", "text", 160),
    c_note: COL("Заметка", "longtext", 170),
    // доступы — карточка аккаунта показывает их отдельным блоком
    c_login: COL("Логин", "text", 200),
    c_fbpass: COL("Пароль FB", "text", 210),
    c_2fa: COL("2FA", "text", 220),
    c_mailpass: COL("Пароль почты", "text", 230),
    c_backup: COL("Резервные коды", "longtext", 240),
    c_recovery_site: COL("Сайт восстановления", "text", 250),
    c_recovery_pass: COL("Пароль восстановления", "text", 260),
  },
};

/* ---------- таблица «Лички» (рекламные кабинеты) ---------- */

const T_ADS = {
  name: "Лички",
  order: 20,
  cols: {
    c_name: COL("Название кабинета", "text", 10),               // [авто]
    c_account_id: COL("Номер кабинета", "id", 20),              // [авто]
    c_acc: LINK("Аккаунт (VIA)", "t_acc", 30),                  // [авто]
    c_bm: LINK("Бизнес-менеджер", "t_bm", 40),                  // [авто]
    c_account_status: COL("Статус", "text", 50),                // [авто]
    c_disable_reason: COL("Причина отключения", "text", 60),    // [авто]
    c_currency: COL("Валюта", "text", 70),                      // [авто]
    c_amount_spent: COL("Потрачено, $", "number", 80),          // [авто]
    c_spend_cap: COL("Лимит трат, $", "number", 90),            // [авто]
    c_spend_limit: COL("Лимит кабинета, $", "number", 100),     // [авто] adtrust_dsl
    c_balance: COL("Задолженность, $", "number", 110),          // [авто]
    c_created_time: COL("Дата создания", "date", 120),          // [авто]
    c_age: COL("Возраст, дней", "number", 130),                 // [авто]
    c_timezone_name: COL("Часовой пояс", "text", 140),          // [авто]
    c_is_prepay: COL("Предоплатный", "checkbox", 150),          // [авто]
    c_is_client: COL("Клиентский (не свой)", "checkbox", 160),  // [авто]
    c_funding_details: COL("Способ оплаты", "longtext", 170),   // [авто]
    c_user_tasks: COL("Мои права", "longtext", 180),            // [авто]
    c_min_daily_budget: COL("Мин. дневной бюджет, $", "number", 190),      // [авто]
    c_min_camp_spend_cap: COL("Мин. лимит кампании, $", "number", 200),    // [авто]
    c_is_personal: COL("Личный (не бизнес)", "checkbox", 210),  // [авто]
    c_biz_name: COL("Юр. название бизнеса", "text", 220),       // [авто]
    c_biz_country: COL("Страна бизнеса", "text", 230),          // [авто]
    c_biz_city: COL("Город бизнеса", "text", 240),              // [авто]
    c_act_id: COL("ID кабинета (act_)", "id", 250),             // [авто]
    c_note: COL("Заметка", "longtext", 300),
  },
};

/* ---------- таблица «БМы» ---------- */

const T_BM = {
  name: "БМы",
  order: 30,
  cols: {
    c_bm_name: COL("Название БМ", "text", 10),                  // [авто]
    c_bm_id: COL("ID БМ", "id", 20),                            // [авто]
    c_acc: LINK("Аккаунт (VIA)", "t_acc", 30),                  // [авто]
    c_verif_status: COL("Верификация", "text", 40),             // [авто]
    c_two_factor: COL("Требование 2FA", "text", 50),            // [авто]
    c_created_time: COL("Дата создания", "date", 60),           // [авто]
    c_updated_time: COL("Последнее изменение", "date", 70),     // [авто]
    c_primary_page: COL("Основная страница", "text", 80),       // [авто]
    c_is_hidden: COL("Скрыт", "checkbox", 90),                  // [авто]
    c_link: COL("Ссылка на БМ", "text", 100),                   // [авто]
    c_profile_pic: COL("Аватар (URL)", "text", 110),            // [авто]
    c_owned_adaccounts: COL("Свои кабинеты", "longtext", 120),   // [авто]
    c_owned_pages: COL("Свои страницы", "longtext", 130),        // [авто]
    c_owned_pixels: COL("Пиксели БМ", "longtext", 140),          // [авто]
    c_business_users: COL("Люди в БМ", "longtext", 150),         // [авто]
    c_owned_businesses: COL("Дочерние БМ", "longtext", 160),     // [авто]
    c_note: COL("Заметка", "longtext", 200),
  },
};

/* ---------- таблица «ФП» (страницы) ---------- */

const T_FP = {
  name: "ФП",
  order: 40,
  cols: {
    c_name: COL("Название страницы", "text", 10),               // [авто]
    c_page_id: COL("ID страницы", "id", 20),                    // [авто]
    c_acc: LINK("Аккаунт (VIA)", "t_acc", 30),                  // [авто]
    c_bm: LINK("Бизнес-менеджер", "t_bm", 40),                  // [авто]
    c_username: COL("Юзернейм (@)", "text", 50),                // [авто]
    c_link: COL("Ссылка", "text", 60),                          // [авто]
    c_category: COL("Категория", "text", 70),                   // [авто]
    c_category_list: COL("Подкатегории", "text", 80),           // [авто]
    c_tasks: COL("Права на странице", "text", 90),              // [авто]
    c_is_published: COL("Опубликована", "checkbox", 100),       // [авто]
    c_verification_status: COL("Верификация", "text", 110),     // [авто]
    c_fan_count: COL("Лайки", "number", 120),                   // [авто]
    c_followers_count: COL("Подписчики", "number", 130),        // [авто]
    c_talking_about_count: COL("Обсуждают", "number", 140),     // [авто]
    c_created_time: COL("Дата создания", "date", 150),          // [авто]
    c_picture: COL("Аватар (URL)", "text", 160),                // [авто]
    c_cover: COL("Обложка (URL)", "text", 170),                 // [авто]
    c_engagement: COL("Вовлечённость", "text", 180),            // [авто]
    c_instagram: COL("Instagram", "text", 190),                 // [авто]
    c_about: COL("Описание (кратко)", "longtext", 200),         // [авто]
    c_description: COL("Описание (полное)", "longtext", 210),   // [авто]
    c_website: COL("Сайт", "text", 220),                        // [авто]
    c_phone: COL("Телефон", "text", 230),                       // [авто]
    c_location: COL("Локация", "text", 240),                    // [авто]
    c_single_line_address: COL("Адрес", "text", 250),           // [авто]
    c_note: COL("Заметка", "longtext", 300),
  },
};

/* ---------- таблица «Пиксели» ---------- */

const T_PIXEL = {
  name: "Пиксели",
  order: 50,
  cols: {
    c_name: COL("Название", "text", 10),                        // [авто]
    c_pixel_id: COL("ID пикселя", "id", 20),                    // [авто]
    c_acc: LINK("Аккаунт (VIA)", "t_acc", 30),                  // [авто]
    c_bm: LINK("Бизнес-владелец", "t_bm", 40),                  // [авто]
    c_is_unavailable: COL("Недоступен", "checkbox", 50),        // [авто]
    c_last_fired_time: COL("Последнее срабатывание", "date", 60),   // [авто]
    c_creation_time: COL("Дата создания", "date", 70),          // [авто]
    c_data_use_setting: COL("Использование данных", "text", 80),     // [авто]
    c_enable_automatic_matching: COL("Автосопоставление", "checkbox", 90),   // [авто]
    c_first_party_cookie_status: COL("First-party cookie", "text", 100),     // [авто]
    c_is_created_by_business: COL("Создан бизнесом", "checkbox", 110),       // [авто]
    c_has_1p_pixel_event: COL("Есть 1p-события", "checkbox", 120),  // [авто]
    c_is_crm: COL("CRM / лидоген", "checkbox", 130),            // [авто]
    c_description: COL("Описание", "longtext", 140),            // [авто]
    c_code: COL("Код пикселя", "longtext", 150),                // [авто]
    c_note: COL("Заметка", "longtext", 200),
  },
};

/* ---------- ручные таблицы (расширение не пишет) ---------- */

const T_CARD = {
  name: "Карты",
  order: 60,
  cols: {
    c_name: COL("Название", "text", 10),
    c_acc: LINK("Аккаунт (VIA)", "t_acc", 20),
    c_card: COL("Карта", "card", 30),
    c_bank: COL("Банк / сервис", "text", 40),
    c_status: SELECT("Статус", 50, [
      {id: "active", label: "активна", color: "green"},
      {id: "declined", label: "деклайн", color: "red"},
      {id: "empty", label: "пустая", color: "yellow"},
      {id: "closed", label: "закрыта", color: "gray"},
    ]),
    c_note: COL("Заметка", "longtext", 60),
  },
};

const T_SOC = {
  name: "Соцсети",
  order: 70,
  cols: {
    c_name: COL("Название", "text", 10),
    c_acc: LINK("Аккаунт (VIA)", "t_acc", 20),
    c_kind: SELECT("Площадка", 30, [
      {id: "ig", label: "Instagram", color: "pink"},
      {id: "tg", label: "Telegram", color: "blue"},
      {id: "wa", label: "WhatsApp", color: "green"},
      {id: "other", label: "Другое", color: "gray"},
    ]),
    c_url: COL("Ссылка", "text", 40),
    c_login: COL("Логин", "text", 50),
    c_pass: COL("Пароль", "text", 60),
    c_note: COL("Заметка", "longtext", 70),
  },
};

const T_LOG = {
  name: "Раздача ФП",
  order: 80,
  cols: {
    c_name: COL("Что передано", "text", 10),
    // экран аналитики строит график по месяцам именно из c_date
    c_date: COL("Дата передачи", "date", 20),
    c_acc: LINK("Аккаунт (VIA)", "t_acc", 30),
    c_buyer: COL("Кому (байер)", "text", 40),
    c_note: COL("Заметка", "longtext", 50),
  },
};

const TABLES = {
  t_acc: T_ACC,
  t_ads: T_ADS,
  t_bm: T_BM,
  t_fp: T_FP,
  t_pixel: T_PIXEL,
  t_card: T_CARD,
  t_soc: T_SOC,
  t_log: T_LOG,
};

/** виды по умолчанию: один «Все записи» на таблицу + пара полезных */
const VIEWS = {
  v_acc_all: {table: "t_acc", name: "Все аккаунты", order: 0, filters: [], sort: null, hidden: [], colorBy: "c_status"},
  v_acc_farm: {
    table: "t_acc", name: "В фарме", order: 10,
    filters: [{col: "c_src", op: "is", val: "farm"}],
    sort: {col: "c_collected", dir: "desc"}, hidden: [], colorBy: "c_status",
  },
  v_ads_all: {table: "t_ads", name: "Все кабинеты", order: 0, filters: [], sort: {col: "c_amount_spent", dir: "desc"}, hidden: [], colorBy: null},
  v_ads_live: {
    table: "t_ads", name: "Активные", order: 10,
    filters: [{col: "c_account_status", op: "is", val: "активна"}],
    sort: {col: "c_amount_spent", dir: "desc"}, hidden: [], colorBy: null,
  },
  v_bm_all: {table: "t_bm", name: "Все БМы", order: 0, filters: [], sort: null, hidden: [], colorBy: null},
  v_fp_all: {table: "t_fp", name: "Все страницы", order: 0, filters: [], sort: {col: "c_fan_count", dir: "desc"}, hidden: [], colorBy: null},
  v_pixel_all: {table: "t_pixel", name: "Все пиксели", order: 0, filters: [], sort: null, hidden: [], colorBy: null},
  v_card_all: {table: "t_card", name: "Все карты", order: 0, filters: [], sort: null, hidden: [], colorBy: "c_status"},
  v_soc_all: {table: "t_soc", name: "Все соцсети", order: 0, filters: [], sort: null, hidden: [], colorBy: null},
  v_log_all: {table: "t_log", name: "Вся раздача", order: 0, filters: [], sort: {col: "c_date", dir: "desc"}, hidden: [], colorBy: null},
};

module.exports = {TABLES, VIEWS};
