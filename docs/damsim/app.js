/**
 * unVEIL the world ダメージシミュレーター
 *
 * 構造メモ:
 * - 状態管理:
 *   - state       … 入力UIとリンクしている側（linkedSide）の状態
 *   - compareCtx  … 非リンク側の状態＋名前（比較先）
 *   - linkedSide  … 'A' | 'B' （UIとリンクしている側。基本 'A'）
 *   - roleMap     … { base: 'A'|'B', comp: 'A'|'B' } 比較元/比較先の役割
 *
 * - 主な処理ブロック:
 *   - ストレージ/プリセット管理
 *   - URL共有 (LZ-String 圧縮)
 *   - 比較A/B管理
 *   - 入力バインド / 再描画(render)
 *   - UIまわり (トースト・ダイアログ・ヘルプ等)
 */

// ====== ユーティリティ ======
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const MATH_EXPR_RE = /^[0-9+\-*/().×÷＋－\s]+$/;
const MATH_SYMBOL_MAP = { '×': '*', '÷': '/', '＋': '+', '－': '-' };
const normalizeMathSymbols = (str) => str.replace(/[×÷＋－]/g, (ch) => MATH_SYMBOL_MAP[ch] || ch);
// 数式入力を許容するための軽量パーサ（許可記号以外は無視してフォールバック）
function evalMathExpression(v) {
  if (v === null || v === undefined) return null;
  const raw = typeof v === 'string' ? v : String(v);
  const cleaned = normalizeMathSymbols(raw.replace(/,/g, '').trim());
  if (!cleaned || !MATH_EXPR_RE.test(cleaned)) return null;
  const normalized = cleaned.replace(/\s+/g, '');
  // 許可外の演算子連続（//, ** 等）は弾く
  if (/\/{2,}|\*{2,}/.test(normalized)) return null;
  try {
    const val = Function('"use strict"; return (' + normalized + ');')();
    return Number.isFinite(val) ? val : null;
  } catch { return null; }
}
// readNumber: カンマ区切りや空文字・簡易数式をまとめて扱い、数値以外はフォールバックに倒す
const readNumber = (v, fallback = 0) => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') {
    const txt = v.replace(/,/g, '').trim();
    if (!txt) return fallback;
    const exprVal = evalMathExpression(txt);
    if (exprVal !== null) return exprVal;
    if (!MATH_EXPR_RE.test(txt)) return fallback;
    const n = Number(txt);
    return Number.isFinite(n) ? n : fallback;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
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

/**
 * 現在の状態を取得するヘルパー。
 * - linkedSide === id のとき: 入力UIと同期している「メイン状態 state」
 * - それ以外: compareCtx.state（比較相手）を返す
 */
function getSideState(id) { return (id === linkedSide) ? state : (compareCtx ? compareCtx.state : null); }

/**
 * A/B どちらかの状態を丸ごと差し替える。
 * - linkedSide 側を書き換えると、入力UI側の state が差し替わる
 * - 非リンク側を書き換えると、compareCtx.state が差し替わる
 */
