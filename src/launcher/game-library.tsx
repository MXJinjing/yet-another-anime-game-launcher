import { For, onCleanup, onMount } from "solid-js";
import "./game-library.css";
import { hexToRgb } from "../utils/theme-color";

type AuroraColorVars = {
  "--hoyoplay-aurora-right": string;
  "--hoyoplay-aurora-left": string;
  "--hoyoplay-aurora-center": string;
  "--hoyoplay-aurora-left-soft": string;
};

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRgb(hex);
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rf) h = (gf - bf) / d + (gf < bf ? 6 : 0);
  else if (max === gf) h = (bf - rf) / d + 2;
  else h = (rf - gf) / d + 4;
  return { h: h * 60, s: s * 100, l: l * 100 };
}

function hslToRgb(
  h: number,
  s: number,
  l: number
): { r: number; g: number; b: number } {
  const hn = (((h % 360) + 360) % 360) / 360;
  const sn = Math.min(100, Math.max(0, s)) / 100;
  const ln = Math.min(100, Math.max(0, l)) / 100;
  if (sn === 0) {
    const v = Math.round(ln * 255);
    return { r: v, g: v, b: v };
  }
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  const hue2rgb = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: Math.round(hue2rgb(hn + 1 / 3) * 255),
    g: Math.round(hue2rgb(hn) * 255),
    b: Math.round(hue2rgb(hn - 1 / 3) * 255),
  };
}

function shiftColor(
  hex: string,
  dh: number,
  ds: number,
  dl: number,
  alpha: number
): string {
  const { h, s, l } = hexToHsl(hex);
  const { r, g, b } = hslToRgb(h + dh, s * ds, l + dl);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// bottom-right: warmer hue, brighter, more opaque; bottom-left: cooler hue,
// darker, more transparent. Passed as plain rgba CSS vars so no modern
// color-syntax support is required in the webview.
function auroraColors(themeColor: string): AuroraColorVars {
  return {
    "--hoyoplay-aurora-right": shiftColor(themeColor, 14, 1.05, 8, 0.5),
    "--hoyoplay-aurora-left": shiftColor(themeColor, -14, 0.92, -6, 0.36),
    "--hoyoplay-aurora-center": shiftColor(themeColor, 5, 1, 4, 0.32),
    "--hoyoplay-aurora-left-soft": shiftColor(themeColor, -8, 0.94, -3, 0.26),
  };
}

export type GameLibraryItem = {
  id: string;
  title: string;
  iconUrl: string;
  bannerUrl: string;
  serverLabel: string;
  installed: boolean;
};

type LibraryParticle = {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  alpha: number;
  twinkle: number;
  phase: number;
  color: string;
};

// Animated glowing dust/starfield drawn on a canvas, layered over the aurora.
function LibraryBackground(props: { themeColor?: string }) {
  let canvasRef: HTMLCanvasElement | undefined;

  onMount(() => {
    const canvas = canvasRef;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    let raf = 0;
    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // White sparkles plus a monochrome ramp of the theme color so the
    // particle field stays in sync with the theme-based aurora behind it.
    const { r, g, b } = hexToRgb(props.themeColor ?? "#ffd834");
    const tint = (lighten: number) => {
      const mix = (c: number) => Math.round(c + (255 - c) * lighten);
      return `${mix(r)}, ${mix(g)}, ${mix(b)}`;
    };
    const colors = [
      "255, 255, 255",
      tint(0.7),
      tint(0.5),
      tint(0.3),
      tint(0.15),
    ];

    const spawn = (initial: boolean): LibraryParticle => ({
      x: Math.random() * width,
      y: initial ? Math.random() * height : height + 10,
      r: 0.6 + Math.random() * 2.4,
      vx: (Math.random() - 0.5) * 0.16,
      vy: -0.04 - Math.random() * 0.22,
      alpha: 0.12 + Math.random() * 0.5,
      twinkle: 0.004 + Math.random() * 0.01,
      phase: Math.random() * Math.PI * 2,
      color: colors[Math.floor(Math.random() * colors.length)],
    });

    const count = Math.min(
      110,
      Math.max(40, Math.round((width * height) / 16000))
    );
    const particles: LibraryParticle[] = Array.from({ length: count }, () =>
      spawn(true)
    );

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.phase += p.twinkle;
        if (p.y < -12) Object.assign(p, spawn(false));
        if (p.x < -12) p.x = width + 12;
        if (p.x > width + 12) p.x = -12;
        const a = Math.max(0, p.alpha * (0.5 + 0.5 * Math.sin(p.phase)));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color}, ${a.toFixed(3)})`;
        ctx.fill();
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        glow.addColorStop(0, `rgba(${p.color}, ${(a * 0.22).toFixed(3)})`);
        glow.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    onCleanup(() => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    });

    if (reduceMotion) {
      draw();
      return;
    }
    const tick = () => {
      draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });

  return (
    <canvas ref={canvasRef} class="hoyoplay-library-bg" aria-hidden="true" />
  );
}

export function GameLibraryView(props: {
  games: GameLibraryItem[];
  onSelect: (index: number) => void;
  title?: string;
  themeColor?: string;
}) {
  return (
    <div
      class="hoyoplay-game-library"
      style={{
        "--hoyoplay-accent": props.themeColor ?? "#ffd834",
        ...auroraColors(props.themeColor ?? "#ffd834"),
      }}
    >
      <div class="hoyoplay-library-aurora" aria-hidden="true" />
      <div class="hoyoplay-library-aurora-b" aria-hidden="true" />
      <LibraryBackground themeColor={props.themeColor} />
      <div class="hoyoplay-library-scroll">
        <h2 class="hoyoplay-library-title">{props.title ?? "游戏库"}</h2>
        <div class="hoyoplay-library-grid">
          <For each={props.games}>
            {(game, index) => (
              <button
                class="hoyoplay-library-card"
                style={{
                  "background-image": `url("${game.bannerUrl}")`,
                  "background-size": "cover",
                  "background-position": "center",
                }}
                onClick={() => props.onSelect(index())}
              >
                <span class="hoyoplay-library-card-icon">
                  <img src={game.iconUrl} alt="" />
                </span>
                <span
                  class={
                    "hoyoplay-library-status" +
                    (game.installed ? "" : " is-missing")
                  }
                />
                <span class="hoyoplay-library-card-info">
                  <strong>{game.title}</strong>
                  <small>{game.serverLabel}</small>
                </span>
              </button>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
