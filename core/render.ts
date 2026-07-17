/**
 * core/render.ts — Episode Spec -> self-contained interactive HTML.
 *
 * This is the render half of the spec/render split (D-009). It reproduces the
 * hand-verified Episode 1 layout (episodes/hermes-agent-pr-62413.html) purely
 * from an EpisodeSpec, and personalizes concept-intro depth from a LearnerModel
 * (D-005 exposure ledger). The output is one HTML file: CSS + JS inline, no deps
 * (D-004), safe to open from a file:// URL or serve from the viewer.
 *
 * Both extractors (PR mode now, session mode in phase 2) render through this.
 */
import type { EpisodeSpec, LearnerModel, Panel, Prediction, Concept } from "./types";
import { renderFigure, beatMotif, FIGURE_CSS } from "./figure";

const EMPTY_LM: LearnerModel = { concepts: {}, answers: {} };

/** Minimal HTML-escape for text nodes. Body text supports a tiny markdown subset. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Markdown-lite: **bold**, `code`, and *italic*. Applied after esc(). */
function md(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\*([^*]+)\*/g, "<i>$1</i>");
}

/**
 * Term-link: wrap the FIRST occurrence of each concept term in this HTML chunk
 * with a hover/tap tooltip carrying its one_liner (definition at point of use —
 * pre-training principle without a working-memory round-trip to a glossary).
 * Operates on rendered HTML but only replaces inside text nodes (never inside
 * a tag or <code>), via a tag-safe segment scan.
 */
function termLink(html: string, concepts: Concept[]): string {
  if (!concepts.length) return html;
  const done = new Set<string>();
  // split into tags and text; only transform text segments outside <code>
  const parts = html.split(/(<[^>]+>)/);
  let inCode = false;
  for (const c of concepts) {
    const aliases = [c.name, ...(c.aliases ?? []), c.id.replace(/-/g, " ")]
      .filter((a) => a.length >= 4)
      .sort((a, b) => b.length - a.length);
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i]!;
      if (seg.startsWith("<")) {
        if (/^<code/i.test(seg)) inCode = true;
        else if (/^<\/code/i.test(seg)) inCode = false;
        continue;
      }
      if (inCode || done.has(c.id)) continue;
      for (const alias of aliases) {
        const re = new RegExp(`\\b(${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\b`, "i");
        if (re.test(seg)) {
          parts[i] = seg.replace(re, `<span class="term" tabindex="0">$1<span class="termtip"><b>${esc(c.name)}</b> — ${esc(c.intro.one_liner)}</span></span>`);
          done.add(c.id);
          break;
        }
      }
    }
  }
  return parts.join("");
}

const CAST_CLASS: Record<string, string> = {}; // filled per-spec from cast order

/** Decide concept-intro depth from the exposure ledger (D-005). */
function conceptDepth(lm: LearnerModel, conceptId: string): "full" | "one_liner" {
  const shown = lm.concepts[conceptId]?.shown ?? 0;
  return shown >= 3 ? "one_liner" : "full";
}

function renderConceptIntro(c: Concept, depth: "full" | "one_liner", shown: number): string {
  const exposure = shown >= 3 ? `seen ×${shown}` : "first appearance";
  const collapsed = depth === "one_liner" ? " collapsed" : "";
  return `
<section class="concept${collapsed}" id="c-${esc(c.id)}">
  <span class="exposure">${esc(exposure)}</span>
  <div class="tag">meet the concept</div>
  <h3 data-oneliner="${esc(c.intro.one_liner)}">${esc(c.name)}</h3>
  <p>${md(c.intro.full)}</p>
</section>`;
}

function renderBubble(spec: EpisodeSpec, p: Panel): string {
  const member = spec.cast?.find((c) => c.id === p.speaker);
  const cls = p.speaker ? CAST_CLASS[p.speaker] ?? "" : "";
  const who = member ? `<div class="who">${esc(member.label)} — ${esc(member.role)}</div>` : "";
  return `<div class="bubble ${cls}">${who}${md(p.body)}</div>`;
}

function renderCode(code: NonNullable<Panel["code"]>): string {
  const hdr = code.file ? `<div class="filehdr">${esc(code.file)}</div>` : "";
  const cap = code.caption ? `<p class="caption">${md(code.caption)}</p>` : "";
  return `${hdr}<pre>${esc(code.snippet)}</pre>${cap}`;
}

function beatLabel(beat: string): string {
  return beat.replace(/-/g, " ");
}

/** Render a prediction as a set of option buttons + a hidden feedback slot. */
function renderPrediction(q: Prediction, idPrefix: string): string {
  const opts = q.options
    .map((o) => `  <button class="opt" data-k="${esc(o.id)}">${md(o.text)}</button>`)
    .join("\n");
  return `
  <button-group>
${opts}
  </button-group>
  <div class="fb" id="${idPrefix}-fb"></div>`;
}

