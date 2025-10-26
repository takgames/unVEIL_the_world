// 検証式に準拠（指数防御 e^(-DEF/1092)）
// 単位ルール：◯◯(%) は 50 → +50%、倍率× は 1.20 → 1.2

const AFFINITY_MAP = {
  none: { mul: 1.00, label: "なし ×1.00" },
  adv:  { mul: 1.25, label: "有利 ×1.25" },
  dis:  { mul: 0.85, label: "不利 ×0.85" }
};

export function computeAll(p) {
  // --- ステータス（ATK合算 + 攻撃力アップ） ---
  const atkBase  = Math.max(0, +p.atk || 0);
  const familiar = Math.max(0, +p.familiarAtk || 0);
  const atkUp    = 1 + ((+p.atkUpPct || 0) / 100); // 追加：攻撃力アップ
  const atkEff   = (atkBase + familiar) * atkUp;

  // --- スキル・バフ ---
  const skillPct = Math.max(0, +p.skillPct || 0) / 100;
  const skillFlat = +p.skillFlat || 0;

  const cardUp   = 1 + ((+p.cardUpPct   || 0) / 100);
  const globalUp = 1 + ((+p.globalUpPct || 0) / 100);
  const elemUp   = 1 + ((+p.elemUpPct   || 0) / 100);

  // --- 敵パラメータ ---
  const def = Math.max(0, +p.def || 0);
  const defenseFactor = Math.exp(-def / 1092);

  // --- 基本ダメージ ---
  const baseTerm = atkEff * skillPct + skillFlat;
  const basic = baseTerm * cardUp * globalUp * elemUp * defenseFactor;

  // --- 会心 ---
  const critDmg = Math.max(0, +p.critDmgPct || 0) / 100;
  const rate    = Math.max(0, Math.min(100, +p.critRatePct || 0)) / 100;
  const critMulOn       = 1 + critDmg;
  const critMulExpected = 1 + rate * critDmg;

  // --- 属性相性 & ブレイク ---
  const aff = ( { none:{mul:1.00,label:"なし ×1.00"}, adv:{mul:1.25,label:"有利 ×1.25"}, dis:{mul:0.85,label:"不利 ×0.85"} } )[p.affinity || 'none'];
  const breakMul = p.applyBreak ? 1.30 : 1.00;

  // --- 最終（通常 / 会心 / 期待値） ---
  const finalRawNoCrit   = basic * 1 * aff.mul * breakMul;
  const finalRawCritOn   = basic * critMulOn * aff.mul * breakMul;
  const finalRawExpected = basic * critMulExpected * aff.mul * breakMul;

  const finalNoCrit   = Math.floor(finalRawNoCrit);
  const finalCritOn   = Math.floor(finalRawCritOn);
  const finalExpected = Math.floor(finalRawExpected);

  return {
    // 途中値
    atkBase, familiar, atkUp, atkEff,
    baseTerm, cardUp, globalUp, elemUp, defenseFactor,
    basic, critMulOn, critMulExpected,
    affinityLabel: aff.label, breakMul,
    finalRawNoCrit, finalRawCritOn, finalRawExpected,
    finalNoCrit, finalCritOn, finalExpected
  };
}
