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
let currentPresetName = '';
// いま入力UIとリンクしているサイドのスナップショットを比較する
const snapshotLinked = () => JSON.stringify(getSideState(linkedSide) ?? {});
const captureBaseline = () => { baselineJSON = snapshotLinked(); };
const isDirty = () => {
  try { return snapshotLinked() !== baselineJSON; }
  catch { return true; }
};

// ====== 比較の概念：Side と Role を分離 ======
// sideA … 片方のサイド（初期は「現在」=入力にリンク）
// sideB … もう片方（初期は未設定）
// roleMap.base … 画面上「比較元」に表示するサイドID（'A' or 'B'）
// roleMap.comp … 画面上「比較先」に表示するサイドID（'A' or 'B'）
// linkedSide … 入力UIが書き込むサイドID（'A' or 'B'）
let linkedSide = 'A';
let roleMap = { base: 'A', comp: 'B' }; // 入替で base/comp を入れ替えるだけ

function getSideState(id) { return (id === linkedSide) ? state : (compareCtx ? compareCtx.state : null); }
function setSideState(id, newState) {
  if (id === linkedSide) { state = structuredClone(newState); }
  else {
    if (!compareCtx) compareCtx = { name: '', state: structuredClone(newState), transient: false };
    else compareCtx.state = structuredClone(newState);
  }
}
function other(id){ return id === 'A' ? 'B' : 'A'; }
function baseState(){ return getSideState(roleMap.base); }
function compState(){ return getSideState(roleMap.comp); }
function baseName(){
  if (roleMap.base === linkedSide) return getAName();
  return compareCtx ? compareCtx.name || '（未命名）' : 'なし';
}
function compName(){
  if (roleMap.comp === linkedSide) return getAName();
  return compareCtx ? compareCtx.name || '（未命名）' : 'なし';
}

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
  const aNameEl = $('#badgeAName');
  const bWrap = $('#badgeB');
  const bNameEl = $('#badgeBName');

  if (aNameEl) aNameEl.textContent = baseName();
  if (bWrap && bNameEl) {
    const name = compName();
    bWrap.hidden = false;
    if (!compState()) { bWrap.classList.add('empty'); bNameEl.textContent = 'なし'; }
    else { bWrap.classList.remove('empty'); bNameEl.textContent = name; }
  }

  // ★ どちらがリンク中かを“🔗”で可視化
  const chipA = $('#linkChipA');
  const chipB = $('#linkChipB');
  if (chipA && chipB) {
    const baseIsLinked = (roleMap.base === linkedSide);
    chipA.hidden = !baseIsLinked;
    chipB.hidden =  baseIsLinked;
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
    const map = loadPresets();

    // 候補一覧の作成
    let names = Object.keys(map).sort();
    if (kw) names = names.filter(n => n.toLowerCase().includes(kw));

    // Bモードのときだけ、URL由来の一時比較（compareCtx）も候補に含める
    if (mode === 'B' && compareCtx && !map[compareCtx.name] &&
        (!kw || compareCtx.name.toLowerCase().includes(kw))) {
      names.push(compareCtx.name + '（URL）');
    }

    listEl.innerHTML = '';
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
          // ====== G) 比較先（非リンク側）に適用 ======
          // 1) 変更先サイドは「リンクしていない方」
          const targetSide = (linkedSide === 'A') ? 'B' : 'A';

          // 2) URL由来（displayNameに「（URL）」）か、保存済みプリセットかで分岐
          const isURLPreset = /（URL）$/.test(displayName);

          if (isURLPreset) {
            // URL由来：compareCtx.state は既に存在する想定。名前を整えるだけ
            if (!compareCtx) {
              // 念のため保険。URL経由で比較のみ表示されている可能性
              compareCtx = { name: realName, state: structuredClone(getSideState(targetSide) || {}), transient: true };
            }
            compareCtx.name = realName;
            compareCtx.transient = true;
            $('#compareSave')?.removeAttribute('hidden');
          } else {
            // 保存済みプリセット：非リンク側の state を差し替え
            setSideState(targetSide, map[realName]);
            if (!compareCtx) {
              compareCtx = { name: realName, state: getSideState(targetSide), transient: true };
            } else {
              compareCtx.name = realName;
              compareCtx.transient = false;
            }
            $('#compareSave')?.setAttribute('hidden','');
          }

          // 3) 画面反映
          refreshCompareSelect();
          updateCompareBadges();
          scheduleRender();
          closeSheet();
        } else {
          // ====== H) 比較元に適用（役割ベース） ======
          // 対象サイドは「比較元（roleMap.base）」のサイド
          const targetSide = roleMap.base;

          // 1) targetSide が “リンクしている側” の場合は「直接変更」に該当 → 未保存確認
          const modifyingLinked = (targetSide === linkedSide);
          if (modifyingLinked && typeof isDirty === 'function' && isDirty()) {
            const ok = confirm('未保存の変更があります。破棄して置き換えますか？');
            if (!ok) return;
          }

          // 2) 旧比較元の退避（“直接変更”のときは旧A→Bに回すため）
          const prevState = structuredClone(getSideState(targetSide));
          const prevName  = (targetSide === linkedSide)
            ? ((linkedSide === 'A') ? (currentPresetName || '現在') : (compareCtx?.name || '現在'))
            : (compareCtx?.name || '（未命名）');

          // 3) 比較元へ適用
          setSideState(targetSide, map[realName]);

          // 4) リンク側を変更したなら UI/名前を同期
          if (targetSide === linkedSide) {
            // 入力UIに反映
            if (typeof setInputsFromState === 'function') {
              setInputsFromState(getSideState(linkedSide));
            }
            // 名前も同期
            if (linkedSide === 'A') currentPresetName = realName;
            else {
              if (!compareCtx) compareCtx = { name: realName, state: getSideState('A'), transient: false };
              else compareCtx.name = realName; // linked=Bなら compareCtx がA側名を持つ
            }
            render();
            
            // ★ プリセット名をリンク側の“現在”として同期
            currentPresetName = realName;
            const pn = $('#presetName');
            if (pn) pn.value = realName;
            refreshPresetSelect();
            const ps = $('#presetSelect');
            if (ps) ps.value = realName;
            captureBaseline?.();

            // 旧比較元を比較先へ回す（素早く比較できるように）
            const toSide = (linkedSide === 'A') ? 'B' : 'A';
            setSideState(toSide, prevState);
            if (!compareCtx) compareCtx = { name: prevName, state: getSideState(toSide), transient: false };
            else compareCtx.name = prevName;
            $('#compareSave')?.setAttribute('hidden','');
          } else {
            // 非リンク側（=間接変更）の場合は state だけ更新（UIは現状維持）
            if (!compareCtx) compareCtx = { name: realName, state: getSideState(targetSide), transient: false };
            else compareCtx.name = realName;
            $('#compareSave')?.setAttribute('hidden','');
          }

          // 5) 画面反映
          refreshPresetSelect();
          refreshCompareSelect();
          updateCompareBadges();
          scheduleRender();
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
    dlg.show();
    q.value = '';
    build('');
    // ★ 初期フォーカスはダイアログ本体へ（自動で検索欄に当たるのを防ぐ）
    // q.focus({ preventScroll: true });


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
    el.addEventListener('input', () => {
      const s = getSideState(linkedSide);
      s[key] = toNum(el.value);
      scheduleRender();
    });
  });

  $('#affinity').addEventListener('change', (e) => { getSideState(linkedSide).affinity = e.target.value; scheduleRender(); });
  $('#isBreak').addEventListener('change', (e) => { getSideState(linkedSide).isBreak = !!e.target.checked; scheduleRender(); });

  // 装備: メイン種別
  $$('.mainType').forEach((sel) => {
    sel.addEventListener('change', () => {
      const slot = sel.dataset.slot;
      getSideState(linkedSide).equip[slot].mainType = sel.value;
      updateMainValState(slot);
      scheduleRender();
    });
  });
  // 装備: メイン値
  $$('.mainVal').forEach((inp) => {
    inp.addEventListener('input', () => {
      const slot = inp.dataset.slot;
      const fixedType = inp.dataset.mainType; // glove/armor 固定
      if (fixedType) getSideState(linkedSide).equip[slot].mainType = fixedType;
      getSideState(linkedSide).equip[slot].mainVal = toNum(inp.value);
      scheduleRender();
    });
  });
  // 装備: サブ
  $$('input[data-sub]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const slot = inp.dataset.slot; const k = inp.dataset.sub;
      getSideState(linkedSide).equip[slot].sub[k] = toNum(inp.value);
      scheduleRender();
    });
  });
}

