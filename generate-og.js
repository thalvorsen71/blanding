/**
 * Generate OG social card image (1200x630) for The Blanding Detector
 * Run: node generate-og.js
 */
const { createCanvas, Path2D, GlobalFonts } = require("@napi-rs/canvas");
const fs = require("fs");
const path = require("path");

// ─── Register app fonts ───
const fontDir = path.join(__dirname, "node_modules/@fontsource");
GlobalFonts.register(fs.readFileSync(`${fontDir}/dm-sans/files/dm-sans-latin-400-normal.woff2`), "DM Sans");
GlobalFonts.register(fs.readFileSync(`${fontDir}/dm-sans/files/dm-sans-latin-500-normal.woff2`), "DM Sans Medium");
GlobalFonts.register(fs.readFileSync(`${fontDir}/dm-sans/files/dm-sans-latin-300-normal.woff2`), "DM Sans Light");
GlobalFonts.register(fs.readFileSync(`${fontDir}/dm-mono/files/dm-mono-latin-400-normal.woff2`), "DM Mono");
GlobalFonts.register(fs.readFileSync(`${fontDir}/instrument-serif/files/instrument-serif-latin-400-normal.woff2`), "Instrument Serif");
GlobalFonts.register(fs.readFileSync(`${fontDir}/instrument-serif/files/instrument-serif-latin-400-italic.woff2`), "Instrument Serif Italic");

const W = 1200;
const H = 630;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");

// Colors
const BG = "#0a0a0a";
const ACCENT = "#c87840";
const TEXT = "#e8e4df";
const MUTED = "#888";
const DIM = "#555";
const LAVENDER = "#E6BDED";

// adeo logo SVG paths
const LOGO_PATHS = {
  a: "M39.3733 120C18.1612 120 0.585449 101.515 0.585449 79.5454C0.585449 57.4242 18.3127 38.9394 39.3733 38.9394C47.4036 38.9394 54.0703 41.6667 58.9188 46.9697V40.6061H81.343V118.182H58.9188V111.97C54.0703 117.273 47.5551 120 39.3733 120ZM23.6158 79.3939C23.6158 89.697 31.9491 98.1818 42.1006 98.1818C48.9188 98.1818 54.9794 94.3939 58.3127 88.6364V70.1515C54.9794 64.3939 48.9188 60.6061 42.1006 60.6061C31.9491 60.6061 23.6158 69.0909 23.6158 79.3939Z",
  d: "M130.152 120C108.94 120 91.3642 101.515 91.3642 79.5454C91.3642 57.4242 109.091 38.9394 130.152 38.9394C138.182 38.9394 144.849 41.6667 149.697 46.9697V0H172.121V118.182H149.697V111.97C144.849 117.273 138.334 120 130.152 120ZM114.394 79.3939C114.394 89.697 122.728 98.1818 132.879 98.1818C139.697 98.1818 145.758 94.3939 149.091 88.6364V70.1515C145.758 64.3939 139.697 60.6061 132.879 60.6061C122.728 60.6061 114.394 69.0909 114.394 79.3939Z",
  e: "M224.719 119.848C200.628 119.848 181.536 101.515 181.536 79.5454C181.536 57.4242 200.476 38.7879 222.597 38.7879C246.537 38.7879 264.113 57.4242 263.052 81.3636H204.264C206.233 91.5151 214.87 98.0303 224.719 98.0303C232.597 98.0303 239.264 94.5454 243.506 88.9394L260.476 100.303C253.506 111.061 240.628 119.848 224.719 119.848ZM222.597 59.8485C213.506 59.8485 206.233 65.9091 204.416 74.5454H241.082C239.264 65.9091 231.84 59.8485 222.597 59.8485Z",
  o: "M314.244 120C291.517 120 273.032 101.515 273.032 79.3939C273.032 57.2727 291.517 38.7879 314.244 38.7879C336.971 38.7879 355.456 57.2727 355.456 79.3939C355.456 101.515 336.971 120 314.244 120ZM296.062 79.3939C296.062 89.697 304.395 98.1818 314.244 98.1818C324.092 98.1818 332.426 89.697 332.426 79.3939C332.426 69.0909 324.092 60.6061 314.244 60.6061C304.395 60.6061 296.062 69.0909 296.062 79.3939Z",
  dot: "M380.231 120C372.504 120 365.989 113.636 365.989 105.758C365.989 97.8788 372.504 91.5151 380.231 91.5151C387.958 91.5151 394.473 97.8788 394.473 105.758C394.473 113.636 387.958 120 380.231 120Z",
};
const LOGO_VBW = 395;
const LOGO_VBH = 120;

function drawLogo(x, y, height, color, dotColor) {
  const scale = height / LOGO_VBH;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  for (const key of ["a", "d", "e", "o"]) {
    ctx.fillStyle = color;
    ctx.fill(new Path2D(LOGO_PATHS[key]));
  }
  ctx.fillStyle = dotColor;
  ctx.fill(new Path2D(LOGO_PATHS.dot));
  ctx.restore();
  return (height / LOGO_VBH) * LOGO_VBW;
}

// ═══════════════════════════════════════════
// BACKGROUND
// ═══════════════════════════════════════════
ctx.fillStyle = BG;
ctx.fillRect(0, 0, W, H);

