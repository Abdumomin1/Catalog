/**
 * КАТАЛОГ ЛАМИНАТА ДЛЯ TELEGRAM.
 *
 * Файлы проекта:  Code (этот), Каталог (HTML), Диагностика, Claude — последние два необязательны.
 *
 * ЧТО ГДЕ ЛЕЖИТ
 *   лист «Каталог»    — товары, одна строка = один товар
 *   лист «Настройки»  — всё, что можно менять: ссылки, пороги, заголовки
 *   этот файл         — только код, ничего настраиваемого
 *
 * СКОРОСТЬ
 *   Список фотографий и собранный каталог кэшируются раздельно: папка Диска
 *   перечитывается редко, остатки часто. Фоновое обновление (меню «Ускорить
 *   загрузку») держит кэш готовым, чтобы дилер никогда не ждал пересборку.
 */

// ═══════════════════════════════════════════
//  КОНСТАНТЫ. Менять только при правке кода.
// ═══════════════════════════════════════════
const CFG = {
  SHEET:     'Каталог',      // лист с товарами
  SETTINGS:  'Настройки',    // лист с настройками
  CHUNK:     90000,          // предел CacheService — 100 КБ на ключ
  MAX_DEPTH: 4,              // глубина обхода подпапок Диска
  WARM_MIN:  10,             // как часто фоново обновлять кэш, минут
};

/** Названия параметров на листе «Настройки». */
const K = {
  IMG:       'Папка с фото (ссылка)',
  SRC:       'Таблица остатков (ссылка)',
  SRC_SHEET: 'Лист остатков',
  COL_NAME:  'Колонка наименования',
  COL_STOCK: 'Колонка остатка',
  CACHE:     'Кэш остатков, минут',
  IMG_CACHE: 'Кэш фотографий, часов',
  HIDE_OUT:  'Скрывать позиции без остатка',
  OUT_LABEL: 'Надпись при нулевом остатке',
  FOOT:      'Строка внизу каталога',
  DEF_CAT:   'Категория по умолчанию',
  LOW:       'Порог «мало», м²',
  MIN:       'Минимальный остаток, м²',
  NUMBERS:   'Показывать точный остаток',
  TITLE:     'Заголовок',
  SUB:       'Подпись',
  BATCH:     'Карточек сразу',
};

/** Значения по умолчанию и пояснения для листа настроек. */
const DEFAULTS = [
  [K.IMG,       '',                 'Ссылка на папку Google Диска с фотографиями. Доступ: «Все, у кого есть ссылка — Читатель»'],
  [K.SRC,       '',                 'Ссылка на таблицу, откуда берутся остатки'],
  [K.SRC_SHEET, 'Цены 1C',          'Название листа с остатками в той таблице'],
  [K.COL_NAME,  'B',                'Колонка с наименованием товара'],
  [K.COL_STOCK, 'D',                'Колонка с остатком'],
  [K.CACHE,     '15',               'Как часто перечитывать остатки, минут'],
  [K.IMG_CACHE, '6',                'Как часто перечитывать папку с фото, часов. Обход папки медленный, чаще не нужно'],
  [K.HIDE_OUT,  'нет',              '«да» — позиции с нулевым остатком в каталог не попадают'],
  [K.OUT_LABEL, 'нет в наличии',    'Что писать на карточке, когда остатка нет: «нет в наличии», «под заказ» и т.п.'],
  [K.FOOT,      '',                 'Мелкая строка в самом низу каталога. Пусто — строки не будет'],
  [K.DEF_CAT,   'Ламинат',          'Категория для строк, где колонка «Категория» пустая'],
  [K.LOW,       '100',              'Ниже этого остаток подсвечивается как «мало». Можно задать отдельно в колонке «Порог»'],
  [K.MIN,       '1',                'Ниже этого считается, что товара нет'],
  [K.NUMBERS,   'нет',              '«да» — показывать точное число и выше порога'],
  [K.TITLE,     'Каталог ламината', 'Заголовок вкладки браузера'],
  [K.SUB,       'Maff',             'Подпись в шапке каталога'],
  [K.BATCH,     '24',               'Сколько карточек показывать сразу, остальные — по мере прокрутки'],
];

// ═══════════════════════════════════════════
//  Чтение настроек
// ═══════════════════════════════════════════
let OPTS_ = null;

