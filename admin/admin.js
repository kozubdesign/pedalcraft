'use strict';
const $ = s => document.querySelector(s);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e };
const btn = (text, fn) => el('button', { type: 'button', textContent: text, onclick: fn });

const TABLE = '/rest/v1/pc_catalog', QUERY = TABLE + '?id=eq.1&select=id,data,revision';
const MAX_SIZE = 10 * 1024 * 1024;
const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', pdf: 'application/pdf', zip: 'application/zip', txt: 'text/plain', csv: 'text/csv' };
const CHOICES = {
  c: { od: 'Овердрайвы', ds: 'Дисторшн', fz: 'Фуззы', cp: 'Компрессоры / гейты', md: 'Дилей / ревер / мод', ot: 'Прочее' },
  d: { 1: 'Лёгкая', 2: 'Средняя', 3: 'Сложная' },
};
const GEN = {
  od: ['Блюз', 'Классик-рок', 'Кантри', 'Поп-рок', 'Инди', 'Хард-рок', 'Блюз-рок', 'Саутерн-рок', 'Рок-н-ролл', 'Стоунер'],
  ds: ['Рок', 'Хард-рок', 'Метал', 'Панк', 'Гранж', 'Стоунер', 'Альтернатива', 'Нью-метал', 'Дум-метал', 'Рок-н-ролл'],
  fz: ['Гаражный рок', 'Шугейз', 'Психоделия', 'Стоунер', 'Нойз-рок', 'Хард-рок', 'Гранж', 'Спейс-рок', 'Блюз-рок', 'Дум-метал'],
  cp: ['Кантри', 'Фанк', 'Чистый звук', 'Поп', 'Джаз', 'Соул', 'Фолк', 'Фьюжн', 'Реггей', 'Блюз'],
  md: ['Эмбиент', 'Шугейз', 'Поп', 'Пост-рок', 'Инди', 'Дрим-поп', 'Психоделия', 'Синтвейв', 'Электроника', 'Спейс-рок'],
  ot: ['Блюз', 'Рок', 'Метал', 'Поп', 'Кантри', 'Хард-рок', 'Стоунер', 'Фанк', 'Джаз', 'Инди'],
};
const SHOW_VIDEO = 'showVideo';
// [ключ, подпись, тип]
const SCHEMA = [
  ['n', 'Модель'], ['m', 'Производитель оригинала'], ['sku', 'Артикул'], ['c', 'Категория'], ['d', 'Сложность'],
  ['price', 'Цена, ₽', 'number'], ['st', 'Остаток, шт.', 'number'], ['originalPrice', 'Цена оригинала, ₽ (0 — не показывать)', 'number'], ['pop', 'Приоритет сортировки', 'number'],
  ['active', 'На сайте', 'check'],
  ['summary', 'Краткое описание', 'textarea'], ['description', 'Полное описание', 'textarea'],
  ['features', 'Особенности — по одной в строке', 'textarea'],
  ['video', 'Видео — ссылка (YouTube, Rutube или файл .mp4)'],
];

// Метка на карточке: можно выбрать только одну (хранится в полях hit / nw / top)
const BADGES = [['none', 'Без метки'], ['hit', 'Хит'], ['nw', 'Новинка']];
const TAB_TITLES = { products: 'Товары', stock: 'Склад и цены', faq: 'FAQ витрины' };

let token = sessionStorage.pcToken, row, cat, cur, faq = [], busy = false, dirty = false, tab = 'products';