// Warm gradient wash — left side only, very subtle
const warmGrad = ctx.createRadialGradient(0, H * 0.4, 0, 0, H * 0.4, W * 0.7);
warmGrad.addColorStop(0, "rgba(200, 120, 64, 0.07)");
warmGrad.addColorStop(1, "rgba(200, 120, 64, 0)");
ctx.fillStyle = warmGrad;
ctx.fillRect(0, 0, W, H);

// Accent line at top
const lineGrad = ctx.createLinearGradient(0, 0, W, 0);
lineGrad.addColorStop(0, ACCENT);
lineGrad.addColorStop(0.6, ACCENT);
lineGrad.addColorStop(1, "transparent");
ctx.fillStyle = lineGrad;
ctx.fillRect(0, 0, W, 3);

// ═══════════════════════════════════════════
// LEFT COLUMN — text content
// ═══════════════════════════════════════════
const LX = 72; // left margin

// adeo logo
drawLogo(LX, 50, 26, TEXT, LAVENDER);

// Main title
ctx.textAlign = "left";
ctx.fillStyle = TEXT;
ctx.font = 'italic 68px "Instrument Serif Italic"';
ctx.fillText("The Blanding", LX, 190);
ctx.fillText("Detector", LX, 268);

// Subtitle
ctx.font = '400 20px "DM Sans"';
ctx.fillStyle = DIM;
ctx.fillText("Higher Ed Edition", LX + 4, 306);

// Hook text — the compelling question
ctx.font = 'italic 28px "Instrument Serif Italic"';
ctx.fillStyle = "#b0aca6";
ctx.fillText("Is your university website actually", LX, 382);
ctx.fillText("saying anything?", LX, 418);

// Feature pills row
const pills = ["Cliché Scanner", "Voice Analysis", "Live Leaderboard"];
let pillX = LX;
const pillY = 462;
ctx.font = '400 12px "DM Mono"';
pills.forEach((label) => {
  const tw = ctx.measureText(label).width;
  const pw = tw + 24;
  ctx.fillStyle = "#141414";
  ctx.beginPath();
  ctx.roundRect(pillX, pillY, pw, 28, 14);
  ctx.fill();
  ctx.strokeStyle = "#252525";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(pillX, pillY, pw, 28, 14);
  ctx.stroke();
  ctx.fillStyle = MUTED;
  ctx.textAlign = "center";
  ctx.fillText(label, pillX + pw / 2, pillY + 18);
  ctx.textAlign = "left";
  pillX += pw + 8;
});

// ═══════════════════════════════════════════
// RIGHT COLUMN — score ring (centered, no overlap)
// ═══════════════════════════════════════════
const ringX = W - 230;
const ringY = 240;
const ringR = 100;
const ringStroke = 7;

// Subtle glow behind the ring
const glowGrad = ctx.createRadialGradient(ringX, ringY, ringR * 0.3, ringX, ringY, ringR * 1.8);
glowGrad.addColorStop(0, "rgba(200, 120, 64, 0.06)");
glowGrad.addColorStop(1, "rgba(200, 120, 64, 0)");
ctx.fillStyle = glowGrad;
ctx.fillRect(ringX - ringR * 2, ringY - ringR * 2, ringR * 4, ringR * 4);

// Ring background track
ctx.beginPath();
ctx.arc(ringX, ringY, ringR, 0, Math.PI * 2);
ctx.strokeStyle = "#1a1a1a";
ctx.lineWidth = ringStroke;
ctx.stroke();

// Ring progress arc (42/100 — bad enough to be provocative)
const score = 42;
const startAngle = -Math.PI / 2;
const endAngle = startAngle + (Math.PI * 2 * score) / 100;

// Gradient on the arc
ctx.beginPath();
ctx.arc(ringX, ringY, ringR, startAngle, endAngle);
ctx.strokeStyle = ACCENT;
ctx.lineWidth = ringStroke;
ctx.lineCap = "round";
ctx.stroke();
ctx.lineCap = "butt";

// Score number
ctx.fillStyle = TEXT;
ctx.font = 'italic 60px "Instrument Serif Italic"';
ctx.textAlign = "center";
ctx.fillText(String(score), ringX, ringY + 18);

// "/ 100"
ctx.font = '400 13px "DM Sans"';
ctx.fillStyle = DIM;
ctx.fillText("/ 100", ringX, ringY + 42);

// Score label — italic, warm
ctx.font = 'italic 18px "Instrument Serif Italic"';
ctx.fillStyle = ACCENT;
ctx.fillText("Suspiciously Vanilla", ringX, ringY + ringR + 36);

// ═══════════════════════════════════════════
// BOTTOM BAR
// ═══════════════════════════════════════════

// Divider line
const barY = H - 60;
ctx.fillStyle = "#161616";
ctx.fillRect(0, barY, W, 1);

// helloadeo.com — left
ctx.font = '400 13px "DM Mono"';
ctx.fillStyle = LAVENDER;
ctx.textAlign = "left";
ctx.fillText("helloadeo.com", LX, barY + 32);

// "Brand audit by adeo" — right, with small logo
ctx.font = '400 13px "DM Sans"';
ctx.fillStyle = DIM;
ctx.textAlign = "right";
ctx.fillText("AI-powered brand audit", W - 72, barY + 32);

// Save
const buf = canvas.toBuffer("image/png");
fs.writeFileSync("public/og-image.png", buf);
console.log("✓ og-image.png generated (" + buf.length + " bytes)");
