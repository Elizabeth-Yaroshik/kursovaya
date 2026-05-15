const API_BASE = (() => {
  const host = window.location.hostname || '127.0.0.1';
  return `http://${host}:5000`;
})();
/** @type {fabric.Canvas | null} */
let appCanvas = null;

/** ID проекта, загруженного с сервера (для «Обновить проект»). */
let currentProjectId = null;

let yarnsCache = [];
let samplesCache = [];
let authToken = localStorage.getItem('token') || '';
let currentUser = null;

function authHeaders(extra = {}) {
  return authToken ? { Authorization: `Bearer ${authToken}`, ...extra } : { ...extra };
}


/** 1 пиксель на холсте ≈ 0,1 см при задании размеров детали */
const CM_PER_PX = 0.1;
const PX_PER_CM = 10;

function pxToCm(px) {
  return Number(px) * CM_PER_PX;
}

function cmToPx(cm) {
  return Number(cm) * PX_PER_CM;
}

function showLoading() {
  const el = document.getElementById('loading-overlay');
  if (el) el.hidden = false;
}

function hideLoading() {
  const el = document.getElementById('loading-overlay');
  if (el) el.hidden = true;
}

function showUserError(msg) {
  const el = document.getElementById('error-message');
  if (!el) {
    alert(msg);
    return;
  }
  el.textContent = msg;
  el.hidden = false;
  window.clearTimeout(showUserError._t);
  showUserError._t = window.setTimeout(() => {
    el.hidden = true;
  }, 8000);
}

async function apiGet(path) {
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
    const text = await res.text();
    let data = null;
    if (text.length === 0) {
      data = null;
    } else {
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        console.error('[apiGet] JSON parse error', path, parseErr, text);
        data = { error: text || 'Invalid JSON' };
      }
    }
    if (!res.ok) {
      const msg =
        (data && typeof data === 'object' && (data.error || data.message)) || text || res.statusText;
      throw new Error(msg);
    }
    return data;
  } catch (e) {
    console.error('[apiGet]', path, e);
    throw e;
  }
}

async function apiFetchJson(path, options = {}) {
 let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(options.headers || {}),
    },
  });
  } catch (err) {
    throw new Error('Не удалось подключиться к серверу. Убедитесь, что backend запущен на порту 5000.');
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || text || res.statusText;
    throw new Error(msg);
  }
  return data;
}

async function apiPostMultipart(path, formData) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    body: formData,
    headers: authHeaders(),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || text || res.statusText;
    throw new Error(msg);
  }
  return data;
}

