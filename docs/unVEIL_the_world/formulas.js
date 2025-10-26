// 計算式レイヤ：ここだけ差し替えればゲーム固有式に対応できる
export function computeDamage(params) {
  const {
    atk, skill, def, kConst,
    addBuffPct, mulBuff, elemMul,
    resistPct, critRatePct, critDmgPct,
    varMin, varMax
  } = params;

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const critRate = clamp01(critRatePct / 100);
  const critDmg  = Math.max(0, critDmgPct / 100); // +100% → 1.0
  const addBuff  = 1 + (addBuffPct / 100);
  const resist   = 1 - (resistPct / 100);
  const base     = atk * skill;

  // 防御軽減（汎用形）
  const defCut = base * (1 - (def / (def + Math.max(1, kConst))));

  // 期待クリ倍率
  const expectedCritMul = 1 + critRate * critDmg;

  const core = defCut * addBuff * mulBuff * elemMul * resist;

  const expected = core * expectedCritMul;
  const noCrit   = core;                 // クリ無し
  const onCrit   = core * (1 + critDmg); // クリ時

  const min = expected * varMin;
  const max = expected * varMax;

  // 返却（整数丸めはUI側で）
  return { expected, min, max, noCrit, onCrit };
}