function opts_() {
  if (OPTS_) return OPTS_;

  const sh  = SpreadsheetApp.getActive().getSheetByName(CFG.SETTINGS);
  const map = {};

  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
      const k = norm_(r[0]);
      if (k) map[k] = String(r[1]).trim();
    });
  }

  function get(key, def) {
    const v = map[norm_(key)];
    return (v === undefined || v === '') ? def : v;
  }
  function num(key, def) {
    const v = Number(String(get(key, def)).replace(',', '.'));
    return isNaN(v) ? def : v;
  }
  function yes(key, def) {
    return /^(да|yes|true|1|\+)$/i.test(String(get(key, def)).trim());
  }

  OPTS_ = {
    imgFolder: idFrom_(get(K.IMG, '')),
    srcId:     idFrom_(get(K.SRC, '')),
    srcSheet:  get(K.SRC_SHEET, 'Цены 1C'),
    colName:   colNum_(get(K.COL_NAME, 'B')),
    colStock:  colNum_(get(K.COL_STOCK, 'D')),
    cacheMin:  Math.max(1, num(K.CACHE, 15)),
    imgHours:  Math.max(1, num(K.IMG_CACHE, 6)),
    hideOut:   yes(K.HIDE_OUT, 'нет'),
    outLabel:  get(K.OUT_LABEL, 'нет в наличии'),
    foot:      get(K.FOOT, ''),
    defCat:    get(K.DEF_CAT, 'Ламинат'),
    low:       num(K.LOW, 100),
    minStock:  num(K.MIN, 1),
    numbers:   yes(K.NUMBERS, 'нет'),
    title:     get(K.TITLE, 'Каталог ламината'),
    subtitle:  get(K.SUB, ''),
    batch:     Math.max(6, num(K.BATCH, 24)),
  };
  return OPTS_;
}

/** Из ссылки на Диск или Таблицы вытаскивает идентификатор. Голый ID отдаёт как есть. */
function idFrom_(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const m = s.match(/[-\w]{25,}/);
  return m ? m[0] : s;
}

/** «B» → 2. Число отдаёт как есть. */
function colNum_(v) {
  const s = String(v || '').trim();
  if (/^\d+$/.test(s)) return Number(s);

  let n = 0;
  s.toUpperCase().replace(/[^A-Z]/g, '').split('').forEach(function (ch) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  });
  return n || 0;
}

