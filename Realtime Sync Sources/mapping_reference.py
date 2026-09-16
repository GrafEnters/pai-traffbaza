"""mapping_reference.py — РЕФЕРЕНС раскладки инвентаря в документы базы.

Что делает: превращает JSON инвентаря (как его собирает collect.js: объект
{user, friends, businesses[], ad_accounts[], pages[], pixels[]}) в документы
Firestore для таблиц базы: t_acc (аккаунты), t_ads (кабинеты/лички), t_bm (БМы),
t_fp (страницы), t_pixel (пиксели).

Это ССЫЛОЧНАЯ реализация на Python. В боевой системе те же преобразования нужно
повторить в Cloud Function на JS (Node) — логика 1:1.

Ключевые правила (не потерять при портировании):
  * Денежные поля Graph API (amount_spent / spend_cap / balance / min_daily_budget /
    min_campaign_group_spend_cap) приходят в ЦЕНТАХ → делить на 100.
  * adtrust_dsl (то, что SMIT показывает как «Limit») приходит уже в ДОЛЛАРАХ.
  * account_status / disable_reason — числовые КОДЫ, расшифровка ниже.
  * Все id хранить СТРОКОЙ (длинные числа теряют точность).
  * Документы адресуются детерминированными id по FB-id → повторный сбор
    ПЕРЕЗАПИСЫВАЕТ запись, а не плодит дубли.
  * Запись в Firestore делать с merge=True, чтобы авто-синк НЕ затирал поля,
    заполненные пользователями вручную (логины/пароли, заметки и т.п.).
"""

# ---------- справочники кодов ----------
STATUS = {
    "1": "активна", "2": "отключена", "3": "не оплачен", "7": "на проверке риска",
    "8": "ожидает оплаты", "9": "грейс-период", "100": "ожидает закрытия",
    "101": "закрыта", "201": "актив", "202": "закрыт",
}
DISABLE = {
    "": "", "0": "", "1": "нарушение реклполитики", "2": "проверка IP",
    "3": "риск по оплате", "4": "серый аккаунт закрыт", "5": "AFC-ревью",
    "6": "проверка бизнеса", "7": "перманентно закрыт",
    "8": "неиспользуемый (реселлер)", "9": "неиспользуемый",
}


# ---------- форматтеры ----------
def st(s):                       # код статуса кабинета -> человеческий текст
    s = str(s)
    return STATUS.get(s, f"код {s}" if s else "")


def dis(d):                      # код причины отключения -> текст
    d = str(d)
    return DISABLE.get(d, f"код {d}")


def money(v):                    # центы -> доллары строкой ("0.00")
    v = str(v)
    return f"{int(v) / 100:.2f}" if v.lstrip("-").isdigit() else ""


def cap(v):                      # spend_cap: 0 = лимита нет
    v = str(v)
    return "не задан" if v in ("", "0") else money(v)


def dsl(v):                      # adtrust_dsl уже в долларах
    try:
        return f"{float(v):.2f}"
    except (TypeError, ValueError):
        return ""


def funding(a):                  # способ оплаты: "Visa *1234 (type)"
    f = a.get("funding_source_details")
    if isinstance(f, dict):
        s = f.get("display_string", "") or ""
        t = f.get("type", "")
        return (s + (f" ({t})" if t else "")).strip()
    return ""


def d10(s):                      # ISO8601 -> YYYY-MM-DD
    return (s or "")[:10]


def clean(c):                    # убрать пустые ячейки
    return {k: v for k, v in c.items() if v not in ("", None, [])}


# ---------- детерминированные id документов ----------
def acc_doc(fb_user_id):  return "fb_" + str(fb_user_id)
def aa_doc(account_id):   return "aa_" + str(account_id)
def bm_doc(bm_id):        return "bm_" + str(bm_id)
def fp_doc(page_id):      return "fp_" + str(page_id)
def px_doc(pixel_id):     return "px_" + str(pixel_id)


