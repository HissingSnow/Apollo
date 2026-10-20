(() => {
  const root = document.documentElement;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // Revela todo o conteúdo animado (usado como plano B se algo falhar)
  const revealAll = () => $$('.reveal, [data-split]').forEach(el => el.classList.add('in'));

  // Cada efeito roda isolado: um erro em um não derruba os outros
  const run = (name, fn) => {
    try { fn(); } catch (err) { console.error(`[Apollo] falha em "${name}":`, err); revealAll(); }
  };

  root.classList.add('js');
  addEventListener('error', revealAll);
  setTimeout(() => { if (!window.__apolloRevealOk) revealAll(); }, 3000);

  const media = q => { try { return window.matchMedia(q).matches; } catch { return false; } };
  const reduceMotion = media('(prefers-reduced-motion: reduce)');
  const finePointer = media('(hover: hover) and (pointer: fine)');
  let lenis = null;
  let smx = 0, smy = 0;

  const header = $('#header');
  const scrollToTarget = target => lenis ? lenis.scrollTo(target, { offset: -90 }) : target.scrollIntoView({ behavior: 'smooth' });

  /* ================= ESSENCIAL (conteúdo e navegação) ================= */

  run('header', () => {
    const onScroll = () => header.classList.toggle('scrolled', scrollY > 30);
    onScroll();
    addEventListener('scroll', onScroll, { passive: true });
    $('#menu-toggle').addEventListener('click', () => header.classList.toggle('menu-open'));
    $$('#nav a').forEach(a => a.addEventListener('click', () => header.classList.remove('menu-open')));
  });

  run('imagens', () => {
    $$('img[data-fallback]').forEach(img => {
      const swap = () => { if (!img.src.endsWith(img.dataset.fallback)) img.src = img.dataset.fallback; };
      img.addEventListener('error', swap, { once: true });
      if (img.complete && img.naturalWidth === 0) swap();
    });
  });

  run('titulos', () => {
    if (reduceMotion) return;
    $$('[data-split]').forEach(el => {
      let i = 0;
      const wrap = () => {
        const w = document.createElement('span'); w.className = 'w';
        const inner = document.createElement('span'); inner.style.setProperty('--i', i++);
        w.append(inner);
        return [w, inner];
      };
      [...el.childNodes].forEach(node => {
        if (node.nodeType === 3) {
          const frag = document.createDocumentFragment();
          node.textContent.split(/(\s+)/).forEach(part => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.append(' '); return; }
            const [w, inner] = wrap(); inner.textContent = part; frag.append(w);
          });
          node.replaceWith(frag);
        } else if (node.nodeType === 1 && node.tagName !== 'BR') {
          const [w, inner] = wrap(); node.replaceWith(w); inner.append(node);
        }
      });
    });
  });

  run('revelar', () => {
    if (!('IntersectionObserver' in window) || reduceMotion) { revealAll(); window.__apolloRevealOk = true; return; }
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });
    $$('.reveal, [data-split]').forEach(el => io.observe(el));
    // Rede de segurança: ao rolar, revela tudo que já passou pela tela
    addEventListener('scroll', () => {
      $$('.reveal:not(.in), [data-split]:not(.in)').forEach(el => {
        if (el.getBoundingClientRect().top < innerHeight) el.classList.add('in');
      });
    }, { passive: true });
    window.__apolloRevealOk = true;
  });

  run('rolagem-horizontal', () => {
    const hs = $('.hscroll');
    if (!hs) return;
    const track = $('.hscroll-track', hs);
    const bar = $('.hscroll-progress i', hs);
    let dist = 0;
    const active = () => innerWidth > 1024 && dist > 0;
    const update = () => {
      if (!active()) return;
      const p = Math.min(Math.max(-hs.getBoundingClientRect().top / dist, 0), 1);
      track.style.transform = `translate3d(${(-p * dist).toFixed(1)}px,0,0)`;
      if (bar) bar.style.transform = `scaleX(${p.toFixed(3)})`;
    };
    const measure = () => {
      track.style.transform = '';
      dist = innerWidth > 1024 ? Math.max(track.scrollWidth - innerWidth + 40, 0) : 0;
      hs.classList.toggle('is-pinned', active());
      hs.style.height = active() ? `${dist + innerHeight}px` : '';
      update();
    };
    addEventListener('scroll', update, { passive: true });
    addEventListener('resize', measure);
    addEventListener('load', measure);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    measure();
    // Loop leve: mantém a posição sincronizada mesmo se algum evento de scroll se perder
    (function tick() { update(); requestAnimationFrame(tick); })();
  });

  run('tour', () => {
    const tabs = $$('.tour-tab');
    if (!tabs.length) return;
    let timer = null, started = false;
    const show = (i, user) => {
      tabs.forEach((t, j) => {
        t.classList.toggle('active', j === i);
        t.setAttribute('aria-selected', j === i);
        const bar = $('.bar', t);
        bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = '';
      });
      $$('.tour-pane').forEach(p => p.classList.toggle('active', p.id === tabs[i].dataset.pane));
      clearTimeout(timer);
      if (!user && !reduceMotion) timer = setTimeout(() => show((i + 1) % tabs.length), 7000);
    };
    tabs.forEach((t, i) => t.addEventListener('click', () => show(i, true)));
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([e]) => { if (e.isIntersecting && !started) { started = true; show(0); } }, { threshold: 0.3 }).observe($('#tour'));
    }
  });

  run('simulador', () => {
    const range = $('#users');
    if (!range) return;
    const out = $('#users-out'), sugName = $('#sug-name');
    const plans = [
      { max: 3, key: 'essencial', name: 'Essencial' },
      { max: 10, key: 'profissional', name: 'Profissional' },
      { max: 30, key: 'gestao', name: 'Gestão' },
      { max: Infinity, key: 'enterprise', name: 'Enterprise' }
    ];
    const simulate = () => {
      const n = +range.value;
      out.textContent = n === 50 ? '50+' : n;
      const plan = plans.find(p => n <= p.max);
      sugName.textContent = plan.name;
      $$('.plan').forEach(el => el.classList.toggle('suggested', el.dataset.plan === plan.key));
    };
    range.addEventListener('input', simulate);
    simulate();
  });

  run('busca', () => {
    const cmdk = $('#cmdk'), cmdkInput = $('#cmdk-input'), cmdkList = $('#cmdk-list');
    const commands = [
      { label: 'Início', href: 'index.html', hint: 'Página' },
      { label: 'Nossos produtos', href: 'index.html#produtos', hint: 'Início' },
      { label: 'Apollo Drive', href: 'index.html#apollo-drive', hint: 'Produto' },
      { label: 'Módulos do Apollo Drive', href: 'index.html#modulos', hint: 'Produto' },
      { label: 'Tour pelo sistema', href: 'index.html#tour', hint: 'Produto' },
      { label: 'Planos e preços', href: 'planos.html', hint: 'Página' },
      { label: 'Comparar planos', href: 'planos.html#comparar', hint: 'Planos' },
      { label: 'Serviços', href: 'servicos.html', hint: 'Página' },
      { label: 'Projetos sob medida', href: 'servicos.html#sob-medida', hint: 'Serviços' },
      { label: 'Sobre a Apollo', href: 'sobre.html', hint: 'Página' },
      { label: 'Contato', href: 'sobre.html#contato', hint: 'Sobre' },
      { label: 'Área do cliente', href: 'area-cliente.html', hint: 'Conta' }
    ];
    let sel = 0, filtered = commands;
    const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const render = () => {
      const q = norm(cmdkInput.value.trim());
      filtered = commands.filter(c => norm(c.label).includes(q));
      sel = Math.min(sel, Math.max(filtered.length - 1, 0));
      cmdkList.innerHTML = filtered.length
        ? filtered.map((c, i) => `<li class="${i === sel ? 'sel' : ''}"><a href="${c.href}">${c.label}<span>${c.hint}</span></a></li>`).join('')
        : '<li class="cmdk-empty">Nenhum resultado</li>';
    };
    const open = () => { cmdk.classList.add('open'); cmdkInput.value = ''; sel = 0; render(); lenis && lenis.stop(); setTimeout(() => cmdkInput.focus(), 10); };
    const close = () => { cmdk.classList.remove('open'); lenis && lenis.start(); };
    $('#cmdk-open').addEventListener('click', open);
    cmdk.addEventListener('click', e => { if (e.target === cmdk || e.target.closest('a')) close(); });
    cmdkInput.addEventListener('input', () => { sel = 0; render(); });
    addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); cmdk.classList.contains('open') ? close() : open(); return; }
      if (!cmdk.classList.contains('open')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowDown' && filtered.length) { e.preventDefault(); sel = (sel + 1) % filtered.length; render(); }
      if (e.key === 'ArrowUp' && filtered.length) { e.preventDefault(); sel = (sel - 1 + filtered.length) % filtered.length; render(); }
      if (e.key === 'Enter' && filtered[sel]) { close(); location.href = filtered[sel].href; }
    });
  });

  run('ano', () => { const y = $('#year'); if (y) y.textContent = new Date().getFullYear(); });

  /* ================= EFEITOS (decorativos) ================= */

  run('preloader', () => {
    const pre = $('.preloader');
    const hide = () => pre && pre.classList.add('done');
    if (document.readyState === 'complete') setTimeout(hide, 300);
    else addEventListener('load', () => setTimeout(hide, 300));
    setTimeout(hide, 2000);
  });

  run('rolagem-suave', () => {
    if (!window.Lenis || reduceMotion) return;
    lenis = new Lenis({ duration: 1.1, smoothWheel: true });
    const raf = t => { lenis.raf(t); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
  });

  run('links', () => {
    const fade = $('.page-fade');
    document.addEventListener('click', e => {
      const a = e.target.closest('a[href]');
      if (!a || a.target === '_blank' || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const href = a.getAttribute('href');
      if (href === '#') return;
      // Âncora na mesma página: rola suavemente
      const samePage = href.startsWith('#') || a.pathname.replace(/index\.html$/, '') === location.pathname.replace(/index\.html$/, '');
      if (samePage && a.hash && $(a.hash)) {
        e.preventDefault();
        header.classList.remove('menu-open');
        scrollToTarget($(a.hash));
        return;
      }
      // Outra página do site: transição com fade
      if (fade && /\.html(#|$)/.test(href) && !/^https?:/.test(href)) {
        e.preventDefault();
        fade.classList.add('on');
        setTimeout(() => { location.href = a.href; }, 400);
      }
    });
    addEventListener('pageshow', () => fade && fade.classList.remove('on'));
  });

  run('estrelas', () => {
    const canvas = $('#stars');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let W, H, stars = [], shooting = [];
    let mouseX = 0, mouseY = 0;
    const colors = { gold: '251,191,36', blue: '147,197,253', white: '226,220,255' };

    const build = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      W = innerWidth; H = innerHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const area = W * H;
      const layers = [
        { n: area / 4200, r: [0.3, 0.8], depth: 0.15 },
        { n: area / 11000, r: [0.7, 1.3], depth: 0.4 },
        { n: area / 38000, r: [1.2, 2], depth: 0.8 }
      ];
      stars = layers.flatMap(L => Array.from({ length: Math.round(L.n) }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        r: L.r[0] + Math.random() * (L.r[1] - L.r[0]),
        depth: L.depth, t: Math.random() * 6.3, ts: 0.005 + Math.random() * 0.02,
        hue: Math.random() < 0.07 ? 'gold' : Math.random() < 0.25 ? 'blue' : 'white'
      })));
    };

    const spawn = () => {
      if (reduceMotion || document.hidden || !W || !H) return;
      const left = Math.random() < 0.5;
      shooting.push({ x: left ? Math.random() * W * 0.5 : W * (0.5 + Math.random() * 0.5), y: Math.random() * H * 0.4, vx: (left ? 1 : -1) * (7 + Math.random() * 5), vy: 3 + Math.random() * 2.5, life: 1 });
    };

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      smx += (mouseX - smx) * 0.05;
      smy += (mouseY - smy) * 0.05;
      const sy = scrollY;
      for (const s of stars) {
        s.t += s.ts;
        const a = 0.3 + Math.abs(Math.sin(s.t)) * 0.7;
        const x = ((s.x + smx * s.depth * 30) % W + W) % W;
        const y = ((s.y - sy * s.depth * 0.25 + smy * s.depth * 30) % H + H) % H;
        ctx.beginPath(); ctx.arc(x, y, s.r, 0, 6.283);
        ctx.fillStyle = `rgba(${colors[s.hue]},${a})`; ctx.fill();
        if (s.r > 1.5) {
          ctx.beginPath(); ctx.arc(x, y, s.r * 3.5, 0, 6.283);
          ctx.fillStyle = `rgba(${colors[s.hue]},${a * 0.08})`; ctx.fill();
        }
      }
      for (let i = shooting.length - 1; i >= 0; i--) {
        const m = shooting[i];
        m.x += m.vx; m.y += m.vy; m.life -= 0.013;
        if (m.life <= 0) { shooting.splice(i, 1); continue; }
        const tx = m.x - m.vx * 14, ty = m.y - m.vy * 14;
        const g = ctx.createLinearGradient(m.x, m.y, tx, ty);
        g.addColorStop(0, `rgba(255,240,200,${m.life})`);
        g.addColorStop(1, 'rgba(168,85,247,0)');
        ctx.strokeStyle = g; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(tx, ty); ctx.stroke();
      }
      if (!reduceMotion) requestAnimationFrame(draw);
    };
    build(); draw();
    // estrelas cadentes só começam depois que a tela foi medida
    (function loop() { spawn(); setTimeout(loop, 2800 + Math.random() * 4200); })();
    addEventListener('resize', () => { build(); if (reduceMotion) draw(); });
    addEventListener('pointermove', e => { mouseX = e.clientX / innerWidth - 0.5; mouseY = e.clientY / innerHeight - 0.5; }, { passive: true });
  });

  run('cursor', () => {
    if (!finePointer || reduceMotion) return;
    const glow = document.createElement('div'); glow.className = 'cursor-glow';
    const dot = document.createElement('div'); dot.className = 'cursor-dot';
    document.body.append(glow, dot);
    let cx = innerWidth / 2, cy = innerHeight / 2, gx = cx, gy = cy;
    addEventListener('pointermove', e => { cx = e.clientX; cy = e.clientY; dot.style.transform = `translate(${cx}px,${cy}px)`; }, { passive: true });
    (function follow() {
      gx += (cx - gx) * 0.08; gy += (cy - gy) * 0.08;
      glow.style.transform = `translate(${gx}px,${gy}px)`;
      requestAnimationFrame(follow);
    })();
    document.addEventListener('pointerover', e => dot.classList.toggle('hover', !!e.target.closest('a, button, summary, input')));
    $$('.btn').forEach(btn => {
      btn.addEventListener('pointermove', e => {
        const r = btn.getBoundingClientRect();
        btn.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.2}px, ${(e.clientY - r.top - r.height / 2) * 0.3}px)`;
      });
      btn.addEventListener('pointerleave', () => { btn.style.transform = ''; });
    });
  });

  run('orbita-3d', () => {
    const system = $('.orbit-system');
    if (!system || !finePointer || reduceMotion) return;
    (function tilt() {
      system.style.transform = `perspective(1400px) rotateX(${smy * -14}deg) rotateY(${smx * 14}deg)`;
      requestAnimationFrame(tilt);
    })();
  });
})();