/** Build the JS payload driving gate/quiz/ratify/exposure, spec-derived. */
function renderScript(spec: EpisodeSpec): string {
  // Gate = the first prediction panel. Everything after it is locked until answered.
  const gatePanelIndex = spec.panels.findIndex((p) => p.beat === "prediction");
  const gate = gatePanelIndex >= 0 ? spec.panels[gatePanelIndex]!.prediction ?? null : null;

  const exposureConcepts = spec.concepts.map((c) => c.id);

  const gateData = gate
    ? {
        answer: gate.answer,
        feedback: gate.feedback,
        // "half credit" heuristic: options that map to a real hypothesis but aren't the
        // answer get the neutral/half style; others get wrong.
        halfKeys: gate.options.filter((o) => o.maps_to_hypothesis && o.id !== gate.answer).map((o) => o.id),
        concepts: gate.concept_ids ?? [],
      }
    : null;

  const quizData: Record<string, { right: string; concepts: string[]; fb: Record<string, string> }> = {};
  spec.quiz.forEach((q, i) => {
    quizData[`q${i + 1}`] = { right: q.answer, concepts: q.concept_ids ?? [], fb: q.feedback };
  });

  return `
<script>
const LM_KEY = "humanmem-learner";
const lm = JSON.parse(localStorage.getItem(LM_KEY) || '{"concepts":{},"answers":{}}');
function saveLM(){ localStorage.setItem(LM_KEY, JSON.stringify(lm)); }

// exposure ledger (D-005): bump on view, collapse intros seen >=3 times
const EP_ID = ${JSON.stringify(spec.id)};
${JSON.stringify(exposureConcepts)}.forEach(function(id){
  var c = lm.concepts[id] = lm.concepts[id] || {shown:0};
  c.shown++; c.last_seen = EP_ID;
  if(c.shown >= 3){
    var el = document.getElementById("c-"+id);
    if(el){ el.classList.add("collapsed"); var ex = el.querySelector(".exposure"); if(ex) ex.textContent = "seen ×"+c.shown; }
  }
});
saveLM();

// prediction gate
var GATE = ${JSON.stringify(gateData)};
if (GATE) {
  document.querySelectorAll("#gate .opt").forEach(function(btn){
    btn.addEventListener("click", function(){
      var k = btn.dataset.k;
      var correct = k === GATE.answer;
      var half = GATE.halfKeys.indexOf(k) >= 0;
      document.querySelectorAll("#gate .opt").forEach(function(b){
        b.disabled = true;
        if(b.dataset.k === GATE.answer) b.classList.add(correct ? "picked-right" : "reveal-right");
      });
      if(!correct) btn.classList.add("picked-wrong");
      var fb = document.getElementById("gate-fb");
      fb.className = "fb " + (correct ? "right" : half ? "half" : "wrong");
      fb.textContent = GATE.feedback[k] || "";
      var lock = document.getElementById("gate-lock"); if(lock) lock.textContent = "⬩ reveal unlocked ⬩";
      var after = document.getElementById("after-gate"); if(after) after.classList.add("open");
      lm.answers["gate"] = {picked:k, correct:correct, concepts:GATE.concepts, at:new Date().toISOString()};
      saveLM();
    });
  });
}

// ratification (records the user's ruling; no right answer)
document.querySelectorAll("#ratify button").forEach(function(btn){
  btn.addEventListener("click", function(){
    document.querySelectorAll("#ratify button").forEach(function(b){ b.classList.remove("sel"); });
    btn.classList.add("sel");
    var n = document.getElementById("ratify-note");
    if(n){ n.style.display="block"; n.textContent = btn.dataset.note || ""; }
    lm.answers["ratify"] = {picked:btn.dataset.v, at:new Date().toISOString()}; saveLM();
  });
});

// quiz + scorecard
var QUIZ = ${JSON.stringify(quizData)};
var total = Object.keys(QUIZ).length, answered = 0, correct = 0;
document.querySelectorAll(".q").forEach(function(qEl){
  var qid = qEl.dataset.q, data = QUIZ[qid];
  if(!data) return;
  qEl.querySelectorAll(".opt").forEach(function(btn){
    btn.addEventListener("click", function(){
      var k = btn.dataset.k, isRight = k === data.right;
      qEl.querySelectorAll(".opt").forEach(function(b){
        b.disabled = true;
        if(b.dataset.k === data.right) b.classList.add(isRight ? "picked-right" : "reveal-right");
      });
      if(!isRight) btn.classList.add("picked-wrong");
      var fb = qEl.querySelector(".fb");
      fb.className = "fb " + (isRight ? "right" : "wrong"); fb.textContent = data.fb[k] || "";
      lm.answers[qid] = {picked:k, correct:isRight, concepts:data.concepts, at:new Date().toISOString()}; saveLM();
      answered++; if(isRight) correct++;
      if(answered === total){
        var sc = document.getElementById("scorecard");
        if(sc){ sc.classList.add("open");
          document.getElementById("score").textContent = correct + " / " + total;
          document.getElementById("score-note").textContent =
            correct === total ? "Full situation model. You could review the next change in this area cold."
            : correct >= total - 1 ? "Solid — one soft spot; the reveal slides cover it."
            : "Worth a second look — the reveal and code-walk slides carry the answers.";
        }
      }
    });
  });
});

// ── comic-book page flip ─────────────────────────────────────────────
(function(){
  var deck = document.querySelector(".deck");
  var pages = deck ? Array.prototype.slice.call(deck.querySelectorAll(".page, .coverpage")) : [];
  var prevBtn = document.getElementById("prev");
  var nextBtn = document.getElementById("next");
  var pageno = document.getElementById("pageno");
  var fill = document.querySelector(".progress .fill");
  if(!deck || pages.length < 2) return; // no-JS / single page → plain scroll

  document.body.classList.add("book"); // opt into flip mode (else: scroll)
  var cur = 0;
  // The gate page (contains #gate) is a hard stop until the reader commits.
  var gateIdx = pages.findIndex(function(p){ return p.querySelector("#gate"); });
  var after = document.getElementById("after-gate");
  function gateAnswered(){ return !after || after.classList.contains("open"); }
  function lockedAt(i){ return gateIdx >= 0 && i === gateIdx && !gateAnswered(); }

  function render(){
    pages.forEach(function(p, i){
      p.classList.remove("cur","flip-in","flip-out");
      if(i === cur) p.classList.add("cur");
    });
    if(pageno) pageno.textContent = (cur + 1) + " / " + pages.length;
    if(prevBtn) prevBtn.disabled = cur === 0;
    if(nextBtn){
      var stuck = lockedAt(cur);
      nextBtn.disabled = cur === pages.length - 1;
      nextBtn.classList.toggle("locked", stuck);
      nextBtn.textContent = stuck ? "Commit above ↑" : (cur === pages.length - 1 ? "The End" : "Next →");
    }
    if(fill) fill.style.width = ((cur) / (pages.length - 1) * 100).toFixed(1) + "%";
    // reset scroll of the newly shown page to the top
    if(pages[cur]) pages[cur].scrollTop = 0;
    // auto-play a scene animatic when its page turns into view
    if(pages[cur] && window.__playScene){
      var sc = pages[cur].querySelector(".figscene");
      if(sc) setTimeout(function(){ window.__playScene(sc); }, 350);
    }
  }
  function go(to){
    if(to < 0 || to >= pages.length || to === cur) return;
    if(to > cur && lockedAt(cur)) return; // can't pass the gate unanswered
    var forward = to > cur;
    var leaving = pages[cur], entering = pages[to];
    leaving.classList.add(forward ? "flip-out" : "flip-in");
    cur = to;
    render();
    entering.classList.add(forward ? "flip-in" : "flip-out");
    // force reflow so the enter transition plays from the offset state
    void entering.offsetWidth;
    entering.classList.remove("flip-in","flip-out");
  }
  function next(){ go(cur + 1); }
  function prev(){ go(cur - 1); }

  if(nextBtn) nextBtn.addEventListener("click", next);
  if(prevBtn) prevBtn.addEventListener("click", prev);
  var tapNext = document.getElementById("tap-next"), tapPrev = document.getElementById("tap-prev");
  if(tapNext) tapNext.addEventListener("click", next);
  if(tapPrev) tapPrev.addEventListener("click", prev);

  document.addEventListener("keydown", function(e){
    var t = e.target;
    // a focused form control (the speed <select>) keeps its own arrow behavior
    if(t && (t.tagName === "SELECT" || t.tagName === "OPTION")) return;
    // If the CURRENT slide has a scene animatic, ←/→ scrub its steps FIRST and
    // only fall through to a page flip at the scene's boundaries. This is what the
    // reader expects while watching an animation — without it, ← jumped to the
    // previous PAGE instead of the previous step whenever the scene wasn't focused.
    if(e.key === "ArrowRight" || e.key === "ArrowLeft"){
      var curPage = document.querySelector(".deck .cur");
      var scene = curPage ? curPage.querySelector(".figscene") : null;
      var api = scene && scene.__sceneApi;
      if(api){
        if(e.key === "ArrowRight" && api.canNext()){ e.preventDefault(); api.next(); return; }
        if(e.key === "ArrowLeft" && api.canPrev()){ e.preventDefault(); api.prev(); return; }
        // at a boundary (scene fully shown → flip forward; scene at step 0 → flip back)
      }
    }
    if(e.key === "ArrowRight"){ e.preventDefault(); next(); }
    else if(e.key === "ArrowLeft"){ e.preventDefault(); prev(); }
    else if(e.key === " " && (!t || t.tagName !== "BUTTON")){ e.preventDefault(); next(); }
  });

  // touch swipe
  var sx = 0, sy = 0;
  deck.addEventListener("touchstart", function(e){ sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, {passive:true});
  deck.addEventListener("touchend", function(e){
    var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if(Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)){ if(dx < 0) next(); else prev(); }
  }, {passive:true});

  // When the gate is answered, unlock the Next button on the gate page.
  if(after){
    var obs = new MutationObserver(function(){ if(gateAnswered()) render(); });
    obs.observe(after, {attributes:true, attributeFilter:["class"]});
  }

  render();
})();

// ── scene animatic player ────────────────────────────────────────────
// Plays a .figscene step-by-step: reveals actors/edges/tokens in order and
// writes each step's note into the caption. Exposed so the page-flip can
// auto-play a scene when its page turns into view.
(function(){
  // Cognition-based pacing: each beat dwells long enough for a human to (1) read
  // its caption and (2) absorb the causal step, before the next appears. Naive
  // flat timing over-runs simple beats and flashes past the hard ones.
  //   dwell = base(action) + readingTime(caption) + faultBonus, clamped.
  // ~28 ms/char ≈ a comfortable reading pace for short captions; the action base
  // reflects how much NEW causal load the beat adds (appear/vanish < type/move <
  // flow), and the fault beat (the "aha") gets extra time to land.
  var PER_CHAR = 28, MIN = 900, MAX = 4200;
  var BASE = { appear: 550, vanish: 650, type: 800, move: 900, flow: 950, flash: 800 };
  function dwell(t){
    var base = BASE[t.a] != null ? BASE[t.a] : 800;
    var read = ((t.note || "").length) * PER_CHAR;
    var faultBonus = t.fault ? 900 : 0;   // the bug moment needs to register
    return Math.max(MIN, Math.min(MAX, base + read + faultBonus));
  }
  function playScene(svg){ if(svg && svg.__sceneApi) svg.__sceneApi.restart(); }
  window.__playScene = playScene;

  // Build a stepper controller per scene: scrub with ◀ / ▶, play/pause, and a
  // speed control. State is rebuilt from step 0 each time (applyState) so moving
  // BACKWARD is exact — vanish/fault/opacity all reconstruct, no drift.
  function initScene(svg){
    if(!svg || svg.__sceneApi) return;
    var timeline;
    try { timeline = JSON.parse(svg.getAttribute("data-scene") || "[]"); } catch(e){ return; }
    var wrap = svg.closest(".figscenewrap");
    var cap = wrap ? wrap.querySelector(".sc-cap") : null;
    var playBtn = wrap ? wrap.querySelector(".sc-replay") : null;
    var prevBtn = wrap ? wrap.querySelector(".sc-prev") : null;
    var nextBtn = wrap ? wrap.querySelector(".sc-next") : null;
    var speedSel = wrap ? wrap.querySelector(".sc-speed") : null;
    var counter = wrap ? wrap.querySelector(".sc-count") : null;
    var N = timeline.length;
    var i = 0;          // number of steps currently shown (0..N)
    var playing = false;
    var speed = 1;      // 0.5 .. 2 ; higher = faster (divides dwell)
    var timer = null;

    function actorEl(id){ return svg.querySelector('.sc-actor[data-actor="'+id+'"]'); }
    // rebuild the whole scene to reflect exactly n steps applied
    function applyState(n){
      svg.querySelectorAll(".sc-actor, .sc-step").forEach(function(g){ g.classList.remove("on","fault"); g.setAttribute("opacity","0"); });
      var lastNote = "", lastFault = false;
      for(var k=0;k<n;k++){
        var t = timeline[k];
        if(t.a === "appear" && t.actor){ var a=actorEl(t.actor); if(a){ a.classList.add("on"); a.setAttribute("opacity","1"); } }
        else if(t.a === "vanish" && t.actor){ var v=actorEl(t.actor); if(v){ v.classList.remove("on"); v.setAttribute("opacity","0.15"); } }
        else if(t.actor){ var s=actorEl(t.actor); if(s){ s.classList.add("on"); s.setAttribute("opacity","1"); } }
        if(t.to){ var b=actorEl(t.to); if(b){ b.classList.add("on"); b.setAttribute("opacity","1"); } }
        var stepEl = svg.querySelector('.sc-step[data-step="'+k+'"]');
        if(stepEl){ stepEl.setAttribute("opacity","1"); stepEl.classList.add("on"); if(t.fault) stepEl.classList.add("fault"); }
        lastNote = t.note || ""; lastFault = !!t.fault;
      }
      if(cap){ cap.textContent = n>0 ? lastNote : ""; cap.classList.toggle("fault", n>0 && lastFault); }
      if(counter) counter.textContent = n + " / " + N;
      if(prevBtn) prevBtn.disabled = n <= 0;
      if(nextBtn) nextBtn.disabled = n >= N;
    }
    function setPlaying(on){
      playing = on;
      if(playBtn) playBtn.textContent = on ? "⏸ Pause" : (i >= N ? "↻ Replay" : "▶ Play");
      if(!on && timer){ clearTimeout(timer); timer = null; }
    }
    function schedule(){
      if(!playing || i >= N) { if(i>=N) setPlaying(false); return; }
      var t = timeline[i];
      var d = Math.max(MIN, Math.min(MAX, (BASE[t.a]!=null?BASE[t.a]:800) + ((t.note||"").length)*PER_CHAR + (t.fault?900:0)));
      timer = setTimeout(function(){ i++; applyState(i); schedule(); }, d / speed);
    }
    function play(){ if(i >= N){ i = 0; applyState(0); } setPlaying(true); schedule(); }
    function pause(){ setPlaying(false); }
    function stepBy(delta){
      pause();
      i = Math.max(0, Math.min(N, i + delta));
      applyState(i);
      if(playBtn) playBtn.textContent = i >= N ? "↻ Replay" : "▶ Play";
    }

    svg.__sceneApi = {
      restart: function(){ i = 0; applyState(0); play(); },
      toggle: function(){ playing ? pause() : play(); },
      next: function(){ stepBy(1); },
      prev: function(){ stepBy(-1); },
      setSpeed: function(s){ speed = s; },
      canPrev: function(){ return i > 0; },   // there's a step to rewind to
      canNext: function(){ return i < N; },   // there's a step still to reveal
    };

    if(playBtn) playBtn.addEventListener("click", function(){ svg.__sceneApi.toggle(); });
    if(nextBtn) nextBtn.addEventListener("click", function(){ svg.__sceneApi.next(); });
    if(prevBtn) prevBtn.addEventListener("click", function(){ svg.__sceneApi.prev(); });
    if(speedSel) speedSel.addEventListener("change", function(){ svg.__sceneApi.setSpeed(parseFloat(speedSel.value) || 1); });
    // keyboard: ←/→ step scrubbing is handled globally by the deck's keydown
    // handler (it delegates to the current slide's scene, focused or not, and
    // falls through to a page flip only at the scene's boundaries). Here we only
    // add space-to-play/pause when the scene wrapper itself is focused.
    if(wrap){
      wrap.addEventListener("keydown", function(e){
        var tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
        if(e.key === " " && tag !== "button" && tag !== "select"){ e.stopPropagation(); e.preventDefault(); svg.__sceneApi.toggle(); }
      });
    }
    applyState(0);
  }

  document.querySelectorAll(".figscene").forEach(initScene);
})();
</script>`;
}