// メインが"other"のときメイン値入力を無効化＆空白表示
function updateMainValState(slot) {
  const gear = getSideState(linkedSide).equip[slot];
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
  const sBase = baseState();
  const sComp = compState();

  const rBase = sBase ? calcAll(sBase) : null;
  const rComp = sComp ? calcAll(sComp) : null;

  // ——— 合計/内訳/結果（表示は rBase を主、差分は rComp との比較） ———
  const R = rBase || calcAll(getSideState(linkedSide)); // 念のため
  // 合計（装備合計）
  $('#sumEquipAtk').textContent = fmtInt(R.sums.atk);
  $('#sumEquipAtkPct').textContent = fmtPct(R.sums.atkPct);
  $('#sumEquipCritRate').textContent = fmtPct(R.sums.critRate);
  $('#sumEquipCritDmg').textContent = fmtPct(R.sums.critDmg);
  $('#sumEquipElemDmgPct').textContent = fmtPct(R.sums.elemDmgPct);

  // 内訳（R = rBase）
  $('#outEquipAdjAtk').textContent = fmtInt(R.equipAdjAtk);
  $('#outFinalAtk').textContent = fmtInt(R.finalAtk);
  $('#outAfterSkillMult').textContent = fmt2(R.afterSkillMult);
  $('#outAfterSkillAdd').textContent = fmt2(R.afterSkillAdd);
  $('#outAfterDmgUp').textContent = fmt2(R.afterDmgUp);
  $('#outAfterCardUp').textContent = fmt2(R.afterCardUp);
  $('#outAllElemPct').textContent = fmtPct(R.allElemPct);
  $('#outAfterElemUp').textContent = fmt2(R.afterElemUp);
  $('#outAffinity').textContent = R.affinity.toFixed(2);
  $('#outAfterAffinity').textContent = fmt2(R.afterAffinity);
  $('#outBreak').textContent = R.breakMul.toFixed(2);
  $('#outAfterBreak').textContent = fmt2(R.afterBreak);
  $('#outDefCoeff').textContent = R.defCoeff.toFixed(4);
  $('#outAfterDefense').textContent = fmt2(R.afterDefense);
  $('#outAllCritRate').textContent = fmtPct(R.allCritRate);
  $('#outAllCritDmg').textContent = fmtPct(R.allCritDmg);

  // 結果値
  $('#outNormal').textContent = fmtInt(R.normal);
  $('#outAverage').textContent = fmtInt(R.average);
  $('#outCrit').textContent = fmtInt(R.crit);

  // 差分（comp がある時のみ）
  setDeltaChip($('#deltaNormal'),  R.normal,  rComp ? rComp.normal  : NaN);
  setDeltaChip($('#deltaAverage'), R.average, rComp ? rComp.average : NaN);
  setDeltaChip($('#deltaCrit'),    R.crit,    rComp ? rComp.crit    : NaN);

  // チャート（手前=比較元、奥=比較先）
  const max = Math.max(
    1,
    R.normal, R.average, R.crit,
    rComp ? rComp.normal  : 0,
    rComp ? rComp.average : 0,
    rComp ? rComp.crit    : 0
  );
  const seg = (x)=> (x / max) * 100;

  // 奥：比較先
  if (rComp) {
    const bN=seg(rComp.normal), bA=Math.max(0, seg(rComp.average)-bN), bC=Math.max(0, seg(rComp.crit)-(bN+bA));
    const set=(el,l,w)=>{ el.style.left=l+'%'; el.style.width=w+'%'; };
    set($('#barBNormal'), 0, bN); set($('#barBAvg'), bN, bA); set($('#barBCrit'), bN+bA, bC);
  } else ['#barBNormal','#barBAvg','#barBCrit'].forEach(sel=>{ const el=$(sel); if(el){el.style.width='0%'; el.style.left='0%';}});

  // 手前：比較元
  const aN=seg(R.normal), aA=Math.max(0, seg(R.average)-aN), aC=Math.max(0, seg(R.crit)-(aN+aA));
  const setA=(el,l,w)=>{ el.style.left=l+'%'; el.style.width=w+'%'; };
  setA($('#barNormal'), 0, aN); setA($('#barAvg'), aN, aA); setA($('#barCrit'), aN+aA, aC);

  // A > B の赤ストライプ（Deficit）
  if (rComp) {
    const bN=seg(rComp.normal), bA=Math.max(0, seg(rComp.average)-bN), bC=Math.max(0, seg(rComp.crit)-(bN+bA));
    const defN = Math.max(0, aN - bN);
    const defA = Math.max(0, (aN+aA) - (bN+bA));
    const defC = Math.max(0, (aN+aA+aC) - (bN+bA+bC));
    const setD=(el,l,w)=>{ el.style.left=l+'%'; el.style.width=w+'%'; };
    setD($('#barDefNormal'), bN, defN);
    setD($('#barDefAvg'),    bN+bA, defA);
    setD($('#barDefCrit'),   bN+bA+bC, defC);
  } else ['#barDefNormal','#barDefAvg','#barDefCrit'].forEach(sel=>{ const el=$(sel); if(el){el.style.width='0%'; el.style.left='0%'; }});
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
  setSideState(linkedSide, DEFAULTS);
  setInputsFromState(getSideState(linkedSide));
  render();
  // プリセットUIを空白に
  const sel = $('#presetSelect');
  const name = $('#presetName');
  if (sel) { sel.value = ''; sel.selectedIndex = 0; }
  if (name) name.value = '';
  if (linkedSide === 'A') currentPresetName = '';
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
  getSideState(linkedSide).baseAtk = getN('ba', DEFAULTS.baseAtk);
  getSideState(linkedSide).bonusAtk = getN('bo', 0);
  getSideState(linkedSide).critRate = getN('cr', DEFAULTS.critRate);
  getSideState(linkedSide).critDmg = getN('cd', DEFAULTS.critDmg);
  getSideState(linkedSide).skillPct = getN('sp', DEFAULTS.skillPct);
  getSideState(linkedSide).skillFlat = getN('sf', 0);
  getSideState(linkedSide).atkUpPct = getN('au', 0);
  getSideState(linkedSide).dmgUpPct = getN('du', 0);
  getSideState(linkedSide).cardDmgUpPct = getN('cu', 0);
  getSideState(linkedSide).elemDmgUpPct = getN('eu', 0);
  getSideState(linkedSide).enemyDef = getN('ed', 0);
  getSideState(linkedSide).affinity = getS('af', 'none');
  getSideState(linkedSide).isBreak = getN('br', 0) === 1;
  for (const slot of ['glove','armor','emblem','ring','brooch']) {
    const g = getSideState(linkedSide).equip[slot]; const key = slot[0];
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
    const name = sel.value;
    const map  = loadPresets();
    if (!name || !map[name]) return;

    // リンク側に未保存の変更があるなら確認
    if (isDirty()) {
      const ok = confirm('未保存の変更があります。破棄して切り替えますか？');
      if (!ok) {
        // 元の表示へ戻す（リンク側がAなら currentPresetName、Bなら compareCtx?.name）
        const revert = (linkedSide === 'A') ? (currentPresetName || '') : (compareCtx?.name || '');
        sel.value = revert;
        return;
      }
    }

    // 1) プリセットを「リンク側」に適用
    setSideState(linkedSide, map[name]);

    // 2) 名前同期（リンク側がAなら currentPresetName、Bなら compareCtx.name）
    if (linkedSide === 'A') {
      currentPresetName = name;
    } else {
      if (!compareCtx) compareCtx = { name, state: getSideState(linkedSide), transient: false };
      else { compareCtx.name = name; compareCtx.transient = false; }
    }

    // 3) 入力UIへ反映 → 描画 → ベースライン確定
    setInputsFromState(getSideState(linkedSide));
    render();
    captureBaseline();

    // 4) UIまわりの更新
    $('#presetName').value = name;
    refreshPresetSelect();
    refreshCompareSelect();
    updateCompareBadges();
    toast('プリセットを読み込みました');
  });
}

