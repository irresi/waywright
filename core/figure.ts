/**
 * core/figure.ts — render an intuition Figure to inline SVG (dual coding, D-004).
 *
 * Structured data -> SVG here, so the model never emits raw markup (can't garble)
 * and every figure carries causal structure. Palette matches render.ts CSS vars.
 * All figures are responsive (viewBox + width:100%) and self-contained.
 */
import type { Figure } from "./types";

const INK = "#e8e6e0", DIM = "#9aa0ae", LINE = "#2a3040", PANEL = "#1c2130";
const ACCENT = "#7dd3fc", GOOD = "#34d399", BAD = "#f87171";

// Semantic component palette, absorbed from the architecture-diagram skill (MIT,
// Cocoon AI). We keep its design system but render deterministically from data
// (D-004) — no AI-authored SVG, so nothing garbles.
const KIND_FILL: Record<string, string> = {
  frontend: "rgba(8,51,68,0.5)", backend: "rgba(6,78,59,0.5)",
  database: "rgba(76,29,149,0.5)", cloud: "rgba(120,53,15,0.45)",
  security: "rgba(136,19,55,0.5)", bus: "rgba(251,146,60,0.4)",
  external: "rgba(30,41,59,0.6)",
};
const KIND_STROKE: Record<string, string> = {
  frontend: "#22d3ee", backend: "#34d399", database: "#a78bfa",
  cloud: "#fbbf24", security: "#fb7185", bus: "#fb923c", external: "#94a3b8",
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Split a label into two balanced lines near `max` chars, breaking on a space. */
function wrapLabel(s: string, max: number): [string, string] {
  const mid = Math.min(s.length - 1, Math.max(1, Math.round(s.length / 2)));
  // find the space nearest the midpoint
  let best = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  }
  if (best < 0) return [s.slice(0, max), s.slice(max)]; // hard split, no space
  return [s.slice(0, best), s.slice(best + 1)];
}

/** Wrap a figure in the shared frame (caption below). */
function frame(svg: string, caption?: string): string {
  const cap = caption ? `<figcaption class="figcap">${esc(caption)}</figcaption>` : "";
  return `<figure class="fig">${svg}${cap}</figure>`;
}

/** flow: nodes left-to-right, directed edges; fault edges dashed + red. */
function flow(f: Extract<Figure, { type: "flow" }>): string {
  const n = f.nodes.length;
  const W = 640, H = 150, boxW = 120, boxH = 46, gap = (W - n * boxW) / (n + 1);
  const x = (i: number) => gap + i * (boxW + gap);
  const cy = H / 2;
  const idx = new Map(f.nodes.map((nd, i) => [nd.id, i] as const));

  const boxes = f.nodes.map((nd, i) => `
    <rect x="${x(i)}" y="${cy - boxH / 2}" width="${boxW}" height="${boxH}" rx="8"
      fill="${PANEL}" stroke="${LINE}"/>
    <text x="${x(i) + boxW / 2}" y="${cy}" fill="${INK}" font-size="13"
      text-anchor="middle" dominant-baseline="central">${esc(nd.label)}</text>`).join("");

  const edges = f.edges.map((e, k) => {
    const a = idx.get(e.from), b = idx.get(e.to);
    if (a == null || b == null) return "";
    const fault = e.kind === "fault";
    const col = fault ? BAD : ACCENT;
    const forward = b > a;
    const x1 = x(a) + (forward ? boxW : 0), x2 = x(b) + (forward ? 0 : boxW);
    // fault edges bow downward to distinguish from the normal path
    const bow = fault ? 46 : 0;
    const my = cy + bow;
    const mx = (x1 + x2) / 2;
    const path = `M ${x1} ${cy} Q ${mx} ${my} ${x2} ${cy}`;
    const dash = fault ? `stroke-dasharray="6 4"` : "";
    const lbl = e.label
      ? `<text x="${mx}" y="${my + (fault ? 16 : -8)}" fill="${col}" font-size="11"
          text-anchor="middle">${esc(e.label)}</text>` : "";
    return `<path d="${path}" fill="none" stroke="${col}" stroke-width="2" ${dash}
        marker-end="url(#ah-${fault ? "f" : "n"})"/>${lbl}`;
  }).join("");

  const svg = `<svg viewBox="0 0 ${W} ${H}" class="figsvg" role="img">
    <defs>
      <marker id="ah-n" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
        <path d="M0 0 L8 4 L0 8 z" fill="${ACCENT}"/></marker>
      <marker id="ah-f" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
        <path d="M0 0 L8 4 L0 8 z" fill="${BAD}"/></marker>
    </defs>${edges}${boxes}</svg>`;
  return frame(svg, f.caption);
}

