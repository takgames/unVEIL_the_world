// ====== ユーティリティ ======
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const toNum = (v) => (Number.isFinite(+v) ? +v : 0);
const fmtInt = (n) => Math.floor(n).toLocaleString('ja-JP');
const fmtPct = (n) => (Math.round(n * 100) / 100).toFixed(2);
const fmt2 = (n) => (Math.round(n * 100) / 100).toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ====== 変更検知（未保存の編集の有無） ======
let baselineJSON = '';
let currentPresetName = ''; // 現在選択中のプリセット名（未選択は ''）

const captureBaseline = () => { baselineJSON = JSON.stringify(state); };
const isDirty = () => JSON.stringify(state) !== baselineJSON;

// ====== バッチレンダー (#10) ======
let rafId = 0;
function scheduleRender() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => { rafId = 0; render(); });
}

// ====== ストレージ版数管理 (#12) ======
const STORAGE_VERSION = 1;
const STORAGE_VERSION_KEY = 'uvt-storage-version';
function ensureStorageMigrations() {
  const v = +(localStorage.getItem(STORAGE_VERSION_KEY) || 0);
  if (v < 1) {
    try {
      if (localStorage.getItem('uvt-presets') && !localStorage.getItem('uvt-presets-v1')) {
        localStorage.setItem('uvt-presets-v1', localStorage.getItem('uvt-presets'));
        localStorage.removeItem('uvt-presets');
      }
      if (localStorage.getItem('uvt-collapse') && !localStorage.getItem('uvt-collapse-v1')) {
        localStorage.setItem('uvt-collapse-v1', localStorage.getItem('uvt-collapse'));
        localStorage.removeItem('uvt-collapse');
      }
    } catch {}
    localStorage.setItem(STORAGE_VERSION_KEY, String(STORAGE_VERSION));
  }
}

// ====== 比較機能 ======
let compareCtx = null; // { name: string, state: StateObject, transient: boolean }

function refreshCompareSelect() {
  const sel = $('#compareSelect');
  if (!sel) return;

  const map = loadPresets();
  sel.innerHTML = '';

  // ① 必ずプレースホルダを追加（iOSでも“オプションなし”回避）
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = '（比較なし）';
  sel.appendChild(ph);

  // ② 既存プリセットを投入
  Object.keys(map).sort().forEach((name) => {
    const o = document.createElement('option');
    o.value = name; o.textContent = name;
    sel.appendChild(o);
  });

  // ③ URL由来の一時比較（未保存）も選択肢に出す
  if (compareCtx && !map[compareCtx.name]) {
    const o = document.createElement('option');
    o.value = compareCtx.name; o.textContent = `${compareCtx.name}（URL）`;
    sel.appendChild(o);
  }

  // ④ 選択状態を反映
  sel.value = compareCtx ? compareCtx.name : '';

  // ⑤ 最終保険：それでも0件ならプレースホルダをもう一度追加
  if (sel.options.length === 0) {
    sel.add(new Option('（比較なし）', ''));
  }

  updateCompareBadges();
}

// A側の表示名（現在＝未保存時は「現在」、保存/選択中ならプリセット名）
const getAName = () => currentPresetName ? currentPresetName : '現在';

function updateCompareBadges() {
  const a = $('#badgeAName');
  const bWrap = $('#badgeB');
  const bName = $('#badgeBName');
  if (a) a.textContent = getAName();
  if (!bWrap || !bName) return;
  if (!compareCtx) {
    bWrap.hidden = false;
    bWrap.classList.add('empty');
    bName.textContent = 'なし';
  } else {
    bWrap.hidden = false;
    bWrap.classList.remove('empty');
    bName.textContent = compareCtx.name;
  }
}

function setDeltaChip(el, baseVal, cmpVal) {
  if (!el || !compareCtx || !isFinite(baseVal) || !isFinite(cmpVal)) { if (el) el.hidden = true; return; }
  const diff = Math.floor(cmpVal) - Math.floor(baseVal);
  const pct = (diff / Math.max(1, Math.floor(baseVal))) * 100;
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±';
  const absVal = Math.abs(diff).toLocaleString('ja-JP');
  const pctStr = (diff > 0 ? '+' : diff < 0 ? '−' : '') + Math.round(Math.abs(pct)) + '%';

  el.textContent = `${sign}${absVal} (${pctStr})`;
  el.className = 'delta-chip ' + (diff > 0 ? 'delta-pos' : diff < 0 ? 'delta-neg' : 'delta-zero');
  el.hidden = false;
}

function forceStickyRelayout() {
  const r = $('.results');
  if (!r) return;
  r.classList.add('reflow');
  requestAnimationFrame(() => r.classList.remove('reflow'));
}

