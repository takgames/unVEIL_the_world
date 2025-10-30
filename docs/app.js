/* =========================================================
   unVEIL the world ダメージシミュレーター - app.js
========================================================= */

const PRESETS_KEY = 'uvtw_presets';
const COLLAPSE_KEY = 'uvtw_collapse';
const THEME_KEY = 'uvtw_theme';
const HELP_KEY = 'uvtw_help_hide';
const STATE_KEY = 'uvtw_state';
const prevLegend = { noCrit: 0, critOn: 0, expected: 0 };

// UI制御用など、保存/復元の対象から除外するID
const RAW_EXCLUDE = new Set([
  'presetSelect',  // ← 一覧は保存しない
  'presetName'     // ← 名前入力も保存しない（共有名はURL側で扱う）
]);

/* ---------------------------------------------------------
   初期設定とユーティリティ
--------------------------------------------------------- */
function $(id) { return document.getElementById(id); }

function loadPresets() {
  try { return JSON.parse(localStorage.getItem(PRESETS_KEY)) || {}; }
  catch { return {}; }
}
function savePresets(p) { localStorage.setItem(PRESETS_KEY, JSON.stringify(p)); }

function loadCollapseState() {
  try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY)) || {}; }
  catch { return {}; }
}
function saveCollapseState(s) { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(s)); }

// スロットのメイン種別に合わせて値入力の有効/無効を切り替え
function updateMainFieldState(slot){
  const typeEl = $(`eq_${slot}_mainType`);
  const valEl  = $(`eq_${slot}_mainVal`);
  if (!typeEl || !valEl) return;

  const t = typeEl.value;
  const wasDisabled = valEl.disabled;

  if (t === 'other') {
    valEl.disabled = true;
    valEl.value = '';                // ★ 空白にする（0ではない）
  } else {
    valEl.disabled = false;
    // 直前まで無効だった/空だったなら 0 を初期値に（編集開始しやすく）
    if (wasDisabled || valEl.value === '') valEl.value = '0';
  }
}

function initEquipMainState(){
  ['glove','clothes','crest','ring','brooch'].forEach(slot=>{
    const sel = $(`eq_${slot}_mainType`);
    if (!sel) return;
    updateMainFieldState(slot);           // 初期反映
    sel.addEventListener('change', ()=>{  // 切替時
      updateMainFieldState(slot);
      calc();                             // 即時再計算
    });
  });
}

// 置き換え：テンキー設定 + 0オートクリア（小数欄は decimal）
function initMobileKeyboardsAndZeroClear(){
  // 小数を扱う候補：stepが小数 or 0.1/0.5 など、または data-decimal="1" が付いているもの
  const isDecimalField = (el) => {
    if (el.dataset.decimal === '1') return true;
    const step = (el.getAttribute('step') || '').trim();
    // stepが空ならブラウザ既定（整数扱いとみなす）
    if (!step) return false;
    // 小数ステップなら decimal
    return step.includes('.') || step.includes(',');
  };

  document.querySelectorAll('input[type="number"]').forEach(el => {
    // まず過去に設定した属性をクリア
    el.removeAttribute('pattern');
    el.removeAttribute('inputmode');

    // 小数が必要な欄だけ decimal、それ以外は numeric（任意）
    if (isDecimalField(el)) {
      el.setAttribute('inputmode', 'decimal');     // iOS/Androidで小数点付きキーボード
    } else {
      // 数字のみで良い欄は残したい場合のみ。全撤去したいなら下行を消してください。
      el.setAttribute('inputmode', 'numeric');
    }

    // 0オートクリアは継続
    el.addEventListener('focus', () => {
      if (el.value === '0') el.value = '';
    });
    el.addEventListener('blur', () => {
      const isMainVal = /eq_.*_mainVal$/.test(el.id);
      // メイン値は updateMainFieldState が管理。その他の空欄は 0 に戻す運用なら以下を残す
      if (!isMainVal && el.value === '') el.value = '0';
    });
  });
}

// 追加：デバウンス
function debounce(fn, wait = 150){
  let t; return (...args) => { clearTimeout(t); t = setTimeout(()=>fn(...args), wait); };
}
const debouncedCalc = debounce(()=>calc(), 150);