/** sequence: ordered pills on a timeline; fault step glows red. */
function sequence(f: Extract<Figure, { type: "sequence" }>): string {
  const n = f.steps.length;
  const W = 640, rowH = 44, padY = 12, H = padY * 2 + n * rowH;
  const railX = 26;
  const dots = f.steps.map((s, i) => {
    const y = padY + i * rowH + rowH / 2;
    const col = s.fault ? BAD : ACCENT;
    const label = s.fault ? `⚡ ${s.label}` : s.label;
    return `
      <circle cx="${railX}" cy="${y}" r="6" fill="${col}"/>
      <text x="${railX + 20}" y="${y}" fill="${s.fault ? BAD : INK}"
        font-size="13" dominant-baseline="central">${esc(label)}</text>`;
  }).join("");
  const railTop = padY + rowH / 2, railBot = padY + (n - 1) * rowH + rowH / 2;
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="figsvg" role="img">
    <line x1="${railX}" y1="${railTop}" x2="${railX}" y2="${railBot}"
      stroke="${LINE}" stroke-width="2"/>${dots}</svg>`;
  return frame(svg, f.caption);
}

/** compare: before (muted) vs after (good), two stacked cards. */
function compare(f: Extract<Figure, { type: "compare" }>): string {
  const card = (t: string, items: string[], accent: string, tag: string) => `
    <div class="figcard" style="border-color:${accent}">
      <div class="figcard-t" style="color:${accent}">${tag} ${esc(t)}</div>
      <ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
    </div>`;
  return `<figure class="fig figcompare">
    ${card(f.before.title, f.before.items, DIM, "before")}
    <div class="figarrow">→</div>
    ${card(f.after.title, f.after.items, GOOD, "after")}
    ${f.caption ? `<figcaption class="figcap">${esc(f.caption)}</figcaption>` : ""}
  </figure>`;
}

/**
 * architecture: components in horizontal layers, semantic colors, grid backdrop.
 * `touched` nodes glow (what this change modified); edges connect by node id.
 * Absorbs the architecture-diagram skill's design system, rendered from data.
 */
function architecture(f: Extract<Figure, { type: "architecture" }>): string {
  const W = 640, boxW = 150, boxH = 54, padX = 24, layerGap = 78, topPad = 30;
  const rows = f.layers.length;
  const H = topPad + rows * boxH + (rows - 1) * (layerGap - boxH) + 20;
  const pos = new Map<string, { x: number; y: number }>();

  const layersSvg = f.layers.map((layer, li) => {
    const n = layer.nodes.length;
    const gap = (W - 2 * padX - n * boxW) / Math.max(n - 1, 1);
    const y = topPad + li * layerGap;
    const nodesSvg = layer.nodes.map((nd, i) => {
      const x = n === 1 ? (W - boxW) / 2 : padX + i * (boxW + gap);
      pos.set(nd.id, { x: x + boxW / 2, y: y + boxH / 2 });
      const kind = nd.kind ?? "external";
      const fill = KIND_FILL[kind]!, stroke = KIND_STROKE[kind]!;
      const glow = nd.touched ? `<rect x="${x - 3}" y="${y - 3}" width="${boxW + 6}" height="${boxH + 6}" rx="9" fill="none" stroke="${stroke}" stroke-width="1" opacity="0.4"/>` : "";
      const badge = nd.touched ? `<text x="${x + boxW - 8}" y="${y + 13}" fill="${stroke}" font-size="9" text-anchor="end">◆ changed</text>` : "";
      const sub = nd.sub ? `<text x="${x + boxW / 2}" y="${y + boxH / 2 + 12}" fill="${DIM}" font-size="9" text-anchor="middle">${esc(nd.sub)}</text>` : "";
      const nameY = nd.sub ? y + boxH / 2 - 4 : y + boxH / 2;
      // double-rect mask: opaque base then semi-transparent fill (arrows can't bleed through)
      return `${glow}
        <rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="6" fill="#0f172a"/>
        <rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
        <text x="${x + boxW / 2}" y="${nameY}" fill="${INK}" font-size="12" font-weight="600" text-anchor="middle" dominant-baseline="central">${esc(nd.label)}</text>
        ${sub}${badge}`;
    }).join("");
    const ll = layer.label ? `<text x="${padX}" y="${y - 8}" fill="${DIM}" font-size="9" letter-spacing="1.5">${esc(layer.label.toUpperCase())}</text>` : "";
    return ll + nodesSvg;
  }).join("");

  const edgesSvg = (f.edges ?? []).map((e) => {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) return "";
    const fault = e.kind === "fault";
    const col = fault ? BAD : "#64748b";
    const dash = fault ? `stroke-dasharray="5 4"` : "";
    const lbl = e.label ? `<text x="${(a.x + b.x) / 2 + 6}" y="${(a.y + b.y) / 2}" fill="${col}" font-size="9">${esc(e.label)}</text>` : "";
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${col}" stroke-width="1.5" ${dash} marker-end="url(#ah-arch)"/>${lbl}`;
  }).join("");

  const svg = `<svg viewBox="0 0 ${W} ${H}" class="figsvg figarch" role="img">
    <defs>
      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" stroke-width="0.5"/></pattern>
      <marker id="ah-arch" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
        <path d="M0 0 L8 4 L0 8 z" fill="#64748b"/></marker>
    </defs>
    <rect x="0" y="0" width="${W}" height="${H}" fill="#020617" rx="10"/>
    <rect x="0" y="0" width="${W}" height="${H}" fill="url(#grid)" rx="10"/>
    ${edgesSvg}${layersSvg}</svg>`;
  return frame(svg, f.caption);
}