/** Full stylesheet, lifted verbatim from the verified Episode 1. */
const STYLE = `<style>
  :root{
    --bg:#0d0f14; --panel:#161a23; --panel2:#1c2130; --ink:#e8e6e0; --dim:#9aa0ae;
    --accent:#ffd166; --accent2:#7dd3fc; --c0:#a7f3d0; --c1:#fca5a5; --c2:#ffd166; --c3:#7dd3fc;
    --good:#34d399; --bad:#f87171; --line:#2a3040;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 "Avenir Next",-apple-system,"Segoe UI",sans-serif;}
  .strip{max-width:680px;margin:0 auto;padding:24px 16px 96px}
  header{text-align:center;padding:40px 8px 8px}
  header .series{letter-spacing:.35em;font-size:12px;color:var(--dim);text-transform:uppercase}
  header h1{font-size:34px;margin:10px 0 4px;line-height:1.2}
  header .logline{color:var(--dim);font-style:italic;max-width:520px;margin:0 auto}
  header .meta{margin-top:14px;font-size:12px;color:var(--dim)}
  header .meta a{color:var(--accent2);text-decoration:none}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;
         margin:26px 0;padding:22px 24px;position:relative;box-shadow:0 4px 24px rgba(0,0,0,.35)}
  .beat{position:absolute;top:-11px;left:18px;background:var(--bg);border:1px solid var(--line);
        color:var(--dim);font-size:10.5px;letter-spacing:.22em;text-transform:uppercase;
        padding:2px 10px;border-radius:99px}
  .panel.dark{background:#0a0c10;border-color:#3b2f2f}
  .panel.dark .flash{color:var(--bad);font-weight:700}
  .bubble{border-radius:14px;padding:14px 16px;margin:10px 0;position:relative;background:var(--panel2)}
  .bubble .who{font-size:12px;letter-spacing:.08em;font-weight:700;margin-bottom:4px}
  .bubble.c0{border-left:3px solid var(--c0)} .bubble.c0 .who{color:var(--c0)}
  .bubble.c1{border-left:3px solid var(--c1)} .bubble.c1 .who{color:var(--c1)}
  .bubble.c2{border-left:3px solid var(--c2)} .bubble.c2 .who{color:var(--c2)}
  .bubble.c3{border-left:3px solid var(--c3)} .bubble.c3 .who{color:var(--c3)}
  .concept{background:linear-gradient(135deg,#161a23,#1a2030);border:1px dashed #3a4258;border-radius:14px;
           margin:26px 0;padding:18px 22px}
  .concept .tag{font-size:10.5px;letter-spacing:.22em;color:var(--accent);text-transform:uppercase}
  .concept h3{margin:6px 0 6px;font-size:18px}
  .concept.collapsed p{display:none}
  .concept.collapsed h3::after{content:" — " attr(data-oneliner);font-weight:400;color:var(--dim);font-size:14px}
  .exposure{float:right;font-size:10px;color:var(--dim);border:1px solid var(--line);border-radius:99px;padding:1px 8px}
  code,pre{font-family:"SF Mono",ui-monospace,Menlo,monospace}
  code{background:#232a3b;padding:1px 6px;border-radius:6px;font-size:13.5px}
  pre{background:#0a0d13;border:1px solid var(--line);border-radius:10px;padding:14px 16px;
      overflow-x:auto;font-size:13px;line-height:1.6;white-space:pre-wrap}
  .caption{font-size:13.5px;color:var(--dim);font-style:italic;margin-top:8px}
  .filehdr{font-size:12px;color:var(--accent2);margin-bottom:6px}
  .gate{border:2px solid var(--accent);border-radius:16px;background:#171408;padding:22px 24px;margin:30px 0}
  .gate .tag{color:var(--accent);font-size:11px;letter-spacing:.25em;text-transform:uppercase}
  .gate h3{margin:8px 0 4px;font-size:20px}
  .opt{display:block;width:100%;text-align:left;margin:8px 0;padding:12px 14px;border-radius:10px;
       border:1px solid var(--line);background:var(--panel2);color:var(--ink);font-size:15px;cursor:pointer;
       transition:transform .06s ease}
  .opt:hover{transform:translateX(3px);border-color:var(--accent)}
  .opt.picked-right{border-color:var(--good);background:#0d2018}
  .opt.picked-wrong{border-color:var(--bad);background:#211012}
  .opt.reveal-right{border-color:var(--good)}
  .opt:disabled{cursor:default;opacity:.85}
  button-group{display:block}
  .fb{display:none;margin-top:14px;padding:14px 16px;border-radius:10px;font-size:14.5px}
  .fb.right{display:block;background:#0d2018;border:1px solid var(--good)}
  .fb.wrong{display:block;background:#211012;border:1px solid var(--bad)}
  .fb.half{display:block;background:#1f1a0b;border:1px solid var(--accent)}
  #after-gate{display:none}
  #after-gate.open{display:block}
  .gate .locknote{font-size:12px;color:var(--dim);margin-top:12px;text-align:center}
  .verdict{border-left:4px solid var(--c2);padding-left:16px}
  .ratify{border:1px solid var(--accent2);border-radius:14px;padding:18px 22px;margin:26px 0;background:#0b131a}
  .ratify .tag{color:var(--accent2);font-size:11px;letter-spacing:.25em;text-transform:uppercase}
  .ratify .btns{margin-top:10px}
  .ratify button{margin-right:8px;padding:8px 16px;border-radius:99px;border:1px solid var(--line);
                 background:var(--panel2);color:var(--ink);cursor:pointer}
  .ratify button.sel{border-color:var(--accent2);background:#10222e}
  .ratify .note{display:none;font-size:13.5px;color:var(--dim);margin-top:10px}
  .quiz{margin:0}
  .quizlead{text-align:center;color:var(--dim);font-size:13.5px;margin:6px auto 20px;max-width:52ch}
  .q{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px 24px;margin:0}
  .q h4{margin:0 0 14px;font-size:18px;line-height:1.4}
  .qnum{display:inline-block;font-size:11px;letter-spacing:.16em;color:var(--accent);
        text-transform:uppercase;margin-right:8px;vertical-align:middle}
  .scorecard{display:none;text-align:center;border:1px solid var(--accent);border-radius:16px;
             padding:22px;margin:30px 0;background:#171408}
  .scorecard.open{display:block}
  .scorecard .big{font-size:30px;font-weight:800;color:var(--accent)}
  .mapbox{border:1px solid var(--line);border-radius:14px;padding:18px 22px;margin:26px 0;background:#10141c}
  .mapbox .tag{font-size:11px;letter-spacing:.25em;color:var(--good);text-transform:uppercase}
  .mapbox li{margin:8px 0;font-size:14.5px}
  .mapbox b{color:var(--accent2)}
  .teaser{text-align:center;color:var(--dim);font-style:italic;margin:44px 0 0}
  .teaser .next{color:var(--accent);font-style:normal;font-weight:700;letter-spacing:.2em;font-size:11px;text-transform:uppercase}
  hr.gutter{border:0;height:1px;background:var(--line);margin:34px 20%}
  .term{border-bottom:1px dotted var(--accent2);cursor:help;position:relative}
  .termtip{display:none;position:absolute;left:0;bottom:calc(100% + 6px);z-index:10;
           width:min(320px,80vw);background:#0b1220;border:1px solid var(--accent2);
           border-radius:10px;padding:10px 12px;font-size:13px;font-style:normal;
           color:var(--ink);line-height:1.5;box-shadow:0 6px 20px rgba(0,0,0,.5)}
  .termtip b{color:var(--accent2)}
  .term:hover .termtip,.term:focus .termtip{display:block}

  /* ── comic-book page-flip layout ──────────────────────────────────── */
  /* Each panel is a full page; one page in view at a time; flip to advance.
     No-JS fallback: without the data-book hook every .page is static-stacked
     and simply scrolls (graceful degradation, D-004). */
  html,body{height:100%}
  body.book{overflow:hidden}
  .deck{position:relative;max-width:760px;height:100vh;margin:0 auto;
        padding:0;display:flex;align-items:center;justify-content:center}
  /* SLIDE DISCIPLINE (references/slide-discipline.md): a .page is a slide that
     FITS THE FOLD, not a scroll box. Default = clip (fit-or-split); a panel
     that genuinely can't fit opts in via .longform (the only place a scrollbar
     is allowed), mirroring the D-004 "gate behavior on an attribute" pattern.
     Content is vertically centered so short slides don't float at the top. */
  .page{width:100%;max-height:calc(100vh - 120px);overflow:clip;
        padding:26px 30px 34px;display:flex;flex-direction:column;justify-content:center}
  .page.longform{overflow-y:auto;justify-content:flex-start}
  /* book mode: stack every page, show only the current one with a flip */
  body.book .deck .page,body.book .deck .coverpage{position:absolute;top:calc(50% - 28px);left:0;right:0;
        transform:translateY(-50%);max-height:calc(100vh - 120px);
        opacity:0;pointer-events:none;transition:opacity .35s ease,transform .5s ease;
        transform-origin:left center;perspective:1600px}
  body.book .deck .page.cur,body.book .deck .coverpage.cur{opacity:1;pointer-events:auto;
        transform:translateY(-50%) rotateY(0)}
  body.book .deck .page.flip-out{opacity:0;transform:translateY(-50%) rotateY(-18deg) translateX(-40px)}
  body.book .deck .page.flip-in{opacity:0;transform:translateY(-50%) rotateY(14deg) translateX(40px)}
  body.book #after-gate{display:contents}
  .coverpage{width:100%;text-align:center;padding:24px 30px}
  .cover-motif{max-width:360px;margin:16px auto 0}
  .cover-motif svg{width:100%;height:auto;display:block}
  /* the big page image — slide discipline: the figure LEADS. Let it fill the
     slide's WIDTH (figure.ts default: width:100% / height:auto from the viewBox
     aspect ratio). Do NOT cap the SVG's OWN height: a max-height on a width:100%,
     height:auto SVG creates a width↔height feedback loop that (a) shrinks the
     figure well below the column width and (b) re-solves every frame while a
     scene animatic toggles element opacity → the "too small + size keeps
     growing/shrinking" bug.
     Instead cap the CONTAINER's height and clip: the SVG still computes its size
     as width:100%/height:auto (full width, no jitter — the container cap doesn't
     feed back into the SVG's layout), and the container just trims any vertical
     overflow. This bounds the figure's vertical footprint so a figure + its body
     text both fit the fold, without squeezing the figure narrow. contain:layout
     isolates the animatic's reflow so its opacity steps can't jitter the box. */
  .pageart{margin:4px 0 18px;max-height:48vh;overflow:hidden;flex:0 0 auto}
  /* a beat MOTIF is a small supporting intuition icon, not the star of the slide
     (the text/card is). Shrink it by MAX-WIDTH (aspect-ratio preserved, whole
     icon stays visible — no clipping) rather than capping the container height,
     which would crop the motif's caption. Safe here because motifs are static
     (no animation → no width↔height reflow jitter). Structured figures
     (scene/sequence/compare) keep the larger 48vh container cap above. */
  .pageart:has(.figmotif){max-height:none;overflow:visible}
  .figmotif{max-width:320px;margin:0 auto}
  /* a scene animatic has interactive controls (▶Play) + caption BELOW the svg —
     don't clip those away; let the scene slide use its natural height (it's the
     cold-open, rarely paired with long body text). */
  .pageart:has(.figscene){max-height:none;overflow:visible}
  .pageart svg{width:100%;height:auto;display:block;contain:layout}
  .pageart .figscenewrap{contain:layout}
  .pageart .figsvg{border-radius:12px;border:1px solid var(--line);background:#0a0d13}
  .pageart .figmotif{border:1px solid var(--line)}
  .pagebeat{display:inline-block;font-size:11px;letter-spacing:.24em;text-transform:uppercase;
        color:var(--dim);border:1px solid var(--line);border-radius:99px;padding:3px 12px;margin-bottom:6px}
  .page.dark .pagebeat{color:var(--bad);border-color:#3b2f2f}
  .page.reveal-page .pagebeat{color:var(--c2);border-color:var(--c2)}
  .pagebody{font-size:16px}
  /* When a slide carries BOTH a figure and prose, the figure is the idea and the
     prose is its support (one screen = one idea): tighten the body so the pair
     stays inside the fold rather than reading as a second block. */
  .page:has(.pageart svg) .pagebody{font-size:15px;color:var(--dim);max-width:60ch;margin:0 auto}
  .page:has(.pageart svg) .pagebody b,.page:has(.pageart svg) .pagebody code{color:var(--ink)}
  /* flip controls */
  .flipbar{position:fixed;bottom:0;left:0;right:0;height:56px;display:flex;align-items:center;
        justify-content:center;gap:18px;background:linear-gradient(0deg,var(--bg),transparent);z-index:40}
  .flipbtn{padding:9px 20px;border-radius:99px;border:1px solid var(--line);background:var(--panel2);
        color:var(--ink);font:inherit;font-size:14px;cursor:pointer;transition:transform .08s,border-color .2s}
  .flipbtn:hover:not(:disabled){transform:translateY(-2px);border-color:var(--accent)}
  .flipbtn:disabled{opacity:.35;cursor:not-allowed}
  .flipbtn.locked{border-color:var(--accent);color:var(--accent);background:#171408}
  .pageno{font-size:12px;color:var(--dim);letter-spacing:.14em;min-width:74px;text-align:center}
  /* left/right invisible tap-zones for click-to-flip */
  .tapzone{position:fixed;top:0;bottom:56px;width:22%;z-index:30;cursor:pointer}
  .tapzone.left{left:0}.tapzone.right{right:0}
  body:not(.book) .flipbar,body:not(.book) .tapzone{display:none}
  /* progress rail */
  .progress{position:fixed;top:0;left:0;right:0;height:3px;background:transparent;z-index:50}
  .progress .fill{height:100%;width:0;background:linear-gradient(90deg,var(--accent),var(--accent2));
       transition:width .4s cubic-bezier(.4,0,.2,1);box-shadow:0 0 8px rgba(255,209,102,.5)}
  .gatehint{font-size:12px;color:var(--dim);text-align:center;margin-top:6px}
  @media (prefers-reduced-motion: reduce){
    body.book .deck .page,body.book .deck .coverpage,.flipbtn,.progress .fill{transition:none}
  }
  @media (max-width:520px){ .page{padding:20px 18px 28px} .tapzone{width:26%} }
${FIGURE_CSS}
</style>`;

