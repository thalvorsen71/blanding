import { CLICHES, scoreColor } from './constants';

/**
 * Generate a branded Cliché Bingo Card as a canvas image.
 * 5x5 grid showing which higher ed clichés were detected.
 */
export async function generateBingoCard(result) {
  const W = 800, H = 900;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // ─── Background ───
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, W, H);

  // ─── Header ───
  ctx.fillStyle = '#c87840';
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('BLANDING', W / 2, 35);

  ctx.fillStyle = '#e8e4df';
  ctx.font = 'italic 32px Georgia, serif';
  ctx.fillText('Cliché Bingo', W / 2, 75);

  // School name + score
  ctx.fillStyle = '#888';
  ctx.font = '14px sans-serif';
  const name = result.schoolName.length > 40 ? result.schoolName.substring(0, 40) + '...' : result.schoolName;
  ctx.fillText(`${name} — ${result.overall}/100`, W / 2, 105);

  // ─── Bingo Grid ───
  const gridSize = 5;
  const cellW = 140, cellH = 100;
  const gridW = gridSize * cellW;
  const startX = (W - gridW) / 2;
  const startY = 130;

  // Pick 25 clichés: detected ones + fill from full list
  const detected = new Set(result.cliches.map(c => c.phrase.toLowerCase()));
  const allPhrases = CLICHES.map(c => c.toLowerCase());

  // Start with detected clichés, then fill remaining slots
  const detectedArr = result.cliches.slice(0, 24).map(c => c.phrase);
  const remaining = allPhrases.filter(p => !detected.has(p));
  const gridPhrases = [...detectedArr];
  let ri = 0;
  while (gridPhrases.length < 24 && ri < remaining.length) {
    gridPhrases.push(remaining[ri++]);
  }

  // Insert "FREE" in center (index 12)
  gridPhrases.splice(12, 0, 'FREE SPACE');

  let detectedCount = 0;

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const idx = row * gridSize + col;
      const x = startX + col * cellW;
      const y = startY + row * cellH;
      const phrase = gridPhrases[idx] || '';
      const isFree = phrase === 'FREE SPACE';
      const isDetected = isFree || detected.has(phrase.toLowerCase());

      if (isDetected) detectedCount++;

      // Cell background
      ctx.fillStyle = isDetected ? '#c8784018' : '#111';
      ctx.fillRect(x + 1, y + 1, cellW - 2, cellH - 2);

      // Cell border
      ctx.strokeStyle = isDetected ? '#c8784040' : '#1a1a1a';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, cellW, cellH);

      // Checkmark for detected
      if (isDetected && !isFree) {
        ctx.fillStyle = '#c8784060';
        ctx.font = 'bold 28px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('✓', x + cellW - 8, y + 28);
      }

      // FREE space styling
      if (isFree) {
        ctx.fillStyle = '#c87840';
        ctx.font = 'bold 16px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('FREE', x + cellW / 2, y + cellH / 2 - 4);
        ctx.fillStyle = '#c8784080';
        ctx.font = '10px monospace';
        ctx.fillText('(everyone gets this)', x + cellW / 2, y + cellH / 2 + 14);
        continue;
      }

      // Phrase text (wrap if needed)
      ctx.fillStyle = isDetected ? '#e8e4df' : '#444';
      ctx.font = `${isDetected ? '600' : '400'} 11px sans-serif`;
      ctx.textAlign = 'center';
      wrapText(ctx, phrase, x + cellW / 2, y + cellH / 2 - 8, cellW - 16, 14);
    }
  }

  // ─── Footer stats ───
  const footerY = startY + gridSize * cellH + 30;

  ctx.fillStyle = scoreColor(result.overall);
  ctx.font = 'bold 20px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${detectedCount}/25 squares hit`, W / 2, footerY);

  ctx.fillStyle = '#666';
  ctx.font = '13px sans-serif';
  ctx.fillText(
    detectedCount >= 20 ? 'BINGO! Your homepage is a cliché factory.' :
    detectedCount >= 15 ? 'Almost bingo. The sameness is strong.' :
    detectedCount >= 10 ? 'Getting there. Still plenty of borrowed language.' :
    'Not bad! Some original thinking happening here.',
    W / 2, footerY + 28
  );

  // Branding
  ctx.fillStyle = '#333';
  ctx.font = '10px monospace';
  ctx.fillText('blandingaudit.netlify.app', W / 2, H - 20);
  ctx.fillStyle = '#c87840';
  ctx.fillText('#Blanding', W / 2, H - 40);

  return canvas;
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(/[\s-]+/);
  let line = '';
  let lineY = y;
  for (const word of words) {
    const test = line + (line ? ' ' : '') + word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, lineY);
      line = word;
      lineY += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, lineY);
}