/**
 * scene: an ANIMATIC. Actors are positioned boxes; steps play out in order so a
 * human SEES the incident happen. Rendered as a static SVG stage (every actor +
 * every token + every edge drawn once) whose elements are toggled by the scene
 * player in render.ts. Fully deterministic — the model supplies structure only.
 */
function scene(f: Extract<Figure, { type: "scene" }>): string {
  const W = 640, H = 360, boxW = 128, boxH = 52;
  // The model gives soft 0..100 positions; boxes are wide, so raw coords often
  // overlap. Snap actors to a COLUMN/ROW GRID derived from their x/y ordering,
  // guaranteeing gaps between boxes (no overlaps → no lines crossing boxes).
  const uniqSorted = (vals: number[]) => {
    const bands: number[] = [];
    [...vals].sort((a, b) => a - b).forEach((v) => {
      if (!bands.length || Math.abs(v - bands[bands.length - 1]!) > 12) bands.push(v);
    });
    return bands;
  };
  const colBands = uniqSorted(f.actors.map((a) => a.x));
  const rowBands = uniqSorted(f.actors.map((a) => a.y));
  const nearestIdx = (bands: number[], v: number) =>
    bands.reduce((best, b, i) => (Math.abs(b - v) < Math.abs(bands[best]! - v) ? i : best), 0);
  const cols = Math.max(1, colBands.length), rows = Math.max(1, rowBands.length);
  const colGap = W / (cols + 1), rowGap = H / (rows + 1);
  const pos = new Map(
    f.actors.map((a) => {
      const c = nearestIdx(colBands, a.x), r = nearestIdx(rowBands, a.y);
      return [a.id, { x: colGap * (c + 1), y: rowGap * (r + 1) }] as const;
    }),
  );
  const rects = f.actors.map((a) => {
    const p = pos.get(a.id)!;
    return { id: a.id, cx: p.x, cy: p.y, x0: p.x - boxW / 2, y0: p.y - boxH / 2, x1: p.x + boxW / 2, y1: p.y + boxH / 2 };
  });
  const rectOf = new Map(rects.map((r) => [r.id, r] as const));

  // Clip a center→center segment to the SOURCE box border, so the line starts at
  // the edge of the box (not its middle) on the side facing the target.
  const borderPoint = (r: { cx: number; cy: number }, tx: number, ty: number) => {
    const dx = tx - r.cx, dy = ty - r.cy;
    if (dx === 0 && dy === 0) return { x: r.cx, y: r.cy };
    const hw = boxW / 2 + 4, hh = boxH / 2 + 4; // +pad so the arrow tip doesn't touch the stroke
    const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
    const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity;
    const t = Math.min(sx, sy);
    return { x: r.cx + dx * t, y: r.cy + dy * t };
  };

  // Does the straight segment p→q pass through box r (excluding its endpoints)?
  const segHitsBox = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x0: number; y0: number; x1: number; y1: number }) => {
    // sample the segment; cheap and robust for our small stages
    for (let t = 0.1; t <= 0.9; t += 0.1) {
      const x = p.x + (q.x - p.x) * t, y = p.y + (q.y - p.y) * t;
      if (x > r.x0 - 2 && x < r.x1 + 2 && y > r.y0 - 2 && y < r.y1 + 2) return true;
    }
    return false;
  };

  // Does a label/token box centered at (cx,cy) with size (w,h) overlap ANY actor
  // box (optionally excluding its own endpoints)? Labels used to dodge only their
  // own two endpoint boxes, so a third box sitting under the chosen spot produced
  // the text-overlap-during-animation bug. This checks every actor box.
  const boxesOverlap = (
    a: { x0: number; y0: number; x1: number; y1: number },
    b: { x0: number; y0: number; x1: number; y1: number },
  ) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  const labelClear = (cx: number, cy: number, w: number, h: number, exclude: Set<string>) => {
    const lb = { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
    return !rects.some((r) => !exclude.has(r.id) && boxesOverlap(lb, r));
  };
  // Try the preferred position first, then nudged candidates (up/down/further),
  // and pick the first that clears every actor box. Falls back to the preferred
  // spot if nothing is clear (better than nothing).
  const placeLabel = (
    cx: number, cy: number, w: number, h: number, exclude: Set<string>,
    nudges: Array<[number, number]>,
  ): { x: number; y: number } => {
    if (labelClear(cx, cy, w, h, exclude)) return { x: cx, y: cy };
    for (const [dx, dy] of nudges) {
      if (labelClear(cx + dx, cy + dy, w, h, exclude)) return { x: cx + dx, y: cy + dy };
    }
    return { x: cx, y: cy };
  };
  // rough text box for an N-char label at the given font-size (monospace-ish est.)
  const textBox = (chars: number, fs: number) => ({ w: chars * fs * 0.62 + 8, h: fs + 8 });

  // actor boxes — hidden until an "appear" step reveals them
  const actorsSvg = f.actors.map((a) => {
    const p = pos.get(a.id)!;
    const kind = a.kind ?? "external";
    const fill = KIND_FILL[kind]!, stroke = KIND_STROKE[kind]!;
    const x = p.x - boxW / 2, y = p.y - boxH / 2;
    // wrap long labels onto two lines so text never overflows the box
    const label = a.label.length > 18 ? wrapLabel(a.label, 18) : null;
    const textEl = label
      ? `<text x="${p.x}" y="${p.y}" fill="${INK}" font-size="12" font-weight="600" text-anchor="middle">
          <tspan x="${p.x}" dy="-0.35em">${esc(label[0]!)}</tspan><tspan x="${p.x}" dy="1.15em">${esc(label[1]!)}</tspan></text>`
      : `<text x="${p.x}" y="${p.y}" fill="${INK}" font-size="13" font-weight="600" text-anchor="middle" dominant-baseline="central">${esc(a.label)}</text>`;
    return `<g class="sc-actor" data-actor="${esc(a.id)}" opacity="0">
      <rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="8" fill="#0f172a"/>
      <rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
      ${textEl}
    </g>`;
  }).join("");

  // one drawable element per step (token / edge / flash ring), all hidden initially.
  // The player reveals step i's element(s) as it advances, keyed by data-step.
  const stepEls = f.steps.map((s, i) => {
    const ra = s.actor ? rectOf.get(s.actor) : undefined;
    const rb = s.to ? rectOf.get(s.to) : undefined;
    const a = ra ? { x: ra.cx, y: ra.cy } : undefined;
    const col = s.fault ? BAD : ACCENT;
    if (s.action === "type" && ra) {
      // a text token drops just BELOW the actor; nudge it clear of any OTHER box
      // that sits in that spot (the "long carefully composed" over-Session-B bug).
      const tokTxt = (s.text ?? "").slice(0, 24);
      const tb = textBox(tokTxt.length, 11);
      const w = Math.max(136, tb.w);
      const { x: tcx, y: ty } = placeLabel(ra.cx, ra.y1 + 16, w, 26, new Set([s.actor!]),
        [[0, 14], [0, 30], [0, 46], [-90, 0], [90, 0], [0, -60]]);
      return `<g class="sc-step" data-step="${i}" opacity="0">
        <rect x="${(tcx - w / 2).toFixed(1)}" y="${(ty - 13).toFixed(1)}" width="${w.toFixed(1)}" height="26" rx="6" fill="#0b1220" stroke="${col}" stroke-width="1"/>
        <text x="${tcx.toFixed(1)}" y="${ty.toFixed(1)}" fill="${col}" font-size="11" text-anchor="middle" dominant-baseline="central">${esc(tokTxt)}</text>
      </g>`;
    }
    if ((s.action === "move" || s.action === "flow") && ra && rb) {
      const dash = s.fault ? `stroke-dasharray="6 4"` : "";
      // endpoints on the box borders (facing each other) — line never enters a box
      const p0 = borderPoint(ra, rb.cx, rb.cy);
      const p1 = borderPoint(rb, ra.cx, ra.cy);
      // bow the curve to clear any intervening box; grow the bow until clear
      const nx = -(p1.y - p0.y), ny = p1.x - p0.x; // normal to the segment
      const nlen = Math.hypot(nx, ny) || 1;
      const others = rects.filter((r) => r.id !== ra.id && r.id !== rb.id);
      let bow = 0, ctrl = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      for (const cand of [0, 34, -34, 60, -60, 88, -88]) {
        const c = { x: (p0.x + p1.x) / 2 + (nx / nlen) * cand, y: (p0.y + p1.y) / 2 + (ny / nlen) * cand };
        // approximate the quadratic by its control-influenced midpoint for the hit test
        const mid = { x: 0.25 * p0.x + 0.5 * c.x + 0.25 * p1.x, y: 0.25 * p0.y + 0.5 * c.y + 0.25 * p1.y };
        const clear = !others.some((r) => segHitsBox(p0, mid, r) || segHitsBox(mid, p1, r));
        if (clear) { bow = cand; ctrl = c; break; }
        ctrl = c; // keep last as fallback
      }
      void bow;
      // Label placement: keep it clear of both endpoint boxes. For a short/level
      // edge the apex sits between two adjacent boxes, so lift the label above the
      // higher box top; otherwise ride just above the curve apex.
      const topClear = Math.min(ra.y0, rb.y0) - 10;
      const apexY = ctrl.y - 12;
      const level = Math.abs(p1.y - p0.y) < 24;
      const lx0 = ctrl.x, ly0 = level ? Math.min(apexY, topClear) : apexY;
      const lblText = (s.label ?? "").length > 22 ? (s.label ?? "").slice(0, 21) + "…" : (s.label ?? "");
      // nudge the label off any actor box it would land on (not just the two
      // endpoints): try higher, then lower, then sideways.
      const lbTB = textBox(lblText.length, 10.5);
      const { x: lx, y: ly } = placeLabel(lx0, ly0, lbTB.w, lbTB.h, new Set([ra.id, rb.id]),
        [[0, -18], [0, -34], [0, 22], [0, 38], [-60, -18], [60, -18], [-90, 0], [90, 0]]);
      const lbl = s.label
        ? `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="${col}" font-size="10.5" text-anchor="middle" paint-order="stroke" stroke="#0a0d13" stroke-width="3.5">${esc(lblText)}</text>` : "";
      const tokTxt = s.text ? s.text.slice(0, 16) : "";
      const tokW = s.text ? Math.max(72, textBox(tokTxt.length, 10.5).w) : 0;
      // the move token labels the SOURCE; keep it clear of BOTH endpoint boxes and
      // any third box. Its own width is tokW, so place & draw with the same width.
      const tokPos = s.action === "move" && s.text
        ? placeLabel(p0.x, p0.y - 15, tokW, 22, new Set(),
            [[0, -22], [0, -40], [0, 26], [0, 42], [-tokW, 0], [tokW, 0], [-tokW, -26], [tokW, -26]])
        : null;
      const token = tokPos
        ? `<g class="sc-token"><rect x="${(tokPos.x - tokW / 2).toFixed(1)}" y="${(tokPos.y - 11).toFixed(1)}" width="${tokW.toFixed(1)}" height="22" rx="6" fill="#0b1220" stroke="${col}"/><text x="${tokPos.x.toFixed(1)}" y="${tokPos.y.toFixed(1)}" fill="${col}" font-size="10.5" text-anchor="middle" dominant-baseline="central">${esc(tokTxt)}</text></g>`
        : "";
      return `<g class="sc-step" data-step="${i}" opacity="0">
        <path d="M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} Q ${ctrl.x.toFixed(1)} ${ctrl.y.toFixed(1)} ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}" fill="none" stroke="${col}" stroke-width="2" ${dash} marker-end="url(#sc-${s.fault ? "f" : "n"})"/>
        ${lbl}${token}
      </g>`;
    }
    if (s.action === "flash" && ra) {
      return `<g class="sc-step" data-step="${i}" opacity="0">
        <rect x="${ra.x0 - 5}" y="${ra.y0 - 5}" width="${boxW + 10}" height="${boxH + 10}" rx="11" fill="none" stroke="${BAD}" stroke-width="2"/>
      </g>`;
    }
    // appear / vanish carry no extra element (they toggle the actor); emit a no-op anchor
    void a;
    return `<g class="sc-step" data-step="${i}" opacity="0"></g>`;
  }).join("");

  // timeline metadata the player reads: which actor to show/hide per step. Carries
  // per-step data (action, caption length) so the player can pace by cognitive load.
  const timeline = f.steps.map((s) => ({
    a: s.action, actor: s.actor ?? null, to: s.to ?? null,
    note: s.note ?? s.label ?? null, fault: !!s.fault,
  }));

  const svg = `<svg viewBox="0 0 ${W} ${H}" class="figsvg figscene" role="img"
      data-scene='${esc(JSON.stringify(timeline)).replace(/'/g, "&#39;")}'>
    <defs>
      <marker id="sc-n" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
        <path d="M0 0 L8 4 L0 8 z" fill="${ACCENT}"/></marker>
      <marker id="sc-f" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
        <path d="M0 0 L8 4 L0 8 z" fill="${BAD}"/></marker>
      <pattern id="scgrid" width="34" height="34" patternUnits="userSpaceOnUse">
        <path d="M34 0 L0 0 0 34" fill="none" stroke="#141b28" stroke-width="0.6"/></pattern>
    </defs>
    <rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="#0a0d13"/>
    <rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="url(#scgrid)"/>
    ${stepEls}${actorsSvg}</svg>`;
  // player UI: step scrubber (◀ ▶), play/pause, a step counter, a speed control,
  // and a live caption slot the player fills per step.
  const controls = `<div class="sc-ctrl">
    <button class="sc-prev" type="button" aria-label="previous step" disabled>◀</button>
    <button class="sc-replay" type="button">▶ Play</button>
    <button class="sc-next" type="button" aria-label="next step">▶</button>
    <span class="sc-count">0 / ${f.steps.length}</span>
    <label class="sc-speedwrap">speed
      <select class="sc-speed" aria-label="playback speed">
        <option value="0.5">0.5×</option>
        <option value="1" selected>1×</option>
        <option value="1.5">1.5×</option>
        <option value="2">2×</option>
      </select>
    </label>
    <span class="sc-cap"></span>
  </div>`;
  return `<figure class="fig figscenewrap" tabindex="0">${svg}${controls}${f.caption ? `<figcaption class="figcap">${esc(f.caption)}</figcaption>` : ""}</figure>`;
}