// ---------- сессия: токен продлевается сам, пока открыта админка ----------
let refreshToken = sessionStorage.pcRefresh, expiresAt = Number(sessionStorage.pcExp) || 0, refreshing = null;
function setSession(s) {
  token = s.access_token; refreshToken = s.refresh_token || refreshToken;
  expiresAt = s.expires_at ? s.expires_at * 1000 : Date.now() + (s.expires_in || 3600) * 1000;
  sessionStorage.pcToken = token; sessionStorage.pcExp = expiresAt;
  if (refreshToken) sessionStorage.pcRefresh = refreshToken;
}
function clearSession() {
  token = refreshToken = undefined; expiresAt = 0;
  for (const k of ['pcToken', 'pcRefresh', 'pcExp']) sessionStorage.removeItem(k);
}
// Одновременные запросы ждут один и тот же обмен токена: refresh-токен одноразовый.
function renewSession() {
  if (!refreshToken) return Promise.reject(Error('Сессия истекла. Войдите снова (несохранённые правки останутся в форме до перезагрузки страницы).'));
  return refreshing ??= pcStore.request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) })
    .then(setSession)
    .catch(() => { throw Error('Сессия истекла. Войдите снова (несохранённые правки останутся в форме до перезагрузки страницы).') })
    .finally(() => { refreshing = null });
}
const api = async (path, opts) => {
  if (refreshToken && expiresAt && expiresAt - Date.now() < 90_000) await renewSession();
  try { return await pcStore.request(path, { token, ...opts }) } catch (err) {
    if (refreshToken && (err.status === 401 || /jwt/i.test(err.message))) { await renewSession(); return pcStore.request(path, { token, ...opts }) }
    throw err;
  }
};
// Обновляем заранее, даже если вы просто редактируете текст и ничего не отправляете.
setInterval(() => { if (token && refreshToken && expiresAt - Date.now() < 5 * 60_000) renewSession().catch(() => {}) }, 60_000);
// Плашка слева внизу: успех пропадает через 4 с, ошибка через 8 с, по клику закрывается сразу
let toastTimer;
const say = (msg, error = false) => {
  const s = $('#status');
  clearTimeout(toastTimer);
  s.textContent = msg; s.dataset.error = error; s.hidden = !msg;
  if (msg) toastTimer = setTimeout(() => { s.hidden = true }, error ? 8000 : 4000);
};
$('#status').onclick = () => { $('#status').hidden = true };

// Блокирует интерфейс на время операции и показывает ошибки.
const run = work => async e => {
  e?.preventDefault();
  if (busy) return;
  const b = e?.submitter || (e?.currentTarget instanceof HTMLButtonElement ? e.currentTarget : null);
  const label = b?.textContent;
  busy = true; $('main').inert = true;
  if (b) { b.classList.add('busy'); b.textContent = b.dataset.busy || 'Сохранение…' }
  try { await work(e) } catch (err) { say(err.message, true) } finally {
    if (b) { b.classList.remove('busy'); b.textContent = label }
    $('main').inert = false; busy = false;
  }
};

// ---------- данные ----------
async function save(data, { keepStock = false } = {}) {
  const res = await api(`${TABLE}?id=eq.1&revision=eq.${row.revision}&select=id,data,revision`,
    { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ data, revision: row.revision + 1 }) });
  if (!res?.length) throw Error('Каталог изменён в другой вкладке. Обновите страницу.');
  row = res[0]; cat = row.data; dirty = false;
  if (!keepStock) renderStock();
}

async function init() {
  try {
    if (await api('/rest/v1/rpc/pc_is_admin', { method: 'POST', body: '{}' }) !== true) throw Error('У этой учётной записи нет прав администратора.');
    [row] = await api(QUERY);
    if (!row) { // первый вход: импорт стартового каталога
      await api(TABLE, { method: 'POST', body: JSON.stringify({ id: 1, data: await pcStore.seed() }) });
      [row] = await api(QUERY);
    }
  } catch (err) { clearSession(); throw err }
  cat = row.data; faq = structuredClone(cat.faq);
  renderList(cat.products[0]?.id); openProduct(cat.products[0]); renderStock(); renderFaq();
  $('#login').hidden = true; $('#panel').hidden = false; say('Данные загружены.');
}

// ---------- вкладки ----------
function showTab(name) {
  tab = name; updateTitle();
  document.querySelectorAll('[data-pane]').forEach(p => p.hidden = p.id !== name);
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
}
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => !busy && showTab(b.dataset.tab));