function openComparePicker(mode /* 'A' | 'B' */) {
  const dlg = $('#comparePicker');
  if (!dlg) return;
  enhanceDialog(dlg);

  const title = $('#cmpTitle');
  const listEl = $('#cmpList');
  const q = $('#cmpSearch');
  const btnClear = $('#cmpClear');
  const btnClose = $('#cmpClose');
  const map = loadPresets();

  // タイトルと「比較なし」可視性
  if (title) title.textContent = (mode === 'A') ? '比較元を選択' : '比較先を選択';
  if (btnClear) btnClear.style.display = (mode === 'B') ? '' : 'none';

  const build = (filterText='') => {
    const kw = filterText.trim().toLowerCase();
    const names = Object.keys(map).sort().filter(n => !kw || n.toLowerCase().includes(kw));
    listEl.innerHTML = '';

    if (mode === 'B' && compareCtx && !map[compareCtx.name] &&
        (!kw || compareCtx.name.toLowerCase().includes(kw))) {
      names.push(compareCtx.name + '（URL）');
    }
    if (names.length === 0) {
      const li = document.createElement('li');
      li.innerHTML = '<button type="button" disabled>プリセットがありません</button>';
      listEl.appendChild(li);
      return;
    }
    names.forEach(displayName => {
      const realName = displayName.replace(/（URL）$/, '');
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = displayName;
      btn.addEventListener('click', () => {
        if (mode === 'B') {
          if (map[realName]) {
            compareCtx = { name: realName, state: structuredClone(map[realName]), transient: false };
            $('#compareSave')?.setAttribute('hidden','');
          } else if (compareCtx && compareCtx.name === realName) {
            compareCtx = { ...compareCtx, transient: true };
            $('#compareSave')?.removeAttribute('hidden');
          }
          refreshCompareSelect(); updateCompareBadges(); scheduleRender();
          closeSheet();
        } else {
          if (typeof isDirty === 'function' && isDirty()) {
            const ok = confirm('未保存の変更があります。破棄して置き換えますか？');
            if (!ok) return;
          }
          const prevState = structuredClone(state);
          const prevAName = getAName();

          if (map[realName]) { state = structuredClone(map[realName]); currentPresetName = realName; }
          else { state = compareCtx?.state ? structuredClone(compareCtx.state) : state; currentPresetName = ''; }
          setInputsFromState(state); render(); captureBaseline?.();

          compareCtx = { name: prevAName, state: prevState, transient: false };
          $('#compareSave')?.setAttribute('hidden','');

          refreshPresetSelect(); refreshCompareSelect(); updateCompareBadges();
          closeSheet();
        }
      });
      li.appendChild(btn);
      listEl.appendChild(li);
    });
  };

  // —— ここから “非モーダルシート” 表示制御 ——
  const backdrop = $('#cmpBackdrop');

  function openSheet() {
    // バックドロップ表示
    if (backdrop) {
      backdrop.hidden = false;
      const onBdClick = () => closeSheet();
      backdrop.addEventListener('click', onBdClick, { once: true });
    }
    // 非モーダルで開く（iOS showModalバグ回避）
    dlg.setAttribute('aria-modal', 'true');
    dlg.show();                 // ← ここが showModal() からの差し替え
    // 検索にフォーカス
    q.value = ''; build(''); q.focus({ preventScroll: true });

    // 念のため sticky を一度リフロー
    forceStickyRelayout();
  }

  function closeSheet() {
    dlg.close();
    if (backdrop) backdrop.hidden = true;
    // 閉じたあとも sticky を再リフロー（iOS対策）
    forceStickyRelayout();
  }

  // 検索と表示
  build(''); q.oninput = () => build(q.value);
  if (btnClear) btnClear.onclick = () => { if (mode === 'B') { compareCtx = null; refreshCompareSelect(); updateCompareBadges(); scheduleRender(); } closeSheet(); };
  if (btnClose) btnClose.onclick = () => closeSheet();

  openSheet();
}

function initComparePicker() {
  const openA = (e)=>{ e.preventDefault(); openComparePicker('A'); };
  const openB = (e)=>{ e.preventDefault(); openComparePicker('B'); };

  const a = $('#badgeA');
  const b = $('#badgeB');
  if (a) {
    a.addEventListener('click', openA);
    a.addEventListener('keydown', (e)=>{ if (e.key==='Enter' || e.key===' ') openA(e); });
  }
  if (b) {
    b.addEventListener('click', openB);
    b.addEventListener('keydown', (e)=>{ if (e.key==='Enter' || e.key===' ') openB(e); });
  }
}

// ====== デフォルト値 ======
const DEFAULTS = {
  baseAtk: 5000,
  bonusAtk: 0,
  critRate: 20,
  critDmg: 50,
  skillPct: 100,
  skillFlat: 0,
  atkUpPct: 0,
  dmgUpPct: 0,
  cardDmgUpPct: 0,
  elemDmgUpPct: 0,
  enemyDef: 0,
  affinity: 'none',
  isBreak: false,
  equip: {
    glove: { mainType: 'atk',   mainVal: 0, sub: { atk: 0, atkPct: 0, critRate: 0, critDmg: 0 } },
    armor: { mainType: 'other', mainVal: 0, sub: { atk: 0, atkPct: 0, critRate: 0, critDmg: 0 } },
    emblem:{ mainType: 'atk',   mainVal: 0, sub: { atk: 0, atkPct: 0, critRate: 0, critDmg: 0 } },
    ring:  { mainType: 'atk',   mainVal: 0, sub: { atk: 0, atkPct: 0, critRate: 0, critDmg: 0 } },
    brooch:{ mainType: 'atk',   mainVal: 0, sub: { atk: 0, atkPct: 0, critRate: 0, critDmg: 0 } },
  }
};

// ====== 状態 ======
let state = structuredClone(DEFAULTS);

// ====== テーマ ======
function initTheme() {
  const saved = localStorage.getItem('uvt-theme');
  const html = document.documentElement;
  if (saved === 'light' || saved === 'dark') html.setAttribute('data-theme', saved);
  else html.setAttribute('data-theme', 'dark');
  $('#themeBtn').addEventListener('click', () => {
    const cur = html.getAttribute('data-theme');
    const next = cur === 'light' ? 'dark' : 'light';
    html.setAttribute('data-theme', next);
    localStorage.setItem('uvt-theme', next);
    toast(`${next === 'light' ? 'ライト' : 'ダーク'}モードに切替えました`);
  });
}

// ====== トースト ======
let toastTimer;
function toast(msg) {
  const box = $('#toast');
  box.textContent = msg;
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), 1600);
}