export function renderFigure(f: Figure): string {
  // defense-in-depth: a malformed figure should degrade to nothing, never crash
  try {
    switch (f.type) {
      case "flow": return f.nodes?.length ? flow(f) : "";
      case "sequence": return f.steps?.length ? sequence(f) : "";
      case "compare": return f.before?.items && f.after?.items ? compare(f) : "";
      case "scene": return f.actors?.length && f.steps?.length ? scene(f) : "";
      case "architecture": return f.layers?.length ? architecture(f) : "";
    }
  } catch {
    return "";
  }
}

/**
 * beatMotif — a deterministic, hand-built SVG scene per story beat, drawn in
 * code (no AI-authored pixels, D-004: nothing garbles). Used as the comic-page
 * image when a panel carries no structured figure, so EVERY page has a visual.
 * Each motif is a simple, human-readable metaphor for what that beat *is*.
 */
const MOTIF_W = 640, MOTIF_H = 300;
const AMBER = "#ffd166";

function motifFrame(inner: string, caption?: string): string {
  const cap = caption ? `<figcaption class="figcap">${esc(caption)}</figcaption>` : "";
  const svg = `<svg viewBox="0 0 ${MOTIF_W} ${MOTIF_H}" class="figsvg figmotif" role="img" aria-hidden="true">
    <defs>
      <linearGradient id="mg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0f1520"/><stop offset="1" stop-color="#0a0d13"/>
      </linearGradient>
      <pattern id="mgrid" width="34" height="34" patternUnits="userSpaceOnUse">
        <path d="M34 0 L0 0 0 34" fill="none" stroke="#141b28" stroke-width="0.6"/></pattern>
    </defs>
    <rect x="0" y="0" width="${MOTIF_W}" height="${MOTIF_H}" rx="14" fill="url(#mg)"/>
    <rect x="0" y="0" width="${MOTIF_W}" height="${MOTIF_H}" rx="14" fill="url(#mgrid)"/>
    ${inner}</svg>`;
  return `<figure class="fig">${svg}${cap}</figure>`;
}

