/* =========================================================
   Introdução 3D: big bang → voo entre galáxias → constelação Apollo → site
   Roda uma vez por sessão (ou sempre com ?intro na URL).
   ========================================================= */
(() => {
  const root = document.documentElement;
  const intro = document.getElementById('intro');
  if (!intro) return;

  let finished = false;
  let rafId = 0;
  let renderer = null;
  const disposables = [];

  /* ---------- Encerramento (também usado no "pular") ---------- */
  function finish(instant) {
    if (finished) return;
    finished = true;
    try { sessionStorage.setItem('apolloIntro', '1'); } catch (e) {}
    window.scrollTo(0, 0);
    intro.classList.add('intro-out');
    // libera o site: o hero anima enquanto a intro se dissolve
    setTimeout(() => root.classList.remove('intro-on'), instant ? 0 : 350);
    setTimeout(() => {
      cancelAnimationFrame(rafId);
      disposables.forEach(d => { try { d.dispose(); } catch (e) {} });
      if (renderer) { renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss(); }
      intro.remove();
    }, instant ? 400 : 1600);
  }

  if (!root.classList.contains('intro-on')) { intro.remove(); return; }

  const webglOk = (() => {
    try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl'))); }
    catch (e) { return false; }
  })();
  if (!window.THREE || !webglOk) { finish(true); return; }

  /* ---------- Controles: pular, teclado, bloquear rolagem por baixo ---------- */
  intro.querySelector('.intro-skip').addEventListener('click', () => finish(false));
  addEventListener('keydown', e => { if (!finished && ['Escape', 'Enter', ' '].includes(e.key)) { e.preventDefault(); finish(false); } });
  ['wheel', 'touchmove'].forEach(type => intro.addEventListener(type, e => { e.preventDefault(); e.stopPropagation(); }, { passive: false }));

  try { build(); } catch (err) { console.error('[Apollo] intro:', err); finish(true); }

  function build() {
    const THREE = window.THREE;
    const mobile = innerWidth < 768;
    const Q = mobile ? 0.45 : 1; // qualidade (quantidade de partículas)

    const canvas = intro.querySelector('canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    renderer.setSize(innerWidth, innerHeight);
    renderer.setClearColor(0x04050d, 1);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x04050d, 0.00042);
    const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 6000);

    /* textura circular suave para as partículas */
    const sprite = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.18, 'rgba(255,255,255,.9)');
      gr.addColorStop(0.45, 'rgba(255,255,255,.25)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c);
      disposables.push(t);
      return t;
    })();

    const pointsMaterial = (size, attenuation = true, opacity = 1) => {
      const m = new THREE.PointsMaterial({
        size, sizeAttenuation: attenuation, map: sprite, vertexColors: true,
        transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending
      });
      disposables.push(m);
      return m;
    };

    /* ---------- Estrelas de fundo ---------- */
    {
      const n = Math.round(9000 * Q);
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      const c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 4200;
        pos[i * 3 + 1] = (Math.random() - 0.5) * 2600;
        pos[i * 3 + 2] = 600 - Math.random() * 4400;
        const r = Math.random();
        c.set(r < 0.08 ? 0xfbbf24 : r < 0.3 ? 0x93c5fd : r < 0.45 ? 0xc4b5fd : 0xffffff);
        col.set([c.r, c.g, c.b], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      disposables.push(geo);
      scene.add(new THREE.Points(geo, pointsMaterial(mobile ? 2 : 2.2, false, 0.9)));
    }

    /* ---------- Galáxias espirais ---------- */
    function makeGalaxy({ count, radius, branches, spin, inner, outer, size }) {
      const n = Math.round(count * Q);
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      const cIn = new THREE.Color(inner), cOut = new THREE.Color(outer), c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const r = Math.pow(Math.random(), 1.5) * radius;
        const branch = ((i % branches) / branches) * Math.PI * 2;
        const angle = branch + r * spin;
        const rnd = () => Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * radius * 0.16;
        pos[i * 3] = Math.cos(angle) * r + rnd();
        pos[i * 3 + 1] = rnd() * 0.45;
        pos[i * 3 + 2] = Math.sin(angle) * r + rnd();
        c.copy(cIn).lerp(cOut, r / radius);
        col.set([c.r, c.g, c.b], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      disposables.push(geo);
      const group = new THREE.Group();
      group.add(new THREE.Points(geo, pointsMaterial(size)));
      // núcleo brilhante
      const coreMat = new THREE.SpriteMaterial({ map: sprite, color: inner, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
      disposables.push(coreMat);
      const core = new THREE.Sprite(coreMat);
      core.scale.setScalar(radius * 0.55);
      group.add(core);
      return group;
    }

    const galaxySpecs = [
      { p: [-170, 50, -380], radius: 190, branches: 3, spin: 0.018, inner: 0xffd27a, outer: 0x7c3aed, rot: [1.1, 0.2, 0.3], born: 0.4 },
      { p: [240, -70, -800], radius: 270, branches: 4, spin: 0.012, inner: 0xe0f2fe, outer: 0x2563eb, rot: [0.5, 0.6, -0.4], born: 1.4 },
      { p: [-90, 130, -1180], radius: 150, branches: 2, spin: 0.03, inner: 0xfbcfe8, outer: 0xc026d3, rot: [1.4, -0.3, 0.8], born: 2.6 },
      { p: [290, 90, -1560], radius: 330, branches: 5, spin: 0.009, inner: 0xfff7d6, outer: 0x6d28d9, rot: [0.9, 0.1, 0.1], born: 3.6 },
      { p: [-300, -110, -1880], radius: 240, branches: 3, spin: 0.015, inner: 0xbae6fd, outer: 0x0ea5e9, rot: [0.3, 0.9, 0.5], born: 4.8 },
      { p: [170, -180, -2120], radius: 170, branches: 2, spin: 0.024, inner: 0xfde68a, outer: 0xa855f7, rot: [1.2, 0.4, -0.6], born: 6 },
      // galáxias distantes, para dar profundidade
      { p: [-1100, 300, -2900], radius: 520, branches: 4, spin: 0.006, inner: 0xffffff, outer: 0x4c1d95, rot: [1.0, 0.3, 0.2], born: 2 },
      { p: [1200, -350, -3200], radius: 600, branches: 3, spin: 0.005, inner: 0xe0e7ff, outer: 0x1e40af, rot: [0.6, -0.5, 0.9], born: 3 },
      { p: [-500, 1000, -3700], radius: 700, branches: 5, spin: 0.004, inner: 0xfff1f2, outer: 0x9d174d, rot: [1.3, 0, 0], born: 4 }
    ];
    const galaxies = galaxySpecs.map(s => {
      const g = makeGalaxy({ count: s.radius > 400 ? 9000 : 12000, radius: s.radius, branches: s.branches, spin: s.spin, inner: s.inner, outer: s.outer, size: Math.max(2.2, s.radius * 0.014) });
      g.position.set(...s.p);
      g.rotation.set(...s.rot);
      g.scale.setScalar(0.001);
      g.userData = { born: s.born, speed: 0.04 + Math.random() * 0.06 };
      scene.add(g);
      return g;
    });

    /* ---------- Big bang: explosão inicial de partículas ---------- */
    const bang = (() => {
      const n = Math.round(6000 * Q);
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      const c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        const r = 0.25 + Math.pow(Math.random(), 0.6) * 0.75;
        pos.set([Math.cos(th) * s * r, u * r * 0.7, Math.sin(th) * s * r], i * 3);
        const k = Math.random();
        c.set(k < 0.35 ? 0xfbbf24 : k < 0.7 ? 0xc084fc : 0x93c5fd);
        col.set([c.r, c.g, c.b], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      disposables.push(geo);
      const pts = new THREE.Points(geo, pointsMaterial(3));
      pts.position.set(0, 0, -60);
      scene.add(pts);
      const flashMat = new THREE.SpriteMaterial({ map: sprite, color: 0xf5e1ff, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
      disposables.push(flashMat);
      const flash = new THREE.Sprite(flashMat);
      flash.position.copy(pts.position);
      scene.add(flash);
      return { pts, flash };
    })();

    /* ---------- Constelação Apollo (espiral dupla, como o logo) ---------- */
    const CONST_Z = -2420;
    const constellation = (() => {
      const stars = [new THREE.Vector3(0, 0, 0)];
      for (let arm = 0; arm < 2; arm++) {
        for (let k = 0; k < 8; k++) {
          const t = k / 7;
          const ang = t * Math.PI * 1.55 + arm * Math.PI + 0.4;
          const r = 16 + t * 82;
          stars.push(new THREE.Vector3(Math.cos(ang) * r, Math.sin(ang) * r * 0.92, (Math.random() - 0.5) * 10));
        }
      }
      // linhas intercaladas: os dois braços crescem juntos a partir do centro
      const lines = [];
      for (let k = 0; k < 8; k++) {
        lines.push(k === 0 ? 0 : k, 1 + k);
        lines.push(k === 0 ? 0 : 8 + k, 9 + k);
      }
      // ordem de acendimento: centro → pontas, alternando os braços
      const order = [0];
      for (let k = 0; k < 8; k++) order.push(1 + k, 9 + k);

      const pos = new Float32Array(stars.length * 3), col = new Float32Array(stars.length * 3);
      const gold = new THREE.Color(0xfde68a), violet = new THREE.Color(0xd8b4fe);
      order.forEach((si, i) => {
        pos.set([stars[si].x, stars[si].y, stars[si].z], i * 3);
        const c = si === 0 ? new THREE.Color(0xffffff) : (si % 2 ? gold : violet);
        col.set([c.r, c.g, c.b], i * 3);
      });
      const starGeo = new THREE.BufferGeometry();
      starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      starGeo.setDrawRange(0, 0);
      disposables.push(starGeo);
      const starPts = new THREE.Points(starGeo, pointsMaterial(7));

      // halos maiores nas mesmas estrelas
      const haloPts = new THREE.Points(starGeo, pointsMaterial(22, true, 0.35));

      const linePos = new Float32Array(lines.length * 3);
      lines.forEach((si, i) => linePos.set([stars[si].x, stars[si].y, stars[si].z], i * 3));
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
      lineGeo.setDrawRange(0, 0);
      disposables.push(lineGeo);
      const lineMat = new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
      disposables.push(lineMat);
      const lineSeg = new THREE.LineSegments(lineGeo, lineMat);

      const glowMat = new THREE.SpriteMaterial({ map: sprite, color: 0x8b5cf6, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      disposables.push(glowMat);
      const glow = new THREE.Sprite(glowMat);
      glow.scale.setScalar(260);

      const group = new THREE.Group();
      group.add(glow, lineSeg, haloPts, starPts);
      group.position.set(0, 0, CONST_Z);
      scene.add(group);
      return { group, starGeo, lineGeo, glowMat, starCount: stars.length, lineCount: lines.length };
    })();

    /* ---------- Trajetória da câmera ---------- */
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 220),
      new THREE.Vector3(40, 15, -180),
      new THREE.Vector3(-50, 40, -600),
      new THREE.Vector3(70, -25, -1000),
      new THREE.Vector3(-40, 45, -1400),
      new THREE.Vector3(50, 0, -1800),
      new THREE.Vector3(0, 0, CONST_Z + 270)
    ]);
    const constCenter = new THREE.Vector3(0, 0, CONST_Z);

    /* ---------- Linha do tempo (segundos) ---------- */
    const FLY = 11;          // duração do voo
    const TOTAL = 15.4;      // fim da intro
    const texts = [...intro.querySelectorAll('.intro-line')].map(el => ({ el, a: +el.dataset.start, b: +el.dataset.end }));
    const final = intro.querySelector('.intro-final');
    const bar = intro.querySelector('.intro-progress i');

    const clamp = (v, a = 0, b = 1) => Math.min(Math.max(v, a), b);
    const easeOut = t => 1 - Math.pow(1 - t, 3);
    const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

    let mx = 0, my = 0, smx = 0, smy = 0;
    addEventListener('pointermove', e => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; }, { passive: true });

    const look = new THREE.Vector3();
    const start = performance.now();

    function frame(now) {
      if (finished && !intro.isConnected) return;
      const t = (now - start) / 1000;

      // galáxias nascem (expandem) e giram
      galaxies.forEach(g => {
        const k = easeOut(clamp((t - g.userData.born) / 3));
        g.scale.setScalar(Math.max(k, 0.001));
        g.rotation.y += g.userData.speed * 0.016;
      });

      // big bang
      const bk = clamp(t / 3.2);
      bang.pts.scale.setScalar(4 + easeOut(bk) * 1400);
      bang.pts.material.opacity = 1 - smooth(0.5, 3.6, t);
      bang.flash.scale.setScalar(40 + easeOut(clamp(t / 1.2)) * 520);
      bang.flash.material.opacity = 1 - smooth(0.1, 1.6, t);

      // câmera
      const u = easeInOut(clamp(t / FLY));
      const p = path.getPointAt(u);
      const ahead = path.getPointAt(Math.min(u + 0.05, 1));
      look.copy(ahead).lerp(constCenter, smooth(0.72, 1, u));
      smx += (mx - smx) * 0.04; smy += (my - smy) * 0.04;
      camera.position.set(p.x + smx * 30, p.y - smy * 20, p.z);
      camera.lookAt(look);
      camera.rotateZ(Math.sin(t * 0.35) * 0.06 * (1 - smooth(8, 11, t)));

      // constelação: estrelas acendem uma a uma, depois as linhas se desenham
      const sk = clamp((t - 9.6) / 2.2);
      constellation.starGeo.setDrawRange(0, Math.round(sk * constellation.starCount));
      const lk = clamp((t - 10.6) / 2.4);
      constellation.lineGeo.setDrawRange(0, Math.floor(lk * constellation.lineCount / 2) * 2);
      constellation.glowMat.opacity = smooth(10.5, 13, t) * 0.55;
      constellation.group.rotation.z = -t * 0.04;

      // textos
      texts.forEach(({ el, a, b }) => {
        el.classList.toggle('show', t >= a && t < b);
        el.classList.toggle('leave', t >= b);
      });
      final.classList.toggle('show', t >= 12.2);
      if (bar) bar.style.transform = `scaleX(${clamp(t / TOTAL).toFixed(3)})`;

      renderer.render(scene, camera);

      if (t >= TOTAL) { finish(false); return; }
      rafId = requestAnimationFrame(frame);
    }

    addEventListener('resize', () => {
      if (finished) return;
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
    });

    intro.classList.add('running');
    rafId = requestAnimationFrame(frame);
  }
})();
