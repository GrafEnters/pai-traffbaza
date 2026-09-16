"""adspower_profiles.py — связка «профиль AdsPower ↔ FB-аккаунт».

Зачем: расширение при сборе знает FB-id аккаунта (из Graph API me.id), но НЕ
знает имя профиля AdsPower (напр. подпись/метку профиля). Чтобы подписывать
записи базы именем профиля, нужно сопоставить их.

Две половины связки:
  1) FB-id  ←→ имя профиля AdsPower.
     - FB-id даёт сам сбор (collect.js: out.user.id).
     - имя/метку профиля даёт локальный AdsPower API (этот скрипт).
     Сопоставление: запустить профиль → собрать → взять me.id → связать с именем
     этого профиля. (Или наоборот — хранить в базе оба поля и джойнить по FB-id.)

  2) Этот скрипт — половина «AdsPower»: перечисляет профили (user_id, name,
     remark). remark обычно содержит логины/пароли аккаунта в своём формате.

⚠️ Local API AdsPower под нагрузкой роняет страницы — поэтому паузы между
страницами и запас по числу страниц. Порт у каждой машины свой (обычно 50325).

Запуск:
    python adspower_profiles.py                # все профили -> JSONL (uid, name, remark)
    python adspower_profiles.py 04.09 149      # искать по подстроке в имени
"""
import json
import re
import sys
import time
import urllib.request

BASE = "http://local.adspower.net:50325"   # порт AdsPower Local API (свой на каждой машине)


def list_profiles(base=BASE, pause=0.6, max_pages=60):
    """Вернуть {user_id: {"name":..., "remark":...}} по всем профилям."""
    rows = {}
    for page in range(1, max_pages + 1):
        try:
            with urllib.request.urlopen(
                    f"{base}/api/v1/user/list?page={page}&page_size=100", timeout=20) as r:
                data = json.loads(r.read().decode())
        except Exception:                    # noqa: BLE001 — под нагрузкой бывают сбои, продолжаем
            time.sleep(1.0)
            continue
        lst = (data.get("data") or {}).get("list") or []
        if not lst:
            break
        for u in lst:
            rows[u.get("user_id")] = {
                "name": (u.get("name") or "").strip(),
                "remark": u.get("remark", "") or "",
            }
        time.sleep(pause)                    # не долбить API
    return rows


def main():
    needle = " ".join(sys.argv[1:]).strip().lower()
    rows = list_profiles()
    print(f"# профилей: {len(rows)}", file=sys.stderr)
    for uid, info in rows.items():
        if needle and needle not in info["name"].lower():
            continue
        print(json.dumps({"user_id": uid, **info}, ensure_ascii=False))


if __name__ == "__main__":
    main()