// 成功フィードバック：ボタンのラベルを一時的に変更してフラッシュ
function flashButtonFeedback(btnId, okText = '✓ 完了', duration = 1200){
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const orig = btn.textContent;
  btn.classList.add('btn-flash-success');
  btn.textContent = okText;
  btn.disabled = true;
  setTimeout(()=>{
    btn.textContent = orig;
    btn.classList.remove('btn-flash-success');
    btn.disabled = false;
  }, duration);
}

/* ---------------------------------------------------------
   折りたたみカード
--------------------------------------------------------- */
function initCollapsibles(){
  const saved = loadCollapseState();
  const defaultState = { preset:true, status:false, skill:false, buff:false, enemy:false, result:false, breakdown:true };
  const state = { ...defaultState, ...saved };

  document.querySelectorAll('.card.collapsible').forEach(sec=>{
    const id = sec.getAttribute('data-collapse-id');
    const header = sec.querySelector(':scope > .card-header');
    const body   = sec.querySelector(':scope > .card-body');
    if (!header || !body) return;

    // 初期状態
    if (state[id] === true) sec.classList.add('collapsed');
    header.setAttribute('aria-expanded', sec.classList.contains('collapsed') ? 'false' : 'true');

    const toggle = () => {
      const wasCollapsed = sec.classList.contains('collapsed');    // ← 直前状態を保持
      const willCollapse = !wasCollapsed;

      sec.classList.toggle('collapsed', willCollapse);
      header.setAttribute('aria-expanded', willCollapse ? 'false' : 'true');

      // ★ ここがポイント：breakdown を「開く瞬間」に再計算して描画を確実に行う
      if (id === 'breakdown' && wasCollapsed) {
        calc(true); // ふわっとアニメ不要なら true、要るなら false
      }

      const st = loadCollapseState();
      st[id] = willCollapse;
      saveCollapseState(st);
    };

    header.addEventListener('click', toggle);
    header.addEventListener('keydown', e=>{
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  });
}

/* ---------------------------------------------------------
   テーマ切替
--------------------------------------------------------- */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
}
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved || 'dark'); // 常にダークを既定
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}

/* ---------------------------------------------------------
   入出力の収集・適用
--------------------------------------------------------- */
function collectParams(){
  const g = id => +($(id)?.value || 0);
  const s = id => ($(id)?.value || '');

  const params = {
    // キャラ
    atkBase: g('atkBase'),
    atkBonus: g('atkBonus'),
    critRateBase: g('critRateBase'),
    critDmgBase: g('critDmgBase'),

    // スキル
    skillRate: g('skillRate'),
    skillFlat: g('skillFlat'),

    // バフ
    cardBuff: g('cardBuff'),
    globalBuff: g('globalBuff'),
    elementBuff: g('elementBuff'),
    atkBuff: g('atkBuff'),

    // 敵
    def: g('def'),
    affinity: $('affinity').value,
    applyBreak: $('applyBreak').checked,
  };

  const slots = ['glove','clothes','crest','ring','brooch'];

  // サブステ合算
  let eq = { atk:0, atkPct:0, critRate:0, critDmg:0 };
  // メインの効果（% はそのカテゴリへ足す）
  let main = { atk:0, atkPct:0, elemPct:0, critRate:0, critDmg:0 };

  for (const k of slots){
    eq.atk     += g(`eq_${k}_atk`);
    eq.atkPct  += g(`eq_${k}_atkPct`);
    eq.critRate+= g(`eq_${k}_critRate`);
    eq.critDmg += g(`eq_${k}_critDmg`);

    // メイン
    const mt = s(`eq_${k}_mainType`) || 'other';
    const mv = g(`eq_${k}_mainVal`) || 0;
    switch(mt){
      case 'atk':     main.atk     += mv; break;           // フラット攻撃
      case 'atkPct':  main.atkPct  += mv; break;           // 攻撃力補正%
      case 'elemPct': main.elemPct += mv; break;           // 属性ダメ%
      case 'critRate':main.critRate+= mv; break;           // 会心率%
      case 'critDmg': main.critDmg += mv; break;           // 会心ダメ%
      default: break; // その他→効果なし
    }
  }
  params.eq = eq;
  params.main = main;
  return params;
}