const cx = MOTIF_W / 2, cy = MOTIF_H / 2;

/** Per-beat scene builders. All coordinates are static → identical every render. */
const MOTIFS: Record<string, () => string> = {
  "cold-open": () => `
    <circle cx="${cx}" cy="${cy}" r="70" fill="none" stroke="${DIM}" stroke-width="1" opacity="0.4"/>
    <circle cx="${cx}" cy="${cy}" r="46" fill="none" stroke="${ACCENT}" stroke-width="1.5" opacity="0.7"/>
    <path d="M${cx - 22} ${cy - 10} L${cx + 18} ${cy - 10} L${cx + 18} ${cy + 14} L${cx - 4} ${cy + 14} L${cx - 12} ${cy + 24} L${cx - 12} ${cy + 14} L${cx - 22} ${cy + 14} Z"
      fill="${PANEL}" stroke="${ACCENT}" stroke-width="1.5"/>
    <text x="${cx}" y="${cy + 66}" fill="${DIM}" font-size="12" text-anchor="middle" letter-spacing="3">THE SCENE</text>`,
  incident: () => `
    <polygon points="${cx},${cy - 62} ${cx + 66},${cy + 46} ${cx - 66},${cy + 46}"
      fill="rgba(248,113,113,0.12)" stroke="${BAD}" stroke-width="2"/>
    <text x="${cx}" y="${cy + 6}" fill="${BAD}" font-size="52" font-weight="800" text-anchor="middle">!</text>
    <text x="${cx}" y="${cy + 72}" fill="${BAD}" font-size="12" text-anchor="middle" letter-spacing="3">SOMETHING BROKE</text>`,
  "cast-intro": () => {
    const people = [-120, -40, 40, 120].map((dx, i) => {
      const x = cx + dx, cols = [ACCENT, GOOD, AMBER, "#a78bfa"];
      const col = cols[i % 4];
      return `<circle cx="${x}" cy="${cy - 18}" r="16" fill="none" stroke="${col}" stroke-width="2"/>
        <path d="M${x - 20} ${cy + 40} Q${x} ${cy + 6} ${x + 20} ${cy + 40}" fill="none" stroke="${col}" stroke-width="2"/>`;
    }).join("");
    return `${people}<text x="${cx}" y="${cy + 74}" fill="${DIM}" font-size="12" text-anchor="middle" letter-spacing="3">THE CAST</text>`;
  },
  investigation: () => `
    <circle cx="${cx - 14}" cy="${cy - 12}" r="42" fill="none" stroke="${ACCENT}" stroke-width="3"/>
    <line x1="${cx + 16}" y1="${cy + 18}" x2="${cx + 60}" y2="${cy + 62}" stroke="${ACCENT}" stroke-width="6" stroke-linecap="round"/>
    <path d="M${cx - 30} ${cy - 12} L${cx + 2} ${cy - 12} M${cx - 14} ${cy - 28} L${cx - 14} ${cy + 4}" stroke="${DIM}" stroke-width="2"/>
    <text x="${cx}" y="${cy + 88}" fill="${DIM}" font-size="12" text-anchor="middle" letter-spacing="3">THE HUNT</text>`,
  hypothesis: () => `
    <path d="M${cx} ${cy - 58} a34 34 0 1 1 -20 61 l0 14 l40 0 l0 -14 a34 34 0 0 0 -20 -61 Z"
      fill="rgba(255,209,102,0.10)" stroke="${AMBER}" stroke-width="2"/>
    <line x1="${cx - 16}" y1="${cy + 30}" x2="${cx + 16}" y2="${cy + 30}" stroke="${AMBER}" stroke-width="2"/>
    <line x1="${cx - 12}" y1="${cy + 38}" x2="${cx + 12}" y2="${cy + 38}" stroke="${AMBER}" stroke-width="2"/>
    <text x="${cx}" y="${cy + 78}" fill="${DIM}" font-size="12" text-anchor="middle" letter-spacing="3">A THEORY</text>`,
  prediction: () => `
    <path d="M${cx} ${cy - 54} L${cx + 14} ${cy - 14} L${cx + 56} ${cy - 14} L${cx + 22} ${cy + 12}
      L${cx + 34} ${cy + 54} L${cx} ${cy + 28} L${cx - 34} ${cy + 54} L${cx - 22} ${cy + 12}
      L${cx - 56} ${cy - 14} L${cx - 14} ${cy - 14} Z"
      fill="rgba(255,209,102,0.12)" stroke="${AMBER}" stroke-width="2"/>
    <text x="${cx}" y="${cy + 84}" fill="${AMBER}" font-size="12" text-anchor="middle" letter-spacing="3">YOUR CALL</text>`,
  reveal: () => `
    <circle cx="${cx}" cy="${cy}" r="40" fill="rgba(52,211,153,0.12)" stroke="${GOOD}" stroke-width="2"/>
    ${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
      const r1 = 50, r2 = 68, rad = (a * Math.PI) / 180;
      return `<line x1="${cx + r1 * Math.cos(rad)}" y1="${cy + r1 * Math.sin(rad)}" x2="${cx + r2 * Math.cos(rad)}" y2="${cy + r2 * Math.sin(rad)}" stroke="${GOOD}" stroke-width="2"/>`;
    }).join("")}
    <path d="M${cx - 16} ${cy} l10 12 l22 -26" fill="none" stroke="${GOOD}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="${cx}" y="${cy + 90}" fill="${GOOD}" font-size="12" text-anchor="middle" letter-spacing="3">THE TRUTH</text>`,
  "code-walk": () => `
    <rect x="${cx - 90}" y="${cy - 54}" width="180" height="108" rx="8" fill="#0a0d13" stroke="${LINE}" stroke-width="1.5"/>
    <circle cx="${cx - 76}" cy="${cy - 40}" r="4" fill="${BAD}"/><circle cx="${cx - 62}" cy="${cy - 40}" r="4" fill="${AMBER}"/><circle cx="${cx - 48}" cy="${cy - 40}" r="4" fill="${GOOD}"/>
    ${[0, 1, 2, 3].map((i) => `<rect x="${cx - 76}" y="${cy - 24 + i * 16}" width="${[120, 90, 140, 70][i]}" height="6" rx="3" fill="${i === 2 ? GOOD : "#28304a"}"/>`).join("")}
    <text x="${cx}" y="${cy + 82}" fill="${DIM}" font-size="12" text-anchor="middle" letter-spacing="3">THE CODE</text>`,
  resolution: () => `
    <circle cx="${cx}" cy="${cy}" r="46" fill="none" stroke="${GOOD}" stroke-width="2"/>
    <path d="M${cx - 22} ${cy + 2} l14 16 l30 -34" fill="none" stroke="${GOOD}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="${cx}" y="${cy + 80}" fill="${GOOD}" font-size="12" text-anchor="middle" letter-spacing="3">RESOLVED</text>`,
  ratification: () => `
    <line x1="${cx}" y1="${cy - 58}" x2="${cx}" y2="${cy + 20}" stroke="${ACCENT}" stroke-width="2"/>
    <line x1="${cx - 60}" y1="${cy - 40}" x2="${cx + 60}" y2="${cy - 40}" stroke="${ACCENT}" stroke-width="2"/>
    <path d="M${cx - 60} ${cy - 40} l-14 30 l28 0 Z" fill="rgba(125,211,252,0.12)" stroke="${ACCENT}" stroke-width="1.5"/>
    <path d="M${cx + 60} ${cy - 40} l-14 30 l28 0 Z" fill="rgba(125,211,252,0.12)" stroke="${ACCENT}" stroke-width="1.5"/>
    <rect x="${cx - 22}" y="${cy + 20}" width="44" height="12" rx="3" fill="${PANEL}" stroke="${ACCENT}"/>
    <text x="${cx}" y="${cy + 74}" fill="${DIM}" font-size="12" text-anchor="middle" letter-spacing="3">THE VERDICT</text>`,
  teaser: () => `
    <text x="${cx}" y="${cy + 6}" fill="${AMBER}" font-size="60" font-weight="800" text-anchor="middle">…</text>
    <path d="M${cx + 70} ${cy} l30 0 m-12 -12 l12 12 l-12 12" fill="none" stroke="${AMBER}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="${cx}" y="${cy + 70}" fill="${DIM}" font-size="12" text-anchor="middle" letter-spacing="3">NEXT TIME</text>`,
  "concept-intro": () => `
    <circle cx="${cx}" cy="${cy - 6}" r="44" fill="rgba(255,209,102,0.08)" stroke="${AMBER}" stroke-width="2" stroke-dasharray="4 4"/>
    <text x="${cx}" y="${cy + 8}" fill="${AMBER}" font-size="46" font-weight="800" text-anchor="middle">?</text>
    <text x="${cx}" y="${cy + 74}" fill="${DIM}" font-size="12" text-anchor="middle" letter-spacing="3">A NEW IDEA</text>`,
};

