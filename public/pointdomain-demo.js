(function () {
  "use strict";

  // Deterministic hinge routing (matches Python: abs(angle - 90) <= hinge_eps)
  function isHinge(angleDeg, hingeEps) {
    return Math.abs(angleDeg - 90.0) <= hingeEps;
  }

  // PointDomain internal math — mirrors dimensionalprogramming/PointDomain.py defaults.
  function makePointDomain() {
    const real_axis = 1.0;
    const imag_axis = { re: 0, im: 1 };

    // complex_plane: [complex(1, y/10) for y in -10..10]
    const complex_plane = [];
    for (let y = -10; y <= 10; y++) {
      complex_plane.push({ re: 1, im: y / 10 });
    }

    // bridge_region: [(100-i)/100 for i in 1..99] => 0.99 .. 0.01 (1 -> 0+)
    const bridge_region = [];
    for (let i = 1; i < 100; i++) {
      bridge_region.push((100 - i) / 100);
    }

    const inner_dimension = {
      axis_vector: { re: 0, im: 1 },
      orientation_radians: Math.PI / 2,
      unit_normal: [0, 1],
    };

    // inner_space_layers: one layer per bridge-region sample, each holds a "stacked_black_box"
    // In this browser demo we store a placeholder tag (server-side reversible compression is in Python).
    const inner_space_layers = bridge_region.map((t) => ({
      imag_t: t,
      stacked_black_box: { black_box: "dimension.structure (omitted in browser demo)" },
      orientation_radians: inner_dimension.orientation_radians,
      unit_normal: inner_dimension.unit_normal,
    }));

    return {
      real_axis: real_axis,
      imag_axis: imag_axis,
      complex_plane: complex_plane,
      bridge_region: bridge_region,
      inner_dimension: inner_dimension,
      inner_space_layers: inner_space_layers,
    };
  }

  // Vector continuation (matches dimensionalprogramming/dimensional_pivot_engine.py)
  function stepVector(state) {
    const growth_factor = state.angle / 90.0;
    const new_x = state.x + 1.0;
    const new_y = state.y + growth_factor;

    return {
      x: new_x,
      y: new_y,
      angle: state.angle,
    };
  }

  function formatComplex(c) {
    const sign = c.im >= 0 ? "+" : "-";
    return `${c.re}${sign}${Math.abs(c.im)}i`;
  }

  function formatArray(arr, maxItems) {
    const n = Math.min(arr.length, maxItems);
    const head = arr.slice(0, n);
    return head.join(", ") + (arr.length > n ? ", …" : "");
  }

  function sliceArray(arr, startIdx, endIdx) {
    return arr.slice(startIdx, endIdx);
  }

  function renderOut(html) {
    const el = document.getElementById("pointdomain-demo-out");
    if (!el) return;
    el.innerHTML = html;
  }

  function start() {
    const angleInput = document.getElementById("pointdomain-demo-angle");
    const hingeEpsInput = document.getElementById("pointdomain-demo-hinge-eps");
    const angleTextInput = document.getElementById("pointdomain-demo-angle-text");
    const useTextMode = document.getElementById("pointdomain-demo-use-text");
    const resetBtn = document.getElementById("pointdomain-demo-reset");
    const stepBtn = document.getElementById("pointdomain-demo-step");

    if (!angleInput || !hingeEpsInput || !resetBtn || !stepBtn || !useTextMode || !angleTextInput) {
      // Page loaded but demo controls not present.
      return;
    }

    let vectorState = { x: 0.0, y: 0.0, angle: parseFloat(angleInput.value) || 0.0 };

    function readAngle() {
      if (useTextMode.checked) {
        // Simple deterministic numeric parse for demo.
        // (Python uses regex; here we accept same numeric core.)
        const t = angleTextInput.value || "";
        const m = t.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*(?:deg|degrees)?\s*$/i);
        if (!m) throw new Error("Unable to parse angle text");
        return parseFloat(m[1]);
      }
      return parseFloat(angleInput.value);
    }

    resetBtn.addEventListener("click", () => {
      vectorState = { x: 0.0, y: 0.0, angle: parseFloat(angleInput.value) || 0.0 };
      renderOut(`<div><b>Reset</b> → vector state x=0, y=0</div>`);
    });

    stepBtn.addEventListener("click", () => {
      try {
        const hingeEps = parseFloat(hingeEpsInput.value);
        if (!Number.isFinite(hingeEps) || hingeEps <= 0) throw new Error("hinge ε must be > 0");

        const angle = readAngle();
        vectorState.angle = angle;

        const hinge = isHinge(angle, hingeEps);

        if (!hinge) {
          const next = stepVector(vectorState);
          vectorState = { ...next };
          renderOut(`
            <div><b>Routing:</b> VECTOR continuation (|angle-90| > ε)</div>
            <div><b>Angle:</b> ${angle}</div>
            <div><b>Vector →</b> x=${next.x.toFixed(6)} &nbsp; y=${next.y.toFixed(6)}</div>
          `);
          return;
        }

        const point = makePointDomain();

        const bridge = point.bridge_region;
        const complex = point.complex_plane;

        renderOut(`
          <div><b>Routing:</b> DIMENSIONAL TRAVERSE → collapse into PointDomain (|angle-90| &le; ε)</div>
          <div><b>Angle:</b> ${angle}</div>
          <hr/>
          <div><b>PointDomain inner data</b></div>
          <div><b>bridge_region (1 → 0+)</b> head: [${formatArray(sliceArray(bridge, 0, 5), 5)}]</div>
          <div><b>bridge_region</b> tail: [${formatArray(sliceArray(bridge, bridge.length - 5, bridge.length), 5)}]</div>
          <div><b>complex_plane</b> head: [${formatArray(sliceArray(complex, 0, 4).map(formatComplex), 4)}]</div>
          <div><b>inner_space_layers_count</b>: ${point.inner_space_layers.length}</div>
          <div><b>inner_dimension.orientation_radians</b>: ${(point.inner_dimension.orientation_radians).toFixed(6)}</div>
        `);
      } catch (err) {
        renderOut(`<div style="color:#b00020;"><b>Error:</b> ${String(err.message || err)}</div>`);
      }
    });

    // Prime initial render
    renderOut(`<div><b>PointDomain demo</b> ready. Click <i>Step</i>.</div>`);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