function applyParams(p) {
  for (const [k, v] of Object.entries(p)) {
    const el = $(k);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v;
  }
}

/* ---------------------------------------------------------
   ダメージ計算
--------------------------------------------------------- */
function calc(noAnim = false) {
  const p = collectParams();
  renderEquipBadges(p);
  const dmg = calculateDamage(p);
  render(dmg, noAnim);
}

function calculateDamage(p){
  const n = v => isFinite(+v) ? +v : 0;

  // --- キャラ基礎・補正 ---
  const base   = n(p.atkBase);
  const bonus  = n(p.atkBonus);

  // --- 装備サブ合算 ---
  const eqAtk      = n(p.eq?.atk || 0);
  const eqAtkPct   = n(p.eq?.atkPct || 0) / 100;
  const eqCritRate = n(p.eq?.critRate || 0);
  const eqCritDmg  = n(p.eq?.critDmg || 0);

  // --- 装備メイン効果 ---
  const mAtk      = n(p.main?.atk || 0);           // フラット攻撃
  const mAtkPct   = n(p.main?.atkPct || 0) / 100;  // 攻撃力補正%
  const mElemPct  = n(p.main?.elemPct || 0);       // 属性ダメ%（→属性ダメージUPに加算）
  const mCritRate = n(p.main?.critRate || 0);
  const mCritDmg  = n(p.main?.critDmg || 0);

  // --- 会心（装備サブ＋メインを加算） ---
  const critRate = Math.min(100, Math.max(0, n(p.critRateBase) + eqCritRate + mCritRate)) / 100;
  const critDmg  = Math.max(0, n(p.critDmgBase) + eqCritDmg + mCritDmg) / 100;

  // --- 攻撃力（装備反映） ---
  // 内側： (基礎 + 基礎×装備攻撃力補正% + 装備メイン攻撃力補正%×基礎 + キャラ補正)
  // ※ 仕様の丸め： (基礎 + 基礎×装備攻撃力補正% + キャラ補正) を切り捨て
  //   └ メインの攻撃力補正% は「装備攻撃力補正%」に含めて OK と解釈
  const totalAtkPct = eqAtkPct + mAtkPct;          // すべての攻撃力補正%を合算
  const innerFloor  = Math.floor(base + base*totalAtkPct + bonus); // ★ 指定の切り捨て
  const atkBuffMul  = 1 + n(p.atkBuff)/100;

  // フラット攻撃は「装備サブ＋メイン」を加えたうえでバフ乗算
  const totalFlatEq = eqAtk + mAtk;
  const atkEff      = (innerFloor + totalFlatEq) * atkBuffMul;

  // --- スキル ---
  const skillPct  = n(p.skillRate)/100;
  const skillFlat = n(p.skillFlat);

  // --- バフ（属性はメインの属性ダメ％も加算） ---
  const cardMul   = 1 + n(p.cardBuff)/100;
  const globalMul = 1 + n(p.globalBuff)/100;
  const elemMul   = 1 + (n(p.elementBuff) + mElemPct)/100;

  // --- 敵 ---
  const defMul    = Math.exp(-Math.max(0, n(p.def))/1092);

  // --- 基本ダメージ ---
  const baseTerm  = atkEff * skillPct + skillFlat;
  const basic     = baseTerm * cardMul * globalMul * elemMul * defMul;

  // --- 会心 ---
  const critMulOn = 1 + critDmg;
  const critMulEx = 1 + critRate * critDmg;

  // --- 相性・ブレイク ---
  const aff = { none:{mul:1.00,label:'なし（×1.00）'},
                adv:{mul:1.25,label:'有利（×1.25）'},
                dis:{mul:0.85,label:'不利（×0.85）'} }[p.affinity] || {mul:1.00,label:'なし（×1.00）'};
  const breakMul = p.applyBreak ? 1.30 : 1.00;

  // --- 最終（切り捨て） ---
  const noCrit   = Math.floor(basic * aff.mul * breakMul);
  const critOn   = Math.floor(basic * critMulOn * aff.mul * breakMul);
  const expected = Math.floor(basic * critMulEx * aff.mul * breakMul);

  // --- 内訳表示 ---
  const mulTxt = x => `×${(x).toFixed(2)}`;
  const pctTxt = x => `${(+x).toFixed(1)}%`;
  const num    = x => Math.round(x).toLocaleString('ja-JP');
  const float  = x => (Math.round(x*100)/100).toLocaleString('ja-JP');

  const details = {
    '基礎攻撃力':                 num(base),
    '装備攻撃力補正合計(%)':      pctTxt((totalAtkPct*100)),
    '攻撃力（キャラ補正値）':     num(bonus),
    '内側合算（切り捨て）':        num(innerFloor),        // ★ 追加
    '攻撃力（装備フラット合計）':  num(totalFlatEq),
    '攻撃力バフ(1+%)':            mulTxt(atkBuffMul),
    '＝ 計算用攻撃力':            num(atkEff),
    '(攻撃×スキル% + 固定値)':     float(baseTerm),
    'カード系 (1+%)':             mulTxt(cardMul),
    '全体 (1+%)':                 mulTxt(globalMul),
    '属性 (1+%) ※メイン加算込':    mulTxt(elemMul),
    '防御係数 e^(-DEF/1092)':      mulTxt(defMul),
    '＝ 基本ダメージ（丸め前）':     float(basic),
    '会心率(装備/メイン込)':       pctTxt(critRate*100),
    '会心ダメ(装備/メイン込)':      pctTxt(critDmg*100),
    '会心（発生時）':              mulTxt(critMulOn),
    '会心（期待値）':              mulTxt(critMulEx),
    '属性相性':                   aff.label,
    'ブレイク':                   mulTxt(breakMul),
    '最終（通常／切り捨て）':        noCrit.toLocaleString('ja-JP'),
    '最終（会心発生時／切り捨て）':   critOn.toLocaleString('ja-JP'),
    '最終（期待値／切り捨て）':       expected.toLocaleString('ja-JP'),
  };

  return { noCrit, critOn, expected, details };
}

