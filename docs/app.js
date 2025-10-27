import { computeAll } from './formulas.js';

// ========== ユーティリティ ==========
const $ = (id) => document.getElementById(id);
const num = (id) => parseFloat($(id).value);
const NOW = () => new Date().toISOString();
const PRESETS_KEY = 'uvtw_user_presets_v2';
const STATE_KEY   = 'uvtw_params_v7';

function fmtInt(n){ return Math.round(n).toLocaleString('ja-JP'); }
function fmtMul(n){ return (Number(n).toFixed(3)); }
function fmtFloat(n){ return Number(n).toFixed(3); }

function uid(){ return 'p' + Math.random().toString(36).slice(2,8) + Date.now().toString(36); }

// Base64URL でオブジェクトを1パラメータに圧縮
function encodeObj(obj){
  const json = JSON.stringify(obj);
  const b64  = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function decodeObj(s){
  const b64 = s.replace(/-/g,'+').replace(/_/g,'/');
  const json = decodeURIComponent(escape(atob(b64)));
  return JSON.parse(json);
}

// ========== 入出力 ==========
function collectParams(){
  return {
    atk: num('atk') || 0,
    familiarAtk: num('familiarAtk') || 0,
    critRatePct: num('critRatePct') || 0,
    critDmgPct: num('critDmgPct') || 0,
    atkUpPct: num('atkUpPct') || 0,
    skillPct: num('skillPct') || 0,
    skillFlat: num('skillFlat') || 0,
    cardUpPct: num('cardUpPct') || 0,
    globalUpPct: num('globalUpPct') || 0,
    elemUpPct: num('elemUpPct') || 0,
    def: num('def') || 0,
    affinity: $('affinity').value,
    applyBreak: $('applyBreak').checked
  };
}

function applyParams(values){
  Object.entries(values).forEach(([k,v])=>{
    const el = $(k);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v;
  });
}

function render(out){
  // 途中値テーブル
  const rows = [
    ['攻撃力',                      fmtFloat(out.atkBase)],
    ['使い魔攻撃力',                fmtFloat(out.familiar)],
    ['攻撃力アップ (1+%)',          `×${fmtMul(out.atkUp)}`],   // ← 追加
    ['＝ 計算用攻撃力',             fmtFloat(out.atkEff)],
    ['(攻撃×スキル% + 固定値)',     fmtFloat(out.baseTerm)],
    ['カード系 (1+%)',              `×${fmtMul(out.cardUp)}`],
    ['全体 (1+%)',                  `×${fmtMul(out.globalUp)}`],
    ['属性 (1+%)',                  `×${fmtMul(out.elemUp)}`],
    ['防御係数 e^(-DEF/1092)',      `×${fmtMul(out.defenseFactor)}`],
    ['＝ 基本ダメージ',             fmtFloat(out.basic)],
    ['会心（発生時）',              `確定会心 ×${fmtMul(out.critMulOn)}`],
    ['会心（期待値）',              `期待値 ×${fmtMul(out.critMulExpected)}`],
    ['属性相性',                    out.affinityLabel],
    ['ブレイク',                    `×${fmtMul(out.breakMul)}`],
    ['＝ 最終（通常／丸め前）',      fmtFloat(out.finalRawNoCrit)],
    ['最終（通常／切り捨て）',       fmtInt(out.finalNoCrit)],
    ['＝ 最終（会心発生時／丸め前）', fmtFloat(out.finalRawCritOn)],
    ['最終（会心発生時／切り捨て）',  fmtInt(out.finalCritOn)],
    ['＝ 最終（期待値／丸め前）',     fmtFloat(out.finalRawExpected)],
    ['最終（期待値／切り捨て）',      fmtInt(out.finalExpected)],
  ];
  const tbody = document.getElementById('breakdown').querySelector('tbody');
  tbody.innerHTML = rows.map(([k,v])=>`<tr><td>${k}</td><td class="num">${v}</td></tr>`).join('');

  // バーの更新（最大値を基準に 3 本を相対化）
  const vNo  = out.finalNoCrit;
  const vOn  = out.finalCritOn;
  const vExp = out.finalExpected;
  const maxV = Math.max(vNo, vOn, vExp, 1);

  updateStackedBars(out.finalNoCrit, out.finalCritOn, out.finalExpected);

  const resultBody = document.getElementById('result-body');
  resultBody.classList.add('updated');
  setTimeout(()=>resultBody.classList.remove('updated'), 400);
}

function calc(save=true){
  const params = collectParams();
  const out = computeAll(params);
  render(out);
  if (save) localStorage.setItem(STATE_KEY, JSON.stringify(params));
}

// ========== プリセット管理 ==========
function loadPresets(){
  try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]'); }
  catch { return []; }
}
function savePresets(list){
  localStorage.setItem(PRESETS_KEY, JSON.stringify(list));
}
function refreshPresetSelect(selectId){
  const sel = $('presetSelect');
  const presets = loadPresets();
  sel.innerHTML = presets.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  if (selectId) sel.value = selectId;
}
function handleSavePreset(){
  const name = $('presetName').value.trim() || '未命名プリセット';
  const values = collectParams();
  const presets = loadPresets();
  const item = { id: uid(), name, values, updatedAt: NOW() };
  presets.unshift(item);
  savePresets(presets);
  refreshPresetSelect(item.id);
  $('presetName').value = '';
  showBanner(`「${item.name}」を保存しました。`);
}
function handleOverwritePreset(){
  const sel = $('presetSelect');
  const id = sel.value;
  if (!id) return;
  const presets = loadPresets();
  const idx = presets.findIndex(x=>x.id===id);
  if (idx === -1) return;
  presets[idx].values = collectParams();
  presets[idx].updatedAt = NOW();
  savePresets(presets);
  showBanner(`プリセット「${presets[idx].name}」を上書き保存しました。`);
}
function handleRenamePreset(){
  const sel = $('presetSelect');
  const id = sel.value;
  if (!id) return;
  const name = $('presetName').value.trim();
  if (!name){ showBanner('名前を入力してください。'); return; }
  const presets = loadPresets();
  const idx = presets.findIndex(x=>x.id===id);
  if (idx === -1) return;
  presets[idx].name = name;
  presets[idx].updatedAt = NOW();
  savePresets(presets);
  refreshPresetSelect(id);
  $('presetName').value = '';
  showBanner(`プリセット名を「${name}」に変更しました。`);
}
function handleApplyPresetById(id){
  const presets = loadPresets();
  const p = presets.find(x=>x.id===id);
  if (!p) return;
  applyParams(p.values);
  calc();
  showBanner(`プリセット「${p.name}」を適用しました。`);
}
function handleDeletePreset(){
  const sel = $('presetSelect');
  const id = sel.value;
  if (!id) return;
  const presets = loadPresets();
  const idx = presets.findIndex(x=>x.id===id);
  if (idx === -1) return;
  const name = presets[idx].name;
  presets.splice(idx,1);
  savePresets(presets);
  refreshPresetSelect();
  showBanner(`プリセット「${name}」を削除しました。`);
}

