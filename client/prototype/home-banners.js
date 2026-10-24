// Keep touch panning native so horizontal banners and vertical page scroll can coexist.
(() => {
  'use strict';
  const initialized = new WeakSet();
  const observers = new Map();
  function setup(track) {
    if (initialized.has(track)) return;
    initialized.add(track);
    track.tabIndex = 0;
    track.setAttribute('aria-label', '광고판 좌우 이동');
    let gesture = null, blockClick = false;
    const section = track.closest('.home-banner-section');
    let selected = 0, lastWidth = track.clientWidth;
    function syncArrows() {
      const end = Math.max(0, track.scrollWidth - track.clientWidth);
      const previous = section?.querySelector('[data-action="banner-move"][data-dir="-1"]');
      const next = section?.querySelector('[data-action="banner-move"][data-dir="1"]');
      if (previous) previous.disabled = track.scrollLeft <= 2;
      if (next) next.disabled = track.scrollLeft >= end - 2;
      const count = track.querySelectorAll('.home-banner').length;
      selected = count ? Math.max(0, Math.min(count - 1, Math.round(track.scrollLeft / (track.clientWidth + 12)))) : 0;
      const counter = section?.querySelector('.banner-counter');
      const label = `광고판 ${count}개 중 ${selected + 1}번째`;
      if (counter && count) {
        if (counter.textContent !== `${selected + 1}/${count}`) counter.textContent = `${selected + 1}/${count}`;
        if (counter.getAttribute('aria-label') !== label) counter.setAttribute('aria-label', label);
      }
    }
    track.addEventListener('pointerdown', event => {
      blockClick = false;
      if (!event.isPrimary || event.button !== 0) return;
      gesture = { id:event.pointerId, x:event.clientX, y:event.clientY, left:track.scrollLeft, mouse:event.pointerType==='mouse', moved:false };
    });
    track.addEventListener('pointermove', event => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
      if (Math.hypot(dx, dy) > 8) blockClick = true;
      if (!gesture.mouse || (!gesture.moved && Math.abs(dx) <= Math.max(8, Math.abs(dy)))) return;
      if (!gesture.moved) {
        gesture.moved = true;
        track.setPointerCapture(event.pointerId);
        track.classList.add('banner-dragging');
      }
      event.preventDefault();
      track.scrollLeft = gesture.left - dx;
    });
    function finish(event) {
      if (!gesture || gesture.id !== event.pointerId) return;
      const drag = gesture;
      gesture = null;
      if (drag.moved) {
        const step = track.clientWidth + 12;
        const target = Math.round(track.scrollLeft / step) * step;
        track.classList.remove('banner-dragging');
        if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
        track.scrollTo({ left:target, behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth' });
      }
      syncArrows();
    }
    track.addEventListener('pointerup', finish);
    track.addEventListener('pointercancel', finish);
    track.addEventListener('lostpointercapture', () => { gesture = null; track.classList.remove('banner-dragging'); });
    track.addEventListener('click', event => {
      if (blockClick && event.detail !== 0) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    track.addEventListener('scroll', syncArrows, { passive:true });
    track.addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const step = track.clientWidth + 12, index = Math.round(track.scrollLeft / step);
      const left = event.key === 'Home' ? 0 : event.key === 'End' ? track.scrollWidth : (index + (event.key === 'ArrowRight' ? 1 : -1)) * step;
      track.scrollTo({left,behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});
    });
    const observer = new ResizeObserver(() => {
      if (lastWidth !== track.clientWidth) {
        lastWidth = track.clientWidth;
        track.scrollTo({left:selected * (lastWidth + 12),behavior:'instant'});
      }
      syncArrows();
    });
    observer.observe(track);
    observers.set(track, observer);
    syncArrows();
  }
  const connect = () => {
    for (const [track, observer] of observers) if (!track.isConnected) { observer.disconnect(); observers.delete(track); }
    document.querySelectorAll('#home-banners').forEach(setup);
  };
  new MutationObserver(connect).observe(document.getElementById('app'), { childList:true });
  connect();
})();