/* ---------------------------------------------------------
   レンダリング
--------------------------------------------------------- */
function render(res, noAnim) {
  const [vNo, vCrit, vExp] = [res.noCrit, res.critOn, res.expected];

  updateStackedBars(vNo, vCrit, vExp);
  $('leg-noCrit').textContent = Math.floor(vNo);
  $('leg-critOn').textContent = Math.floor(vCrit);
  $('leg-expected').textContent = Math.floor(vExp);

  const tb = $('breakdown-body');
  tb.innerHTML = '';
  for (const [k, v] of Object.entries(res.details))
    tb.innerHTML += `<tr><th>${k}</th><td>${v}</td></tr>`;

  if (!noAnim) {
    const rb = $('result-body');
    rb.classList.remove('changed');
    requestAnimationFrame(() => rb.classList.add('changed'));
    setTimeout(() => rb.classList.remove('changed'), 420);
  }
}

function renderEquipBadges(p){
  const cont = document.getElementById('equipBadges');
  if (!cont) return;

  const eq   = p.eq   || {atk:0, atkPct:0, critRate:0, critDmg:0};
  const main = p.main || {atk:0, atkPct:0, elemPct:0, critRate:0, critDmg:0};

  // 合算（装備全体）
  const total = {
    atk:      (eq.atk || 0) + (main.atk || 0),
    atkPct:   (eq.atkPct || 0) + (main.atkPct || 0),
    elemPct:  (main.elemPct || 0),
    critRate: (eq.critRate || 0) + (main.critRate || 0),
    critDmg:  (eq.critDmg || 0) + (main.critDmg || 0),
  };

  const base = +(p.atkBase || 0);
  const n   = v => Math.round(+v).toLocaleString('ja-JP');
  const pct = v => `${(+v).toFixed(1)}%`;

  // 攻撃力補正による「基礎×補正」の値（切り捨て）
  const pctBonusVal = Math.floor(base * (total.atkPct / 100));

  const items = [];

  // 攻撃力（フラット）…0でも出したくない場合は条件を >0 に
  if ((total.atk || 0) !== 0) {
    items.push(`
      <div class="badge-block">
        <span class="badge-label">攻撃力</span>
        <span class="badge badge-flat">${n(total.atk)}</span>
      </div>`);
  }

  // 攻撃力補正（0%なら非表示）… 表記: "30.0% (+60)"
  if ((total.atkPct || 0) !== 0) {
    items.push(`
      <div class="badge-block">
        <span class="badge-label">攻撃力補正</span>
        <span class="badge badge-pct">${pct(total.atkPct)} (+${n(pctBonusVal)})</span>
      </div>`);
  }

  // 属性ダメ（0%なら非表示）
  if ((total.elemPct || 0) !== 0) {
    items.push(`
      <div class="badge-block">
        <span class="badge-label">属性ダメ</span>
        <span class="badge badge-elem">${pct(total.elemPct)}</span>
      </div>`);
  }

  // 会心率（0%なら非表示）
  if ((total.critRate || 0) !== 0) {
    items.push(`
      <div class="badge-block">
        <span class="badge-label">会心率</span>
        <span class="badge badge-crit-rate">${pct(total.critRate)}</span>
      </div>`);
  }

  // 会心ダメ（0%なら非表示）
  if ((total.critDmg || 0) !== 0) {
    items.push(`
      <div class="badge-block">
        <span class="badge-label">会心ダメ</span>
        <span class="badge badge-crit-dmg">${pct(total.critDmg)}</span>
      </div>`);
  }

  cont.innerHTML = items.join('\n');
}

