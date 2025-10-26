import { computeDamage } from './formulas.js';

const $ = (id) => document.getElementById(id);
const num = (id) => parseFloat($(id).value) || 0;

function fmt(n){ return Math.round(n).toLocaleString('ja-JP'); }

function collectParams() {
  return {
    atk: num('atk'),
    skill: num('skill'),
    def: num('def'),
    kConst: num('kConst'),
    addBuffPct: num('addBuff'),
    mulBuff: num('mulBuff'),
    elemMul: num('elem'),
    resistPct: num('resist'),
    critRatePct: num('critRate'),
    critDmgPct: num('critDmg'),
    varMin: num('varMin') || 1,
    varMax: num('varMax') || 1
  };
}

function render(result){
  $('exp').textContent   = isFinite(result.expected) ? fmt(result.expected) : '—';
  $('min').textContent   = isFinite(result.min) ? fmt(result.min) : '—';
  $('max').textContent   = isFinite(result.max) ? fmt(result.max) : '—';
  $('nocrit').textContent= isFinite(result.noCrit) ? fmt(result.noCrit) : '—';
  $('crit').textContent  = isFinite(result.onCrit) ? fmt(result.onCrit) : '—';
}

function calc(){
  const params = collectParams();
  const result = computeDamage(params);
  render(result);
  localStorage.setItem('uvtw_params', JSON.stringify(params));
}

function reset(){
  localStorage.removeItem('uvtw_params');
  document.querySelectorAll('input').forEach(inp=>{
    if (inp.defaultValue !== undefined) inp.value = inp.defaultValue;
  });
  render({expected:NaN,min:NaN,max:NaN,noCrit:NaN,onCrit:NaN});
}

window.addEventListener('DOMContentLoaded', ()=>{
  const saved = localStorage.getItem('uvtw_params');
  if (saved){
    const obj = JSON.parse(saved);
    Object.entries(obj).forEach(([k,v])=>{
      const el = $(kToId(k));
      if (el) el.value = v;
    });
  }
  $('calcBtn').addEventListener('click', calc);
  $('resetBtn').addEventListener('click', reset);
});

function kToId(k){
  // paramsのキーとidが同じなのでそのまま返す
  return k;
}