function setSideState(id, newState) {
  const next = normalizeStateShape(newState);
  if (id === linkedSide) { state = next; }
  else {
    if (!compareCtx) compareCtx = { name: '', state: next, transient: false };
    else compareCtx.state = next;
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

function ensureSummaryHint(detailsId){
  const d = document.getElementById(detailsId);
  if (!d) return null;
  const sum = d.querySelector('summary');
  if (!sum) return null;
  let hint = sum.querySelector('.g-hint');
  if (!hint){
    hint = document.createElement('span');
    hint.className = 'g-hint';
    sum.appendChild(hint);
  }
  return hint;
}
function pctStr(n){ return (Math.round(n*10)/10) + '%'; }
function nonZeroPairs(obj){
  return Object.entries(obj).filter(([,v]) => Math.abs(+v||0) > 0);
}

function renderHintBadges(el, items, fallback='—') {
  if (!el) return;
  const available = (items || []).filter((item) => item && (item.always || Math.abs(item.value ?? 0) > 0));
  if (!available.length) {
    el.textContent = fallback;
    return;
  }
  el.innerHTML = '';
  available.forEach((item) => {
    const span = document.createElement('span');
    const val = item.format ? item.format(item.value) : item.value;
    span.className = `hint-badge${item.type ? ` hint-badge-${item.type}` : ''}`;
    span.textContent = `${item.label}${val}`;
    el.appendChild(span);
  });
}

const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

function blurSelfOnClick(sel) {
  const el = document.querySelector(sel);
  if (!el) return;
  el.addEventListener('click', (e) => {
    if (isTouch) {
      // 直ちに hover/focus を外す
      e.currentTarget.blur?.();
    }
  });
}

/* 現在の“リンク側”の状態から各グループのサマリを作る */
function updateGroupHints(){
  const s = getSideState(linkedSide);
  if (!s) return;
  const r = calcAll(s); // 合計/中間値を使いたいので計算
  const mode = s.inputMode || 'gear';

  {
    const el = ensureSummaryHint('grpMode');
    if (el) el.textContent = MODE_META[mode]?.label || '—';
  }

  // プリセット
  {
    const el = ensureSummaryHint('grpPreset');
    if (el) el.textContent = `選択: ${currentPresetName || '未選択'}`;
  }

  // ステータス
  {
    const el = ensureSummaryHint('grpStatus');
    if (el) {
      const atkLabel = mode === 'simple' || mode === 'standard' ? '攻' : '基礎';
      const atkVal = mode === 'simple' ? r.finalAtk : mode === 'standard' ? (s.preAtkInput || 0) : (s.baseAtk || 0);
      const bonus = (mode === 'gear') ? [{ label: '補正', value: s.bonusAtk || 0, type: 'atk', format: fmtInt, always: true }] : [];
      const badges = [
        { label: `${atkLabel}`, value: atkVal, type: 'atk', format: fmtInt, always: true },
        ...bonus,
        { label: '会率', value: r.allCritRate, type: 'crit', format: pctStr },
        { label: '会ダメ', value: r.allCritDmg, type: 'critdmg', format: pctStr },
        { label: '属ダメ', value: r.allElemPct, type: 'elem', format: pctStr },
      ];
      renderHintBadges(el, badges, '—');
    }
  }

  // 装備（合計値）
  {
    const el = ensureSummaryHint('grpEquip');
    if (el){
      if (mode === 'simple') {
        el.textContent = '簡易入力中';
      } else if (mode === 'standard') {
        const badges = [
          { label: '会率', value: r.sums.critRate || 0, type: 'crit', format: pctStr },
          { label: '会ダメ', value: r.sums.critDmg || 0, type: 'critdmg', format: pctStr },
          { label: '属ダメ', value: r.sums.elemDmgPct || 0, type: 'elem', format: pctStr },
        ];
        renderHintBadges(el, badges, '会/属のみ参照');
      } else {
        const badges = [
          { label: '攻', value: r.sums.atk || 0, type: 'atk', format: fmtInt },
          { label: '攻%', value: r.sums.atkPct || 0, type: 'atk', format: pctStr },
          { label: '会率', value: r.sums.critRate || 0, type: 'crit', format: pctStr },
          { label: '会ダメ', value: r.sums.critDmg || 0, type: 'critdmg', format: pctStr },
          { label: '属ダメ', value: r.sums.elemDmgPct || 0, type: 'elem', format: pctStr },
        ];
        renderHintBadges(el, badges, '—');
      }
    }
  }

  // スキル
  {
    const el = ensureSummaryHint('grpSkill');
    if (el) {
      const badges = [
        { label: '倍率', value: s.skillPct || 0, type: 'skill', format: pctStr },
        { label: '固定', value: s.skillFlat || 0, type: 'skill', format: fmtInt },
      ];
      renderHintBadges(el, badges, '—');
    }
  }

  // 戦闘中効果（0は省略）
  {
    const el = ensureSummaryHint('grpBattle');
    if (el){
      const badges = [
        { label: '攻', value: mode === 'simple' ? 0 : (s.atkUpPct || 0), type: 'atk', format: pctStr },
        { label: 'ダメ', value: s.dmgUpPct || 0, type: 'skill', format: pctStr },
        { label: 'カード', value: s.cardDmgUpPct || 0, type: 'skill', format: pctStr },
        { label: '会率', value: mode === 'simple' ? 0 : (s.critRateUpPct || 0), type: 'crit', format: pctStr },
        { label: '会ダメ', value: mode === 'simple' ? 0 : (s.critDmgUpPct || 0), type: 'critdmg', format: pctStr },
        { label: '属ダメ', value: mode === 'simple' ? 0 : (s.elemDmgUpPct || 0), type: 'elem', format: pctStr },
      ];
      renderHintBadges(el, badges, '—');
    }
  }

  // 敵の詳細
  {
    const el = ensureSummaryHint('grpEnemy');
    if (el){
      const aff = s.affinity==='adv' ? '有利' : s.affinity==='dis' ? '不利' : 'なし';
      const badges = [
        { label: '防', value: s.enemyDef || 0, type: 'enemy', format: fmtInt, always: true },
        { label: '相性', value: aff, type: 'enemy', format: (v)=>v, always: true },
        { label: 'ブレイク', value: '', type: 'enemy', format: (v)=>v, always: !!s.isBreak },
      ];
      renderHintBadges(el, badges, `防${s.enemyDef || 0} / ${aff}`);
    }
  }

  // 計算の内訳（ヒントは空のまま）
  ensureSummaryHint('grpBreakdown'); // 置き場だけ確保（中身は空）
}

function shouldShowGuide() {
  try { return !localStorage.getItem(GUIDE_STORAGE_KEY); }
  catch { return true; }
}

function markGuideSeen() {
  try { localStorage.setItem(GUIDE_STORAGE_KEY, '1'); }
  catch {}
}

function renderGuideStep() {
  const step = GUIDE_STEPS[guideStepIndex];
  $('#guideStepProgress').textContent = `STEP ${guideStepIndex + 1}/${GUIDE_STEPS.length}`;
  $('#guideStepTitle').textContent = step.title;
  $('#guideStepBody').textContent = step.body;
  const nextBtn = $('#guideNext');
  if (nextBtn) nextBtn.textContent = (guideStepIndex === GUIDE_STEPS.length - 1) ? '完了' : '次へ';
  setGuideHighlight(step.target);
}

function closeGuide(markSeen) {
  const overlay = $('#guideOverlay');
  if (!overlay) return;
  overlay.hidden = true;
  document.body.classList.remove('guide-open');
  setGuideHighlight(null);
  if (markSeen) markGuideSeen();
}

function startGuide(forceReplay=false) {
  const overlay = $('#guideOverlay');
  if (!overlay) return;
  guideStepIndex = 0;
  overlay.hidden = false;
  document.body.classList.add('guide-open');
  renderGuideStep();
  overlay.focus({ preventScroll: true });
}

function advanceGuide() {
  if (guideStepIndex < GUIDE_STEPS.length - 1) {
    guideStepIndex += 1;
    renderGuideStep();
  } else {
    closeGuide(true);
  }
}

function initGuide() {
  const overlay = $('#guideOverlay');
  if (!overlay) return;
  $('#guideNext')?.addEventListener('click', () => advanceGuide());
  $('#guideSkip')?.addEventListener('click', () => closeGuide(true));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeGuide(true); });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeGuide(true); });
  $('#replayGuide')?.addEventListener('click', () => {
    $('#helpDialog')?.close();
    startGuide(true);
  });
  const repositionGuide = () => {
    if (document.body.classList.contains('guide-open') && guideHighlightEl) {
      positionGuideSpotlight(guideHighlightEl);
      positionGuideCard(guideHighlightEl);
    }
  };
  window.addEventListener('resize', repositionGuide);
  window.addEventListener('scroll', repositionGuide, { passive: true });
  if (shouldShowGuide()) startGuide(false);
}

function positionGuideSpotlight(target) {
  const spot = $('#guideSpotlight');
  if (!spot || !target) return;
  const rect = target.getBoundingClientRect();
  const pad = 12;
  const top = window.scrollY + rect.top - pad;
  const left = window.scrollX + rect.left - pad;
  const width = rect.width + pad * 2;
  const height = rect.height + pad * 2;
  spot.style.top = `${Math.max(8, top)}px`;
  spot.style.left = `${Math.max(8, left)}px`;
  spot.style.width = `${Math.max(80, width)}px`;
  spot.style.height = `${Math.max(80, height)}px`;
}

