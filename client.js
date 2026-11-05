/**
 * Sidebar UI of the dsh-usage-panel plugin.
 *
 * Two seats:
 *  - shell.overlay  -> the always-on usage block at the sidebar foot (fixed position)
 *  - settings.section -> the configuration page
 *
 * All numbers come from the plugin backend over /plugin/usage-panel/*.
 */

window.__ModuleLoader__.load({
  id: 'dsh-usage-panel',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useCallback } = React;

    const API = '/plugin/usage-panel';

    /* ------------------------------------------------------------ helpers */

    async function api(path, init) {
      const res = await fetch(`${API}${path}`, {
        cache: 'no-store',
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init && init.headers) },
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`);
      return body;
    }

    function money(value, symbol) {
      if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
      const n = Math.abs(Number(value));
      const text = n >= 1000 ? n.toFixed(0) : n.toFixed(2);
      return `${symbol || '¥'}${text}`;
    }

    function statusLine(provider) {
      if (provider.status === 'error') return provider.error || '读取失败';
      if (provider.status === 'unconfigured') return '未配置';
      if (provider.status === 'pending') return '读取中';
      return '';
    }

    /* -------------------------------------------------------------- styles */

    const CSS = `
.up-layer { pointer-events: none; }
.up-anchor {
  position: fixed; left: var(--up-x, 9px); bottom: var(--up-bottom, 96px);
  width: var(--up-w, 214px); z-index: 30;
  pointer-events: auto; font-size: 11px; line-height: 15px;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
}
.up-block {
  position: relative;
  background: var(--up-plate, var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-base)));
  border: 0; padding: 2px 0;
  cursor: default; outline: none;
  transition: background-color .18s ease;
}
.up-anchor::before {
  content: ''; position: absolute; left: 0; right: 0; bottom: 100%; height: 18px;
  background: linear-gradient(to bottom, transparent, var(--up-plate, var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-base))));
  pointer-events: none;
}
.up-block.is-error .up-balance { color: var(--dsw-alias-label-secondary); }
.up-face {
  display: flex; align-items: center; justify-content: space-between;
  gap: 6px; padding: 6px 9px 5px; min-width: 0;
}
.up-who { display: flex; align-items: center; gap: 4px; min-width: 0; flex: 0 1 auto; }
.up-badge {
  flex: none; font-size: 10px; line-height: 13px; font-weight: 600; letter-spacing: .04em;
  padding: 0 3px; border-radius: 3px;
  color: var(--dsw-alias-label-secondary);
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 12%, transparent);
}
.up-badge.is-peak {
  color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 86%, var(--dsw-alias-label-primary));
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 18%, transparent);
}
.up-badge.is-off {
  color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 82%, var(--dsw-alias-label-primary));
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 15%, transparent);
}
.up-name {
  font-size: 11px; line-height: 15px; color: var(--dsw-alias-label-secondary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; min-width: 0;
}
.up-flag {
  flex: none; font-size: 11px; line-height: 13px; padding: 0 3px; border-radius: 3px;
  color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
}
.up-figures { display: flex; align-items: baseline; gap: 6px; flex: none; }
.up-balance {
  font-size: 15px; line-height: 20px; font-weight: 500; letter-spacing: -.01em;
  font-variant-numeric: tabular-nums;
}
.up-spent { font-size: 11px; line-height: 15px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.up-spent b { color: var(--dsw-alias-label-primary); font-weight: 500; }
.up-foot {
  display: flex; align-items: center; gap: 6px; padding: 0 8px 5px 9px; min-width: 0;
}
.up-dots { display: inline-flex; gap: 3px; flex: none; }
.up-dots i { width: 8px; height: 2px; border-radius: 1px; background: var(--dsw-alias-border-l2); }
.up-dots i.on { background: var(--dsw-alias-brand-primary); }
.up-when {
  font: inherit; font-size: 11px; line-height: 14px; color: var(--dsw-alias-label-secondary);
  flex: none; background: none; border: 0; padding: 0; cursor: pointer;
}
.up-when:hover { color: var(--dsw-alias-brand-primary); text-decoration: underline; }
.up-when:disabled { cursor: default; text-decoration: none; }
.up-spacer { flex: 1 1 auto; }
.up-btn {
  font: inherit; font-size: 11px; line-height: 14px; padding: 0; border: 0; background: none;
  color: var(--dsw-alias-label-secondary); cursor: pointer; flex: none;
}
.up-btn:hover { color: var(--dsw-alias-brand-primary); }
.up-anchor:hover .up-when, .up-anchor:focus-within .up-when { display: none; }

.up-pop {
  position: absolute; left: calc(100% + 12px); bottom: 0; width: 210px;
  background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px; padding: 8px 10px 7px; z-index: 31;
  box-shadow: 0 8px 24px rgba(16,24,40,.12);
  display: none;
}
.up-anchor:hover .up-pop, .up-anchor:focus-within .up-pop { display: block; }
.up-pop-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding-bottom: 5px; }
.up-pop-title { font-size: 12px; line-height: 18px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.up-pop-tag {
  flex: none; font-size: 11px; line-height: 16px; padding: 0 5px; border-radius: 4px;
  color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2);
}
.up-pop-tag.peak { color: var(--dsw-alias-state-warn-primary); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent); }
.up-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 12px; line-height: 20px; font-variant-numeric: tabular-nums; }
.up-row .k { color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.up-row .v { color: var(--dsw-alias-label-primary); }
.up-row.sub { font-size: 11px; line-height: 17px; padding-left: 8px; }
.up-row.sub .k, .up-row.sub .v { color: var(--dsw-alias-label-secondary); }
.up-pop-foot { padding-top: 6px; font-size: 11px; line-height: 15px; color: var(--dsw-alias-label-secondary); text-wrap: pretty; }

.up-set { display: flex; flex-direction: column; gap: 14px; max-width: none; width: 100%; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary); }
.up-set h3 { margin: 0; font-size: 13px; font-weight: 600; }
.up-set p { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.up-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 10px 12px; background: var(--dsw-alias-bg-layer-1); display: flex; flex-direction: column; gap: 8px; }
.up-line { display: flex; align-items: center; gap: 8px; }
.up-line label { font-size: 12px; color: var(--dsw-alias-label-secondary); min-width: 68px; }
.up-input {
  flex: 1 1 auto; min-width: 0; font: inherit; font-size: 12px; line-height: 18px;
  padding: 4px 7px; border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}