// ====== 入力と状態の同期 ======
function bindInputs() {
  const map = [
    ['#baseAtk', 'baseAtk'],
    ['#bonusAtk', 'bonusAtk'],
    ['#critRate', 'critRate'],
    ['#critDmg', 'critDmg'],
    ['#skillPct', 'skillPct'],
    ['#skillFlat', 'skillFlat'],
    ['#atkUpPct', 'atkUpPct'],
    ['#dmgUpPct', 'dmgUpPct'],
    ['#cardDmgUpPct', 'cardDmgUpPct'],
    ['#elemDmgUpPct', 'elemDmgUpPct'],
    ['#enemyDef', 'enemyDef'],
  ];
  map.forEach(([sel, key]) => {
    const el = $(sel);
    el.addEventListener('input', () => { state[key] = toNum(el.value); scheduleRender(); });
  });

  $('#affinity').addEventListener('change', (e) => { state.affinity = e.target.value; scheduleRender(); });
  $('#isBreak').addEventListener('change', (e) => { state.isBreak = !!e.target.checked; scheduleRender(); });

  // 装備: メイン種別
  $$('.mainType').forEach((sel) => {
    sel.addEventListener('change', () => {
      const slot = sel.dataset.slot;
      state.equip[slot].mainType = sel.value;
      updateMainValState(slot);
      scheduleRender();
    });
  });
  // 装備: メイン値
  $$('.mainVal').forEach((inp) => {
    inp.addEventListener('input', () => {
      const slot = inp.dataset.slot;
      const fixedType = inp.dataset.mainType; // glove/armor 固定
      if (fixedType) state.equip[slot].mainType = fixedType;
      state.equip[slot].mainVal = toNum(inp.value);
      scheduleRender();
    });
  });
  // 装備: サブ
  $$('input[data-sub]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const slot = inp.dataset.slot; const k = inp.dataset.sub;
      state.equip[slot].sub[k] = toNum(inp.value);
      scheduleRender();
    });
  });
}

// メインが"other"のときメイン値入力を無効化＆空白表示
function updateMainValState(slot) {
  const gear = state.equip[slot];
  const inp = $(`input.mainVal[data-slot="${slot}"]`);
  if (!inp) return;
  const fixedType = inp.dataset.mainType; // 固定種別（glove/armor）
  const type = fixedType ?? gear.mainType;
  const isOther = type === 'other';
  inp.disabled = isOther;
  if (isOther) { inp.value = ''; inp.placeholder = '—'; }
  else { inp.placeholder = ''; inp.value = gear.mainVal ?? 0; }
}

// ====== 計算 ======
function calcAll(s) {
  // 装備 合計
  const sum = { atk: 0, atkPct: 0, critRate: 0, critDmg: 0, elemDmgPct: 0 };
  for (const [, gear] of Object.entries(s.equip)) {
    const type = gear.mainType;
    const val = toNum(gear.mainVal);
    if (type === 'atk') sum.atk += val;
    else if (type === 'atkPct') sum.atkPct += val;
    else if (type === 'critRate') sum.critRate += val;
    else if (type === 'critDmg') sum.critDmg += val;
    else if (type === 'elemDmgPct') sum.elemDmgPct += val; // 紋章のみ想定

    sum.atk += toNum(gear.sub.atk);
    sum.atkPct += toNum(gear.sub.atkPct);
    sum.critRate += toNum(gear.sub.critRate);
    sum.critDmg += toNum(gear.sub.critDmg);
  }

  // 装備補正攻撃力
  const equipAdjAtk = sum.atk + (s.baseAtk * (sum.atkPct / 100));

  // 最終攻撃力
  const finalAtk = (s.baseAtk + s.bonusAtk + equipAdjAtk) * (1 + (s.atkUpPct / 100));

  // 係数
  const affinity = s.affinity === 'adv' ? 1.25 : s.affinity === 'dis' ? 0.85 : 1.0;
  const breakMul = s.isBreak ? 1.3 : 1.0;
  const d = Math.max(0, s.enemyDef);
  const defCoeff = Math.exp(-((0.001058 * d) - (0.000000715 * d * d)));

  // 属性合算
  const allElemPct = s.elemDmgUpPct + sum.elemDmgPct;

  // 中間項
  const afterSkillMult = finalAtk * (s.skillPct / 100);
  const afterSkillAdd  = afterSkillMult + s.skillFlat;
  const afterDmgUp     = afterSkillAdd * (1 + (s.dmgUpPct / 100));
  const afterCardUp    = afterDmgUp * (1 + (s.cardDmgUpPct / 100));
  const afterElemUp    = afterCardUp * (1 + (allElemPct / 100));
  const afterAffinity  = afterElemUp * affinity;
  const afterBreak     = afterAffinity * breakMul;
  const afterDefense   = afterBreak * defCoeff;

  const normal = Math.floor(afterDefense);

  const allCritRate = clamp(s.critRate + sum.critRate, 0, 100);
  const allCritDmg = s.critDmg + sum.critDmg;
  const crit = Math.floor(afterDefense * (1 + (allCritDmg / 100)));
  const average = Math.floor(afterDefense * (1 + ((allCritDmg / 100) * (allCritRate / 100))));

  return {
    sums: sum,
    equipAdjAtk,
    finalAtk,
    affinity,
    breakMul,
    defCoeff,
    allElemPct,
    allCritRate,
    allCritDmg,
    afterSkillMult,
    afterSkillAdd,
    afterDmgUp,
    afterCardUp,
    afterElemUp,
    afterAffinity,
    afterBreak,
    afterDefense,
    normal,
    average,
    crit,
  };
}

