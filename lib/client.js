window.__ModuleLoader__.load({
  id: 'dsh-sweeper',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback } = React

    const API = '/plugins/dsh-sweeper'
    const STYLE_ID = 'dsh-sweeper-style'

    // ── theme ───────────────────────────────────────────────────────────────
    // Everything is expressed with host tokens so light/dark both work; the
    // rgba fallbacks only matter if a token disappears.
    const T = {
      text: 'var(--dsw-alias-label-primary, #1f2328)',
      dim: 'var(--dsw-alias-label-secondary, #5c6672)',
      faint: 'var(--dsw-alias-label-tertiary, #8a929e)',
      border: 'var(--dsw-alias-border-l2, rgba(128,128,128,.22))',
      borderStrong: 'var(--dsw-alias-border-l3, rgba(128,128,128,.4))',
      layer: 'var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06))',
      layer2: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,.1))',
      hover: 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12))',
      overlay: 'var(--dsw-alias-bg-overlay, #1c1d20)',
      accent: 'var(--dsw-alias-button-primary-fill, #3b6ef5)',
      onAccent: 'var(--dsw-alias-label-primary-foreground, #fff)',
      success: 'var(--dsw-alias-state-success-primary, #2f9e5f)',
      warn: 'var(--dsw-alias-state-warning-secondary, #b07800)',
      danger: 'var(--dsw-alias-state-error-primary, #d33b3b)',
    }

    const CSS = `
.sw-root{--sw-border:${T.border};--sw-hover:${T.hover};color:${T.text};font-size:13px;line-height:1.55}
.sw-root *{box-sizing:border-box}
.sw-root button{font-family:inherit}
.sw-num{font-variant-numeric:tabular-nums}
.sw-btn{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:8px;
  border:1px solid var(--sw-border);background:transparent;color:${T.text};font-size:12px;font-weight:500;
  cursor:pointer;white-space:nowrap;transition:background .14s,border-color .14s,opacity .14s,transform .06s}
.sw-btn:hover:not(:disabled){background:${T.hover}}
.sw-btn:active:not(:disabled){transform:translateY(.5px)}
.sw-btn:disabled{opacity:.45;cursor:not-allowed}
.sw-btn:focus-visible{outline:2px solid ${T.accent};outline-offset:2px}
.sw-btn[data-kind=primary]{background:${T.accent};border-color:transparent;color:${T.onAccent}}
.sw-btn[data-kind=primary]:hover:not(:disabled){filter:brightness(1.06)}
.sw-btn[data-kind=danger]{color:${T.danger};border-color:rgba(211,59,59,.45)}
.sw-btn[data-kind=danger]:hover:not(:disabled){background:rgba(211,59,59,.1)}
.sw-btn[data-kind=quiet]{border-color:transparent;color:${T.dim}}
.sw-btn[data-kind=quiet]:hover:not(:disabled){color:${T.text};background:${T.hover}}
.sw-iconbtn{width:30px;height:30px;padding:0;justify-content:center}
.sw-row{display:grid;grid-template-columns:18px minmax(0,1fr) 88px 74px;gap:12px;align-items:center;
  padding:9px 14px;border-top:1px solid var(--sw-border);cursor:pointer;transition:background .12s}
.sw-row:hover{background:var(--sw-hover)}
.sw-row[data-on="1"]{background:rgba(59,110,245,.08)}
.sw-row:first-child{border-top:0}
.sw-mono{font-family:Consolas,ui-monospace,SFMono-Regular,Menlo,monospace}
.sw-chip{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 7px;border-radius:6px;
  background:${T.layer};color:${T.dim};font-size:11px;white-space:nowrap}
.sw-dot{width:6px;height:6px;border-radius:50%;flex:none}
.sw-card{border:1px solid var(--sw-border);border-radius:12px;background:${T.layer}}
.sw-progress{height:3px;background:${T.layer};overflow:hidden}
.sw-progress-fill{height:100%;background:${T.accent};transition:width .35s ease}
.sw-tabbar{display:inline-flex;gap:2px;padding:3px;border-radius:10px;background:${T.layer};border:1px solid var(--sw-border)}
.sw-tab{height:28px;padding:0 12px;border:0;border-radius:8px;background:transparent;color:${T.faint};
  font-size:12px;font-weight:500;cursor:pointer;transition:background .14s,color .14s;white-space:nowrap}
.sw-tab:hover{color:${T.text}}
.sw-tab[data-on="1"]{background:${T.layer2};color:${T.text};box-shadow:0 1px 2px rgba(0,0,0,.12)}
.sw-tab:focus-visible{outline:2px solid ${T.accent};outline-offset:1px}
.sw-skel{background:linear-gradient(90deg,${T.layer} 25%,${T.layer2} 37%,${T.layer} 63%);
  background-size:400% 100%;animation:sw-shimmer 1.4s ease infinite;border-radius:6px}
.sw-spin{width:13px;height:13px;border:2px solid ${T.borderStrong};border-top-color:${T.accent};
  border-radius:50%;animation:sw-spin .7s linear infinite;flex:none}
.sw-toast{animation:sw-toast-in .18s ease-out}
.sw-modal-in{animation:sw-modal-in .16s ease-out}
.sw-scroll::-webkit-scrollbar{width:10px;height:10px}
.sw-scroll::-webkit-scrollbar-thumb{background:${T.borderStrong};border-radius:6px;border:3px solid transparent;background-clip:content-box}
@keyframes sw-shimmer{0%{background-position:100% 0}100%{background-position:0 0}}
@keyframes sw-spin{to{transform:rotate(360deg)}}
@keyframes sw-toast-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes sw-modal-in{from{opacity:0;transform:translateY(8px) scale(.99)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.sw-root *{animation:none!important;transition:none!important}}
@media (max-width:720px){.sw-row{grid-template-columns:18px minmax(0,1fr) 74px}.sw-col-age{display:none}}
`

    function useStyles() {
      useEffect(() => {
        if (document.getElementById(STYLE_ID)) return
        const el = document.createElement('style')
        el.id = STYLE_ID
        el.textContent = CSS
        document.head.appendChild(el)
      }, [])
    }

    // ── formatting ──────────────────────────────────────────────────────────
    const fmtBytes = (n) => {
      if (!n || n < 0) return '0 B'
      if (n < 1024) return n + ' B'
      if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB'
      if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB'
      return (n / 1073741824).toFixed(2) + ' GB'
    }
    const fmtNum = (n) => (typeof n === 'number' ? n.toLocaleString('zh-CN') : String(n == null ? '—' : n))
    const pad = (x) => (x < 10 ? '0' + x : '' + x)
    const fmtDateTime = (ts) => {
      if (!ts) return '—'
      const d = new Date(ts)
      return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
    }
    const fmtDuration = (ms) => (ms == null ? '—' : ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(1) + ' s')
    // Server messages are written for the API; the page says them in Chinese.
    // Anything unrecognised falls through unchanged, so a new error is never
    // swallowed by this table.
    // Server errors arrive as whole English sentences. Each entry here is a
    // "this message means X" test; the card shows the Chinese sentence only, so
    // no half-translated mixture can reach the user.
    const REASONS = [
      [/report is stale/i, '报告在后台刷新过，请重新扫描再试'],
      [/no report yet/i, '还没有扫描结果，先点右上角「重新扫描」'],
      [/already running/i, '上一次还在跑，等它结束或先点「停止」'],
      [/no deep pass is running/i, '当前没有在跑的深度分析'],
      [/not the current one/i, '这一轮已经被新的分析取代了'],
      [/confirm it explicitly/i, '需要先勾选同意，才会把摘要发给模型'],
      [/no keys selected/i, '没有选中任何文件'],
      [/too many items in one batch/i, '一次最多移入 5000 个文件，请分几批处理'],
      [/confirmation required/i, '这个操作需要二次确认'],
      [/acknowledge/i, '选中的文件里有「需要确认」档，需要单独勾选后才能清理'],
      [/batch is busy/i, '这个批次正在被恢复或删除，稍等一下'],
      [/bad batch id/i, '批次号不合法'],
      [/already gone/i, '这一批已经被删掉了（可能是另一个标签页刚删的）'],
      [/still open by another program/i, '批次里有文件正被别的程序占用，关掉占用它的程序再试'],
      [/no files were moved/i, '这次没有移动任何文件'],
      [/a file already exists there/i, '原位置已经有同名文件，没有覆盖'],
      [/missing from trash/i, '回收站里找不到这个文件了'],
      [/path contains \.\./i, '路径里带 ..，拒绝处理'],
      [/not an absolute path/i, '不是绝对路径，拒绝处理'],
      [/model call cancelled/i, '模型调用被取消了'],
      [/model call timed out/i, '模型调用超时'],
      [/unreadable session log/i, '这段对话的日志读不出来'],
      [/scan failed/i, '扫描时读会话日志失败，可能某个日志正在写入；稍后点「重新扫描」'],
      [/quarantine index/i, '回收站索引读不出来，可能有一次清理被中断；文件仍按原样留在盘上'],
      [/model provider is not reachable/i, '连不上模型服务，检查 DSH 里的模型配置是否可用'],
      [/provider returned (\d+)/i, (m) => '模型服务返回 ' + m[1] + '，稍后再试'],
      [/model review failed/i, '模型复核失败，本次没有移动任何文件'],
      [/the report changed while/i, '模型读的时候报告变了，这次没有移动任何文件；重新扫描后再试'],
      [/^gone$/i, '文件已经不在那个位置了（可能被别的标签页清理过，或你已经还原了）'],
      [/not a regular file/i, '不是普通文件（是目录或链接），插件不动它'],
      [/path crosses a link/i, '路径穿过了链接或目录联接，插件不动它'],
      [/changed since the scan/i, '扫描之后这个文件被改过，插件不动它'],
      [/changed size since the scan/i, '扫描之后文件大小变了，插件不动它'],
      [/modified since the scan/i, '扫描之后这个文件被改过，插件不动它'],
      [/copy was incomplete/i, '复制不完整，已经把文件放回原位'],
      [/^the file is gone$/i, '文件已经不在那个位置了'],
      [/the file changed after the deep plan/i, '深度分析之后文件变过，插件不动它'],
      [/not one of the files the scan observed/i, '这个文件不在这次扫描的记录里，重新扫描后再试'],
      [/not one of the files this conversation produced/i, '这个文件不在该对话记录的产物里'],
      [/outside the workspace this conversation wrote to/i, '这个文件不在该对话的工作目录里，插件不动它'],
      [/^tracked by git$/i, '被 git 跟踪，插件不动它'],
      [/could not confirm whether it is tracked/i, '查不到 git 跟踪状态，按保护处理'],
      [/no idle conversation still owns files/i, '没有闲置对话还留着临时产物，不用花 token 去问模型'],
      [/session service is not available/i, '读不到正在运行的对话列表，分不清哪段是闲置的，这次先不动'],
      [/session service failed while listing live conversations/i, '列正在运行的对话时出错了，分不清哪段是闲置的，这次先不动'],
      [/the deep pass has no results yet/i, '深度分析还没有结果'],
      [/^nothing selected$/i, '没有选中任何文件'],
      [/no model route/i, '没有可用的模型：先在 DSH 里设好默认模型（或在插件那一行配置 provider / model）'],
      [/model returned an empty answer/i, '模型返回了空内容，这次没有移动任何文件'],
      [/model returned no usable line/i, '模型的回答里没有可用的判定行，这次没有移动任何文件'],
      [/^model answer has no decisions/i, '模型的回答里没有判定行'],
      [/^nothing could be moved/i, '一个都没能移动'],
      [/sessionPersistence service is not available/i, '读不到会话服务（sessionPersistence），DSH 可能刚重启'],
      [/host llm service is not available/i, '宿主没有提供模型服务（llm），检查 DSH 的模型配置'],
      [/this list is out of date/i, '这份列表在别处刷新过了，正在重新扫描'],
      [/^bad batch id$/i, '这个批次号不对，页面可能过期了，点「回收站」刷新一下'],
    [/bad manifest entry/i, '回收站清单里这一条坏了，跳过'],
      [/^body too large$/i, '请求体太大，被拒绝'],
      [/^bad JSON$/i, '请求格式不对'],
      [/^POST required$/i, '这个接口只接受 POST'],
      [/missing x-dsh-sweeper header/i, '请求缺少插件标记，被拒绝'],
      [/^request (aborted|closed before the body arrived)$/i, '请求被中断了，这次没有做任何改动'],
    ]
    const humanReason = (text) => {
      const raw = String(text == null ? '' : text).trim()
      // The host wraps some failures in its own prefix ("model call failed: …").
      // Strip it, translate what is inside, then put a Chinese wrapper back.
      const WRAP = /^(model call failed|model review failed|deep pass failed|scan failed)\s*:\s*/i
      const wrap = (raw.match(WRAP) || [])[1]
      const body = (wrap ? raw.replace(WRAP, '') : raw).trim()
      const head = !wrap ? ''
        : /review/i.test(wrap) ? '模型复核失败：'
        : /scan/i.test(wrap) ? '扫描失败：'
        : '模型调用失败：'
      const hit = REASONS.find(([re]) => re.test(body))
      if (hit) return head + (typeof hit[1] === 'function' ? hit[1](body.match(hit[0])) : hit[1])
      if (/^HTTP \d+$/.test(body)) return head + '服务返回 ' + body.slice(5) + '，请重试'
      if (/failed to fetch|networkerror|load failed/i.test(body)) return head + '连不上插件服务，DSH 可能刚重启'
      return raw
    }
    const humanError = (err) => humanReason((err && err.message) || err)

    // Older payloads and fixtures may omit generatedAt; fall back to the age
    // the server already computed, so the chip never shows a bare dash.
    const agoText = (ms) => {
      const s = Math.max(0, Math.round((ms || 0) / 1000))
      if (s < 60) return s + ' 秒前'
      const m = Math.round(s / 60)
      if (m < 60) return m + ' 分钟前'
      const hh = Math.round(m / 60)
      if (hh < 24) return hh + ' 小时前'
      return Math.round(hh / 24) + ' 天前'
    }

    // A batch remembers what moved it; the page names that in Chinese.
    const NOTE_LABELS = {
      scan: '扫描清理',
      'model review': '模型复核',
      'model proposal': '模型建议',
      'deep review': '深度分析',
      'manual selection': '手动清理',
    }
    const noteLabel = (n) => NOTE_LABELS[String(n)] || String(n)

    function Timer({ start, running, prefix }) {
      const [now, setNow] = useState(Date.now())
      useEffect(() => {
        if (!running) return
        const id = setInterval(() => setNow(Date.now()), 500)
        return () => clearInterval(id)
      }, [running])
      return h('span', { className: 'sw-num' }, (prefix || '') + fmtDuration(running ? Math.max(0, now - start) : 0))
    }

    const splitPath = (p) => {
      const s = String(p || '')
      const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'))
      return i < 0 ? { dir: '', name: s } : { dir: s.slice(0, i + 1), name: s.slice(i + 1) }
    }
    const extOf = (p) => {
      const { name } = splitPath(p)
      const i = name.lastIndexOf('.')
      return i > 0 ? name.slice(i + 1).toLowerCase().slice(0, 5) : ''
    }

    const fail = (r, data) => {
      const err = new Error((data && data.error) || ('HTTP ' + r.status))
      err.status = r.status
      err.data = data || {}
      return err
    }
    const post = (path, body) => fetch(API + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-sweeper': '1' },
      body: JSON.stringify(body || {}),
    }).then(async (r) => {
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw fail(r, data)
      return data
    })
    const getJSON = (path) => fetch(API + path, { cache: 'no-store' })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) throw fail(r, data)
        return data
      })

    // ── primitives ──────────────────────────────────────────────────────────
    function Btn({ kind, label, icon, onClick, disabled, title, className }) {
      return h('button', {
        type: 'button',
        className: 'sw-btn' + (className ? ' ' + className : ''),
        'data-kind': kind || 'ghost',
        onClick: disabled ? undefined : onClick,
        disabled: !!disabled,
        title: title || undefined,
      }, icon || null, label || null)
    }

    function Icon({ name, size }) {
      const s = size || 16
      const common = { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
      const paths = {
        broom: [h('path', { key: 'a', d: 'M14.2 3.2l6.6 6.6-2.6 2.6-6.6-6.6 2.6-2.6z' }), h('path', { key: 'b', d: 'M11.2 13.4l-6.4 6.4a1.5 1.5 0 002.1 2.1l6.4-6.4' }), h('path', { key: 'c', d: 'M9.4 17.2l-1.5 1.5M12.4 20.2l-1.5 1.5' })],
        refresh: [h('path', { key: 'a', d: 'M20 11a8 8 0 10-2.3 5.7' }), h('path', { key: 'b', d: 'M20 5v6h-6' })],
        download: [h('path', { key: 'a', d: 'M12 3v12' }), h('path', { key: 'b', d: 'M7 11l5 5 5-5' }), h('path', { key: 'c', d: 'M4 20h16' })],
        trash: [h('path', { key: 'a', d: 'M4 7h16' }), h('path', { key: 'b', d: 'M9 7V4h6v3' }), h('path', { key: 'c', d: 'M6 7l1 13h10l1-13' })],
        restore: [h('path', { key: 'a', d: 'M4 11a8 8 0 1 1 2.3 5.7' }), h('path', { key: 'b', d: 'M4 5v6h6' })],
        spark: [h('path', { key: 'a', d: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z' }), h('path', { key: 'b', d: 'M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z' })],
        check: [h('path', { key: 'a', d: 'M4.5 12.5l5 5 10-11' })],
        close: [h('path', { key: 'a', d: 'M6 6l12 12M18 6L6 18' })],
        info: [h('circle', { key: 'a', cx: 12, cy: 12, r: 9 }), h('path', { key: 'b', d: 'M12 11v6M12 7.6v.4' })],
        alert: [h('path', { key: 'a', d: 'M12 3l9.5 17H2.5L12 3z' }), h('path', { key: 'b', d: 'M12 9v5M12 17.2v.3' })],
        box: [h('path', { key: 'a', d: 'M3 8l9-5 9 5-9 5-9-5z' }), h('path', { key: 'b', d: 'M3 8v9l9 5 9-5V8' })],
        shield: [h('path', { key: 'a', d: 'M12 3l8 3v6c0 5-3.6 8.2-8 9-4.4-.8-8-4-8-9V6l8-3z' }), h('path', { key: 'b', d: 'M9 12l2.2 2.2L15.5 10' })],
        chevron: [h('path', { key: 'a', d: 'M9 6l6 6-6 6' })],
      }
      return h('svg', common, paths[name] || null)
    }

    function Check({ checked, onChange, disabled, label }) {
      return h('input', {
        type: 'checkbox',
        checked: !!checked,
        disabled: !!disabled,
        'aria-label': label || '选择',
        onChange: (e) => onChange(e.target.checked),
        style: { width: 15, height: 15, margin: 0, cursor: disabled ? 'not-allowed' : 'pointer', accentColor: T.accent },
      })
    }

    function Chip({ children, tone, dot }) {
      const color = tone === 'success' ? T.success : tone === 'warn' ? T.warn : tone === 'danger' ? T.danger : null
      return h('span', {
        className: 'sw-chip',
        style: color ? { color, background: 'transparent', border: '1px solid ' + (tone === 'danger' ? 'rgba(211,59,59,.4)' : tone === 'warn' ? 'rgba(176,120,0,.4)' : 'rgba(47,158,95,.4)') } : undefined,
      }, dot ? h('span', { className: 'sw-dot', style: { background: color || T.faint } }) : null, children)
    }

    function Stat({ label, value, sub, tone }) {
      const accent = tone === 'success' ? T.success : tone === 'warn' ? T.warn : null
      return h('div', {
        className: 'sw-card',
        style: { padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.faint } },
          accent ? h('span', { className: 'sw-dot', style: { background: accent } }) : null, label),
        h('div', { className: 'sw-num', style: { fontSize: 20, fontWeight: 600, letterSpacing: '-.01em', color: accent || T.text } }, value),
        h('div', { style: { fontSize: 11, color: T.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, sub || ''),
      )
    }

    function Empty({ icon, title, hint }) {
      return h('div', {
        style: {
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '34px 16px',
          border: '1px dashed ' + T.border, borderRadius: 12, color: T.faint, textAlign: 'center',
        },
      },
        h('div', { style: { width: 38, height: 38, borderRadius: 12, background: T.layer, display: 'grid', placeItems: 'center', marginBottom: 2 } }, h(Icon, { name: icon || 'box', size: 18 })),
        h('div', { style: { fontSize: 13, fontWeight: 500, color: T.dim } }, title),
        hint ? h('div', { style: { fontSize: 12, maxWidth: 420 } }, hint) : null,
      )
    }

    function Modal({ title, description, children, confirmLabel, kind, busy, onCancel, onConfirm }) {
      useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape' && !busy) onCancel() }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [busy, onCancel])
      return h('div', {
        role: 'presentation',
        onClick: (e) => { if (e.target === e.currentTarget && !busy) onCancel() },
        style: {
          position: 'fixed', inset: 0, zIndex: 3000, padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(8,9,11,.5)', backdropFilter: 'blur(3px)',
        },
      },
        h('div', {
          role: 'dialog', 'aria-modal': 'true', 'aria-label': title, className: 'sw-modal-in',
          style: {
            width: 460, maxWidth: '100%', maxHeight: '86vh', overflow: 'auto', borderRadius: 14, padding: '20px 20px 16px',
            background: T.overlay, color: T.text, border: '1px solid ' + T.borderStrong, boxShadow: '0 24px 64px rgba(0,0,0,.42)',
          },
        },
          h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 } },
            h('div', {
              style: {
                width: 32, height: 32, flex: 'none', borderRadius: 10, display: 'grid', placeItems: 'center',
                background: kind === 'danger' ? 'rgba(211,59,59,.12)' : 'rgba(59,110,245,.12)',
                color: kind === 'danger' ? T.danger : T.accent,
              },
            }, h(Icon, { name: kind === 'danger' ? 'alert' : 'trash', size: 16 })),
            h('div', { style: { minWidth: 0 } },
              h('div', { style: { fontSize: 15, fontWeight: 600 } }, title),
              description ? h('div', { style: { fontSize: 12, color: T.faint, marginTop: 2 } }, description) : null),
          ),
          h('div', { style: { fontSize: 12.5, color: T.dim, lineHeight: 1.75 } }, children),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 } },
            h(Btn, { label: '取消', kind: 'quiet', onClick: onCancel, disabled: busy }),
            h(Btn, { label: busy ? '处理中…' : confirmLabel, kind: kind === 'danger' ? 'danger' : 'primary', onClick: onConfirm, disabled: busy }),
          ),
        ),
      )
    }

    function Toast({ text, tone }) {
      return h('div', {
        className: 'sw-toast',
        role: 'status',
        style: {
          position: 'fixed', right: 24, bottom: 24, zIndex: 3100, maxWidth: 440, padding: '10px 14px',
          borderRadius: 10, fontSize: 12.5, lineHeight: 1.6,
          background: T.overlay, color: T.text, border: '1px solid ' + T.borderStrong,
          borderLeft: '3px solid ' + (tone === 'danger' ? T.danger : tone === 'warn' ? T.warn : T.success),
          boxShadow: '0 12px 32px rgba(0,0,0,.32)',
        },
      }, text)
    }

    function SkeletonRows({ n }) {
      return h('div', { style: { padding: '4px 0' } },
        Array.from({ length: n || 5 }).map((_, i) => h('div', {
          key: i,
          style: { display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px' },
        },
          h('div', { className: 'sw-skel', style: { width: 15, height: 15, borderRadius: 4 } }),
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { className: 'sw-skel', style: { height: 10, width: (46 + (i * 13) % 34) + '%' } }),
            h('div', { className: 'sw-skel', style: { height: 8, width: (24 + (i * 7) % 20) + '%', marginTop: 6 } })),
          h('div', { className: 'sw-skel', style: { width: 42, height: 10 } }),
        )),
      )
    }

    // ── report rows ─────────────────────────────────────────────────────────
    function FileRow({ item, checked, onToggle }) {
      const { dir, name } = splitPath(item.path)
      const ext = extOf(item.path)
      return h('div', {
        className: 'sw-row',
        'data-on': checked ? '1' : '0',
        onClick: () => onToggle(!checked),
        role: 'checkbox',
        'aria-checked': !!checked,
        tabIndex: 0,
        onKeyDown: (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle(!checked) } },
      },
        h('div', { style: { display: 'flex' }, onClick: (e) => e.stopPropagation() },
          h(Check, { checked, onChange: onToggle, label: '选择 ' + name })),
        h('div', { style: { minWidth: 0 } },
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 } },
            dir ? h('span', {
              className: 'sw-mono',
              title: item.path,
              style: { fontSize: 11, color: T.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '42%', flex: '0 1 auto' },
            }, dir) : null,
            h('span', {
              className: 'sw-mono',
              style: { fontSize: 12.5, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '0 1 auto', fontWeight: 500 },
            }, name),
            ext ? h('span', {
              style: { fontSize: 9.5, letterSpacing: '.04em', color: T.faint, border: '1px solid ' + T.border, borderRadius: 4, padding: '0 3px', lineHeight: '14px', flex: 'none' },
            }, ext.toUpperCase()) : null,
          ),
          h('div', {
            style: { fontSize: 11, color: T.faint, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
            title: (item.reasons || []).join(' · '),
          },
            (item.reasons || []).join(' · '),
            item.session && item.session.title ? h('span', { style: { opacity: .8 } }, '　来自「' + item.session.title + '」') : null,
          ),
        ),
        h('div', { className: 'sw-num', style: { fontSize: 12, color: T.dim, textAlign: 'right', whiteSpace: 'nowrap' } }, fmtBytes(item.size)),
        h('div', { className: 'sw-col-age', style: { textAlign: 'right' } },
          h('span', { className: 'sw-num', style: { fontSize: 11, color: T.faint } }, item.ageDays + ' 天')),
      )
    }

    function Section({ tone, title, hint, items, selected, onToggle, onSelectAll, action, emptyTitle, emptyHint, limit }) {
      const [showAll, setShowAll] = useState(false)
      const color = tone === 'safe' ? T.success : T.warn
      const total = items.reduce((s, it) => s + (it.size || 0), 0)
      const all = items.length > 0 && items.every((it) => selected.has(it.key))
      const some = items.some((it) => selected.has(it.key))
      const visible = showAll ? items : items.slice(0, limit || 200)
      const inputRef = useRef(null)
      useEffect(() => { if (inputRef.current) inputRef.current.indeterminate = some && !all }, [some, all])

      return h('section', { className: 'sw-card', style: { marginTop: 14, overflow: 'hidden' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', background: T.layer, borderBottom: items.length ? '1px solid ' + T.border : 'none' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
            h('span', { style: { width: 8, height: 8, borderRadius: 3, background: color, flex: 'none' } }),
            h('div', { style: { fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' } }, title),
            h('span', { className: 'sw-num', style: { fontSize: 11, color: T.faint } }, items.length + ' 项 · ' + fmtBytes(total)),
          ),
          h('div', { style: { flex: 1 } }),
          items.length ? h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.faint, cursor: 'pointer', marginRight: 4 } },
            h('input', {
              ref: inputRef, type: 'checkbox', checked: all, 'aria-label': '全选 ' + title,
              onChange: (e) => onSelectAll(items, e.target.checked),
              style: { width: 15, height: 15, margin: 0, accentColor: T.accent, cursor: 'pointer' },
            }),
            '全选',
          ) : null,
          action ? h(Btn, { label: action.label, kind: action.kind || 'primary', onClick: action.onClick, icon: action.icon ? h(Icon, { name: action.icon, size: 14 }) : null }) : null,
        ),
        items.length === 0
          ? h('div', { style: { padding: '4px 14px 14px' } }, h(Empty, { icon: tone === 'safe' ? 'check' : 'shield', title: emptyTitle, hint: emptyHint }))
          : h('div', null,
              visible.map((it) => h(FileRow, { key: it.key, item: it, checked: selected.has(it.key), onToggle: (on) => onToggle(it, on) })),
              items.length > visible.length
                ? h('button', {
                    type: 'button',
                    onClick: () => setShowAll(true),
                    style: {
                      width: '100%', height: 34, border: 0, borderTop: '1px solid ' + T.border, background: 'transparent',
                      color: T.dim, fontSize: 12, cursor: 'pointer',
                    },
                  }, '还有 ' + (items.length - visible.length) + ' 项 · 显示全部')
                : null,
            ),
        hint ? h('div', { style: { padding: '8px 14px', borderTop: '1px solid ' + T.border, fontSize: 11, color: T.faint } }, hint) : null,
      )
    }

    // ── panels ──────────────────────────────────────────────────────────────
    function ReportPanel(props) {
      const { report, status, error, selected, setSelected, onScan, onDelete, onExport, scanStartedAt } = props
      const items = (report && report.items) || []
      const [sortBy, setSortBy] = useState('size')
      const safe = useMemo(() => items.filter((it) => it.tier === 'safe'), [items])
      const unsure = useMemo(() => items.filter((it) => it.tier !== 'safe'), [items])

      const sorter = useCallback((list) => {
        const arr = list.slice()
        if (sortBy === 'age') arr.sort((a, b) => b.ageDays - a.ageDays || b.size - a.size)
        else if (sortBy === 'path') arr.sort((a, b) => String(a.path).localeCompare(String(b.path)))
        else arr.sort((a, b) => b.size - a.size || String(a.path).localeCompare(String(b.path)))
        return arr
      }, [sortBy])

      const toggle = (it, on) => setSelected((prev) => {
        const next = new Set(prev)
        if (on) next.add(it.key); else next.delete(it.key)
        return next
      })
      const selectAll = (list, on) => setSelected((prev) => {
        const next = new Set(prev)
        for (const it of list) { if (on) next.add(it.key); else next.delete(it.key) }
        return next
      })

      if (status === 'error') {
        return h('div', { className: 'sw-card', style: { padding: 18, marginTop: 14 } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, color: T.danger, fontWeight: 600, fontSize: 13 } },
            h(Icon, { name: 'alert', size: 16 }), '扫描失败'),
          h('div', { style: { marginTop: 6, fontSize: 12, color: T.dim, lineHeight: 1.7, wordBreak: 'break-word' } }, error || '未知错误'),
          h('div', { style: { marginTop: 12 } }, h(Btn, { label: '重试', kind: 'primary', icon: h(Icon, { name: 'refresh', size: 14 }), onClick: onScan })),
        )
      }

      return h('div', null,
        h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 14 } },
          h(Chip, { dot: true, tone: status === 'refreshing' ? 'warn' : 'success' },
            status === 'refreshing'
              ? h('span', null, '扫描中 ', h(Timer, { start: scanStartedAt, running: true }))
              : report ? '已扫描 ' + (report.generatedAt ? fmtDateTime(report.generatedAt) : agoText(report.ageMs || 0)) : '尚未扫描'),
          report ? h(Chip, null, fmtNum(report.stats.sessions) + ' 个会话') : null,
          report ? h(Chip, null, fmtNum(report.stats.toolCalls) + ' 次工具调用') : null,
          report ? h(Chip, null, fmtNum(report.stats.events) + ' 条事件') : null,
          report && report.stats.errors ? h(Chip, { tone: 'warn' }, fmtNum(report.stats.errors) + ' 次失败') : null,
          report ? h(Chip, null, '耗时 ' + fmtDuration(report.durationMs)) : null,
          report && report.protected ? h(Chip, null, '保护中 ' + fmtNum(report.protected.recent + report.protected.live + report.protected.tracked)) : null,
          h('div', { style: { flex: 1 } }),
          items.length ? h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.faint } },
            '排序',
            h('select', {
              value: sortBy,
              onChange: (e) => setSortBy(e.target.value),
              style: {
                height: 26, borderRadius: 7, border: '1px solid ' + T.border, background: T.layer, color: T.text,
                fontSize: 11.5, padding: '0 6px', cursor: 'pointer',
              },
            },
              h('option', { value: 'size' }, '体积'),
              h('option', { value: 'age' }, '闲置'),
              h('option', { value: 'path' }, '路径'),
            )) : null,
        ),

        status === 'loading'
          ? h('div', { className: 'sw-card', style: { marginTop: 14, overflow: 'hidden' } },
              h('div', { style: { padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid ' + T.border } },
                h('div', { className: 'sw-spin' }),
                h('div', { style: { fontSize: 12.5 } }, '正在读取会话日志…'),
                h('div', { style: { marginLeft: 'auto', fontSize: 11, color: T.faint } }, h(Timer, { start: scanStartedAt, running: true }))),
              h(SkeletonRows, { n: 6 }))
          : null,

        // With nothing to clean, two empty sections under a "很干净" card read
        // like the page is contradicting itself; show only the summary.
        report && items.length
          ? h('div', null,
              h(Section, {
                tone: 'safe', title: '无脑删',
                hint: '判定依据：位于 .scratch / tmp / __pycache__ / *.bak 等临时目录，或 dsh-spill 系统临时输出；产生后再没被任何工具当文件用过；最后活动早于 ' + report.weekDays + ' 天。',
                items: sorter(safe), selected, onToggle: toggle, onSelectAll: selectAll,
                emptyTitle: '没有可以无脑删的东西',
                emptyHint: '最近 ' + report.weekDays + ' 天没有产生过无引用的临时产物，或者都还在保护期内。',
                action: safe.length ? { label: '一键清理 ' + safe.length + ' 项', icon: 'broom', onClick: () => onDelete(safe) } : null,
              }),
              h(Section, {
                tone: 'unsure', title: '不确定',
                hint: '产生后被工具引用过、产生它的调用失败过（可能是半成品）、或体积超过 1 MB。选中后需要再次确认才会移入回收站。',
                items: sorter(unsure), selected, onToggle: toggle, onSelectAll: selectAll,
                emptyTitle: '没有需要你判断的条目',
                emptyHint: '有疑问的产物都会出现在这里，默认一个都不动。',
              }),
            )
          : null,

        report && !items.length && status !== 'loading'
          ? h('div', { style: { marginTop: 14 } }, h(Empty, {
              icon: 'check', title: '很干净，没有发现对话垃圾',
              hint: '扫描了 ' + fmtNum(report.stats.sessions) + ' 个会话、' + fmtNum(report.stats.toolCalls) + ' 次工具调用，在 ' + report.weekDays + ' 天窗口里没有找到可清理的残留。',
            }))
          : null,

        report ? h('details', { style: { marginTop: 14, fontSize: 11.5, color: T.faint } },
          h('summary', { style: { cursor: 'pointer', userSelect: 'none', color: T.dim } }, '判定规则与安全边界'),
          h('div', { style: { marginTop: 6, lineHeight: 1.8 } },
            '· 扫描只读会话日志（tool/call、tool/result、job、title），不调用模型、不写任何文件。', h('br'),
            '· 判定时间 = max(最后一次被工具使用, 文件 mtime, 首次产生时间)，超过 ' + report.weekDays + ' 天才进入列表。', h('br'),
            '· 清理 = rename 进 ' + (report.trashRoot || 'DSH_HOME/plugin-data/dsh-sweeper/trash') + '，可整批恢复；永久删除只发生在你手动点「彻底删除」。', h('br'),
            '· 复核每个待删路径：绝对路径、无 ..、不在盘符根、不在 ~/.dsh 与 ~/.agents 内、realpath 未穿链接、是普通文件、大小与 mtime 与扫描一致。', h('br'),
            '· 保护中 ' + fmtNum(report.protected.recent) + '（一周内） · ' + fmtNum(report.protected.live) + '（活跃会话） · ' + fmtNum(report.protected.gone) + '（已消失） · ' + fmtNum(report.protected.unsafe || 0) + '（DSH 内部）',
            report.unreadable && report.unreadable.length ? h('div', { style: { color: T.warn, marginTop: 4 } }, '有 ' + report.unreadable.length + ' 个会话读不出来，已整体跳过（fail-closed）。') : null,
          )) : null,
      )
    }

    function ModelPanel(props) {
      const { report, review, reviewing, error, onRun, onAnswer, reviewStartedAt, onGoTrash } = props
      const items = (report && report.items) || []
      const moved = (review && review.moved) || []
      const asks = (review && review.asks) || []
      const unknown = (review && review.unknown) || []
      const extra = (review && review.extra) || { sweep: [], optional: [], rejected: [], hints: 0 }
      const extraSel = props.extraSelected || new Set()
      const safeCount = items.filter((it) => it.tier === 'safe').length

      const steps = [
        '把扫描出的候选整理成清单：路径、体积、多久没动过、之后有没有被再次引用。',
        '再附上临时目录里日志没提到的文件，让模型自己判断哪些也可以清。',
        '发给 DSH 当前配置的模型，让它逐条回答：删 / 留 / 要问你。',
        '回答按编号对回文件；对不上、文件已变、被 git 跟踪的建议一律作废。',
        '「可以无脑删」那档直接进回收站，其余只做提示，等你点。',
      ]

      return h('div', { style: { marginTop: 14 } },
        h('div', { className: 'sw-card', style: { padding: 16 } },
          h('div', { style: { display: 'flex', gap: 12, alignItems: 'flex-start' } },
            h('div', { style: { width: 36, height: 36, borderRadius: 11, background: 'rgba(59,110,245,.12)', color: T.accent, display: 'grid', placeItems: 'center', flex: 'none' } },
              h(Icon, { name: 'spark', size: 18 })),
            h('div', { style: { minWidth: 0 } },
              h('div', { style: { fontSize: 14, fontWeight: 600 } }, '让模型复核这份清单'),
              h('div', { style: { fontSize: 12, color: T.dim, marginTop: 3, lineHeight: 1.7 } },
                '模型只做选择题：它只能引用清单里的编号，看不到也操作不了其它文件，输出里不会执行任何命令。它的每一条建议都要再经过插件自己的安全校验。'),
            ),
          ),
          h('div', { style: { display: 'grid', gap: 6, margin: '14px 0 4px' } },
            steps.map((s, i) => h('div', { key: i, style: { display: 'flex', gap: 8, fontSize: 12, color: T.dim, lineHeight: 1.65 } },
              h('span', { className: 'sw-num', style: { width: 16, flex: 'none', color: T.faint } }, (i + 1) + '.'),
              h('span', null, s))),
            h('details', { style: { marginTop: 4 } },
              h('summary', { style: { fontSize: 11, color: T.faint, cursor: 'pointer' } }, '技术细节：模型看到什么、回答什么'),
              h('div', { style: { fontSize: 11, color: T.faint, lineHeight: 1.7, marginTop: 6 } },
                'A 段是最多 100 条候选，回答 D（删）/ K（留）/ Q（要问你）；B 段是清单外的临时文件，回答 A（可无脑清）/ S（可选）/ K（留）。发出去的是一段纯文本摘要，不含对话原文。'))),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' } },
            h(Btn, {
              kind: 'primary',
              icon: reviewing ? h('span', { className: 'sw-spin' }) : h(Icon, { name: 'spark', size: 14 }),
              label: reviewing ? h('span', null, '模型正在看… ', h(Timer, { start: reviewStartedAt, running: true })) : (review ? '再复核一次' : '让模型复核'),
              onClick: onRun,
              disabled: reviewing || !items.length,
            }),
            h('span', { style: { fontSize: 11, color: T.faint } },
              items.length ? '当前 ' + items.length + ' 条候选（其中无脑删 ' + safeCount + ' 条）' : '没有候选：先去「扫描结果」扫描一次'),
            h('div', { style: { flex: 1 } }),
            h('span', { style: { fontSize: 11, color: T.faint } }, '一次几千 token · 10–40 秒'),
          ),
        ),

        error ? h('div', {
          className: 'sw-card',
          style: { marginTop: 12, padding: '12px 14px', borderColor: 'rgba(211,59,59,.4)', background: 'rgba(211,59,59,.06)' },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, color: T.danger, fontSize: 12.5, fontWeight: 600 } },
            h(Icon, { name: 'alert', size: 15 }), '复核没有完成'),
          h('div', { style: { marginTop: 4, fontSize: 12, color: T.dim, lineHeight: 1.7, wordBreak: 'break-word' } }, error),
          h('div', { style: { marginTop: 4, fontSize: 11.5, color: T.faint } }, '此时不会有任何文件被移动。'),
        ) : null,

        review ? h('div', null,
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginTop: 12 } },
            h(Stat, { label: '已移入回收站', value: fmtNum(moved.length) + ' 项', sub: fmtBytes(review.movedBytes || 0) + (review.batch ? ' · 批次 ' + review.batch.id : ''), tone: 'success' }),
            h(Stat, { label: '待你决定', value: fmtNum(asks.length) + ' 项', sub: asks.length ? '模型拿不准，逐条确认' : '没有需要确认的项目', tone: asks.length ? 'warn' : null }),
            h(Stat, { label: '模型', value: review.model && review.model.model ? review.model.model : '—', sub: (review.model && review.model.provider ? review.model.provider + ' · ' : '') + '耗时 ' + fmtDuration(review.ms) }),
            h(Stat, { label: '本次看过', value: fmtNum(review.reviewed) + ' 条', sub: review.skipped
              ? '报告共 ' + fmtNum(review.reviewed + review.skipped) + ' 条，只发送了前 ' + fmtNum(review.reviewed) + ' 条'
              : (extra.hints ? '另看 ' + fmtNum(extra.hints) + ' 个清单外文件' : '编号全部有效') }),
          ),

          moved.length
            ? h('div', { className: 'sw-card', style: { marginTop: 12, padding: '12px 14px' } },
                h('div', { style: { fontSize: 12.5, fontWeight: 600, marginBottom: 6 } }, '已自动清理'),
                moved.slice(0, 8).map((k) => h('div', { key: k, className: 'sw-mono', style: { fontSize: 11, color: T.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, k)),
                moved.length > 8 ? h('div', { style: { fontSize: 11, color: T.faint, marginTop: 2 } }, '… 其余 ' + (moved.length - 8) + ' 项') : null,
                h('div', { style: { marginTop: 8 } }, h(Btn, { label: '去回收站查看', kind: 'quiet', icon: h(Icon, { name: 'box', size: 14 }), onClick: props.onGoTrash })),
              )
            : null,

          asks.length
            ? h('div', { style: { marginTop: 12 } },
                h('div', { style: { fontSize: 12.5, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 } },
                  h('span', { style: { width: 8, height: 8, borderRadius: 3, background: T.warn } }), '需要你决定'),
                asks.map((a) => h('div', { key: a.key, className: 'sw-card', style: { padding: '12px 14px', marginBottom: 8, background: 'transparent' } },
                  h('div', { style: { display: 'flex', gap: 12, alignItems: 'flex-start' } },
                    h('div', { style: { flex: 1, minWidth: 0 } },
                      h('div', { className: 'sw-mono', style: { fontSize: 11.5, wordBreak: 'break-all', color: T.text } }, a.path),
                      h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 } },
                        h(Chip, { tone: a.tier === 'safe' ? 'success' : 'warn' }, a.tier === 'safe' ? '无脑删档' : '不确定档'),
                        h('span', { className: 'sw-num', style: { fontSize: 11, color: T.faint } }, fmtBytes(a.size))),
                      h('div', { style: { fontSize: 12, color: T.dim, marginTop: 6, lineHeight: 1.65 } }, '模型问：' + (a.question || '这个还留着吗？')),
                    ),
                    h('div', { style: { display: 'flex', gap: 6, flex: 'none' } },
                      h(Btn, { label: '清理', kind: 'danger', onClick: () => onAnswer(a.key, true) }),
                      h(Btn, { label: '留着', kind: 'quiet', onClick: () => onAnswer(a.key, false) })),
                  ))))
            : null,

          (extra.sweep || []).length
            ? h('div', { className: 'sw-card', style: { marginTop: 12, padding: '12px 14px' } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                  h('span', { style: { width: 8, height: 8, borderRadius: 3, background: T.success } }),
                  h('div', { style: { fontSize: 12.5, fontWeight: 600 } }, '模型建议 · 可无脑清理'),
                  h(Chip, null, fmtNum(extra.sweep.length) + ' 项 · ' + fmtBytes(extra.sweep.reduce((n, x) => n + (x.size || 0), 0))),
                  h('div', { style: { flex: 1 } }),
                  h(Btn, {
                    label: '清理这 ' + extra.sweep.length + ' 项',
                    kind: 'danger',
                    icon: h(Icon, { name: 'trash', size: 14 }),
                    onClick: () => props.onCleanExtra(extra.sweep.map((x) => x.key)),
                  })),
                h('div', { style: { fontSize: 11, color: T.faint, marginTop: 4 } }, '这些不在规则候选里，是模型根据清单外观察主动提议的；插件已复核过「文件仍在、没变、不是链接、没被 git 跟踪」。'),
                extra.sweep.slice(0, 6).map((x) => h('div', { key: x.key, style: { display: 'flex', gap: 10, marginTop: 6, fontSize: 11.5 } },
                  h('span', { className: 'sw-mono', style: { flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: T.dim } }, x.path),
                  h('span', { className: 'sw-num', style: { flex: 'none', color: T.faint } }, fmtBytes(x.size) + ' · ' + x.ageDays + ' 天'))),
                extra.sweep.length > 6 ? h('div', { style: { fontSize: 11, color: T.faint, marginTop: 4 } }, '… 其余 ' + (extra.sweep.length - 6) + ' 项') : null,
              )
            : null,

          (extra.optional || []).length
            ? h('div', { className: 'sw-card', style: { marginTop: 12, padding: '12px 14px' } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                  h('span', { style: { width: 8, height: 8, borderRadius: 3, background: T.warn } }),
                  h('div', { style: { fontSize: 12.5, fontWeight: 600 } }, '模型建议 · 可选清理'),
                  h(Chip, null, fmtNum(extra.optional.length) + ' 项'),
                  h('div', { style: { flex: 1 } }),
                  h(Btn, {
                    label: extraSel.size ? '清理选中 ' + extraSel.size + ' 项' : '清理选中',
                    kind: 'quiet',
                    disabled: !extraSel.size,
                    onClick: () => props.onCleanExtra([...extraSel]),
                  })),
                h('div', { style: { fontSize: 11, color: T.faint, marginTop: 4 } }, '模型觉得像垃圾但拿不准，勾选后才会移进回收站。'),
                extra.optional.slice(0, 40).map((x) => h('label', {
                  key: x.key,
                  className: 'sw-row',
                  style: { gridTemplateColumns: '18px minmax(0,1fr) 70px 62px', padding: '7px 0 7px 2px' },
                },
                  h(Check, {
                    checked: extraSel.has(x.key),
                    onChange: () => props.onToggleExtra(x.key),
                    label: '选择 ' + x.path,
                  }),
                  h('span', { className: 'sw-mono', style: { fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: T.dim } }, x.path),
                  h('span', { className: 'sw-num', style: { fontSize: 11, color: T.faint, textAlign: 'right' } }, fmtBytes(x.size)),
                  h('span', { className: 'sw-num', style: { fontSize: 11, color: T.faint, textAlign: 'right' } }, x.ageDays + ' 天'))),
                (extra.optional || []).length > 40 ? h('div', { style: { fontSize: 11, color: T.faint, marginTop: 4 } }, '只显示前 40 项') : null,
              )
            : null,

          (extra.rejected || []).length
            ? h('details', { style: { marginTop: 10, fontSize: 11, color: T.faint } },
                h('summary', { style: { cursor: 'pointer' } }, '另有 ' + extra.rejected.length + ' 条建议没通过安全校验，已丢弃'),
                extra.rejected.slice(0, 8).map((r, i) => h('div', { key: i, style: { marginTop: 3 } }, r.path + ' — ' + r.reason)))
            : null,

          unknown.length
            ? h('div', { style: { marginTop: 10, fontSize: 11, color: T.faint } }, '模型给出 ' + unknown.length + ' 个不在清单里的编号，已全部忽略（fail-closed）。')
            : null,
          review.note ? h('div', { style: { marginTop: 10, fontSize: 11.5, color: T.faint } }, '模型备注：' + review.note) : null,
        ) : null,
      )
    }

    // Deep pass: per-conversation model review. One conversation knows what it
    // was doing; the page explains the cost before anything is sent, then shows
    // each conversation's answer as soon as it lands (four in flight at most).
    function DeepPanel(props) {
      const {
        plan, job, busy, error, consent, planning,
        onConsent, onPlan, onStart, onCancel,
        selected, onToggle, onSelectAll, onClean,
      } = props
      const running = !!(job && job.state === 'running')
      const sweep = (job && job.sweep) || []
      const optional = (job && job.optional) || []
      const rejected = (job && job.rejected) || []
      const rows = (job && job.sessions) || (plan && plan.sessions) || []
      const estimate = job ? job.totals.estTokens : (plan ? plan.totalEstTokens : 0)
      const totalN = job ? job.totals.sessions : rows.length
      const finished = job ? job.totals.done + job.totals.failed : 0
      const pct = totalN ? Math.round((finished / totalN) * 100) : 0
      const statusOf = (s) => (s === 'done' ? '完成' : s === 'failed' ? '失败' : s === 'running' ? '分析中…' : s === 'cancelled' ? '已取消' : s === 'lost' ? '已中断' : s === 'queued' ? '排队中' : '待分析')
      const toneOf = (s) => (s === 'done' ? 'success' : s === 'failed' ? 'danger' : s === 'running' ? 'accent' : s === 'cancelled' || s === 'lost' ? 'warn' : 'neutral')

      return h('div', null,
        h('div', { className: 'sw-card', style: { padding: '14px 16px' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h(Icon, { name: 'spark', size: 16 }),
            h('div', { style: { fontSize: 13.5, fontWeight: 600 } }, '按对话深度清理'),
            h('div', { style: { flex: 1 } }),
            h(Btn, { label: planning ? '读取会话…' : '重新估算', kind: 'quiet', icon: h(Icon, { name: 'refresh', size: 13 }), onClick: () => onPlan(true), disabled: planning || running }),
          ),
          h('div', { style: { fontSize: 12, color: T.dim, marginTop: 8, lineHeight: 1.75 } },
            '规则扫描只看得见“文件在什么目录”，看不见“这段对话当时在干什么”，也看不见几百 MB 的产物——那种文件往往没有 write 调用留下路径。这里把闲置超过 ' + (job ? job.week : (plan ? plan.week : 7)) + ' 天的对话的工具执行流摘成说明，并且让模型在工作目录里自己查看：列目录、看大小、按大小找文件，最后给出它认为已无用的路径。',
          ),
          h('div', { style: { fontSize: 11.5, color: T.faint, marginTop: 6, lineHeight: 1.7 } },
            '只发送摘要：对话标题、工作目录、工具名与目标路径、开头提问与最后一次回答的节选。不发送原始对话记录，也不会写入任何会话日志。模型能用的工具只有三个，全是只读：列目录、看单个文件、按名称或大小找文件；不能执行命令、不能写、不能删。',
          ),
          h('div', { style: { fontSize: 11.5, color: T.faint, marginTop: 6, lineHeight: 1.7 } },
            '它自己找出来的文件一律进「需要你判断」那一档：规则扫描认定的临时目录才算「无脑删」，模型点名的文件要你勾一次，因为它猜错的代价可能是几个 GB。',
          ),
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10, fontSize: 11.5, color: T.dim } },
            h(Chip, { tone: 'neutral', dot: true }, '最多 ' + (job ? job.concurrency : (plan ? plan.concurrency : 4)) + ' 段对话同时分析'),
            h(Chip, { tone: 'neutral' }, '谁先返回就先显示'),
            h(Chip, { tone: 'neutral' }, '每段最多 6 轮工具调用'),
            h(Chip, { tone: 'warn' }, '会消耗 token'),
          ),
        ),

        plan && !plan.sessions.length && !job ? h(Empty, {
          icon: h(Icon, { name: 'box', size: 22 }),
          title: '没有需要深度分析的对话',
          hint: (plan.skipped
            ? '超过 ' + plan.week + ' 天未使用的 ' + plan.skipped + ' 段对话里没有留下临时产物，所以不用花 token 去问模型。'
            : '超过 ' + plan.week + ' 天未使用、且仍然留有临时产物的对话才会出现在这里。')
            + ' 可以点「重新估算」再读一次磁盘。',
        }) : null,

        rows.length ? h('div', { className: 'sw-card', style: { marginTop: 14, overflow: 'hidden' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', background: T.layer, borderBottom: '1px solid ' + T.border } },
            h('div', { style: { fontSize: 13, fontWeight: 600 } }, job && job.state !== 'running' ? '本次分析' : '待分析对话'),
            h('span', { className: 'sw-num', style: { fontSize: 11, color: T.faint } },
              totalN + ' 段 · ' + (job ? '本次约 ' : '预计约 ') + fmtNum(estimate) + ' tokens' + (plan && plan.skipped ? ' · ' + plan.skipped + ' 段无临时产物已跳过' : '') + (plan && plan.unreadable ? ' · ' + plan.unreadable + ' 段日志读不出来' : '')),
            h('div', { style: { flex: 1 } }),
            running ? h('span', { style: { fontSize: 11.5, color: T.accent } }, finished + ' / ' + totalN) : null,
          ),
          running ? h('div', { className: 'sw-progress' },
            h('div', { className: 'sw-progress-fill', style: { width: pct + '%' } })) : null,
          h('div', null, rows.map((s) => h('div', {
            key: s.id,
            style: { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderTop: '1px solid ' + T.border, fontSize: 12 },
          },
            h('div', { style: { minWidth: 0, flex: 1 } },
              h('div', { style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500 } }, s.title || s.id),
              h('div', { className: 'sw-mono', style: { fontSize: 10.5, color: T.faint, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                (s.cwd || '(未知目录)') + ' · 闲置 ' + s.ageDays + ' 天 · '
                  + (s.candidates ? fmtNum(s.candidates) + ' 个文件' : (s.tools ? '清单为空，模型会自己查看' : '0 个文件'))
                  + (s.tools && s.candidates ? ' · 模型可用工具查看' : '')
                  + (s.truncated ? ' · 日志过长，只读了前面一部分' : '')
                  + (s.hidden ? '（另有 ' + fmtNum(s.hidden) + ' 个没发送给模型）' : '')),
            ),
            s.error ? h('div', { title: s.error, style: { fontSize: 10.5, color: T.danger, maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, s.error) : null,
            s.status === 'done' ? h('span', { className: 'sw-num', style: { fontSize: 11, color: T.faint } }, (s.ms ? (s.ms / 1000).toFixed(1) + 's' : '') + (s.calls ? ' · 工具 ' + s.calls + ' 次' : '') + (s.found ? ' · ' + s.found + ' 项' : '')) : null,
            h(Chip, { tone: toneOf(s.status), dot: s.status === 'running' }, statusOf(s.status)),
          ))),
        ) : null,

        !running && plan && plan.sessions.length ? h('div', {
          style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 14, padding: '11px 14px', border: '1px solid ' + T.border, borderRadius: 10, background: T.layer },
        },
          h(Check, { checked: consent, onChange: () => onConsent(!consent), label: '同意把摘要发给模型' }),
          h('div', { style: { fontSize: 11.5, color: T.dim, flex: 1, minWidth: 240 } },
            job && job.state === 'done'
              ? '重跑会在模型上再花一次 token；模型只回答编号，最终删什么仍由你勾选决定。'
              : '预计约 ' + fmtNum(estimate) + ' tokens（按字符估算，实际由模型计费）。模型只回答编号，最终删什么仍由你勾选决定。'),
          h(Btn, {
            label: job && job.state === 'done' ? '重新分析' : '开始分析', kind: 'primary', icon: h(Icon, { name: 'spark', size: 14 }),
            onClick: () => onStart(), disabled: !consent || busy,
          }),
        ) : null,

        running ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, padding: '11px 14px', border: '1px solid ' + T.border, borderRadius: 10, background: T.layer } },
          h('div', { style: { fontSize: 12, color: T.dim, flex: 1 } }, '正在逐段分析，结果会边返回边显示。已完成的对话可以立刻清理。'),
          h(Btn, { label: '停止', kind: 'quiet', onClick: onCancel }),
        ) : null,

        error ? h('div', {
          style: {
            marginTop: 12, padding: '10px 12px', borderRadius: 8, border: '1px solid ' + T.borderStrong,
            background: T.layer, color: T.danger, fontSize: 12, display: 'flex', alignItems: 'center', gap: 10,
          },
        },
          h('div', { style: { flex: 1, lineHeight: 1.7 } }, error + '（此时不会有任何文件被移动）'),
          h(Btn, {
            label: plan && plan.sessions.length ? '重试分析' : '重新估算', kind: 'quiet',
            icon: h(Icon, { name: 'refresh', size: 13 }),
            onClick: () => (plan && plan.sessions.length ? onStart() : onPlan(true)),
            disabled: busy,
          })) : null,

        job && job.state === 'done' && !sweep.length && !optional.length ? h('div', { style: { marginTop: 12, padding: '10px 12px', borderRadius: 8, border: '1px solid ' + T.border, fontSize: 12, color: T.dim } },
          '模型看完了 ' + job.totals.done + ' 段对话，没有建议删除任何文件。') : null,

        sweep.length ? h(Section, {
          tone: 'safe', title: '模型认为可以无脑删', hint: '来自闲置对话的临时产物，模型给出了理由；勾选后移到回收站',
          items: sweep, selected, onToggle, onSelectAll,
          action: { label: '全部清理', kind: 'primary', onClick: () => onClean(sweep.map((it) => it.key)) },
        }) : null,

        optional.length ? h(Section, {
          tone: 'unsure', title: '模型认为可选清理', hint: '可能是临时产物，但模型给出了不确定的理由；请逐项确认',
          items: optional, selected, onToggle, onSelectAll,
        }) : null,

        rejected.length ? h('details', { style: { marginTop: 12, fontSize: 11.5, color: T.faint } },
          h('summary', { style: { cursor: 'pointer' } }, '模型提到但没通过校验的 ' + rejected.length + ' 项'),
          h('div', { style: { marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 } },
            rejected.slice(0, 50).map((r, i) => h('div', { key: i, className: 'sw-mono', style: { wordBreak: 'break-all' } }, r.path + ' — ' + r.reason))),
        ) : null,

        h('div', { style: { marginTop: 16, fontSize: 11, color: T.faint, lineHeight: 1.7 } },
          '校验规则：模型只能引用我们给出的编号；每个编号都要重新核对磁盘（文件仍在、大小没变、不是链接、不在 ~/.dsh 或 ~/.agents 内、git 不跟踪）。不满足的项不会显示，也不会被清理。'),
      )
    }

    function TrashPanel(props) {
      const { batches, root, busy, error, onRestore, onPurge, onRefresh } = props
      return h('div', { style: { marginTop: 14 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 } },
          h('div', { style: { fontSize: 12, color: T.faint, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, root || '回收站'),
          h('div', { style: { flex: 1 } }),
          h(Btn, { label: '刷新', kind: 'quiet', icon: h(Icon, { name: 'refresh', size: 14 }), onClick: onRefresh, disabled: busy }),
        ),
        error
          ? h('div', { style: { padding: '12px 14px', borderRadius: 10, border: '1px solid ' + T.borderStrong, background: T.layer, fontSize: 12, display: 'flex', alignItems: 'center', gap: 10 } },
              h('div', { style: { flex: 1, color: T.danger, lineHeight: 1.7 } }, '回收站读不出来：' + error + '。文件没有被改动，问题解决后点「刷新」重试。'),
              h(Btn, { label: '重试', kind: 'quiet', icon: h(Icon, { name: 'refresh', size: 13 }), onClick: onRefresh, disabled: busy }))
          : batches.length === 0
          ? h(Empty, { icon: 'box', title: '回收站是空的', hint: '被你或模型清理掉的文件会先放在这里，可以整批恢复，也可以彻底删除。' })
          : batches.map((b) => h('div', { key: b.id, className: 'sw-card', style: { padding: '12px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 } },
              h('div', { style: { width: 32, height: 32, borderRadius: 10, background: T.layer2, display: 'grid', placeItems: 'center', color: T.dim, flex: 'none' } },
                h(Icon, { name: 'box', size: 16 })),
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('div', { style: { fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
                  h('span', null, fmtDateTime(b.createdAt)),
                  h('span', { className: 'sw-mono', style: { fontSize: 11, color: T.faint } }, b.id),
                  b.note ? h(Chip, null, noteLabel(b.note)) : null,
                  b.damaged ? h(Chip, { tone: 'warn' }, '清单损坏') : null),
                h('div', { className: 'sw-num', style: { fontSize: 11, color: T.faint, marginTop: 2 } },
                  b.damaged
                    ? b.count + ' 个文件 · ' + fmtBytes(b.bytes) + ' · 清单读不出来，只能整批删除'
                    : b.count + ' 个文件 · ' + fmtBytes(b.bytes))),
              h('div', { style: { display: 'flex', gap: 6, flex: 'none' } },
                h(Btn, {
                  label: '恢复',
                  icon: h(Icon, { name: 'restore', size: 14 }),
                  onClick: () => onRestore(b.id),
                  disabled: busy || !!b.damaged,
                  title: b.damaged ? '清单读不出来，无法确定每个文件的原位置' : undefined,
                }),
                h(Btn, { label: '彻底删除', kind: 'danger', onClick: () => onPurge(b), disabled: busy })),
            )),
      )
    }

    // ── page ────────────────────────────────────────────────────────────────
    function Page() {
      useStyles()
      const [status, setStatus] = useState('loading')
      const [report, setReport] = useState(null)
      const [error, setError] = useState(null)
      const [selected, setSelected] = useState(() => new Set())
      const trashSeq = useRef(0)
      const [extraSel, setExtraSel] = useState(() => new Set())
      const [tab, setTab] = useState('report')
      const [dialog, setDialog] = useState(null)
      const [busy, setBusy] = useState(false)
      const [toast, setToast] = useState(null)
      const [trash, setTrash] = useState({ batches: [], root: '' })
      const [trashErr, setTrashErr] = useState(null)
      const [review, setReview] = useState(null)
      const [reviewing, setReviewing] = useState(false)
      const [reviewErr, setReviewErr] = useState(null)
      const [deepPlan, setDeepPlan] = useState(null)
      const [deepJob, setDeepJob] = useState(null)
      const [deepPlanning, setDeepPlanning] = useState(false)
      const [deepConsent, setDeepConsent] = useState(false)
      const [deepErr, setDeepErr] = useState(null)
      const [deepSel, setDeepSel] = useState(() => new Set())
      const scanStart = useRef(Date.now())
      const reviewStart = useRef(0)
      const loadSeq = useRef(0)
      const startingRef = useRef(false)

      const scanning = status === 'loading' || status === 'refreshing'

      const load = useCallback((force, keepReview) => {
        // Two quick clicks used to race: the slower response could land last and
        // replace a newer report with an older one. Only the newest request may
        // touch state; the others are still awaited by the server's coalescing.
        const seq = ++loadSeq.current
        scanStart.current = Date.now()
        setStatus((s) => (s === 'loading' ? 'loading' : 'refreshing'))
        setError(null)
        getJSON('/report' + (force ? '?refresh=1' : ''))
          .then((data) => {
            if (seq !== loadSeq.current) return
            setReport(data)
            setSelected(new Set())
            setStatus('ready')
            // A scan snapshot invalidates the model's verdicts — but the refresh
            // right after a review must not wipe the result the user is reading.
            if (!keepReview) {
              setReview(null)
              setReviewErr(null)
            }
          })
          .catch((err) => {
            if (seq !== loadSeq.current) return
            setError(humanError(err))
            setStatus('error')
          })
      }, [])

      // Same shape as load(): two quick visits to the bin (or a restore that
      // finishes while the tab is being opened) must not let an older response
      // land last and overwrite a newer one.
      const loadTrash = useCallback(() => {
        const seq = ++trashSeq.current
        setTrashErr(null)
        getJSON('/trash')
          .then((d) => { if (seq === trashSeq.current) setTrash({ batches: d.batches || [], root: d.root || '' }) })
          .catch((err) => { if (seq === trashSeq.current) setTrashErr(humanError(err)) })
      }, [])

      const planningRef = useRef(false)

      const loadDeepPlan = useCallback((force) => {
        if (planningRef.current) return
        planningRef.current = true
        setDeepPlanning(true)
        setDeepErr(null)
        getJSON('/deep/plan' + (force ? '?refresh=1' : ''))
          .then((d) => setDeepPlan(d))
          .catch((err) => setDeepErr(humanError(err)))
          .finally(() => { planningRef.current = false; setDeepPlanning(false) })
      }, [])

      useEffect(() => { load(false); loadTrash() }, [load, loadTrash])
      useEffect(() => {
        if (!toast) return
        const id = setTimeout(() => setToast(null), 4200)
        return () => clearTimeout(id)
      }, [toast])

      // Deep pass: poll while a job is running so finished conversations paint
      // immediately instead of waiting for the slowest model call.
      //
      // The host forgets jobs when it restarts — which happens every time the
      // plugin is reloaded. The old code ignored `{ job: null }` and swallowed
      // every failed poll, so the panel sat on "分析中…" forever with a frozen
      // progress bar: a dead run that looked alive.
      useEffect(() => {
        if (!deepJob || deepJob.state !== 'running') return
        let stop = false
        let fails = 0
        const lose = (text) => {
          if (stop) return
          stop = true
          setDeepJob((j) => (j ? { ...j, state: 'lost' } : j))
          setDeepErr(text)
        }
        const tick = () => {
          getJSON('/deep/status')
            .then((d) => {
              if (stop) return
              fails = 0
              if (!d || !d.job) {
                lose('后台已经没有这次分析的记录了（DSH 可能重启过），返回的结果不会自己回来。')
                return
              }
              setDeepJob(d.job)
            })
            .catch(() => {
              if (stop) return
              fails += 1
              if (fails >= 3) lose('连不上后台，这次分析的进度已经看不到了（DSH 可能正在重启）。')
            })
        }
        const id = setInterval(tick, 900)
        return () => { stop = true; clearInterval(id) }
      }, [deepJob && deepJob.state, deepJob && deepJob.id])

      // Rows can disappear between polls (cancelled, moved, vetted away). Drop
      // their keys from the selection so the sticky bar never counts ghosts.
      useEffect(() => {
        if (!deepJob) return
        setDeepSel((prev) => {
          if (!prev.size) return prev
          const live = new Set([].concat(deepJob.sweep || [], deepJob.optional || []).map((it) => it.key))
          let changed = false
          const next = new Set()
          for (const key of prev) { if (live.has(key)) next.add(key); else changed = true }
          return changed ? next : prev
        })
      }, [deepJob])

      const items = (report && report.items) || []
      const chosen = items.filter((it) => selected.has(it.key))
      const chosenBytes = chosen.reduce((s, it) => s + (it.size || 0), 0)
      const chosenUnsure = chosen.filter((it) => it.tier !== 'safe').length

      const askDelete = (list) => {
        const pick = Array.isArray(list) && list.length ? list : chosen
        if (!pick.length) return
        setDialog({
          kind: 'delete',
          keys: pick.map((it) => it.key),
          count: pick.length,
          bytes: pick.reduce((s, it) => s + (it.size || 0), 0),
          unsure: pick.filter((it) => it.tier !== 'safe').length,
        })
      }

      const doDelete = async () => {
        const d = dialog
        if (!d) return
        setBusy(true)
        try {
          const res = await post('/delete', {
            token: report && report.token,
            keys: d.keys,
            confirmed: true,
            acknowledge: d.unsure > 0,
          })
          setDialog(null)
          const moved = (res.batch && res.batch.count) || 0
          const failed = (res.failed || []).length
          const refused = (res.refused || []).length
          // A second tab can clean the same rows first. Those files are simply
          // gone from where the page thinks they are, and saying only "nothing
          // was moved" hides why — which is how a stale click looks frozen.
          const whyRefused = refused ? '，' + refused + ' 项已经不在原位（' + humanReason((res.refused[0] || {}).reason) + '）' : ''
          const whyFailed = failed ? '，' + failed + ' 个跳过（' + humanReason((res.failed[0] || {}).reason) + '）' : ''
          setToast({
            tone: moved ? (failed || refused ? 'warn' : 'success') : 'warn',
            text: moved
              ? '已移到回收站：' + moved + ' 个文件（' + fmtBytes((res.batch && res.batch.bytes) || 0) + '）' + whyFailed + whyRefused
              : '没有文件被移动' + whyFailed + whyRefused,
          })
          setSelected(new Set())
          load(!!refused)
          loadTrash()
        } catch (err) {
          setDialog(null)
          // Refreshed elsewhere: the honest move is to re-read the list rather
          // than leave the page showing rows that no longer exist.
          if (err.status === 409 && err.data && err.data.stale) {
            setToast({ tone: 'warn', text: '这份列表在别处刷新过了，正在重新扫描…' })
            load(true)
          } else {
            setToast({ tone: 'danger', text: '清理失败：' + humanError(err) })
          }
        } finally { setBusy(false) }
      }

      const doRestore = async (id) => {
        setBusy(true)
        try {
          const res = await post('/restore', { batchId: id })
          setToast({
            tone: res.failed && res.failed.length ? 'warn' : 'success',
            text: '已恢复 ' + res.restored + ' 个文件' + (res.failed && res.failed.length ? '，' + res.failed.length + ' 个失败（' + humanReason(res.failed[0].reason) + '）' : ''),
          })
          loadTrash()
          setStatus('refreshing')
          scanStart.current = Date.now()
          load(true)
        } catch (err) {
          setToast({ tone: 'danger', text: '恢复失败：' + humanError(err) })
        } finally { setBusy(false) }
      }

      const doPurge = async () => {
        const d = dialog
        if (!d) return
        setBusy(true)
        try {
          await post('/purge', { batchId: d.batchId, confirmed: true })
          setDialog(null)
          setToast({ tone: 'success', text: '已彻底删除该批次，无法恢复。' })
          loadTrash()
        } catch (err) {
          // The batch can vanish between the click and the request (another
          // tab purged it, or the folder was removed by hand). Leaving the
          // dialog open with the same dead batch is a trap; close it and
          // refresh the list so the page matches the disk.
          if (err.status === 404) {
            setDialog(null)
            setToast({ tone: 'warn', text: '这一批已经不在回收站里了，正在刷新。' })
            loadTrash()
          } else {
            setToast({ tone: 'danger', text: '删除失败：' + humanError(err) })
          }
        } finally { setBusy(false) }
      }

      const runReview = async () => {
        if (!report || reviewing) return
        setReviewing(true)
        setReviewErr(null)
        reviewStart.current = Date.now()
        try {
          const res = await post('/review', { token: report.token })
          setReview(res)
          setExtraSel(new Set())
          setToast({
            tone: 'success',
            text: '模型判定完成：自动清理 ' + (res.moved || []).length + ' 项，待确认 ' + (res.asks || []).length + ' 项',
          })
          load(false, true)
          loadTrash()
        } catch (err) {
          setReviewErr(humanError(err))
        } finally {
          setReviewing(false)
        }
      }

      const answerAsk = async (key, clean) => {
        if (!clean) { setReview((r) => (r ? { ...r, asks: (r.asks || []).filter((a) => a.key !== key) } : r)); return }
        setBusy(true)
        try {
          await post('/delete', { token: report && report.token, keys: [key], confirmed: true, acknowledge: true })
          setReview((r) => (r ? { ...r, asks: (r.asks || []).filter((a) => a.key !== key), moved: (r.moved || []).concat([key]) } : r))
          setToast({ tone: 'success', text: '已移到回收站，可在「回收站」里恢复。' })
          load(false)
          loadTrash()
        } catch (err) {
          setToast({ tone: 'danger', text: '清理失败：' + humanError(err) })
        } finally { setBusy(false) }
      }

      const toggleExtra = (key) => {
        setExtraSel((prev) => {
          const next = new Set(prev)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
      }

      const cleanExtra = async (keys) => {
        const list = (keys || []).filter(Boolean)
        if (!list.length || !report) return
        setBusy(true)
        try {
          const res = await post('/delete', { token: report.token, keys: list, confirmed: true, extra: true, acknowledge: true })
          const gone = new Set(res.moved || [])
          setReview((r) => {
            if (!r || !r.extra) return r
            return {
              ...r,
              extra: {
                ...r.extra,
                sweep: (r.extra.sweep || []).filter((x) => !gone.has(x.key)),
                optional: (r.extra.optional || []).filter((x) => !gone.has(x.key)),
              },
            }
          })
          setExtraSel((prev) => new Set([...prev].filter((k) => !gone.has(k))))
          const n = (res.batch && res.batch.count) || 0
          setToast({
            tone: n ? 'success' : 'warn',
            text: n ? '已移到回收站：' + n + ' 个文件' + (res.failed && res.failed.length ? '，' + res.failed.length + ' 个跳过' : '') : '没有文件被移动',
          })
          loadTrash()
        } catch (err) {
          setToast({ tone: 'danger', text: '清理失败：' + humanError(err) })
        } finally { setBusy(false) }
      }

      const startDeep = async () => {
        if (startingRef.current) return
        if (!report || (deepJob && deepJob.state === 'running')) return
        startingRef.current = true
        setDeepErr(null)
        setDeepSel(new Set())
        try {
          const res = await post('/deep/start', { token: report.token, consent: true })
          if (!res.jobId) {
            setToast({ tone: 'warn', text: res.reason || '没有需要分析的对话' })
            return
          }
          setDeepJob({
            id: res.jobId, state: 'running', week: report.weekDays, concurrency: res.concurrency,
            totals: { sessions: res.sessions, done: 0, failed: 0, estTokens: res.estTokens, candidates: 0 },
            sessions: [], sweep: [], optional: [], rejected: [],
          })
          const d = await getJSON('/deep/status')
          if (d && d.job) setDeepJob(d.job)
        } catch (err) {
          setDeepErr(humanError(err))
        } finally {
          startingRef.current = false
        }
      }

      const cancelDeep = async () => {
        if (!deepJob || deepJob.state !== 'running') return
        try {
          await post('/deep/cancel', { jobId: deepJob.id })
          setToast({ tone: 'warn', text: '已停止深度分析，已经返回的结果仍会保留。' })
          const d = await getJSON('/deep/status')
          if (d && d.job) setDeepJob(d.job)
        } catch (err) {
          setDeepErr(humanError(err))
        }
      }

      const toggleDeep = (item, on) => {
        setDeepSel((prev) => {
          const next = new Set(prev)
          if (on) next.add(item.key)
          else next.delete(item.key)
          return next
        })
      }

      const selectDeep = (list, on) => {
        setDeepSel((prev) => {
          const next = new Set(prev)
          for (const it of list) { if (on) next.add(it.key); else next.delete(it.key) }
          return next
        })
      }

      const askDeepClean = (keys) => {
        const list = (keys || [...deepSel]).filter(Boolean)
        if (!list.length) return
        const known = new Map([].concat((deepJob && deepJob.sweep) || [], (deepJob && deepJob.optional) || []).map((it) => [it.key, it]))
        const picked = list.map((k) => known.get(k)).filter(Boolean)
        // The list can move under a stale selection (another tab cleaned, a
        // rescan replaced the job). Opening "move 0 files?" is a dead end, so
        // say what happened instead.
        if (!picked.length) {
          setToast({ tone: 'warn', text: '这些条目已经不在当前结果里了，正在重新估算。' })
          loadDeepPlan(true)
          setDeepSel(new Set())
          return
        }
        setDialog({
          kind: 'deepDelete',
          keys: list,
          count: picked.length,
          bytes: picked.reduce((n, it) => n + (it.size || 0), 0),
          unsure: picked.filter((it) => it.tier !== 'safe').length,
        })
      }

      const doDeepClean = async () => {
        const d = dialog
        if (!d) return
        setBusy(true)
        try {
          const res = await post('/delete', {
            token: report && report.token, keys: d.keys, confirmed: true, deep: true, acknowledge: true,
          })
          if (res.deep) setDeepJob(res.deep)
          setDeepSel((prev) => new Set([...prev].filter((k) => !d.keys.includes(k))))
          setDialog(null)
          const n = (res.batch && res.batch.count) || 0
          setToast({
            tone: n ? 'success' : 'warn',
            text: n
              ? '已移到回收站：' + n + ' 个文件（' + fmtBytes((res.batch && res.batch.bytes) || 0) + '）'
              : '没有文件被移动' + (res.refused && res.refused.length ? '：' + humanReason(res.refused[0].reason) : ''),
          })
          loadTrash()
        } catch (err) {
          setDialog(null)
          setToast({ tone: 'danger', text: '清理失败：' + humanError(err) })
        } finally { setBusy(false) }
      }

      const exportJSON = () => {
        try {
          const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
          const a = document.createElement('a')
          a.href = URL.createObjectURL(blob)
          a.download = 'dsh-sweeper-report-' + new Date().toISOString().slice(0, 10) + '.json'
          a.click()
          setTimeout(() => URL.revokeObjectURL(a.href), 5000)
          setToast({ tone: 'success', text: '报告已导出。' })
        } catch (e) { setToast({ tone: 'danger', text: '导出失败：' + humanError(e) }) }
      }

      const deepAll = [].concat((deepJob && deepJob.sweep) || [], (deepJob && deepJob.optional) || [])
      const deepChosen = deepAll.filter((it) => deepSel.has(it.key))
      const counts = {
        report: items.length,
        review: review ? review.asks.length : null,
        // Before a run the useful number is how many conversations are waiting;
        // afterwards it is how many candidates the model found.
        deep: deepJob ? deepAll.length : (deepPlan ? (deepPlan.sessions || []).length : null),
        trash: trash.batches.length,
      }

      const tabs = [
        { id: 'report', label: '扫描结果', count: counts.report },
        { id: 'review', label: '模型复核', count: counts.review },
        { id: 'deep', label: '深度清理', count: counts.deep },
        { id: 'trash', label: '回收站', count: counts.trash },
      ]

      return h('div', { className: 'sw-root', style: { padding: '16px 18px 96px', maxWidth: 1000 } },
        // header
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
          h('div', {
            style: {
              width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', flex: 'none',
              background: 'linear-gradient(160deg, rgba(59,110,245,.18), rgba(59,110,245,.05))',
              border: '1px solid ' + T.border, color: T.accent,
            },
          }, h(Icon, { name: 'broom', size: 20 })),
          h('div', { style: { minWidth: 0 } },
            h('div', { style: { fontSize: 17, fontWeight: 650, letterSpacing: '-.01em' } }, '清理对话垃圾'),
            h('div', { style: { fontSize: 11.5, color: T.faint, marginTop: 1 } },
              '扫描工具执行流留下的文件 · 模型按对话判断 · 清理进回收站，随时撤销')),
          h('div', { style: { flex: 1 } }),
          h(Btn, {
            label: scanning ? '扫描中…' : '重新扫描',
            icon: h(Icon, { name: 'refresh', size: 14 }),
            onClick: () => load(true),
            disabled: scanning,
          }),
          report ? h(Btn, { label: '导出', icon: h(Icon, { name: 'download', size: 14 }), onClick: exportJSON, disabled: scanning }) : null,
        ),

        // stats
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10, marginTop: 16 } },
          h(Stat, {
            label: '无脑删', tone: 'success',
            value: report ? fmtNum(report.tiers.safe.count) + ' 项' : '—',
            sub: report ? fmtBytes(report.tiers.safe.bytes) + ' · 可直接清理' : '等待扫描',
          }),
          h(Stat, {
            label: '需要确认', tone: 'warn',
            value: report ? fmtNum(report.tiers.unsure.count) + ' 项' : '—',
            sub: report ? fmtBytes(report.tiers.unsure.bytes) + ' · 逐项勾选' : '等待扫描',
          }),
          h(Stat, {
            label: '受保护',
            value: report ? fmtNum(report.protected.recent + report.protected.live + report.protected.tracked + (report.protected.unsafe || 0)) : '—',
            sub: report ? report.weekDays + ' 天内用过 / 活跃会话 / git 跟踪' : '等待扫描',
          }),
          h(Stat, {
            label: '回收站',
            value: trashErr ? '—' : trash.batches.length ? fmtNum(trash.batches.reduce((s, b) => s + b.count, 0)) + ' 个文件' : '空',
            sub: trashErr ? '读取失败，点「回收站」重试' : trash.batches.length ? fmtBytes(trash.batches.reduce((s, b) => s + b.bytes, 0)) + ' · ' + trash.batches.length + ' 个批次' : '没有待恢复的内容',
          }),
        ),

        // tabs
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, flexWrap: 'wrap' } },
          h('div', { className: 'sw-tabbar', role: 'tablist' },
            tabs.map((t) => h('button', {
              key: t.id,
              type: 'button',
              role: 'tab',
              'aria-selected': tab === t.id,
              className: 'sw-tab',
              'data-on': tab === t.id ? '1' : '0',
              onClick: () => {
                setTab(t.id)
                if (t.id === 'trash') loadTrash()
                if (t.id === 'deep' && !deepPlan && !deepPlanning) loadDeepPlan(false)
              },
            }, t.label + (t.count ? '  ' + t.count : '')))),
          h('div', { style: { flex: 1 } }),
          report && report.truncated ? h('span', { style: { fontSize: 11, color: T.warn } }, '结果超过 2000 条，只列出最大的部分') : null,
        ),

        tab === 'report' ? h(ReportPanel, {
          report, status, error, selected, setSelected,
          onScan: () => load(true),
          onDelete: askDelete,
          onExport: exportJSON,
          scanStartedAt: scanStart.current,
        }) : null,

        tab === 'review' ? h(ModelPanel, {
          report, review, reviewing, error: reviewErr, reviewStartedAt: reviewStart.current,
          extraSelected: extraSel, onToggleExtra: toggleExtra, onCleanExtra: cleanExtra,
          onRun: runReview,
          onAnswer: answerAsk,
          onGoTrash: () => { setTab('trash'); loadTrash() },
        }) : null,

        tab === 'deep' ? h(DeepPanel, {
          plan: deepPlan, job: deepJob, busy, error: deepErr, consent: deepConsent, planning: deepPlanning,
          onConsent: setDeepConsent, onPlan: loadDeepPlan, onStart: startDeep, onCancel: cancelDeep,
          selected: deepSel, onToggle: toggleDeep, onSelectAll: selectDeep, onClean: askDeepClean,
        }) : null,

        tab === 'trash' ? h(TrashPanel, {
          batches: trash.batches, root: trash.root, busy, error: trashErr,
          onRestore: doRestore,
          onPurge: (b) => setDialog({ kind: 'purge', batchId: b.id, count: b.count, bytes: b.bytes, damaged: !!b.damaged }),
          onRefresh: loadTrash,
        }) : null,

        // selection bar
        tab === 'report' && chosen.length ? h('div', {
          style: {
            position: 'sticky', bottom: 14, marginTop: 16, padding: '10px 12px 10px 16px', borderRadius: 12,
            border: '1px solid ' + T.borderStrong, background: T.overlay,
            display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 14px 34px rgba(0,0,0,.3)',
          },
        },
          h('div', { style: { fontSize: 12.5 } },
            '已选 ', h('b', { className: 'sw-num' }, String(chosen.length)), ' 项 · ', h('span', { className: 'sw-num' }, fmtBytes(chosenBytes)),
            chosenUnsure ? h('span', { style: { color: T.warn } }, '（含 ' + chosenUnsure + ' 项待确认）') : null),
          h('div', { style: { flex: 1 } }),
          h(Btn, { label: '取消选择', kind: 'quiet', onClick: () => setSelected(new Set()) }),
          h(Btn, { label: '移到回收站', kind: 'primary', icon: h(Icon, { name: 'trash', size: 14 }), onClick: () => askDelete(), disabled: busy }),
        ) : null,

        tab === 'deep' && deepChosen.length ? h('div', {
          style: {
            position: 'sticky', bottom: 14, marginTop: 16, padding: '10px 12px 10px 16px', borderRadius: 12,
            border: '1px solid ' + T.borderStrong, background: T.overlay,
            display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 14px 34px rgba(0,0,0,.3)',
          },
        },
          h('div', { style: { fontSize: 12.5 } },
            '已选 ', h('b', { className: 'sw-num' }, String(deepChosen.length)), ' 项 · ', h('span', { className: 'sw-num' }, fmtBytes(deepChosen.reduce((n, it) => n + (it.size || 0), 0)))),
          h('div', { style: { flex: 1 } }),
          h(Btn, { label: '取消选择', kind: 'quiet', onClick: () => setDeepSel(new Set()) }),
          h(Btn, { label: '移到回收站', kind: 'primary', icon: h(Icon, { name: 'trash', size: 14 }), onClick: () => askDeepClean(), disabled: busy }),
        ) : null,

        toast ? h(Toast, { text: typeof toast === 'string' ? toast : toast.text, tone: toast.tone }) : null,

        dialog && dialog.kind === 'delete' ? h(Modal, {
          title: '把 ' + dialog.count + ' 个文件移到回收站？',
          description: fmtBytes(dialog.bytes) + (dialog.unsure ? ' · 其中 ' + dialog.unsure + ' 项属于「不确定」' : ''),
          confirmLabel: '移到回收站',
          kind: 'primary',
          busy,
          onCancel: () => { if (!busy) setDialog(null) },
          onConfirm: doDelete,
        },
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: T.faint, marginBottom: 8 } },
            h(Icon, { name: 'shield', size: 14 }),
            '不是永久删除：文件会被移进插件的回收站，随时可以整批恢复。'),
          h('div', { className: 'sw-mono', style: { fontSize: 11, color: T.faint, wordBreak: 'break-all', background: T.layer, border: '1px solid ' + T.border, borderRadius: 8, padding: '8px 10px' } },
            (report && report.trashRoot) || 'DSH_HOME/plugin-data/dsh-sweeper/trash'),
          dialog.unsure ? h('div', { style: { color: T.warn, marginTop: 8, fontSize: 12 } },
            '注意：选中的 ' + dialog.unsure + ' 项被引用过，或产生它的调用失败过，可能是你还要用的半成品。') : null,
        ) : null,

        dialog && dialog.kind === 'deepDelete' ? h(Modal, {
          title: '把 ' + dialog.count + ' 个文件移到回收站？',
          description: fmtBytes(dialog.bytes) + ' · 模型从闲置对话里挑出来的' + (dialog.unsure ? '（含 ' + dialog.unsure + ' 项可选清理）' : ''),
          confirmLabel: '移到回收站',
          kind: 'primary',
          busy,
          onCancel: () => { if (!busy) setDialog(null) },
          onConfirm: doDeepClean,
        },
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: T.faint, marginBottom: 8 } },
            h(Icon, { name: 'shield', size: 14 }),
            '不是永久删除：文件会被移进插件的回收站，随时可以整批恢复。'),
          h('div', { style: { fontSize: 11.5, color: T.faint, lineHeight: 1.7 } },
            '这一步只使用模型给出的结论；文件是否仍然存在、大小是否没变、是否被 git 跟踪，都在点按钮这一刻重新核对过。'),
        ) : null,

        dialog && dialog.kind === 'purge' ? h(Modal, {
          title: '彻底删除这个批次？',
          description: (dialog.count || 0) + ' 个文件 · ' + fmtBytes(dialog.bytes || 0),
          confirmLabel: '永久删除',
          kind: 'danger',
          busy,
          onCancel: () => { if (!busy) setDialog(null) },
          onConfirm: doPurge,
        },
          dialog.damaged
            ? '这一批的清单读不出来，没法再放回原来的位置，只能整批删除。删除后无法恢复。'
            : '这一批文件会从磁盘上真正删除，无法恢复。如果只是暂时不用，建议关掉这个窗口，让它们继续留在回收站里。',
        ) : null,
      )
    }

    // ── error boundary: never leave the settings page blank ─────────────────
    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) { return { error } }
      render() {
        if (!this.state.error) return this.props.children
        return h('div', { className: 'sw-root', style: { padding: 20, color: T.danger, fontSize: 13 } },
          h('div', { style: { fontWeight: 600, marginBottom: 6 } }, '页面渲染出错'),
          h('div', { className: 'sw-mono', style: { fontSize: 11, color: T.faint, whiteSpace: 'pre-wrap' } }, String(this.state.error && this.state.error.message || this.state.error)),
          h('div', { style: { marginTop: 10 } }, h(Btn, { label: '重新加载', onClick: () => location.reload() })),
        )
      }
    }

    function BroomIcon(props) {
      const s = (props && props.size) || 16
      return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M14.2 3.2l6.6 6.6-2.6 2.6-6.6-6.6 2.6-2.6z', stroke: 'currentColor', strokeWidth: 1.7, strokeLinejoin: 'round' }),
        h('path', { d: 'M11.2 13.4l-6.4 6.4a1.5 1.5 0 002.1 2.1l6.4-6.4', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
        h('path', { d: 'M9.4 17.2l-1.5 1.5M12.4 20.2l-1.5 1.5', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-sweeper',
          order: 35,
          label: () => '清理对话垃圾',
        }, () => h(Boundary, null, h(Page))))

        ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon',
          id: 'dsh-sweeper',
        }, BroomIcon))
      },
    }
  },
})
