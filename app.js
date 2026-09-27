(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const canvas = $("#canvas");
  const ctx = canvas.getContext("2d");
  const stage = $("#stage");

  // Scale slider is logarithmic between these bounds (1 = motif's natural pixel size).
  const SCALE_MIN = 0.02;
  const SCALE_MAX = 4;
  // Keep any single motif below this many device pixels on its longest side.
  const MAX_MOTIF_PX = 4096;

  const MODE_NAMES = { block: "Block", halfdrop: "Half-drop", brick: "Brick", tossed: "Tossed" };

  const state = {
    img: null,
    mode: "block",
    scale: 1,
    offset: 2,
    bg: "#f7f5f0",
    outline: true,
    toss: { density: 3, spacing: 1.4, vary: 0.15, rotate: "random", seed: 7 },
  };

  // ---------- Sample motif, so the tool opens with something to look at ----------
  function makeSample() {
    const c = document.createElement("canvas");
    c.width = 240;
    c.height = 240;
    const g = c.getContext("2d");
    g.lineCap = "round";

    // stem
    g.strokeStyle = "#3e6f55";
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(70, 215);
    g.bezierCurveTo(90, 160, 110, 120, 140, 80);
    g.stroke();

    // leaves
    const leaf = (x, y, rot, len) => {
      g.save();
      g.translate(x, y);
      g.rotate(rot);
      g.fillStyle = "#4f8a68";
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(len * 0.5, -len * 0.32, len, 0);
      g.quadraticCurveTo(len * 0.5, len * 0.32, 0, 0);
      g.fill();
      g.strokeStyle = "#2f5a44";
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(2, 0);
      g.lineTo(len * 0.85, 0);
      g.stroke();
      g.restore();
    };
    leaf(84, 180, -2.6, 58);
    leaf(95, 150, -0.5, 62);
    leaf(114, 118, -2.9, 50);

    // flower
    g.save();
    g.translate(146, 72);
    for (let i = 0; i < 6; i++) {
      g.rotate(Math.PI / 3);
      g.fillStyle = i % 2 ? "#e07a5f" : "#d4664b";
      g.beginPath();
      g.ellipse(0, -26, 15, 26, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "#f2c14e";
    g.beginPath();
    g.arc(0, 0, 14, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#b8862b";
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      g.beginPath();
      g.arc(Math.cos(a) * 7, Math.sin(a) * 7, 1.8, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();

    // berries
    g.fillStyle = "#3346c9";
    [[40, 60, 7], [26, 84, 5], [52, 88, 5.5]].forEach(([x, y, r]) => {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    });
    return c;
  }

  // ---------- Helpers ----------
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const sliderToScale = (v) => SCALE_MIN * Math.pow(SCALE_MAX / SCALE_MIN, v / 1000);
  const scaleToSlider = (s) =>
    Math.round((Math.log(s / SCALE_MIN) / Math.log(SCALE_MAX / SCALE_MIN)) * 1000);
  const natW = () => state.img.naturalWidth || state.img.width || 512;
  const natH = () => state.img.naturalHeight || state.img.height || 512;

  function clampScale(s) {
    const longest = Math.max(natW(), natH());
    const hardMax = MAX_MOTIF_PX / (longest * (window.devicePixelRatio || 1));
    return Math.max(SCALE_MIN, Math.min(SCALE_MAX, hardMax, s));
  }

  // ---------- Build the smallest canvas that repeats seamlessly ----------
  // `px` = device pixels per natural image pixel.
  function buildUnit(px) {
    const img = state.img;
    const w = Math.max(1, Math.round(natW() * px));
    const h = Math.max(1, Math.round(natH() * px));
    const n = state.offset;
    const unit = document.createElement("canvas");
    const g = unit.getContext("2d");
    g.imageSmoothingQuality = "high";

    if (state.mode === "block") {
      unit.width = w;
      unit.height = h;
      g.drawImage(img, 0, 0, w, h);
    } else if (state.mode === "halfdrop") {
      // n columns, each dropped by h/n more than the one before
      unit.width = w * n;
      unit.height = h;
      for (let i = 0; i < n; i++) {
        const y = Math.round((i * h) / n);
        g.drawImage(img, i * w, y, w, h);
        if (y > 0) g.drawImage(img, i * w, y - h, w, h);
      }
    } else if (state.mode === "brick") {
      // n rows, each shifted by w/n more than the one above
      unit.width = w;
      unit.height = h * n;
      for (let j = 0; j < n; j++) {
        const x = Math.round((j * w) / n);
        g.drawImage(img, x, j * h, w, h);
        if (x > 0) g.drawImage(img, x - w, j * h, w, h);
      }
    } else {
      // Tossed: jittered grid of rotated motifs, wrapped at the edges so the unit tiles.
      const t = state.toss;
      const cols = t.density;
      const cell = Math.round(Math.max(w, h) * t.spacing);
      const size = cell * cols;
      unit.width = size;
      unit.height = size;
      const rnd = mulberry32(t.seed);
      for (let r = 0; r < cols; r++) {
        for (let c = 0; c < cols; c++) {
          const cx = (c + 0.5) * cell + (rnd() - 0.5) * cell * 0.7 + (r % 2) * cell * 0.5;
          const cy = (r + 0.5) * cell + (rnd() - 0.5) * cell * 0.7;
          let rot = 0;
          const pick = rnd();
          if (t.rotate === "random") rot = pick * Math.PI * 2;
          else if (t.rotate === "quarter") rot = Math.floor(pick * 4) * (Math.PI / 2);
          else if (t.rotate === "flip") rot = pick < 0.5 ? 0 : Math.PI;
          const s = 1 + (rnd() * 2 - 1) * t.vary;
          for (const dx of [-size, 0, size]) {
            for (const dy of [-size, 0, size]) {
              g.save();
              g.translate(cx + dx, cy + dy);
              g.rotate(rot);
              g.scale(s, s);
              g.drawImage(img, -w / 2, -h / 2, w, h);
              g.restore();
            }
          }
        }
      }
    }
    return unit;
  }

  // ---------- Render the preview ----------
  let raf = 0;
  function schedule() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(render);
  }

  function render() {
    if (!state.img) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = stage.getBoundingClientRect();
    const cw = Math.max(1, Math.round(rect.width * dpr));
    const ch = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }

    const unit = buildUnit(state.scale * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = state.bg;
    ctx.fillRect(0, 0, cw, ch);

    // Centre one repeat unit in the view so its outline sits in the middle.
    const ox = Math.round((cw - unit.width) / 2);
    const oy = Math.round((ch - unit.height) / 2);
    const pat = ctx.createPattern(unit, "repeat");
    pat.setTransform(new DOMMatrix().translate(ox, oy));
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, cw, ch);

    if (state.outline) {
      ctx.save();
      ctx.lineWidth = Math.max(1, dpr);
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.strokeRect(ox + 0.5, oy + 0.5, unit.width - 1, unit.height - 1);
      ctx.lineDashOffset = 5 * dpr;
      ctx.strokeStyle = "rgba(20,24,40,0.85)";
      ctx.strokeRect(ox + 0.5, oy + 0.5, unit.width - 1, unit.height - 1);
      ctx.restore();
    }

    updateReadouts();
  }

  function fullUnitSize() {
    // Size of the repeat unit when the motif is at its natural size.
    const w = natW(), h = natH(), n = state.offset;
    if (state.mode === "halfdrop") return [w * n, h];
    if (state.mode === "brick") return [w, h * n];
    if (state.mode === "tossed") {
      const s = Math.round(Math.max(w, h) * state.toss.spacing) * state.toss.density;
      return [s, s];
    }
    return [w, h];
  }

  function updateReadouts() {
    const pct = state.scale * 100;
    $("#scaleOut").textContent = (pct < 10 ? pct.toFixed(1) : Math.round(pct)) + "%";
    $("#tileSize").textContent =
      `Motif on screen: ${Math.round(natW() * state.scale)} × ${Math.round(natH() * state.scale)} px`;
    const [uw, uh] = fullUnitSize();
    $("#unitSize").textContent = `Repeat unit at full size: ${uw} × ${uh} px`;

    let chip = MODE_NAMES[state.mode];
    if (state.mode === "halfdrop" || state.mode === "brick") chip += ` · 1/${state.offset} offset`;
    if (state.mode === "tossed") chip += ` · ${state.toss.density ** 2} motifs`;
    chip += ` · ${Math.round(pct)}%`;
    $("#chip").textContent = chip;
  }

  // ---------- Loading images ----------
  function setMotif(img, name) {
    state.img = img;
    $("#motifName").textContent = name;
    $("#motifMeta").textContent = `${natW()} × ${natH()} px`;
    $("#thumb").src = img instanceof HTMLCanvasElement ? img.toDataURL() : img.src;
    $("#thumb").alt = name;
    // Start new motifs at a size where several repeats are visible.
    state.scale = clampScale(220 / Math.max(natW(), natH()));
    $("#scale").value = scaleToSlider(state.scale);
    schedule();
  }

  function showError(msg) {
    const el = $("#error");
    el.textContent = msg;
    el.hidden = !msg;
  }

  function loadFile(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showError(`"${file.name}" isn't an image. Use a PNG, JPG, WebP or SVG file.`);
      return;
    }
    showError("");
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setMotif(img, file.name);
    img.onerror = () => showError(`Couldn't read "${file.name}". Try saving it as PNG or JPG.`);
    img.src = url;
  }

  // ---------- Controls ----------
  function selectRadio(buttons, active) {
    buttons.forEach((b) => b.setAttribute("aria-checked", String(b === active)));
  }

  const modeButtons = $$(".mode");
  modeButtons.forEach((btn) =>
    btn.addEventListener("click", () => {
      state.mode = btn.dataset.mode;
      selectRadio(modeButtons, btn);
      $("#offsetGroup").hidden = !(state.mode === "halfdrop" || state.mode === "brick");
      $("#offsetLabel").textContent = state.mode === "brick" ? "Row shift" : "Column drop";
      $("#tossGroup").hidden = state.mode !== "tossed";
      schedule();
    })
  );

  const offsetButtons = $$(".seg-btn");
  offsetButtons.forEach((btn) =>
    btn.addEventListener("click", () => {
      state.offset = Number(btn.dataset.offset);
      selectRadio(offsetButtons, btn);
      schedule();
    })
  );

  $("#scale").addEventListener("input", (e) => {
    state.scale = clampScale(sliderToScale(Number(e.target.value)));
    schedule();
  });

  $("#density").addEventListener("input", (e) => {
    state.toss.density = Number(e.target.value);
    $("#densityOut").textContent = state.toss.density ** 2;
    schedule();
  });
  $("#spacing").addEventListener("input", (e) => {
    state.toss.spacing = Number(e.target.value) / 100;
    $("#spacingOut").textContent = state.toss.spacing.toFixed(1) + "×";
    schedule();
  });
  $("#vary").addEventListener("input", (e) => {
    state.toss.vary = Number(e.target.value) / 100;
    $("#varyOut").textContent = "±" + e.target.value + "%";
    schedule();
  });
  $("#rotate").addEventListener("change", (e) => {
    state.toss.rotate = e.target.value;
    schedule();
  });
  $("#shuffle").addEventListener("click", () => {
    state.toss.seed = Math.floor(Math.random() * 1e9);
    schedule();
  });

  $("#bg").addEventListener("input", (e) => {
    state.bg = e.target.value;
    schedule();
  });
  $("#outline").addEventListener("change", (e) => {
    state.outline = e.target.checked;
    schedule();
  });

  $("#file").addEventListener("change", (e) => {
    loadFile(e.target.files[0]);
    e.target.value = "";
  });

  // Drag and drop anywhere on the page
  const overlay = $("#overlay");
  const dz = $("#dropzone");
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
  window.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    overlay.hidden = false;
    dz.classList.add("over");
  });
  window.addEventListener("dragover", (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) {
      overlay.hidden = true;
      dz.classList.remove("over");
    }
  });
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    overlay.hidden = true;
    dz.classList.remove("over");
    loadFile(e.dataTransfer.files[0]);
  });

  // Paste an image from the clipboard
  window.addEventListener("paste", (e) => {
    const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith("image/"));
    if (item) loadFile(item.getAsFile());
  });

  // ---------- Export ----------
  function download(c, filename) {
    c.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, "image/png");
  }
  const baseName = () => ($("#motifName").textContent.replace(/\.[^.]+$/, "") || "motif");

  $("#exportTile").addEventListener("click", () => {
    const unit = buildUnit(1); // full natural resolution
    const out = document.createElement("canvas");
    out.width = unit.width;
    out.height = unit.height;
    const g = out.getContext("2d");
    g.fillStyle = state.bg;
    g.fillRect(0, 0, out.width, out.height);
    g.drawImage(unit, 0, 0);
    download(out, `${baseName()}-${state.mode}-tile.png`);
  });

  $("#exportView").addEventListener("click", () => {
    const saved = state.outline;
    state.outline = false;
    render();
    download(canvas, `${baseName()}-${state.mode}-preview.png`);
    state.outline = saved;
    schedule();
  });

  // ---------- Start ----------
  new ResizeObserver(schedule).observe(stage);
  setMotif(makeSample(), "Sample motif");
})();