// ====== 描画 ======
function render() {
  const rA = calcAll(state);
  const rB = compareCtx ? calcAll(compareCtx.state) : null;

  // 合計表示（既存）
  $('#sumEquipAtk').textContent = fmtInt(rA.sums.atk);
  $('#sumEquipAtkPct').textContent = fmtPct(rA.sums.atkPct);
  $('#sumEquipCritRate').textContent = fmtPct(rA.sums.critRate);
  $('#sumEquipCritDmg').textContent = fmtPct(rA.sums.critDmg);
  $('#sumEquipElemDmgPct').textContent = fmtPct(rA.sums.elemDmgPct);

  // 内訳（既存）
  $('#outEquipAdjAtk').textContent = fmtInt(rA.equipAdjAtk);
  $('#outFinalAtk').textContent = fmtInt(rA.finalAtk);
  $('#outAfterSkillMult').textContent = fmt2(rA.afterSkillMult);
  $('#outAfterSkillAdd').textContent = fmt2(rA.afterSkillAdd);
  $('#outAfterDmgUp').textContent = fmt2(rA.afterDmgUp);
  $('#outAfterCardUp').textContent = fmt2(rA.afterCardUp);
  $('#outAllElemPct').textContent = fmtPct(rA.allElemPct);
  $('#outAfterElemUp').textContent = fmt2(rA.afterElemUp);
  $('#outAffinity').textContent = rA.affinity.toFixed(2);
  $('#outAfterAffinity').textContent = fmt2(rA.afterAffinity);
  $('#outBreak').textContent = rA.breakMul.toFixed(2);
  $('#outAfterBreak').textContent = fmt2(rA.afterBreak);
  $('#outDefCoeff').textContent = rA.defCoeff.toFixed(4);
  $('#outAfterDefense').textContent = fmt2(rA.afterDefense);
  $('#outAllCritRate').textContent = fmtPct(rA.allCritRate);
  $('#outAllCritDmg').textContent = fmtPct(rA.allCritDmg);

  // 結果値
  $('#outNormal').textContent = fmtInt(rA.normal);
  $('#outAverage').textContent = fmtInt(rA.average);
  $('#outCrit').textContent = fmtInt(rA.crit);

  // 差分チップ
  const dN = rB ? ((rB.normal  - rA.normal ) / Math.max(1, rA.normal ) * 100) : NaN;
  const dA = rB ? ((rB.average - rA.average) / Math.max(1, rA.average) * 100) : NaN;
  const dC = rB ? ((rB.crit    - rA.crit   ) / Math.max(1, rA.crit   ) * 100) : NaN;
  setDeltaChip($('#deltaNormal'),  rA.normal,  rB ? rB.normal  : NaN);
  setDeltaChip($('#deltaAverage'), rA.average, rB ? rB.average : NaN);
  setDeltaChip($('#deltaCrit'),    rA.crit,    rB ? rB.crit    : NaN);

  // チャート（A=手前, B=奥）
  const max = Math.max(
    1,
    rA.normal, rA.average, rA.crit,
    rB ? rB.normal  : 0,
    rB ? rB.average : 0,
    rB ? rB.crit    : 0
  );
  const seg = (x) => (x / max) * 100;

  // B（奥）
  if (rB) {
    const bN = seg(rB.normal);
    const bA = Math.max(0, seg(rB.average) - bN);
    const bC = Math.max(0, seg(rB.crit) - (bN + bA));
    const set = (el, left, width) => { el.style.left = left + '%'; el.style.width = width + '%'; };
    set($('#barBNormal'), 0, bN);
    set($('#barBAvg'),    bN, bA);
    set($('#barBCrit'),   bN + bA, bC);

    // A（手前）
    const aN = seg(rA.normal);
    const aA = Math.max(0, seg(rA.average) - aN);
    const aC = Math.max(0, seg(rA.crit) - (aN + aA));
    const setA = (el, left, width) => { el.style.left = left + '%'; el.style.width = width + '%'; };
    setA($('#barNormal'), 0, aN);
    setA($('#barAvg'),    aN, aA);
    setA($('#barCrit'),   aN + aA, aC);

    // A > B の部分だけ赤ストライプで可視化（Deficit）
    const defN_left = bN,                defN_w = Math.max(0, aN - bN);
    const defA_left = bN + bA,           defA_w = Math.max(0, (aN + aA) - (bN + bA));
    const defC_left = bN + bA + bC,      defC_w = Math.max(0, (aN + aA + aC) - (bN + bA + bC));
    const setD = (el, left, width) => { el.style.left = left + '%'; el.style.width = width + '%'; };

    setD($('#barDefNormal'), defN_left, defN_w);
    setD($('#barDefAvg'),    defA_left, defA_w);
    setD($('#barDefCrit'),   defC_left, defC_w);
  } else {
    // 比較なし：B/Defは0幅に
    ['#barBNormal','#barBAvg','#barBCrit','#barDefNormal','#barDefAvg','#barDefCrit']
      .forEach(sel => { const el = $(sel); if (el) { el.style.width = '0%'; el.style.left = '0%'; }});
    // A（手前）だけ描く
    const aN = seg(rA.normal);
    const aA = Math.max(0, seg(rA.average) - aN);
    const aC = Math.max(0, seg(rA.crit) - (aN + aA));
    const setA = (el, left, width) => { el.style.left = left + '%'; el.style.width = width + '%'; };
    setA($('#barNormal'), 0, aN);
    setA($('#barAvg'),    aN, aA);
    setA($('#barCrit'),   aN + aA, aC);
  }
}

// ====== 値のセット/取得（入力UIへ反映） ======
function setInputsFromState(s) {
  $('#baseAtk').value = s.baseAtk;
  $('#bonusAtk').value = s.bonusAtk;
  $('#critRate').value = s.critRate;
  $('#critDmg').value = s.critDmg;
  $('#skillPct').value = s.skillPct;
  $('#skillFlat').value = s.skillFlat;
  $('#atkUpPct').value = s.atkUpPct;
  $('#dmgUpPct').value = s.dmgUpPct;
  $('#cardDmgUpPct').value = s.cardDmgUpPct;
  $('#elemDmgUpPct').value = s.elemDmgUpPct;
  $('#enemyDef').value = s.enemyDef;
  $('#affinity').value = s.affinity;
  $('#isBreak').checked = !!s.isBreak;

  // メイン種別/値
  for (const slot of ['emblem','ring','brooch']) {
    const typeSel = $(`select.mainType[data-slot="${slot}"]`);
    if (typeSel) typeSel.value = s.equip[slot].mainType;
  }
  for (const slot of ['glove','armor','emblem','ring','brooch']) {
    const val = s.equip[slot].mainVal;
    const inp = $(`input.mainVal[data-slot="${slot}"]`);
    if (inp) inp.value = val;
    updateMainValState(slot);
  }
  // サブ
  for (const slot of ['glove','armor','emblem','ring','brooch']) {
    for (const k of ['atk','atkPct','critRate','critDmg']) {
      const inp = $(`input[data-sub="${k}"][data-slot="${slot}"]`);
      if (inp) inp.value = s.equip[slot].sub[k];
    }
  }
}