.up-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.up-act {
  font: inherit; font-size: 12px; line-height: 18px; padding: 4px 10px; border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary); cursor: pointer;
}
.up-act.primary { background: var(--dsw-alias-brand-primary); border-color: transparent; color: #fff; }
.up-act:disabled { opacity: .5; cursor: default; }
.up-hint { margin: 4px 0 0; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-secondary); }
.up-modal {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  width: 100vw; height: 100vh; box-sizing: border-box; padding: 28px;
  z-index: 70; pointer-events: auto;
  display: flex; align-items: center; justify-content: center;
}
.up-modal-scrim { position: absolute; inset: 0; background: color-mix(in srgb, #000 42%, transparent); }
.up-modal-panel {
  position: relative;
  margin: 0 auto;
  width: min(820px, calc(100vw - 56px));
  max-height: calc(100vh - 56px);
  box-sizing: border-box;
  overflow: auto;
  padding: 20px 24px 24px;
  border-radius: 12px;
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1));
  border: 1px solid var(--dsw-alias-border-l1);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.28);
}
.up-modal-x {
  position: absolute; top: 8px; right: 10px;
  font: inherit; font-size: 18px; line-height: 1;
  padding: 4px 7px; border: 0; border-radius: 6px;
  background: none; color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.up-modal-x:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.up-note { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.up-note.ok { color: var(--dsw-alias-state-success-primary); }
.up-note.bad { color: var(--dsw-alias-state-error-primary); }
.up-kv { display: flex; gap: 8px; font-size: 12px; line-height: 18px; }
.up-kv .k { color: var(--dsw-alias-label-secondary); min-width: 68px; }
`;

    /* --------------------------------------------------------------- state */

    function useUsage() {
      const [state, setState] = useState(null);
      const [error, setError] = useState('');
      const [refreshing, setRefreshing] = useState(false);
      const timer = useRef(null);
      const inflight = useRef(false);

      const load = useCallback(async () => {
        try {
          const next = await api('/state');
          setState(next);
          setError('');
        } catch (err) {
          setError(err.message || '读取失败');
        }
      }, []);

      useEffect(() => {
        load();
        const id = setInterval(load, 30000);
        const onFocus = () => load();
        window.addEventListener('focus', onFocus);
        return () => {
          clearInterval(id);
          window.removeEventListener('focus', onFocus);
          if (timer.current) clearTimeout(timer.current);
        };
      }, [load]);

      const refresh = useCallback(async () => {
        if (inflight.current) return;
        inflight.current = true;
        setRefreshing(true);
        try {
          const next = await api('/refresh', { method: 'POST' });
          setState(next);
          setError('');
        } catch (err) {
          setError(err.message || '刷新失败');
        } finally {
          inflight.current = false;
          setRefreshing(false);
        }
      }, []);

      return { state, error, load, refresh, refreshing };
    }

    /* ----------------------------------------------------------------- UI */

    function UsagePop({ provider, peak, state }) {
      const isOfficial = provider.kind === 'official';
      const peakTag =
        peak.window === 'peak'
          ? h('span', { className: 'up-pop-tag peak' }, '高峰时段')
          : h('span', { className: 'up-pop-tag' }, '空闲时段');
      const rows = [
        h(
          'div',
          { className: 'up-row', key: 'bal' },
          h('span', { className: 'k' }, '余额'),
          h('span', { className: 'v' }, money(provider.balance, provider.symbol)),
        ),
        h(
          'div',
          { className: 'up-row', key: 'today' },
          h('span', { className: 'k' }, '今日消耗'),
          h('span', { className: 'v' }, money(provider.spentToday, provider.symbol)),
        ),
      ];
      if (isOfficial) {
        rows.push(
          h(
            'div',
            { className: 'up-row sub', key: 'peak' },
            h('span', { className: 'k' }, '高峰时段'),
            h('span', { className: 'v' }, money(provider.spentPeak, provider.symbol)),
          ),
          h(
            'div',
            { className: 'up-row sub', key: 'off' },
            h('span', { className: 'k' }, '空闲时段'),
            h('span', { className: 'v' }, money(provider.spentOffpeak, provider.symbol)),
          ),
        );
      } else {
        rows.push(
          h(
            'div',
            { className: 'up-row', key: 'month' },
            h('span', { className: 'k' }, '本月已用'),
            h('span', { className: 'v' }, money(provider.monthUsed, provider.symbol)),
          ),
          h(
            'div',
            { className: 'up-row sub', key: 'since' },
            h('span', { className: 'k' }, '本月起算'),
            h('span', { className: 'v' }, provider.monthStartLabel || '—'),
          ),
        );
      }
      const foot = isOfficial
        ? `高峰 09:00-12:00 · 14:00-18:00，单价为空闲的 2 倍 · ${provider.updatedAt || state.refreshedAt || '—'} 读数`
        : `今日与本月均来自站点统计 · ${provider.updatedAt || state.refreshedAt || '—'} 读数`;

      return h(
        'div',
        { className: 'up-pop' },
        h(
          'div',
          { className: 'up-pop-head' },
          h('span', { className: 'up-pop-title' }, provider.shortName || provider.name),
          isOfficial ? peakTag : h('span', { className: 'up-pop-tag' }, provider.symbol === '$' ? '美元' : '人民币'),
        ),
        ...rows,
        h('div', { className: 'up-pop-foot' }, foot),
      );
    }

    /* The card's own 「设置」 button opens a panel this plugin owns outright.
       The host settings dialog is shell chrome with no public "open" call, so
       reaching it meant clicking a DOM node whose label and structure belong to
       someone else — it broke as soon as the trigger row changed. */
    let openOverlay = null;

    function UsageBlock(props) {
      const { state, error, refresh, refreshing } = useUsage();
      const [index, setIndex] = useState(0);
      const [settingsOpen, setSettingsOpen] = useState(false);
      /* Hovering opens the detail popup, so the rotation has to stop while the
         pointer (or keyboard focus) is on the block — otherwise the popup would
         swap sites underneath the reader. */
      const [paused, setPaused] = useState(false);

      useEffect(() => {
        ensureStyle();
        measureSidebar();
        const report = setTimeout(postLayoutReport, 800);
        // The session list mounts after this overlay, so the first pass can
        // measure a column whose scroll box does not exist yet; retry after it
        // settles, otherwise the card keeps covering the last rows.
        const settleA = setTimeout(measureSidebar, 260);
        const settleB = setTimeout(measureSidebar, 1500);
        // Theme switches and window resizes move the block and change the colours
        // behind it, so geometry is re-measured instead of assumed stable. The
        // extra report on each pass is what makes a theme regression visible from
        // the Host side without asking for a screenshot.
        let frame = 0;
        let reportTimer = 0;
        const resample = () => {
          if (frame) return;
          frame = window.requestAnimationFrame(() => {
            frame = 0;
            measureSidebar();
            clearTimeout(reportTimer);
            reportTimer = setTimeout(postLayoutReport, 400);
          });
        };
        const observer =
          typeof MutationObserver === 'function' ? new MutationObserver(resample) : null;
        if (observer) {
          observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['style', 'class', 'data-theme', 'data-color-scheme'],
          });
          if (document.body) {
            observer.observe(document.body, {
              attributes: true,
              attributeFilter: ['style', 'class'],
            });
          }
        }
        const scheme =
          typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
        if (scheme && scheme.addEventListener) scheme.addEventListener('change', resample);

        window.addEventListener('resize', resample, { passive: true });
        return () => {
          clearTimeout(report);
          clearTimeout(reportTimer);
          clearTimeout(settleA);
          clearTimeout(settleB);
          if (frame) window.cancelAnimationFrame(frame);
          if (observer) observer.disconnect();
          if (scheme && scheme.removeEventListener) scheme.removeEventListener('change', resample);
          window.removeEventListener('resize', resample);
        };
      }, []);

      /* Every shown site takes a turn, including one that has no key yet: the
         card is the only place that tells the user which sites exist, so
         hiding the unconfigured one would make "no data" look like a bug. */
      const providers = state ? state.providers.filter((p) => p.show) : [];

      useEffect(() => {
        if (providers.length <= 1 || paused) return undefined;
        const id = setInterval(() => setIndex((i) => (i + 1) % providers.length), 2800);
        return () => clearInterval(id);
      }, [providers.length, paused]);

      useEffect(() => {
        openOverlay = () => setSettingsOpen(true);
        return () => {
          openOverlay = null;
        };
      }, []);

      if (!state) {
        if (!error) return null;
        return h(
          'div',
          { className: 'up-layer' },
          h(
            'div',
            { className: 'up-anchor' },
            h(
              'div',
              { className: 'up-block is-error' },
              h(
                'div',
                { className: 'up-face' },
                h('div', { className: 'up-who' }, h('span', { className: 'up-name' }, 'Usage')),
                h('div', { className: 'up-figures' }, h('span', { className: 'up-balance' }, '—')),
              ),
              h(
                'div',
                { className: 'up-foot' },
                h('span', { className: 'up-when' }, error),
                h('span', { className: 'up-spacer' }),
                h('button', { className: 'up-btn', type: 'button', onClick: refresh }, '重试'),
              ),
            ),
          ),
        );
      }

      if (!providers.length) {
        return h(
          'div',
          { className: 'up-layer' },
          h(
            'div',
            { className: 'up-anchor' },
            h(
              'div',
              { className: 'up-block is-empty' },
              h(
                'div',
                { className: 'up-face' },
                h('div', { className: 'up-who' }, h('span', { className: 'up-name' }, 'API 用量')),
                h('div', { className: 'up-figures' }, h('span', { className: 'up-balance' }, '未配置')),
              ),
              h(
                'div',
                { className: 'up-foot' },
                h('span', { className: 'up-when' }, '填入密钥后显示余额'),
                h('span', { className: 'up-spacer' }),
                h(
                  'button',
                  {
                    className: 'up-btn',
                    type: 'button',
                    onClick: (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openSettings();
                    },
                  },
                  '去设置',
                ),
              ),
            ),
          ),
          settingsOpen ? h(SettingsOverlay, { onClose: () => setSettingsOpen(false) }) : null,
        );
      }

      const current = providers[index % providers.length];
      /* Peak pricing is a DeepSeek-official concept: a reseller bills its own
         rates, so the warm mask, the dot and the price hint must not leak onto
         a new-api site even when the wall clock says it is peak time. */
      const isOfficial = current.kind === 'official';
      const isPeak = isOfficial && Boolean(state.peak && state.peak.window === 'peak');
      const failed = current.status === 'error' || current.status === 'unconfigured';
      /* Retrying an unconfigured site cannot succeed — it needs a key, so that
         state sends the user to the settings page instead. */
      const needsSetup = current.status === 'unconfigured' || current.configured === false;
      const flag = statusLine(current);
      const classes = ['up-block', failed ? 'is-error' : ''].filter(Boolean).join(' ');

      return h(
        'div',
        { className: 'up-layer' },
        h(
          'div',
          {
            className: 'up-anchor',
            tabIndex: 0,
            'aria-label': '各平台余额与今日消耗',
            onMouseEnter: () => setPaused(true),
            onMouseLeave: () => setPaused(false),
            onFocus: () => setPaused(true),
            onBlur: () => setPaused(false),
          },
          h(
            'div',
            { className: classes },
            h(
              'div',
              { className: 'up-face' },
              h(
                'div',
                { className: 'up-who' },
                h('span', { className: 'up-name', title: current.name }, current.shortName || current.name),
                isOfficial
                  ? h(
                      'span',
                      {
                        className: `up-badge ${isPeak ? 'is-peak' : 'is-off'}`,
                        title: isPeak ? '高峰时段，单价为空闲的 2 倍' : '空闲时段，单价为高峰的一半',
                      },
                      isPeak ? '峰' : '闲',
                    )
                  : null,
                flag ? h('span', { className: 'up-flag' }, flag) : null,
              ),
              h(
                'div',
                { className: 'up-figures' },
                h('span', { className: 'up-balance' }, failed ? '—' : money(current.balance, current.symbol)),
                h(
                  'span',
                  { className: 'up-spent' },
                  '今日 ',
                  h('b', null, failed ? '—' : money(current.spentToday, current.symbol)),
                ),
              ),
            ),
            h(
              'div',
              { className: 'up-foot' },
              h(
                'span',
                { className: 'up-dots' },
                ...providers.map((p, i) =>
                  h('i', { key: p.id, className: i === index % providers.length ? 'on' : '' }),
                ),
              ),
              h(
                'button',
                {
                  className: 'up-when',
                  type: 'button',
                  title: '点击立即刷新',
                  onClick: (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    refresh();
                  },
                },
                refreshing ? '刷新中' : state.refreshedAt || '—',
              ),
              h('span', { className: 'up-spacer' }),
              h(
                'button',
                {
                  className: 'up-btn',
                  type: 'button',
                  onClick: (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (needsSetup) openSettings();
                    else if (failed) refresh();
                    else openSettings();
                  },
                },
                needsSetup ? '去设置' : failed ? '重试' : '设置',
              ),
            ),
          ),
          h(UsagePop, { provider: current, peak: state.peak || { window: 'offpeak' }, state }),
          settingsOpen ? h(SettingsOverlay, { onClose: () => setSettingsOpen(false) }) : null,
        ),
      );
    }

    /* ------------------------------------------------------------ settings */

    function SettingsOverlay({ onClose }) {
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [onClose]);
      return h(
        'div',
        { className: 'up-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Usage 面板设置' },
        h('div', { className: 'up-modal-scrim', onClick: onClose }),
        h(
          'div',
          { className: 'up-modal-panel' },
          h(
            'button',
            { className: 'up-modal-x', type: 'button', onClick: onClose, 'aria-label': '关闭设置' },
            '×',
          ),
          h(SettingsPage, { close: onClose }),
        ),
      );
    }

    function SettingsPage(props) {
      const [config, setConfig] = useState(null);
      const [draft, setDraft] = useState(null);
      const [note, setNote] = useState({ text: '', kind: '' });
      const noteTimer = useRef(0);
      function flashNote(next) {
        setNote(next);
        if (noteTimer.current) clearTimeout(noteTimer.current);
        noteTimer.current = setTimeout(() => setNote({ text: '', kind: '' }), next.kind === 'bad' ? 8000 : 2400);
      }
      useEffect(
        () => () => {
          if (noteTimer.current) clearTimeout(noteTimer.current);
        },
        [],
      );
      const [busy, setBusy] = useState(false);
      const [testResult, setTestResult] = useState({});

      useEffect(() => {
        ensureStyle();
      }, []);

      useEffect(() => {
        api('/config')
          .then((next) => {
            setConfig(next);
            setDraft(JSON.parse(JSON.stringify(next)));
          })
          .catch((err) => setNote({ text: err.message, kind: 'bad' }));
      }, []);

      if (!draft) return h('div', { className: 'up-set' }, h('p', null, '读取配置…'));

      function patchProvider(id, patch) {
        setDraft((prev) => ({
          ...prev,
          providers: prev.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        }));
      }

      function patchRoot(patch) {
        setDraft((prev) => ({ ...prev, ...patch }));
      }

      function addProvider(kind) {
        const id = `p${Date.now().toString(36)}`;
        setDraft((prev) => ({
          ...prev,
          providers: [
            ...prev.providers,
            {
              id,
              kind,
              source: kind === 'official' ? 'key' : '',
              name: kind === 'official' ? '官方 key' : '新站点',
              shortName: '',
              baseUrl: '',
              show: true,
              key: '',
              token: '',
            },
          ],
        }));
      }

      function removeProvider(id) {
        setDraft((prev) => ({ ...prev, providers: prev.providers.filter((p) => p.id !== id) }));
      }

      async function save() {
        setBusy(true);
        try {
          const next = await api('/config', { method: 'POST', body: JSON.stringify(draft) });
          setConfig(next);
          setDraft(JSON.parse(JSON.stringify(next)));
          flashNote({ text: '已保存 · 立即生效', kind: 'ok' });
        } catch (err) {
          flashNote({ text: err.message, kind: 'bad' });
        } finally {
          setBusy(false);
        }
      }

      async function test(provider) {
        setBusy(true);
        try {
          const result = await api('/test', { method: 'POST', body: JSON.stringify(provider) });
          setTestResult((prev) => ({ ...prev, [provider.id]: result }));
        } catch (err) {
          setTestResult((prev) => ({ ...prev, [provider.id]: { status: 'error', error: err.message } }));
        } finally {
          setBusy(false);
        }
      }

      const rows = draft.providers.map((provider) => {
        const isOfficial = provider.kind === 'official';
        const result = testResult[provider.id];
        return h(
          'div',
          { className: 'up-card', key: provider.id },
          h(
            'div',
            { className: 'up-line' },
            h('label', null, isOfficial ? '名称' : '站点地址'),
            h('input', {
              className: 'up-input',
              value: isOfficial ? provider.name : provider.baseUrl,
              placeholder: isOfficial ? 'DeepSeek 官方' : 'https://example.com（不带 /v1）',
              onChange: (event) =>
                patchProvider(provider.id, isOfficial ? { name: event.target.value } : { baseUrl: event.target.value }),
            }),
          ),
          h(
            'div',
            { className: 'up-line' },
            h('label', null, isOfficial ? '短名' : '显示短名'),
            h('input', {
              className: 'up-input',
              value: provider.shortName || '',
              placeholder: isOfficial ? '侧栏里显示的短名，如 DeepSeek' : '侧栏里显示的短名',
              onChange: (event) => patchProvider(provider.id, { shortName: event.target.value }),
            }),
          ),
          isOfficial
            ? h(
                'div',
                { className: 'up-line' },
                h('label', null, '数据来源'),
                h(
                  'select',
                  {
                    className: 'up-input',
                    value: provider.source === 'key' ? 'key' : 'account',
                    onChange: (event) => patchProvider(provider.id, { source: event.target.value }),
                  },
                  h('option', { value: 'account' }, 'DSH 已登录账号（不用填 key）'),
                  h('option', { value: 'key' }, '手填 API key'),
                ),
              )
            : null,
          isOfficial && provider.source !== 'key'
            ? h(
                'p',
                { className: 'up-hint' },
                '余额直接读 DSH 已登录的官方账号；要单独记某个 key 的余额，把来源改成「手填 API key」。',
              )
            : h(
                'div',
                { className: 'up-line' },
                h('label', null, isOfficial ? 'API key' : '访问令牌'),
            h('input', {
              className: 'up-input',
              type: 'password',
              value: isOfficial ? provider.key || '' : provider.token || '',
              placeholder: isOfficial
                ? provider.hasKey
                  ? `已保存 ${provider.keyHint}`
                  : 'sk-…（只存在本机）'
                : provider.hasToken
                  ? `已保存 ${provider.tokenHint}`
                  : '系统访问令牌（只存在本机）',
              onChange: (event) =>
                patchProvider(provider.id, isOfficial ? { key: event.target.value } : { token: event.target.value }),
            }),
          ),
          isOfficial
            ? provider.source === 'key'
              ? h(
                  'p',
                  { className: 'up-hint' },
                  '手填 key 的站点只读该 key 的余额；今日消耗仍由本机采样推算。',
                )
              : null
            : h(
                'div',
                { className: 'up-line' },
                h('label', null, '用户 ID'),
                h('input', {
                  className: 'up-input',
                  value: provider.userId || '',
                  placeholder: '站点要求 New-Api-User 时填数字 id（可不填）',
                  onChange: (event) => patchProvider(provider.id, { userId: event.target.value }),
                }),
              ),
          h(
            'div',
            { className: 'up-actions' },
            h(
              'label',
              { className: 'up-kv' },
              h('input', {
                type: 'checkbox',
                checked: provider.show !== false,
                onChange: (event) => patchProvider(provider.id, { show: event.target.checked }),
              }),
              h('span', null, '在侧栏轮播中显示'),
            ),            h(
              'button',
              { className: 'up-act', type: 'button', disabled: busy, onClick: () => test(provider) },
              '测试连接',
            ),
            h(
              'button',
              { className: 'up-act', type: 'button', onClick: () => removeProvider(provider.id) },
              '移除',
            ),
            result
              ? h(
                  'span',
                  { className: `up-note ${result.status === 'ok' ? 'ok' : 'bad'}` },
                  result.status === 'ok'
                    ? `连接正常 · 余额 ${money(result.balance, result.symbol)}${
                        result.spentToday !== null && result.spentToday !== undefined
                          ? ` · 今日 ${money(result.spentToday, result.symbol)}`
                          : ''
                      }`
                    : result.error || '连接失败',
                )
              : null,
          ),
        );
      });

      return h(
        'div',
        { className: 'up-set' },
        h('h3', null, 'Usage 面板'),
        h(
          'p',
          null,
          '左栏常驻块轮播各站点余额与今日消耗。官方站点的「数据来源」可选 DSH 已登录账号（不用填 key）或手填 key；要同时看多个 key 就再加几个官方条目。官方只有余额接口，今日消耗由本机采样推算（应用运行期间的余额下降量）。中转站（new-api）的今日与本月来自站点统计接口。',
        ),
        ...rows,
        h(
          'div',
          { className: 'up-actions' },
          h('button', { className: 'up-act', type: 'button', onClick: () => addProvider('newapi') }, '添加中转站'),
          h('button', { className: 'up-act', type: 'button', onClick: () => addProvider('official') }, '添加官方 key'),
        ),
        h('h3', null, '刷新与轮播'),
        h(
          'div',
          { className: 'up-card' },
          h(
            'div',
            { className: 'up-line' },
            h('label', null, '刷新间隔'),
            h('input', {
              className: 'up-input',
              type: 'number',
              min: 60,
              value: draft.intervalSeconds,
              onChange: (event) => patchRoot({ intervalSeconds: Number(event.target.value) || 300 }),
            }),
            h('span', { className: 'up-note' }, '秒'),
          ),
          h(
            'div',
            { className: 'up-line' },
            h(
              'label',
              { className: 'up-kv' },
              h('input', {
                type: 'checkbox',
                checked: Boolean(draft.holidayOverride),
                onChange: (event) => patchRoot({ holidayOverride: event.target.checked }),
              }),
              h('span', null, '今天算节假日'),
            ),
            h('span', { className: 'up-note' }, '节假日全天按空闲价（官方规则）'),
          ),
        ),
        h('h3', null, '峰谷规则'),
        h(
          'div',
          { className: 'up-card' },
          h('div', { className: 'up-kv' }, h('span', { className: 'k' }, '高峰'), h('span', null, '周一至周五 09:00-12:00、14:00-18:00（北京时间，法定节假日除外）')),
          h('div', { className: 'up-kv' }, h('span', { className: 'k' }, '空闲'), h('span', null, '其余时间与周末、节假日全天，单价为高峰的一半')),
          h('div', { className: 'up-note' }, '规则为只读：官方定价页给出的窗口，本地据此判断当前处于高峰还是空闲。'),
        ),
        h(
          'div',
          { className: 'up-actions' },
          h('button', { className: 'up-act primary', type: 'button', disabled: busy, onClick: save }, '保存'),
          h(
            'button',
            { className: 'up-act', type: 'button', disabled: busy, onClick: () => api('/refresh', { method: 'POST' }) },
            '立即刷新',
          ),
          note.text ? h('span', { className: `up-note ${note.kind}` }, note.text) : null,
        ),
        h('p', null, 'key 与令牌只写在本机 ~/.dsh/usage-panel/config.json，由当前 Windows 用户账户的目录权限保护（插件另尝试设 600 但 Windows 上不生效）；不写日志、不外发，接口只回传打码后的提示。'),
      );
    }

    /* --------------------------------------------------------- style install */

    const STYLE_ID = 'dsh-usage-panel';

    /**
     * Plugins ship their CSS as a plain `<style>` tag: the client ctx exposes no
     * style service, so the tag is appended once and reused by every mount.
     */
    function ensureStyle() {
      try {
        if (typeof document === 'undefined' || !document.head) return;
        if (document.querySelector(`style[data-plugin="${STYLE_ID}"]`)) return;
        const el = document.createElement('style');
        el.setAttribute('data-plugin', STYLE_ID);
        el.textContent = CSS;
        document.head.appendChild(el);
      } catch (err) {
        console.error('[usage-panel] style install failed', err);
      }
    }

    /* --------------------------------------------------------- layout probe */

    /**
     * Posts the block's measured geometry back to the plugin backend. The overlay
     * layer is invisible to the Host, so this is the only way to check where the
     * block actually landed in the running window.
     */
    function postLayoutReport() {
      try {
        if (typeof document === 'undefined' || !document.documentElement) return;
        measureSidebar();
        const box = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return {
            x: Math.round(r.left),
            y: Math.round(r.top),
            w: Math.round(r.width),
            h: Math.round(r.height),
          };
        };
        const root = document.documentElement;
        const cs = getComputedStyle(root);
        const payload = {
          vw: window.innerWidth,
          vh: window.innerHeight,
          dpr: window.devicePixelRatio,
          styleTag: !!document.querySelector(`style[data-plugin="${STYLE_ID}"]`),
          upX: cs.getPropertyValue('--up-x').trim(),
          upW: cs.getPropertyValue('--up-w').trim(),
          upBottom: cs.getPropertyValue('--up-bottom').trim(),
          plate: (() => {
            const el = document.querySelector('.up-block');
            if (!el) return '';
            return getComputedStyle(el).getPropertyValue('--dsw-specific-sidebar-fill').trim();
          })(),
          plateSource: 'theme-token',
          blockBg: document.querySelector('.up-block')
            ? getComputedStyle(document.querySelector('.up-block')).backgroundColor
            : null,
          footerTop: sidebarMetrics ? sidebarMetrics.footerTop ?? null : null,
          frameSidebarW: cs.getPropertyValue('--dsh-windows-sidebar-width').trim(),
          anchor: box(document.querySelector('.up-anchor')),
          block: box(document.querySelector('.up-block')),
          sidebar: sidebarMetrics && sidebarMetrics.hit ? sidebarMetrics.hit : null,
          chain: sidebarMetrics && sidebarMetrics.chain ? sidebarMetrics.chain : [],
          reservedProbe: reserveProbe,
          reserved: reserved && reserved.el
            ? {
                tag: String(reserved.el.tagName || '').toLowerCase(),
                cls: typeof reserved.el.className === 'string' ? reserved.el.className.slice(0, 60) : '',
                pad: reserved.height,
                mb: getComputedStyle(reserved.el).marginBottom,
                bottom: Math.round(reserved.el.getBoundingClientRect().bottom),
              }
            : null,
        };
        fetch(`${API}/report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).catch(() => {});
      } catch (err) {
        console.error('[usage-panel] layout report failed', err);
      }
    }

    /**
     * The block lives in the frame-wide overlay layer, so its column has to be
     * measured from the sidebar: the leftmost element that spans the viewport
     * height and looks like a rail. Falls back to the desktop frame's published
     * width, then to the CSS defaults.
     */
    let sidebarMetrics = null;
    let sidebarEl = null;
    let reserved = null;
    let reserveProbe = [];

    /**
     * Keeps the sidebar's own scroll area clear of the block. The overlay layer
     * floats above every column, so without this the block sits on top of the
     * conversation rows and swallows their clicks.
     */
    function restoreReserved() {
      if (!reserved) return;
      const { el, original } = reserved;
      try {
        if (original && typeof original === 'object') {
          el.style.paddingBottom = original.paddingBottom || '';
          el.style.scrollPaddingBottom = original.scrollPaddingBottom || '';
          el.style.marginBottom = original.marginBottom || '';
        } else {
          el.style.paddingBottom = original || '';
        }
      } catch (err) {
        console.error('[usage-panel] cannot restore sidebar list', err);
      }
      reserved = null;
    }

    function reserveScrollSpace(column, height) {
      try {
        if (!column) return;
        const columnWidth = column.getBoundingClientRect().width || 0;
        const candidates = [];
        const all = [column, ...column.querySelectorAll('*')];
        for (const el of all) {
          if (el.closest && el.closest('.up-anchor')) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width < columnWidth * 0.5) continue;
          const style = getComputedStyle(el);
          const oy = String(style.overflowY || '');
          if (!/auto|scroll|overlay/.test(oy)) continue;
          const ch = el.clientHeight;
          const sh = el.scrollHeight;
          if (ch < 160) continue;
          candidates.push({ el, oy, ch, sh, delta: sh - ch });
        }
        reserveProbe = candidates.slice(0, 8).map((c) => ({
          cls: typeof c.el.className === 'string' ? c.el.className.slice(0, 40) : '',
          oy: c.oy,
          ch: c.ch,
          delta: c.delta,
        }));
        if (!candidates.length) return;
        // The genuinely scrollable list is the one hiding the most content.
        candidates.sort((a, b) => b.delta - a.delta || b.ch - a.ch);
        const target = candidates[0].el;
        if (reserved && reserved.el === target && reserved.height === height) return;
        restoreReserved();
        reserved = {
          el: target,
          height,
          original: {
            paddingBottom: target.style.paddingBottom,
            scrollPaddingBottom: target.style.scrollPaddingBottom,
            marginBottom: target.style.marginBottom,
          },
        };
        // Shrink the scroll box itself so no row ever paints under the block;
        // the padding is only breathing room at the very end of the list.
        target.style.marginBottom = `${Math.round(height)}px`;
        target.style.paddingBottom = '4px';
        target.style.scrollPaddingBottom = '4px';
      } catch (err) {
        console.error('[usage-panel] cannot reserve sidebar space', err);
      }
    }

    /**
     * Locates the sidebar column by probing near the left edge and walking up
     * until an ancestor is tall, narrow and anchored to the left. Several probe
     * points are tried because the shell insets the frame and the column's own
     * left edge is not at x = 0.
     */
    /**
     * Top edge of the sidebar's footer stack (the `记忆` label and the account
     * chip below it). Found by its own label text rather than by class name,
     * because the column's internals are not part of any public contract.
     */
    function findFooterTop(column) {
      if (!column || typeof column.querySelectorAll !== 'function') return null;
      const viewportH = window.innerHeight;
      const labels = ['记忆', 'Memory', 'Memories'];
      let top = null;
      for (const el of column.querySelectorAll('*')) {
        if (el.children.length > 0) continue;
        const text = (el.textContent || '').trim();
        if (!labels.includes(text)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8) continue;
        if (rect.top < viewportH * 0.5 || rect.top > viewportH) continue;
        if (top === null || rect.top < top) top = rect.top;
      }
      return top;
    }

    /**
     * Resolves the colour the sidebar actually paints behind the block.
     *
     * Themes may define `--dsw-specific-sidebar-fill` as a translucent tint, in
     * which case an opaque plate built from that token would let the list rows
     * bleed through again. The nearest ancestor that paints an opaque background
     * is the honest answer, whatever theme is loaded.
     */
    function measureSidebar() {
      try {
        if (typeof document === 'undefined' || !document.documentElement) return null;
        const root = document.documentElement;
        const viewportH = window.innerHeight;
        const xs = [4, 10, 18, 26, 34];
        const ys = [0.3, 0.5, 0.7].map((f) => Math.round(viewportH * f));
        const nearby = (el) => !el.closest || !el.closest('.up-anchor');
        let hit = null;
        let chain = [];

        outer: for (const y of ys) {
          for (const x of xs) {
            let el = document.elementFromPoint(x, y);
            const trail = [];
            while (el && el !== document.body && el !== root) {
              if (nearby(el)) {
                const rect = el.getBoundingClientRect();
                if (trail.length < 12) {
                  trail.push({
                    tag: String(el.tagName || '').toLowerCase(),
                    cls: typeof el.className === 'string' ? el.className.slice(0, 60) : '',
                    x: Math.round(rect.left),
                    w: Math.round(rect.width),
                    h: Math.round(rect.height),
                  });
                }
                if (
                  rect.left <= 44 &&
                  rect.width >= 140 &&
                  rect.width <= 480 &&
                  rect.height >= viewportH * 0.5
                ) {
                  sidebarEl = el;
                  hit = {
                    left: Math.round(rect.left),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                  };
                  chain = trail;
                  break outer;
                }
              }
              el = el.parentElement;
            }
          }
        }

        if (!hit) {
          const published = parseFloat(
            getComputedStyle(root).getPropertyValue('--dsh-windows-sidebar-width'),
          );
          if (Number.isFinite(published) && published >= 140 && published <= 480) {
            hit = { left: 0, width: Math.round(published), height: viewportH };
          }
        }

        sidebarMetrics = { hit, chain };
        if (!hit) return chain;

        // Narrower than the column and centred in it, so the block reads as a
        // card sitting in the rail rather than a full-width list row.
        const blockW = Math.max(180, Math.min(238, Math.round(hit.width - 28)));
        root.style.setProperty('--up-w', `${blockW}px`);
        root.style.setProperty('--up-x', `${Math.round(hit.left + (hit.width - blockW) / 2)}px`);

        // The plate is the theme's own sidebar token: it already resolves per
        // colour scheme, so sampling the DOM only ever second-guessed it. Clear
        // any leftover override from an older run.
        root.style.removeProperty('--up-plate');

        // A real gap above the memory footer: the footer's own top edge decides
        // where the block stops, instead of a hard-coded offset that collides.
        const footerTop = findFooterTop(sidebarEl);
        const bottom = footerTop ? Math.max(24, Math.round(viewportH - footerTop + 10)) : 96;
        root.style.setProperty('--up-bottom', `${bottom}px`);
        sidebarMetrics.footerTop = footerTop ? Math.round(footerTop) : null;
        sidebarMetrics.bottom = bottom;

        const blockEl = document.querySelector('.up-block');
        const blockH = blockEl ? blockEl.getBoundingClientRect().height : 0;
        reserveScrollSpace(sidebarEl, Math.max(56, Math.round(blockH) + 10));
        return chain;
      } catch (err) {
        console.error('[usage-panel] layout probe failed', err);
        return null;
      }
    }

    /* ---------------------------------------------------------- registration */

    /*
     * The Client service catalogue has no "open settings" API — the host
     * settings panel is shell-owned chrome whose trigger row belongs to
     * ui-settings. Reaching it by clicking a DOM node worked only while that
     * row happened to carry a matching label, so the card opens a panel this
     * plugin renders itself; the host settings page stays as a second entry.
     */
    let openSettings = () => {
      if (typeof openOverlay === 'function') openOverlay();
      else console.error('[usage-panel] settings overlay is not mounted yet');
    };

    return {
      inject: ['slots'],
      apply(ctx) {
        try {
          ctx.effect(() => {
            ensureStyle();
            return () => {
              try {
                const el = document.querySelector(`style[data-plugin="${STYLE_ID}"]`);
                if (el && el.parentNode) el.parentNode.removeChild(el);
                restoreReserved();
              } catch (err) {
                console.error('[usage-panel] style cleanup failed', err);
              }
            };
          });

          ctx.slots.inject('shell.overlay', () =>
            ctx.slots.register({ name: 'shell.overlay', id: 'usage-panel', order: 18 }, UsageBlock),
          );

          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              { name: 'settings.section', id: 'usage-panel', order: 55, label: 'Usage 面板' },
              SettingsPage,
            ),
          );
        } catch (err) {
          console.error('[usage-panel] apply failed', err);
        }
      },
    };
  },
});