/**
 * Render an EpisodeSpec to a full HTML document.
 * @param spec validated episode spec
 * @param lm learner model for concept-depth personalization (optional; default = cold)
 */
export function renderEpisode(spec: EpisodeSpec, lm: LearnerModel = EMPTY_LM): string {
  // assign a stable bubble color class per cast member (order-based)
  (spec.cast ?? []).forEach((c, i) => { CAST_CLASS[c.id] = `c${i % 4}`; });

  const conceptById = new Map(spec.concepts.map((c) => [c.id, c] as const));
  const gateIndex = spec.panels.findIndex((p) => p.beat === "prediction");

  // Page image policy: EVERY slide carries one intuition image. A real
  // structured figure always wins; when a panel has no figure, it falls back to
  // a deterministic per-beat motif (hand-drawn SVG, D-004 — never AI pixels, so
  // nothing garbles). beatMotif() has a builder for every beat and falls back to
  // a neutral motif for unknown beats, so this never renders an empty art slot.
  // (Supersedes the earlier "narrative beats stay text-only" rule — the user now
  // wants one intuition image per slide, not just on incident/reveal.)
  const pageArt = (p: Panel): string => {
    const art = p.figure ? renderFigure(p.figure) : beatMotif(p.beat);
    return art ? `<div class="pageart">${art}</div>` : "";
  };
  // wrap any block as a full comic page with a beat label + image on top
  const asPage = (p: Panel, inner: string, extraCls = ""): string => {
    const dark = p.beat === "cold-open" || p.beat === "incident" ? " dark" : "";
    const rev = p.beat === "reveal" ? " reveal-page" : "";
    const extra = extraCls ? ` ${extraCls}` : ""; // keep the class list space-separated
    return `<section class="page${dark}${rev}${extra}">
  <span class="pagebeat">${esc(beatLabel(p.beat))}</span>
  ${pageArt(p)}
  <div class="pagebody">${inner}</div>
</section>`;
  };

  const preGate: string[] = [];
  const postGate: string[] = [];
  let gatePage = "";

  spec.panels.forEach((p, i) => {
    let page = "";
    switch (p.beat) {
      case "concept-intro": {
        const c = p.concept_ref ? conceptById.get(p.concept_ref) : undefined;
        if (!c) return;
        const shown = lm.concepts[c.id]?.shown ?? 0;
        page = asPage(p, renderConceptIntro(c, conceptDepth(lm, c.id), shown));
        break;
      }
      case "prediction": {
        const q = p.prediction!;
        const gate = `
<section class="gate" id="gate">
  <div class="tag">🔮 your call — before the reveal</div>
  <h3>${md(q.question)}</h3>
${renderPrediction(q, "gate")}
  <div class="locknote" id="gate-lock">⬩ the reveal unlocks when you commit to a diagnosis ⬩</div>
</section>`;
        // The gate is interactive and its question can run long; never clip an
        // option out of reach. Opt into the .longform scroll escape hatch.
        gatePage = asPage(p, gate, "longform");
        return;
      }
      case "ratification": {
        page = asPage(p, renderRatification(spec, p), "longform");
        break;
      }
      case "teaser":
        return; // handled as its own page at the end
      default: {
        const inner = termLink(
          p.speaker ? renderBubble(spec, p) : (p.body ? `<p>${md(p.body)}</p>` : ""),
          spec.concepts,
        );
        const codeHtml = p.code ? renderCode(p.code) : "";
        // Slide discipline: a code exhibit is often taller than the fold. When a
        // panel carries code, it's a genuine long-form slide → opt into the
        // .longform scroll escape hatch (the ONE sanctioned scrollbar). Beats
        // without code stay fit-or-split (default clip).
        page = asPage(p, `${inner}${codeHtml}`, p.code ? "longform" : "");
        break;
      }
    }
    if (gateIndex >= 0 && i > gateIndex) postGate.push(page);
    else preGate.push(page);
  });

  const quizPages = renderQuizPages(spec); // one slide per question + scorecard slide
  const mapHtml = renderMap(spec);
  const teaserPanel = spec.panels.find((p) => p.beat === "teaser");
  const teaserBody = spec.teaser ?? teaserPanel?.body;
  // dedicated end pages (map / teaser) — each is its own page
  const mapPage = mapHtml ? `<section class="page">${mapHtml}</section>` : "";
  const teaserPage = teaserBody
    ? `<section class="page"><div class="pageart">${beatMotif("teaser")}</div>
<p class="teaser"><span class="next">next episode</span><br>${md(teaserBody)}</p></section>`
    : "";

  const metaLinks = (spec.source.urls ?? [])
    .map((u) => {
      const label = /issues\//.test(u)
        ? `issue #${spec.source.issue_numbers?.[0] ?? ""}`
        : /pull\//.test(u)
          ? `PR #${spec.source.pr_number ?? ""}`
          : "source";
      return `<a href="${esc(u)}">${esc(label)}</a>`;
    })
    .join(" · ");
  const merged = spec.source.merged_at ? ` · merged ${esc(spec.source.merged_at.slice(0, 10))}` : "";

  // cover page = the title/logline/meta + a cold-open motif, flip 1 of N
  const coverPage = `
<section class="coverpage">
  <header>
  <div class="series">human-mem · ${esc(spec.source.repo ?? spec.source.kind)} · ${esc(spec.id.split("-").slice(-2).join(" "))}</div>
  <h1>${esc(spec.title)}</h1>
  ${spec.logline ? `<p class="logline">${esc(spec.logline)}</p>` : ""}
  <div class="meta">${metaLinks}${merged}</div>
  </header>
  <div class="cover-motif">${beatMotif("cold-open")}</div>
</section>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(spec.title)} · human-mem</title>
${STYLE}
</head>
<body>
<div class="progress" aria-hidden="true"><div class="fill"></div></div>
<div class="deck">
${coverPage}
${preGate.join("\n")}
${gatePage}
<div id="after-gate">
${postGate.join("\n")}
${quizPages.join("\n")}
${mapPage}
${teaserPage}
</div>
</div>
<div class="tapzone left" id="tap-prev" aria-hidden="true"></div>
<div class="tapzone right" id="tap-next" aria-hidden="true"></div>
<div class="flipbar">
  <button class="flipbtn" id="prev" type="button" disabled>← Prev</button>
  <span class="pageno" id="pageno">1 / 1</span>
  <button class="flipbtn" id="next" type="button">Next →</button>
</div>
${renderScript(spec)}
</body>
</html>`;
}