function updateEquipTotals(p){
  const safepct = v => `${(+v).toFixed(1)}%`;
  // サブ合計
  if (p.eq){
    $('sumSub_atk').textContent      = Math.round(p.eq.atk).toLocaleString('ja-JP');
    $('sumSub_atkPct').textContent   = safepct(p.eq.atkPct);
    $('sumSub_critRate').textContent = safepct(p.eq.critRate);
    $('sumSub_critDmg').textContent  = safepct(p.eq.critDmg);
  }
  // メイン合計
  if (p.main){
    $('sumMain_atk').textContent      = Math.round(p.main.atk).toLocaleString('ja-JP');
    $('sumMain_atkPct').textContent   = safepct(p.main.atkPct);
    $('sumMain_elemPct').textContent  = safepct(p.main.elemPct);
    $('sumMain_critRate').textContent = safepct(p.main.critRate);
    $('sumMain_critDmg').textContent  = safepct(p.main.critDmg);
  }
}

function updateStackedBars(vNo, vCrit, vExp) {
  const maxV = Math.max(vNo, vCrit, vExp, 1);
  const pct = v => Math.max(0, Math.min(100, (v / maxV) * 100));

  $('fill-critOn').style.width = pct(vCrit) + '%';
  $('fill-expected').style.width = pct(vExp) + '%';
  $('fill-noCrit').style.width = pct(vNo) + '%';

  const pairs = [
    ['noCrit', vNo, 'leg-noCrit'],
    ['expected', vExp, 'leg-expected'],
    ['critOn', vCrit, 'leg-critOn'],
  ];
  for (const [key, val, id] of pairs) prevLegend[key] = val;
}

/* ---------------------------------------------------------
   プリセット機能
--------------------------------------------------------- */
function updatePresetSelect(keepSelection = true) {
  const sel = $('presetSelect');
  const presets = loadPresets();
  const prev = keepSelection ? sel.value : ''; // ← 新引数で保持制御

  const names = Object.keys(presets).sort((a,b)=>a.localeCompare(b, 'ja'));

  sel.innerHTML = '';
  for (const name of names) {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = name;
    sel.appendChild(o);
  }

  // 以前の選択を保持する場合のみ復元
  if (keepSelection && names.includes(prev)) {
    sel.value = prev;
  } else {
    sel.value = ''; // ★ 初期は空選択状態
  }
}

function handleSave() {
  const name = $('presetName').value.trim();
  if (!name) return alert('プリセット名を入力してください。');
  const presets = loadPresets();
  presets[name] = { form: collectFormStateRaw() };
  savePresets(presets);
  updatePresetSelect();
  $('presetSelect').value = name;
  showBanner(`「${name}」を保存しました。`);
  flashButtonFeedback('saveBtn', '✓ 保存しました');
}