# ---------- маппинг сущностей -> ячейки документа (поле c базы) ----------
def map_account(inv):
    """t_acc / rows / fb_<id>. merge=True (не затирать ручные поля/креды)."""
    u = inv.get("user", {})
    pic = ((u.get("picture") or {}).get("data") or {}).get("url", "")
    b, a, p, x = inv["businesses"], inv["ad_accounts"], inv["pages"], inv["pixels"]
    return acc_doc(u.get("id", "")), clean({
        "c_fbid": str(u.get("id", "")),
        "c_fbname": u.get("name", ""),
        "c_via_first": u.get("first_name", ""),
        "c_via_last": u.get("last_name", ""),
        "c_via_link": u.get("link", ""),
        "c_via_avatar": pic,
        "c_friends": inv.get("friends"),
        "c_counts": f"БМ {len(b)} · РК {len(a)} · ФП {len(p)} · PX {len(x)}",
    })


def map_ad_account(a, acc_id):
    """t_ads / rows / aa_<account_id>."""
    return aa_doc(a.get("account_id") or a.get("id")), clean({
        "c_act_id": str(a.get("id", "")),
        "c_account_id": str(a.get("account_id", "")),
        "c_name": a.get("name", ""),
        "c_account_status": st(a.get("account_status", "")),
        "c_disable_reason": dis(a.get("disable_reason", "")),
        "c_currency": a.get("currency", ""),
        "c_amount_spent": money(a.get("amount_spent", "")),
        "c_spend_cap": cap(a.get("spend_cap", "")),
        "c_spend_limit": dsl(a.get("adtrust_dsl", "")),   # = «Limit» в SMIT
        "c_balance": money(a.get("balance", "")),
        "c_created_time": d10(a.get("created_time")),
        "c_age": a.get("age"),
        "c_timezone_name": a.get("timezone_name", ""),
        "c_is_prepay": bool(a.get("is_prepay_account")),
        "c_funding_details": funding(a),
        "c_user_tasks": ", ".join(a.get("user_tasks", []) or []),
        "c_min_daily_budget": money(a.get("min_daily_budget", "")),
        "c_min_camp_spend_cap": money(a.get("min_campaign_group_spend_cap", "")),
        "c_is_personal": a.get("is_personal"),
        "c_biz_name": a.get("business_name", ""),
        "c_biz_country": a.get("business_country_code", ""),
        "c_biz_city": a.get("business_city", ""),
        "c_bm": str(a.get("bm", "")),
        "c_acc": [acc_id],
    })


def map_business(b, acc_id, ad_accounts, pages, pixels):
    """t_bm / rows / bm_<id>. Со сводками собственных ассетов БМ."""
    aa = [f"{x.get('name', '')} ({st(x.get('account_status', ''))})" for x in ad_accounts if x.get("bm") == b["id"]]
    pg = [f"{x.get('name', '')} ({x.get('fan_count', 0)} фан.)" for x in pages if x.get("bm") == b["id"]]
    px = [x.get("name", "") for x in pixels if x.get("bm") == b["id"]]
    users = "; ".join(f"{u.get('name', '')} <{u.get('email', '')}> {u.get('role', '')}".strip()
                      for u in (b.get("users") or []))
    child = "; ".join(x.get("name", "") for x in (b.get("child_businesses") or []))
    pp = b.get("primary_page")
    pp = pp.get("name", "") if isinstance(pp, dict) else ""
    return bm_doc(b["id"]), clean({
        "c_bm_id": str(b["id"]),
        "c_bm_name": b.get("name", ""),
        "c_verif_status": b.get("verification_status", ""),
        "c_two_factor": b.get("two_factor_type", ""),
        "c_created_time": d10(b.get("created_time")),
        "c_updated_time": d10(b.get("updated_time")),
        "c_primary_page": pp,
        "c_is_hidden": bool(b.get("is_hidden")),
        "c_link": b.get("link", ""),
        "c_profile_pic": b.get("profile_picture_uri", ""),
        "c_owned_adaccounts": "; ".join(aa),
        "c_owned_pages": "; ".join(pg),
        "c_owned_pixels": "; ".join(px),
        "c_business_users": users,
        "c_owned_businesses": child,
        "c_acc": [acc_id],
    })