// ====== リセット ======
function resetAll() {
  state = structuredClone(DEFAULTS);
  setInputsFromState(state);
  render();
  // プリセットUIを空白に
  const sel = $('#presetSelect');
  const name = $('#presetName');
  if (sel) { sel.value = ''; sel.selectedIndex = 0; }
  if (name) name.value = '';
  currentPresetName = '';
  captureBaseline();
  refreshCompareSelect();
  updateCompareBadges();
  toast('初期化しました');
}

// ====== 共有URL（Base64圧縮を強制） & ダイアログUX (#1) ======
// LZ-String（簡易組込み）
const LZString = (function(){
  const f = String.fromCharCode;
  const keyStrBase64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  const LZ = {
    compressToBase64: function (input) {
      if (input == null) return "";
      let res = LZ._compress(input, 6, a=>keyStrBase64.charAt(a));
      switch (res.length % 4) { default: case 0: return res; case 1: return res + "==="; case 2: return res + "=="; case 3: return res + "="; }
    },
    decompressFromBase64: function (input) {
      if (input == null) return "";
      if (input === "") return null;
      let buffer = 0, bc = 0, idx = 0, v;
      input = input.replace(/[^A-Za-z0-9\+\/\=]/g, "");
      return LZ._decompress(input.length, 32, function(){
        if (bc % 4 === 0) v = keyStrBase64.indexOf(input.charAt(idx++));
        buffer = (buffer << 6) | v;
        bc = (bc + 1) % 4;
        return (buffer >> (bc*2)) & 0x3F;
      });
    },
    _compress: function (uncompressed, bitsPerChar, getCharFromInt) {
      if (uncompressed == null) return "";
      let i, value,
        context_dictionary= {},
        context_dictionaryToCreate= {},
        context_c="",
        context_wc="",
        context_w="",
        context_enlargeIn= 2,
        context_dictSize= 3,
        context_numBits= 2,
        context_data=[],
        context_data_val=0,
        context_data_position=0,
        ii;

      for (ii = 0; ii < uncompressed.length; ii += 1) {
        context_c = uncompressed.charAt(ii);
        if (!Object.prototype.hasOwnProperty.call(context_dictionary,context_c)) {
          context_dictionary[context_c] = context_dictSize++;
          context_dictionaryToCreate[context_c] = true;
        }
        context_wc = context_w + context_c;
        if (Object.prototype.hasOwnProperty.call(context_dictionary,context_wc)) {
          context_w = context_wc;
        } else {
          if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate,context_w)) {
            if (context_w.charCodeAt(0)<256) {
              for (i=0 ; i<context_numBits ; i++) {
                context_data_val = (context_data_val << 1);
                if (context_data_position == bitsPerChar-1) {
                  context_data_position = 0;
                  context_data.push(getCharFromInt(context_data_val));
                  context_data_val = 0;
                } else {
                  context_data_position++;
                }
              }
              value = context_w.charCodeAt(0);
              for (i=0 ; i<8 ; i++) {
                context_data_val = (context_data_val << 1) | (value&1);
                if (context_data_position == bitsPerChar-1) {
                  context_data_position = 0;
                  context_data.push(getCharFromInt(context_data_val));
                  context_data_val = 0;
                } else {
                  context_data_position++;
                }
                value = value >> 1;
              }
            } else {
              value = 1;
              for (i=0 ; i<context_numBits ; i++) {
                context_data_val = (context_data_val << 1) | value;
                if (context_data_position == bitsPerChar-1) {
                  context_data_position = 0;
                  context_data.push(getCharFromInt(context_data_val));
                  context_data_val = 0;
                } else {
                  context_data_position++;
                }
                value = 0;
              }
              value = context_w.charCodeAt(0);
              for (i=0 ; i<16 ; i++) {
                context_data_val = (context_data_val << 1) | (value&1);
                if (context_data_position == bitsPerChar-1) {
                  context_data_position = 0;
                  context_data.push(getCharFromInt(context_data_val));
                  context_data_val = 0;
                } else {
                  context_data_position++;
                }
                value = value >> 1;
              }
            }
            context_enlargeIn--;
            if (context_enlargeIn == 0) {
              context_enlargeIn = Math.pow(2, context_numBits);
              context_numBits++;
            }
            delete context_dictionaryToCreate[context_w];
          } else {
            value = context_dictionary[context_w];
            for (i=0 ; i<context_numBits ; i++) {
              context_data_val = (context_data_val << 1) | (value&1);
              if (context_data_position == bitsPerChar-1) {
                context_data_position = 0;
                context_data.push(getCharFromInt(context_data_val));
                context_data_val = 0;
              } else {
                context_data_position++;
              }
              value = value >> 1;
            }
          }
          context_enlargeIn--;
          if (context_enlargeIn == 0) {
            context_enlargeIn = Math.pow(2, context_numBits);
            context_numBits++;
          }
          context_dictionary[context_wc] = context_dictSize++;
          context_w = String(context_c);
        }
      }

      if (context_w !== "") {
        if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate,context_w)) {
          if (context_w.charCodeAt(0)<256) {
            for (i=0 ; i<context_numBits ; i++) {
              context_data_val = (context_data_val << 1);
              if (context_data_position == bitsPerChar-1) {
                context_data_position = 0;
                context_data.push(getCharFromInt(context_data_val));
                context_data_val = 0;
              } else {
                context_data_position++;
              }
            }
            value = context_w.charCodeAt(0);
            for (i=0 ; i<8 ; i++) {
              context_data_val = (context_data_val << 1) | (value&1);
              if (context_data_position == bitsPerChar-1) {
                context_data_position = 0;
                context_data.push(getCharFromInt(context_data_val));
                context_data_val = 0;
              } else {
                context_data_position++;
              }
              value = value >> 1;
            }
          } else {
            value = 1;
            for (i=0 ; i<context_numBits ; i++) {
              context_data_val = (context_data_val << 1) | value;
              if (context_data_position == bitsPerChar-1) {
                context_data_position = 0;
                context_data.push(getCharFromInt(context_data_val));
                context_data_val = 0;
              } else {
                context_data_position++;
              }
              value = 0;
            }
            value = context_w.charCodeAt(0);
            for (i=0 ; i<16 ; i++) {
              context_data_val = (context_data_val << 1) | (value&1);
              if (context_data_position == bitsPerChar-1) {
                context_data_position = 0;
                context_data.push(getCharFromInt(context_data_val));
                context_data_val = 0;
              } else {
                context_data_position++;
              }
              value = value >> 1;
            }
          }
          context_enlargeIn--;
          if (context_enlargeIn == 0) {
            context_enlargeIn = Math.pow(2, context_numBits);
            context_numBits++;
          }
          delete context_dictionaryToCreate[context_w];
        } else {
          value = context_dictionary[context_w];
          for (i=0 ; i<context_numBits ; i++) {
            context_data_val = (context_data_val << 1) | (value&1);
            if (context_data_position == bitsPerChar-1) {
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = value >> 1;
          }
        }
      }
      value = 2;
      for (i=0 ; i<context_numBits ; i++) {
        context_data_val = (context_data_val << 1) | (value&1);
        if (context_data_position == bitsPerChar-1) {
          context_data_position = 0;
          context_data.push(getCharFromInt(context_data_val));
          context_data_val = 0;
        } else {
          context_data_position++;
        }
      }

      while (true) {
        context_data_val = (context_data_val << 1);
        if (context_data_position == bitsPerChar-1) {
          context_data.push(getCharFromInt(context_data_val));
          break;
        } else {
          context_data_position++;
        }
      }
      return context_data.join('');
    },
    _decompress: function (length, resetValue, getNextValue) {
      const dictionary = [];
      let next, enlargeIn = 4, dictSize = 4, numBits = 3, entry = "", result = [], bits, resb, maxpower, power;
      const data = { val: getNextValue(0), position: resetValue, index: 1 };

      for (let i = 0; i < 3; i += 1) { dictionary[i] = i; }

      maxpower = Math.pow(2,2); power = 1; bits = 0;
      while (power != maxpower) { resb = data.val & data.position; data.position >>= 1; if (data.position == 0) { data.position = resetValue; data.val = getNextValue(data.index++);} bits |= (resb>0 ? 1:0) * power; power <<= 1; }
      switch (next = bits) {
        case 0:
          maxpower = Math.pow(2,8); power = 1; bits = 0;
          while (power != maxpower) { resb = data.val & data.position; data.position >>= 1; if (data.position == 0) { data.position = resetValue; data.val = getNextValue(data.index++);} bits |= (resb>0 ? 1:0) * power; power <<= 1; }
          entry = f(bits);
          break;
        case 1:
          maxpower = Math.pow(2,16); power = 1; bits = 0;
          while (power != maxpower) { resb = data.val & data.position; data.position >>= 1; if (data.position == 0) { data.position = resetValue; data.val = getNextValue(data.index++);} bits |= (resb>0 ? 1:0) * power; power <<= 1; }
          entry = f(bits);
          break;
        case 2:
          return "";
      }

      dictionary[3] = entry;
      let w = entry;
      result.push(entry);

      while (true) {
        if (data.index > length) return "";
        maxpower = Math.pow(2,numBits); power = 1; bits = 0;
        while (power != maxpower) { resb = data.val & data.position; data.position >>= 1; if (data.position == 0) { data.position = resetValue; data.val = getNextValue(data.index++);} bits |= (resb>0 ? 1:0) * power; power <<= 1; }
        switch (next = bits) {
          case 0:
            maxpower = Math.pow(2,8); power = 1; bits = 0;
            while (power != maxpower) { resb = data.val & data.position; data.position >>= 1; if (data.position == 0) { data.position = resetValue; data.val = getNextValue(data.index++);} bits |= (resb>0 ? 1:0) * power; power <<= 1; }
            dictionary[dictSize++] = f(bits); next = dictSize - 1; enlargeIn--;
            break;
          case 1:
            maxpower = Math.pow(2,16); power = 1; bits = 0;
            while (power != maxpower) { resb = data.val & data.position; data.position >>= 1; if (data.position == 0) { data.position = resetValue; data.val = getNextValue(data.index++);} bits |= (resb>0 ? 1:0) * power; power <<= 1; }
            dictionary[dictSize++] = f(bits); next = dictSize - 1; enlargeIn--;
            break;
          case 2:
            return result.join('');
        }
        if (enlargeIn == 0) { enlargeIn = Math.pow(2, numBits); numBits++; }
        let c;
        if (dictionary[next]) c = dictionary[next];
        else if (next === dictSize) c = w + w.charAt(0);
        else return "";

        result.push(c);
        dictionary[dictSize++] = w + c.charAt(0);
        enlargeIn--;
        w = c;
        if (enlargeIn == 0) { enlargeIn = Math.pow(2, numBits); numBits++; }
      }
    }
  };
  return {
    compressToBase64: LZ.compressToBase64,
    decompressFromBase64: (b64) => { const res = LZ.decompressFromBase64(b64); return res == null ? '' : res; }
  };
})();