function positionGuideCard(target) {
  const overlay = $('#guideOverlay');
  const card = $('#guideOverlay .guide-card');
  if (!overlay || !card || !target) return;
  const rect = target.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const margin = 12;
  const style = getComputedStyle(overlay);
  const padX = parseFloat(style.paddingLeft || '0');
  const padY = parseFloat(style.paddingTop || '0');
  const availW = window.innerWidth - padX * 2;
  const availH = window.innerHeight - padY * 2;

  const preferBelow = rect.bottom + margin + cardRect.height <= window.innerHeight;
  let top = preferBelow ? rect.bottom + margin : rect.top - cardRect.height - margin;
  // はみ出す場合のクランプ
  top = Math.max(margin, Math.min(top, availH - cardRect.height - margin));

  // 右下に寄せつつ、画面外なら左へずらす
  let left = rect.right - cardRect.width + margin;
  const maxLeft = availW - cardRect.width - margin;
  if (left < margin) left = margin;
  if (left > maxLeft) left = maxLeft;

  card.style.top = `${Math.round(top + padY)}px`;
  card.style.left = `${Math.round(left + padX)}px`;
}

function setGuideHighlight(selector) {
  const spot = $('#guideSpotlight');
  if (guideHighlightEl) {
    guideHighlightEl.classList.remove('guide-highlight');
    guideHighlightEl = null;
  }
  if (spot) {
    spot.classList.remove('show');
    spot.hidden = true;
  }
  if (!selector) return;
  const target = document.querySelector(selector);
  if (!target) return;
  const det = target.closest('details');
  if (det) det.open = true;
  guideHighlightEl = target;
  target.classList.add('guide-highlight');
  positionGuideSpotlight(target);
  positionGuideCard(target);
  if (spot) {
    spot.hidden = false;
    requestAnimationFrame(() => spot.classList.add('show'));
  }
  target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
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
      localStorage.setItem(STORAGE_VERSION_KEY, String(STORAGE_VERSION));
    } catch {}
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

    // ★ 初期フォーカス回避：検索欄を一時的にフォーカス不可能にする
    const prevTabIdx = q.getAttribute('tabindex');
    const wasDisabled = q.disabled;
    q.setAttribute('tabindex', '-1');
    q.disabled = true; // これで“初期フォーカス先”から外れる

    dlg.show();
    q.value = '';
    build('');
    document.activeElement?.blur?.(); // 既存フォーカスも外す（何にもフォーカスしない）

    // 次フレームで元に戻す（でもフォーカスは当てない）
    requestAnimationFrame(() => {
      if (prevTabIdx === null) q.removeAttribute('tabindex'); else q.setAttribute('tabindex', prevTabIdx);
      q.disabled = wasDisabled;
    });

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
  inputMode: 'simple',
  finalAtkInput: 5000,
  preAtkInput: 5000,
  simpleCritRate: 20,
  simpleCritDmg: 50,
  simpleElemDmgPct: 0,
  baseAtk: 5000,
  bonusAtk: 0,
  critRate: 20,
  critDmg: 50,
  skillPct: 100,
  skillFlat: 0,
  atkUpPct: 0,
  dmgUpPct: 0,
  cardDmgUpPct: 0,
  elemDmgPct: 0,
  elemDmgUpPct: 0,
  critRateUpPct: 0,
  critDmgUpPct: 0,
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

const INPUT_MODES = ['simple', 'standard', 'gear'];
const MODE_META = {
  simple:   { label: '簡易',   desc: '戦闘中の最終攻撃力・会心・属性ダメを直接入力します。' },
  standard: { label: '標準',   desc: '装備の補正値を含んだ戦闘前のステータス合計値を入力します。' },
  gear:     { label: '装備',   desc: '基礎/補正/装備値を詳細に入力して計算します。' },
};
const GUIDE_STORAGE_KEY = 'uvt-guide-shown';
const GUIDE_STEPS = [
  {
    title: '入力モードを決める',
    body: '「簡易 / 標準 / 装備」からモードを選び、入力したい粒度を切り替えます。',
    target: '#grpMode'
  },
  {
    title: 'ステータスや各種数値を入力',
    body: '値を変更すると結果のチャートに即時反映されます。',
    target: '#grpStatus'
  },
  {
    title: 'プリセット / 比較を活用',
    body: 'プリセットでビルドを保存して、結果欄の比較バッジでダメージの差分を確認できます。',
    target: '#grpPreset'
  },
  {
    title: 'リンクの共有',
    body: '画面上部の共有ボタン📤からURLをコピーして、結果を誰かと共有できます。',
    target: '#shareBtn'
  }
];
let guideStepIndex = 0;
let guideHighlightEl = null;
const LAST_MODE_KEY = 'uvt-last-mode';
const EQUIP_SLOTS = ['glove','armor','emblem','ring','brooch'];
try {
  const savedMode = localStorage.getItem(LAST_MODE_KEY);
  if (INPUT_MODES.includes(savedMode)) {
    DEFAULTS.inputMode = savedMode;
  }
} catch {}

function normalizeStateShape(raw) {
  const base = structuredClone(DEFAULTS);
  if (!raw || typeof raw !== 'object') return base;
  const dest = base;
  Object.keys(raw).forEach((k) => {
    if (k === 'equip') return;
    dest[k] = raw[k];
  });
  dest.inputMode = INPUT_MODES.includes(raw.inputMode) ? raw.inputMode : 'gear';
  dest.finalAtkInput = Number.isFinite(raw.finalAtkInput) ? raw.finalAtkInput : DEFAULTS.finalAtkInput;
  dest.preAtkInput = Number.isFinite(raw.preAtkInput)
    ? raw.preAtkInput
    : (dest.baseAtk + dest.bonusAtk);
  dest.simpleCritRate = Number.isFinite(raw.simpleCritRate) ? raw.simpleCritRate : dest.critRate;
  dest.simpleCritDmg = Number.isFinite(raw.simpleCritDmg) ? raw.simpleCritDmg : dest.critDmg;
  dest.elemDmgPct = Number.isFinite(raw.elemDmgPct) ? raw.elemDmgPct : DEFAULTS.elemDmgPct;
  dest.elemDmgUpPct = Number.isFinite(raw.elemDmgUpPct) ? raw.elemDmgUpPct : DEFAULTS.elemDmgUpPct;
  dest.critRateUpPct = Number.isFinite(raw.critRateUpPct) ? raw.critRateUpPct : DEFAULTS.critRateUpPct;
  dest.critDmgUpPct = Number.isFinite(raw.critDmgUpPct) ? raw.critDmgUpPct : DEFAULTS.critDmgUpPct;
  dest.simpleElemDmgPct = Number.isFinite(raw.simpleElemDmgPct)
    ? raw.simpleElemDmgPct
    : (dest.elemDmgPct + dest.elemDmgUpPct);

  const slots = ['glove','armor','emblem','ring','brooch'];
  dest.equip = {};
  slots.forEach((slot) => {
    const src = (raw.equip && typeof raw.equip === 'object' && raw.equip[slot]) || {};
    const sub = (src.sub && typeof src.sub === 'object') ? src.sub : {};
    dest.equip[slot] = {
      mainType: typeof src.mainType === 'string' ? src.mainType : DEFAULTS.equip[slot].mainType,
      mainVal: Number.isFinite(src.mainVal) ? src.mainVal : 0,
      sub: {
        atk: Number.isFinite(sub.atk) ? sub.atk : 0,
        atkPct: Number.isFinite(sub.atkPct) ? sub.atkPct : 0,
        critRate: Number.isFinite(sub.critRate) ? sub.critRate : 0,
        critDmg: Number.isFinite(sub.critDmg) ? sub.critDmg : 0,
      }
    };
  });
  return dest;
}

