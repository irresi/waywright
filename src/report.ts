import type { ActuatorResult } from "./actuator";
import type { EngineeringMemoryRecord, NavigationResult } from "./types";

export interface WaywrightReportModel {
  navigation: NavigationResult;
  actuation?: ActuatorResult;
  memoryWritten?: EngineeringMemoryRecord;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeWebUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? escapeHtml(value) : undefined;
  } catch {
    return undefined;
  }
}

function empty(message: string): string {
  return `<p class="empty-state">${escapeHtml(message)}</p>`;
}

function memoryMatches(value: string, memory: EngineeringMemoryRecord[]): string {
  return escapeHtml(JSON.stringify(memory.filter(item => value.includes(item.id)).map(item => item.id)));
}

function evidenceRow(value: string, memory: EngineeringMemoryRecord[], meta?: string): string {
  return `<div class="support-row evidence-copy" data-memory-ids="${memoryMatches(value, memory)}">
    ${meta ? `<span class="support-meta">${escapeHtml(meta)}</span>` : ""}
    <span>${escapeHtml(value)}</span>
  </div>`;
}

function renderMemoryRail(memory: EngineeringMemoryRecord[]): string {
  if (memory.length === 0) return empty("No prior memory. First run starts from current evidence.");
  return `<div class="memory-list">${memory.map(item => `<button class="memory-row" type="button" data-memory-id="${escapeHtml(item.id)}" aria-pressed="false">
    <span class="memory-row-top"><span class="memory-id">${escapeHtml(item.id)}</span><span class="state state-${escapeHtml(item.outcome.status)}">${escapeHtml(item.outcome.status)}</span></span>
    <strong>${escapeHtml(item.selectedDirection)}</strong>
    <span class="memory-outcome">${escapeHtml(item.outcome.summary)}</span>
  </button>`).join("")}</div>`;
}