function encodeStateShort(s) { try { return LZString.compressToBase64(JSON.stringify(s)); } catch { return ''; } }
function decodeStateShort(b64) { try { const txt = LZString.decompressFromBase64(b64); return JSON.parse(txt); } catch { return null; } }

function enhanceDialog(dlg) {
  if (!dlg) return; // ← 追加（nullガード）

  // ESC で閉じる
  dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') dlg.close(); });
  // 背景クリックで閉じる
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  // フォーカストラップ
  dlg.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusables = dlg.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const list = Array.from(focusables).filter(el => !el.disabled && el.offsetParent !== null);
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  });
}

function buildSharePayload() {
  // 後方互換: 旧URLは state だけ（baseAtk 等を直持ち）
  const payload = { s: state };
  if (compareCtx) payload.cmp = { name: compareCtx.name, s: compareCtx.state };
  return payload;
}

function initShare() {
  const dlg = $('#shareDialog');
  const openerBtn = $('#shareBtn');
  if (!dlg || !openerBtn) return; // ← 追加（どちらか無ければ何もしない）

  enhanceDialog(dlg);

  openerBtn.addEventListener('click', () => {
    dlg.showModal();
    if (!dlg.hasAttribute('tabindex')) dlg.setAttribute('tabindex', '-1');
    openerBtn.blur();
    dlg.focus({ preventScroll: true });
  });
  $('#closeShare')?.addEventListener('click', () => dlg.close());

  const makeUrl = () => {
    const payload = buildSharePayload();
    return `${location.origin}${location.pathname}?z=${encodeURIComponent(encodeStateShort(payload))}`;
  };
  const copy = (fmt) => {
    const url = makeUrl();
    const text = fmt === 'md' ? `[unVEIL the world: ダメージシミュレーター](${url})` : url;
    navigator.clipboard?.writeText(text)
      .then(() => { toast('クリップボードにコピーしました'); dlg.close(); })
      .catch(() => { window.prompt('コピーしてください', text); dlg.close(); });
  };
  $('#copyUrl').addEventListener('click', (e)=>{ e.preventDefault(); copy('url'); });
  $('#copyMd').addEventListener('click',  (e)=>{ e.preventDefault(); copy('md');  });
}

