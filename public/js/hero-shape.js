// hero-shape.js
// The saddle at the top of the front page, drawn from the straight lines it is actually made of.
// z = x times y is doubly ruled: through every point of it run two straight lines that lie
// entirely in the surface. Drawing it this way is not a stylistic choice, it is the fact.
// Uses the global THREE, and does nothing at all if WebGL is missing or motion is not wanted.

(function () {
  const canvas = document.getElementById("hero-shape");
  if (!canvas || !window.THREE) return;
  const THREE = window.THREE;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch (e) {
    canvas.style.display = "none";           // no WebGL: the page reads fine without it
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.up.set(0, 0, 1);

  const N = 14, R = 1.6;
  const at = (x, y) => new THREE.Vector3(x, y, x * y * 0.62);
  const lines = new THREE.Group();

  // Every line of the grid is one of the surface's own rulings: hold x, vary y, and the points
  // stay in a straight line, because z = x*y is linear in y for a fixed x. The same the other way.
  const spectrum = (t) => new THREE.Color().setHSL(0.58 - 0.5 * t, 0.72, 0.56);
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = -R + 2 * R * t;
    for (const along of ["x", "y"]) {
      const pts = [];
      for (let k = 0; k <= 24; k++) {
        const v = -R + 2 * R * (k / 24);
        pts.push(along === "x" ? at(u, v) : at(v, u));
      }
      const height = Math.abs(u) / R;
      const mat = new THREE.LineBasicMaterial({
        color: spectrum(height), transparent: true, opacity: 0.25 + 0.5 * height,
      });
      lines.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }
  }
  scene.add(lines);

  function size() {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  }

  let angle = -1.15;
  function draw() {
    // Far enough back that the corners, which are the tallest part of a saddle, stay in the frame.
    const away = 7.0;
    camera.position.set(away * Math.cos(angle), away * Math.sin(angle), 3.9);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  }

  size();
  draw();
  window.addEventListener("resize", () => { size(); draw(); });

  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (still) return;                          // shown, but held still for anyone who asked for that

  let last = performance.now(), running = true;
  new IntersectionObserver((entries) => { running = entries[0].isIntersecting; })
    .observe(canvas);
  (function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (running) { angle += dt * 0.16; draw(); }
    requestAnimationFrame(tick);
  })(last);
})();
