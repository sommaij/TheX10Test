/*
 * X10 Tasks — motion with depth, kept quiet: cards tilt with the phone (2.5D parallax and light), rows glide and fold,
 * pages come forward from a little depth, numbers roll, swipe a row, drag a sheet down to close.
 * Short ease-out moves only (no bounce). Skipped when the phone asks for reduced motion or the app's setting is off.
 */
(function (root) {
  'use strict';
  const doc = root.document;
  const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
  let enabled = true;
  const reduced = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const on = () => enabled && !reduced() && typeof Element.prototype.animate === 'function';

  function setEnabled(v) {
    enabled = v !== false;
    doc.documentElement.classList.toggle('no-motion', !enabled);
    if (!enabled) resetTilt();
  }

  // ---------- 2.5D: cards that tilt with the phone ----------
  // Elements with [data-depth] get --tx / --ty (-1…1); CSS turns them into a small rotation, parallax between layers
  // and a moving highlight. The phone's gyroscope drives it; with a mouse, the pointer does.
  const tilt = { x: 0, y: 0, tx: 0, ty: 0, base: null, raf: 0, sensorAt: 0, started: false };
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  function paintTilt() {
    tilt.raf = 0;
    tilt.x += (tilt.tx - tilt.x) * 0.14;
    tilt.y += (tilt.ty - tilt.y) * 0.14;
    const x = tilt.x.toFixed(3);
    const y = tilt.y.toFixed(3);
    doc.querySelectorAll('[data-depth]').forEach((el) => {
      el.style.setProperty('--tx', x);
      el.style.setProperty('--ty', y);
    });
    if (Math.abs(tilt.tx - tilt.x) > 0.002 || Math.abs(tilt.ty - tilt.y) > 0.002) tilt.raf = requestAnimationFrame(paintTilt);
  }
  const kickTilt = () => {
    if (on() && !tilt.raf) tilt.raf = requestAnimationFrame(paintTilt);
  };
  // Re-applies the current tilt after a re-render created new [data-depth] elements.
  function retilt() {
    if (!on() || (!tilt.x && !tilt.y)) return;
    doc.querySelectorAll('[data-depth]').forEach((el) => {
      el.style.setProperty('--tx', tilt.x.toFixed(3));
      el.style.setProperty('--ty', tilt.y.toFixed(3));
    });
  }
  function resetTilt() {
    tilt.tx = tilt.ty = tilt.x = tilt.y = 0;
    doc.querySelectorAll('[data-depth]').forEach((el) => {
      el.style.removeProperty('--tx');
      el.style.removeProperty('--ty');
    });
  }
  function startTilt() {
    if (tilt.started) return;
    tilt.started = true;
    root.addEventListener('deviceorientation', (e) => {
      if (e.beta === null || e.gamma === null || !on()) return;
      tilt.sensorAt = Date.now();
      if (!tilt.base) tilt.base = { b: e.beta, g: e.gamma };
      // follow how the phone is being held, slowly, so the card settles flat again
      tilt.base.b += (e.beta - tilt.base.b) * 0.015;
      tilt.base.g += (e.gamma - tilt.base.g) * 0.015;
      tilt.tx = clamp((e.beta - tilt.base.b) / 14);
      tilt.ty = clamp((e.gamma - tilt.base.g) / 14);
      kickTilt();
    });
    doc.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || Date.now() - tilt.sensorAt < 3000 || !on()) return;
      const el = e.target.closest && e.target.closest('[data-depth]');
      if (!el) {
        if (tilt.tx || tilt.ty) {
          tilt.tx = tilt.ty = 0;
          kickTilt();
        }
        return;
      }
      const r = el.getBoundingClientRect();
      tilt.tx = clamp(((e.clientY - r.top) / r.height - 0.5) * -2);
      tilt.ty = clamp(((e.clientX - r.left) / r.width - 0.5) * 2);
      kickTilt();
    }, { passive: true });
  }

  // ---------- 2.5D: cards lean toward the finger while pressed ----------
  function pressTilt(selector) {
    let cur = null;
    const release = () => {
      if (!cur) return;
      const el = cur;
      cur = null;
      el.style.transition = `transform 0.45s ${EASE}`;
      el.style.transform = '';
      setTimeout(() => (el.style.transition = ''), 460);
    };
    doc.addEventListener('pointerdown', (e) => {
      if (!on() || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const el = e.target.closest(selector);
      if (!el) return;
      cur = el;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      const k = Math.min(1, 220 / Math.max(r.width, 1)); // big cards lean less
      el.style.transition = `transform 0.16s ${EASE}`;
      el.style.transform = `perspective(700px) rotateX(${(-py * 9 * k).toFixed(2)}deg) rotateY(${(px * 9 * k).toFixed(2)}deg) scale(0.985)`;
    }, { passive: true });
    doc.addEventListener('pointerup', release);
    doc.addEventListener('pointercancel', release);
    doc.addEventListener('pointerleave', release);
  }

  // ---------- lists: FLIP (rows glide to their new place instead of jumping) ----------
  // Rows are measured relative to their card, and cards are animated on their own, so nothing moves twice.
  function measure(container) {
    if (!on() || !container) return null;
    const groups = new Map();
    const rows = new Map();
    container.querySelectorAll('[data-key]').forEach((g) => groups.set(g.dataset.key, g.getBoundingClientRect().top));
    container.querySelectorAll('.task[data-id]').forEach((el) => rows.set(el.dataset.id, el.getBoundingClientRect().top));
    return { groups, rows };
  }
  function flip(container, before, opts = {}) {
    if (!on() || !container || !before) return;
    const vh = root.innerHeight;
    // measure everything first: once a card starts moving, its rows' rectangles move with it
    const cards = [...container.querySelectorAll('[data-key]')].map((g) => ({ el: g, top: g.getBoundingClientRect().top, old: before.groups.get(g.dataset.key) }));
    const rows = [...container.querySelectorAll('.task[data-id]')].map((el) => ({ el, top: el.getBoundingClientRect().top, old: before.rows.get(el.dataset.id), card: el.closest('[data-key]') }));
    const shift = new Map(cards.map((c) => [c.el, c.old === undefined ? 0 : c.old - c.top]));
    for (const c of cards) {
      if (c.old === undefined) {
        if (before.groups.size && c.top < vh) c.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: EASE });
        continue;
      }
      const dy = c.old - c.top;
      if (Math.abs(dy) > 0.5 && (c.top < vh || c.old < vh)) c.el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 320, easing: EASE });
    }
    let fresh = 0;
    for (const r of rows) {
      if (r.top > vh + 40) continue;
      if (r.old === undefined) {
        if (!before.rows.size || fresh++ > 8) continue;
        const hl = opts.highlight && opts.highlight(r.el.dataset.id);
        r.el.animate(hl
          ? [{ opacity: 0, backgroundColor: opts.highlightColor || 'transparent' }, { opacity: 1, offset: 0.25 }, { backgroundColor: 'transparent' }]
          : [{ opacity: 0 }, { opacity: 1 }], { duration: hl ? 1000 : 240, easing: EASE });
        continue;
      }
      const dy = r.old - r.top - (r.card ? shift.get(r.card) || 0 : 0);
      if (Math.abs(dy) > 0.5) r.el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 320, easing: EASE });
    }
  }

  // Elements slide up one after another (first view of a page or list).
  // Elements come forward one after another from a little depth (first view of a page or list).
  function enter(container, selector, { max = 10, step = 26, dist = 10, duration = 420, tip = 9 } = {}) {
    if (!on() || !container) return;
    const vh = root.innerHeight;
    let i = 0;
    for (const el of container.querySelectorAll(selector)) {
      if (i >= max || el.getBoundingClientRect().top > vh) break;
      el.style.transformOrigin = '50% 0';
      el.animate([
        { opacity: 0, transform: `perspective(900px) translate3d(0, ${dist}px, -40px) rotateX(${-tip}deg)` },
        { opacity: 1, transform: 'none' },
      ], { duration, delay: i * step, easing: EASE, fill: 'backwards' });
      i++;
    }
  }

  // A finished row tips back and away before the list closes the gap.
  function fold(el, duration = 240) {
    if (!on() || !el) return null;
    el.style.transformOrigin = '50% 0';
    return el.animate([
      { transform: 'perspective(700px) rotateX(0deg)', opacity: 1 },
      { transform: 'perspective(700px) translate3d(0, -4px, -30px) rotateX(-72deg)', opacity: 0 },
    ], { duration, easing: 'cubic-bezier(0.5, 0, 0.75, 0.4)', fill: 'forwards' });
  }

  // ---------- numbers ----------
  function countUp(node, from, to, { duration = 360, format = String } = {}) {
    if (!node) return;
    if (!on() || from === to) {
      node.textContent = format(to);
      return;
    }
    const t0 = performance.now();
    (function step(now) {
      const p = Math.min(1, (now - t0) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      node.textContent = format(Math.round(from + (to - from) * e));
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }

  // ---------- swipe a row left / right ----------
  // opts.action(row, 'left'|'right') → {cls, html, fly} | null; opts.onArm(); opts.onSwipe(row, dir)
  let swallowUntil = 0;
  doc.addEventListener('click', (e) => {
    if (Date.now() < swallowUntil) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
  function swipeRows(opts) {
    let s = null;
    const threshold = (row) => Math.min(120, row.offsetWidth * 0.32);
    const reset = (st, animate) => {
      const content = st.content;
      const done = () => {
        content.style.transform = '';
        content.style.transition = '';
        st.row.classList.remove('swiping', 'armed');
        if (st.hint) st.hint.remove();
      };
      if (animate && on()) {
        content.style.transition = `transform 0.28s ${EASE}`;
        content.style.transform = 'translateX(0)';
        setTimeout(done, 290);
      } else done();
    };
    doc.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const row = e.target.closest(opts.selector);
      if (!row || row.classList.contains('swiping')) return;
      const content = row.querySelector('.task-row');
      if (!content) return;
      s = { row, content, id: e.pointerId, x0: e.clientX, y0: e.clientY, active: false, dir: null, act: null, armed: false, hint: null, lastX: e.clientX, lastT: e.timeStamp, v: 0 };
    }, { passive: true });
    doc.addEventListener('pointermove', (e) => {
      if (!s || e.pointerId !== s.id) return;
      const dx = e.clientX - s.x0;
      const dy = e.clientY - s.y0;
      if (!s.active) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
          s = null;
          return;
        }
        if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
        s.active = true;
        s.row.classList.add('swiping');
        s.hint = doc.createElement('div');
        s.hint.className = 'swipe-hint';
        s.row.insertBefore(s.hint, s.content);
        try {
          s.row.setPointerCapture(e.pointerId);
        } catch (x) {
          /* not capturable */
        }
      }
      const dir = dx > 0 ? 'right' : 'left';
      if (dir !== s.dir) {
        s.dir = dir;
        s.act = opts.action(s.row, dir);
        s.hint.className = `swipe-hint ${dir} ${s.act ? s.act.cls : 'none'}`;
        s.hint.innerHTML = s.act ? `<span class="swipe-label">${s.act.html}</span>` : '';
      }
      const lim = threshold(s.row);
      const x = s.act ? dx : dx * 0.18;
      s.content.style.transform = `translateX(${x}px)`;
      const armed = !!s.act && Math.abs(dx) >= lim;
      if (armed !== s.armed) {
        s.armed = armed;
        s.row.classList.toggle('armed', armed);
        if (armed && opts.onArm) opts.onArm();
      }
      s.v = (e.clientX - s.lastX) / Math.max(1, e.timeStamp - s.lastT);
      s.lastX = e.clientX;
      s.lastT = e.timeStamp;
    });
    const end = (e) => {
      if (!s || e.pointerId !== s.id) return;
      const st = s;
      s = null;
      if (!st.active) return;
      swallowUntil = Date.now() + 350;
      const fling = st.act && Math.abs(st.v) > 0.9 && Math.sign(st.v) === (st.dir === 'right' ? 1 : -1);
      if (e.type !== 'pointercancel' && st.act && (st.armed || fling)) {
        if (st.act.fly && on()) {
          st.content.style.transition = `transform 0.24s ${EASE}`;
          st.content.style.transform = `translateX(${st.dir === 'right' ? '' : '-'}110%)`;
          setTimeout(() => opts.onSwipe(st.row, st.dir), 230);
        } else {
          reset(st, true);
          setTimeout(() => opts.onSwipe(st.row, st.dir), on() ? 200 : 0);
        }
        return;
      }
      reset(st, true);
    };
    doc.addEventListener('pointerup', end);
    doc.addEventListener('pointercancel', end);
  }

  // ---------- drag a sheet down to close it ----------
  function sheetDrag(rootEl, onClose) {
    let s = null;
    rootEl.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest('.sheet-grip, .sheet-head');
      if (!handle || e.target.closest('button, a, input, select, textarea, label')) return;
      const sheet = rootEl.querySelector('.sheet');
      if (!sheet) return;
      s = { sheet, id: e.pointerId, y0: e.clientY, dy: 0, lastY: e.clientY, lastT: e.timeStamp, v: 0, backdrop: rootEl.querySelector('.sheet-backdrop') };
      try {
        handle.setPointerCapture(e.pointerId);
      } catch (x) {
        /* not capturable */
      }
    });
    rootEl.addEventListener('pointermove', (e) => {
      if (!s || e.pointerId !== s.id) return;
      const dy = e.clientY - s.y0;
      s.dy = dy > 0 ? dy : dy / 6;
      s.sheet.classList.add('dragging');
      s.sheet.style.transform = `translateY(${s.dy}px)`;
      if (s.backdrop) s.backdrop.style.opacity = String(Math.max(0.15, 1 - Math.max(0, dy) / 500));
      s.v = (e.clientY - s.lastY) / Math.max(1, e.timeStamp - s.lastT);
      s.lastY = e.clientY;
      s.lastT = e.timeStamp;
    });
    const end = (e) => {
      if (!s || e.pointerId !== s.id) return;
      const st = s;
      s = null;
      st.sheet.classList.remove('dragging');
      if (st.backdrop) st.backdrop.style.opacity = '';
      const close = st.dy > Math.min(140, st.sheet.offsetHeight * 0.3) || (st.v > 0.7 && st.dy > 20);
      st.sheet.style.transform = '';
      if (close) {
        swallowUntil = Date.now() + 300;
        onClose();
      }
    };
    rootEl.addEventListener('pointerup', end);
    rootEl.addEventListener('pointercancel', end);
  }

  root.X10Motion = { setEnabled, on, measure, flip, enter, fold, countUp, swipeRows, sheetDrag, startTilt, retilt, pressTilt, EASE };
})(typeof self !== 'undefined' ? self : this);