function initHelp() {
  const dlg = $('#helpDialog');
  const btn = $('#helpBtn');
  if (!dlg || !btn) return;
  enhanceDialog(dlg);
  btn.addEventListener('click', () => {
    dlg.showModal();
    if (!dlg.hasAttribute('tabindex')) dlg.setAttribute('tabindex','-1');
    btn.blur();
    dlg.focus({ preventScroll: true });
  });
  $('#closeHelp')?.addEventListener('click', () => dlg.close());
}

function applyQueryParams(qs) {
  const p = new URLSearchParams(qs);
  const getN = (k, d=0) => toNum(p.get(k) ?? d);
  const getS = (k, d='') => (p.get(k) ?? d);
  state.baseAtk = getN('ba', DEFAULTS.baseAtk);
  state.bonusAtk = getN('bo', 0);
  state.critRate = getN('cr', DEFAULTS.critRate);
  state.critDmg = getN('cd', DEFAULTS.critDmg);
  state.skillPct = getN('sp', DEFAULTS.skillPct);
  state.skillFlat = getN('sf', 0);
  state.atkUpPct = getN('au', 0);
  state.dmgUpPct = getN('du', 0);
  state.cardDmgUpPct = getN('cu', 0);
  state.elemDmgUpPct = getN('eu', 0);
  state.enemyDef = getN('ed', 0);
  state.affinity = getS('af', 'none');
  state.isBreak = getN('br', 0) === 1;
  for (const slot of ['glove','armor','emblem','ring','brooch']) {
    const g = state.equip[slot]; const key = slot[0];
    g.mainType = getS(`${key}t`, g.mainType);
    g.mainVal = getN(`${key}v`, 0);
    g.sub.atk = getN(`${key}sa`, 0);
    g.sub.atkPct = getN(`${key}sp`, 0);
    g.sub.critRate = getN(`${key}sr`, 0);
    g.sub.critDmg = getN(`${key}sd`, 0);
  }
}

// ====== 折りたたみ状態 永続化 ======
const COLLAPSE_KEY = 'uvt-collapse-v1';
function initCollapsePersistence() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}'); } catch {}
  $$('details.card[id]').forEach(d => {
    if (Object.prototype.hasOwnProperty.call(saved, d.id)) d.open = !!saved[d.id];
    d.addEventListener('toggle', () => {
      const cur = (() => { try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}'); } catch { return {}; }})();
      cur[d.id] = d.open;
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(cur));
    });
  });
}

// ====== プリセット ======
const STORAGE_KEY = 'uvt-presets-v1';
function loadPresets() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; } }
function savePresets(map) { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); }
function refreshPresetSelect() {
  const sel = $('#presetSelect');
  const map = loadPresets();
  sel.innerHTML = '';

  // 非表示のプレースホルダ（選択はできない／リストにも出ない）
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = '';
  ph.disabled = true;
  ph.hidden = true;
  sel.appendChild(ph);

  Object.keys(map).sort().forEach((k) => {
    const o = document.createElement('option');
    o.value = k; o.textContent = k;
    sel.appendChild(o);
  });

  // 現在の選択に合わせて表示
  if (currentPresetName && map[currentPresetName]) {
    sel.value = currentPresetName;
  } else {
    sel.value = '';
    sel.selectedIndex = 0; // プレースホルダを表示
  }
}