function renderCandidates(navigation: NavigationResult): string {
  if (navigation.candidates.length === 0) return empty("No candidate directions were recorded.");
  const rejectionById = new Map(navigation.decision.rejected.map(item => [item.id, item.reason]));
  return navigation.candidates.map((candidate, index) => {
    const selected = candidate.id === navigation.decision.selectedId;
    const criteria = candidate.acceptanceCriteria.length > 0
      ? `<ul class="criteria">${candidate.acceptanceCriteria.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : empty("No acceptance criteria recorded.");
    const rejection = rejectionById.get(candidate.id);
    return `<article class="candidate ${selected ? "selected" : "rejected"}" data-path="${selected ? "selected" : "rejected"}">
      <div class="candidate-index">0${index + 1}</div>
      <div class="candidate-body">
        <div class="candidate-heading"><h3>${escapeHtml(candidate.title)}</h3>${selected ? '<span class="selection-mark">SELECTED</span>' : ""}</div>
        <p>${escapeHtml(candidate.hypothesis)}</p>
        ${selected ? `<div class="acceptance"><span class="section-label">ACCEPTANCE CRITERIA</span>${criteria}</div>` : `<div class="rejection"><span class="section-label">REJECTED</span><span>${escapeHtml(rejection ?? "No rejection reason recorded.")}</span></div>`}
      </div>
    </article>`;
  }).join("");
}

function renderCurrentEvidence(navigation: NavigationResult): string {
  const rows = [
    ...navigation.decision.evidence.map(item => evidenceRow(item, navigation.memory, "DECISION")),
    ...navigation.context.map(item => evidenceRow(item.evidence, navigation.memory, item.source)),
  ];
  return rows.length > 0 ? rows.join("") : empty("No supporting evidence was recorded.");
}

function renderPriorArt(navigation: NavigationResult): string {
  if (navigation.priorArt.length === 0) return empty("No prior-art decisions were recorded.");
  return navigation.priorArt.map(item => {
    const searchable = `${item.decision} ${item.why} ${item.repo}`;
    return `<div class="prior-art evidence-copy" data-memory-ids="${memoryMatches(searchable, navigation.memory)}">
      <span class="repo-provenance">${escapeHtml(item.repo)}</span>
      <strong>${escapeHtml(item.decision)}</strong>
      <span>${escapeHtml(item.why)}</span>
    </div>`;
  }).join("");
}

function buildLink(number: number, webUrl: string): string {
  const href = safeWebUrl(webUrl);
  const label = `Build #${number}`;
  return href
    ? `<a href="${href}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`
    : `<span>${escapeHtml(label)}</span>`;
}

function timelineRow(options: { sponsor?: string; title: string; detail: string; state: string; extraClass?: string }): string {
  return `<li class="timeline-row ${options.extraClass ?? ""}">
    <span class="timeline-node state-${escapeHtml(options.state)}"></span>
    <div class="timeline-content">
      <div class="timeline-heading">${options.sponsor ? `<span class="sponsor">${escapeHtml(options.sponsor)}</span>` : ""}<strong>${options.title}</strong></div>
      <span>${escapeHtml(options.detail)}</span>
    </div>
  </li>`;
}

function renderExecution(actuation?: ActuatorResult): string {
  if (!actuation) {
    return `<ol class="timeline">
      ${timelineRow({ title: "Implementation", detail: "Awaiting actuation.", state: "pending" })}
      ${timelineRow({ sponsor: "BUILDKITE", title: "Build", detail: "Pending implementation.", state: "pending" })}
      ${timelineRow({ sponsor: "POMERIUM", title: "Policy gate", detail: "Not requested.", state: "pending" })}
      ${timelineRow({ title: "Merge", detail: "Pending policy decision.", state: "pending" })}
    </ol>`;
  }

  const rows = [timelineRow({ title: "Implementation", detail: actuation.branch, state: "passed" })];
  if (actuation.builds.length === 0) {
    rows.push(timelineRow({ sponsor: "BUILDKITE", title: "Build", detail: "No build was recorded.", state: "pending" }));
  } else {
    actuation.builds.forEach((build, index) => {
      rows.push(`<li class="timeline-row">
        <span class="timeline-node state-${escapeHtml(build.state)}"></span>
        <div class="timeline-content">
          <div class="timeline-heading"><span class="sponsor">BUILDKITE</span><strong>${buildLink(build.number, build.webUrl)}</strong></div>
          <span>${escapeHtml(build.state)}</span>
        </div>
      </li>`);
      if (index < actuation.iterations) {
        rows.push(timelineRow({ title: `Correction ${index + 1}`, detail: `Self-correction iteration ${index + 1}.`, state: "corrected", extraClass: "correction-row" }));
      }
    });
  }

  if (actuation.status === "merged") {
    rows.push(timelineRow({ sponsor: "POMERIUM", title: "Policy gate", detail: actuation.pr === undefined ? "Allowed." : `Allowed PR #${actuation.pr}.`, state: "passed" }));
    rows.push(timelineRow({ title: "Merge", detail: actuation.pr === undefined ? "Merged." : `Merged PR #${actuation.pr}.`, state: "passed" }));
  } else if (actuation.status === "denied") {
    rows.push(timelineRow({ sponsor: "POMERIUM", title: "Policy gate", detail: actuation.reason ?? "Denied without a recorded reason.", state: "denied" }));
    rows.push(timelineRow({ title: "Merge", detail: "Blocked by policy.", state: "pending" }));
  } else {
    rows.push(timelineRow({ sponsor: "POMERIUM", title: "Policy gate", detail: "Not reached; correction budget exhausted.", state: "pending" }));
    rows.push(timelineRow({ title: "Merge", detail: "Not attempted.", state: "pending" }));
  }
  return `<ol class="timeline">${rows.join("")}</ol>`;
}

function renderMemoryWritten(memory?: EngineeringMemoryRecord): string {
  if (!memory) return empty("Written after execution completes.");
  const rejected = memory.rejected.length > 0
    ? `<ul>${memory.rejected.map(item => `<li><strong>${escapeHtml(item.direction)}</strong> — ${escapeHtml(item.reason)}</li>`).join("")}</ul>`
    : empty("No rejected alternatives were recorded.");
  const lessons = memory.lessons.length > 0
    ? `<ul>${memory.lessons.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : empty("No lessons were recorded.");
  const outcomeUrl = memory.outcome.buildUrl ? safeWebUrl(memory.outcome.buildUrl) : undefined;
  return `<div class="written-grid">
    <div><span class="section-label">DECISION / ${escapeHtml(memory.id)}</span><h3>${escapeHtml(memory.selectedDirection)}</h3><p>${escapeHtml(memory.rationale)}</p></div>
    <div><span class="section-label">REJECTED ALTERNATIVES</span>${rejected}</div>
    <div><span class="section-label">OUTCOME / ${escapeHtml(memory.outcome.status)}</span><p>${escapeHtml(memory.outcome.summary)}</p>${outcomeUrl ? `<a href="${outcomeUrl}" target="_blank" rel="noreferrer">Open final build</a>` : ""}</div>
    <div><span class="section-label">LESSONS FOR NEXT RUN</span>${lessons}</div>
  </div>`;
}

export function renderWaywrightReport(model: WaywrightReportModel): string {
  const { actuation, memoryWritten } = model;
  // Normalize: tolerate navigation.json written before the memory field existed.
  const navigation = { ...model.navigation, memory: model.navigation.memory ?? [] };
  const runStatus = actuation?.status.toUpperCase() ?? "NAVIGATED";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Waywright / Run Record</title>
  <style>
    :root { color-scheme: dark; --bg: #11110f; --surface: #181814; --surface-raised: #20201b; --ink: #f2efe6; --muted: #969385; --accent: #f0a83b; --success: #6fbd83; --danger: #e06a55; --border: #343329; --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    html { background: var(--bg); color: var(--ink); }
    body { margin: 0; min-width: 320px; background: var(--bg); font-family: var(--sans); font-size: 14px; line-height: 1.5; }
    button, a { font: inherit; }
    a { color: var(--ink); text-underline-offset: 3px; }
    a:hover { color: var(--accent); }
    button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .topbar { position: sticky; z-index: 20; top: 0; min-height: 58px; display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 10px 20px; border-bottom: 1px solid var(--border); background: #11110f; }
    .brand { display: flex; align-items: baseline; gap: 16px; }
    .wordmark, .section-label, .memory-id, .state, .candidate-index, .selection-mark, .sponsor, .repo-provenance, .run-status { font-family: var(--mono); letter-spacing: .08em; text-transform: uppercase; }
    .wordmark { font-size: 13px; font-weight: 700; }
    .tagline { color: var(--muted); font-size: 12px; }
    .run-status { border-left: 3px solid var(--accent); padding: 4px 0 4px 10px; font-size: 12px; }
    .run-status.status-merged { border-color: var(--success); }
    .run-status.status-denied, .run-status.status-exhausted { border-color: var(--danger); }
    .workspace { display: grid; grid-template-columns: 260px minmax(420px, 1fr) 300px; gap: 16px; align-items: start; padding: 16px 20px; }
    .rail, .decision-panel { min-width: 0; }
    .rail { position: sticky; top: 74px; max-height: calc(100vh - 90px); overflow: auto; border: 1px solid var(--border); background: var(--surface); }
    .rail-header { padding: 13px 14px; border-bottom: 1px solid var(--border); }
    .rail-header h2, .section-head h2 { margin: 0; font-family: var(--mono); font-size: 12px; letter-spacing: .08em; }
    .memory-list { display: grid; }
    .memory-row { width: 100%; display: grid; gap: 7px; padding: 13px 14px; border: 0; border-bottom: 1px solid var(--border); background: transparent; color: var(--ink); text-align: left; cursor: pointer; }
    .memory-row:hover, .memory-row[aria-pressed="true"] { background: var(--surface-raised); }
    .memory-row[aria-pressed="true"] { box-shadow: inset 3px 0 var(--accent); }
    .memory-row-top, .candidate-heading, .timeline-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .memory-id, .state { font-size: 10px; }
    .memory-outcome { color: var(--muted); font-size: 12px; }
    .state-passed, .state-merged { color: var(--success); }
    .state-failed, .state-failing, .state-denied, .state-exhausted, .state-canceled { color: var(--danger); }
    .state-running, .state-scheduled, .state-pending, .state-unknown { color: var(--muted); }
    .decision-panel { display: grid; gap: 16px; }
    .goal-block { padding: 16px 18px; border-top: 2px solid var(--ink); border-bottom: 1px solid var(--border); }
    .goal-block h1 { max-width: 850px; margin: 7px 0 0; font-size: clamp(22px, 2.1vw, 32px); font-weight: 560; line-height: 1.22; letter-spacing: -.02em; }
    .command-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 0 2px; }
    .command-group { display: flex; gap: 8px; }
    .command { min-height: 34px; padding: 7px 11px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--ink); cursor: pointer; font-family: var(--mono); font-size: 11px; text-transform: uppercase; }
    .command:hover, .command[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
    .candidate-stack { display: grid; gap: 8px; }
    .candidate { display: grid; grid-template-columns: 42px 1fr; border: 1px solid var(--border); background: var(--surface); transition: opacity 150ms ease; }
    .candidate.selected { border-left: 3px solid var(--accent); background: var(--surface-raised); }
    .candidate-index { display: flex; justify-content: center; padding-top: 15px; border-right: 1px solid var(--border); color: var(--muted); font-size: 10px; }
    .candidate-body { min-width: 0; padding: 14px 16px; }
    .candidate h3, .written-grid h3 { margin: 0; font-size: 16px; }
    .candidate p { margin: 6px 0; color: var(--muted); }
    .selection-mark { padding: 2px 6px; border: 1px solid var(--accent); color: var(--accent); font-size: 9px; }
    .rejection { display: grid; grid-template-columns: 94px 1fr; gap: 10px; margin-top: 10px; padding-top: 9px; border-top: 1px solid var(--border); color: var(--danger); font-size: 12px; }
    .section-label { color: var(--muted); font-size: 10px; }
    .acceptance { margin-top: 13px; padding-top: 11px; border-top: 1px solid var(--border); }
    .criteria { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 18px; margin: 8px 0 0; padding-left: 17px; }
    .criteria li::marker { color: var(--accent); }
    .focus-selected .candidate.rejected { opacity: .2; }
    .support-section { border: 1px solid var(--border); background: var(--surface); }
    .section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 14px; border-bottom: 1px solid var(--border); }
    .rationale { margin: 0; padding: 15px 16px; border-bottom: 1px solid var(--border); font-size: 16px; }
    .support-list { display: grid; }
    .support-row { display: grid; grid-template-columns: 90px 1fr; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--border); transition: background-color 120ms ease, box-shadow 120ms ease; }
    .support-row:last-child { border-bottom: 0; }
    .support-meta { overflow: hidden; color: var(--muted); font-family: var(--mono); font-size: 10px; text-overflow: ellipsis; text-transform: uppercase; }
    .evidence-copy.memory-highlight { background: #2a261b; box-shadow: inset 3px 0 var(--accent); }
    .prior-art-list { display: grid; gap: 8px; padding: 12px; }
    .prior-art { display: grid; grid-template-columns: 120px minmax(120px, .7fr) 1fr; gap: 12px; padding: 10px; border-left: 2px solid var(--border); background: var(--surface-raised); }
    .repo-provenance { overflow-wrap: anywhere; color: var(--accent); font-size: 10px; }
    .execution-rail .rail-header { display: flex; justify-content: space-between; align-items: center; }
    .timeline { list-style: none; margin: 0; padding: 8px 14px 14px; }
    .timeline-row { position: relative; display: grid; grid-template-columns: 14px 1fr; gap: 9px; min-height: 64px; padding: 10px 0; }
    .timeline-row:not(:last-child)::after { content: ""; position: absolute; top: 29px; bottom: -11px; left: 5px; width: 1px; background: var(--border); }
    .timeline-node { z-index: 1; width: 11px; height: 11px; margin-top: 4px; border: 2px solid currentColor; border-radius: 50%; background: var(--surface); }
    .timeline-content { display: grid; align-content: start; gap: 5px; min-width: 0; }
    .timeline-content > span { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
    .timeline-heading { justify-content: flex-start; flex-wrap: wrap; }
    .sponsor { padding: 2px 5px; border: 1px solid var(--border); color: var(--muted); font-size: 8px; }
    .correction-row .timeline-content { padding-left: 8px; border-left: 2px solid var(--accent); }
    .state-corrected { color: var(--accent); }
    .memory-drawer { margin: 0 20px 20px; border: 1px solid var(--border); border-top: 3px solid var(--accent); background: var(--surface-raised); }
    .memory-drawer .section-head::after { content: "EXECUTION FEEDBACK → NEXT RECALL"; color: var(--accent); font-family: var(--mono); font-size: 9px; letter-spacing: .06em; }
    .written-grid { display: grid; grid-template-columns: 1.2fr 1fr 1fr 1.2fr; }
    .written-grid > div { min-width: 0; padding: 14px; border-right: 1px solid var(--border); }
    .written-grid > div:last-child { border-right: 0; }
    .written-grid p { margin: 7px 0; color: var(--muted); }
    .written-grid ul { margin: 8px 0 0; padding-left: 17px; }
    .written-grid li + li { margin-top: 5px; }
    .empty-state { margin: 0; padding: 14px; color: var(--muted); font-style: italic; }
    [data-replay-stage] { transition: opacity 150ms ease, transform 150ms ease; }
    .replay-hidden { opacity: .12; transform: translateY(5px); }
    @media (max-width: 1120px) {
      .workspace { grid-template-columns: 220px minmax(0, 1fr); }
      .execution-rail { position: static; grid-column: 1 / -1; max-height: none; }
      .timeline { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 8px; }
      .timeline-row { grid-template-columns: 14px 1fr; min-height: 0; padding: 10px; border: 1px solid var(--border); }
      .timeline-row::after { display: none; }
      .written-grid { grid-template-columns: repeat(2, 1fr); }
      .written-grid > div:nth-child(2) { border-right: 0; }
      .written-grid > div:nth-child(-n+2) { border-bottom: 1px solid var(--border); }
    }
    @media (max-width: 760px) {
      .topbar, .brand, .command-bar { align-items: flex-start; }
      .topbar, .command-bar { flex-direction: column; }
      .workspace { grid-template-columns: 1fr; padding: 12px; }
      .rail { position: static; max-height: none; }
      .memory-drawer { margin: 0 12px 12px; }
      .criteria, .written-grid { grid-template-columns: 1fr; }
      .written-grid > div { border-right: 0; border-bottom: 1px solid var(--border); }
      .written-grid > div:last-child { border-bottom: 0; }
      .prior-art { grid-template-columns: 1fr; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand"><span class="wordmark">WAYWRIGHT / RUN RECORD</span><span class="tagline">Give it a goal, not a ticket.</span></div>
    <span class="run-status status-${escapeHtml(actuation?.status ?? "navigated")}">${escapeHtml(runStatus)}</span>
  </header>
  <div id="report-root">
    <main class="workspace">
      <aside class="rail memory-rail" data-replay-stage="1" aria-labelledby="memory-heading">
        <header class="rail-header"><h2 id="memory-heading">RECALLED MEMORY</h2></header>
        ${renderMemoryRail(navigation.memory)}
      </aside>
      <section class="decision-panel" aria-labelledby="goal-heading">
        <div class="goal-block"><span class="section-label">GOAL</span><h1 id="goal-heading">${escapeHtml(navigation.goal)}</h1></div>
        <div class="command-bar">
          <span class="section-label">DECISION RECONSTRUCTION</span>
          <div class="command-group"><button id="focus-selected" class="command" type="button" aria-pressed="false">Focus selected</button><button id="replay-decision" class="command" type="button">Replay decision</button></div>
        </div>
        <div class="candidate-stack" data-replay-stage="2">${renderCandidates(navigation)}</div>
        <section class="support-section" data-replay-stage="3" aria-labelledby="rationale-heading">
          <header class="section-head"><h2 id="rationale-heading">SELECTED RATIONALE</h2><span class="selection-mark">${escapeHtml(navigation.selected.title)}</span></header>
          <p class="rationale">${escapeHtml(navigation.decision.rationale)}</p>
          <div class="support-list">${renderCurrentEvidence(navigation)}</div>
        </section>
        <section class="support-section" data-replay-stage="3" aria-labelledby="prior-art-heading">
          <header class="section-head"><h2 id="prior-art-heading">PRIOR-ART DECISIONS</h2><span class="section-label">REPOSITORY PROVENANCE</span></header>
          <div class="prior-art-list">${renderPriorArt(navigation)}</div>
        </section>
      </section>
      <aside class="rail execution-rail" data-replay-stage="4" aria-labelledby="execution-heading">
        <header class="rail-header"><h2 id="execution-heading">EXECUTION TRACE</h2><span class="state state-${escapeHtml(actuation?.status ?? "pending")}">${escapeHtml(actuation?.status ?? "pending")}</span></header>
        ${renderExecution(actuation)}
      </aside>
    </main>
    <section class="memory-drawer" data-replay-stage="5" aria-labelledby="written-heading">
      <header class="section-head"><h2 id="written-heading">MEMORY WRITTEN</h2></header>
      ${renderMemoryWritten(memoryWritten)}
    </section>
  </div>
  <script>
    (() => {
      const root = document.getElementById("report-root");
      const focusButton = document.getElementById("focus-selected");
      const replayButton = document.getElementById("replay-decision");
      const memoryButtons = Array.from(document.querySelectorAll("[data-memory-id]"));
      const evidenceRows = Array.from(document.querySelectorAll(".evidence-copy"));
      let focused = false;
      let activeMemory = null;
      let replayTimers = [];

      focusButton.addEventListener("click", () => {
        focused = !focused;
        root.classList.toggle("focus-selected", focused);
        focusButton.setAttribute("aria-pressed", String(focused));
        focusButton.textContent = focused ? "Show all" : "Focus selected";
      });

      memoryButtons.forEach(button => button.addEventListener("click", () => {
        const id = button.dataset.memoryId;
        activeMemory = activeMemory === id ? null : id;
        memoryButtons.forEach(item => item.setAttribute("aria-pressed", String(item.dataset.memoryId === activeMemory)));
        evidenceRows.forEach(row => {
          let ids = [];
          try { ids = JSON.parse(row.dataset.memoryIds || "[]"); } catch { ids = []; }
          row.classList.toggle("memory-highlight", activeMemory !== null && ids.includes(activeMemory));
        });
      }));

      replayButton.addEventListener("click", () => {
        replayTimers.forEach(timer => clearTimeout(timer));
        replayTimers = [];
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const stages = [1, 2, 3, 4, 5];
        const elements = stages.map(stage => Array.from(document.querySelectorAll('[data-replay-stage="' + stage + '"]')));
        elements.flat().forEach(element => { element.classList.add("replay-hidden"); element.setAttribute("aria-hidden", "true"); });
        if (reduced) {
          elements.flat().forEach(element => { element.classList.remove("replay-hidden"); element.removeAttribute("aria-hidden"); });
          return;
        }
        elements.forEach((group, index) => {
          const timer = window.setTimeout(() => group.forEach(element => {
            element.classList.remove("replay-hidden");
            element.removeAttribute("aria-hidden");
          }), 90 + index * 180);
          replayTimers.push(timer);
        });
      });
    })();
  </script>
</body>
</html>`;
}