// ========== URL 共有 ==========
function currentShareName(){
  // 1) 選択中プリセットの名前 2) 入力欄の名前 3) 未指定なら空
  const sel = document.getElementById('presetSelect');
  const selectedName = sel && sel.value ? (sel.options[sel.selectedIndex]?.text || '') : '';
  const typed = (document.getElementById('presetName')?.value || '').trim();
  return selectedName || typed || '';
}

function buildShareUrl(){
  const payload = { v:3, name: currentShareName(), params: collectParams() };
  const u = new URL(location.href);
  u.search = '';
  u.searchParams.set('p', encodeObj(payload));
  return u.toString();
}
async function handleShareUrl(){
  openShareMenu(true);
}
function tryLoadFromUrl(){
  const sp = new URLSearchParams(location.search);
  const p = sp.get('p');
  if (!p) return false;
  try{
    const obj = decodeObj(p);
    if (obj && obj.params){
      applyParams(obj.params);
      calc();
      if (obj.name){
        const nameEl = document.getElementById('presetName');
        if (nameEl) nameEl.value = obj.name;
      }
      showBanner('URLからパラメータを読み込みました（保存は未実施）。');
      return true;
    }
  }catch{}
  return false;
}

// ========== 折り畳み（開閉状態の保存/復元 + アニメ） ==========
const COLLAPSE_KEY = 'uvtw_collapse_v3';

