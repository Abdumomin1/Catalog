/**
 * ДИАГНОСТИКА ФОТОГРАФИЙ.
 *
 * Отдельный файл, ничего в «Code» править не нужно.
 * Запускать из редактора: выбрать diagnosePhotos → Run → смотреть Execution log.
 */
function diagnosePhotos() {
  const folderId = imgFolderId_();
  if (!folderId) {
    console.log('Папка не подключена. Меню «Каталог → Папка с фото».');
    return;
  }
  console.log('Папка: ' + folderId);

  // ── что вообще лежит в папке ──
  const files = [];
  collectFiles_(DriveApp.getFolderById(folderId), files, 0, '');

  console.log('Файлов найдено в папке и подпапках: ' + files.length);

  if (!files.length) {
    console.log('Ни одного файла. Проверь ID папки и что фотографии лежат внутри неё.');
    return;
  }

  const folders = {};
  files.forEach(function (f) { folders[f.path || '(корень)'] = (folders[f.path || '(корень)'] || 0) + 1; });

  console.log('\n=== ПО ПАПКАМ ===');
  Object.keys(folders).sort().forEach(function (p) { console.log('  ' + folders[p] + '\t' + p); });

  console.log('\n=== ПЕРВЫЕ 10 ИМЁН ФАЙЛОВ ===');
  files.slice(0, 10).forEach(function (f) { console.log('  ' + f.base); });

  // ── сверка с таблицей ──
  const keys = files.map(function (f) { return { key: norm_(f.base), base: f.base }; });

  // номенклатура собирается со всех каталожных листов
  const noms = [];
  catalogSheets_().forEach(function (sh) {
    if (sh.getLastRow() < 2) return;
    const cols = columnsOf_(sh);
    if (!cols) return;
    sh.getRange(2, cols.nom + 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
      const v = String(r[0]).trim();
      if (v) noms.push(v);
    });
  });

  const exact = {};
  keys.forEach(function (k) { exact[k.key] = true; });

  const missing = noms.filter(function (n) { return !exact[norm_(n)]; });
  console.log('\nПозиций в таблице: ' + noms.length + ', совпало по имени файла: ' +
              (noms.length - missing.length) + ', не совпало: ' + missing.length);

  console.log('\n=== НОМЕНКЛАТУРА ↔ БЛИЖАЙШИЙ ФАЙЛ ===');
  missing.slice(0, 12).forEach(function (nom) {
    const best = closestFile_(nom, keys);
    console.log('\nтаблица: ' + nom);
    console.log('файл   : ' + (best ? best.base : '— похожего не нашлось —'));
  });

  if (missing.length > 12) console.log('\n…и ещё ' + (missing.length - 12) + ' позиций');
}

function collectFiles_(folder, out, depth, path) {
  if (depth > 4) return;

  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    out.push({ base: f.getName().replace(/\.[^.]+$/, ''), path: path });
  }

  const subs = folder.getFolders();
  while (subs.hasNext()) {
    const s = subs.next();
    collectFiles_(s, out, depth + 1, path + s.getName() + '/');
  }
}

/** Файл с наибольшим числом общих слов — чтобы увидеть, чем имена расходятся. */
function closestFile_(nom, keys) {
  const want = norm_(nom).split(' ').filter(function (w) { return w.length > 2; });
  let best = null, bestScore = 0;

  keys.forEach(function (k) {
    const have = k.key.split(' ');
    let score = 0;
    want.forEach(function (w) { if (have.indexOf(w) >= 0) score++; });
    if (score > bestScore) { bestScore = score; best = k; }
  });

  return bestScore >= 2 ? best : null;
}
