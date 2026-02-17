/**
 * adeo brand logo — SVG paths extracted from official logo file.
 * White text with lavender (#E6BDED) dot on the "o".
 *
 * Usage:
 *   - React: <AdeoLogo /> component for the header
 *   - Canvas: drawAdeoLogo(ctx, x, y, height) for scorecard PNG
 *   - HTML/PDF: adeoLogoSVG(color, dotColor) for inline SVG string
 */

// Original viewBox: 0 0 395 120
// Paths: a, d, e, o (body=white), o-dot (lavender)

const PATHS = {
  a: "M39.3733 120C18.1612 120 0.585449 101.515 0.585449 79.5454C0.585449 57.4242 18.3127 38.9394 39.3733 38.9394C47.4036 38.9394 54.0703 41.6667 58.9188 46.9697V40.6061H81.343V118.182H58.9188V111.97C54.0703 117.273 47.5551 120 39.3733 120ZM23.6158 79.3939C23.6158 89.697 31.9491 98.1818 42.1006 98.1818C48.9188 98.1818 54.9794 94.3939 58.3127 88.6364V70.1515C54.9794 64.3939 48.9188 60.6061 42.1006 60.6061C31.9491 60.6061 23.6158 69.0909 23.6158 79.3939Z",
  d: "M130.152 120C108.94 120 91.3643 101.515 91.3643 79.5454C91.3643 57.4242 109.092 38.9394 130.152 38.9394C137.879 38.9394 144.243 41.5151 149.092 46.3636V0H172.122V118.182H149.698V111.97C144.849 117.273 138.334 120 130.152 120ZM114.395 79.3939C114.395 89.697 122.728 98.1818 132.879 98.1818C139.698 98.1818 145.758 94.3939 149.092 88.6364V70.1515C145.758 64.3939 139.698 60.6061 132.879 60.6061C122.728 60.6061 114.395 69.0909 114.395 79.3939Z",
  e: "M224.719 119.848C200.628 119.848 182.295 102.273 182.295 79.3939C182.295 56.9697 200.173 38.9394 222.749 38.9394C245.476 38.9394 262.749 57.2727 262.749 79.697C262.749 82.4242 262.295 85.1515 261.689 87.7273H205.476C208.052 95.4545 214.719 100.152 223.961 100.152C231.689 100.152 237.749 96.9697 241.386 91.3636L257.295 105C249.87 114.394 238.355 119.848 224.719 119.848ZM205.628 70.7576H239.87C237.295 63.3333 231.234 58.7879 222.749 58.7879C214.416 58.7879 208.204 63.3333 205.628 70.7576Z",
  o: "M314.244 120C291.517 120 272.881 101.818 272.881 79.3939C272.881 56.9697 291.517 38.9394 314.244 38.9394C336.972 38.9394 355.608 57.1212 355.608 79.3939C355.608 101.667 337.123 120 314.244 120ZM295.911 79.3939C295.911 89.697 304.093 98.1818 314.244 98.1818C324.244 98.1818 332.578 89.697 332.578 79.3939C332.578 69.0909 324.244 60.6061 314.244 60.6061C304.244 60.6061 295.911 69.0909 295.911 79.3939Z",
  dot: "M380.231 120C372.504 120 366.141 113.636 366.141 105.909C366.141 98.3333 372.504 91.9697 380.231 91.9697C387.807 91.9697 394.171 98.3333 394.171 105.909C394.171 113.636 387.807 120 380.231 120Z",
};

const VB_W = 395;
const VB_H = 120;

// ─── React component for header ───
export function AdeoLogo({ height = 24, color = "#fff", dotColor = "#E6BDED", className = "", style = {} }) {
  const w = (height / VB_H) * VB_W;
  return (
    <svg width={w} height={height} viewBox={`0 0 ${VB_W} ${VB_H}`} fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="adeo" className={className} style={style}>
      <path d={PATHS.a} fill={color} />
      <path d={PATHS.d} fill={color} />
      <path d={PATHS.e} fill={color} />
      <path d={PATHS.o} fill={color} />
      <path d={PATHS.dot} fill={dotColor} />
    </svg>
  );
}

// ─── Canvas drawing for scorecard PNG ───
export function drawAdeoLogo(ctx, x, y, height, color = "#fff", dotColor = "#E6BDED") {
  const scale = height / VB_H;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  const bodyPaths = [PATHS.a, PATHS.d, PATHS.e, PATHS.o];
  for (const d of bodyPaths) {
    const p = new Path2D(d);
    ctx.fillStyle = color;
    ctx.fill(p);
  }

  const dotPath = new Path2D(PATHS.dot);
  ctx.fillStyle = dotColor;
  ctx.fill(dotPath);

  ctx.restore();
  return (height / VB_H) * VB_W; // returns rendered width
}

// ─── Inline SVG string for HTML/PDF ───
export function adeoLogoSVG(height = 20, color = "#1a1a1a", dotColor = "#E6BDED") {
  const w = (height / VB_H) * VB_W;
  return `<svg width="${w}" height="${height}" viewBox="0 0 ${VB_W} ${VB_H}" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="adeo">
    <path d="${PATHS.a}" fill="${color}"/>
    <path d="${PATHS.d}" fill="${color}"/>
    <path d="${PATHS.e}" fill="${color}"/>
    <path d="${PATHS.o}" fill="${color}"/>
    <path d="${PATHS.dot}" fill="${dotColor}"/>
  </svg>`;
}