// ═══════════════════════════════════════════
//  Страница
// ═══════════════════════════════════════════
function doGet(e) {
  // Точка для внешней обёртки: ?data=json отдаёт данные и настройки без страницы
  if (e && e.parameter && e.parameter.data === 'json') {
    return ContentService.createTextOutput(payloadJson_())
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Страница лежит в кэше уже собранной — ни одного обращения к таблице,
  // ни сборки шаблона. Это минимум работы, возможный на этой платформе.
  let html  = readChunks_('html');
  let title = CacheService.getScriptCache().get('html_t');

  if (!html) {
    const built = buildPage_();      // редкий промах: ускорение выключено или кэш вытеснен
    html  = built.html;
    title = built.title;
  }

  return HtmlService.createHtmlOutput(html)
    .setTitle(title || 'Каталог')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Собирает страницу целиком — данные, настройки, разметку — и кладёт в кэш. */
function buildPage_() {
  const o   = opts_();
  const ttl = Math.round(o.cacheMin * 60);

  const html = HtmlService.createHtmlOutputFromFile('Каталог').getContent()
    .replace('__DATA__',     catalogJson_())
    .replace('__NUMBERS__',  o.numbers ? 'true' : 'false')
    .replace('__MINSTOCK__', String(o.minStock))
    .replace('__BATCH__',    String(o.batch))
    .replace('__HIDEOUT__',  o.hideOut ? 'true' : 'false')
    .replace('__OUTLABEL__', JSON.stringify(o.outLabel))
    .replace('__FOOTNOTE__', JSON.stringify(o.foot))
    .replace('__SUBTITLE__', JSON.stringify(o.subtitle));

  writeChunks_('html', html, ttl);
  CacheService.getScriptCache().put('html_t', o.title, ttl);
  return { html: html, title: o.title };
}

// ═══════════════════════════════════════════
//  Общее
// ═══════════════════════════════════════════
function norm_(s) {
  return String(s)
    .replace(/[​‌‍﻿]/g, '')   // символы нулевой ширины
    .replace(/[\s ]+/g, ' ')                 // любые пробелы, включая неразрывный
    .trim()
    .toLowerCase();
}

/**
 * Ключ, устойчивый к знакам, которые Windows запрещает в именах файлов.
 * Номенклатура «Плинтус 1 UHD 01/80, белый, 2.4м» файлом так не назовёшь —
 * поэтому и она, и имя файла приводятся к виду «плинтус 1 uhd 01 80 белый 2 4м».
 * Годится любая замена косой черты: пробел, дефис, подчёркивание.
 */
function looseKey_(s) {
  return norm_(s)
    .replace(/[\\\/:*?"<>|,;.\-–—_()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** «59787 RL» → «59787». Для поиска по остаткам и фото. */
function artDigits_(s) {
  const m = String(s).match(/\d{3,6}/);
  return m ? m[0] : '';
}

/**
 * «ЛП 12мм 33кл 50737 Дуб Дженнаро Grotesk Aqua Lock» → «Дуб Дженнаро».
 *
 * Если размер вынесен в отдельную колонку, он вычищается и из названия модели:
 * «Дверь Верона белая 800мм» + размер «800» → «Дверь Верона белая».
 * Иначе каждый размер стал бы отдельной карточкой и требовал своего фото.
 */
function decorFrom_(nom, art, coll, size) {
  let s = String(nom);

  // Размер убираем ПЕРВЫМ: иначе он может совпасть с цифрами артикула
  // и обрезать название по себе.
  if (size) {
    const esc = String(size).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp('(^|\\s)' + esc + '\\s*(мм|mm|см|cm|м)?(?=\\s|$|,)', 'ig'), ' ');
    s = s.replace(/(^|\s)\d{2,4}\s*(мм|mm)(?=\s|$|,)/ig, ' ');  // осколки вроде «800мм»
  }

  const digits = artDigits_(art) || artDigits_(s);
  if (digits) {
    const i = s.indexOf(digits);
    if (i >= 0) s = s.slice(i + digits.length);
  }

  s = s.replace(/\s*(aqua\s*)?lock\s*$/i, '');                 // «Aqua Lock» и одиночный «Lock»
  s = s.replace(/\d+[.,]\d+\s*[*xх×Х]\s*\d+[.,]\d+/g, '');     // размер «1,285*0,192»

  if (coll) {
    const esc = String(coll).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp('(^|\\s)' + esc + '(\\s|$)', 'ig'), ' ');
  }
  s = s.replace(/\s+/g, ' ').trim();

  return s || String(nom);
}

/** Допустимые заголовки колонок листа «Каталог». Первое совпадение выигрывает. */
const COLS = {
  nom:     ['номенклатура', 'полное название', 'наименование'],
  cat:     ['категория', 'раздел', 'группа товаров'],
  factory: ['завод', 'производитель'],
  spec:    ['толщина и класс', 'толщина/класс', 'высота/длина', 'высота', 'тип'],
  coll:    ['коллекция'],
  art:     ['артикул'],
  decor:   ['декор', 'название декора', 'модель'],
  color:   ['цвет'],
  dtype:   ['тип декора'],
  low:     ['порог', 'порог остатка'],
  size:    ['размер'],
  unit:    ['ед', 'ед.', 'единица', 'ед. изм.', 'ед изм'],
  promo:   ['приоритет', 'продвижение', 'промо'],

  // Характеристики ламината. Метраж пачки считается сам из длины,
  // ширины и числа плашек; «м² в пачке» — необязательный ручной override.
  thick:   ['толщина', 'толщина, мм'],
  klass:   ['класс'],
  chamfer: ['фаска'],
  len:     ['длина', 'длина, мм', 'длина плашки'],
  wid:     ['ширина', 'ширина, мм', 'ширина плашки'],
  planks:  ['плашек в пачке', 'плашек в упаковке', 'штук в пачке', 'досок в пачке',
            'пачка', 'в пачке', 'плашек'],
  pallet:  ['пачек в паллете', 'пачек на паллете', 'пачек в поддоне', 'пачек в падоне',
            'падон', 'паллет', 'поддон', 'падон, пачек'],
  pack:    ['м² в пачке', 'м2 в пачке', 'кв в пачке'],
};

/** Поля, которые наследуются внутри коллекции: хватает заполнить одну строку. */
const INHERIT = ['thick', 'klass', 'chamfer', 'len', 'wid', 'planks', 'pallet', 'pack'];

/** «1 285,5» → 1285.5, «1285 мм» → 1285. Нечисло → 0. */
function numOf_(v) {
  const m = String(v).replace(/\s/g, '').replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

/**
 * Толщина, класс и фаска вытаскиваются из колонки «Толщина и класс»:
 * «12/33 фаска» → 12 мм, 33 класс, с фаской. Отдельных колонок не требуется.
 * Числа проверяются на правдоподобие, иначе «01/80» у плинтусов
 * превратилось бы в толщину 1 мм и класс 80.
 */
function specsFromLine_(p) {
  const out = {};
  const m = String(p).match(/(\d+)\s*[\/\\]\s*(\d+)/);
  if (m) {
    const th = Number(m[1]), cl = Number(m[2]);
    if (th >= 4 && th <= 20 && cl >= 21 && cl <= 34) { out.th = th; out.cl = cl; }
  }
  if (/фаск/i.test(p)) out.ch = !/без\s*фаск/i.test(p);
  return out;
}

function columnsOf_(sh) {
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const pos  = {};
  head.forEach(function (h, i) {
    const k = norm_(h);
    if (k && !(k in pos)) pos[k] = i;
  });

  const map = {};
  Object.keys(COLS).forEach(function (key) {
    map[key] = -1;
    COLS[key].some(function (name) {
      if (name in pos) { map[key] = pos[name]; return true; }
      return false;
    });
  });

  if (map.nom < 0) return null;              // нет «Номенклатуры» — лист не каталожный
  return map;
}

/**
 * Каталожные листы: все, кроме «Настройки» и листов с именем на «_».
 * Имя листа = категория товара; лист «Каталог» — общий, категория
 * берётся из его колонки «Категория» или из настройки по умолчанию.
 */
function catalogSheets_() {
  return SpreadsheetApp.getActive().getSheets().filter(function (sh) {
    const n = sh.getName();
    return n !== CFG.SETTINGS && n.charAt(0) !== '_';
  });
}

// ═══════════════════════════════════════════
//  Сборка каталога
// ═══════════════════════════════════════════
/** [{k категория, f завод, p толщина/класс, c коллекция, a артикул, d декор, q остаток, w порог, i фото}] */
function buildCatalog_() {
  const o     = opts_();
  const imgs  = imageMap_();
  const stock = stockMap_();
  const out   = [];

  // ── первый проход: разбор строк всех каталожных листов ──
  const raw = [];
  catalogSheets_().forEach(function (sh) {
    if (sh.getLastRow() < 2) return;

    const cols = columnsOf_(sh);
    if (!cols) return;                             // нет «Номенклатуры» — пропускаем лист

    // имя листа = категория; общий лист «Каталог» берёт её из колонки или настройки
    const sheetCat = sh.getName() === CFG.SHEET ? '' : sh.getName();
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();

    function cell(r, key) {
      if (cols[key] < 0) return '';
      const v = r[cols[key]];
      // «7/31» Таблица сама превращает в дату 31 июля — возвращаем как было
      if (v instanceof Date) return (v.getMonth() + 1) + '/' + v.getDate();
      return String(v).trim();
    }

    // Единица измерения задаётся один раз на лист: первое непустое значение
    // в колонке «Ед.» действует на все строки, где ячейка пустая.
    let sheetUnit = '';
    if (cols.unit >= 0) {
      for (let i = 0; i < rows.length && !sheetUnit; i++) {
        sheetUnit = String(rows[i][cols.unit]).trim();
      }
    }

    // Характеристики одинаковы у всей коллекции: размер плашки и метраж пачки
    // не меняются от декора. Достаточно заполнить одну строку на коллекцию —
    // первое непустое значение подхватят остальные.
    const inherit = {};
    rows.forEach(function (r) {
      const ck = norm_(cols.coll >= 0 ? r[cols.coll] : '') || '*';
      if (!inherit[ck]) inherit[ck] = {};
      INHERIT.forEach(function (f) {
        if (cols[f] < 0 || inherit[ck][f]) return;
        const v = String(r[cols[f]]).trim();
        if (v) inherit[ck][f] = v;
      });
    });

    rows.forEach(function (r) {
      const nom = cell(r, 'nom');
      if (!nom) return;

      const coll = cell(r, 'coll');
      const art  = cell(r, 'art') || artDigits_(nom);
      const size = cell(r, 'size');
      const inh  = inherit[norm_(coll) || '*'] || {};

      function spec(f) { return cell(r, f) || inh[f] || ''; }

      raw.push({
        thick:   spec('thick'),
        klass:   spec('klass'),
        chamfer: spec('chamfer'),
        len:     spec('len'),
        wid:     spec('wid'),
        planks:  spec('planks'),
        pallet:  spec('pallet'),
        pack:    spec('pack'),
        nom:   nom,
        cat:   cell(r, 'cat') || sheetCat || o.defCat,
        coll:  coll,
        art:   art,
        dig:   artDigits_(art),
        decor: cell(r, 'decor') || decorFrom_(nom, art, coll, size),
        color: cell(r, 'color'),
        dtype: cell(r, 'dtype'),
        f:     cell(r, 'factory') || '—',
        p:     cell(r, 'spec'),
        w:     Number(cell(r, 'low')) || o.low,
        size:  size,
        unit:  cell(r, 'unit') || sheetUnit,
        promo: Number(cell(r, 'promo')) || 0,
      });
    });
  });

  // ── какие номера повторяются: искать по ним нельзя, дадут чужой товар ──
  const seen = {}, ambiguous = {};
  raw.forEach(function (x) {
    if (!x.dig) return;
    if (seen[x.dig]) ambiguous[x.dig] = true;
    seen[x.dig] = true;
  });

  // ── группировка размерных вариантов: одна модель — одна карточка ──
  // Строки с заполненным «Размером» и одинаковыми заводом, коллекцией и декором
  // склеиваются: дверь 600/700/800/900 мм показывается один раз,
  // остатки по размерам раскрываются при увеличении карточки.
  const groups = {}, order = [];
  raw.forEach(function (x, idx) {
    const gkey = x.size
      ? 'g|' + norm_(x.cat + '|' + x.f + '|' + x.coll + '|' + x.decor)
      : 'r|' + idx;
    if (!(gkey in groups)) { groups[gkey] = []; order.push(gkey); }
    groups[gkey].push(x);
  });

  order.forEach(function (gkey) {
    const list = groups[gkey];
    const x    = list[0];

    let total = null;
    let img   = '';
    let boost = 0;
    const variants = [];

    list.forEach(function (v) {
      if (v.promo > boost) boost = v.promo;
      const key  = norm_(v.nom);
      const safe = v.dig && !ambiguous[v.dig];     // номер встречается один раз

      let q = stock[key];
      if (q === undefined && safe) q = stock[v.dig];
      const qty = (q === undefined || q === '' || q === null) ? null : Number(q);

      if (qty !== null) total = (total === null ? 0 : total) + qty;
      if (v.size) variants.push([v.size, qty]);

      if (!img) img = imgs[key] || imgs[looseKey_(v.nom)] || (safe ? imgs[v.dig] : '') || '';
    });

    // Фото у модели одно на все размеры: годится имя файла по номенклатуре
    // любого размера (проверено выше) либо просто по названию модели.
    if (!img) img = imgs[norm_(x.coll + ' ' + x.decor)] ||
                    imgs[looseKey_(x.coll + ' ' + x.decor)] ||
                    imgs[norm_(x.decor)] ||
                    imgs[looseKey_(x.decor)] || '';

    // Ещё фото для листания: те же имена с « 2», « 3»… Порядок — по номеру.
    let gal = null;
    [norm_(x.nom), looseKey_(x.nom), norm_(x.coll + ' ' + x.decor), looseKey_(x.coll + ' ' + x.decor),
     norm_(x.decor), looseKey_(x.decor)].some(function (k) {
      if (k && imgs['+' + k]) { gal = imgs['+' + k]; return true; }
      return false;
    });
    if (!gal) list.some(function (v) {
      const k = norm_(v.nom), l = looseKey_(v.nom);
      gal = imgs['+' + k] || imgs['+' + l] || null;
      return !!gal;
    });
    const more = gal ? gal.slice().sort(function (a, b) { return a[0] - b[0]; })
                          .map(function (p) { return p[1]; })
                          .filter(function (id) { return id !== img; }) : [];

    // Нулевые остатки не отдаём в каталог совсем — меньше данных и меньше карточек.
    // Позиции, которых нет в 1С, остаются видимыми: иначе ошибка в номенклатуре
    // молча прятала бы товар.
    if (o.hideOut && total !== null && total < o.minStock) return;

    variants.sort(function (a, b) {
      return (parseFloat(a[0]) || 0) - (parseFloat(b[0]) || 0) ||
             String(a[0]).localeCompare(String(b[0]), 'ru');      // «А» раньше «Б»
    });

    const item = {
      k: x.cat,
      f: x.f,
      p: x.p,
      c: x.coll || x.p || x.cat,      // нет коллекции — заголовком группы служит категория
      a: x.art,
      d: x.decor,
      q: total,
      w: x.w,
      u: x.unit || (variants.length ? 'шт' : ''),
      i: img || '',
    };
    if (x.color) item.o = x.color;      // фильтр «Цвет»
    if (x.dtype) item.t = x.dtype;      // фильтр «Тип декора»
    if (img && more.length) item.g = more.slice(0, 5);   // листание: максимум 6 фото на товар
    // ── характеристики ──
    // Толщина, класс и фаска запасным путём берутся из «Толщины и класса»;
    // явно заполненные колонки всегда сильнее.
    const sp = specsFromLine_(x.p);
    if (x.thick)   sp.th = numOf_(x.thick) || x.thick;
    if (x.klass)   sp.cl = numOf_(x.klass) || x.klass;
    if (x.chamfer) sp.ch = /^(да|yes|true|1|\+|есть|фаска|ha|bor)$/i.test(x.chamfer);
    if (x.len)     sp.ln = numOf_(x.len);
    if (x.wid)     sp.wd = numOf_(x.wid);
    if (x.planks)  sp.pn = numOf_(x.planks);
    if (x.pallet)  sp.pd = numOf_(x.pallet);

    // метраж пачки: длина × ширина × плашек, мм → м²; ручное значение перебивает
    if (x.pack)                       sp.pk = numOf_(x.pack);
    else if (sp.ln && sp.wd && sp.pn) sp.pk = Math.round(sp.ln * sp.wd * sp.pn / 10) / 100000;   // мм² → м², до 5 знаков

    if (variants.length) item.v = variants;
    if (boost) item.b = boost;               // продвижение: поднимает позицию наверх
    if (Object.keys(sp).length) item.s = sp;
    out.push(item);
  });

  return out;
}

/** Остатки из внешней таблицы. Одно чтение, ключи нормализованы. */
function stockMap_() {
  const o   = opts_();
  const map = {};
  if (!o.srcId || !o.colName || !o.colStock) return map;

  const src = SpreadsheetApp.openById(o.srcId).getSheetByName(o.srcSheet);
  if (!src) return map;

  const last = src.getLastRow();
  if (last < 2) return map;

  const first  = Math.min(o.colName, o.colStock);
  const width  = Math.abs(o.colStock - o.colName) + 1;
  const iName  = o.colName  - first;
  const iStock = o.colStock - first;

  src.getRange(2, first, last - 1, width).getValues().forEach(function (r) {
    const key = norm_(r[iName]);
    if (!key || key in map) return;
    map[key] = r[iStock];

    const dig = artDigits_(r[iName]);              // запасной ключ по цифрам
    if (dig && !(dig in map)) map[dig] = r[iStock];
  });

  return map;
}

/**
 * Фотографии из папки Диска. Обход папки медленный, поэтому результат
 * кэшируется отдельно и надолго — содержимое папки меняется редко.
 */
function imageMap_() {
  const o = opts_();
  if (!o.imgFolder) return {};

  const cached = readChunks_('img');
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  const map = {};
  scanFolder_(DriveApp.getFolderById(o.imgFolder), map, 0);
  writeChunks_('img', JSON.stringify(map), Math.round(o.imgHours * 3600));
  return map;
}

function scanFolder_(folder, map, depth) {
  if (depth > CFG.MAX_DEPTH) return;

  const files = folder.getFiles();
  while (files.hasNext()) {
    const f    = files.next();
    const base = f.getName().replace(/\.[^.]+$/, '');
    const id   = f.getId();                        // страница строит адрес сама — данные короче

    map[norm_(base)] = id;                         // по полному имени файла

    const lk = looseKey_(base);                    // и без знаков, запрещённых в Windows
    if (lk && !(lk in map)) map[lk] = id;

    const dig = artDigits_(base);                  // и по цифрам артикула из имени
    if (dig && !(dig in map)) map[dig] = id;

    // Дополнительные фото для листания: «Номенклатура 2.jpg», «… (3).jpg», «…_2.jpg».
    // Файл остаётся доступен и по полному имени — на случай, если номенклатура сама кончается цифрой.
    const ex = base.match(/^(.+?)\s*(?:\(([2-9])\)|[\s_]+([2-9]))$/);
    if (ex) {
      const n = Number(ex[2] || ex[3]);
      [norm_(ex[1]), looseKey_(ex[1])].forEach(function (k) {
        if (!k) return;
        const list = map['+' + k] || (map['+' + k] = []);
        if (!list.some(function (p) { return p[1] === id; })) list.push([n, id]);
      });
    }
  }

  const subs = folder.getFolders();
  while (subs.hasNext()) scanFolder_(subs.next(), map, depth + 1);
}

// ═══════════════════════════════════════════
//  Кэш
// ═══════════════════════════════════════════
function readChunks_(prefix) {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(prefix + '_n'));
  if (!n) return null;

  const keys = [];
  for (let i = 0; i < n; i++) keys.push(prefix + '_' + i);
  const parts = cache.getAll(keys);

  let s = '';
  for (let i = 0; i < n; i++) {
    if (parts[prefix + '_' + i] == null) return null;   // кусок вытеснен — считаем промахом
    s += parts[prefix + '_' + i];
  }
  return s;
}

function writeChunks_(prefix, s, ttl) {
  const cache  = CacheService.getScriptCache();
  const chunks = Math.ceil(s.length / CFG.CHUNK);
  const put    = {};
  for (let i = 0; i < chunks; i++) put[prefix + '_' + i] = s.substr(i * CFG.CHUNK, CFG.CHUNK);

  cache.putAll(put, ttl);
  cache.put(prefix + '_n', String(chunks), ttl);
}

function catalogJson_() {
  const cached = readChunks_('cat');
  if (cached) return cached;

  const s = JSON.stringify(buildCatalog_());
  writeChunks_('cat', s, Math.round(opts_().cacheMin * 60));
  return s;
}

/** Данные вместе с настройками — для внешней оболочки. Строки склеиваются без пере-разбора. */
function payloadJson_() {
  const o = opts_();
  return '{"cfg":{"numbers":' + (o.numbers ? 'true' : 'false') +
         ',"minstock":' + o.minStock +
         ',"batch":' + o.batch +
         ',"hideout":' + (o.hideOut ? 'true' : 'false') +
         ',"outlabel":' + JSON.stringify(o.outLabel) +
         ',"foot":' + JSON.stringify(o.foot) +
         ',"subtitle":' + JSON.stringify(o.subtitle) +
         '},"items":' + catalogJson_() + '}';
}

/** Полный сброс: данные, страница, список фотографий, прогрев миниатюр. */
function clearCache_() {
  CacheService.getScriptCache().removeAll(['cat_n', 'html_n', 'html_t', 'img_n', 'thumbs_ok']);
  OPTS_ = null;
}

// ═══════════════════════════════════════════
//  Фоновое обновление — чтобы дилер не ждал сборку
// ═══════════════════════════════════════════
/**
 * Пересобирает каталог заранее, чтобы дилер всегда попадал на готовый кэш.
 * Если истёк и кэш фотографий — перечитывает папку тоже, забирая эту
 * медленную работу на себя, а после прогревает миниатюры на стороне Диска.
 */
function warmCache() {
  OPTS_ = null;
  CacheService.getScriptCache().removeAll(['cat_n', 'html_n']);
  buildPage_();                                    // пересоберёт данные и страницу целиком

  // Миниатюры прогреваются один раз за жизнь кэша фотографий, а не только
  // когда он оказался холодным именно в момент запуска.
  const cache = CacheService.getScriptCache();
  if (!cache.get('thumbs_ok')) {
    warmThumbs_();
    cache.put('thumbs_ok', '1', Math.round(opts_().imgHours * 3600));
  }
}

/**
 * Первый запрос миниатюры заставляет Диск её генерировать — это и давало
 * медленные картинки у первого дилера. Здесь миниатюры запрашиваются фоном,
 * после чего Диск отдаёт их из своего кэша мгновенно.
 */
function warmThumbs_() {
  let map;
  try { map = JSON.parse(readChunks_('img') || '{}'); } catch (e) { return; }

  const seen = {}, urls = [];
  Object.keys(map).forEach(function (k) {
    const v = String(map[k]);
    if (seen[v]) return;
    seen[v] = true;
    urls.push(v.indexOf('http') === 0
      ? v.replace(/sz=w\d+/, 'sz=w400')
      : 'https://drive.google.com/thumbnail?id=' + v + '&sz=w400');
  });

  for (let i = 0; i < urls.length; i += 40) {
    try {
      UrlFetchApp.fetchAll(urls.slice(i, i + 40).map(function (u) {
        return { url: u, muteHttpExceptions: true };
      }));
    } catch (e) {}
  }
}

function enableWarmUp() {
  disableWarmUp();
  ScriptApp.newTrigger('warmCache').timeBased().everyMinutes(CFG.WARM_MIN).create();

  SpreadsheetApp.getActive().toast(
    'Каталог будет пересобираться каждые ' + CFG.WARM_MIN + ' минут в фоне.\n' +
    'Дилеры всегда попадают на готовый результат.',
    'Ускорение включено', 15);
}

function disableWarmUp() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'warmCache') ScriptApp.deleteTrigger(t);
  });
}

