const n=`<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{{title}}</title>
    <style>
      :root {
        color-scheme: light dark;
        --surface: white;
        --paper: #f8faf9;
        --danger: #a34343;
        --text: #22302b;
        --muted: #65736c;
        --border: #d6ddd9;
        --grid: #e9edea;
        --accent: #33695a;
        --selected: #e8f2ed;
        font:
          14px system-ui,
          -apple-system,
          BlinkMacSystemFont,
          "Noto Sans JP",
          sans-serif;
        color: var(--text);
        background: var(--surface);
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        height: 100vh;
        height: 100dvh;
        display: flex;
        flex-direction: column;
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 8px 16px;
        border-bottom: 1px solid var(--border);
      }
      h1,
      h2 {
        margin: 0;
        font-size: 16px;
      }
      h1 {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      button {
        font: inherit;
        color: inherit;
        background: transparent;
        border: 0;
        cursor: pointer;
      }
      button:hover {
        background: var(--selected);
      }
      :focus-visible {
        outline: 2px solid #247cbe;
        outline-offset: -2px;
      }
      .controls {
        display: flex;
        align-items: center;
        gap: 2px;
        flex: none;
      }
      .controls button {
        height: 32px;
        min-width: 32px;
        border-radius: 4px;
      }
      output {
        min-width: 4ch;
        text-align: center;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        color: var(--muted);
      }
      main {
        flex: 1;
        min-height: 0;
        display: flex;
      }
      #stage {
        flex: 1;
        min-width: 0;
        min-height: 0;
        background-color: var(--paper);
        background-image:
          linear-gradient(var(--grid) 1px, transparent 1px),
          linear-gradient(90deg, var(--grid) 1px, transparent 1px);
        background-size: 24px 24px;
        touch-action: none;
        user-select: none;
        cursor: grab;
      }
      #stage:active {
        cursor: grabbing;
      }
      svg {
        display: block;
        width: 100%;
        height: 100%;
      }
      svg > rect {
        display: none;
      }
      svg [data-memo] {
        cursor: pointer;
      }
      svg [aria-current="true"] > [data-node-shape] > path:first-child,
      svg [aria-current="true"] > rect {
        stroke: var(--accent);
        stroke-width: 3;
        vector-effect: non-scaling-stroke;
      }
      aside {
        width: clamp(260px, 28vw, 340px);
        overflow: auto;
        padding: 16px;
        border-left: 1px solid var(--border);
      }
      aside p {
        overflow-wrap: anywhere;
        color: var(--muted);
      }
      ul {
        list-style: none;
        margin: 12px 0 0;
        padding: 0;
      }
      li {
        border-top: 1px solid var(--border);
      }
      li button {
        display: block;
        width: 100%;
        padding: 12px 8px;
        text-align: left;
        overflow-wrap: anywhere;
        line-break: strict;
      }
      li [aria-current="true"] {
        background: var(--selected);
        box-shadow: inset 2px 0 var(--accent);
      }
      .row-heading {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
      }
      [data-status] {
        flex: none;
        font-size: 12px;
        color: var(--muted);
      }
      [data-status="decided"] {
        color: var(--accent);
      }
      [data-status="concern"] {
        color: var(--danger);
      }
      .memo-body {
        display: block;
        white-space: pre-wrap;
        margin-top: 6px;
        line-height: 1.65;
        font-size: 13px;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --surface: #1b2320;
          --paper: #131917;
          --text: #e2eae6;
          --muted: #9aa9a2;
          --border: #35433d;
          --grid: #212a26;
          --accent: #7cc4ae;
          --selected: #22382f;
          --danger: #ef8f8f;
        }
      }
      @media (max-width: 820px) {
        main {
          flex-direction: column;
        }
        header {
          padding-inline: 8px;
        }
        .controls button {
          min-width: 40px;
          height: 40px;
        }
        aside {
          width: 100%;
          max-height: 45%;
          border-left: 0;
          border-top: 1px solid var(--border);
          padding: 12px 16px;
        }
      }
    </style>
  </head>
  <body>
    <header>
      <h1>{{title}}</h1>
      <div class="controls" role="group" aria-label="図の表示">
        <button id="shrink" aria-label="縮小">−</button>
        <output aria-label="表示倍率"></output>
        <button id="enlarge" aria-label="拡大">＋</button>
        <button id="fit">全体を表示</button>
      </div>
    </header>
    <main>
      <section id="stage" tabindex="0" aria-label="図（矢印キーで移動）">
        {{diagram}}
      </section>
      <aside aria-labelledby="memo-heading">
        {{decisions}}
        <h2 id="memo-heading">メモの一覧</h2>
        {{memos}}
      </aside>
    </main>
    <script>
      const stage = document.getElementById("stage");
      const svg = stage.querySelector("svg");
      const [left, topY, width, height] = svg
        .getAttribute("viewBox")
        .split(" ")
        .map(Number);
      let cx = left + width / 2,
        cy = topY + height / 2;
      let scale = 1,
        fitted = true;

      function fitScale() {
        return Math.min(
          1,
          stage.clientWidth / width,
          stage.clientHeight / height,
        );
      }
      function draw() {
        if (!stage.clientWidth || !stage.clientHeight) return;
        if (fitted) scale = fitScale();
        const w = stage.clientWidth / scale,
          h = stage.clientHeight / scale;
        const x = cx - w / 2,
          y = cy - h / 2;
        svg.setAttribute("viewBox", [x, y, w, h].join(" "));
        // Keep the grid legible even when the whole drawing is very small.
        const step = 24 * scale * Math.max(1, Math.ceil(0.4 / scale));
        stage.style.backgroundSize = step + "px " + step + "px";
        stage.style.backgroundPosition = -x * scale + "px " + -y * scale + "px";
        document.querySelector("output").textContent =
          Math.round(scale * 100) + "%";
      }
      function zoom(factor, dx = 0, dy = 0) {
        const next = Math.min(
          8,
          Math.max(Math.min(fitScale(), 0.1), scale * factor),
        );
        cx += dx * (1 / scale - 1 / next);
        cy += dy * (1 / scale - 1 / next);
        scale = next;
        fitted = false;
        draw();
      }
      document.getElementById("enlarge").onclick = () => zoom(1.25);
      document.getElementById("shrink").onclick = () => zoom(1 / 1.25);
      document.getElementById("fit").onclick = () => {
        fitted = true;
        cx = left + width / 2;
        cy = topY + height / 2;
        draw();
      };
      stage.addEventListener(
        "wheel",
        (e) => {
          if (!e.deltaY) return;
          e.preventDefault();
          const rect = stage.getBoundingClientRect();
          zoom(
            e.deltaY < 0 ? 1.12 : 1 / 1.12,
            e.clientX - rect.left - rect.width / 2,
            e.clientY - rect.top - rect.height / 2,
          );
        },
        { passive: false },
      );

      let drag = null,
        moved = false;
      stage.onpointerdown = (e) => {
        if (e.button !== 0 || !e.isPrimary) return;
        moved = false;
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, cx, cy };
        // Keep a tap targeted at its figure while tracking a drag outside it.
        e.target.setPointerCapture(e.pointerId);
      };
      stage.onpointermove = (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        const dx = e.clientX - drag.x,
          dy = e.clientY - drag.y;
        if (!moved && Math.hypot(dx, dy) < 4) return;
        moved = true;
        fitted = false;
        cx = drag.cx - dx / scale;
        cy = drag.cy - dy / scale;
        draw();
      };
      stage.onlostpointercapture =
        stage.onpointercancel =
        stage.onpointerup =
          (e) => {
            if (drag?.id === e.pointerId) drag = null;
          };

      function select(item) {
        const index = item.dataset.memo;
        for (const el of document.querySelectorAll("[aria-current]"))
          el.removeAttribute("aria-current");
        for (const el of document.querySelectorAll(
          '[data-memo="' + index + '"]',
        ))
          el.setAttribute("aria-current", "true");
        if (stage.contains(item)) {
          document
            .querySelector('button[data-memo="' + index + '"]')
            .scrollIntoView({ block: "nearest" });
        } else {
          const box = svg
            .querySelector('[data-owner][data-memo="' + index + '"]')
            .getBBox();
          cx = box.x + box.width / 2;
          cy = box.y + box.height / 2;
          scale = Math.min(
            Math.max(1, scale),
            stage.clientWidth / (box.width + 32),
            stage.clientHeight / (box.height + 32),
          );
          fitted = false;
          draw();
        }
      }
      document.addEventListener("click", (e) => {
        const item = e.target.closest("[data-memo]");
        if (item && !(stage.contains(item) && moved && e.detail)) select(item);
      });
      stage.onkeydown = (e) => {
        const item = e.target.closest("[data-memo]");
        if (item && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          select(item);
          return;
        }
        const step = 48 / scale;
        switch (e.key) {
          case "ArrowLeft":
            cx -= step;
            break;
          case "ArrowRight":
            cx += step;
            break;
          case "ArrowUp":
            cy -= step;
            break;
          case "ArrowDown":
            cy += step;
            break;
          default:
            return;
        }
        e.preventDefault();
        fitted = false;
        draw();
      };
      draw();
      new ResizeObserver(draw).observe(stage);
    <\/script>
  </body>
</html>
`;export{n as default};
