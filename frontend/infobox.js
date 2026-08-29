/* =============================================================================
   QuantView AI — infobox.js
   Reusable "ⓘ" info-icon popover system.

   Usage in HTML:
     <button class="info-btn" data-info="rsi" aria-label="What is RSI?">ⓘ</button>

   Behavior implemented per spec:
   - desktop: click opens; mobile: tap opens (same handler — no separate path needed)
   - only one popover open at a time
   - click outside closes it
   - Escape closes it and returns focus to the triggering button
   - popover stays inside the viewport (flips/clamps as needed)
   - no page jump, no horizontal overflow
   - keyboard accessible: real <button> elements, Enter/Space open natively,
     Escape closes
   - semantic HTML, aria-expanded on the trigger, role="dialog" on the popover
============================================================================= */

(function () {
  let _openBtn = null;
  let _popoverEl = null;

  function _closePopover() {
    if (_popoverEl) {
      _popoverEl.remove();
      _popoverEl = null;
    }
    if (_openBtn) {
      _openBtn.setAttribute('aria-expanded', 'false');
      _openBtn = null;
    }
    document.removeEventListener('click', _onDocClick, true);
    document.removeEventListener('keydown', _onKeyDown, true);
    window.removeEventListener('resize', _closePopover);
    window.removeEventListener('scroll', _onWindowScroll, true);
  }

  function _onDocClick(e) {
    if (_popoverEl && !_popoverEl.contains(e.target) && e.target !== _openBtn) {
      _closePopover();
    }
  }

  function _onWindowScroll(e) {
    // If the scroll happened inside the popover or on the scrollbar, DO NOT close
    if (_popoverEl && (e.target === _popoverEl || _popoverEl.contains(e.target))) {
      return;
    }
    _closePopover();
  }


  function _onKeyDown(e) {
    if (e.key === 'Escape') {
      const btn = _openBtn;
      _closePopover();
      if (btn) btn.focus();
    }
  }

  function _buildContent(key) {
    const g = (window.QV_GLOSSARY || {})[key];
    if (!g) {
      return `<div class="info-pop-title">Not documented</div>
              <p class="info-pop-section">No explanation is available for this metric yet.</p>`;
    }
    let dynamicHtml = '';
    try {
      if (typeof g.dynamic === 'function') {
        dynamicHtml = g.dynamic(window._qvLastData || null) || '';
      }
    } catch (err) {
      dynamicHtml = '';
    }
    return `
      <div class="info-pop-title" id="info-pop-title">ⓘ ${g.title || key}</div>
      ${g.what_it_is ? `<div class="info-pop-label">What it is</div><p class="info-pop-section">${g.what_it_is}</p>` : ''}
      ${g.how_to_interpret ? `<div class="info-pop-label">How to interpret</div><p class="info-pop-section">${g.how_to_interpret}</p>` : ''}
      ${g.how_quantview_uses_it ? `<div class="info-pop-label">How QuantView uses it</div><p class="info-pop-section">${g.how_quantview_uses_it}</p>` : ''}
      ${g.range_or_units ? `<div class="info-pop-label">Range / units</div><p class="info-pop-section">${g.range_or_units}</p>` : ''}
      ${dynamicHtml}
      ${g.caution ? `<p class="info-pop-caution">⚠ ${g.caution}</p>` : ''}
    `;
  }

  function _positionPopover(btn, pop) {
    // Reset first so measurements are accurate
    pop.style.left = '0px';
    pop.style.top  = '0px';
    pop.style.visibility = 'hidden';
    document.body.appendChild(pop);

    const btnRect  = btn.getBoundingClientRect();
    const popRect  = pop.getBoundingClientRect();
    const margin   = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Horizontal: center under the button, clamped to viewport
    let left = btnRect.left + btnRect.width / 2 - popRect.width / 2;
    left = Math.max(margin, Math.min(left, vw - popRect.width - margin));

    // Vertical: prefer below the button; flip above if not enough room
    let top = btnRect.bottom + 8;
    let arrowAbove = true; // arrow points up toward the button (popover is below)
    if (top + popRect.height + margin > vh) {
      const above = btnRect.top - popRect.height - 8;
      if (above >= margin) {
        top = above;
        arrowAbove = false; // popover is above, arrow points down
      } else {
        // Neither fits perfectly — clamp within viewport as a fallback
        top = Math.max(margin, Math.min(top, vh - popRect.height - margin));
      }
    }

    pop.style.left = `${Math.round(left + window.scrollX)}px`;
    pop.style.top  = `${Math.round(top  + window.scrollY)}px`;
    pop.classList.toggle('info-pop-arrow-up', arrowAbove);
    pop.classList.toggle('info-pop-arrow-down', !arrowAbove);
    pop.style.visibility = 'visible';
  }

  function _openPopover(btn) {
    const key = btn.getAttribute('data-info');
    const pop = document.createElement('div');
    pop.className = 'info-popover';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-labelledby', 'info-pop-title');
    pop.setAttribute('tabindex', '-1');
    pop.innerHTML = _buildContent(key);

    _popoverEl = pop;
    _openBtn = btn;
    btn.setAttribute('aria-expanded', 'true');

    _positionPopover(btn, pop);

    // Wire up close interactions (deferred so this click doesn't immediately close it)
    setTimeout(() => {
      document.addEventListener('click', _onDocClick, true);
      document.addEventListener('keydown', _onKeyDown, true);
      window.addEventListener('resize', _closePopover);
      window.addEventListener('scroll', _onWindowScroll, true);
    }, 0);

  }

  function _onInfoBtnClick(e) {
    const btn = e.currentTarget;
    e.preventDefault();
    e.stopPropagation();
    if (_openBtn === btn) {
      _closePopover();
      return;
    }
    _closePopover();
    _openPopover(btn);
  }

  function initInfoIcons(root) {
    const scope = root || document;
    scope.querySelectorAll('.info-btn').forEach((btn) => {
      if (btn._qvBound) return;
      btn._qvBound = true;
      btn.setAttribute('type', 'button');
      btn.setAttribute('aria-expanded', 'false');
      if (!btn.hasAttribute('aria-haspopup')) btn.setAttribute('aria-haspopup', 'dialog');
      btn.addEventListener('click', _onInfoBtnClick);
    });
  }

  window.QV_initInfoIcons = initInfoIcons;
  window.QV_closeInfoPopover = _closePopover;

  document.addEventListener('DOMContentLoaded', () => initInfoIcons(document));
})();