const DEFAULT_COLLAPSE = {
  preset: true,   // ← プリセットをデフォ閉
  status: false,
  skill:  false,
  buff:   false,
  enemy:  false,
  result: false,
  breakdown: true // ← 内訳はデフォ閉（従来どおり）
};


function loadCollapseState(){
  try{
    const parsed = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : { ...DEFAULT_COLLAPSE };
  }catch{
    return { ...DEFAULT_COLLAPSE };
  }
}
function saveCollapseState(state){
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify(state));
}

// 現在の開閉状態に合わせて高さをセット
function setHeights(section){
  const body = section.querySelector('.card-body');
  if (!body) return;
  if (section.classList.contains('collapsed')) {
    body.style.height = '0px';
  } else {
    // 開いているときは「内容の高さ」をセット（初期表示＆リサイズ用）
    body.style.height = body.scrollHeight + 'px';
  }
}

// 高さトランジションを実行
function animateToggle(section, willCollapse){
  const body = section.querySelector('.card-body');
  if (!body) return;

  section.classList.add('animating');

  // 現在の高さ → 目標の高さ
  const startH = body.getBoundingClientRect().height;
  const endH   = willCollapse ? 0 : body.scrollHeight;

  // 低速モーション配慮：transitionが無効なら即座に反映
  const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const computed = getComputedStyle(body);
  const dur = parseFloat(computed.transitionDuration || '0') +
              parseFloat(computed.transitionDelay || '0');

  const finish = () => {
    section.classList.remove('animating');
    if (!willCollapse) {
      // 開いたときは自動高さに戻す（内容変化に追従）
      body.style.height = 'auto';
      body.style.opacity = '1';
    } else {
      // 閉じたときは0px維持
      body.style.height = '0px';
      body.style.opacity = ''; // CSSに任せる
    }
  };

  if (prefersReduced || dur === 0 || isNaN(dur)) {
    // トランジションなしですぐ反映
    body.style.height = willCollapse ? '0px' : 'auto';
    finish();
    return;
  }

  // 通常のアニメ
  body.style.height = startH + 'px';
  // 次フレームで目標値へ
  requestAnimationFrame(()=>{ body.style.height = endH + 'px'; });

  let done = false;
  const onEnd = () => {
    if (done) return;
    done = true;
    body.removeEventListener('transitionend', onEnd);
    finish();
  };
  body.addEventListener('transitionend', onEnd);

  // フォールバック（万一 transitionend が来なくても解除する）
  setTimeout(onEnd, Math.max(250, dur * 1000 + 50));
}

function initCollapsibles(){
  const state = loadCollapseState();

  document.querySelectorAll('.card.collapsible').forEach(sec=>{
    const id = sec.getAttribute('data-collapse-id');

    // 初期クラス適用
    if (state[id] === true) sec.classList.add('collapsed');

    // 初期高さ
    const body = sec.querySelector('.card-body');
    if (body) {
      body.style.height = sec.classList.contains('collapsed') ? '0px' : body.scrollHeight + 'px';
    }

    const header = sec.querySelector('.card-header');
    const updateAria = () =>
      header.setAttribute('aria-expanded', sec.classList.contains('collapsed') ? 'false' : 'true');
    updateAria();

    const onToggle = () => {
      const willCollapse = !sec.classList.contains('collapsed');
      // 現在高さを固定してからクラス反転
      if (body) body.style.height = body.getBoundingClientRect().height + 'px';
      sec.classList.toggle('collapsed', willCollapse);
      animateToggle(sec, willCollapse);

      const st = loadCollapseState();
      st[id] = willCollapse;
      saveCollapseState(st);
      updateAria();
    };

    header.addEventListener('click', onToggle);
    header.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); }
    });

    // リサイズ時：開いているカードは高さを更新
    window.addEventListener('resize', ()=>{
      if (!sec.classList.contains('collapsed') && body) {
        body.style.height = 'auto';
        requestAnimationFrame(()=>{ if (body) body.style.height = body.scrollHeight + 'px'; });
      }
    });
  });
}

