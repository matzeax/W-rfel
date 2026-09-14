'use strict';

// ---------- dice geometry (ported 1:1 from the design prototype) ----------
const PIPS = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8]
};
const ASYM = { 2: true, 3: true, 6: true };

// 90° cw: (x,y) -> (2-y, x)
function rotPips(list, rot) {
  let out = list;
  for (let r = 0; r < (rot % 4); r++) {
    out = out.map(i => { const x = i % 3, y = (i / 3) | 0; return x * 3 + (2 - y); });
  }
  return out;
}

// how much ink each of the 4 quadrants carries, for one pip layout
function quadInk(list) {
  const q = [0, 0, 0, 0];
  list.forEach(i => {
    const x = i % 3, y = (i / 3) | 0;
    const wx = x === 1 ? [0.5, 0.5] : x === 0 ? [1, 0] : [0, 1];
    const wy = y === 1 ? [0.5, 0.5] : y === 0 ? [1, 0] : [0, 1];
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) q[b * 2 + a] += wx[a] * wy[b];
  });
  const s = q.reduce((m, n) => m + n, 0) || 1;
  return q.map(n => n / s);
}

const PLACEHOLDER_SRC = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const PROGRESS_KEY = 'wuerfelplan.progress';

class WuerfelplanApp {
  constructor(root) {
    this.el = root;
    this.state = {
      imgSrc: null, imgW: 0, imgH: 0,
      cols: 32, diceMm: 16, style: 'white',
      brightness: 0, contrast: 100, invert: false, rotate: true,
      view: 'preview', row: 0, done: [],
      crop: { x: 0, y: 0, w: 1, h: 1 }
    };
    this._img = null;
    this._gridKey = null;
    this._grid = null;
    this._cropDraft = null;
    this._cropDrag = null;

    this.cacheDom();
    this.bindEvents();
    this.loadProgress();
    this.render();
  }

  cacheDom() {
    const $ = id => document.getElementById(id);
    this.dom = {
      sidebarToggle: $('sidebarToggle'), sidebar: $('sidebar'),
      dropzone: $('dropzone'), fileInput: $('fileInput'),
      thumbWrap: $('thumbWrap'), thumb: $('thumb'), dropLabel: $('dropLabel'),
      thumbCropRect: $('thumbCropRect'),
      cropBtn: $('cropBtn'), cropHint: $('cropHint'),
      cropModal: $('cropModal'), cropStage: $('cropStage'), cropImg: $('cropImg'), cropSelect: $('cropSelect'),
      cropCancelBtn: $('cropCancelBtn'), cropResetBtn: $('cropResetBtn'), cropApplyBtn: $('cropApplyBtn'),
      colsRange: $('colsRange'), colsVal: $('colsVal'), gridHintCols: $('gridHintCols'),
      diceMmRange: $('diceMmRange'), diceMmVal: $('diceMmVal'),
      styleWhite: $('styleWhite'), styleBlack: $('styleBlack'), styleMixed: $('styleMixed'),
      rotateBtn: $('rotateBtn'),
      brightnessRange: $('brightnessRange'), brightnessVal: $('brightnessVal'),
      contrastRange: $('contrastRange'), contrastVal: $('contrastVal'),
      invertBtn: $('invertBtn'),
      resetBtn: $('resetBtn'),
      statusLine: $('statusLine'),
      tabPreview: $('tabPreview'), tabPlan: $('tabPlan'),
      viewPreview: $('viewPreview'), viewPlan: $('viewPlan'),
      mainCanvas: $('mainCanvas'),
      statTotal: $('statTotal'), statGrid: $('statGrid'), statFrame: $('statFrame'), statWeight: $('statWeight'),
      partsList: $('partsList'),
      prevRowBtn: $('prevRowBtn'), nextRowBtn: $('nextRowBtn'), rowLabel: $('rowLabel'),
      markDoneBtn: $('markDoneBtn'), progressLabel: $('progressLabel'), resetProgressBtn: $('resetProgressBtn'),
      rowCells: $('rowCells'), rowText: $('rowText'),
      miniCanvas: $('miniCanvas')
    };
  }