function warmUpStatus_() {
  return ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'warmCache';
  });
}

// ═══════════════════════════════════════════
//  Создание листов
// ═══════════════════════════════════════════
function setupSettingsSheet() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(CFG.SETTINGS);

  if (!sh) {
    sh = ss.insertSheet(CFG.SETTINGS);
    sh.getRange(1, 1, 1, 3).setValues([['Параметр', 'Значение', 'Пояснение']]);
    sh.getRange(1, 1, 1, 3).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 240);
    sh.setColumnWidth(2, 320);
    sh.setColumnWidth(3, 520);
  }

  // дописываем только недостающие параметры, введённые значения не трогаем
  const have = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues()
      .forEach(function (r) { have[norm_(r[0])] = true; });
  }

  const add = DEFAULTS.filter(function (d) { return !have[norm_(d[0])]; });
  if (add.length) {
    sh.getRange(sh.getLastRow() + 1, 1, add.length, 3).setValues(add);
    sh.getRange(2, 3, sh.getLastRow() - 1, 1).setFontColor('#7a736b').setWrap(true);
  }

  clearCache_();
  sh.activate();
  ss.toast('Лист «' + CFG.SETTINGS + '» готов. Заполни ссылки в колонке «Значение».',
           'Настройки', 20);
}

function setupCatalogSheet() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(CFG.SHEET);

  if (!sh) {
    sh = ss.insertSheet(CFG.SHEET);
    sh.getRange(1, 1, 1, 7).setValues([[
      'Завод', 'Толщина и класс', 'Коллекция', 'Артикул', 'Декор', 'Номенклатура', 'Порог'
    ]]);
    sh.getRange(1, 1, 1, 7).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 130);
    sh.setColumnWidth(2, 140);
    sh.setColumnWidth(3, 130);
    sh.setColumnWidth(5, 220);
    sh.setColumnWidth(6, 330);
  }

  ss.toast('Лист «' + CFG.SHEET + '» готов.', 'Готово', 15);
}