def map_page(p, acc_id):
    """t_fp / rows / fp_<id>."""
    picu = ((p.get("picture") or {}).get("data") or {}).get("url", "")
    cov = (p.get("cover") or {}).get("source", "") if isinstance(p.get("cover"), dict) else ""
    eng = (p.get("engagement") or {}).get("count", "") if isinstance(p.get("engagement"), dict) else ""
    catl = "; ".join(c.get("name", "") for c in (p.get("category_list") or []) if isinstance(c, dict))
    loc = p.get("location")
    loc = ", ".join(str(loc.get(k, "")) for k in ("city", "country") if loc.get(k)) if isinstance(loc, dict) else ""
    return fp_doc(p["id"]), clean({
        "c_page_id": str(p["id"]),
        "c_name": p.get("name", ""),
        "c_username": p.get("username", ""),
        "c_link": p.get("link", ""),
        "c_category": p.get("category", ""),
        "c_category_list": catl,
        "c_tasks": ", ".join(p.get("tasks", []) or []),
        "c_is_published": bool(p.get("is_published")),
        "c_verification_status": p.get("verification_status", ""),
        "c_fan_count": p.get("fan_count"),
        "c_followers_count": p.get("followers_count"),
        "c_talking_about_count": p.get("talking_about_count"),
        "c_created_time": d10(p.get("created_time")),
        "c_picture": picu,
        "c_cover": cov,
        "c_engagement": str(eng) if eng != "" else "",
        "c_about": p.get("about", ""),
        "c_description": p.get("description", ""),
        "c_website": p.get("website", ""),
        "c_phone": p.get("phone", ""),
        "c_location": loc,
        "c_single_line_address": p.get("single_line_address", ""),
        "c_bm": str(p.get("bm", "")),
        "c_acc": [acc_id],
    })


def map_pixel(x, acc_id):
    """t_pixel / rows / px_<id>. event_time_* приходят UNIX-секундами."""
    return px_doc(x["id"]), clean({
        "c_pixel_id": str(x["id"]),
        "c_name": x.get("name", ""),
        "c_bm": str(x.get("bm", "")),
        "c_is_unavailable": bool(x.get("is_unavailable")),
        "c_last_fired_time": d10(x.get("last_fired_time")),
        "c_creation_time": d10(x.get("creation_time")),
        "c_data_use_setting": x.get("data_use_setting", ""),
        "c_enable_automatic_matching": bool(x.get("enable_automatic_matching")),
        "c_first_party_cookie_status": x.get("first_party_cookie_status", ""),
        "c_is_created_by_business": bool(x.get("is_created_by_business")),
        "c_has_1p_pixel_event": bool(x.get("has_1p_pixel_event")),
        "c_is_crm": bool(x.get("is_crm")),
        "c_code": (x.get("code", "") or "")[:280],
        "c_description": x.get("description", ""),
        "c_acc": [acc_id],
    })


def map_inventory(inv):
    """Разложить весь инвентарь одного аккаунта в список записей.
    Возвращает список кортежей (collection, doc_id, cells) для записи в Firestore.
    collection — путь коллекции (tables/<tid>/rows)."""
    out = []
    acc_id, acc_cells = map_account(inv)
    out.append(("tables/t_acc/rows", acc_id, acc_cells))
    for a in inv["ad_accounts"]:
        did, cells = map_ad_account(a, acc_id)
        out.append(("tables/t_ads/rows", did, cells))
    for b in inv["businesses"]:
        did, cells = map_business(b, acc_id, inv["ad_accounts"], inv["pages"], inv["pixels"])
        out.append(("tables/t_bm/rows", did, cells))
    for p in inv["pages"]:
        did, cells = map_page(p, acc_id)
        out.append(("tables/t_fp/rows", did, cells))
    for x in inv["pixels"]:
        did, cells = map_pixel(x, acc_id)
        out.append(("tables/t_pixel/rows", did, cells))
    return out


if __name__ == "__main__":
    import json
    import sys
    inv = json.load(open(sys.argv[1], encoding="utf-8"))
    for coll, did, cells in map_inventory(inv):
        print(coll, did, json.dumps(cells, ensure_ascii=False))