/** Deterministic per-beat scene; falls back to a neutral motif for unknown beats. */
export function beatMotif(beat: string, caption?: string): string {
  const build = MOTIFS[beat] ?? MOTIFS["cold-open"]!;
  return motifFrame(build(), caption);
}

/** CSS for figures, appended to the episode stylesheet. */
export const FIGURE_CSS = `
  .fig{margin:14px 0 4px;padding:0}
  .figsvg{width:100%;height:auto;display:block}
  .figcap{color:var(--dim);font-size:12.5px;font-style:italic;text-align:center;margin-top:8px}
  .figcompare{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  .figcard{flex:1;min-width:180px;border:1px solid;border-radius:10px;padding:10px 14px;background:#0f131b}
  .figcard-t{font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:6px}
  .figcard ul{margin:0;padding-left:18px}
  .figcard li{font-size:13.5px;margin:4px 0}
  .figarrow{color:var(--dim);font-size:22px;flex:0 0 auto}
  .figcompare .figcap{flex-basis:100%}
  /* scene animatic */
  .figscene{border:1px solid var(--line);border-radius:12px}
  .sc-actor,.sc-step{transition:opacity .4s ease}
  .sc-actor.on,.sc-step.on{opacity:1}
  .sc-step.fault{animation:sc-pulse .5s ease}
  @keyframes sc-pulse{0%{opacity:0}40%{opacity:1}100%{opacity:1}}
  .sc-ctrl{display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap}
  .sc-replay{padding:6px 14px;border-radius:99px;border:1px solid var(--accent);
       background:#171408;color:var(--accent);font:inherit;font-size:12.5px;cursor:pointer;flex:0 0 auto}
  .sc-replay:hover{background:#1f1a0b}
  .sc-prev,.sc-next{width:30px;height:30px;border-radius:99px;border:1px solid var(--line);
       background:#12161f;color:var(--ink);font:inherit;font-size:12px;cursor:pointer;flex:0 0 auto;
       display:inline-flex;align-items:center;justify-content:center;padding:0}
  .sc-prev:hover:not(:disabled),.sc-next:hover:not(:disabled){border-color:var(--accent2);color:var(--accent2)}
  .sc-prev:disabled,.sc-next:disabled{opacity:.35;cursor:default}
  .sc-count{font-size:11.5px;color:var(--dim);font-variant-numeric:tabular-nums;min-width:44px;text-align:center}
  .sc-speedwrap{font-size:11px;color:var(--dim);display:inline-flex;align-items:center;gap:5px}
  .sc-speed{font:inherit;font-size:11.5px;background:#12161f;color:var(--ink);
       border:1px solid var(--line);border-radius:7px;padding:3px 6px;cursor:pointer}
  .sc-cap{font-size:13px;color:var(--ink);min-height:1.3em;transition:opacity .2s;flex:1 1 100%}
  .sc-cap.fault{color:var(--bad);font-weight:600}
  .figscenewrap:focus-visible{outline:2px solid var(--accent2);outline-offset:3px;border-radius:12px}
  @media (prefers-reduced-motion: reduce){ .sc-actor,.sc-step{transition:none} .sc-step.fault{animation:none} }`;