function initPresets() {
  refreshPresetSelect();

  $('#savePreset').addEventListener('click', () => {
    let name = $('#presetName').value.trim();
    if (!name) { toast('プリセット名を入力してください'); return; }
    const map = loadPresets();
    map[name] = state; savePresets(map);
    currentPresetName = name;
    refreshPresetSelect();
    $('#presetSelect').value = name;
    captureBaseline();
    refreshCompareSelect();
    updateCompareBadges();
    toast('プリセットを保存しました');
  });

  $('#renamePreset').addEventListener('click', () => {
    const cur = $('#presetSelect').value;
    const name = $('#presetName').value.trim();
    if (!cur) { toast('変更するプリセットを選択してください'); return; }
    if (!name) { toast('新しい名前を入力してください'); return; }
    const map = loadPresets();
    if (!map[cur]) { toast('指定のプリセットが見つかりません'); return; }
    map[name] = map[cur]; delete map[cur]; savePresets(map);
    currentPresetName = name;
    refreshPresetSelect();
    $('#presetSelect').value = name;
    captureBaseline();
    refreshCompareSelect();
    updateCompareBadges();
    toast('名前を変更しました');
  });

  $('#deletePreset').addEventListener('click', () => {
    const cur = $('#presetSelect').value;
    if (!cur) { toast('削除するプリセットを選択してください'); return; }
    if (!confirm('選択中のプリセットを削除します。よろしいですか？')) return;
    const map = loadPresets(); delete map[cur]; savePresets(map);
    refreshPresetSelect();
    $('#presetSelect').value = '';
    $('#presetName').value = '';
    currentPresetName = '';
    captureBaseline();
    refreshCompareSelect();
    updateCompareBadges();
    toast('削除しました');
  });

  $('#presetSelect').addEventListener('change', (e) => {
    const sel = e.target;
    const newName = sel.value;
    const map = loadPresets();

    // 同じ選択なら何もしない
    if (newName === currentPresetName) return;

    // 未保存の変更があれば確認
    if (isDirty()) {
      const ok = confirm('未保存の変更があります。破棄して切り替えますか？');
      if (!ok) {
        // 選択を元に戻す
        if (currentPresetName && map[currentPresetName]) {
          sel.value = currentPresetName;
        } else {
          sel.value = '';
          sel.selectedIndex = 0;
        }
        return;
      }
    }

    // 実際の切替
    if (!newName || !map[newName]) {
      // （通常はplaceholderは選べない想定。ここは念のため）
      $('#presetName').value = '';
      currentPresetName = '';
      refreshPresetSelect();
      return;
    }

    state = structuredClone(map[newName]);
    $('#presetName').value = newName;
    currentPresetName = newName;
    setInputsFromState(state);
    render();
    captureBaseline();
    refreshCompareSelect();
    updateCompareBadges();
    toast('プリセットを読み込みました');
  });
}

function initCompare() {
  refreshCompareSelect();

  $('#compareSelect')?.addEventListener('change', (e) => {
    const name = e.target.value;
    const map = loadPresets();
    if (!name) { // 比較なし
      compareCtx = null;
      $('#compareSave')?.setAttribute('hidden','');
      refreshCompareSelect();
      scheduleRender();
      return;
    }
    if (!map[name]) return;
    compareCtx = { name, state: structuredClone(map[name]), transient: false };
    $('#compareSave')?.setAttribute('hidden','');
    refreshCompareSelect();
    scheduleRender();
  });

  $('#compareClear')?.addEventListener('click', () => {
    compareCtx = null;
    $('#compareSave')?.setAttribute('hidden','');
    refreshCompareSelect(); // ← セレクトを（比較なし）へ
    scheduleRender();
  });

  $('#compareSwap')?.addEventListener('click', () => {
    if (!compareCtx) { toast('比較対象を選択してください'); return; }
    // いまのA名称を確保 → AとBの「表示名」を入替
    const prevAName = getAName();

    // 状態を入替
    const tmp = structuredClone(compareCtx.state);
    compareCtx.state = structuredClone(state);
    state = tmp;

    // A側の“現在プリセット名”をBの名前に、B側の名前を旧A名に差し替え
    currentPresetName = compareCtx.name || '';
    compareCtx.name = prevAName;

    setInputsFromState(state);
    render();
    captureBaseline?.();        // 使っていれば
    refreshCompareSelect();     // セレクト/バッジも更新
  });

  $('#compareSave')?.addEventListener('click', () => {
    if (!compareCtx) return;
    const map = loadPresets();
    let name = compareCtx.name || '共有プリセット';
    if (map[name]) {
      if (!confirm(`「${name}」は既に存在します。上書きしますか？`)) {
        const alt = prompt('別名で保存', name + ' (1)');
        if (!alt) return;
        name = alt;
      }
    }
    map[name] = compareCtx.state;
    savePresets(map);
    compareCtx.name = name;
    compareCtx.transient = false;
    refreshPresetSelect();
    refreshCompareSelect();
    $('#compareSave')?.setAttribute('hidden','');
    toast('比較対象を保存しました');
  });
}

// ====== 0フレンドリー入力 ======
function initZeroFriendlyInputs() {
  $$('input[type="number"]').forEach((el) => {
    el.addEventListener('focus', () => {
      if (el.value === '0') { el.dataset.wasZero = '1'; el.value = ''; el.placeholder = '0'; }
    });
    el.addEventListener('blur', () => {
      if ((el.value === '' || el.value == null) && el.dataset.wasZero === '1') {
        el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      el.placeholder = ''; delete el.dataset.wasZero;
    });
  });
}

// ====== 初期化 ======
function initFromQueryOrDefaults() {
  const qs = location.search.slice(1);
  if (qs) {
    const p = new URLSearchParams(qs);
    const z = p.get('z');
    if (z) {
      const decoded = decodeStateShort(z);
      if (decoded) {
        // 互換: 旧形式か新形式か
        if (decoded.baseAtk !== undefined) {
          state = decoded;               // 旧：stateのみ
          compareCtx = null;
        } else if (decoded.s) {
          state = decoded.s;             // 新：{ s, cmp? }
          if (decoded.cmp && decoded.cmp.s) {
            compareCtx = { name: decoded.cmp.name || '共有プリセット', state: decoded.cmp.s, transient: true };
            $('#compareSave')?.removeAttribute('hidden'); // 保存ボタンを出す
          } else {
            compareCtx = null;
            $('#compareSave')?.setAttribute('hidden','');
          }
        }
      } else {
        applyQueryParams(qs); // フォールバック
      }
    } else {
      state = structuredClone(DEFAULTS);
    }
  } else {
    state = structuredClone(DEFAULTS);
  }
  setInputsFromState(state);
  render();
  currentPresetName = '';   // 起動直後はプリセット未選択として扱う
  captureBaseline();        // 現状を基準に（未編集）
  refreshCompareSelect();
  updateCompareBadges();
}

function initReset() {
  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('すべての入力を初期化します。よろしいですか？')) return;
    resetAll();
  });
}

// Kickoff
window.addEventListener('DOMContentLoaded', () => {
  ensureStorageMigrations();
  initCollapsePersistence();
  initTheme();
  bindInputs();
  initFromQueryOrDefaults();
  initShare();
  initHelp();
  initPresets();
  initCompare();
  initComparePicker();
  initReset();
  initZeroFriendlyInputs();
});