function handleOverwrite() {
  const sel = $('presetSelect');
  const name = sel.value;
  if (!name) return alert('上書きするプリセットを選択してください。');
  const presets = loadPresets();
  presets[name] = { form: collectFormStateRaw() };
  savePresets(presets);
  showBanner(`「${name}」を上書き保存しました。`);
  flashButtonFeedback('overwriteBtn', '✓ 上書き済み');
}

function handleDelete() {
  const sel = $('presetSelect');
  const name = sel.value;
  if (!name) return alert('削除するプリセットを選択してください。');
  if (!confirm(`「${name}」を削除しますか？`)) return;
  const presets = loadPresets();
  delete presets[name];
  savePresets(presets);
  updatePresetSelect();
  sel.value = '';
  showBanner(`「${name}」を削除しました。`);
}

function handleRename() {
  const sel = $('presetSelect');
  const oldName = sel.value;
  const newName = $('presetName').value.trim();
  if (!oldName || !newName) return alert('変更対象と新しい名前を指定してください。');
  const presets = loadPresets();
  if (presets[newName]) return alert('同名のプリセットが既に存在します。');
  presets[newName] = presets[oldName];
  delete presets[oldName];
  savePresets(presets);
  updatePresetSelect();
  $('presetSelect').value = newName;
  showBanner(`「${oldName}」を「${newName}」に変更しました。`);
  flashButtonFeedback('renameBtn', '✓ 変更しました');
}

function handleApplyPreset() {
  const name = $('presetSelect').value;
  const presets = loadPresets();
  if (!name || !presets[name]) return;
  const data = presets[name];

  if (data.form) applyFormStateRaw(data.form);
  else if (data.params) applyParams(data.params);

  // ★ 選択した名前を「新規／変更後の名前」に反映
  $('presetName').value = name;

  $('presetSelect').value = name; // 選択維持
  calc();
  showBanner(`プリセット「${name}」を適用しました。`);
}

// すべての input/select の「今の値」を {id: value} で収集（checkboxはtrue/false）
function collectFormStateRaw() {
  const state = {};
  document.querySelectorAll('input[id], select[id]').forEach(el => {
    if (RAW_EXCLUDE.has(el.id)) return;   // ★ 除外
    state[el.id] = (el.type === 'checkbox') ? el.checked : el.value;
  });
  return state;
}

// {id: value} をフォームに流し込む（存在するidのみ）
// ※ 後続で updateMainFieldState を呼んで無効/有効も反映する
function applyFormStateRaw(state) {
  if (!state) return;
  Object.entries(state).forEach(([id, val]) => {
    if (RAW_EXCLUDE.has(id)) return;      // ★ 除外
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!val;
    else el.value = val;
  });
  ['glove','clothes','crest','ring','brooch'].forEach(updateMainFieldState);
}

/* ---------------------------------------------------------
   共有URL関連
--------------------------------------------------------- */
function encodeObj(obj) {
  return btoa(encodeURIComponent(JSON.stringify(obj)));
}
function decodeObj(str) {
  return JSON.parse(decodeURIComponent(atob(str)));
}
function currentShareName() {
  const sel = $('presetSelect');
  const selectedName = sel && sel.value ? (sel.options[sel.selectedIndex]?.text || '') : '';
  const typed = ($('presetName')?.value || '').trim();
  return selectedName || typed || '';
}
function buildShareUrl() {
  // v4 形式: form（全入力のスナップショット）を持つ
  const payload = { v: 4, name: currentShareName(), form: collectFormStateRaw() };
  const u = new URL(location.href);
  u.search = '';
  u.searchParams.set('p', btoa(encodeURIComponent(JSON.stringify(payload))));
  return u.toString();
}
function tryLoadFromUrl() {
  const sp = new URLSearchParams(location.search);
  const p = sp.get('p');
  if (!p) return false;
  try {
    const obj = JSON.parse(decodeURIComponent(atob(p)));
    if (obj) {
      if (obj.form) {                 // v4+
        applyFormStateRaw(obj.form);
      } else if (obj.params) {        // 旧v3: paramsのみ
        applyParams(obj.params);
      } else {
        return false;
      }
      if (obj.name) $('presetName').value = obj.name;
      calc();
      showBanner('URLからパラメータを読み込みました。');
      return true;
    }
  } catch {}
  return false;
}