function initCompare() {
  refreshCompareSelect();

  $('#compareSelect').addEventListener('change', (e) => {
    const name = e.target.value;
    const map  = loadPresets();
    if (!name || !map[name]) return;

    const targetSide = (linkedSide === 'A') ? 'B' : 'A';
    setSideState(targetSide, map[name]);
    if (!compareCtx) compareCtx = { name, state: getSideState(targetSide), transient:false };
    else { compareCtx.name = name; compareCtx.transient = false; }

    refreshCompareSelect();
    updateCompareBadges();
    scheduleRender();
  });

  $('#compareClear')?.addEventListener('click', () => {
    compareCtx = null;
    $('#compareSave')?.setAttribute('hidden','');
    refreshCompareSelect(); // ← セレクトを（比較なし）へ
    scheduleRender();
  });

  $('#compareSwap')?.addEventListener('click', () => {
    // 役割だけ反転（linkedSide は変えない）
    const tmp = roleMap.base;
    roleMap.base = roleMap.comp;
    roleMap.comp = tmp;
    refreshCompareSelect(); // セレクト既定値の整合
    updateCompareBadges();
    scheduleRender();
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

  setInputsFromState(getSideState(linkedSide));
  render();
  linkedSide = 'A';                 // 初期はAが入力リンク
  roleMap   = { base:'A', comp:'B'}; // 役割はA=比較元, B=比較先
  currentPresetName = currentPresetName || ''; // そのまま
  captureBaseline();
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