// ---------- товары ----------
const form = $('#product');
const flags = el('div', { className: 'wide flags' });
for (const [key, title, type] of SCHEMA) {
  const input = CHOICES[key] ? el('select') : type === 'textarea' ? el('textarea') : el('input');
  input.name = key;
  if (CHOICES[key]) for (const [v, t] of Object.entries(CHOICES[key])) input.add(new Option(t, v));
  else if (input.tagName === 'INPUT') input.type = type === 'check' ? 'checkbox' : type || 'text';
  if (type === 'number') Object.assign(input, { min: 0, max: 99999999, step: 1, required: true });
  if (['n', 'm', 'sku'].includes(key)) Object.assign(input, { maxLength: 140, required: true });
  const label = el('label', { className: type === 'textarea' || key === 'video' ? 'wide' : '' }, title, input);
  if (type === 'check') { if (!flags.parentNode) $('#fields').append(flags); flags.append(label) } else $('#fields').append(label);
}
function showToggle(name, text) {
  const input = el('input', { type: 'checkbox', name, checked: true });
  return el('label', { className: 'wide' }, text, input);
}
$('#video-box').append(showToggle(SHOW_VIDEO, 'Показывать блок «Видео» на сайте'), form.elements.video.closest('label'));
flags.after(el('fieldset', { className: 'wide' }, el('legend', { textContent: 'Метка на карточке' }),
  el('div', { className: 'flags' }, ...BADGES.map(([v, t]) => el('label', {}, t, el('input', { type: 'radio', name: 'badge', value: v }))))));
const TOGGLES = [SHOW_VIDEO, 'showReviews', 'showArtists', 'showAlbums', 'showStyles'];
form.addEventListener('input', e => {
  if (e.target.name !== 'active') dirty = true; // «На сайте» сохраняется сразу, правок не оставляет
  if (e.target.name === 'n' || e.target.name === 'm') updateTitle();
});
window.addEventListener('beforeunload', e => { if (dirty) e.preventDefault() });

const nextId = () => Math.max(-1, ...cat.products.map(p => p.id)) + 1;
const label = p => `${p.active ? '' : '[Скрыт] '}${p.m} — ${p.n}`;

