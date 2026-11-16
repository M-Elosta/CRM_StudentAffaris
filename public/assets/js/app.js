/*
 * Employer Relations CRM — the one client script.
 *
 * Pages arrive complete from the server; this file only adds behaviour,
 * attached through data- attributes and htmx events. No framework, no build.
 *
 *   1. htmx settings          which responses are swapped
 *   2. Busy state             spinner + disabled buttons while a request runs
 *   3. Toasts                 messages from the server (flash or HX-Trigger)
 *   4. Dialog                 the shared <dialog> that forms load into
 *   5. Confirmations          [data-confirm] forms ("Delete Zayvora Digital?")
 *   6. Unsaved changes        [data-guard] forms ask before their input is lost
 *   7. Keyboard and menus     "/" shortcut, Escape, account menu, suggestions, drawer
 *   8. Charts                 <script type="application/json" data-chart> blocks
 *   9. Failures               network errors and 5xx become an error toast
 *  10. Session expiry         warning before the idle limit signs the user out
 */
(function () {
  'use strict';

  const NETWORK_ERROR = 'That did not work. Check your connection and try again.';
  const TOAST_MS = 6000;

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));

  function csrfToken() {
    const meta = $('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  /* ── 1. htmx settings ─────────────────────────────────────────────────── */
  if (window.htmx) {
    // Validation errors (422) and edit conflicts (409) come back as the form
    // with messages, so they are swapped like a success. Other 4xx are
    // swapped too (the server sends a toast and HX-Reswap: none for partial
    // requests, and a full error page for navigations). 5xx are not swapped.
    window.htmx.config.responseHandling = [
      { code: '204', swap: false },
      { code: '[23]..', swap: true },
      { code: '422', swap: true },
      { code: '409', swap: true },
      { code: '4..', swap: true, error: true },
      { code: '5..', swap: false, error: true },
      { code: '...', swap: false },
    ];
  }

  /* ── 2. Busy state ────────────────────────────────────────────────────── */
  const busyByRequest = new WeakMap();

  function setBusy(buttons, busy) {
    for (const button of buttons) {
      if (busy) {
        button.setAttribute('aria-busy', 'true');
        if (button.tagName === 'BUTTON') button.disabled = true;
      } else {
        button.removeAttribute('aria-busy');
        if (button.tagName === 'BUTTON') button.disabled = false;
      }
    }
  }

  /** The buttons to mark busy for a request started by elt. */
  function buttonsFor(elt, event) {
    if (elt.tagName === 'FORM') {
      const submitter = event && event.detail.requestConfig && event.detail.requestConfig.triggeringEvent;
      if (submitter && submitter.submitter) return [submitter.submitter];
      return $$('button[type="submit"]', elt);
    }
    if (elt.classList && elt.classList.contains('btn')) return [elt];
    return [];
  }

  document.addEventListener('htmx:beforeRequest', (event) => {
    const buttons = buttonsFor(event.detail.elt, event);
    setBusy(buttons, true);
    busyByRequest.set(event.detail.xhr, buttons);
    const target = event.detail.target;
    if (target && target.id === 'results') {
      target.classList.add('htmx-request');
      target.setAttribute('aria-busy', 'true');
    }
  });

  document.addEventListener('htmx:afterRequest', (event) => {
    setBusy(busyByRequest.get(event.detail.xhr) || [], false);
    const results = document.getElementById('results');
    if (results) {
      results.classList.remove('htmx-request');
      results.setAttribute('aria-busy', 'false');
    }
  });

  // A form that is not handled by htmx (sign-in, sign-out) submits natively:
  // its button shows the spinner until the next page arrives.
  document.addEventListener('submit', (event) => {
    if (event.defaultPrevented) return;
    const form = event.target;
    const buttons = event.submitter ? [event.submitter] : $$('button[type="submit"]', form);
    // Disabled after the form data has been collected, so the submitter still counts.
    window.setTimeout(() => setBusy(buttons, true), 0);
  });
  // Coming back with the browser's back button must not leave a button spinning.
  window.addEventListener('pageshow', () => setBusy($$('[aria-busy="true"].btn'), false));

  /* ── 3. Toasts ────────────────────────────────────────────────────────── */
  function scheduleDismiss(toast) {
    if (toast.classList.contains('toast--error')) return; // errors stay until dismissed
    let timer = null;
    const start = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => toast.remove(), TOAST_MS);
    };
    const pause = () => window.clearTimeout(timer);
    toast.addEventListener('mouseenter', pause);
    toast.addEventListener('mouseleave', start);
    toast.addEventListener('focusin', pause);
    toast.addEventListener('focusout', start);
    start();
  }

  function initToasts(root) {
    for (const toast of $$('[data-toast]', root)) {
      if (toast.dataset.ready) continue;
      toast.dataset.ready = 'true';
      scheduleDismiss(toast);
    }
  }

  /** An icon from the sprite, as the icon() macro renders it. */
  function iconElement(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '/assets/icons.svg#' + name);
    svg.append(use);
    return svg;
  }

  /** Show a message in the toast stack. kind: 'success' | 'error'. */
  function showToast(message, kind) {
    const stack = document.getElementById('toasts');
    if (!stack || !message) return;
    const toast = document.createElement('div');
    toast.className = kind === 'error' ? 'toast toast--error' : 'toast';
    toast.dataset.toast = '';
    if (kind === 'error') toast.setAttribute('role', 'alert');
    const text = document.createElement('span');
    text.className = 'toast__message';
    text.textContent = message;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast__close';
    close.dataset.action = 'dismiss-toast';
    close.setAttribute('aria-label', 'Dismiss');
    close.append(iconElement('close'));
    toast.append(text, close);
    stack.append(toast);
    initToasts(stack);
  }

  // HX-Trigger: {"toast": {"kind": "success", "message": "Employer saved"}}
  document.addEventListener('toast', (event) => {
    const detail = event.detail || {};
    showToast(detail.message, detail.kind);
  });

  /* ── 4. Dialog ────────────────────────────────────────────────────────── */
  const dialog = () => document.getElementById('dialog');
  let dialogOpener = null;

  function openDialog() {
    const element = dialog();
    if (!element) return;
    if (!element.open) element.showModal();
    const first = $(
      '[autofocus], .dialog__body input:not([type="hidden"]), .dialog__body select, .dialog__body textarea',
      element
    );
    if (first) first.focus();
  }

  function closeDialog(force) {
    const element = dialog();
    if (!element || !element.open) return;
    if (!force && !confirmLeavingDirty(element)) return;
    element.close();
  }

  document.addEventListener('click', (event) => {
    const opener = event.target.closest('[data-opens-dialog]');
    if (opener) dialogOpener = opener;
    const closer = event.target.closest('[data-action="close-dialog"]');
    if (closer) {
      event.preventDefault();
      closeDialog(false);
    }
  });

  document.addEventListener('htmx:afterSwap', (event) => {
    const target = event.detail.target;
    if (!target) return;
    const element = dialog();
    if (element && (target.id === 'dialog-body' || element.contains(target))) {
      openDialog();
      const error = $('[data-form-error]', element);
      const invalid = $('[aria-invalid="true"]', element);
      if (invalid) invalid.focus();
      else if (error) error.focus();
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    const element = dialog();
    if (!element) return;
    // Escape closes the dialog, after asking when there are unsaved changes.
    element.addEventListener('cancel', (event) => {
      if (!confirmLeavingDirty(element)) event.preventDefault();
    });
    element.addEventListener('close', () => {
      $('#dialog-body', element).replaceChildren();
      if (dialogOpener && document.contains(dialogOpener)) dialogOpener.focus();
      dialogOpener = null;
    });
  });

  /* ── 5. Confirmations ─────────────────────────────────────────────────── */
  /** Ask in the shared dialog; calls onConfirm when the person agrees. */
  function askConfirmation({ title, text, action }, onConfirm) {
    const element = dialog();
    if (!element) {
      if (window.confirm(title)) onConfirm();
      return;
    }
    const opener = document.activeElement;
    const header = document.createElement('div');
    header.className = 'dialog__header';
    const heading = document.createElement('h2');
    heading.id = 'dialog-title';
    heading.textContent = title;
    heading.setAttribute('dir', 'auto');
    header.append(heading);

    const body = document.createElement('div');
    body.className = 'dialog__body';
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    body.append(paragraph);

    const footer = document.createElement('div');
    footer.className = 'dialog__footer';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn';
    cancel.textContent = 'Cancel';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn--danger-solid';
    confirm.textContent = action || 'Delete';
    footer.append(cancel, confirm);

    $('#dialog-body', element).replaceChildren(header, body, footer);
    element.classList.add('dialog--sm');
    const finish = () => {
      element.classList.remove('dialog--sm');
      element.close();
      if (opener && document.contains(opener)) opener.focus();
    };
    cancel.addEventListener('click', finish);
    confirm.addEventListener('click', () => {
      finish();
      onConfirm();
    });
    if (!element.open) element.showModal();
    cancel.focus();
  }

  // Capture phase: runs before htmx sees the submit of a boosted form.
  document.addEventListener(
    'submit',
    (event) => {
      const form = event.target;
      if (!form.matches('[data-confirm]') || form.dataset.confirmed === 'true') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      askConfirmation(
        {
          title: form.dataset.confirmTitle,
          text: form.dataset.confirmText,
          action: form.dataset.confirmAction,
        },
        () => {
          form.dataset.confirmed = 'true';
          form.requestSubmit();
        }
      );
    },
    true
  );

  /* ── 6. Unsaved changes ───────────────────────────────────────────────── */
  const LEAVE_MESSAGE = 'You have changes that are not saved. Leave without saving them?';

  document.addEventListener('input', (event) => {
    const form = event.target.closest && event.target.closest('form[data-guard]');
    if (form) form.dataset.dirty = 'true';
  });
  document.addEventListener('change', (event) => {
    const form = event.target.closest && event.target.closest('form[data-guard]');
    if (form) form.dataset.dirty = 'true';
  });
  document.addEventListener('submit', (event) => {
    if (event.target.dataset) delete event.target.dataset.dirty;
  });

  /** True when nothing unsaved would be lost in root, or the person agrees to lose it. */
  function confirmLeavingDirty(root) {
    const dirty = $$('form[data-guard][data-dirty="true"]', root);
    if (!dirty.length) return true;
    if (!window.confirm(LEAVE_MESSAGE)) return false;
    for (const form of dirty) delete form.dataset.dirty;
    return true;
  }

  window.addEventListener('beforeunload', (event) => {
    if ($('form[data-guard][data-dirty="true"]')) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  // A boosted link or form elsewhere on the page would replace the form.
  document.addEventListener('htmx:confirm', (event) => {
    const elt = event.detail.elt;
    // Navigations (boosted links and forms) replace #main.
    if (!event.detail.target || event.detail.target.id !== 'main') return;
    const dirty = $$('form[data-guard][data-dirty="true"]').filter((form) => !form.contains(elt));
    if (!dirty.length) return;
    event.preventDefault();
    if (window.confirm(LEAVE_MESSAGE)) {
      for (const form of dirty) delete form.dataset.dirty;
      event.detail.issueRequest(true);
    }
  });

  /* ── 7. Keyboard and menus ────────────────────────────────────────────── */
  const isTyping = (element) =>
    element && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName));

  function closeMenus(except) {
    for (const menu of $$('details[data-menu][open]')) {
      if (menu !== except) menu.open = false;
    }
  }

  function hideSuggestions() {
    const box = document.getElementById('search-suggestions');
    if (box) box.hidden = true;
    const input = document.getElementById('global-search');
    if (input) input.setAttribute('aria-expanded', 'false');
  }

  function setSidebar(open) {
    const sidebar = document.getElementById('sidebar');
    const toggle = $('[data-action="toggle-sidebar"]');
    if (!sidebar || !toggle) return;
    sidebar.dataset.open = open ? 'true' : 'false';
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      const link = $('.nav__link', sidebar);
      if (link) link.focus();
    }
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !isTyping(event.target) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const search = $('[data-shortcut="/"]');
      if (search) {
        event.preventDefault();
        search.focus();
        search.select();
      }
    }
    if (event.key === 'Escape') {
      closeMenus(null);
      hideSuggestions();
      const sidebar = document.getElementById('sidebar');
      if (sidebar && sidebar.dataset.open === 'true') {
        setSidebar(false);
        const toggle = $('[data-action="toggle-sidebar"]');
        if (toggle) toggle.focus();
      }
    }
  });

  document.addEventListener('click', (event) => {
    const menu = event.target.closest('details[data-menu]');
    closeMenus(menu);
    if (!event.target.closest('.topbar__search')) hideSuggestions();

    if (event.target.closest('[data-action="toggle-sidebar"]')) {
      const sidebar = document.getElementById('sidebar');
      setSidebar(!(sidebar && sidebar.dataset.open === 'true'));
    } else if (!event.target.closest('#sidebar') || event.target.closest('.nav__link')) {
      const sidebar = document.getElementById('sidebar');
      if (sidebar && sidebar.dataset.open === 'true') setSidebar(false);
    }

    const dismiss = event.target.closest('[data-action="dismiss-toast"]');
    if (dismiss) {
      const toast = dismiss.closest('[data-toast]');
      if (toast) toast.remove();
    }
  });

  // Suggestions appear when the server returned some, and go when it returned none.
  document.addEventListener('htmx:afterSwap', (event) => {
    const box = event.detail.target;
    if (!box || box.id !== 'search-suggestions') return;
    const input = document.getElementById('global-search');
    const hasItems = box.children.length > 0 && input && input.value.trim().length > 0;
    box.hidden = !hasItems;
    if (input) input.setAttribute('aria-expanded', hasItems ? 'true' : 'false');
  });

  // Arrow down from the search box moves into the suggestions.
  document.addEventListener('keydown', (event) => {
    const box = document.getElementById('search-suggestions');
    if (!box || box.hidden) return;
    const items = $$('a, [role="option"]', box);
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' && (event.target.id === 'global-search' || index >= 0)) {
      event.preventDefault();
      items[Math.min(index + 1, items.length - 1)].focus();
    } else if (event.key === 'ArrowUp' && index >= 0) {
      event.preventDefault();
      if (index === 0) document.getElementById('global-search').focus();
      else items[index - 1].focus();
    }
  });

  /* ── 8. Charts ────────────────────────────────────────────────────────── */
  const CHART_INK = '#363c48';
  const CHART_ACCENT = '#c41230';
  const CHART_GRID = '#eceef1';
  const CHART_TEXT = '#4b5260';

  /**
   * Build a Chart.js configuration from the server's neutral description:
   * { type: 'bar'|'line', labels, series: [{ label, data, accent? }], xLabel, yLabel, horizontal? }
   */
  function chartConfig(spec) {
    const single = spec.series.length === 1;
    const datasets = spec.series.map((series, index) => {
      const colour = series.accent || index > 0 ? CHART_ACCENT : CHART_INK;
      return {
        label: series.label,
        data: series.data,
        backgroundColor: colour,
        borderColor: colour,
        borderWidth: spec.type === 'line' ? 2 : 0,
        pointRadius: spec.type === 'line' ? 2 : 0,
        maxBarThickness: 28,
        tension: 0,
        fill: false,
      };
    });
    const valueAxis = {
      beginAtZero: true,
      ticks: { precision: 0, color: CHART_TEXT },
      grid: { color: CHART_GRID },
      border: { display: false },
      title: { display: Boolean(spec.yLabel), text: spec.yLabel, color: CHART_TEXT },
    };
    const categoryAxis = {
      ticks: { color: CHART_TEXT, autoSkip: true, maxRotation: 0 },
      grid: { display: false },
      title: { display: Boolean(spec.xLabel), text: spec.xLabel, color: CHART_TEXT },
    };
    return {
      type: spec.type === 'line' ? 'line' : 'bar',
      data: { labels: spec.labels, datasets },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: spec.horizontal ? 'y' : 'x',
        plugins: {
          legend: { display: !single, position: 'bottom', labels: { color: CHART_TEXT, boxWidth: 12 } },
          tooltip: { intersect: false, mode: 'index' },
        },
        scales: spec.horizontal ? { x: valueAxis, y: categoryAxis } : { x: categoryAxis, y: valueAxis },
      },
    };
  }

  let chartLibrary = null;

  /** Load Chart.js once, the first time a page has a chart (same version as this script). */
  function loadChartLibrary() {
    if (window.Chart) return Promise.resolve();
    if (!chartLibrary) {
      chartLibrary = new Promise((resolve, reject) => {
        const own = $('script[src*="/assets/js/app.js"]');
        const version = own ? new URL(own.src).searchParams.get('v') || '' : '';
        const script = document.createElement('script');
        script.src = `/vendor/chart.umd.min.js?v=${encodeURIComponent(version)}`;
        script.onload = resolve;
        script.onerror = reject;
        document.head.append(script);
      });
    }
    return chartLibrary;
  }

  function initCharts(root) {
    if (!$('script[type="application/json"][data-chart]', root)) return;
    if (!window.Chart) {
      loadChartLibrary()
        .then(() => initCharts(root))
        .catch(() => showToast('The charts could not be loaded. Reload the page to try again.', 'error'));
      return;
    }
    window.Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    window.Chart.defaults.font.size = 12;
    for (const block of $$('script[type="application/json"][data-chart]', root)) {
      const canvas = block.parentElement && $('canvas', block.parentElement);
      if (!canvas || window.Chart.getChart(canvas)) continue;
      try {
        window.Chart.getChart(canvas) || new window.Chart(canvas, chartConfig(JSON.parse(block.textContent)));
      } catch (err) {
        canvas.replaceWith(document.createTextNode('The chart could not be drawn.'));
        console.error(err);
      }
    }
  }

  /* ── 9. Failures ──────────────────────────────────────────────────────── */
  document.addEventListener('htmx:sendError', () => showToast(NETWORK_ERROR, 'error'));
  document.addEventListener('htmx:responseError', (event) => {
    const xhr = event.detail.xhr;
    // A 4xx carries its own message (a toast or a rendered page); only 5xx need this one.
    if (xhr.status > 0 && xhr.status < 500) return;
    showToast(NETWORK_ERROR, 'error');
  });

  /* ── 10. Session expiry ───────────────────────────────────────────────── */
  let warnTimer = null;
  let expireTimer = null;
  let countdownTimer = null;

  function sessionTimes() {
    const idle = Number(document.body.dataset.sessionIdle || 0);
    const warn = Number(document.body.dataset.sessionWarn || 0);
    return { idle, warn };
  }

  function resetSessionTimers() {
    const { idle, warn } = sessionTimes();
    if (!idle) return;
    window.clearTimeout(warnTimer);
    window.clearTimeout(expireTimer);
    window.clearInterval(countdownTimer);
    warnTimer = window.setTimeout(showSessionWarning, Math.max(0, idle - warn) * 1000);
    expireTimer = window.setTimeout(() => {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.assign(`/login?next=${next}`);
    }, idle * 1000);
  }

  function showSessionWarning() {
    const warning = document.getElementById('session-warning');
    if (!warning) return;
    const output = $('[data-session-countdown]', warning);
    let remaining = sessionTimes().warn;
    const render = () => {
      const minutes = Math.floor(remaining / 60);
      const seconds = remaining % 60;
      output.textContent = minutes ? `${minutes} min ${seconds} s` : `${seconds} seconds`;
    };
    render();
    countdownTimer = window.setInterval(() => {
      remaining = Math.max(0, remaining - 1);
      render();
    }, 1000);
    if (!warning.open) warning.showModal();
  }

  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-action="extend-session"]')) return;
    const warning = document.getElementById('session-warning');
    fetch('/session/extend', {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrfToken() },
      credentials: 'same-origin',
    })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        if (warning && warning.open) warning.close();
        resetSessionTimers();
      })
      .catch(() => showToast(NETWORK_ERROR, 'error'));
  });

  document.addEventListener('htmx:afterRequest', resetSessionTimers);

  /* ── Start ────────────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    initToasts(document);
    initCharts(document);
    resetSessionTimers();
  });
  document.addEventListener('htmx:afterSettle', (event) => {
    initToasts(document);
    initCharts(event.detail.elt || document);
  });
})();