// ====== 状態 ======
let state = normalizeStateShape();

// ====== テーマ ======
function initTheme() {
  const saved = localStorage.getItem('uvt-theme');
  const html = document.documentElement;
  if (saved === 'light' || saved === 'dark') {
    html.setAttribute('data-theme', saved);
  } else {
    html.setAttribute('data-theme', 'light');
  }
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
let toastFadeTimer;
function toast(msg, type='info') {
  const box = $('#toast');
  if (!box) return;

  clearTimeout(toastTimer);
  clearTimeout(toastFadeTimer);

  box.classList.remove('success','error','fade-out');
  const icon = type === 'success' ? '✅' : type === 'error' ? '⚠️' : 'ℹ️';
  box.textContent = '';
  const inner = document.createElement('span');
  inner.className = 'toast-inner';
  const ico = document.createElement('span');
  ico.className = 'toast-icon';
  ico.textContent = icon;
  const body = document.createElement('span');
  body.className = 'toast-text';
  body.textContent = msg;
  inner.append(ico, body);
  box.appendChild(inner);
  if (type === 'success') box.classList.add('success');
  else if (type === 'error') box.classList.add('error');

  // リセットしてから表示（連続呼び出しでもアニメを再発火させる）
  // eslint-disable-next-line no-unused-expressions
  box.offsetWidth;
  box.classList.add('show');

  toastFadeTimer = setTimeout(() => box.classList.add('fade-out'), 2000);
  toastTimer = setTimeout(() => {
    box.classList.remove('show','fade-out','success','error');
    box.innerHTML = '';
  }, 4000);
}

// ====== 入力と状態の同期 ======
function normalizeNumberInput(el, fallback = 0) {
  if (!el) return fallback;
  const raw = (el.value || '').replace(/,/g, '').trim();
  if (!raw) {
    el.value = '0';
    return 0;
  }
  return readNumber(el.value, fallback);
}

function bindNumberInput(el, setValue) {
  if (!el || typeof setValue !== 'function') return;
  const sync = () => { setValue(readNumber(el.value)); scheduleRender(); };
  el.addEventListener('input', sync);
  el.addEventListener('blur', () => {
    const val = normalizeNumberInput(el);
    setValue(val);
    scheduleRender();
  });
}

function bindInputs() {
  const map = [
    ['#finalAtkInput', 'finalAtkInput'],
    ['#preAtkInput', 'preAtkInput'],
    ['#baseAtk', 'baseAtk'],
    ['#bonusAtk', 'bonusAtk'],
    ['#simpleCritRate', 'simpleCritRate'],
    ['#simpleCritDmg', 'simpleCritDmg'],
    ['#simpleElemDmgPct', 'simpleElemDmgPct'],
    ['#critRate', 'critRate'],
    ['#critDmg', 'critDmg'],
    ['#elemDmgPct', 'elemDmgPct'],
    ['#skillPct', 'skillPct'],
    ['#skillFlat', 'skillFlat'],
    ['#atkUpPct', 'atkUpPct'],
    ['#critRateUpPct', 'critRateUpPct'],
    ['#critDmgUpPct', 'critDmgUpPct'],
    ['#dmgUpPct', 'dmgUpPct'],
    ['#cardDmgUpPct', 'cardDmgUpPct'],
    ['#elemDmgUpPct', 'elemDmgUpPct'],
    ['#enemyDef', 'enemyDef'],
  ];
  map.forEach(([sel, key]) => {
    const el = $(sel);
    bindNumberInput(el, (val) => {
      const s = getSideState(linkedSide);
      s[key] = val;
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
    bindNumberInput(inp, (val) => {
      const slot = inp.dataset.slot;
      const fixedType = inp.dataset.mainType; // glove/armor 固定
      if (fixedType) getSideState(linkedSide).equip[slot].mainType = fixedType;
      getSideState(linkedSide).equip[slot].mainVal = val;
    });
  });
  // 装備: サブ
  $$('input[data-sub]').forEach((inp) => {
    bindNumberInput(inp, (val) => {
      const slot = inp.dataset.slot; const k = inp.dataset.sub;
      getSideState(linkedSide).equip[slot].sub[k] = val;
    });
  });
}

function initModeSwitcher() {
  const wrap = $('#modeSwitcher');
  if (!wrap) return;
  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-btn');
    if (!btn) return;
    setInputMode(btn.dataset.mode);
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
  const mode = INPUT_MODES.includes(s.inputMode) ? s.inputMode : 'gear';
  // 装備 合計
  const sum = { atk: 0, atkPct: 0, critRate: 0, critDmg: 0, elemDmgPct: 0 };
  for (const [, gear] of Object.entries(s.equip)) {
    const type = gear.mainType;
    const val = readNumber(gear.mainVal);
    if (type === 'atk') sum.atk += val;
    else if (type === 'atkPct') sum.atkPct += val;
    else if (type === 'critRate') sum.critRate += val;
    else if (type === 'critDmg') sum.critDmg += val;
    else if (type === 'elemDmgPct') sum.elemDmgPct += val; // 紋章のみ想定

    sum.atk += readNumber(gear.sub.atk);
    sum.atkPct += readNumber(gear.sub.atkPct);
    sum.critRate += readNumber(gear.sub.critRate);
    sum.critDmg += readNumber(gear.sub.critDmg);
  }

  const useEquipAttack = mode === 'gear';
  const useEquipCrit = mode !== 'simple';
  const useEquipElem = mode !== 'simple';
  const baseCritRate = s.critRate + (useEquipCrit ? sum.critRate : 0);
  const baseCritDmg = s.critDmg + (useEquipCrit ? sum.critDmg : 0);
  const baseElemPct = s.elemDmgPct + (useEquipElem ? sum.elemDmgPct : 0);

  const rawEquipAdjAtk = sum.atk + (s.baseAtk * (sum.atkPct / 100));
  const equipAdjUsed = useEquipAttack ? rawEquipAdjAtk : 0;
  const equipAdjDisplay = useEquipAttack ? rawEquipAdjAtk : null;

  let preAtk = s.baseAtk + s.bonusAtk + equipAdjUsed;
  let finalAtk = preAtk * (1 + (s.atkUpPct / 100));

  if (mode === 'standard') {
    preAtk = Math.max(0, Number.isFinite(s.preAtkInput) ? s.preAtkInput : preAtk);
    finalAtk = preAtk * (1 + (s.atkUpPct / 100));
  } else if (mode === 'simple') {
    preAtk = Math.max(0, Number.isFinite(s.finalAtkInput) ? s.finalAtkInput : finalAtk);
    finalAtk = preAtk;
  }

  // 係数
  const affinity = s.affinity === 'adv' ? 1.25 : s.affinity === 'dis' ? 0.85 : 1.0;
  const breakMul = s.isBreak ? 1.3 : 1.0;
  const d = Math.max(0, s.enemyDef);
  const defCoeff = Math.exp(-((0.001058 * d) - (0.000000715 * d * d)));

  // 属性合算
  // 簡易モードは“最終値”を直接入力する前提なので、戦闘中バフを二重適用しない
  const allElemPct = (mode === 'simple')
    ? readNumber(s.simpleElemDmgPct, baseElemPct)
    : baseElemPct + s.elemDmgUpPct;

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

  const allCritRate = mode === 'simple'
    ? clamp(readNumber(s.simpleCritRate, baseCritRate), 0, 100)
    : clamp(baseCritRate + s.critRateUpPct, 0, 100);
  const allCritDmg = mode === 'simple'
    ? readNumber(s.simpleCritDmg, baseCritDmg)
    : baseCritDmg + s.critDmgUpPct;

  const crit = Math.floor(afterDefense * (1 + (allCritDmg / 100)));
  const average = Math.floor(afterDefense * (1 + ((allCritDmg / 100) * (allCritRate / 100))));

  return {
    mode,
    sums: sum,
    equipAdjAtk: equipAdjDisplay,
    preAtk,
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

// ====== 入力バリデーション（計算はそのまま、警告のみ表示） ======
let lastValidationMarks = [];
function collectValidationIssues(s) {
  const issues = [];
  const marks = [];
  const mode = INPUT_MODES.includes(s.inputMode) ? s.inputMode : 'gear';
  const warn = (cond, msg, sel) => { if (cond) { issues.push(msg); if (sel) marks.push(sel); } };
  const neg = (v) => Number.isFinite(v) && v < 0;
  const nfi = (v) => !Number.isFinite(v);

  if (mode === 'simple') {
    warn(nfi(s.finalAtkInput) || s.finalAtkInput < 0, '最終攻撃力が未入力または0未満です', '#finalAtkInput');
    warn(s.simpleCritRate < 0, '最終会心率が0%未満です', '#simpleCritRate');
    warn(s.simpleCritRate > 100, '最終会心率が100%を超えています（計算上は100%上限です）', '#simpleCritRate');
    warn(s.simpleCritDmg < 0, '最終会心ダメージが0未満です', '#simpleCritDmg');
    warn(s.simpleElemDmgPct < 0, '最終属性ダメージが0未満です', '#simpleElemDmgPct');
  } else if (mode === 'standard') {
    warn(nfi(s.preAtkInput) || s.preAtkInput < 0, '攻撃力が未入力または0未満です', '#preAtkInput');
  } else if (mode === 'gear') {
    warn(nfi(s.baseAtk) || s.baseAtk < 0, '基礎攻撃力が未入力または0未満です', '#baseAtk');
    warn(nfi(s.bonusAtk) || s.bonusAtk < 0, '補正攻撃力が0未満です', '#bonusAtk');
  }

  warn(s.critRate < 0, '会心率が0%未満です', '#critRate');
  warn(s.critRate > 100, '会心率が100%を超えています（計算上は100%上限です）', '#critRate');
  warn(s.critDmg < 0, '会心ダメージが0未満です', '#critDmg');
  warn(s.skillPct < 0, 'スキル攻撃%が0未満です', '#skillPct');
  warn(s.skillFlat < 0, 'スキル固定値が0未満です', '#skillFlat');
  warn(s.atkUpPct < 0, '攻撃力アップ%が0未満です', '#atkUpPct');
  warn(s.dmgUpPct < 0, 'ダメージアップ%が0未満です', '#dmgUpPct');
  warn(s.cardDmgUpPct < 0, 'カードダメージアップ%が0未満です', '#cardDmgUpPct');
  warn(s.critRateUpPct < 0, '会心率アップ%が0未満です', '#critRateUpPct');
  warn(s.critDmgUpPct < 0, '会心ダメージアップ%が0未満です', '#critDmgUpPct');
  warn(s.elemDmgPct < 0, '属性ダメージ%が0未満です', '#elemDmgPct');
  warn(s.elemDmgUpPct < 0, '属性ダメージアップ%が0未満です', '#elemDmgUpPct');
  warn(s.enemyDef < 0, '防御力が0未満です', '#enemyDef');

  let equipWarned = false;
  EQUIP_SLOTS.forEach((slot) => {
    const g = s.equip[slot];
    if (!g) return;
    if (!equipWarned && neg(g.mainVal)) {
      warn(true, '装備の値に0未満があります', `input.mainVal[data-slot="${slot}"]`);
      equipWarned = true;
    }
    for (const [k, v] of Object.entries(g.sub || {})) {
      if (equipWarned) break;
      if (neg(v)) {
        warn(true, '装備サブの値に0未満があります', `input[data-slot="${slot}"][data-sub="${k}"]`);
        equipWarned = true;
      }
    }
  });

  return { issues, marks };
}

function updateValidationNotice(result) {
  const box = $('#validationBox');
  const list = $('#validationList');
  lastValidationMarks.forEach((sel) => { const el = $(sel); if (el) el.classList.remove('input-warning'); });
  lastValidationMarks = [];
  if (!box || !list || !result || !result.issues.length) {
    if (box) box.hidden = true;
    if (list) list.innerHTML = '';
    return;
  }
  list.innerHTML = '';
  result.issues.forEach((msg) => {
    const li = document.createElement('li');
    li.textContent = msg;
    list.appendChild(li);
  });
  result.marks.forEach((sel) => { const el = $(sel); if (el) { el.classList.add('input-warning'); lastValidationMarks.push(sel); } });
  box.hidden = false;
}

/**
 * 表示更新:
 * - 表示の主役 = linkedSide の状態（グラフ前面・数値・内訳）
 * - 差分 = 比較先(comp) - 比較元(base) で計算
 * - 赤ストライプ = 差分がマイナスの区間（比較先のほうが小さい区間）
 */
function render() {
  // 表示の主役 = 常にリンク中の側
  const sLink  = getSideState(linkedSide);
  const sOther = getSideState(other(linkedSide)); // 比較相手（無ければ null）

  if (sLink) {
    updateValidationNotice(collectValidationIssues(sLink));
  } else {
    updateValidationNotice({ issues: [], marks: [] });
  }

  const rLink  = sLink  ? calcAll(sLink)  : null;
  const rOther = sOther ? calcAll(sOther) : null;

  // 表示は rLink を主として…
  const R = rLink || calcAll(getSideState(linkedSide)); // 念のため
  const currentMode = R.mode || (sLink?.inputMode ?? 'gear');
  const modeMeta = MODE_META[currentMode] || MODE_META.gear;
  const badgeEl = $('#modeBadge');
  if (badgeEl) badgeEl.textContent = `${modeMeta.label}モード`;
  const descEl = $('#modeDesc');
  if (descEl) descEl.textContent = modeMeta.desc;

  // 差分は 役割ベースで計算（比較先 − 比較元）
  const sBase = baseState();
  const sComp = compState();
  const rBase = sBase ? calcAll(sBase) : null;
  const rComp = sComp ? calcAll(sComp) : null;

  // 合計（装備合計）
  const showEquipAttack = currentMode === 'gear';
  const showEquipCrit = currentMode !== 'simple';
  const showEquipElem = currentMode !== 'simple';
  $('#sumEquipAtk').textContent = showEquipAttack ? fmtInt(R.sums.atk) : '—';
  $('#sumEquipAtkPct').textContent = showEquipAttack ? fmtPct(R.sums.atkPct) : '—';
  $('#sumEquipCritRate').textContent = showEquipCrit ? fmtPct(R.sums.critRate) : '—';
  $('#sumEquipCritDmg').textContent = showEquipCrit ? fmtPct(R.sums.critDmg) : '—';
  $('#sumEquipElemDmgPct').textContent = showEquipElem ? fmtPct(R.sums.elemDmgPct) : '—';

  // 内訳（R = rBase）
  $('#outEquipAdjAtk').textContent = Number.isFinite(R.equipAdjAtk) ? fmtInt(R.equipAdjAtk) : '—';
  $('#outPreAtk').textContent = fmtInt(R.preAtk);
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
  $('#outPreCritRate').textContent = fmtPct(R.allCritRate);
  $('#outPreCritDmg').textContent = fmtPct(R.allCritDmg);

  // 結果値
  $('#outNormal').textContent = fmtInt(R.normal);
  $('#outAverage').textContent = fmtInt(R.average);
  $('#outCrit').textContent = fmtInt(R.crit);

  // 差分（comp がある時のみ）
  setDeltaChip($('#deltaNormal'),  rBase ? rBase.normal  : NaN, rComp ? rComp.normal  : NaN);
  setDeltaChip($('#deltaAverage'), rBase ? rBase.average : NaN, rComp ? rComp.average : NaN);
  setDeltaChip($('#deltaCrit'),    rBase ? rBase.crit    : NaN, rComp ? rComp.crit    : NaN);

  // チャート（手前=比較元、奥=比較先）
  const max = Math.max(1, R.normal, R.average, R.crit, rOther ? rOther.normal : 0, rOther ? rOther.average : 0, rOther ? rOther.crit : 0);
  const seg = (x)=> (x / max) * 100;

  // ★ しきい値付き setter（髪の毛ラインを消す）
  const chartEl = $('.chart');
  const chartW  = chartEl ? chartEl.clientWidth : 0;
  const EPS_PX  = 1; // 1px 未満は表示しない（調整可）

  function setDef(el, leftPct, widthPct) {
    if (!el) return;
    const px = chartW ? (widthPct / 100) * chartW : 0;
    if (widthPct <= 0 || px < EPS_PX) {
      el.style.width = '0%';
      el.style.left  = '0%';
      el.classList.add('is-zero');   // ← 完全に消す
    } else {
      el.style.left  = leftPct + '%';
      el.style.width = widthPct + '%';
      el.classList.remove('is-zero');
    }
  }

  // ★ 背面：比較相手（“もう一方”）
  if (rOther) {
    const bN = seg(rOther.normal);
    const bA = Math.max(0, seg(rOther.average) - bN);
    const bC = Math.max(0, seg(rOther.crit) - (bN + bA));
    const set=(el,l,w)=>{ el.style.left=l+'%'; el.style.width=w+'%'; };
    set($('#barBNormal'), 0, bN); set($('#barBAvg'), bN, bA); set($('#barBCrit'), bN+bA, bC);
  } else ['#barBNormal','#barBAvg','#barBCrit'].forEach(sel=>{ const el=$(sel); if(el){el.style.width='0%'; el.style.left='0%';}});

  // ★ 前面：リンク中の側（表示の主役）
  const aN = seg(R.normal);
  const aA = Math.max(0, seg(R.average) - aN);
  const aC = Math.max(0, seg(R.crit) - (aN + aA));
  const setA=(el,l,w)=>{ el.style.left=l+'%'; el.style.width=w+'%'; };
  setA($('#barNormal'), 0, aN); setA($('#barAvg'), aN, aA); setA($('#barCrit'), aN+aA, aC);

  // ★ 赤ストライプ（比較先 − 比較元 がマイナスの不足分だけ表示）
  if (rBase && rComp) {
    const baseN = seg(rBase.normal);
    const baseA = Math.max(0, seg(rBase.average) - baseN);
    const baseC = Math.max(0, seg(rBase.crit)    - (baseN + baseA));

    const compN = seg(rComp.normal);
    const compA = Math.max(0, seg(rComp.average) - compN);
    const compC = Math.max(0, seg(rComp.crit)    - (compN + compA));

    const defN_left = compN;
    const defN_w    = Math.max(0, baseN - compN);

    const defA_left = compN + compA;
    const defA_w    = Math.max(0, (baseN + baseA) - (compN + compA));

    const defC_left = compN + compA + compC;
    const defC_w    = Math.max(0, (baseN + baseA + baseC) - (compN + compA + compC));

    setDef($('#barDefNormal'), defN_left, defN_w);
    setDef($('#barDefAvg'),    defA_left, defA_w);
    setDef($('#barDefCrit'),   defC_left, defC_w);
  } else {
    ['#barDefNormal','#barDefAvg','#barDefCrit'].forEach(sel => {
      const el = $(sel);
      if (el) {
        el.style.width = '0%';
        el.style.left  = '0%';
        el.classList.add('is-zero');
      }
    });
  }

  updateGroupHints();
}

// ====== 値のセット/取得（入力UIへ反映） ======
function setInputsFromState(s) {
  const finalAtkInp = $('#finalAtkInput');
  if (finalAtkInp) finalAtkInp.value = s.finalAtkInput ?? s.baseAtk ?? 0;
  const preAtkInp = $('#preAtkInput');
  if (preAtkInp) preAtkInp.value = s.preAtkInput ?? (s.baseAtk + s.bonusAtk);
  $('#baseAtk').value = s.baseAtk;
  $('#bonusAtk').value = s.bonusAtk;
  const preCritInp = $('#simpleCritRate');
  if (preCritInp) preCritInp.value = s.simpleCritRate;
  const preCritDmgInp = $('#simpleCritDmg');
  if (preCritDmgInp) preCritDmgInp.value = s.simpleCritDmg;
  const simpleElemInp = $('#simpleElemDmgPct');
  if (simpleElemInp) simpleElemInp.value = s.simpleElemDmgPct;
  $('#critRate').value = s.critRate;
  $('#critDmg').value = s.critDmg;
  $('#elemDmgPct').value = s.elemDmgPct;
  $('#skillPct').value = s.skillPct;
  $('#skillFlat').value = s.skillFlat;
  $('#atkUpPct').value = s.atkUpPct;
  $('#critRateUpPct').value = s.critRateUpPct;
  $('#critDmgUpPct').value = s.critDmgUpPct;
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
  updateModeUI();
}

function updateModeUI() {
  const s = getSideState(linkedSide) || state;
  const mode = (s && INPUT_MODES.includes(s.inputMode)) ? s.inputMode : 'gear';
  document.documentElement.setAttribute('data-input-mode', mode);
  $$('#modeSwitcher .mode-btn').forEach((btn) => {
    const isActive = btn.dataset.mode === mode;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
  const atkUp = $('#atkUpPct');
  if (atkUp) atkUp.disabled = mode === 'simple';
}

function setInputMode(mode) {
  const next = INPUT_MODES.includes(mode) ? mode : 'gear';
  const s = getSideState(linkedSide);
  if (!s || s.inputMode === next) return;
  const snapshot = calcAll(s);
  s.inputMode = next;
  if (next === 'standard') {
    s.preAtkInput = Math.max(0, Math.round(snapshot.preAtk));
  } else if (next === 'simple') {
    s.finalAtkInput = Math.max(0, Math.round(snapshot.finalAtk));
    s.simpleCritRate = clamp(snapshot.allCritRate, 0, 100);
    s.simpleCritDmg = snapshot.allCritDmg;
    s.simpleElemDmgPct = snapshot.allElemPct;
  }
  try { localStorage.setItem(LAST_MODE_KEY, next); } catch {}
  updateModeUI();
  setInputsFromState(s);
  scheduleRender();
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
  toast('初期化しました', 'success');
}

function hasLZ() {
  return !!(window.LZString && typeof window.LZString.compressToBase64 === 'function');
}
const SHARE_SCHEMA_VERSION = '1';
function encodeStateShort(obj) {
  if (!hasLZ()) throw new Error('LZ-String is not loaded');
  return window.LZString.compressToBase64(JSON.stringify(obj));
}
function decodeStateShort(b64) {
  try {
    if (!hasLZ()) return null;
    const txt = window.LZString.decompressFromBase64(b64);
    return txt ? JSON.parse(txt) : null;
  } catch { return null; }
}

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
  const cmpState = getSideState(other(linkedSide));
  const payload = {
    // 既存：リンク側（現在表示の側）の状態
    s: getSideState(linkedSide),
    // 既存：比較相手があれば
    cmp: cmpState ? { s: cmpState, name: compareCtx?.name || '' } : null,
    // 既存：役割/リンク（後方互換のためそのまま）
    roles: roleMap,
    link: linkedSide
  };
  const name = (currentPresetName || '').trim();
  if (name) {
    payload.meta = { presetName: name };
  }
  const cmpName = (compareCtx?.name || '').trim();
  if (cmpName) {
    payload.meta = payload.meta || {};
    payload.meta.compName = cmpName;
  }
  return payload;
}

function initShare() {
  const dlg = $('#shareDialog');
  const openerBtn = $('#shareBtn');
  if (!dlg || !openerBtn) return; // ← 追加（どちらか無ければ何もしない）

  enhanceDialog(dlg);

  // CDN未読込時は一時的に無効化（ページが安定したら自動で有効化）
  if (!hasLZ()) {
    openerBtn.disabled = true;
    openerBtn.title = '初期化中…ネットワークをご確認ください';
    window.addEventListener('load', () => {
      if (hasLZ()) {
        openerBtn.disabled = false;
        openerBtn.title = '共有URLをコピー';
      }
    });
  }

  openerBtn.addEventListener('click', () => {
    if (!hasLZ()) { toast('共有機能の初期化に失敗しました（LZ-String）', 'error'); return; }
    dlg.showModal();
    if (!dlg.hasAttribute('tabindex')) dlg.setAttribute('tabindex', '-1');
    openerBtn.blur();
    dlg.focus({ preventScroll: true });
  });
  $('#closeShare')?.addEventListener('click', () => dlg.close());

  const makeUrl = () => {
    const payload = buildSharePayload();
    const params = new URLSearchParams();
    params.set('v', SHARE_SCHEMA_VERSION);
    params.set('z', encodeStateShort(payload));
    return `${location.origin}${location.pathname}?${params.toString()}`;
  };
  const copy = (fmt) => {
    if (!hasLZ()) { toast('共有リンクの生成に失敗しました（LZ-String）', 'error'); return; }
    const url = makeUrl();
    let text = url;
    if (fmt === 'md') {
      // リンク先を送るだけでは中身が伝わりにくいため、Markdownのラベル側にプリセット/比較名を含めておく
      const hasCompare = !!compareCtx;
      const presetLabel = (linkedSide === 'A') ? (currentPresetName || '') : ((compareCtx?.name || '').trim());
      let label = 'unVEIL the world: ダメージシミュレーター';
      label += hasCompare
        ? ` | 比較元：${baseName()} | 比較先：${compName()}`
        : (presetLabel ? ` | プリセット：${presetLabel}` : '');
      text = `[${label}](${url})`;
    }
    navigator.clipboard?.writeText(text)
      .then(() => { toast('クリップボードにコピーしました', 'success'); dlg.close(); })
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
  const getN = (k, d=0) => readNumber(p.get(k), d);
  const getS = (k, d='') => (p.get(k) ?? d);
  getSideState(linkedSide).baseAtk = getN('ba', DEFAULTS.baseAtk);
  getSideState(linkedSide).bonusAtk = getN('bo', 0);
  getSideState(linkedSide).critRate = getN('cr', DEFAULTS.critRate);
  getSideState(linkedSide).critDmg = getN('cd', DEFAULTS.critDmg);
  getSideState(linkedSide).elemDmgPct = getN('ep', DEFAULTS.elemDmgPct);
  getSideState(linkedSide).skillPct = getN('sp', DEFAULTS.skillPct);
  getSideState(linkedSide).skillFlat = getN('sf', 0);
  getSideState(linkedSide).atkUpPct = getN('au', 0);
  getSideState(linkedSide).critRateUpPct = getN('cru', 0);
  getSideState(linkedSide).critDmgUpPct = getN('cdu', 0);
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
  const modeVal = getS('mode', 'gear');
  getSideState(linkedSide).inputMode = INPUT_MODES.includes(modeVal) ? modeVal : 'gear';
  getSideState(linkedSide).preAtkInput = getN('pa', getSideState(linkedSide).preAtkInput);
  getSideState(linkedSide).finalAtkInput = getN('fa', getSideState(linkedSide).finalAtkInput);
  getSideState(linkedSide).simpleCritRate = getN('scr', getSideState(linkedSide).simpleCritRate);
  getSideState(linkedSide).simpleCritDmg = getN('scd', getSideState(linkedSide).simpleCritDmg);
  getSideState(linkedSide).simpleElemDmgPct = getN('sep', getSideState(linkedSide).simpleElemDmgPct);
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
    if (!name) { toast('プリセット名を入力してください', 'error'); return; }
    const map = loadPresets();
    map[name] = state; savePresets(map);
    currentPresetName = name;
    refreshPresetSelect();
    $('#presetSelect').value = name;
    captureBaseline();
    refreshCompareSelect();
    updateCompareBadges();
    toast('プリセットを保存しました', 'success');
  });

  $('#renamePreset').addEventListener('click', () => {
    const cur = $('#presetSelect').value;
    const name = $('#presetName').value.trim();
    if (!cur) { toast('変更するプリセットを選択してください', 'error'); return; }
    if (!name) { toast('新しい名前を入力してください', 'error'); return; }
    if (name === cur) { toast('同じ名前です'); return; }
    const map = loadPresets();
    if (!map[cur]) { toast('指定のプリセットが見つかりません', 'error'); return; }
    map[name] = map[cur]; delete map[cur]; savePresets(map);
    currentPresetName = name;
    refreshPresetSelect();
    $('#presetSelect').value = name;
    captureBaseline();
    refreshCompareSelect();
    updateCompareBadges();
    toast('名前を変更しました', 'success');
  });

  $('#deletePreset').addEventListener('click', () => {
    const cur = $('#presetSelect').value;
    if (!cur) { toast('削除するプリセットを選択してください', 'error'); return; }
    if (!confirm('選択中のプリセットを削除します。よろしいですか？')) return;
    const map = loadPresets(); delete map[cur]; savePresets(map);
    refreshPresetSelect();
    $('#presetSelect').value = '';
    $('#presetName').value = '';
    currentPresetName = '';
    captureBaseline();
    refreshCompareSelect();
    updateCompareBadges();
    toast('削除しました', 'success');
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
    toast('プリセットを読み込みました', 'success');
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
    toast('比較対象を保存しました', 'success');
  });
}

// ====== 0フレンドリー入力 ======
function initZeroFriendlyInputs() {
  $$('.num-input').forEach((el) => {
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
    const ver = p.get('v');
    if (ver && ver !== SHARE_SCHEMA_VERSION) {
      toast(`共有リンクのバージョンが異なります (v=${ver})`, 'error');
    }
    const z = p.get('z');
    if (z) {
      const decoded = decodeStateShort(z);
      if (decoded) {
        if (decoded.s) {
          state = normalizeStateShape(decoded.s);
          const cmpBlock = decoded.cmp;
          const cmpState = (cmpBlock && typeof cmpBlock === 'object' && 's' in cmpBlock) ? cmpBlock.s : cmpBlock;
          if (cmpState) {
            const metaComp = (decoded.meta && typeof decoded.meta.compName === 'string') ? decoded.meta.compName : '';
            const rawName = (cmpBlock && typeof cmpBlock === 'object' && typeof cmpBlock.name === 'string') ? cmpBlock.name : '';
            const cmpName = ((rawName || metaComp).trim()) || '共有プリセット';
            compareCtx = { name: cmpName, state: normalizeStateShape(cmpState), transient: true };
            $('#compareSave')?.removeAttribute('hidden'); // 保存ボタンを出す
          } else {
            compareCtx = null;
            $('#compareSave')?.setAttribute('hidden','');
          }

          // 1) 共有元でどちらがリンク側だったか（将来のために一応復元）
          if (decoded.link === 'A' || decoded.link === 'B') {
            linkedSide = decoded.link;
          } else {
            linkedSide = 'A';
          }
          // 2) 比較元/比較先の役割（roles）を復元
          const r = decoded.roles || {};
          const base = (r.base === 'A' || r.base === 'B') ? r.base : 'A';
          const comp = (r.comp === 'A' || r.comp === 'B') ? r.comp : (base === 'A' ? 'B' : 'A');

          // base と comp が同じになるのは避ける
          if (base === comp) {
            roleMap = { base: 'A', comp: 'B' };
          } else {
            roleMap = { base, comp };
          }
        }
        const sharedName = decoded.meta && decoded.meta.presetName;
        if (sharedName && typeof sharedName === 'string' && sharedName.trim()) {
          currentPresetName = sharedName.trim();   // 内部の“現在の名前”
          const pn = document.querySelector('#presetName');
          if (pn) pn.value = currentPresetName;    // 入力欄へ表示
        }
      } else {
        applyQueryParams(qs); // フォールバック
      }
    } else {
      state = normalizeStateShape();
    }
  } else {
    state = normalizeStateShape();
  }

  setInputsFromState(getSideState(linkedSide));
  render();
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
  initModeSwitcher();
  initFromQueryOrDefaults();
  initShare();
  initHelp();
  initPresets();
  initCompare();
  initComparePicker();
  initReset();
  initZeroFriendlyInputs();
  initGuide();
  updateGroupHints();

  blurSelfOnClick('#resetBtn');
  blurSelfOnClick('#deletePreset');
});