  bindEvents() {
    const d = this.dom;

    d.sidebarToggle.addEventListener('click', () => {
      const open = !d.sidebar.classList.contains('is-open');
      d.sidebar.classList.toggle('is-open', open);
      d.sidebarToggle.setAttribute('aria-expanded', String(open));
    });

    d.dropzone.addEventListener('click', () => d.fileInput.click());
    d.dropzone.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); d.fileInput.click(); }
    });
    d.dropzone.addEventListener('dragover', e => { e.preventDefault(); d.dropzone.classList.add('is-drag'); });
    d.dropzone.addEventListener('dragleave', () => d.dropzone.classList.remove('is-drag'));
    d.dropzone.addEventListener('drop', e => {
      e.preventDefault();
      d.dropzone.classList.remove('is-drag');
      if (e.dataTransfer.files[0]) this.loadFile(e.dataTransfer.files[0]);
    });
    d.fileInput.addEventListener('change', e => {
      if (e.target.files[0]) this.loadFile(e.target.files[0]);
      e.target.value = '';
    });

    d.colsRange.addEventListener('input', e => this.setState({ cols: +e.target.value, row: 0 }));
    d.diceMmRange.addEventListener('input', e => this.setState({ diceMm: +e.target.value }));
    d.styleWhite.addEventListener('change', () => this.setState({ style: 'white' }));
    d.styleBlack.addEventListener('change', () => this.setState({ style: 'black' }));
    d.styleMixed.addEventListener('change', () => this.setState({ style: 'mixed' }));
    d.rotateBtn.addEventListener('click', () => this.setState({ rotate: !this.state.rotate }));
    d.brightnessRange.addEventListener('input', e => this.setState({ brightness: +e.target.value }));
    d.contrastRange.addEventListener('input', e => this.setState({ contrast: +e.target.value }));
    d.invertBtn.addEventListener('click', () => this.setState({ invert: !this.state.invert }));
    d.resetBtn.addEventListener('click', () => this.setState({
      cols: 32, diceMm: 16, style: 'white', brightness: 0, contrast: 100, invert: false, row: 0
    }));

    d.cropBtn.addEventListener('click', () => this.openCropModal());
    d.cropCancelBtn.addEventListener('click', () => this.closeCropModal());
    d.cropResetBtn.addEventListener('click', () => {
      this._cropDraft = { x: 0, y: 0, w: 1, h: 1 };
      this.paintCropSelect();
    });
    d.cropApplyBtn.addEventListener('click', () => {
      this.setState({ crop: this._cropDraft, row: 0 });
      this.closeCropModal();
    });
    d.cropModal.addEventListener('click', e => { if (e.target === d.cropModal) this.closeCropModal(); });
    this.bindCropDrag();

    d.tabPreview.addEventListener('click', () => this.setState({ view: 'preview' }));
    d.tabPlan.addEventListener('click', () => this.setState({ view: 'plan' }));

    d.prevRowBtn.addEventListener('click', () => this.setState({ row: Math.max(0, this.state.row - 1) }));
    d.nextRowBtn.addEventListener('click', () => {
      const rows = this.rows();
      this.setState({ row: Math.min(rows - 1, this.state.row + 1) });
    });
    d.markDoneBtn.addEventListener('click', () => this.toggleRowDone(true));
    d.resetProgressBtn.addEventListener('click', () => { this.saveProgress([]); this.setState({ done: [] }); });

    window.addEventListener('resize', () => this.paint());
  }

  // ---------- state ----------
  setState(patch) {
    Object.assign(this.state, patch);
    this.render();
  }

  loadProgress() {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        this._sig = p.sig;
        this.state.done = p.done || [];
      }
    } catch (e) { /* ignore */ }
  }

  sig() {
    const c = this.state.crop;
    const cropSig = [c.x, c.y, c.w, c.h].map(n => n.toFixed(3)).join(',');
    return this.state.cols + 'x' + this.rows() + '|' + this.state.style + '|' + cropSig;
  }

  saveProgress(done) {
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify({ sig: this.sig(), done })); } catch (e) { /* ignore */ }
  }

  // ---------- file input ----------
  loadFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const fr = new FileReader();
    fr.onload = e => {
      const img = new Image();
      img.onload = () => {
        this._img = img;
        this.setState({
          imgSrc: e.target.result, imgW: img.width, imgH: img.height, row: 0,
          crop: { x: 0, y: 0, w: 1, h: 1 }
        });
      };
      img.src = e.target.result;
    };
    fr.readAsDataURL(file);
  }

  // ---------- grid ----------
  cropPx() {
    const { imgW, imgH, crop } = this.state;
    return {
      x: Math.round(imgW * crop.x), y: Math.round(imgH * crop.y),
      w: Math.max(1, Math.round(imgW * crop.w)), h: Math.max(1, Math.round(imgH * crop.h))
    };
  }

  rows() {
    const { imgW, cols } = this.state;
    if (!imgW) return Math.round(cols * 1.25);
    const { w, h } = this.cropPx();
    return Math.max(1, Math.round(cols * h / w));
  }

  levels() { return this.state.style === 'mixed' ? 12 : 6; }

  grid() {
    if (!this._img) return null;
    const cols = this.state.cols, rows = this.rows();
    const crop = this.state.crop;
    const key = [cols, rows, this.state.style, this.state.brightness, this.state.contrast, this.state.invert, this.state.rotate, this.state.imgSrc, crop.x, crop.y, crop.w, crop.h].join('|');
    if (this._gridKey === key) return this._grid;

    const src = this.cropPx();

    const c = document.createElement('canvas');
    c.width = cols; c.height = rows;
    const ctx = c.getContext('2d');
    ctx.drawImage(this._img, src.x, src.y, src.w, src.h, 0, 0, cols, rows);
    const data = ctx.getImageData(0, 0, cols, rows).data;

    // double-resolution sample: 2×2 sub-luminance per cell, used to orient asymmetric faces
    const c2 = document.createElement('canvas');
    c2.width = cols * 2; c2.height = rows * 2;
    const ctx2 = c2.getContext('2d');
    ctx2.drawImage(this._img, src.x, src.y, src.w, src.h, 0, 0, cols * 2, rows * 2);
    const data2 = ctx2.getImageData(0, 0, cols * 2, rows * 2).data;
    const lum2 = (x, y) => { const i = (y * cols * 2 + x) * 4; return 0.299 * data2[i] + 0.587 * data2[i + 1] + 0.114 * data2[i + 2]; };

    const inkCache = {};
    const inkFor = (v, r) => { const k = v + ':' + r; return inkCache[k] || (inkCache[k] = quadInk(rotPips(PIPS[v], r))); };

    const k = this.state.contrast / 100, b = this.state.brightness, L = this.levels();
    const out = [];
    for (let y = 0; y < rows; y++) {
      const line = [];
      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4;
        let v = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        v = (v - 128) * k + 128 + b;
        if (this.state.invert) v = 255 - v;
        v = Math.max(0, Math.min(255, v));
        let idx = Math.floor((255 - v) / 256 * L);
        idx = Math.max(0, Math.min(L - 1, idx));
        let cell;
        if (this.state.style === 'mixed') {
          // bright half → white die (more black pips = darker), dark half → black die (fewer white pips = darker)
          cell = idx < 6 ? { v: idx + 1, black: false, rot: 0 } : { v: 12 - idx, black: true, rot: 0 };
        } else if (this.state.style === 'black') {
          // black die only: brighter pixel → more white pips
          cell = { v: L - idx, black: true, rot: 0 };
        } else {
          cell = { v: idx + 1, black: false, rot: 0 };
        }
        if (this.state.rotate && ASYM[cell.v]) {
          const q = [lum2(x * 2, y * 2), lum2(x * 2 + 1, y * 2), lum2(x * 2, y * 2 + 1), lum2(x * 2 + 1, y * 2 + 1)];
          let dark = q.map(l => cell.black ? l : 255 - l);
          const sum = dark.reduce((m, n) => m + n, 0) || 1;
          dark = dark.map(n => n / sum);
          let best = 0, bestErr = Infinity;
          for (let r = 0; r < 4; r++) {
            const ink = inkFor(cell.v, r);
            let err = 0;
            for (let j = 0; j < 4; j++) err += Math.pow(ink[j] - dark[j], 2);
            if (err < bestErr - 1e-9) { bestErr = err; best = r; }
          }
          cell.rot = best;
        }
        line.push(cell);
      }
      out.push(line);
    }
    this._gridKey = key; this._grid = out;
    return out;
  }

  // ---------- drawing ----------
  die(ctx, x, y, s, cell) {
    ctx.fillStyle = cell.black ? '#201e1d' : '#f8f4f4';
    ctx.fillRect(x, y, s, s);
    ctx.strokeStyle = cell.black ? '#000' : '#bab6b6';
    ctx.lineWidth = Math.max(0.5, s * 0.04);
    ctx.strokeRect(x + 0.25, y + 0.25, s - 0.5, s - 0.5);
    ctx.fillStyle = cell.black ? '#f8f4f4' : '#201e1d';
    const r = s * 0.085, pad = s * 0.22, step = (s - pad * 2) / 2;
    rotPips(PIPS[cell.v], cell.rot || 0).forEach(p => {
      const cx = x + pad + (p % 3) * step, cy = y + pad + Math.floor(p / 3) * step;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.2832); ctx.fill();
    });
  }

  paint() {
    const g = this.grid();
    const d = this.dom;

    const cv = d.mainCanvas;
    if (g) {
      const cols = g[0].length, rows = g.length;
      const s = Math.max(6, Math.min(22, Math.floor(1100 / cols)));
      cv.width = cols * s; cv.height = rows * s;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#eae9e9'; ctx.fillRect(0, 0, cv.width, cv.height);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) this.die(ctx, x * s, y * s, s, g[y][x]);
    } else {
      cv.width = 0; cv.height = 0;
    }

    const mini = d.miniCanvas;
    if (g) {
      const cols = g[0].length, rows = g.length;
      const s = Math.max(2, Math.floor(700 / cols));
      mini.width = cols * s; mini.height = rows * s;
      const ctx = mini.getContext('2d');
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const c = g[y][x];
        const t = c.black ? (7 - c.v) / 7 * 0.35 : 1 - c.v / 8;
        ctx.fillStyle = 'rgb(' + [255 * t, 255 * t, 255 * t].map(Math.round).join(',') + ')';
        ctx.fillRect(x * s, y * s, s, s);
      }
      this.state.done.forEach(i => {
        if (i < rows) { ctx.fillStyle = 'rgba(236,48,19,0.18)'; ctx.fillRect(0, i * s, cols * s, s); }
      });
      const r = Math.min(this.state.row, rows - 1);
      ctx.fillStyle = 'rgba(236,48,19,0.45)';
      ctx.fillRect(0, r * s, cols * s, s);
      ctx.strokeStyle = '#ec3013'; ctx.lineWidth = 2;
      ctx.strokeRect(0, r * s, cols * s, s);
    } else {
      mini.width = 0; mini.height = 0;
    }
  }

  toggleRowDone(advance) {
    const st = this.state;
    const rows = this.rows();
    const rIdx = Math.min(st.row, rows - 1);
    const isDone = st.done.indexOf(rIdx) !== -1;
    const next = isDone ? st.done.filter(i => i !== rIdx) : st.done.concat([rIdx]);
    this.saveProgress(next);
    this.setState({ done: next, row: advance && !isDone ? Math.min(rows - 1, rIdx + 1) : rIdx });
  }

  // ---------- crop modal ----------
  openCropModal() {
    const d = this.dom;
    this._cropDraft = { ...this.state.crop };
    d.cropImg.src = this.state.imgSrc;
    d.cropStage.style.aspectRatio = this.state.imgW + ' / ' + this.state.imgH;
    d.cropModal.hidden = false;
    this.paintCropSelect();
  }

  closeCropModal() {
    this.dom.cropModal.hidden = true;
    this._cropDraft = null;
  }

  paintCropSelect() {
    const c = this._cropDraft;
    if (!c) return;
    const el = this.dom.cropSelect;
    el.style.left = (c.x * 100) + '%';
    el.style.top = (c.y * 100) + '%';
    el.style.width = (c.w * 100) + '%';
    el.style.height = (c.h * 100) + '%';
  }

  cropStageFrac(clientX, clientY) {
    const rect = this.dom.cropStage.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
    };
  }

  bindCropDrag() {
    const d = this.dom;
    const MIN = 0.06;

    const onMove = e => {
      const drag = this._cropDrag;
      if (!drag) return;
      const p = this.cropStageFrac(e.clientX, e.clientY);
      const c = this._cropDraft;

      if (drag.mode === 'move') {
        const dx = p.x - drag.startX, dy = p.y - drag.startY;
        c.x = Math.max(0, Math.min(1 - drag.startW, drag.origX + dx));
        c.y = Math.max(0, Math.min(1 - drag.startH, drag.origY + dy));
      } else {
        let cx = p.x, cy = p.y;
        if (drag.dirX > 0) cx = Math.max(cx, drag.anchorX + MIN); else cx = Math.min(cx, drag.anchorX - MIN);
        if (drag.dirY > 0) cy = Math.max(cy, drag.anchorY + MIN); else cy = Math.min(cy, drag.anchorY - MIN);
        cx = Math.max(0, Math.min(1, cx)); cy = Math.max(0, Math.min(1, cy));
        c.x = Math.min(drag.anchorX, cx); c.w = Math.abs(cx - drag.anchorX);
        c.y = Math.min(drag.anchorY, cy); c.h = Math.abs(cy - drag.anchorY);
      }
      this.paintCropSelect();
    };

    const onUp = () => { this._cropDrag = null; };

    d.cropSelect.addEventListener('pointerdown', e => {
      if (e.target.closest('.crop-handle')) return;
      e.preventDefault();
      const c = this._cropDraft;
      const p = this.cropStageFrac(e.clientX, e.clientY);
      this._cropDrag = { mode: 'move', startX: p.x, startY: p.y, origX: c.x, origY: c.y, startW: c.w, startH: c.h };
      d.cropStage.setPointerCapture(e.pointerId);
    });

    d.cropSelect.querySelectorAll('.crop-handle').forEach(handle => {
      handle.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        const h = handle.dataset.handle;
        const c = this._cropDraft;
        const dirX = (h === 'ne' || h === 'se') ? 1 : -1;
        const dirY = (h === 'sw' || h === 'se') ? 1 : -1;
        this._cropDrag = {
          mode: 'resize', dirX, dirY,
          anchorX: dirX > 0 ? c.x : c.x + c.w,
          anchorY: dirY > 0 ? c.y : c.y + c.h
        };
        d.cropStage.setPointerCapture(e.pointerId);
      });
    });

    d.cropStage.addEventListener('pointermove', onMove);
    d.cropStage.addEventListener('pointerup', onUp);
    d.cropStage.addEventListener('pointercancel', onUp);
  }

  // ---------- render (DOM bindings) ----------
  render() {
    const st = this.state;
    const d = this.dom;
    const g = this.grid();
    const rows = g ? g.length : this.rows();
    const cols = st.cols;
    const total = g ? rows * cols : 0;
    const mmW = cols * st.diceMm, mmH = rows * st.diceMm;

    // 01 — Vorlage
    if (st.imgSrc) {
      if (d.thumb.src !== st.imgSrc) d.thumb.src = st.imgSrc;
      d.thumbWrap.hidden = false;
      d.dropLabel.textContent = 'Anderes Bild wählen';
      d.cropBtn.hidden = false;
      const isFullCrop = st.crop.x === 0 && st.crop.y === 0 && st.crop.w === 1 && st.crop.h === 1;
      d.thumbCropRect.hidden = isFullCrop;
      if (!isFullCrop) {
        d.thumbCropRect.style.left = (st.crop.x * 100) + '%';
        d.thumbCropRect.style.top = (st.crop.y * 100) + '%';
        d.thumbCropRect.style.width = (st.crop.w * 100) + '%';
        d.thumbCropRect.style.height = (st.crop.h * 100) + '%';
      }
      d.cropHint.hidden = false;
      d.cropHint.textContent = isFullCrop ? 'Ausschnitt: ganzes Bild' : 'Ausschnitt: ' + Math.round(st.crop.w * 100) + '% × ' + Math.round(st.crop.h * 100) + '%';
    } else {
      d.thumbWrap.hidden = true;
      d.dropLabel.textContent = 'Bild hierher ziehen oder klicken';
      d.cropBtn.hidden = true;
      d.cropHint.hidden = true;
    }
    d.statusLine.textContent = g ? total.toLocaleString('de-DE') + ' Würfel · ' + cols + '×' + rows : 'Kein Bild geladen';

    // 02 — Genauigkeit
    d.colsRange.value = st.cols;
    d.colsVal.textContent = st.cols;
    d.gridHintCols.textContent = cols + ' × ' + rows;
    d.diceMmRange.value = st.diceMm;
    d.diceMmVal.textContent = st.diceMm + ' mm';

    // 03 — Material
    d.styleWhite.checked = st.style === 'white';
    d.styleBlack.checked = st.style === 'black';
    d.styleMixed.checked = st.style === 'mixed';
    d.rotateBtn.textContent = st.rotate ? 'Drehung wird geplant — abschalten' : 'Würfel-Drehung mitplanen';
    d.rotateBtn.classList.toggle('is-active', st.rotate);

    // 04 — Bildkorrektur
    d.brightnessRange.value = st.brightness;
    d.brightnessVal.textContent = st.brightness;
    d.contrastRange.value = st.contrast;
    d.contrastVal.textContent = st.contrast + ' %';
    d.invertBtn.textContent = st.invert ? 'Invertiert — zurücksetzen' : 'Hell/Dunkel tauschen';
    d.invertBtn.classList.toggle('is-active', st.invert);

    // tabs / views
    d.tabPreview.classList.toggle('is-active', st.view === 'preview');
    d.tabPlan.classList.toggle('is-active', st.view === 'plan');
    d.viewPreview.hidden = st.view !== 'preview';
    d.viewPlan.hidden = st.view !== 'plan';

    // stats
    d.statTotal.textContent = total ? total.toLocaleString('de-DE') : '—';
    d.statGrid.textContent = cols + ' × ' + rows;
    d.statFrame.textContent = g ? (mmW / 10).toFixed(1) + ' × ' + (mmH / 10).toFixed(1) + ' cm' : '—';
    d.statWeight.textContent = g ? ((total * Math.pow(st.diceMm / 10, 3) * 1.4) / 1000).toFixed(1) + ' kg' : '—';

    // parts list
    d.partsList.innerHTML = '';
    if (g) {
      const map = new Map();
      g.forEach(l => l.forEach(c => {
        const k = (c.black ? 'b' : 'w') + c.v;
        map.set(k, (map.get(k) || 0) + 1);
      }));
      for (const black of [false, true]) for (let v = 1; v <= 6; v++) {
        const n = map.get((black ? 'b' : 'w') + v);
        if (!n) continue;
        const part = document.createElement('div');
        part.className = 'part';
        part.innerHTML =
          '<div class="part-swatch" style="background:' + (black ? '#201e1d' : '#f8f4f4') + '"></div>' +
          '<div><div class="part-label">' + (black ? 'Schwarz' : 'Weiß') + ' · ' + v + '</div>' +
          '<div class="part-count">' + n + '</div></div>';
        d.partsList.appendChild(part);
      }
    }

    // plan view
    const rIdx = g ? Math.min(st.row, rows - 1) : 0;
    d.rowLabel.textContent = 'Reihe ' + (rIdx + 1) + ' von ' + rows;
    d.progressLabel.textContent = g ? st.done.length + ' von ' + rows + ' Reihen fertig · ' + Math.round(st.done.length / rows * 100) + ' %' : '';
    const rowDone = st.done.indexOf(rIdx) !== -1;
    d.markDoneBtn.textContent = rowDone ? '✓ Reihe erledigt' : 'Reihe abhaken ▶';
    d.markDoneBtn.classList.toggle('is-done', rowDone);
    d.prevRowBtn.disabled = rIdx <= 0;
    d.nextRowBtn.disabled = !g || rIdx >= rows - 1;

    d.rowCells.innerHTML = '';
    if (g) {
      const rowLine = g[rIdx];
      const frag = document.createDocumentFragment();
      rowLine.forEach((c, i) => {
        const pips = rotPips(PIPS[c.v], c.rot || 0);
        const cellWrap = document.createElement('div');
        cellWrap.className = 'die-cell';
        const face = document.createElement('div');
        face.className = 'die-face';
        face.style.background = c.black ? '#201e1d' : '#f8f4f4';
        for (let j = 0; j < 9; j++) {
          const dot = document.createElement('div');
          dot.className = 'die-pip';
          dot.style.background = pips.includes(j) ? (c.black ? '#f8f4f4' : '#201e1d') : 'transparent';
          face.appendChild(dot);
        }
        const meta = document.createElement('div');
        meta.className = 'die-meta';
        meta.innerHTML = '<span>' + (i + 1) + '</span><span class="turn">' + (c.rot ? (c.rot * 90) + '°' : '') + '</span>';
        cellWrap.appendChild(face);
        cellWrap.appendChild(meta);
        frag.appendChild(cellWrap);
      });
      d.rowCells.appendChild(frag);
      d.rowText.textContent = rowLine.map(c => (c.black ? 'S' : 'W') + c.v + (c.rot ? '↻' + (c.rot * 90) : '')).join('  ');
    } else {
      d.rowText.textContent = '';
    }

    this.paint();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new WuerfelplanApp(document.body);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is best-effort */ });
    });
  }
});
