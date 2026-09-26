#!/usr/bin/env node
/**
 * Generic categorical-palette validator for report charts — colorblind-safe separation
 * between adjacent colors, plus a contrast floor against the report background. No
 * brand-specific values: pass your own hex list as the first argument.
 *
 * Usage: node validate_palette.js "#1d9e75,#d85a30,#378add,#ba7517" [--mode light|dark]
 *
 * Exit code 0 = all checks pass, 1 = at least one check failed.
 */

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance({ r, g, b }) {
  const [R, G, B] = [r, g, b].map(srgbToLinear);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(rgb1, rgb2) {
  const L1 = relativeLuminance(rgb1);
  const L2 = relativeLuminance(rgb2);
  const [lighter, darker] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (lighter + 0.05) / (darker + 0.05);
}

// Simplified linear approximation of protanopia/deuteranopia simulation — good enough as
// a relative "these two colors look too similar to someone with this deficiency" check,
// not a clinical-grade simulation.
const CVD_MATRICES = {
  protanopia: [
    [0.567, 0.433, 0],
    [0.558, 0.442, 0],
    [0, 0.242, 0.758],
  ],
  deuteranopia: [
    [0.625, 0.375, 0],
    [0.7, 0.3, 0],
    [0, 0.3, 0.7],
  ],
};

function simulateCvd(rgb, type) {
  const { r, g, b } = rgb;
  const m = CVD_MATRICES[type];
  return {
    r: Math.round(m[0][0] * r + m[0][1] * g + m[0][2] * b),
    g: Math.round(m[1][0] * r + m[1][1] * g + m[1][2] * b),
    b: Math.round(m[2][0] * r + m[2][1] * g + m[2][2] * b),
  };
}

function colorDistance(rgb1, rgb2) {
  return Math.sqrt((rgb1.r - rgb2.r) ** 2 + (rgb1.g - rgb2.g) ** 2 + (rgb1.b - rgb2.b) ** 2);
}

function validatePalette(hexList, mode) {
  const rgbList = hexList.map(hexToRgb);
  const background = mode === "dark" ? { r: 23, g: 23, b: 23 } : { r: 255, g: 255, b: 255 };
  const checks = [];
  let pass = true;

  // 1. Contrast floor against the report background — marks shouldn't visually vanish.
  rgbList.forEach((rgb, i) => {
    const ratio = contrastRatio(rgb, background);
    const ok = ratio >= 1.6;
    checks.push({ type: "contrast-vs-background", color: hexList[i], ratio: Number(ratio.toFixed(2)), pass: ok });
    if (!ok) pass = false;
  });

  // 2. Adjacent-pair colorblind separation (protanopia + deuteranopia).
  for (let i = 0; i < rgbList.length; i++) {
    for (let j = i + 1; j < rgbList.length; j++) {
      for (const type of ["protanopia", "deuteranopia"]) {
        const a = simulateCvd(rgbList[i], type);
        const b = simulateCvd(rgbList[j], type);
        const distance = colorDistance(a, b);
        const ok = distance >= 40; // empirical floor for "visually distinguishable"
        checks.push({ type: `cvd-separation-${type}`, pair: `${hexList[i]} vs ${hexList[j]}`, distance: Number(distance.toFixed(1)), pass: ok });
        if (!ok) pass = false;
      }
    }
  }

  return { mode, checks, pass };
}

function main() {
  const args = process.argv.slice(2);
  const paletteArg = args.find((a) => !a.startsWith("--"));
  const modeArg = args.includes("--mode") ? args[args.indexOf("--mode") + 1] : "light";
  if (!paletteArg) {
    console.error('Usage: node validate_palette.js "#hex,#hex,..." [--mode light|dark]');
    process.exit(1);
  }
  const hexList = paletteArg.split(",").map((s) => s.trim());
  const results = validatePalette(hexList, modeArg);
  console.table(results.checks);
  console.log(results.pass ? "PASS — palette looks safe" : "FAIL — see failing rows above");
  process.exit(results.pass ? 0 : 1);
}

main();