const sortKey = p => p.n.toLowerCase().startsWith(p.m.toLowerCase()) ? p.n : p.m + ' ' + p.n;
function renderList(id) {
  const sel = $('#items'), mode = $('#sort').value;
  const list = mode ? [...cat.products].sort((a, b) => (mode === 'az' ? 1 : -1) * sortKey(a).localeCompare(sortKey(b))) : cat.products;
  sel.replaceChildren(...list.map(p => new Option(label(p), p.id)));
  sel.disabled = !cat.products.length;
  if (id != null) sel.value = String(id);
}
function openProduct(p) {
  cur = p && structuredClone(p); form.hidden = !p; dirty = false;
  if (!p) { updateTitle(); return }
  form.elements.badge.value = p.hit ? 'hit' : p.nw ? 'nw' : 'none';
  for (const [k, , t] of SCHEMA) {
    const e = form.elements[k];
    if (t === 'check') e.checked = Boolean(p[k]); else e.value = p[k] ?? '';
  }
  for (const k of Object.keys(LISTS)) cur[k] ??= [];
  cur.stylesOff = Array.isArray(p.stylesOff) ? [...p.stylesOff] : [];
  for (const k of TOGGLES) form.elements[k].checked = p[k] !== false;
  cur.specsList = String(p.specs || '').split('\n').filter(Boolean).map(l => { const i = l.indexOf(':'); return i < 0 ? [l.trim(), ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()] });
  $('#upload-photos').value = $('#upload-docs').value = '';
  renderAssets(); renderLists(); renderSpecs(); renderStyles(); updateTitle();
}
function readForm() {
  const p = structuredClone(cur);
  for (const [k, , t] of SCHEMA) {
    const e = form.elements[k];
    p[k] = t === 'check' ? e.checked : (t === 'number' || k === 'd') ? Number(e.value) : e.value.trim();
  }
  for (const k of TOGGLES) p[k] = form.elements[k].checked;
  const badge = form.elements.badge.value;
  p.hit = badge === 'hit'; p.nw = badge === 'nw'; p.top = false;
  p.stylesOff = (cur.stylesOff || []).filter(n => (GEN[p.c] || []).includes(n));
  p.specs = (cur.specsList || []).filter(r => r[0].trim() || r[1].trim()).map(r => `${r[0].replace(/:/g, '').trim()}: ${r[1].trim()}`).join('\n');
  delete p.specsList;
  return p;
}
function renderStyles() {
  const names = GEN[form.elements.c.value] || [];
  $('#styles').replaceChildren(...names.map(n => {
    const input = el('input', { type: 'checkbox', checked: !cur.stylesOff.includes(n), onchange: e => {
      cur.stylesOff = e.target.checked ? cur.stylesOff.filter(x => x !== n) : [...cur.stylesOff, n]; dirty = true;
    } });
    return el('label', {}, n, input);
  }));
}
form.elements.c.addEventListener('change', () => cur && renderStyles());
$('#sort').onchange = () => renderList(Number($('#items').value));
function renderSpecs() {
  const rows = cur.specsList;
  $('#specs').replaceChildren(...rows.map((r, i) => el('div', { className: 'spec-row' },
    el('input', { value: r[0], placeholder: 'Название', ariaLabel: 'Название', oninput: e => r[0] = e.target.value }),
    el('input', { value: r[1], placeholder: 'Значение', ariaLabel: 'Значение', oninput: e => r[1] = e.target.value }),
    el('button', { type: 'button', textContent: '✕', ariaLabel: 'Убрать характеристику', onclick: () => { rows.splice(i, 1); dirty = true; renderSpecs() } }))));
}
$('#add-spec').onclick = () => { if (!cur) return; cur.specsList.push(['', '']); dirty = true; renderSpecs() };
function renderAssets() {
  for (const kind of ['photos', 'docs']) {
    const list = cur[kind];
    $('#' + kind).replaceChildren(...list.map((v, i) => {
      const href = pcStore.media(kind === 'photos' ? v : v.path);
      const line = el('div', { className: 'row asset' });
      if (kind === 'photos') line.append(el('img', { src: href, alt: 'Фото ' + (i + 1) }));
      else line.append(
        el('input', { value: v.title, ariaLabel: 'Название документа', oninput: e => v.title = e.target.value }),
        el('a', { href, target: '_blank', rel: 'noopener', textContent: 'Открыть' }));
      const up = btn('↑', () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; renderAssets() });
      up.disabled = i === 0;
      line.append(up, btn('Убрать', () => { list.splice(i, 1); renderAssets() }));
      return line;
    }));
  }
}
// ---------- отзывы, исполнители, альбомы ----------
const LISTS = {
  reviews: { show: 'showReviews', title: 'Отзывы', add: 'Добавить отзыв', multi: true, blank: () => ({ name: '', rating: 5, date: new Date().toISOString().slice(0, 10), text: '', photos: [] }),
    fields: [['name', 'Имя'], ['rating', 'Оценка, 1–5', 'number'], ['date', 'Дата', 'date'], ['text', 'Текст отзыва (можно оставить пустым)', 'textarea']] },
  artists: { show: 'showArtists', title: 'Кто играет на оригинале', add: 'Добавить исполнителя', img: 'photo', blank: () => ({ name: '', role: '', band: '', photo: '' }),
    fields: [['name', 'Имя Фамилия'], ['role', 'Роль (солист, гитарист…)'], ['band', 'Группа']] },
  albums: { show: 'showAlbums', title: 'Альбомы, записанные с этой педалью', add: 'Добавить альбом', img: 'cover', blank: () => ({ title: '', band: '', year: '', cover: '' }),
    fields: [['title', 'Название альбома'], ['band', 'Группа'], ['year', 'Год']] },
};
for (const [kind, cfg] of Object.entries(LISTS)) {
  $('#lists').append(el('fieldset', {}, el('legend', { textContent: cfg.title }), showToggle(cfg.show, 'Показывать блок на сайте'), el('div', { id: 'list-' + kind }),
    btn(cfg.add, () => { cur[kind].push(cfg.blank()); dirty = true; renderLists() })));
}
function renderLists() {
  for (const [kind, cfg] of Object.entries(LISTS)) {
    const items = cur[kind];
    $('#list-' + kind).replaceChildren(...items.map((it, i) => {
      const grid = el('div', { className: 'grid' });
      for (const [key, title, type] of cfg.fields) {
        const inp = el(type === 'textarea' ? 'textarea' : 'input');
        if (type !== 'textarea') inp.type = type || 'text';
        if (type === 'number') Object.assign(inp, { min: 1, max: 5, step: 1 });
        inp.value = it[key] ?? '';
        inp.oninput = () => it[key] = type === 'number' ? Number(inp.value) : inp.value;
        grid.append(el('label', { className: type === 'textarea' ? 'wide' : '' }, title, inp));
      }
      const box = el('div', { className: 'item' });
      if (cfg.multi) {
        if (!it.photos) { it.photos = it.photo ? [it.photo] : []; delete it.photo }
        const file = el('input', { type: 'file', multiple: true, accept: 'image/jpeg,image/png,image/webp,image/avif', ariaLabel: 'Фото к отзыву', disabled: it.photos.length >= 4 });
        file.onchange = () => {
          const room = Math.max(0, 4 - it.photos.length);
          it._fs = [...file.files].slice(0, room); dirty = true;
          if (file.files.length > room) say('В отзыве не больше 4 фото, лишние не добавлены.', true);
        };
        grid.append(el('label', { className: 'wide' }, `Фото (до 4, сейчас ${it.photos.length})`, file));
        if (it.photos.length) box.append(el('div', { className: 'row asset' }, ...it.photos.map((path, n) => el('span', { className: 'thumb' },
          el('img', { src: pcStore.media(path), alt: '' }),
          el('button', { type: 'button', textContent: '✕', ariaLabel: 'Убрать фото', onclick: () => { it.photos.splice(n, 1); dirty = true; renderLists() } })))));
      }
      const up = btn('Выше', () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; renderLists() });
      up.disabled = i === 0;
      const actions = el('div', { className: 'row' }, up, btn('Удалить', () => { items.splice(i, 1); dirty = true; renderLists() }));
      if (cfg.img) {
        // Фото слева, поля справа
        const file = el('input', { type: 'file', className: 'sr', accept: 'image/jpeg,image/png,image/webp,image/avif', ariaLabel: 'Фото' });
        const fname = el('small', { className: 'fname' });
        file.onchange = () => { it._f = file.files[0]; dirty = true; fname.textContent = it._f ? it._f.name : '' };
        const url = pcStore.media(it[cfg.img]);
        box.classList.add('media');
        box.append(
          el('div', { className: 'pic' },
            url ? el('img', { src: url, alt: '' }) : el('span', { className: 'ph', textContent: 'Нет фото' }),
            el('label', { className: 'pickbtn' }, url ? 'Заменить фото' : 'Загрузить фото', file), fname),
          el('div', { className: 'mbody' }, grid, actions));
        return box;
      }
      box.append(grid, actions);
      return box;
    }));
  }
}

