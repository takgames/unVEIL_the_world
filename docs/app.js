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
    // A: ステータス
    atk: num('atk') || 0,
    familiarAtk: num('familiarAtk') || 0,
    critRatePct: num('critRatePct') || 0,
    critDmgPct: num('critDmgPct') || 0,
    // B: スキル
    skillPct: num('skillPct') || 0,
    skillFlat: num('skillFlat') || 0,
    // C: バフ
    cardUpPct: num('cardUpPct') || 0,
    globalUpPct: num('globalUpPct') || 0,
    elemUpPct: num('elemUpPct') || 0,
    // D: 敵
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
  $('basic').textContent        = isFinite(out.basic) ? fmtInt(out.basic) : '—';
  $('finalCritOn').textContent  = isFinite(out.finalCritOn) ? fmtInt(out.finalCritOn) : '—';
  $('finalExpected').textContent= isFinite(out.finalExpected) ? fmtInt(out.finalExpected) : '—';

  const rows = [
    ['攻撃力',                      fmtFloat(out.atkBase)],
    ['使い魔攻撃力',                fmtFloat(out.familiar)],
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
    ['＝ 最終（会心発生時／丸め前）', fmtFloat(out.finalRawCritOn)],
    ['最終（会心発生時／切り捨て）',  fmtInt(out.finalCritOn)],
    ['＝ 最終（期待値／丸め前）',     fmtFloat(out.finalRawExpected)],
    ['最終（期待値／切り捨て）',      fmtInt(out.finalExpected)],
  ];
  const tbody = $('breakdown').querySelector('tbody');
  tbody.innerHTML = rows.map(([k,v])=>`<tr><td>${k}</td><td class="num">${v}</td></tr>`).join('');
}

function calc(save=true){
  const params = collectParams();
  const out = computeAll(params);
  render(out);
  if (save) localStorage.setItem(STATE_KEY, JSON.stringify(params));
}

// ========== プリセット管理（localStorage） ==========
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
  presets.unshift(item);                // 新しいものを先頭に
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

function handleApplyPreset(){
  const sel = $('presetSelect');
  const id = sel.value;
  const presets = loadPresets();
  const p = presets.find(x=>x.id===id);
  if (!p) return;
  applyParams(p.values);
  calc(); // 適用と同時に再計算＆保存
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
function buildShareUrl(){
  const payload = { v:2, params: collectParams() };
  const u = new URL(location.href);
  u.search = ''; // 既存クエリを消す
  u.searchParams.set('p', encodeObj(payload));
  return u.toString();
}
async function handleShareUrl(){
  const url = buildShareUrl();
  try{
    await navigator.clipboard.writeText(url);
    showBanner('共有URLをクリップボードにコピーしました。');
  }catch{
    window.prompt('このURLをコピーしてください：', url);
  }
}
function tryLoadFromUrl(){
  const sp = new URLSearchParams(location.search);
  const p = sp.get('p');
  if (!p) return false;
  try{
    const obj = decodeObj(p);
    if (obj && obj.params){
      applyParams(obj.params);
      calc(); // 保存も更新
      showBanner('URLからパラメータを読み込みました（保存は未実施）。');
      return true;
    }
  }catch{}
  return false;
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

// ========== 初期化 ==========
function attachAutoCalc(){
  // すべての input/select に入力監視を付ける（自動計算 & 自動保存）
  document.querySelectorAll('input, select').forEach(el=>{
    const evt = (el.tagName === 'SELECT' || el.type === 'checkbox') ? 'change' : 'input';
    el.addEventListener(evt, ()=>calc(true));
  });
}

window.addEventListener('DOMContentLoaded', ()=>{
  // プリセットUI
  refreshPresetSelect();
  $('savePresetBtn').addEventListener('click', handleSavePreset);
  $('applyPresetBtn').addEventListener('click', handleApplyPreset);
  $('overwritePresetBtn').addEventListener('click', handleOverwritePreset);
  $('renamePresetBtn').addEventListener('click', handleRenamePreset);
  $('deletePresetBtn').addEventListener('click', handleDeletePreset);
  $('shareUrlBtn').addEventListener('click', handleShareUrl);

  // 入力変更で自動計算
  attachAutoCalc();

  // 保存値の復元 or URLロード
  if (!tryLoadFromUrl()){
    const saved = localStorage.getItem(STATE_KEY);
    if (saved){
      applyParams(JSON.parse(saved));
    }
    // ここでcalc()を呼べば初回表示が更新される
    calc(false);
  }

  // リセット
  $('resetBtn').addEventListener('click', ()=>{
    localStorage.removeItem(STATE_KEY);
    document.querySelectorAll('input, select').forEach(el=>{
      if ('defaultValue' in el) el.value = el.defaultValue;
      if (el.type === 'checkbox') el.checked = el.defaultChecked;
    });
    calc(true);
  });
});
