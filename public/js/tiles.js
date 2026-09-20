// tiles.js
// A map that has no map. Every tile you see is worked out when you ask for it, from one small
// store of corner values and the arithmetic that says which corner is which. Nothing is kept
// between one tile and the next unless you switch the cache on to watch what it would cost.
//
// The store is a grid of corners. A point inside a square of four corners is a bilinear patch, and
// the only part of a bilinear patch that bends is the x times y term, so four numbers fix it
// completely. Which square a point falls in is a division. That is the whole method.

(function () {
  const $ = (id) => document.getElementById(id);
  const canvas = $("map");
  if (!canvas) return;
  const ctx = canvas.getContext("2d", { willReadFrequently: false });

  const TILE = 256;
  const M = 128;                       // patches across the world, so 129 by 129 corners
  const CORNERS = (M + 1) * (M + 1);
  const STORE_BYTES = CORNERS * 4;     // held as 32 bit floats

  // ---- the field, standing in for something measured ----------------------------------------
  // Sampled once into the corner store, and never consulted again: from then on every answer comes
  // from the corners, exactly as it would if these numbers had come off an instrument.
  function truth(u, v) {
    const hill = (cx, cy, s, h) => h * Math.exp(-(((u - cx) ** 2 + (v - cy) ** 2) / s));
    const ridge = 0.22 * Math.sin(6.1 * u + 1.2) * Math.cos(4.7 * v - 0.4)
      + 0.09 * Math.sin(13.3 * u - 0.7) * Math.sin(11.9 * v + 2.1)
      + 0.04 * Math.cos(23.1 * u + 1.9) * Math.cos(19.7 * v);
    return 0.42 + 0.18 * u - 0.1 * v + ridge
      + hill(0.31, 0.68, 0.030, 0.55) + hill(0.74, 0.27, 0.014, 0.42)
      + hill(0.55, 0.58, 0.070, 0.30) + hill(0.17, 0.22, 0.020, 0.26);
  }

  const store = new Float32Array(CORNERS);
  for (let j = 0; j <= M; j++) {
    for (let i = 0; i <= M; i++) store[j * (M + 1) + i] = truth(i / M, j / M);
  }
  // The colours are spread across what is actually in the store, worked out once from the store
  // itself rather than assumed, or every hill would come out the same shade of white.
  let LO = Infinity, HI = -Infinity;
  for (const z of store) { if (z < LO) LO = z; if (z > HI) HI = z; }
  const SPAN = HI - LO || 1;

  // A point anywhere in the world, from the four corners around it.
  function read(u, v) {
    const fu = Math.min(M - 1e-9, Math.max(0, u * M));
    const fv = Math.min(M - 1e-9, Math.max(0, v * M));
    const i = fu | 0, j = fv | 0, s = fu - i, t = fv - j;
    const k = j * (M + 1) + i;
    const c00 = store[k], c10 = store[k + 1], c01 = store[k + M + 1], c11 = store[k + M + 2];
    return c00 + (c10 - c00) * s + (c01 - c00) * t + (c00 - c10 - c01 + c11) * s * t;
  }

  // ---- colour ---------------------------------------------------------------------------------
  const STOPS = [
    [0.00, 22, 46, 72], [0.34, 34, 96, 120], [0.42, 196, 186, 140],
    [0.50, 96, 140, 84], [0.66, 128, 150, 78], [0.80, 150, 128, 96],
    [0.92, 196, 196, 198], [1.00, 246, 248, 250],
  ];
  function colour(z) {
    const t = Math.min(1, Math.max(0, z));
    for (let i = 1; i < STOPS.length; i++) {
      if (t <= STOPS[i][0]) {
        const a = STOPS[i - 1], b = STOPS[i];
        const f = (t - a[0]) / (b[0] - a[0] || 1);
        return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
      }
    }
    const last = STOPS[STOPS.length - 1];
    return [last[1], last[2], last[3]];
  }

  // ---- one tile, made when it is asked for -------------------------------------------------------
  let tilesMade = 0, pixelsMade = 0, tileMs = 0;
  function makeTile(z, tx, ty) {
    const t0 = performance.now();
    const img = ctx.createImageData(TILE, TILE);
    const span = 1 / Math.pow(2, z);
    const step = span / TILE;
    const u0 = tx * span, v0 = ty * span;
    let p = 0;
    for (let py = 0; py < TILE; py++) {
      const v = v0 + py * step;
      for (let px = 0; px < TILE; px++) {
        const [r, g, b] = colour((read(u0 + px * step, v) - LO) / SPAN);
        img.data[p++] = r; img.data[p++] = g; img.data[p++] = b; img.data[p++] = 255;
      }
    }
    tilesMade++;
    pixelsMade += TILE * TILE;
    tileMs += performance.now() - t0;
    return img;
  }

  // What a pyramid of these tiles would weigh, if they were stored the ordinary way: every tile at
  // every zoom, one byte a pixel, which is the cheapest a height tile can honestly be.
  function pyramidBytes(zMax) {
    let tiles = 0;
    for (let z = 0; z <= zMax; z++) tiles += Math.pow(4, z);
    return tiles * TILE * TILE;
  }
  const human = (b) => b >= 1e12 ? `${(b / 1e12).toFixed(1)} TB` : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB`
    : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${(b / 1e3).toFixed(0)} kB`;

  // ---- the view --------------------------------------------------------------------------------
  const view = { zoom: 2, u: 0.5, v: 0.5 };      // zoom is whole numbers here, pan is continuous
  const cache = new Map();
  let useCache = false;

  function tileFor(z, tx, ty) {
    const key = `${z}/${tx}/${ty}`;
    if (useCache && cache.has(key)) return cache.get(key);
    const img = makeTile(z, tx, ty);
    if (useCache) cache.set(key, img);
    return img;
  }

  const scratch = document.createElement("canvas");
  scratch.width = TILE; scratch.height = TILE;
  const sctx = scratch.getContext("2d");

  function draw() {
    const w = canvas.width, h = canvas.height;
    const z = view.zoom, n = Math.pow(2, z);
    const world = n * TILE;                       // the whole world is this many pixels at this zoom
    const cx = view.u * world, cy = view.v * world;
    const left = cx - w / 2, top = cy - h / 2;
    const x0 = Math.floor(left / TILE), x1 = Math.floor((left + w) / TILE);
    const y0 = Math.floor(top / TILE), y1 = Math.floor((top + h) / TILE);

    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, w, h);
    let drawn = 0;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (tx < 0 || ty < 0 || tx >= n || ty >= n) continue;
        sctx.putImageData(tileFor(z, tx, ty), 0, 0);
        ctx.drawImage(scratch, Math.round(tx * TILE - left), Math.round(ty * TILE - top));
        drawn++;
      }
    }
    report(drawn, n);
  }

  function report(drawn, n) {
    const span = 1 / n;                                   // how much of the world one tile covers
    const cornersAcross = span * M;                       // how many stored corners are in one tile
    $("held").textContent = human(STORE_BYTES);
    $("pyramid").textContent = human(pyramidBytes(view.zoom));
    $("ratio").textContent = `${Math.round(pyramidBytes(view.zoom) / STORE_BYTES).toLocaleString()}x`;
    $("zoom-now").textContent = String(view.zoom);
    $("tiles-made").textContent = tilesMade.toLocaleString();
    $("tile-ms").textContent = tilesMade ? `${(tileMs / tilesMade).toFixed(1)} ms` : "0 ms";
    $("on-screen").textContent = String(drawn);
    $("cache-size").textContent = useCache ? `${cache.size} tiles, ${human(cache.size * TILE * TILE * 4)}` : "off";

    // The honest part. Past the point where a tile holds fewer than about two stored corners, what
    // you are looking at is the space between measurements, not measurements.
    const note = $("detail-note");
    if (cornersAcross >= 8) {
      note.textContent = `This tile covers about ${cornersAcross.toFixed(0)} stored corners across. Everything you see came from them.`;
      note.dataset.kind = "ok";
    } else if (cornersAcross >= 1) {
      note.textContent = `This tile covers about ${cornersAcross.toFixed(1)} stored corners across. You are close to the edge of what was measured.`;
      note.dataset.kind = "warn";
    } else {
      note.textContent = `This tile covers ${cornersAcross.toFixed(2)} of a stored corner. Past this point the picture is the space between measurements, smoothly filled in. It is not new detail and the store does not have any.`;
      note.dataset.kind = "bad";
    }
  }

  // How wrong the corners are, against the field they were sampled from, over what is on screen.
  function checkError() {
    const n = Math.pow(2, view.zoom), world = n * TILE;
    const left = view.u * world - canvas.width / 2, top = view.v * world - canvas.height / 2;
    let worst = 0, sum = 0, lo = Infinity, hi = -Infinity, count = 0;
    for (let k = 0; k < 4000; k++) {
      const u = (left + Math.random() * canvas.width) / world;
      const v = (top + Math.random() * canvas.height) / world;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      const t = truth(u, v), d = Math.abs(read(u, v) - t);
      worst = Math.max(worst, d); sum += d * d; count++;
      lo = Math.min(lo, t); hi = Math.max(hi, t);
    }
    const span = hi - lo || 1;
    return { worst: (100 * worst) / span, rms: (100 * Math.sqrt(sum / Math.max(1, count))) / span, count };
  }

  // ---- controls -----------------------------------------------------------------------------------
  function size() {
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.round(r.width);
    canvas.height = Math.round(r.height);
  }
  const clamp = () => {
    view.zoom = Math.max(0, Math.min(18, view.zoom));
    view.u = Math.max(0, Math.min(1, view.u));
    view.v = Math.max(0, Math.min(1, view.v));
  };
  const go = () => { clamp(); draw(); };

  let drag = null;
  canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointerup", () => { drag = null; });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const world = Math.pow(2, view.zoom) * TILE;
    view.u -= (e.clientX - drag.x) / world;
    view.v -= (e.clientY - drag.y) / world;
    drag = { x: e.clientX, y: e.clientY };
    go();
  });
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); view.zoom += e.deltaY < 0 ? 1 : -1; go(); }, { passive: false });

  $("zoom-in").addEventListener("click", () => { view.zoom += 1; go(); });
  $("zoom-out").addEventListener("click", () => { view.zoom -= 1; go(); });
  $("cache").addEventListener("input", (e) => { useCache = e.target.checked; cache.clear(); go(); });
  $("measure").addEventListener("click", () => {
    const e = checkError();
    $("error-out").textContent = e.count < 50
      ? "Move back over the field to measure it."
      : `Over ${e.count} points on this screen: worst ${e.worst.toFixed(2)}% of the range, typical ${e.rms.toFixed(3)}%.`;
  });
  window.addEventListener("resize", () => { size(); go(); });

  size();
  go();

  window.__tiles = {
    read, truth, makeTile, pyramidBytes, checkError, view, go,
    storeBytes: STORE_BYTES, corners: CORNERS, tile: TILE,
    get tilesMade() { return tilesMade; },
    get msPerTile() { return tilesMade ? tileMs / tilesMade : 0; },
  };
})();
