/* =====================================================================
   Admin Console: the same dropdown list as Rasumi Apps (dropdowns.js).
   A native <select>'s open list is drawn by the OS / webview (white, its own font, a gap under the box),
   so it can't match the app. This keeps every <select> exactly as it is (same box, same styling, same
   onchange handlers, same .value) and only replaces the OPEN LIST with the app's list:
     - attached to the box (no gap): box bottom corners go square, list top corners square
     - dark glass list, light text (also in light theme), hover / selected in the app's purple
   Skipped: <select multiple>, size > 1, or data-native="1" on the select or an ancestor.
   Same look as the Store Management branch dropdown (store_management.css .store-branch-menu).
   ===================================================================== */
(function () {
    'use strict';
    let cur = null;          // { sel, box, menu, idx, search }
    const SEARCH_MIN = 12;   // lists longer than this get a search box

    function usable(sel) {
        return sel && sel.tagName === 'SELECT' && !sel.multiple && !(sel.size > 1) && !sel.disabled
            && !sel.closest('[data-native="1"]');
    }
    // the element that LOOKS like the box: some selects sit inside a styled pill (icon + chevron)
    function boxOf(sel) {
        return sel;               // every select is drawn as its own box now (dropdowns.css)
    }
    function close() {
        if (!cur) return;
        cur.menu.remove();
        cur.box.classList.remove('rdd-open', 'rdd-open-up');
        cur = null;
    }
    function choose(i) {
        if (!cur) return;
        const sel = cur.sel;
        const changed = sel.selectedIndex !== i;
        sel.selectedIndex = i;
        close();
        sel.focus();
        if (changed) {
            sel.dispatchEvent(new Event('input', { bubbles: true }));
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }
    function place() {
        if (!cur) return;
        const r = cur.box.getBoundingClientRect();
        if (!r.width) { close(); return; }
        const m = cur.menu;
        m.style.left = r.left + 'px';
        m.style.width = r.width + 'px';          // exactly as wide as the box (no wider list)
        const below = window.innerHeight - r.bottom - 8, above = r.top - 8;
        m.style.maxHeight = '';
        const h = Math.min(m.scrollHeight, 280);
        if (below >= h || below >= above) {           // normal: under the box, attached
            m.classList.remove('rdd-up'); cur.box.classList.remove('rdd-open-up'); cur.box.classList.add('rdd-open');
            m.style.top = (r.bottom - 1) + 'px'; m.style.bottom = '';
            m.style.maxHeight = Math.max(120, Math.min(280, below)) + 'px';
        } else {                                       // no room: above the box, attached
            m.classList.add('rdd-up'); cur.box.classList.remove('rdd-open'); cur.box.classList.add('rdd-open-up');
            m.style.bottom = (window.innerHeight - r.top - 1) + 'px'; m.style.top = '';
            m.style.maxHeight = Math.max(120, Math.min(280, above)) + 'px';
        }
    }
    function mark(i) {
        if (!cur) return;
        cur.idx = i;
        cur.menu.querySelectorAll('.rdd-opt').forEach(o => o.classList.toggle('rdd-hi', +o.dataset.i === i));
        const o = cur.menu.querySelector('.rdd-opt[data-i="' + i + '"]');
        if (o) o.scrollIntoView({ block: 'nearest' });
    }
    function open(sel) {
        close();
        const box = boxOf(sel);
        const menu = document.createElement('div');
        menu.className = 'rdd-menu' + ('');   // dark header keeps a dark list
        menu.setAttribute('role', 'listbox');
        const fs = parseFloat(getComputedStyle(sel).fontSize) || 13;
        menu.style.fontSize = Math.max(11, Math.min(14, fs)) + 'px';
        let lastGroup = null;
        Array.from(sel.options).forEach((opt, i) => {
            if (opt.hidden || opt.style.display === 'none') return;
            const g = opt.parentElement && opt.parentElement.tagName === 'OPTGROUP' ? opt.parentElement : null;
            if (g && g !== lastGroup) {
                const gl = document.createElement('div'); gl.className = 'rdd-group'; gl.textContent = g.label; menu.appendChild(gl);
            }
            lastGroup = g;
            const d = document.createElement('div');
            d.className = 'rdd-opt' + (i === sel.selectedIndex ? ' rdd-sel' : '') + (opt.disabled ? ' rdd-dis' : '');
            d.dataset.i = i;
            d.setAttribute('role', 'option');
            d.textContent = opt.textContent;
            if (!opt.disabled) d.addEventListener('mousedown', e => { e.preventDefault(); choose(i); });
            d.addEventListener('mousemove', () => mark(i));
            menu.appendChild(d);
        });
        document.body.appendChild(menu);
        cur = { sel, box, menu, idx: sel.selectedIndex, search: null };
        // long list: a search box on top (filters as you type; arrows / Enter work on the filtered list)
        if (sel.options.length > SEARCH_MIN) {
            const wrap = document.createElement('div');
            wrap.className = 'rdd-search-wrap';
            const inp = document.createElement('input');
            inp.type = 'text'; inp.className = 'rdd-search'; inp.placeholder = 'Search…'; inp.autocomplete = 'off';
            wrap.appendChild(inp);
            menu.insertBefore(wrap, menu.firstChild);
            inp.addEventListener('input', () => filter(inp.value));
            cur.search = inp;
        }
        place();
        mark(sel.selectedIndex);
        if (cur.search) setTimeout(() => { if (cur && cur.search) cur.search.focus(); }, 0);
    }
    function filter(q) {
        if (!cur) return;
        const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
        let first = -1, hiOk = false;
        cur.menu.querySelectorAll('.rdd-opt').forEach(o => {
            const t = o.textContent.toLowerCase();
            const show = words.every(w => t.includes(w));
            o.style.display = show ? '' : 'none';
            if (show && first < 0 && !o.classList.contains('rdd-dis')) first = +o.dataset.i;
            if (show && +o.dataset.i === cur.idx) hiOk = true;
        });
        cur.menu.querySelectorAll('.rdd-group').forEach(g => { g.style.display = words.length ? 'none' : ''; });
        let empty = cur.menu.querySelector('.rdd-empty');
        if (first < 0 && !empty) { empty = document.createElement('div'); empty.className = 'rdd-empty'; empty.textContent = 'No match'; cur.menu.appendChild(empty); }
        if (first >= 0 && empty) empty.remove();
        if (!hiOk) mark(first);
    }
    function visible(i) {
        const o = cur && cur.menu.querySelector('.rdd-opt[data-i="' + i + '"]');
        return !!o && o.style.display !== 'none';
    }

    // open our list instead of the native one
    document.addEventListener('mousedown', e => {
        if (cur && cur.menu.contains(e.target)) return;
        const sel = e.target.closest && e.target.closest('select');
        if (sel && usable(sel)) {
            e.preventDefault();
            if (cur && cur.sel === sel) { close(); return; }
            sel.focus();
            open(sel);
            return;
        }
        close();
    }, true);
    document.addEventListener('keydown', e => {
        const sel = document.activeElement;
        if (cur) {
            const opts = Array.from(cur.sel.options);
            const step = d => { let i = cur.idx; do { i += d; } while (i >= 0 && i < opts.length && (opts[i].disabled || opts[i].hidden || !visible(i))); if (i >= 0 && i < opts.length) mark(i); };
            const inSearch = cur.search && e.target === cur.search;
            if (e.key === 'Escape') { e.preventDefault(); const s0 = cur.sel; close(); s0.focus(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
            else if (e.key === 'Enter' || (e.key === ' ' && !inSearch)) { e.preventDefault(); if (cur.idx >= 0 && visible(cur.idx)) choose(cur.idx); }
            else if (e.key === 'Tab') close();
            return;
        }
        if (usable(sel) && (e.key === ' ' || e.key === 'Enter' || (e.altKey && e.key === 'ArrowDown') || e.key === 'F4')) {
            e.preventDefault();
            open(sel);
        }
    }, true);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', e => { if (cur && !cur.menu.contains(e.target)) close(); }, true);
    window.addEventListener('blur', close);
})();