async function loadLibraryList(opts = {}) {
  const skipOverlay = Boolean(opts.skipOverlay);
  const ul = document.getElementById('library-list');
  const empty = document.getElementById('library-list-empty');
  if (!ul || !empty) return;

  if (!skipOverlay) showLoading();
  try {
    const items = await apiGet('/api/library/list');
    if (!Array.isArray(items) || items.length === 0) {
      ul.hidden = true;
      ul.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    ul.hidden = false;
    ul.innerHTML = '';
    items.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'library-list-item';

      const nameBtn = document.createElement('button');
      nameBtn.type = 'button';
      nameBtn.className = 'library-name-btn';
      nameBtn.textContent = item.name;
      nameBtn.addEventListener('click', () => {
        openLibraryPdfModal(`${API_BASE}${item.file_url}`, item.name);
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'library-del-btn';
      del.textContent = 'Удалить';
      del.addEventListener('click', async () => {
        if (!confirm('Удалить этот файл из библиотеки?')) return;
        showLoading();
        try {
          await apiFetchJson(`/api/library/${item.id}`, { method: 'DELETE' });
          await loadLibraryList({ skipOverlay: true });
        } catch (err) {
          showUserError(err.message);
        } finally {
          hideLoading();
        }
      });

      li.appendChild(nameBtn);
      li.appendChild(del);
      ul.appendChild(li);
    });
  } catch (e) {
    console.error('[loadLibraryList]', e);
    showUserError(`Библиотека PDF: ${e.message}`);
  } finally {
    if (!skipOverlay) hideLoading();
  }
}

function openLibraryPdfModal(url, title) {
  const dialog = document.getElementById('dialog-library-pdf');
  const frame = document.getElementById('library-pdf-frame');
  const cap = document.getElementById('library-pdf-title');
  if (!dialog || !frame) return;
  if (cap) cap.textContent = title || 'PDF';
  frame.src = url;
  dialog.showModal();
}

function closeLibraryPdfModal() {
  const dialog = document.getElementById('dialog-library-pdf');
  const frame = document.getElementById('library-pdf-frame');
  if (frame) frame.src = 'about:blank';
  if (dialog && dialog.open) dialog.close();
}

/** Сериализация выкройки с полем customData у объектов (нужно для API). */
function patternToJSON() {
  if (!appCanvas) return {};
  return appCanvas.toJSON(['customData']);
}

function getSelectedDetailObject() {
  if (!appCanvas) return null;
  const o = appCanvas.getActiveObject();
  if (!o) return null;
  if (o.type === 'activeSelection') return null;
  return o;
}

function readCustomData(obj) {
  const cd = typeof obj.get === 'function' ? obj.get('customData') : obj.customData;
  return cd && typeof cd === 'object' ? { ...cd } : {};
}

function parseOptionalFloatFromInput(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const v = el.value;
  if (v === '' || v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function trapezoidPointsCmToPx(topCm, bottomCm, heightCm) {
  const Wt = cmToPx(topCm);
  const Wb = cmToPx(bottomCm);
  const H = cmToPx(heightCm);
  const cx = Wt / 2;
  return [
    { x: 0, y: 0 },
    { x: Wt, y: 0 },
    { x: cx + Wb / 2, y: H },
    { x: cx - Wb / 2, y: H },
  ];
}

function inferShapeType(obj, cd) {
  if (cd && cd.shapeType === 'ellipse') return 'ellipse';
  if (cd && cd.shapeType === 'circle') return 'circle';
  if (cd && cd.shapeType) return cd.shapeType;
  const t = obj.type;
  if (t === 'ellipse') {
    const rx = (obj.rx || 0) * (obj.scaleX || 1);
    const ry = (obj.ry || 0) * (obj.scaleY || 1);
    if (Math.abs(rx - ry) < 1e-2) return 'circle';
    return 'ellipse';
  }
  if (t === 'triangle') return 'triangle';
  if (t === 'polygon') return 'trapezoid';
  return 'rectangle';
}

/** Обновляет размеры фигуры на холсте из customData (см → пиксели). */
function applyGeometryToObject(obj, cd) {
  const st = cd.shapeType || 'rectangle';

  if (st === 'trapezoid') {
    const wt = Number(cd.width_top_cm);
    const wb = Number(cd.width_bottom_cm);
    const h = Number(cd.height_cm);
    if (![wt, wb, h].every((n) => Number.isFinite(n) && n > 0)) return;
    const pts = trapezoidPointsCmToPx(wt, wb, h);
    obj.set({ points: pts });
    if (typeof obj.setCoords === 'function') obj.setCoords();
    return;
  }

  const w = Number(cd.width_cm);
  const h = Number(cd.height_cm);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;

  if (st === 'circle' || st === 'ellipse') {
    obj.set({ rx: cmToPx(w) / 2, ry: cmToPx(h) / 2 });
    if (typeof obj.setCoords === 'function') obj.setCoords();
    return;
  }
  if (st === 'triangle') {
    obj.set({ width: cmToPx(w), height: cmToPx(h) });
    if (typeof obj.setCoords === 'function') obj.setCoords();
    return;
  }
  obj.set({ width: cmToPx(w), height: cmToPx(h) });
  if (typeof obj.setCoords === 'function') obj.setCoords();
}

function stripLegacyGaugeFromCustomData(cd) {
  const o = { ...cd };
  delete o.stitches_per_10cm;
  delete o.rows_per_10cm;
  delete o.stitches;
  delete o.rows;
  return o;
}

function getGaugeFromSelectedSample() {
  const sid = document.getElementById('select-sample')?.value;
  if (!sid) return null;
  const s = samplesCache.find((row) => String(row.id) === sid);
  if (!s || !s.width_cm || !s.height_cm) return null;
  const w = Number(s.width_cm);
  const h = Number(s.height_cm);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return {
    stitches_per_10cm: s.stitches / (w / 10),
    rows_per_10cm: s.rows / (h / 10),
  };
}

function getSampleById(sampleId) {
  if (sampleId == null || sampleId === '') return null;
  return samplesCache.find((row) => String(row.id) === String(sampleId)) || null;
}

function getYarnById(yarnId) {
  if (yarnId == null || yarnId === '') return null;
  return yarnsCache.find((row) => String(row.id) === String(yarnId)) || null;
}

function getGaugeFromCustomData(cd) {
  const sample = getSampleById(cd?.sample_id);
  if (!sample || !sample.width_cm || !sample.height_cm) return null;
  const w = Number(sample.width_cm);
  const h = Number(sample.height_cm);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return {
    stitches_per_10cm: sample.stitches / (w / 10),
    rows_per_10cm: sample.rows / (h / 10),
  };
}

function gaugeWidthCm(cd, shapeType) {
  const st = shapeType || cd.shapeType || 'rectangle';
  if (st === 'trapezoid') {
    const wt = Number(cd.width_top_cm);
    const wb = Number(cd.width_bottom_cm);
    if (Number.isFinite(wt) && Number.isFinite(wb)) return (wt + wb) / 2;
    return NaN;
  }
  return Number(cd.width_cm);
}

function computeStitchesRowsFromCustomData(cd, shapeType) {
  const gauge = getGaugeFromCustomData(cd) || getGaugeFromSelectedSample();
  if (!gauge) {
    return {
      text: 'Выберите образец для детали, чтобы показать расчёт петель и рядов.',
    };
  }
  const st = shapeType || cd.shapeType || 'rectangle';
  const gw = gaugeWidthCm(cd, st);
  const h = Number(cd.height_cm);
  const sp10 = gauge.stitches_per_10cm;
  const rp10 = gauge.rows_per_10cm;
  if ([gw, h, sp10, rp10].every((n) => Number.isFinite(n) && n >= 0)) {
    const stitches = Math.round((gw / 10) * sp10);
    const rows = Math.round((h / 10) * rp10);
    return {
      stitches,
      rows,
      text: `Петли (по ширине): ≈ ${stitches}, ряды (по высоте): ≈ ${rows} (по образцу)`,
    };
  }
  return {
    text: 'Укажите размеры детали в сантиметрах.',
  };
}

function readTrapezoidCmFromPolygon(obj) {
  const pts = obj.points;
  if (!pts || pts.length < 4) return null;
  const sx = obj.scaleX || 1;
  const sy = obj.scaleY || 1;
  const topPx = Math.hypot((pts[1].x - pts[0].x) * sx, (pts[1].y - pts[0].y) * sy);
  const botPx = Math.hypot((pts[2].x - pts[3].x) * sx, (pts[2].y - pts[3].y) * sy);
  const yTop = ((pts[0].y + pts[1].y) / 2) * sy;
  const yBot = ((pts[2].y + pts[3].y) / 2) * sy;
  const hPx = Math.abs(yBot - yTop);
  return {
    width_top_cm: pxToCm(topPx),
    width_bottom_cm: pxToCm(botPx),
    height_cm: pxToCm(hPx),
  };
}

function syncCustomDataFromFabricDimensions(obj) {
  if (!obj || obj.type === 'activeSelection') return;

  const base = stripLegacyGaugeFromCustomData(readCustomData(obj));
  let cd = { ...base };
  const shapeType0 = inferShapeType(obj, cd);
  let shapeType = shapeType0;

  if (obj.type === 'ellipse') {
    const sx = obj.scaleX || 1;
    const sy = obj.scaleY || 1;
    const dx = (obj.rx || 0) * sx * 2;
    const dy = (obj.ry || 0) * sy * 2;
    cd.width_cm = pxToCm(dx);
    cd.height_cm = pxToCm(dy);
    if (Math.abs(dx - dy) > 1e-2) {
      shapeType = 'ellipse';
    } else {
      shapeType = 'circle';
    }
    cd.shapeType = shapeType;
    obj.set('customData', cd);
    return;
  }

  if (obj.type === 'polygon' && shapeType === 'trapezoid') {
    const m = readTrapezoidCmFromPolygon(obj);
    if (m) {
      Object.assign(cd, m);
      cd.shapeType = 'trapezoid';
      obj.set('customData', cd);
    }
    return;
  }

  if (obj.type === 'triangle' || obj.type === 'rect') {
    const wpx = obj.getScaledWidth();
    const hpx = obj.getScaledHeight();
    cd.width_cm = pxToCm(wpx);
    cd.height_cm = pxToCm(hpx);
    cd.shapeType = obj.type === 'triangle' ? 'triangle' : 'rectangle';
    obj.set('customData', cd);
  }
}

function applyScalingLocksToObject(obj) {
  if (!obj || !obj.type) return;
  const cd = readCustomData(obj);
  const st = inferShapeType(obj, cd);

  if (obj.type === 'rect' || (obj.type === 'polygon' && st === 'trapezoid')) {
    obj.set({
      uniformScaling: false,
      lockScalingFlip: false,
      lockScalingX: false,
      lockScalingY: false,
    });
    return;
  }

  if (obj.type === 'triangle') {
    obj.set({
      uniformScaling: true,
      lockScalingFlip: true,
    });
    return;
  }

  if (obj.type === 'ellipse') {
    const rx = obj.rx || 0;
    const ry = obj.ry || 0;
    const circleLike = st === 'circle' || Math.abs(rx - ry) < 1e-6;
    if (circleLike) {
      obj.set({
        uniformScaling: true,
        lockScalingFlip: true,
      });
    } else {
      obj.set({
        uniformScaling: false,
        lockScalingFlip: true,
        lockScalingX: false,
        lockScalingY: false,
      });
    }
  }
}

function applyScalingLocksToAllCanvasObjects() {
  if (!appCanvas) return;
  appCanvas.getObjects().forEach((o) => applyScalingLocksToObject(o));
}

let detailPanelMute = false;

function syncDetailPanelFromSelection() {
  if (!appCanvas) return;
  const obj = getSelectedDetailObject();
  const hint = document.getElementById('detail-hint');
  const fields = document.getElementById('detail-fields');
  const derived = document.getElementById('detail-derived-text');
  const widthRow = document.getElementById('detail-field-width-row');
  const trapFields = document.getElementById('detail-trapezoid-fields');
  const fillInput = document.getElementById('detail-fill-color');
  const detailSampleSelect = document.getElementById('detail-sample-id');
  const detailYarnSelect = document.getElementById('detail-yarn-id');
  if (!hint || !fields || !derived) return;

  const multi = appCanvas.getActiveObject()?.type === 'activeSelection';

  if (!obj) {
    hint.hidden = false;
    hint.textContent = multi
      ? 'Выберите одну деталь (сейчас выбрано несколько фигур).'
      : 'Выберите одну фигуру на холсте.';
    fields.hidden = true;
    derived.textContent = '';
    if (fillInput) fillInput.disabled = true;
    if (detailSampleSelect) detailSampleSelect.disabled = true;
    if (detailYarnSelect) detailYarnSelect.disabled = true;
    return;
  }

  hint.hidden = true;
  fields.hidden = false;

  detailPanelMute = true;
  const cd = stripLegacyGaugeFromCustomData(readCustomData(obj));
  const shapeType = inferShapeType(obj, cd);

  if (widthRow && trapFields) {
    if (shapeType === 'trapezoid') {
      widthRow.style.display = 'none';     
      trapFields.style.display = 'block';
      document.getElementById('detail-width-cm').value = '';
      document.getElementById('detail-width-top-cm').value =
        cd.width_top_cm != null && Number.isFinite(Number(cd.width_top_cm)) ? String(cd.width_top_cm) : '';
      document.getElementById('detail-width-bottom-cm').value =
        cd.width_bottom_cm != null && Number.isFinite(Number(cd.width_bottom_cm))
          ? String(cd.width_bottom_cm)
          : '';
    } else {
      widthRow.style.display = '';
      trapFields.style.display = 'none';
      document.getElementById('detail-width-cm').value =
        cd.width_cm != null && Number.isFinite(Number(cd.width_cm)) ? String(cd.width_cm) : '';
      document.getElementById('detail-width-top-cm').value = '';
      document.getElementById('detail-width-bottom-cm').value = '';
    }
  }

  document.getElementById('detail-height-cm').value =
    cd.height_cm != null && Number.isFinite(Number(cd.height_cm)) ? String(cd.height_cm) : '';
  detailPanelMute = false;
  if (fillInput) {
    fillInput.disabled = false;
    const fill = typeof obj.fill === 'string' ? obj.fill : '#6495ed';
    fillInput.value = /^#[0-9a-fA-F]{6}$/.test(fill) ? fill : '#6495ed';
  }
  if (detailSampleSelect) {
    detailSampleSelect.disabled = false;
    detailSampleSelect.value = cd.sample_id != null ? String(cd.sample_id) : '';
  }
  if (detailYarnSelect) {
    detailYarnSelect.disabled = false;
    detailYarnSelect.value = cd.yarn_id != null ? String(cd.yarn_id) : '';
  }

  derived.textContent = computeStitchesRowsFromCustomData(cd, shapeType).text;
}

function calcAreaFromObject(obj) {
  const cd = readCustomData(obj);
  const st = inferShapeType(obj, cd);
  const widthCm = Number(cd.width_cm) || pxToCm((obj.width || 0) * (obj.scaleX || 1));
  const heightCm = Number(cd.height_cm) || pxToCm((obj.height || 0) * (obj.scaleY || 1));
  if (st === 'trapezoid') {
    const wt = Number(cd.width_top_cm);
    const wb = Number(cd.width_bottom_cm);
    const h = Number(cd.height_cm) || heightCm;
    if ([wt, wb, h].every((n) => Number.isFinite(n) && n > 0)) return ((wt + wb) / 2) * h;
    return 0;
  }
  if (st === 'circle') {
    const r = widthCm / 2;
    return Math.PI * r * r;
  }
  if (st === 'ellipse') return Math.PI * (widthCm / 2) * (heightCm / 2);
  if (st === 'triangle') return (widthCm * heightCm) / 2;
  return widthCm * heightCm;
}

function updateTotalArea() {
  if (!appCanvas) return;
  const out = document.getElementById('total-area-value');
  if (!out) return;
  const total = appCanvas.getObjects().reduce((sum, obj) => sum + calcAreaFromObject(obj), 0);
  out.textContent = `${total.toFixed(1)} см²`;
}

function duplicateObject(original) {
  if (!original) return null;
  const payload = original.toObject(['customData']);
  const type = original.type;
  let copy = null;
  if (type === 'rect') copy = new fabric.Rect(payload);
  else if (type === 'ellipse') copy = new fabric.Ellipse(payload);
  else if (type === 'triangle') copy = new fabric.Triangle(payload);
  else if (type === 'polygon') copy = new fabric.Polygon(payload.points || [], payload);
  if (!copy) return null;
  copy.set({ left: (original.left || 0) + 20, top: (original.top || 0) + 20 });
  copy.set('customData', fabric.util.object.clone(readCustomData(original)));
  applyScalingLocksToObject(copy);
  return copy;
}

function applyDetailFieldsToSelection() {
  if (detailPanelMute || !appCanvas) return;
  const obj = getSelectedDetailObject();
  if (!obj) return;

  const prev = stripLegacyGaugeFromCustomData(readCustomData(obj));
  const shapeType = inferShapeType(obj, prev);

  const cd = {
    ...prev,
    shapeType,
  };
  const detailSampleSelect = document.getElementById('detail-sample-id');
  const detailYarnSelect = document.getElementById('detail-yarn-id');
  cd.sample_id = detailSampleSelect && detailSampleSelect.value ? parseInt(detailSampleSelect.value, 10) : null;
  cd.yarn_id = detailYarnSelect && detailYarnSelect.value ? parseInt(detailYarnSelect.value, 10) : null;

  if (shapeType === 'trapezoid') {
     cd.width_top_cm = prev.width_top_cm ?? parseOptionalFloatFromInput('detail-width-top-cm');
    cd.width_bottom_cm = prev.width_bottom_cm ?? parseOptionalFloatFromInput('detail-width-bottom-cm');
    cd.height_cm = prev.height_cm ?? parseOptionalFloatFromInput('detail-height-cm');
    delete cd.width_cm;
  } else {
     cd.width_cm = prev.width_cm ?? parseOptionalFloatFromInput('detail-width-cm');
    cd.height_cm = prev.height_cm ?? parseOptionalFloatFromInput('detail-height-cm');
    delete cd.width_top_cm;
    delete cd.width_bottom_cm;
  }

  const computed = computeStitchesRowsFromCustomData(cd, shapeType);
  obj.set('customData', stripLegacyGaugeFromCustomData(cd));
  applyScalingLocksToObject(obj);
  const derived = document.getElementById('detail-derived-text');
  if (derived) derived.textContent = computed.text;
  appCanvas.requestRenderAll();
}

async function runCalculate() {
  if (!appCanvas) {
    alert('Холст не готов');
    return;
  }
  const sampleSel = document.getElementById('select-sample').value;
  const yarnSel = document.getElementById('select-yarn').value;

  const empty = document.getElementById('calc-result-empty');
  const dl = document.getElementById('calc-result-values');
  showLoading();
  try {
    const data = await apiFetchJson('/api/calculate', {
      method: 'POST',
      body: JSON.stringify({
        pattern_json: patternToJSON(),
        sample_id: sampleSel ? parseInt(sampleSel, 10) : null,
        yarn_id: yarnSel ? parseInt(yarnSel, 10) : null,
      }),
    });
    if (empty) {
      empty.hidden = true;
      empty.textContent =
        'Нажмите «Рассчитать» после выбора пряжи и образца (глобально или по деталям).';
    }
    if (dl) dl.hidden = false;
    const g = document.getElementById('calc-total-g');
    const m = document.getElementById('calc-total-m');
    const sk = document.getElementById('calc-skeins');
    const pr = document.getElementById('calc-price');
    if (g) g.textContent = `${data.totalYarnG} г`;
    if (m) m.textContent = `${data.totalYarnM} м`;
    if (sk) sk.textContent = String(data.skeinsNeeded);
    if (pr) pr.textContent = `${data.totalPrice}`;
  } catch (e) {
    if (empty) {
      empty.hidden = false;
      empty.textContent = `Ошибка: ${e.message}`;
    }
    if (dl) dl.hidden = true;
    showUserError(e.message);
  } finally {
    hideLoading();
  }
}

function collectPatternDetailsForReport() {
  if (!appCanvas) return [];
  const shapeNames = {
    rectangle: 'прямоугольник',
    circle: 'круг',
    ellipse: 'овал',
    triangle: 'треугольник',
    trapezoid: 'трапеция',
  };
  const selectedSample = document.querySelector('#select-sample option:checked')?.textContent?.trim() || '—';
  return appCanvas.getObjects().map((obj, index) => {
    const cd = readCustomData(obj);
    const shapeType = inferShapeType(obj, cd);
    const gaugeInfo = computeStitchesRowsFromCustomData(cd, shapeType);
    const stitchesRows = (gaugeInfo && Number.isFinite(gaugeInfo.stitches) && Number.isFinite(gaugeInfo.rows))
      ? `≈ ${gaugeInfo.stitches} п., ≈ ${gaugeInfo.rows} р.`
      : 'нет данных (выберите образец и размеры)';
    const seamName = getSampleById(cd.sample_id)?.name || selectedSample;
    const yarnName = getYarnById(cd.yarn_id)?.name || '—';
    if (shapeType === 'trapezoid') {
      return `Деталь ${index + 1}: трапеция ${Number(cd.width_top_cm || 0).toFixed(1)}/${Number(cd.width_bottom_cm || 0).toFixed(1)}/${Number(cd.height_cm || 0).toFixed(1)} см; шов/образец: ${seamName}; пряжа: ${yarnName}; петли/ряды: ${stitchesRows}`;
    }
    return `Деталь ${index + 1}: ${shapeNames[shapeType] || shapeType} ${Number(cd.width_cm || 0).toFixed(1)}x${Number(cd.height_cm || 0).toFixed(1)} см; шов/образец: ${seamName}; пряжа: ${yarnName}; петли/ряды: ${stitchesRows}`;
  });
}

async function renderPatternPreviewDataUrl(patternJson, width = 800, height = 600) {
  if (!patternJson || typeof patternJson !== 'object' || !window.fabric) return '';
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const staticCanvas = new fabric.StaticCanvas(c, { width, height, backgroundColor: '#ffffff' });
  await new Promise((resolve) => staticCanvas.loadFromJSON(patternJson, resolve));
  staticCanvas.renderAll();
  const url = c.toDataURL('image/png');
  staticCanvas.dispose();
  return url;
}

async function buildProjectPdfBlob(patternJson, projectName) {
  const jsPdfCtor = window.jspdf?.jsPDF;
  if (typeof jsPdfCtor !== 'function') throw new Error('jsPDF is not loaded.');

  const screenshotData = await renderPatternPreviewDataUrl(patternJson, 1200, 900);
  if (!screenshotData) throw new Error('Unable to render project image.');

  const now = new Date();
  const createdAt = now.toLocaleString('ru-RU');
  const pdf = new jsPdfCtor({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Вместо английского заголовка – сразу название проекта
  pdf.setFontSize(18);
  addUnicodeLineAsImage(pdf, projectName || 'Проект без названия', 14, 16, { fontSize: 18 });

  pdf.setFontSize(10);
  addUnicodeLineAsImage(pdf, `Сформировано: ${createdAt}`, 14, 26);

  pdf.addImage(screenshotData, 'PNG', 14, 36, 182, 120);

  // Список деталей (по желанию можно убрать, если не нужно)
  pdf.setFontSize(11);
  addUnicodeLineAsImage(pdf, 'Детали выкройки:', 14, 166);
  const objects = patternJson?.objects || [];
  let y = 173;
  objects.forEach((_, idx) => {
    if (y > 286) return;
    addUnicodeLineAsImage(pdf, `Деталь ${idx + 1}`, 14, y);
    y += 6;
  });
  if (objects.length === 0) {
    addUnicodeLineAsImage(pdf, 'Нет деталей на холсте', 14, y);
  }

  return pdf.output('blob');
}


function addUnicodeLineAsImage(pdf, text, x, y, opts = {}) {
  const fontSize = opts.fontSize || 10;     // размер в пунктах (pt)
  const color = opts.color || '#1e182e';
  const maxWidthMm = opts.maxWidthMm || 180;

  // 1 pt = 1/72 дюйма ≈ 0.3528 мм. Для canvas используем DPI 96 => 1pt = 96/72 = 1.333px
  const pxPerPt = 96 / 72;
  const fontSizePx = fontSize * pxPerPt;

  // Создаём canvas, который будет точно соответствовать размеру текста в PDF
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // Задаём шрифт с запасными вариантами для кириллицы
  ctx.font = `${fontSizePx}px 'Noto Sans', 'DejaVu Sans', 'Segoe UI', 'Arial', 'Arial Unicode MS', sans-serif`;
  const textWidthPx = ctx.measureText(text).width;
  const textHeightPx = fontSizePx; // приблизительно

  canvas.width = textWidthPx + 4;   // небольшой запас по бокам
  canvas.height = textHeightPx + 4; // запас сверху/снизу

  // Пересчитываем координаты и размер шрифта с учётом новой ширины canvas
  ctx.font = `${fontSizePx}px 'Noto Sans', 'DejaVu Sans', 'Segoe UI', 'Arial', 'Arial Unicode MS', sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.fillText(text, 2, 2);

  // Теперь ширина изображения в мм: исходная ширина в px переводится в мм (px / 96 * 25.4)
  const imgWidthMm = (canvas.width / 96) * 25.4;
  const imgHeightMm = (canvas.height / 96) * 25.4;
  // Если ширина превышает maxWidthMm, масштабируем пропорционально
  let finalWidth = imgWidthMm;
  let finalHeight = imgHeightMm;
  if (finalWidth > maxWidthMm) {
    const scale = maxWidthMm / finalWidth;
    finalWidth = maxWidthMm;
    finalHeight = imgHeightMm * scale;
  }

  const imgData = canvas.toDataURL('image/png');
  pdf.addImage(imgData, 'PNG', x, y, finalWidth, finalHeight);
}

async function exportToPDF() {
  showLoading();
  try {
    if (typeof window.html2canvas !== 'function') {
      throw new Error('Библиотека html2canvas не загружена.');
    }
    const jsPdfCtor = window.jspdf?.jsPDF;
    if (typeof jsPdfCtor !== 'function') {
      throw new Error('Библиотека jsPDF не загружена.');
    }
    const canvasElement = document.getElementById('c');
    if (!canvasElement) throw new Error('Холст #c не найден.');

    const screenshotCanvas = await window.html2canvas(canvasElement, {
      scale: 2,
      backgroundColor: '#ffffff',
    });
    const screenshotData = screenshotCanvas.toDataURL('image/png');

    const yarnOption = document.querySelector('#select-yarn option:checked');
    const sampleOption = document.querySelector('#select-sample option:checked');
    const hasCalculation = !document.getElementById('calc-result-values')?.hidden;
    const calcValues = {
      totalG: document.getElementById('calc-total-g')?.textContent?.trim() || '—',
      totalM: document.getElementById('calc-total-m')?.textContent?.trim() || '—',
      skeins: document.getElementById('calc-skeins')?.textContent?.trim() || '—',
      price: document.getElementById('calc-price')?.textContent?.trim() || '—',
    };

    const projectNameInput = document.getElementById('input-project-name');
    const rawProjectName = projectNameInput?.value?.trim() || '';
    const projectName = rawProjectName || 'Проект_без_названия';
    const safeProjectName = projectName
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 80);
    const now = new Date();
    const createdAt = now.toLocaleString('ru-RU');
    const fileDate = now.toISOString().slice(0, 10);
    const pdf = new jsPdfCtor({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    addUnicodeLineAsImage(pdf, `Проект: ${projectName}`, 14, 14, { fontSize: 16 });
    addUnicodeLineAsImage(pdf, `Сформировано: ${createdAt}`, 14, 20);

    const pageWidth = pdf.internal.pageSize.getWidth();
    const imgWidth = pageWidth - 28;
    const ratio = screenshotCanvas.height / screenshotCanvas.width;
    const imgHeight = imgWidth * ratio;
    pdf.addImage(screenshotData, 'PNG', 14, 42, imgWidth, Math.min(imgHeight, 300));

    let y = 156;
    pdf.setFontSize(12);
    addUnicodeLineAsImage(pdf, 'Использованная пряжа и расчёт', 14, y, { fontSize: 12 });
    y += 7;
    pdf.setFontSize(10);
    if (!hasCalculation) {
      addUnicodeLineAsImage(pdf, 'Расчёт ещё не запущен.', 14, y);
      y += 6;
    }else {
      [['Пряжа, г', calcValues.totalG], ['Пряжа, м', calcValues.totalM], ['Мотки', calcValues.skeins], ['Стоимость', calcValues.price]]
          .forEach(([label, value]) => {
            addUnicodeLineAsImage(pdf, `${label}: ${value}`, 14, y);
            y += 6;
          });
    }
    pdf.addPage();
    pdf.setFontSize(13);
    pdf.setTextColor(111, 76, 255);
    addUnicodeLineAsImage(pdf, 'Детали проекта', 14, 14, { fontSize: 13, color: '#6f4cff' });
    pdf.setTextColor(30, 24, 46);
    pdf.setFontSize(10);
    const details = collectPatternDetailsForReport();
    addUnicodeLineAsImage(pdf, 'Каждая деталь (отдельно):', 14, 30);
    let lineY = 36;
    if (!details.length) {
      addUnicodeLineAsImage(pdf, 'Пока нет деталей на холсте.', 14, lineY);
    } else {
      details.forEach((line) => {
        addUnicodeLineAsImage(pdf, line, 14, lineY);
        lineY += 6;
      });
    }
    lineY += 4;
    pdf.setFontSize(11);
    addUnicodeLineAsImage(pdf, 'Дополнительно:', 14, lineY, { fontSize: 11 });
    lineY += 6;
    pdf.setFontSize(10);
    ['Убедитесь, что плотность совпадает с образцом.', 'Проверьте шов/образец для каждой детали.', 'Числа петель и рядов указаны как примерный расчёт.']
      .forEach((line) => {
        addUnicodeLineAsImage(pdf, `- ${line}`, 16, lineY);
        lineY += 6;
      });

    pdf.save(`${safeProjectName}_${fileDate}.pdf`);
  } catch (err) {
    console.error('[exportToPDF]', err);
    showUserError(`Ошибка экспорта PDF: ${err.message}`);
  } finally {
    hideLoading();
  }
}

async function loadYarns(opts = {}) {
  const skipOverlay = Boolean(opts.skipOverlay);
  if (!skipOverlay) showLoading();
  try {
    const data = await apiGet('/api/yarns');
    yarnsCache = Array.isArray(data) ? data : [];

    const yarnSelects = ['select-yarn', 'detail-yarn-id']
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    yarnSelects.forEach((sel) => {
      const prev = sel.value;
      sel.innerHTML = '<option value="">— не выбрано —</option>';
      yarnsCache.forEach((y) => {
        const opt = document.createElement('option');
        opt.value = String(y.id);
        opt.textContent = y.name;
        sel.appendChild(opt);
      });
      if (prev && yarnsCache.some((y) => String(y.id) === prev)) {
        sel.value = prev;
      }
    });
  } catch (e) {
    console.error('[loadYarns]', e);
    yarnsCache = [];
    const sel = document.getElementById('select-yarn');
    if (sel) {
      sel.innerHTML = '<option value="">— ошибка загрузки —</option>';
    }
    showUserError(`Не удалось загрузить пряжу: ${e.message}`);
  } finally {
    if (!skipOverlay) hideLoading();
  }
}

function addYarn() {
  document.getElementById('dialog-yarn-title').textContent = 'Добавить пряжу';
  document.getElementById('yarn-edit-id').value = '';
  document.getElementById('yarn-name').value = '';
  document.getElementById('yarn-weight').value = '';
  document.getElementById('yarn-length').value = '';
  document.getElementById('yarn-price').value = '';
  document.getElementById('yarn-composition').value = '';
  document.getElementById('dialog-yarn').showModal();
}

function updateYarn() {
  const id = document.getElementById('select-yarn').value;
  if (!id) {
    alert('Выберите пряжу в списке');
    return;
  }
  const y = yarnsCache.find((row) => String(row.id) === id);
  if (!y) {
    alert('Запись не найдена. Обновите список.');
    return;
  }
  document.getElementById('dialog-yarn-title').textContent = 'Изменить пряжу';
  document.getElementById('yarn-edit-id').value = String(y.id);
  document.getElementById('yarn-name').value = y.name || '';
  document.getElementById('yarn-weight').value = y.weight_per_skein_g ?? '';
  document.getElementById('yarn-length').value = y.length_per_skein_m ?? '';
  document.getElementById('yarn-price').value = y.price_per_skein ?? '';
  document.getElementById('yarn-composition').value = y.composition ?? '';
  document.getElementById('dialog-yarn').showModal();
}

function deleteYarn() {
  const id = document.getElementById('select-yarn').value;
  if (!id) {
    alert('Выберите пряжу');
    return;
  }
  const y = yarnsCache.find((row) => String(row.id) === id);
  document.getElementById('yarn-delete-msg').textContent = y
    ? `Удалить пряжу «${y.name}»?`
    : 'Удалить выбранную пряжу?';
  document.getElementById('dialog-yarn-delete').showModal();
}

async function loadSamples(opts = {}) {
  const skipOverlay = Boolean(opts.skipOverlay);
  if (!skipOverlay) showLoading();
  try {
    const data = await apiGet('/api/samples');
    samplesCache = Array.isArray(data) ? data : [];

    const sampleSelects = ['select-sample', 'detail-sample-id']
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    sampleSelects.forEach((sel) => {
      const prev = sel.value;
      sel.innerHTML = '<option value="">— не выбрано —</option>';
      samplesCache.forEach((s) => {
        const opt = document.createElement('option');
        opt.value = String(s.id);
        opt.textContent = s.name;
        sel.appendChild(opt);
      });
      if (prev && samplesCache.some((s) => String(s.id) === prev)) {
        sel.value = prev;
      }
    });
  } catch (e) {
    console.error('[loadSamples]', e);
    samplesCache = [];
    showUserError(`Образцы: ${e.message}`);
  } finally {
    if (!skipOverlay) hideLoading();
  }
}

function addSample() {
  document.getElementById('dialog-sample-title').textContent = 'Добавить образец';
  document.getElementById('sample-edit-id').value = '';
  document.getElementById('sample-name').value = '';
  document.getElementById('sample-width').value = '';
  document.getElementById('sample-height').value = '';
  document.getElementById('sample-stitches').value = '';
  document.getElementById('sample-rows').value = '';
  document.getElementById('sample-weight-g').value = '';
  document.getElementById('dialog-sample').showModal();
}

function updateSample() {
  const id = document.getElementById('select-sample').value;
  if (!id) {
    alert('Выберите образец в списке');
    return;
  }
  const s = samplesCache.find((row) => String(row.id) === id);
  if (!s) {
    alert('Запись не найдена. Обновите список.');
    return;
  }
  document.getElementById('dialog-sample-title').textContent = 'Изменить образец';
  document.getElementById('sample-edit-id').value = String(s.id);
  document.getElementById('sample-name').value = s.name || '';
  document.getElementById('sample-width').value = s.width_cm ?? '';
  document.getElementById('sample-height').value = s.height_cm ?? '';
  document.getElementById('sample-stitches').value = s.stitches ?? '';
  document.getElementById('sample-rows').value = s.rows ?? '';
  document.getElementById('sample-weight-g').value = s.weight_g ?? '';
  document.getElementById('dialog-sample').showModal();
}

function deleteSample() {
  const id = document.getElementById('select-sample').value;
  if (!id) {
    alert('Выберите образец');
    return;
  }
  const s = samplesCache.find((row) => String(row.id) === id);
  document.getElementById('sample-delete-msg').textContent = s
    ? `Удалить образец «${s.name}»?`
    : 'Удалить выбранный образец?';
  document.getElementById('dialog-sample-delete').showModal();
}

async function saveProject() {
  if (!appCanvas) {
    alert('Холст не готов');
    return;
  }
  const name = document.getElementById('input-project-name').value.trim();
  if (!name) {
    alert('Введите имя проекта');
    return;
  }
  const yarnSel = document.getElementById('select-yarn').value;
  const sampleSel = document.getElementById('select-sample').value;
  const yarn_id = yarnSel ? parseInt(yarnSel, 10) : null;
  const sample_id = sampleSel ? parseInt(sampleSel, 10) : null;
  const pattern_json = patternToJSON();

  showLoading();
  try {
    const res = await apiFetchJson('/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        name,
        pattern_json,
        yarn_id,
        sample_id,
        is_public: document.getElementById('project-is-public')?.checked || false,
      }),
    });
    if (res && res.id != null) {
      currentProjectId = Number(res.id);
    }
    alert('Проект успешно сохранён');
    await loadProjectList({ skipOverlay: true });
  } catch (e) {
    showUserError(e.message);
    alert(e.message);
  } finally {
    hideLoading();
  }
}

async function loadProjectList(opts = {}) {
  const skipOverlay = Boolean(opts.skipOverlay);
  if (!skipOverlay) showLoading();
  try {
    const projects = await apiGet('/api/projects');
    if (!Array.isArray(projects)) return;

    const sel = document.getElementById('select-project');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">— выберите проект —</option>';
    projects.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = String(p.id);
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
    if (prev && projects.some((p) => String(p.id) === prev)) {
      sel.value = prev;
    }
  } catch (e) {
    console.error('[loadProjectList]', e);
    showUserError(`Проекты: ${e.message}`);
  } finally {
    if (!skipOverlay) hideLoading();
  }
}

function resetCanvasToNewProject() {
  if (!appCanvas) return;
  appCanvas.clear();
  const starter = new fabric.Rect({
    left: 120,
    top: 100,
    width: 160,
    height: 100,
    fill: 'rgba(100, 149, 237, 0.6)',
    stroke: '#4169e1',
    strokeWidth: 2,
    customData: {
      shapeType: 'rectangle',
      width_cm: pxToCm(160),
      height_cm: pxToCm(100),
    },
  });
  appCanvas.add(starter);
  appCanvas.discardActiveObject();
  appCanvas.requestRenderAll();
  currentProjectId = null;
  syncDetailPanelFromSelection();
  updateTotalArea();
}

async function updateCurrentProject() {
  if (!appCanvas) {
    alert('Холст не готов');
    return;
  }
  if (currentProjectId == null) {
    alert('Сначала загрузите проект из списка или сохраните новый.');
    return;
  }
  const name = document.getElementById('input-project-name').value.trim();
  if (!name) {
    alert('Введите имя проекта');
    return;
  }
  const yarnSel = document.getElementById('select-yarn').value;
  const sampleSel = document.getElementById('select-sample').value;
  const yarn_id = yarnSel ? parseInt(yarnSel, 10) : null;
  const sample_id = sampleSel ? parseInt(sampleSel, 10) : null;

  showLoading();
  try {
    await apiFetchJson(`/api/projects/${currentProjectId}`, {
      method: 'PUT',
      body: JSON.stringify({
        name,
        pattern_json: patternToJSON(),
        yarn_id,
        sample_id,
        is_public: document.getElementById('project-is-public')?.checked || false,
      }),
    });
    alert('Проект обновлён');
    await loadProjectList({ skipOverlay: true });
  } catch (e) {
    showUserError(e.message);
    alert(e.message);
  } finally {
    hideLoading();
  }
}

async function deleteCurrentProject() {
  if (currentProjectId == null) {
    alert('Нет загруженного проекта для удаления.');
    return;
  }
  if (!confirm('Удалить этот проект из базы? Действие необратимо.')) return;

  showLoading();
  try {
    await apiFetchJson(`/api/projects/${currentProjectId}`, { method: 'DELETE' });
    document.getElementById('input-project-name').value = '';
    document.getElementById('select-project').value = '';
    resetCanvasToNewProject();
    await loadProjectList({ skipOverlay: true });
    alert('Проект удалён');
  } catch (e) {
    showUserError(e.message);
    alert(e.message);
  } finally {
    hideLoading();
  }
}

async function loadProjectById(projectId) {
  if (!appCanvas) {
    alert('Холст не готов');
    return;
  }
  showLoading();
  try {
    const project = await apiGet(`/api/projects/${projectId}`);
    document.getElementById('input-project-name').value = project.name || '';

    const yid = project.yarn_id != null ? String(project.yarn_id) : '';
    const sid = project.sample_id != null ? String(project.sample_id) : '';
    document.getElementById('select-yarn').value = yid;
    document.getElementById('select-sample').value = sid;
    document.getElementById('project-is-public').checked = Boolean(project.is_public);

    const json = project.pattern_json;
    if (json == null) {
      alert('У проекта нет сохранённой выкройки');
      return;
    }

    await new Promise((resolve, reject) => {
      try {
        appCanvas.loadFromJSON(json, () => {
          appCanvas.renderAll();
          applyScalingLocksToAllCanvasObjects();
          currentProjectId = Number(projectId);
          syncDetailPanelFromSelection();
          updateTotalArea();
          resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  } catch (e) {
    showUserError(e.message);
    throw e;
  } finally {
    hideLoading();
  }
}

const PAGE_SECTION_IDS = {
  login: 'page-login',
  register: 'page-register',
  main: 'page-main',
  'my-projects': 'page-my-projects',
  'community-projects': 'page-community-projects',
  constructor: 'page-constructor',
  'yarn-base': 'page-yarn-base',
};

function showPage(pageKey) {
  const isAuthPage = pageKey === 'login' || pageKey === 'register';
  if (!authToken && !isAuthPage) {
    pageKey = 'login';
  }

  Object.entries(PAGE_SECTION_IDS).forEach(([key, sectionId]) => {
    const el = document.getElementById(sectionId);
    if (!el) return;
    const active = key === pageKey;
    el.classList.toggle('active', active);
    el.classList.toggle('hidden', !active);
  });
  document.querySelectorAll('.top-nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.page === pageKey);
  });
  const topNav = document.getElementById('top-nav');
  if (topNav) topNav.hidden = !authToken || ['login','register','main'].includes(pageKey);
  if (pageKey === 'constructor' && appCanvas) {
    requestAnimationFrame(() => {
      appCanvas.setDimensions({ width: 800, height: 600 });
      appCanvas.calcOffset();
      appCanvas.requestRenderAll();
    });
  }
  if (pageKey === 'my-projects') {
    loadLibraryList().catch((err) => {
      showUserError(err.message);
      alert(err.message);
    });
  }
  if (pageKey === 'community-projects') {
    loadCommunityProjects().catch((err) => showUserError(err.message));
  }
}

async function loadCommunityProjects() {
  const sort = document.getElementById('community-sort')?.value || 'new';
  const minRating = document.getElementById('community-min-rating')?.value?.trim();
  const qs = new URLSearchParams({ sort });
  if (minRating) qs.set('min_rating', minRating);
  const projects = await apiGet(`/api/public-projects?${qs.toString()}`);
  const list = document.getElementById('community-project-list');
  if (!list) return;
  list.innerHTML = '';
  const reviewBox = document.getElementById('community-review-box');
  if (reviewBox) reviewBox.classList.add('hidden');
  (projects || []).forEach((p) => {
    const li = document.createElement('li');
    li.className = 'community-project-item';
    const title = document.createElement('button');
    title.type = 'button';
    title.className = 'community-project-open';
    title.innerHTML = `<strong>${p.name}</strong> — автор: ${p.owner_username}, рейтинг: ${p.avg_rating ?? 'нет'} (${p.reviews_count})`;
    title.addEventListener('click', async () => {
      try {
        showLoading();
        const blob = await buildProjectPdfBlob(p.pattern_json, p.name);
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener');
        window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      } catch (err) {
        showUserError(`Не удалось открыть PDF проекта: ${err.message}`);
      } finally {
        hideLoading();
      }
    });
    const preview = document.createElement('img');
    preview.className = 'community-project-preview';
    preview.alt = `Превью проекта ${p.name}`;
    renderPatternPreviewDataUrl(p.pattern_json).then((src) => {
      if (src) preview.src = src;
    });
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Оценить / Комментировать';
    btn.addEventListener('click', () => {
      document.getElementById('community-project-id').value = String(p.id);
      document.getElementById('community-review-box').classList.remove('hidden');
    });
    li.appendChild(title);
    li.appendChild(preview);
    li.appendChild(btn);
    list.appendChild(li);
  });
}

async function sendCommunityReview() {
  const projectId = document.getElementById('community-project-id')?.value;
  if (!projectId) return alert('Сначала выберите проект');
  const ratingRaw = document.getElementById('community-rating')?.value?.trim() || '';
  const comment = document.getElementById('community-comment')?.value?.trim() || '';
  const payload = { comment };
  if (ratingRaw) payload.rating = parseInt(ratingRaw, 10);
  await apiFetchJson(`/api/public-projects/${projectId}/reviews`, { method: 'POST', body: JSON.stringify(payload) });
  alert('Отзыв отправлен');
}

document.addEventListener('DOMContentLoaded', async () => {
  const canvasEl = document.getElementById('c');
  appCanvas = new fabric.Canvas(canvasEl, {
    width: 800,
    height: 600,
  });

  const starter = new fabric.Rect({
    left: 120,
    top: 100,
    width: 160,
    height: 100,
    fill: 'rgba(100, 149, 237, 0.6)',
    stroke: '#4169e1',
    strokeWidth: 2,
    customData: {
      shapeType: 'rectangle',
      width_cm: pxToCm(160),
      height_cm: pxToCm(100),
    },
  });
  appCanvas.add(starter);

  document.querySelectorAll('.top-nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      if (page) showPage(page);
    });
  });

  appCanvas.on('selection:created', syncDetailPanelFromSelection);
  appCanvas.on('selection:updated', syncDetailPanelFromSelection);
  appCanvas.on('selection:cleared', syncDetailPanelFromSelection);

  appCanvas.on('object:modified', (opt) => {
    const t = opt.target;
    if (!t) return;
    if (t.type === 'activeSelection') {
      const objs = typeof t.getObjects === 'function' ? t.getObjects() : t._objects || [];
      objs.forEach((o) => {
        syncCustomDataFromFabricDimensions(o);
        applyScalingLocksToObject(o);
      });
    } else {
      syncCustomDataFromFabricDimensions(t);
      applyScalingLocksToObject(t);
    }
    syncDetailPanelFromSelection();
    updateTotalArea();
  });

  ['detail-width-cm', 'detail-height-cm', 'detail-width-top-cm', 'detail-width-bottom-cm'].forEach(
    (id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => applyDetailFieldsToSelection());
    },
  );

  const selSample = document.getElementById('select-sample');
  if (selSample) {
    selSample.addEventListener('change', () => syncDetailPanelFromSelection());
  }

  syncDetailPanelFromSelection();
  updateTotalArea();
  document.getElementById('btn-add-part').addEventListener('click', () => {
    const w = 60 + Math.random() * 100;
    const h = 40 + Math.random() * 80;
    const rect = new fabric.Rect({
      left: 40 + Math.random() * 500,
      top: 40 + Math.random() * 350,
      width: w,
      height: h,
      fill: `hsla(${Math.floor(Math.random() * 360)}, 70%, 60%, 0.75)`,
      stroke: '#333',
      strokeWidth: 2,
      customData: {
        shapeType: 'rectangle',
        width_cm: pxToCm(w),
        height_cm: pxToCm(h),
      },
    });
    appCanvas.add(rect);
    appCanvas.setActiveObject(rect);
    appCanvas.requestRenderAll();
    updateTotalArea();
  });

  document.getElementById('btn-add-circle').addEventListener('click', () => {
    const rx = 40;
    const ry = 40;
    const ell = new fabric.Ellipse({
      left: 40 + Math.random() * 500,
      top: 40 + Math.random() * 350,
      rx,
      ry,
      fill: `hsla(${Math.floor(Math.random() * 360)}, 70%, 60%, 0.75)`,
      stroke: '#333',
      strokeWidth: 2,
      customData: {
        shapeType: 'circle',
        width_cm: pxToCm(rx * 2),
        height_cm: pxToCm(ry * 2),
      },
    });
    appCanvas.add(ell);
    applyScalingLocksToObject(ell);
    appCanvas.setActiveObject(ell);
    appCanvas.requestRenderAll();
    updateTotalArea();
  });

  document.getElementById('btn-add-triangle').addEventListener('click', () => {
    const tw = 80;
    const th = 70;
    const tri = new fabric.Triangle({
      left: 40 + Math.random() * 500,
      top: 40 + Math.random() * 350,
      width: tw,
      height: th,
      fill: `hsla(${Math.floor(Math.random() * 360)}, 70%, 60%, 0.75)`,
      stroke: '#333',
      strokeWidth: 2,
      customData: {
        shapeType: 'triangle',
        width_cm: pxToCm(tw),
        height_cm: pxToCm(th),
      },
    });
    appCanvas.add(tri);
    applyScalingLocksToObject(tri);
    appCanvas.setActiveObject(tri);
    appCanvas.requestRenderAll();
    updateTotalArea();
  });

  document.getElementById('btn-add-trapezoid').addEventListener('click', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 80, y: 70 },
      { x: 20, y: 70 },
    ];
    const poly = new fabric.Polygon(points, {
      left: 40 + Math.random() * 450,
      top: 40 + Math.random() * 350,
      fill: `hsla(${Math.floor(Math.random() * 360)}, 70%, 60%, 0.75)`,
      stroke: '#333',
      strokeWidth: 2,
      customData: {
        shapeType: 'trapezoid',
        width_top_cm: pxToCm(100),
        width_bottom_cm: pxToCm(60),
        height_cm: pxToCm(70),
      },
    });
    appCanvas.add(poly);
    appCanvas.setActiveObject(poly);
    appCanvas.requestRenderAll();
    updateTotalArea();
  });

  document.getElementById('btn-delete-part').addEventListener('click', () => {
    if (!appCanvas) return;
    const ao = appCanvas.getActiveObject();
    if (!ao) {
      alert('Нет выделенной детали.');
      return;
    }
    if (ao.type === 'activeSelection') {
      const objs = typeof ao.getObjects === 'function' ? ao.getObjects() : ao._objects || [];
      if (!objs.length) return;
      if (!confirm(`Удалить выделенные фигуры (${objs.length} шт.)?`)) return;
      objs.forEach((o) => appCanvas.remove(o));
      appCanvas.discardActiveObject();
    } else {
      appCanvas.remove(ao);
      appCanvas.discardActiveObject();
    }
    appCanvas.requestRenderAll();
    syncDetailPanelFromSelection();
    updateTotalArea();
  });

  document.getElementById('btn-duplicate-part').addEventListener('click', () => {
    const ao = appCanvas.getActiveObject();
    if (!ao) return alert('Выберите деталь для дублирования');
    const clones = [];
    if (ao.type === 'activeSelection') {
      (ao.getObjects ? ao.getObjects() : []).forEach((o) => {
        const c = duplicateObject(o);
        if (c) clones.push(c);
      });
    } else {
      const c = duplicateObject(ao);
      if (c) clones.push(c);
    }
    if (!clones.length) return;
    appCanvas.discardActiveObject();
    clones.forEach((c) => appCanvas.add(c));
    if (clones.length === 1) appCanvas.setActiveObject(clones[0]);
    else appCanvas.setActiveObject(new fabric.ActiveSelection(clones, { canvas: appCanvas }));
    appCanvas.requestRenderAll();
    syncDetailPanelFromSelection();
    updateTotalArea();
  });

  document.getElementById('detail-fill-color')?.addEventListener('input', (e) => {
    const obj = getSelectedDetailObject();
    if (!obj) return;
    obj.set('fill', e.target.value);
    appCanvas.requestRenderAll();
  });

  document.getElementById('btn-detail-apply').addEventListener('click', () => {
    if (!getSelectedDetailObject()) {
      alert('Выделите деталь на холсте, чтобы применить размеры из полей.');
      return;
    }
    applyDetailFieldsToSelection();
  });

  const tabs = document.querySelectorAll('.tab');
  const panels = {
    yarn: document.getElementById('panel-yarn'),
    swatches: document.getElementById('panel-swatches'),
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;
      tabs.forEach((t) => {
        const on = t === tab;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      Object.entries(panels).forEach(([key, panel]) => {
        const on = key === name;
        panel.classList.toggle('active', on);
        panel.hidden = !on;
      });
    });
  });

  document.getElementById('btn-yarn-add').addEventListener('click', () => addYarn());
  document.getElementById('btn-yarn-edit').addEventListener('click', () => updateYarn());
  document.getElementById('btn-yarn-del').addEventListener('click', () => deleteYarn());

  document.getElementById('btn-sample-add').addEventListener('click', () => addSample());
  document.getElementById('btn-sample-edit').addEventListener('click', () => updateSample());
  document.getElementById('btn-sample-del').addEventListener('click', () => deleteSample());

  document.getElementById('yarn-form-cancel').addEventListener('click', () => {
    document.getElementById('dialog-yarn').close();
  });
  document.getElementById('yarn-delete-cancel').addEventListener('click', () => {
    document.getElementById('dialog-yarn-delete').close();
  });
  document.getElementById('sample-form-cancel').addEventListener('click', () => {
    document.getElementById('dialog-sample').close();
  });
  document.getElementById('sample-delete-cancel').addEventListener('click', () => {
    document.getElementById('dialog-sample-delete').close();
  });

  document.getElementById('form-yarn').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('yarn-edit-id').value;
    const payload = {
      name: document.getElementById('yarn-name').value.trim(),
      weight_per_skein_g: parseFloat(document.getElementById('yarn-weight').value),
      length_per_skein_m: parseFloat(document.getElementById('yarn-length').value),
      price_per_skein: parseFloat(document.getElementById('yarn-price').value),
      composition: document.getElementById('yarn-composition').value.trim() || null,
    };
    showLoading();
    try {
      if (editId) {
        await apiFetchJson(`/api/yarns/${editId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetchJson('/api/yarns', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      document.getElementById('dialog-yarn').close();
      await loadYarns({ skipOverlay: true });
    } catch (err) {
      showUserError(err.message);
      alert(err.message);
    } finally {
      hideLoading();
    }
  });

  document.getElementById('yarn-delete-confirm').addEventListener('click', async () => {
    const id = document.getElementById('select-yarn').value;
    if (!id) {
      document.getElementById('dialog-yarn-delete').close();
      return;
    }
    showLoading();
    try {
      await apiFetchJson(`/api/yarns/${id}`, { method: 'DELETE' });
      document.getElementById('dialog-yarn-delete').close();
      await loadYarns({ skipOverlay: true });
    } catch (err) {
      showUserError(err.message);
      alert(err.message);
    } finally {
      hideLoading();
    }
  });

  document.getElementById('form-sample').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('sample-edit-id').value;
    const payload = {
      name: document.getElementById('sample-name').value.trim(),
      width_cm: parseFloat(document.getElementById('sample-width').value),
      height_cm: parseFloat(document.getElementById('sample-height').value),
      stitches: parseInt(document.getElementById('sample-stitches').value, 10),
      rows: parseInt(document.getElementById('sample-rows').value, 10),
      weight_g: parseFloat(document.getElementById('sample-weight-g').value),
    };
    showLoading();
    try {
      if (editId) {
        await apiFetchJson(`/api/samples/${editId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetchJson('/api/samples', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      document.getElementById('dialog-sample').close();
      await loadSamples({ skipOverlay: true });
      syncDetailPanelFromSelection();
    } catch (err) {
      showUserError(err.message);
      alert(err.message);
    } finally {
      hideLoading();
    }
  });

  document.getElementById('sample-delete-confirm').addEventListener('click', async () => {
    const id = document.getElementById('select-sample').value;
    if (!id) {
      document.getElementById('dialog-sample-delete').close();
      return;
    }
    showLoading();
    try {
      await apiFetchJson(`/api/samples/${id}`, { method: 'DELETE' });
      document.getElementById('dialog-sample-delete').close();
      await loadSamples({ skipOverlay: true });
      syncDetailPanelFromSelection();
    } catch (err) {
      showUserError(err.message);
      alert(err.message);
    } finally {
      hideLoading();
    }
  });

  document.getElementById('btn-save').addEventListener('click', () => saveProject());

  document.getElementById('btn-calc').addEventListener('click', () => runCalculate());
  document.getElementById('btn-export-pdf')?.addEventListener('click', () => exportToPDF());

  document.getElementById('btn-project-update').addEventListener('click', () => updateCurrentProject());
  document.getElementById('btn-project-delete').addEventListener('click', () => deleteCurrentProject());

  document.getElementById('select-project').addEventListener('change', async (e) => {
    const id = e.target.value;
    if (!id) {
      currentProjectId = null;
      return;
    }
    try {
      await loadProjectById(id);
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('btn-load').addEventListener('click', async () => {
    const id = document.getElementById('select-project').value;
    if (!id) {
      alert('Выберите проект в списке на странице «Мои проекты».');
      return;
    }
    try {
      await loadProjectById(id);
    } catch (err) {
      alert(err.message);
    }
  });

  const formLib = document.getElementById('form-library-upload');
  if (formLib) {
    formLib.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nameEl = document.getElementById('library-upload-name');
      const fileEl = document.getElementById('library-upload-file');
      const name = nameEl.value.trim();
      if (!name || !fileEl.files?.length) return;
      const fd = new FormData();
      fd.append('name', name);
      fd.append('file', fileEl.files[0]);
      showLoading();
      try {
        await apiPostMultipart('/api/library/upload', fd);
        fileEl.value = '';
        nameEl.value = '';
        await loadLibraryList({ skipOverlay: true });
      } catch (err) {
        showUserError(err.message);
        alert(err.message);
      } finally {
        hideLoading();
      }
    });
  }

  const libPdfClose = document.getElementById('library-pdf-close');
  if (libPdfClose) {
    libPdfClose.addEventListener('click', () => closeLibraryPdfModal());
  }
  const libPdfDialog = document.getElementById('dialog-library-pdf');
  if (libPdfDialog) {
    libPdfDialog.addEventListener('close', () => {
      const frame = document.getElementById('library-pdf-frame');
      if (frame) frame.src = 'about:blank';
    });
  }

  const goRegister = document.getElementById('go-register');
  const goLogin = document.getElementById('go-login');
  if (goRegister) goRegister.addEventListener('click', () => showPage('register'));
  if (goLogin) goLogin.addEventListener('click', () => showPage('login'));
  document.getElementById('btn-logout')?.addEventListener('click', () => { authToken=''; currentUser=null; localStorage.removeItem('token'); showPage('login'); });
  document.getElementById('btn-home')?.addEventListener('click', () => showPage('main'));
  document.getElementById('btn-community-refresh')?.addEventListener('click', () => loadCommunityProjects().catch((err) => showUserError(err.message)));
  document.getElementById('btn-community-review-send')?.addEventListener('click', () => sendCommunityReview().catch((err) => showUserError(err.message)));
  document.getElementById('form-login')?.addEventListener('submit', async (e) => { e.preventDefault(); try { const data = await apiFetchJson('/api/login',{ method:'POST', body: JSON.stringify({ username: document.getElementById('login-username').value.trim(), password: document.getElementById('login-password').value })}); authToken=data.token; localStorage.setItem('token',authToken); const me=await apiGet('/api/me'); currentUser=me; document.getElementById('main-welcome').textContent=`Добро пожаловать, ${me.username}!`; showPage('main'); await loadYarns({skipOverlay:true}); await loadSamples({skipOverlay:true}); await loadProjectList({skipOverlay:true}); } catch(err){ showUserError(err.message);} });
  document.getElementById('form-register')?.addEventListener('submit', async (e) => { e.preventDefault(); try { const data = await apiFetchJson('/api/register',{ method:'POST', body: JSON.stringify({ username: document.getElementById('register-username').value.trim(), password: document.getElementById('register-password').value })}); authToken=data.token; localStorage.setItem('token',authToken); const me=await apiGet('/api/me'); currentUser=me; document.getElementById('main-welcome').textContent=`Добро пожаловать, ${me.username}!`; showPage('main'); await loadYarns({skipOverlay:true}); await loadSamples({skipOverlay:true}); await loadProjectList({skipOverlay:true}); } catch(err){ showUserError(err.message);} });
  document.querySelectorAll('.main-nav-btn').forEach((b)=>b.addEventListener('click', ()=>showPage(b.dataset.page)));

  if (authToken) {
    try { const me = await apiGet('/api/me'); currentUser = me; document.getElementById('main-welcome').textContent=`Добро пожаловать, ${me.username}!`; showPage('main'); } catch { authToken=''; localStorage.removeItem('token'); showPage('login'); }
  } else { showPage('login'); }

  showLoading();
  try {
    if (authToken) {
      await loadYarns({ skipOverlay: true });
    await loadSamples({ skipOverlay: true });
      await loadProjectList({ skipOverlay: true });
    }
  } catch (err) {
    const msg = `Не удалось загрузить данные с сервера: ${err.message}`;
    showUserError(msg);
    alert(`${msg}\nПроверьте, что backend запущен (${API_BASE}).`);
  } finally {
    hideLoading();
  }
});