/* 共有メニュー操作 */
function openShareMenu(show = true) {
  $('shareMenu').setAttribute('aria-hidden', show ? 'false' : 'true');
}
function copyTextAndNotify(text, msg) {
  navigator.clipboard.writeText(text).then(() => {
    showBanner(msg);
  }).catch(() => {
    window.prompt('このテキストをコピーしてください：', text);
  }).finally(() => openShareMenu(false));
}

/* ---------------------------------------------------------
   リセット / バナー
--------------------------------------------------------- */
function showBanner(msg) {
  const banner = document.createElement('div');
  banner.className = 'banner';
  banner.textContent = msg;
  document.body.appendChild(banner);
  setTimeout(() => banner.classList.add('show'), 20);
  setTimeout(() => banner.classList.remove('show'), 2200);
  setTimeout(() => banner.remove(), 2500);
}

/* ---------------------------------------------------------
   ヘルプモーダル
--------------------------------------------------------- */
function openHelp(show = true) {
  $('helpOverlay').setAttribute('aria-hidden', show ? 'false' : 'true');
}
function initHelp() {
  const hide = localStorage.getItem(HELP_KEY) === '1';
  if (!hide) openHelp(true);
}

/* ---------------------------------------------------------
   起動処理
--------------------------------------------------------- */
window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initCollapsibles();
  updatePresetSelect(false);
  initEquipMainState();
  initMobileKeyboardsAndZeroClear();

  if (!tryLoadFromUrl()) calc(true);

  // 入力変更で自動再計算
  document.querySelectorAll('input, select').forEach(el => {
    el.addEventListener('input', debouncedCalc);
    el.addEventListener('change', () => calc()); // 確定系は即時
  });

  // プリセット
  $('saveBtn').onclick = handleSave;
  $('overwriteBtn').onclick = handleOverwrite;
  $('deleteBtn').onclick = handleDelete;
  $('renameBtn').onclick = handleRename;
  $('presetSelect').addEventListener('change', ()=>{
    const sel = $('presetSelect');
    const name = sel.value || '';
    // ★ 名前欄に反映（空なら空のままでOK）
    $('presetName').value = name;
    handleApplyPreset();
  });

  // 共有メニュー
  $('shareUrlBtn').addEventListener('click', e => { e.stopPropagation(); openShareMenu(true); });
  $('copyPlainBtn').addEventListener('click', () => {
    copyTextAndNotify(buildShareUrl(), '共有URLをコピーしました。');
  });
  $('copyMarkdownBtn').addEventListener('click', () => {
    const url = buildShareUrl();
    const name = currentShareName() || 'unVEIL the world ダメージ設定';
    copyTextAndNotify(`[${name}](${url})`, 'Markdown形式でコピーしました。');
  });
  document.addEventListener('click', e => {
    if (!document.querySelector('.menu-anchor').contains(e.target)) openShareMenu(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') openShareMenu(false);
  });

  // テーマ切替
  $('themeBtn').addEventListener('click', toggleTheme);

  // ヘルプ
  $('helpBtn').onclick = () => openHelp(true);
  $('helpClose').onclick = () => openHelp(false);
  $('helpOk').onclick = () => openHelp(false);
  $('helpDontShow').addEventListener('change', e => {
    localStorage.setItem(HELP_KEY, e.target.checked ? '1' : '0');
  });
  $('helpOverlay').addEventListener('click', e => {
    if (e.target.id === 'helpOverlay') openHelp(false);
  });
  initHelp();

  // リセット
  $('resetBtn').onclick = () => {
    if (!confirm('すべての入力を初期状態に戻します。よろしいですか？')) return;
    localStorage.removeItem(STATE_KEY);
    document.querySelectorAll('input, select').forEach(el => {
      if (el.type === 'checkbox') el.checked = el.defaultChecked;
      else el.value = el.defaultValue;
    });
    calc(true);
    showBanner('入力を初期化しました。');
  };
});