function checkFile(file, kind) {
  const type = TYPES[file.name.split('.').pop().toLowerCase()];
  if (!type || (kind === 'photos') !== type.startsWith('image/') || file.size < 1 || file.size > MAX_SIZE)
    throw Error(`Неподходящий формат или размер больше 10 МБ: ${file.name}`);
  return type;
}
async function upload(file, id, kind) {
  const type = checkFile(file, kind);
  const path = `${id}/${crypto.randomUUID()}.${file.name.split('.').pop().toLowerCase()}`;
  await api('/storage/v1/object/pedalcraft-media/' + path, { method: 'POST', headers: { 'Content-Type': type }, body: file });
  return path;
}

$('#items').onchange = () => !busy && openProduct(cat.products.find(p => p.id === Number($('#items').value)));
$('#new').onclick = () => {
  if (busy) return;
  const id = nextId();
  $('#items').selectedIndex = -1;
  openProduct({ id, sku: String(id + 1).padStart(6, '0'), c: 'od', d: 1, price: 490, st: 0, pop: 0, originalPrice: 0, active: false, photos: [], docs: [], reviews: [], artists: [], albums: [], video: '' });
  dirty = true; say('Новый товар скрыт с витрины, пока не отметите «На сайте» и не нажмёте «Сохранить товар».');
};
$('#copy').onclick = () => {
  if (busy || !cur) return;
  const id = nextId();
  openProduct({ ...readForm(), id, sku: String(id + 1).padStart(6, '0'), n: cur.n + ' (копия)', active: false, photos: [], docs: [], reviews: [], artists: [], albums: [], video: '' });
  $('#items').selectedIndex = -1; dirty = true; say('Копия создана. Измените название и сохраните.');
};
$('#del').onclick = run(async () => {
  const p = cat.products.find(x => x.id === Number($('#items').value));
  if (!p || !confirm(`Удалить «${label(p)}» безвозвратно? Чтобы просто скрыть товар, снимите «На сайте».`)) return;
  await save({ ...cat, products: cat.products.filter(x => x.id !== p.id) });
  renderList(cat.products[0]?.id); openProduct(cat.products[0]); say('Товар удалён.');
});
form.onsubmit = run(async () => {
  const p = readForm();
  if (!p.n || !p.m || !p.sku) throw Error('Заполните модель, производителя и артикул.');
  if (cat.products.some(x => x.id !== p.id && x.sku === p.sku)) throw Error('Такой артикул уже используется.');
  if (p.docs.some(d => !d.title.trim())) throw Error('Укажите названия документов.');
  if (p.video && !/^https?:\/\//i.test(p.video)) throw Error('Ссылка на видео должна начинаться с https://');
  if (p.reviews.some(r => !r.name.trim())) throw Error('В отзывах укажите имя.');
  if (p.artists.some(a => !a.name.trim())) throw Error('Укажите имя исполнителя.');
  if (p.albums.some(a => !a.title.trim())) throw Error('Укажите название альбома.');
  p.reviews.forEach(r => r.rating = Math.min(5, Math.max(1, Math.round(r.rating) || 5)));
  const itemFiles = ['artists', 'albums'].flatMap(k => p[k].filter(x => x._f).map(x => ({ x, key: LISTS[k].img })));
  if (p.reviews.some(x => (x.photos || []).length + (x._fs || []).length > 4)) throw Error('В отзыве не больше 4 фото.');
  const reviewFiles = p.reviews.flatMap(x => (x._fs || []).map(f => ({ x, f })));
  [...itemFiles.map(({ x }) => x._f), ...reviewFiles.map(({ f }) => f)].forEach(f => checkFile(f, 'photos'));
  const pending = ['photos', 'docs'].flatMap(k => [...$('#upload-' + k).files].map(file => ({ k, file })));
  pending.forEach(({ k, file }) => checkFile(file, k));
  const [latest] = await api(TABLE + '?id=eq.1&select=revision'); // не грузим файлы, если каталог уже устарел
  if (latest?.revision !== row.revision) throw Error('Каталог изменился в другой вкладке. Обновите страницу.');
  for (const { k, file } of pending) {
    say('Загрузка: ' + file.name);
    const path = await upload(file, p.id, k);
    p[k].push(k === 'photos' ? path : { path, title: file.name });
  }
  for (const { x, key } of itemFiles) { say('Загрузка: ' + x._f.name); x[key] = await upload(x._f, p.id, 'photos') }
  for (const { x, f } of reviewFiles) { say('Загрузка: ' + f.name); (x.photos ??= []).push(await upload(f, p.id, 'photos')) }
  p.reviews.forEach(x => delete x._fs);
  for (const k of ['artists', 'albums']) p[k].forEach(x => delete x._f);
  const products = cat.products.some(x => x.id === p.id) ? cat.products.map(x => x.id === p.id ? p : x) : [...cat.products, p];
  await save({ ...cat, products });
  renderList(p.id); openProduct(p);
  say(p.active ? 'Сохранено и опубликовано.' : 'Сохранено, на витрине скрыто.');
});

// ---------- шапка с названием товара ----------
function updateTitle() {
  const t = $('#ptitle');
  if (tab !== 'products') { t.textContent = TAB_TITLES[tab] || ''; return }
  if (!cur) { t.textContent = TAB_TITLES.products; return }
  const m = form.elements.m.value.trim(), n = form.elements.n.value.trim();
  t.textContent = (n.toLowerCase().startsWith(m.toLowerCase()) ? n : `${m} ${n}`).trim() || 'Новый товар';
}

// ---------- «На сайте»: сохраняется сразу ----------
function syncActive(id, value) {
  if (cur && cur.id === id) form.elements.active.checked = value;
  const r = document.querySelector(`#rows input[data-k="active"][data-id="${id}"]`);
  if (r) r.checked = value;
}
// Пишем в каталог только флаг «На сайте»; несохранённые правки в форме и в таблице склада остаются как были.
const toggleActive = (id, input) => run(async () => {
  const want = input.checked, p = cat.products.find(x => x.id === id);
  if (!p) { say('Товар ещё не сохранён. Нажмите «Сохранить товар», чтобы опубликовать.'); return }
  const wasDirty = dirty;
  try {
    await save({ ...cat, products: cat.products.map(x => x.id === id ? { ...x, active: want } : x) }, { keepStock: true });
  } catch (err) { syncActive(id, !want); throw err }
  dirty = wasDirty;
  syncActive(id, want);
  renderList($('#items').selectedIndex < 0 ? cur?.id : Number($('#items').value));
  say(`«${p.m} — ${p.n}»: ${want ? 'показан на сайте' : 'скрыт с сайта'}.`);
});
form.elements.active.addEventListener('change', e => cur && toggleActive(cur.id, e.target)(e));

// ---------- текстовые поля растут вместе с текстом (минимум 200 px) ----------
const fit = t => { if (!t.offsetParent) return; t.style.height = 'auto'; t.style.height = Math.max(200, t.scrollHeight + 2) + 'px' };
let fitQueued = false;
const fitAll = () => { if (fitQueued) return; fitQueued = true; requestAnimationFrame(() => { fitQueued = false; document.querySelectorAll('textarea').forEach(fit) }) };
document.addEventListener('input', e => { if (e.target instanceof HTMLTextAreaElement) fit(e.target) });
new MutationObserver(fitAll).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
addEventListener('resize', fitAll);

// ---------- склад ----------
function renderStock() {
  const cell = (p, k) => {
    const i = el('input', { type: k === 'active' ? 'checkbox' : 'number', min: 0 });
    i.dataset.id = p.id; i.dataset.k = k;
    if (k === 'active') i.onchange = e => toggleActive(p.id, i)(e);
    k === 'active' ? i.checked = p.active : i.value = p[k];
    return el('td', {}, i);
  };
  $('#rows').replaceChildren(...cat.products.map(p => el('tr', {}, el('td', { textContent: `${p.m} — ${p.n}` }), cell(p, 'price'), cell(p, 'st'), cell(p, 'active'))));
}
$('#stock-form').onsubmit = run(async () => {
  const products = cat.products.map(p => ({ ...p }));
  document.querySelectorAll('#rows input').forEach(i => {
    const p = products.find(x => x.id === Number(i.dataset.id)), k = i.dataset.k;
    p[k] = k === 'active' ? i.checked : Math.max(0, Math.round(Number(i.value)) || 0);
  });
  await save({ ...cat, products });
  renderList(Number($('#items').value)); say('Склад и цены сохранены.');
});

// ---------- FAQ ----------
function renderFaq() {
  $('#questions').replaceChildren(...faq.map((qa, i) => {
    const q = el('input', { value: qa[0], required: true, oninput: e => qa[0] = e.target.value });
    const a = el('textarea', { value: qa[1], required: true, oninput: e => qa[1] = e.target.value });
    const up = btn('Выше', () => { [faq[i - 1], faq[i]] = [faq[i], faq[i - 1]]; renderFaq() });
    up.disabled = i === 0;
    return el('fieldset', {}, el('label', {}, 'Вопрос', q), el('label', {}, 'Ответ', a), up, btn('Удалить', () => { faq.splice(i, 1); renderFaq() }));
  }));
}
$('#new-question').onclick = () => { faq.push(['', '']); renderFaq() };
$('#faq-form').onsubmit = run(async () => {
  const clean = faq.map(qa => qa.map(x => x.trim()));
  if (clean.some(qa => !qa[0] || !qa[1])) throw Error('Заполните все вопросы и ответы.');
  await save({ ...cat, faq: clean }); say('FAQ опубликован.');
});

// ---------- вход ----------
$('#login').onsubmit = run(async e => {
  if (!pcStore.configured) throw Error('Сначала подключите Supabase (см. README).');
  const data = new FormData(e.target);
  say('Вход…');
  const session = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: data.get('email'), password: data.get('password') }) });
  e.target.reset(); setSession(session); // живёт до закрытия вкладки, токен продлевается сам
  await init();
});
$('#logout').onclick = run(async () => {
  try { await api('/auth/v1/logout?scope=local', { method: 'POST' }) } finally { clearSession(); location.reload() }
});

showTab('products');
if (!pcStore.configured) say('Подключите Supabase по README. Пока витрина показывает catalog.json.');
else if (token) run(init)().then(() => { if (!cat) say('Сессия истекла, войдите снова.') });