// ═══════════════════════════════════════════
//  Меню
// ═══════════════════════════════════════════
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Каталог')
    .addItem('Настройки', 'setupSettingsSheet')
    .addItem('Создать лист каталога', 'setupCatalogSheet')
    .addSeparator()
    .addItem('Обновить сейчас', 'refreshNow')
    .addItem('Проверить данные', 'checkCatalog')
    .addSeparator()
    .addItem('Включить ускорение', 'enableWarmUp')
    .addItem('Выключить ускорение', 'disableWarmUp')
    .addSeparator()
    .addItem('Подобрать названия из 1С', 'matchNamesWith1C')
    .addItem('Ключ Anthropic', 'setClaudeKey')
    .addToUi();
}

function refreshNow() {
  const t0 = Date.now();
  clearCache_();
  buildPage_();
  SpreadsheetApp.getActive().toast(
    'Данные перечитаны за ' + Math.round((Date.now() - t0) / 100) / 10 + ' с', 'Готово', 10);
}

/**
 * Сколько позиций прочиталось, у скольких есть фото и остаток.
 * Из редактора полный отчёт виден в журнале выполнения.
 */
function checkCatalog() {
  clearCache_();
  const o  = opts_();
  const t0 = Date.now();

  const items = buildCatalog_();
  const build = Math.round((Date.now() - t0) / 100) / 10;

  let withPhoto = 0, withStock = 0, low = 0, zero = 0;
  const noPhoto = [], noStock = [];
  const byCat = {}, catOrder = [];

  items.forEach(function (it) {
    if (!(it.k in byCat)) { byCat[it.k] = 0; catOrder.push(it.k); }
    byCat[it.k]++;

    if (it.i) withPhoto++; else noPhoto.push(it.a + ' — ' + it.d);

    if (it.q === null) { noStock.push(it.a + ' — ' + it.d + '  |  ' + it.c); }
    else {
      withStock++;
      if (it.q < o.minStock) zero++;
      else if (it.q < it.w) low++;
    }
  });

  // какие каталожные листы прочитались, а какие пусты
  const empty = [];
  catalogSheets_().forEach(function (sh) {
    const n = sh.getName();
    if (byCat[n] !== undefined) return;
    if (sh.getLastRow() < 2)        empty.push(n + ' — лист пуст');
    else if (!columnsOf_(sh))       empty.push(n + ' — нет колонки «Номенклатура»');
    else if (n !== CFG.SHEET)       empty.push(n + ' — нет строк с номенклатурой');
  });

  const cats = catOrder.map(function (c) { return '  • ' + c + ': ' + byCat[c]; }).join('\n');

  const warn =
    (o.imgFolder ? '' : '\n⚠ Папка с фото не указана — лист «Настройки»') +
    (o.srcId     ? '' : '\n⚠ Таблица остатков не указана — лист «Настройки»') +
    (warmUpStatus_() ? '' : '\n⚠ Ускорение выключено — меню «Включить ускорение»') +
    (empty.length ? '\n⚠ Не попали в каталог:\n  ' + empty.join('\n  ') : '');

  const summary =
    'Показывается позиций: ' + items.length + warn +
    '\n\nПо категориям:\n' + cats +
    (o.hideOut ? '\n(нулевые остатки скрыты)' : '') +
    '\nС фото: ' + withPhoto + ' (без фото: ' + noPhoto.length + ')' +
    '\nС остатком: ' + withStock + ' (не нашлись: ' + noStock.length + ')' +
    '\nМало на складе: ' + low +
    '\n\nПолная сборка заняла: ' + build + ' с';

  console.log(summary);
  if (noStock.length) console.log('\n=== НЕ НАЙДЕНЫ В ОСТАТКАХ (' + noStock.length + ') ===\n' + noStock.join('\n'));
  if (noPhoto.length) console.log('\n=== БЕЗ ФОТО (' + noPhoto.length + ') ===\n' + noPhoto.join('\n'));

  try { SpreadsheetApp.getActive().toast(summary, 'Проверка каталога', 30); } catch (e) {}
  return summary;
}
