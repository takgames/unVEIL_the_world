import { computeAll } from './formulas.js';

const $ = (id) => document.getElementById(id);
const num = (id) => parseFloat($(id).value);

function fmtInt(n){ return Math.round(n).toLocaleString('ja-JP'); }
function fmtMul(n){ return (Number(n).toFixed(3)); }
function fmtFloat(n){ return Number(n).toFixed(3); }

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
    critMode: $('critMode').value,
    // D: 敵
    def: num('def') || 0,
    affinity: $('affinity').value,
    applyBreak: $('applyBreak').checked
  };
}

function render(out){
  // 結果
  $('basic').textContent = isFinite(out.basic) ? fmtInt(out.basic) : '—';
  $('final').textContent = isFinite(out.finalFloored) ? fmtInt(out.finalFloored) : '—';

  // 途中値テーブル
  const rows = [
    // A
    ['攻撃力',                     fmtFloat(out.atkBase)],
    ['使い魔攻撃力',               fmtFloat(out.familiar)],
    ['＝ 計算用攻撃力',            fmtFloat(out.atkEff)],
    // B
    ['(攻撃×スキル% + 固定値)',    fmtFloat(out.baseTerm)],
    // C
    ['カード系 (1+%)',             `×${fmtMul(out.cardUp)}`],
    ['全体 (1+%)',                 `×${fmtMul(out.globalUp)}`],
    ['属性 (1+%)',                 `×${fmtMul(out.elemUp)}`],
    // D
    ['防御係数 e^(-DEF/1092)',     `×${fmtMul(out.defenseFactor)}`],
    ['＝ 基本ダメージ',            fmtFloat(out.basic)],
    // 条件
    ['会心',                       `${out.critLabel}`],
    ['属性相性',                   `${out.affinityLabel}`],
    ['ブレイク',                   `×${fmtMul(out.breakMul)}`],
    ['＝ 最終（丸め前）',          fmtFloat(out.finalRaw)],
    ['最終（切り捨て）',           fmtInt(out.finalFloored)],
  ];
  const tbody = $('breakdown').querySelector('tbody');
  tbody.innerHTML = rows.map(([k,v])=>`<tr><td>${k}</td><td class="num">${v}</td></tr>`).join('');
}

function calc(){
  const params = collectParams();
  // 期待値モードの入力制御（UX）
  const mode = params.critMode;
  $('critRatePct').disabled = (mode !== 'expected');
  const out = computeAll(params);
  render(out);
  localStorage.setItem('uvtw_params_v4', JSON.stringify(params));
}

function reset(){
  localStorage.removeItem('uvtw_params_v4');
  document.querySelectorAll('input, select').forEach(el=>{
    if ('defaultValue' in el) el.value = el.defaultValue;
    if (el.type === 'checkbox') el.checked = el.defaultChecked;
  });
  $('critRatePct').disabled = ($('critMode').value !== 'expected');
  render({basic:NaN, finalFloored:NaN});
}

window.addEventListener('DOMContentLoaded', ()=>{
  const saved = localStorage.getItem('uvtw_params_v4');
  if (saved){
    const obj = JSON.parse(saved);
    Object.entries(obj).forEach(([k,v])=>{
      const el = $(k);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v;
    });
  }
  $('critRatePct').disabled = ($('critMode').value !== 'expected');
  $('calcBtn').addEventListener('click', calc);
  $('resetBtn').addEventListener('click', reset);
});
