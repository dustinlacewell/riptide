/**
 * What a selection would free, split by risk, and how the Zap button
 * should look for it.
 *
 * Sizes are BigInt strings: many large folders sum past the safe integer
 * range, so a sum never passes through Number.
 */

import { riskOf } from "./risk.js";

/**
 * @param {Array<{bytes: string, risk?: string}>} selected the rows going
 *        into the plan, refused rows already left out
 * @param {Array<{bytes: string}>} found every row the scan found
 * @returns {{safe: string, caution: string, selected: string, total: string,
 *            count: number, anyCaution: boolean}}
 */
export function reclaimOf(selected, found) {
  let safe = 0n;
  let caution = 0n;
  let anyCaution = false;

  for (const item of selected) {
    if (riskOf(item) === "caution") {
      caution += BigInt(item.bytes);
      anyCaution = true;
    } else {
      safe += BigInt(item.bytes);
    }
  }

  const total = found.reduce((sum, item) => sum + BigInt(item.bytes), 0n);
  return {
    safe: safe.toString(),
    caution: caution.toString(),
    selected: (safe + caution).toString(),
    total: total.toString(),
    count: selected.length,
    anyCaution,
  };
}

/**
 * The Zap button's tone: red only for a permanent delete, amber when any
 * selected row carries a caution, cyan otherwise.
 *
 * @returns {"current"|"caution"|"danger"}
 */
export function zapTone({ anyCaution, permanent }) {
  if (permanent) return "danger";
  if (anyCaution) return "caution";
  return "current";
}

/** part / whole as a 0..1 fraction, for a meter. */
export function shareOf(part, whole) {
  const w = BigInt(whole);
  if (w === 0n) return 0;
  return Number((BigInt(part) * 10_000n) / w) / 10_000;
}
