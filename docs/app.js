// ====== ユーティリティ ======
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const toNum = (v) => (Number.isFinite(+v) ? +v : 0);
const fmtInt = (n) => Math.floor(n).toLocaleString('ja-JP');
const fmtPct = (n) => (Math.round(n * 100) / 100).toFixed(2);
const fmt2 = (n) => (Math.round(n * 100) / 100).toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ====== 折りたたみ状態 永続化 ======
const COLLAPSE_KEY = 'uvt-collapse-v1';
function initCollapsePersistence() {
  // 既存の保存内容を読む
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}'); } catch {}
  // details[id] を対象に復元＆監視
  $$('details.card[id]').forEach(d => {
    // 既に保存があればそれを反映（なければHTMLの既定openを尊重）
    if (Object.prototype.hasOwnProperty.call(saved, d.id)) {
      d.open = !!saved[d.id];
    }
    // 開閉が変わるたびに保存
    d.addEventListener('toggle', () => {
      const cur = (() => { try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}'); } catch { return {}; }})();
      cur[d.id] = d.open;
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(cur));
    });
  });
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
    el.addEventListener('input', () => { state[key] = toNum(el.value); render(); });
  });

  $('#affinity').addEventListener('change', (e) => { state.affinity = e.target.value; render(); });
  $('#isBreak').addEventListener('change', (e) => { state.isBreak = !!e.target.checked; render(); });

  // 装備: メイン種別
  $$('.mainType').forEach((sel) => {
    sel.addEventListener('change', () => {
      const slot = sel.dataset.slot;
      state.equip[slot].mainType = sel.value;
      updateMainValState(slot);
      render();
    });
  });
  // 装備: メイン値
  $$('.mainVal').forEach((inp) => {
    inp.addEventListener('input', () => {
      const slot = inp.dataset.slot;
      const fixedType = inp.dataset.mainType; // glove/armor 固定
      if (fixedType) state.equip[slot].mainType = fixedType;
      state.equip[slot].mainVal = toNum(inp.value); render();
    });
  });
  // 装備: サブ
  $$('input[data-sub]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const slot = inp.dataset.slot; const k = inp.dataset.sub;
      state.equip[slot].sub[k] = toNum(inp.value); render();
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
  for (const [slot, gear] of Object.entries(s.equip)) {
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
  const equipAdjAtk = sum.atk + (s.baseAtk * (1 + (sum.atkPct / 100)));
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
  const afterSkillMult = finalAtk * (1 + (s.skillPct / 100));
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
  const r = calcAll(state);

  // 合計表示
  $('#sumEquipAtk').textContent = fmtInt(r.sums.atk);
  $('#sumEquipAtkPct').textContent = fmtPct(r.sums.atkPct);
  $('#sumEquipCritRate').textContent = fmtPct(r.sums.critRate);
  $('#sumEquipCritDmg').textContent = fmtPct(r.sums.critDmg);
  $('#sumEquipElemDmgPct').textContent = fmtPct(r.sums.elemDmgPct);

  // 内訳
  $('#outEquipAdjAtk').textContent = fmtInt(r.equipAdjAtk);
  $('#outFinalAtk').textContent = fmtInt(r.finalAtk);
  $('#outAfterSkillMult').textContent = fmt2(r.afterSkillMult);
  $('#outAfterSkillAdd').textContent = fmt2(r.afterSkillAdd);
  $('#outAfterDmgUp').textContent = fmt2(r.afterDmgUp);
  $('#outAfterCardUp').textContent = fmt2(r.afterCardUp);
  $('#outAllElemPct').textContent = fmtPct(r.allElemPct);
  $('#outAfterElemUp').textContent = fmt2(r.afterElemUp);
  $('#outAffinity').textContent = r.affinity.toFixed(2);
  $('#outAfterAffinity').textContent = fmt2(r.afterAffinity);
  $('#outBreak').textContent = r.breakMul.toFixed(2);
  $('#outAfterBreak').textContent = fmt2(r.afterBreak);
  $('#outDefCoeff').textContent = r.defCoeff.toFixed(4);
  $('#outAfterDefense').textContent = fmt2(r.afterDefense);
  $('#outAllCritRate').textContent = fmtPct(r.allCritRate);
  $('#outAllCritDmg').textContent = fmtPct(r.allCritDmg);

  // 結果値
  $('#outNormal').textContent = fmtInt(r.normal);
  $('#outAverage').textContent = fmtInt(r.average);
  $('#outCrit').textContent = fmtInt(r.crit);

  // チャート（セグメント表示：通常→平均→会心）
  const max = Math.max(1, r.crit, r.average, r.normal);
  const wNormal = (r.normal / max) * 100;
  const wAvg = Math.max(0, (r.average - r.normal) / max) * 100;
  const wCrit = Math.max(0, (r.crit - r.average) / max) * 100;
  const set = (el, left, width) => { el.style.left = left + '%'; el.style.width = width + '%'; };
  set($('#barNormal'), 0, wNormal);
  set($('#barAvg'), wNormal, wAvg);
  set($('#barCrit'), wNormal + wAvg, wCrit);
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
  // 開閉状態は変更しない
  setInputsFromState(state);
  render();
  toast('初期化しました');
}

// ====== 共有URL（Base64圧縮を強制） ======
// LZ-String（簡易組込み）
const LZString = (function(){
  const f = String.fromCharCode;
  const keyStrBase64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  const getBaseValue = (alphabet, character) => alphabet.indexOf(character);
  const LZ = {
    compressToBase64: function (input) { if (input == null) return ""; let res = LZ._compress(input, 6, a=>keyStrBase64.charAt(a)); switch (res.length % 4) { default: case 0: return res; case 1: return res + "==="; case 2: return res + "=="; case 3: return res + "="; } },
    decompressFromBase64: function (input) { if (input == null) return ""; if (input === "") return null; let buffer = 0, bc = 0, idx = 0, v; input = input.replace(/[^A-Za-z0-9\+\/\=]/g, ""); return LZ._decompress(input.length, 32, function(){ if (bc % 4 === 0) v = keyStrBase64.indexOf(input.charAt(idx++)); buffer = (buffer << 6) | v; bc = (bc + 1) % 4; return (buffer >> (bc*2)) & 0x3F; }); },
    _compress: function (uncompressed, bitsPerChar, getCharFromInt) {
      if (uncompressed == null) return ""; let i, value, dict = {}, dictToCreate = {}, c = "", wc = "", w = "", enlargeIn = 2, dictSize = 3, numBits = 2, data = [], data_val = 0, data_pos = 0, ii;
      for (ii = 0; ii < uncompressed.length; ii++) { c = uncompressed.charAt(ii); if (!Object.prototype.hasOwnProperty.call(dict, c)) { dict[c] = dictSize++; dictToCreate[c] = true; } wc = w + c; if (Object.prototype.hasOwnProperty.call(dict, wc)) w = wc; else { if (Object.prototype.hasOwnProperty.call(dictToCreate, w)) { if (w.charCodeAt(0) < 256) { for (i=0;i<numBits;i++){ data_val <<= 1; if (data_pos==bitsPerChar-1){data_pos=0; data.push(getCharFromInt(data_val)); data_val=0;} else data_pos++; } value = w.charCodeAt(0); for (i=0;i<8;i++){ data_val = (data_val<<1) | (value&1); if (data_pos==bitsPerChar-1){data_pos=0; data.push(getCharFromInt(data_val)); data_val=0;} else data_pos++; value >>= 1; } } else { value = 1; for (i=0;i<numBits;i++){ data_val=(data_val<<1) | value; if (data_pos==bitsPerChar-1){data_pos=0; data.push(getCharFromInt(data_val)); data_val=0;} else data_pos++; value = 0; } value = w.charCodeAt(0); for (i=0;i<16;i++){ data_val=(data_val<<1) | (value&1); if (data_pos==bitsPerChar-1){data_pos=0; data.push(getCharFromInt(data_val)); data_val=0;} else data_pos++; value >>= 1; } } enlargeIn--; if (enlargeIn==0){enlargeIn=Math.pow(2,numBits); numBits++; } delete dictToCreate[w]; } else { value = dict[w]; for (i=0;i<numBits;i++){ data_val=(data_val<<1) | (value&1); if (data_pos==bitsPerChar-1){data_pos=0; data.push(getCharFromInt(data_val)); data_val=0;} else data_pos++; value >>= 1; } } enlargeIn--; if (enlargeIn==0){enlargeIn=Math.pow(2,numBits); numBits++; } dict[wc] = dictSize++; w = String(c); } }
      if (w !== "") { if (Object.prototype.hasOwnProperty.call(dictToCreate, w)) { if (w.charCodeAt(0) < 256) { for (i=0;i<numBits;i++){ data_val<<=1; if (data_pos==bitsPerChar-1){data_pos=0; data.push(getCharFromInt(data_val)); data_val=0;} else data_pos++; } value = w.charCodeAt(0); for (i=0;i<8;i++){ data_val=(data_val<<1) | (value&1); if (data_pos==bitsPerChar-1){data_pos=0; data.push(getCharFromInt(data_val)); data_val=0;} else data_pos++; value >>= 1; } } else { value = 1; for (i=0;i<numBits;i++){ data_val=(data_val<<1) | value; if (data_pos==bitsPerChar-1){data_pos=0; data.push(getCharFromInt(data_val)); data_val=0;} else data_pos++; value = 0; } value = w.charCodeAt(0); for (i=0;i<16;i++){ data_val=(data_val<<1) | (value&1); if (data_pos==bitsPerChar-1){data_pos=0; data.push(getCharFromInt(data_val)); data_val=0;} else data_pos++; value >>= 1; } } enlargeIn--; if (enlargeIn==0){enlargeIn=Math.pow(2,numBits); numBits++; } delete dictToCreate[w]; } else { value = dict[w]; for (i=0;i<numBits;i++){ data_val=(data_val<<1) | (value&1); if (data_pos==bitsPerChar-1){data_pos=0; data.push(getCharFromInt(data_val)); data_val=0;} else data_pos++; value >>= 1; } } }
      value = 2; for (i=0;i<numBits;i++){ data_val=(data_val<<1) | (value&1); if (data_pos==bitsPerChar-1){data_pos=0; data.push(getCharFromInt(data_val)); data_val=0;} else data_pos++; value >>= 1; }
      while (true) { data_val <<= 1; if (data_pos==bitsPerChar-1){ data.push(getCharFromInt(data_val)); break; } else data_pos++; }
      return data.join('');
    },
    _decompress: function (length, resetValue, getNextValue) {
      const dictionary = []; let next, enlargeIn = 4, dictSize = 4, numBits = 3, entry = "", result = [], bits, resb, maxpower, power;
      const data = { val: getNextValue(0), position: resetValue, index: 1 };
      for (let i = 0; i < 3; i++) dictionary[i] = i;
      let c = 0; switch ((function(){ let maxpower=Math.pow(2,2), power=1, bits=0, resb; while(power!=maxpower){ resb=data.val & data.position; data.position >>= 1; if(data.position==0){ data.position=resetValue; data.val=getNextValue(data.index++);} bits |= (resb>0?1:0)*power; power <<= 1;} return bits; })()) { case 0: { let maxpower=Math.pow(2,8), power=1, bits=0, resb; while(power!=maxpower){ resb=data.val & data.position; data.position >>= 1; if(data.position==0){ data.position=resetValue; data.val=getNextValue(data.index++);} bits |= (resb>0?1:0)*power; power <<= 1;} c = String.fromCharCode(bits); break;} case 1: { let maxpower=Math.pow(2,16), power=1, bits=0, resb; while(power!=maxpower){ resb=data.val & data.position; data.position >>= 1; if(data.position==0){ data.position=resetValue; data.val=getNextValue(data.index++);} bits |= (resb>0?1:0)*power; power <<= 1;} c = String.fromCharCode(bits); break;} case 2: return ""; }
      dictionary[3] = c; let w = c; result.push(c);
      while (true) {
        if (data.index > length) return "";
        const cc = (function(){ let maxpower=Math.pow(2,numBits), power=1, bits=0, resb; while(power!=maxpower){ resb=data.val & data.position; data.position >>= 1; if(data.position==0){ data.position=resetValue; data.val=getNextValue(data.index++);} bits |= (resb>0?1:0)*power; power <<= 1;} return bits; })();
        switch (next = cc) {
          case 0: { let maxpower=Math.pow(2,8), power=1, bits=0, resb; while(power!=maxpower){ resb=data.val & data.position; data.position >>= 1; if(data.position==0){ data.position=resetValue; data.val=getNextValue(data.index++);} bits |= (resb>0?1:0)*power; power <<= 1;} dictionary[dictSize++] = String.fromCharCode(bits); next = dictSize - 1; enlargeIn--; break; }
          case 1: { let maxpower=Math.pow(2,16), power=1, bits=0, resb; while(power!=maxpower){ resb=data.val & data.position; data.position >>= 1; if(data.position==0){ data.position=resetValue; data.val=getNextValue(data.index++);} bits |= (resb>0?1:0)*power; power <<= 1;} dictionary[dictSize++] = String.fromCharCode(bits); next = dictSize - 1; enlargeIn--; break; }
          case 2: return result.join('');
        }
        if (enlargeIn == 0) { enlargeIn = Math.pow(2, numBits); numBits++; }
        let c2; if (dictionary[next]) c2 = dictionary[next]; else if (next === dictSize) c2 = w + w.charAt(0); else return "";
        result.push(c2); dictionary[dictSize++] = w + c2.charAt(0); enlargeIn--; w = c2; if (enlargeIn == 0) { enlargeIn = Math.pow(2, numBits); numBits++; }
      }
    }
  };
  return { compressToBase64: LZ.compressToBase64, decompressFromBase64: (b64)=>{ const res = LZ.decompressFromBase64(b64); return res == null ? '' : res; } };
})();

function encodeStateShort(s) { try { return LZString.compressToBase64(JSON.stringify(s)); } catch { return ''; } }
function decodeStateShort(b64) { try { const txt = LZString.decompressFromBase64(b64); return JSON.parse(txt); } catch { return null; } }

function initShare() {
  const dlg = $('#shareDialog');
  const openerBtn = $('#shareBtn');

  openerBtn.addEventListener('click', () => {
    dlg.showModal();
    // 直ちにダイアログへフォーカス（ボタンのフォーカスを避ける）
    if (!dlg.hasAttribute('tabindex')) dlg.setAttribute('tabindex', '-1');
    openerBtn.blur();
    dlg.focus({ preventScroll: true });
  });

  const makeUrl = () => `${location.origin}${location.pathname}?z=${encodeURIComponent(encodeStateShort(state))}`;
  const copy = (fmt) => {
    const url = makeUrl();
    const text = fmt === 'md' ? `[unVEIL the world: ダメージシミュレーター](${url})` : url;
    navigator.clipboard?.writeText(text)
      .then(() => { toast('クリップボードにコピーしました'); dlg.close(); })
      .catch(() => { window.prompt('コピーしてください', text); dlg.close(); });
  };
  $('#copyUrl').addEventListener('click', (e)=>{ e.preventDefault(); copy('url'); });
  $('#copyMd').addEventListener('click',  (e)=>{ e.preventDefault(); copy('md');  });
  // 閉じるボタン
  $('#closeShare').addEventListener('click', () => dlg.close());

  // 閉じたら開いたボタンにフォーカスを戻す
  dlg.addEventListener('close', () => openerBtn?.focus());
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

// ====== プリセット ======
const STORAGE_KEY = 'uvt-presets-v1';
function loadPresets() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; } }
function savePresets(map) { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); }
function refreshPresetSelect() {
  const sel = $('#presetSelect');
  const map = loadPresets();
  sel.innerHTML = '';
  const blank = document.createElement('option'); blank.value = ''; blank.textContent = '';
  sel.appendChild(blank);
  Object.keys(map).sort().forEach((k) => { const o = document.createElement('option'); o.value = k; o.textContent = k; sel.appendChild(o); });
  sel.value = '';
}
function initPresets() {
  refreshPresetSelect();

  $('#savePreset').addEventListener('click', () => {
    let name = $('#presetName').value.trim();
    if (!name) { toast('プリセット名を入力してください'); return; }
    const map = loadPresets();
    map[name] = state; savePresets(map); refreshPresetSelect();
    $('#presetSelect').value = name; toast('プリセットを保存しました');
  });

  $('#renamePreset').addEventListener('click', () => {
    const cur = $('#presetSelect').value;
    const name = $('#presetName').value.trim();
    if (!cur) { toast('変更するプリセットを選択してください'); return; }
    if (!name) { toast('新しい名前を入力してください'); return; }
    const map = loadPresets();
    if (!map[cur]) { toast('指定のプリセットが見つかりません'); return; }
    map[name] = map[cur]; delete map[cur]; savePresets(map); refreshPresetSelect();
    $('#presetSelect').value = name; toast('名前を変更しました');
  });

  $('#deletePreset').addEventListener('click', () => {
    const cur = $('#presetSelect').value;
    if (!cur) { toast('削除するプリセットを選択してください'); return; }
    if (!confirm('選択中のプリセットを削除します。よろしいですか？')) return;
    const map = loadPresets(); delete map[cur]; savePresets(map); refreshPresetSelect();
    $('#presetSelect').value = '';
    $('#presetName').value = '';
    toast('削除しました');
  });

  $('#presetSelect').addEventListener('change', (e) => {
    const name = e.target.value; const map = loadPresets();
    if (!name || !map[name]) { $('#presetName').value = ''; return; }
    state = structuredClone(map[name]);
    $('#presetName').value = name;
    setInputsFromState(state); render(); toast('プリセットを読み込みました');
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
      if (decoded) state = decoded; else applyQueryParams(qs);
    } else {
      applyQueryParams(qs);
    }
  } else {
    state = structuredClone(DEFAULTS);
  }
  setInputsFromState(state);
  render();
}

function initReset() {
  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('すべての入力を初期化します。よろしいですか？')) return;
    resetAll();
  });
}

// Kickoff
window.addEventListener('DOMContentLoaded', () => {
  initCollapsePersistence();
  initTheme();
  bindInputs();
  initFromQueryOrDefaults();
  initShare();
  initPresets();
  initReset();
});