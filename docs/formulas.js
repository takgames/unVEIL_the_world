// 検証式に準拠（指数防御 e^(-DEF/1092)）
// 単位ルール：◯◯(%) は 50 → +50%、倍率× は 1.20 → 1.2
const AFFINITY_MAP = { none: { mul: 1.00, label: "なし ×1.00" },
                       adv:  { mul: 1.25, label: "有利 ×1.25" },
                       dis:  { mul: 0.85, label: "不利 ×0.85" } };

export function computeAll(p) {
  // 基本ダメージ
  const atk = Math.max(0, +p.atk || 0);
  const skillPct = Math.max(0, +p.skillPct || 0) / 100; // % → 倍率
  const skillFlat = +p.skillFlat || 0;

  const cardUp = 1 + ( +p.cardUpPct || 0 ) / 100;
  const globalUp = 1 + ( +p.globalUpPct || 0 ) / 100;
  const elemUp = 1 + ( +p.elemUpPct || 0 ) / 100;

  const def = Math.max(0, +p.def || 0);
  const defenseFactor = Math.exp(-def / 1092); // e^(-DEF/1092)

  const baseTerm = atk * skillPct + skillFlat;
  const basic = baseTerm * cardUp * globalUp * elemUp * defenseFactor;

  // 会心
  const critDmg = Math.max(0, +p.critDmgPct || 0) / 100;
  const mode = p.critMode || 'none';
  const rate = Math.max(0, Math.min(100, +p.critRatePct || 0)) / 100;
  let critMul = 1;
  let critLabel = "会心なし ×1.00";
  if (mode === 'on') { critMul = 1 + critDmg; critLabel = `確定会心 ×${(critMul).toFixed(3)}`; }
  else if (mode === 'expected') { critMul = 1 + rate * critDmg; critLabel = `期待値(率${(rate*100).toFixed(1)}%) ×${critMul.toFixed(3)}`; }

  // 属性相性（固定）
  const aff = AFFINITY_MAP[p.affinity || 'none'] || AFFINITY_MAP.none;

  // ブレイク（固定1.30）
  const breakMul = p.applyBreak ? 1.30 : 1.00;

  // 最終
  const finalRaw = basic * critMul * aff.mul * breakMul;
  const finalFloored = Math.floor(finalRaw);

  return {
    // 中間
    baseTerm, cardUp, globalUp, elemUp, defenseFactor,
    // 出力
    basic, critMul, critLabel,
    affinityMul: aff.mul, affinityLabel: aff.label,
    breakMul,
    finalRaw, finalFloored,
  };
}