// 前回値を保持して差分アニメ
const prevVals = { noCrit: 0, critOn: 0, expected: 0 };

function animateNumber(el, from, to, dur=350){
  if (!isFinite(from)) from = 0;
  if (!isFinite(to))   to   = 0;
  const start = performance.now();
  const step = now => {
    const t = Math.min(1, (now - start) / dur);
    const val = Math.round(from + (to - from) * t);
    el.textContent = val.toLocaleString('ja-JP');
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function updateBarRow(rowEl, value, max){
  const fill = rowEl.querySelector('.fill');
  const valEl = rowEl.querySelector('.value');
  const key = rowEl.dataset.key;

  // 数値アニメ
  animateNumber(valEl, prevVals[key] || 0, value);

  // 幅アニメ（相対値）
  const pct = max > 0 ? (value / max) * 100 : 0;
  requestAnimationFrame(()=>{ fill.style.width = Math.max(0, Math.min(100, pct)) + '%'; });

  // 軽いハイライト
  rowEl.classList.add('updated');
  setTimeout(()=>rowEl.classList.remove('updated'), 360);

  prevVals[key] = value;
}

const prevLegend = { noCrit:0, critOn:0, expected:0 };

function updateStackedBars(vNo, vOn, vExp){
  const maxV = Math.max(vNo, vOn, vExp, 1);
  const pct = v => Math.max(0, Math.min(100, (v / maxV) * 100));

  // 幅
  document.getElementById('fill-critOn').style.width   = pct(vOn) + '%';   // ベース
  document.getElementById('fill-expected').style.width = pct(vExp) + '%';  // 中層
  document.getElementById('fill-noCrit').style.width   = pct(vNo) + '%';   // 最上

  // 凡例の数値アニメ（既存ロジック）
  const pairs = [
    ['noCrit',   vNo, 'leg-noCrit'],
    ['expected', vExp,'leg-expected'],
    ['critOn',   vOn, 'leg-critOn'],
  ];
  let changed = false;
  for (const [key, val, id] of pairs){
    if (prevLegend[key] !== val) changed = true;
    const el = document.getElementById(id);
    animateNumber(el, prevLegend[key] || 0, val);
    const leg = el.closest('.leg');
    leg.classList.add('updated');
    setTimeout(()=>leg.classList.remove('updated'), 360);
    prevLegend[key] = val;
  }

  // どれか変わっていたら結果カードに軽いアニメを付与
  if (changed) {
    const rb = document.getElementById('result-body');
    rb.classList.remove('changed'); // 連打でも再生させるため一度外す
    // 次フレームで付け直し
    requestAnimationFrame(()=> rb.classList.add('changed'));
    // 後始末（クラスはアニメ終了後残っていてもOKだが念のため）
    setTimeout(()=> rb.classList.remove('changed'), 420);
  }
}

function openShareMenu(show=true){
  const menu = document.getElementById('shareMenu');
  menu.setAttribute('aria-hidden', show ? 'false' : 'true');
}
function copyTextAndNotify(text, msg){
  navigator.clipboard.writeText(text).then(()=>{
    showBanner(msg);
  }).catch(()=>{
    // Fallback
    window.prompt('このテキストをコピーしてください：', text);
  }).finally(()=> openShareMenu(false));
}

// === Theme ===
const THEME_KEY = 'uvtw_theme';
function applyTheme(theme){
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
}
function initTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved || 'dark');
}
function toggleTheme(){
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}

