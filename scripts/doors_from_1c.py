"""Строки листа «Двери» таблицы «Каталог» из 1С (только чтение).

Запуск:  ONE_C_BASE_URL=... ONE_C_API_TOKEN=... python3 scripts/doors_from_1c.py out.csv
Ключ не хранить в репозитории. Заголовок: «Authorization: Token <ключ>» (api.eman.uz).

Иерархия в 1С — справочник Catalog_ВидыНоменклатуры (у Catalog_Номенклатура Parent_Key пустой).
Берутся: Двери → Portika / Двери Мебель | Задор/Дельта → Полотна, кроме «Рекламная продукция»,
«Полотна на заказ», «Филенки» и помеченных на удаление. Одинаковые названия в 1С — одна строка.
Колонки CSV: Завод, Ед., Коллекция, Модель, Размер, Номенклатура, Порог (без заголовка);
в листе ещё колонка H «Артикул» = «—» (иначе скрипт возьмёт цифры размера за артикул).
"""
import csv, json, os, re, sys, urllib.parse, urllib.request, collections

BASE, TOKEN = os.environ['ONE_C_BASE_URL'], os.environ['ONE_C_API_TOKEN']

def get(entity, select, extra=None):
    out, skip = [], 0
    while True:
        q = {'$format': 'json', '$select': select, '$top': '5000', '$skip': str(skip)}
        q.update(extra or {})
        req = urllib.request.Request(BASE + urllib.parse.quote(entity) + '?' + urllib.parse.urlencode(q),
                                     headers={'Authorization': 'Token ' + TOKEN})
        page = json.load(urllib.request.urlopen(req, timeout=300))['value']
        out += page; skip += 5000
        if len(page) < 5000: return out

vids = {x['Ref_Key']: x for x in get('Catalog_ВидыНоменклатуры', 'Ref_Key,Parent_Key,Description')}
def path(k):
    p = []
    while k in vids: p.append(vids[k]['Description']); k = vids[k]['Parent_Key']
    return p[::-1]

COLL = {'Классико': 'Классико', 'Неоклассико': 'Неоклассико', 'Порта': 'Порта', 'Порта Invisible': 'Порта Invisible',
        'Полотна Art Lite': 'Art Lite', 'Полотна Classic Baguette': 'Classic Baguette', 'Полотна Filomuro': 'Filomuro',
        'Полотна Forma': 'Forma', 'Полотна Legno': 'Legno', 'Полотна S': 'S', 'Полотна SK': 'SK', 'Полотна SP': 'SP',
        'Полотна Sense': 'Sense', 'Полотна Zadoor-S Classic': 'Zadoor-S Classic', 'Полотна Квалитет': 'Квалитет'}
FACT = {'Portika / Двери Мебель': 'Portika', 'Задор/Дельта': 'Задор'}
PFX = r'^(Дверное полотно\s+)?(Zadoor SENSE|LEGNO|Classic Baguette|Art-Lite|Zadoor-S Classic|Filomuro)?\s*'

def unify(m):
    """Одна дверь в 1С пишется по-разному: Topan/Toppan, B3/В3/«В 1», тёмный/темный, «А К»/«АК 2».
    Приводим к одному написанию, чтобы все размеры модели попали в одну карточку и к одному фото."""
    m = m.replace('ё', 'е').replace('Ё', 'Е')
    m = re.sub(r'\bTopan\b', 'Toppan', m)
    m = re.sub(r'(?<![A-Za-zА-Яа-я])[BВ]\s?(\d)', r'В\1', m)
    m = re.sub(r'\bА К\b', 'АК', m).replace('АК 2', 'АК2')
    return re.sub(r'\s+', ' ', m).strip()

rows, seen = [], set()
for x in get('Catalog_Номенклатура', 'Ref_Key,Description,DeletionMark,ВидНоменклатуры_Key'):
    v = path(x['ВидНоменклатуры_Key'])
    if x['DeletionMark'] or len(v) < 4 or v[0] != 'Двери' or v[2] != 'Полотна': continue
    f = FACT.get(v[1])
    if not f or v[3] not in COLL or 'Филенки' in v: continue
    s = re.sub(r'\s+', ' ', x['Description']).strip()
    if s.lower() in seen or s.lower().startswith('образец'): continue
    seen.add(s.lower())
    m = re.search(r'(\d{2})\s*[хx*]\s*(\d{3,4})\s*[хx*]\s*(\d{4})', s)          # 35х800х2000
    if m: t, w, h = m.groups()
    else:
        m = re.search(r'(\d{4})\s*\*\s*(\d{3,4})(?:\s*\*\s*(\d{2}))?', s)       # 2000*800(*40)
        if not m: continue
        h, w, t = m.groups()
    model = re.sub(PFX, '', (s[:m.start()] + ' ' + s[m.end():]).strip())
    model = re.sub(r'\s+', ' ', re.sub(r'[()]', ' ', model)).strip(' ,')
    model = unify(model)
    rows.append([f, 'шт', COLL[v[3]], model, w if h == '2000' else f'{w}×{h}', x['Description'].strip(), 5, t])

c = collections.Counter((r[2], r[3].lower(), r[4]) for r in rows)
for r in rows:
    if c[(r[2], r[3].lower(), r[4])] > 1 and r[7]: r[4] += f' ({r[7]} мм)'
    del r[7]
first = {}                                    # одно написание модели на всю карточку
for r in rows: r[3] = first.setdefault((r[2], r[3].lower()), r[3])
rows.sort(key=lambda r: (r[0] != 'Portika', r[2], r[3].lower(), int(re.match(r'\d+', r[4]).group()), r[4]))
csv.writer(open(sys.argv[1], 'w', newline='')).writerows(rows)
print(len(rows), 'строк,', len({(r[0], r[2], r[3]) for r in rows}), 'карточек')