function renderRatification(spec: EpisodeSpec, p: Panel): string {
  // Use the first decision (if any) to derive uphold/overturn notes; fall back to generic.
  const d = spec.decisions?.[0];
  const upholdNote = d ? `The maintainer chose this: ${d.because}` : "Recorded.";
  const overturnNote = d ? `Defensible — you'd take '${d.over}' instead. Trade-off: ${d.because} Your ruling is recorded.` : "Your ruling is recorded.";
  return `
<section class="ratify" id="ratify">
  <div class="tag">⚖ ratify the call</div>
  <p style="margin:8px 0 2px">${md(p.body)}</p>
  <div class="btns">
    <button data-v="uphold" data-note="${esc(upholdNote)}">Uphold</button>
    <button data-v="overturn" data-note="${esc(overturnNote)}">Overturn</button>
  </div>
  <div class="note" id="ratify-note"></div>
</section>`;
}

/**
 * Render the quiz as ONE SLIDE PER QUESTION (slide discipline:
 * one screen = one idea; the old whole-quiz-in-one-section always overflowed
 * into a scroll box). Returns an array of page-strings: an intro/lead framing
 * on the first question, each `.q` in its own `.page`, then a dedicated
 * scorecard page. Empty array when the spec has no quiz.
 */
function renderQuizPages(spec: EpisodeSpec): string[] {
  if (!spec.quiz.length) return [];
  const pages = spec.quiz.map((q, i) => {
    const opts = q.options.map((o) => `    <button class="opt" data-k="${esc(o.id)}">${md(o.text)}</button>`).join("\n");
    const lead = i === 0
      ? `<span class="pagebeat">can you still decide?</span>
  <p class="quizlead">Decisions this episode should have equipped you for. No score kept against you — only for you.</p>`
      : "";
    return `<section class="page quizpage">
  ${lead}
  <div class="quiz">
  <div class="q" data-q="q${i + 1}">
    <h4><span class="qnum">Q${i + 1} / ${spec.quiz.length}</span> ${md(q.question)}</h4>
${opts}
    <div class="fb"></div>
  </div>
  </div>
</section>`;
  });
  // dedicated scorecard slide (keeps the class="scorecard" structural needle)
  pages.push(`<section class="page">
<section class="scorecard" id="scorecard">
  <div>episode complete</div>
  <div class="big" id="score">–</div>
  <div id="score-note" style="color:var(--dim);font-size:14px"></div>
</section></section>`);
  return pages;
}

function renderMap(spec: EpisodeSpec): string {
  if (!spec.map_updates.length) return "";
  const items = spec.map_updates.map((m) => `    <li><b>${esc(m.area)}</b> — ${md(m.note)}</li>`).join("\n");
  return `
<section class="mapbox">
  <span class="tag">🗺 the map grows</span>
  <ul>
${items}
  </ul>
</section>`;
}