// === Help Modal ===
const HELP_KEY = 'uvtw_help_hide';
function openHelp(show=true){ document.getElementById('helpOverlay').setAttribute('aria-hidden', show?'false':'true'); }
function initHelp(){
  const hide = localStorage.getItem(HELP_KEY) === '1';
  if (!hide) openHelp(true);
}

// ========== UI ヘルパ ==========
let bannerTimer = null;
function showBanner(text){
  const el = $('banner');
  el.textContent = text;
  el.style.display = 'block';
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(()=>{ el.style.display='none'; }, 3000);
}
function attachAutoCalc(){
  document.querySelectorAll('input, select').forEach(el=>{
    const evt = (el.tagName === 'SELECT' || el.type === 'checkbox') ? 'change' : 'input';
    el.addEventListener(evt, ()=>calc(true));
  });
}

// ========== 初期化 ==========
window.addEventListener('DOMContentLoaded', ()=>{
  refreshPresetSelect();
  $('shareUrlBtn').addEventListener('click', handleShareUrl);
  $('savePresetBtn').addEventListener('click', handleSavePreset);
  $('overwritePresetBtn').addEventListener('click', handleOverwritePreset);
  $('renamePresetBtn').addEventListener('click', handleRenamePreset);
  $('deletePresetBtn').addEventListener('click', handleDeletePreset);
  $('presetSelect').addEventListener('change', (e)=>{
    const id = e.target.value;
    if (id) handleApplyPresetById(id);
  });
  attachAutoCalc();
  initCollapsibles();
  if (!tryLoadFromUrl()){
    const saved = localStorage.getItem(STATE_KEY);
    if (saved){ applyParams(JSON.parse(saved)); }
    calc(false);
  }
  $('resetBtn').addEventListener('click', ()=>{
    const ok = window.confirm('すべての入力を初期状態に戻します。よろしいですか？');
    if (!ok) return;

    localStorage.removeItem(STATE_KEY);
    document.querySelectorAll('input, select').forEach(el=>{
      if ('defaultValue' in el) el.value = el.defaultValue;
      if (el.type === 'checkbox') el.checked = el.defaultChecked;
    });
    calc(true);
    showBanner('入力を初期化しました。');
  });

  // 共有メニュー
  document.getElementById('shareUrlBtn').addEventListener('click', (e)=>{
    e.stopPropagation();
    handleShareUrl();
  });
  document.getElementById('copyPlainBtn').addEventListener('click', ()=>{
    const url = buildShareUrl();
    copyTextAndNotify(url, '共有URLをコピーしました。');
  });
  document.getElementById('copyMarkdownBtn').addEventListener('click', ()=>{
  const url = buildShareUrl();
  const name = currentShareName() || 'unVEIL the world ダメージシミュレーター';
  const md  = `[${name}](${url})`;
  copyTextAndNotify(md, 'Markdown形式でコピーしました。');
  });

  // メニューの外をクリックしたら閉じる
  document.addEventListener('click', (e)=>{
    const anchor = document.querySelector('.menu-anchor');
    const menu   = document.getElementById('shareMenu');
    if (!anchor.contains(e.target)) openShareMenu(false);
  });

  // Escで閉じる
  document.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape') openShareMenu(false);
  });

  // Theme
  initTheme();
  document.getElementById('themeBtn').addEventListener('click', toggleTheme);

  // Help
  document.getElementById('helpBtn').addEventListener('click', ()=>openHelp(true));
  document.getElementById('helpClose').addEventListener('click', ()=>openHelp(false));
  document.getElementById('helpOk').addEventListener('click', ()=>openHelp(false));
  document.getElementById('helpDontShow').addEventListener('change', (e)=>{
    localStorage.setItem(HELP_KEY, e.target.checked ? '1' : '0');
  });
  // オーバーレイ外クリックで閉じる
  document.getElementById('helpOverlay').addEventListener('click', (e)=>{
    if (e.target.id === 'helpOverlay') openHelp(false);
  });

  // 初回自動表示
  initHelp();
});
