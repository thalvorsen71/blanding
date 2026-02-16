import { scoreColor, scoreLabel, scoreVerdict } from './constants';

/**
 * Generate a branded 1200x630 scorecard PNG for social sharing.
 * Uses HTML Canvas — no external dependencies.
 */
export async function generateScorecard(result) {
  const W = 1200, H = 630;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // ─── Background ───
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0a0a0a');
  bg.addColorStop(1, '#141414');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Subtle radial glow
  const glow = ctx.createRadialGradient(W * 0.35, H * 0.5, 0, W * 0.35, H * 0.5, 300);
  glow.addColorStop(0, scoreColor(result.overall) + '15');
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // ─── Score Ring ───
  const cx = 260, cy = 280, ringR = 110, sw = 8;
  // Track
  ctx.beginPath();
  ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = sw;
  ctx.stroke();
  // Progress
  const angle = (result.overall / 100) * Math.PI * 2;
  ctx.beginPath();
  ctx.arc(cx, cy, ringR, -Math.PI / 2, -Math.PI / 2 + angle);
  ctx.strokeStyle = scoreColor(result.overall);
  ctx.lineWidth = sw;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Score number
  ctx.fillStyle = scoreColor(result.overall);
  ctx.font = 'bold 72px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(result.overall), cx, cy + 10);
  ctx.fillStyle = '#555';
  ctx.font = '18px monospace';
  ctx.fillText('/100', cx, cy + 38);

  // ─── Right side content ───
  const textX = 480;

  // "BLANDING DETECTOR" header
  ctx.fillStyle = '#c87840';
  ctx.font = '11px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('THE BLANDING DETECTOR', textX, 80);

  // School name
  ctx.fillStyle = '#e8e4df';
  ctx.font = '36px Georgia, serif';
  const name = result.schoolName.length > 35 ? result.schoolName.substring(0, 35) + '...' : result.schoolName;
  ctx.fillText(name, textX, 130);

  // Score label
  ctx.fillStyle = scoreColor(result.overall);
  ctx.font = 'italic 28px Georgia, serif';
  ctx.fillText(scoreLabel(result.overall), textX, 175);

  // Verdict (word-wrapped)
  ctx.fillStyle = '#888';
  ctx.font = '15px sans-serif';
  const verdict = scoreVerdict(result.overall);
  wrapText(ctx, verdict, textX, 215, 650, 22);

  // Sub-scores
  const subY = 320;
  if (result.scores.language != null) {
    drawSubScore(ctx, textX, subY, 'Language & Voice', result.scores.language);
  }
  if (result.scores.strategy != null) {
    drawSubScore(ctx, textX + 240, subY, 'Content Strategy', result.scores.strategy);
  }

  // Cliché count
  ctx.fillStyle = '#555';
  ctx.font = '13px monospace';
  ctx.fillText(`${result.totalCliches} clichés found across ${result.pagesAnalyzed.length} page${result.pagesAnalyzed.length > 1 ? 's' : ''}`, textX, subY + 70);

  // ─── Percentile badge ───
  if (result.percentile) {
    ctx.fillStyle = scoreColor(result.overall) + '20';
    roundRect(ctx, textX, subY + 90, 320, 32, 6);
    ctx.fill();
    ctx.fillStyle = scoreColor(result.overall);
    ctx.font = '12px monospace';
    ctx.fillText(`Better than ${result.percentile.percentile}% of ${result.percentile.totalCount} audited institutions`, textX + 12, subY + 111);
  }

  // ─── Footer ───
  // Accent line
  ctx.fillStyle = '#c87840';
  ctx.fillRect(0, H - 50, W, 2);

  // adeo branding
  const gradBg = ctx.createLinearGradient(28, H - 38, 56, H - 10);
  gradBg.addColorStop(0, '#c87840');
  gradBg.addColorStop(1, '#e8a060');
  ctx.fillStyle = gradBg;
  roundRect(ctx, 28, H - 38, 28, 28, 5);
  ctx.fill();
  ctx.fillStyle = '#0a0a0a';
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('a', 42, H - 19);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#666';
  ctx.font = '12px monospace';
  ctx.fillText('adeo — strategic communications', 68, H - 19);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#c87840';
  ctx.font = '13px monospace';
  ctx.fillText('blandingaudit.netlify.app', W - 30, H - 19);

  // Hashtag
  ctx.fillStyle = '#444';
  ctx.font = '11px monospace';
  ctx.fillText('#BlandingDetector  #HigherEd', W - 30, 30);

  return canvas;
}

function drawSubScore(ctx, x, y, label, score) {
  ctx.fillStyle = scoreColor(score);
  ctx.font = 'bold 32px Georgia, serif';
  ctx.textAlign = 'left';
  ctx.fillText(String(score), x, y);

  ctx.fillStyle = '#555';
  ctx.font = '10px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(label.toUpperCase(), x, y + 18);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let lineY = y;
  for (const word of words) {
    const test = line + word + ' ';
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line.trim(), x, lineY);
      line = word + ' ';
      lineY += lineHeight;
    } else {
      line = test;
    }
  }
  if (line.trim()) ctx.fillText(line.trim(), x, lineY);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
