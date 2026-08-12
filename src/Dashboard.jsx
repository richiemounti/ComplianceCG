import { useCallback, useEffect, useMemo, useState } from 'react'

/* ── API helpers ───────────────────────────────────────── */
const get = key => fetch(`/.netlify/functions/notion?db=${key}`).then(async res => {
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `API error ${res.status}`)
  return data
})

const patch = (pageId, status) =>
  fetch(`/.netlify/functions/notion?action=patch&pageId=${pageId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  }).then(res => res.json())

/* ── Utilities ─────────────────────────────────────────── */
const formatDate = value =>
  value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`)) : '—'

const count = (items, property, values) =>
  values.reduce((result, value) => ({ ...result, [value]: items.filter(i => i[property] === value).length }), {})

const statusTone = value =>
  ['Done', 'Active', 'Approved', 'Closed', 'In Place', 'Enabled'].includes(value) ? 'good'
  : ['High', 'Overdue', 'Not In Place', 'Not in place', 'Pending'].includes(value) ? 'critical'
  : 'attention'

const ownerOf = person => item =>
  !person || item.owner?.split(',').map(n => n.trim()).includes(person)

/* ── Shared components ──────────────────────────────────── */
function Badge({ children }) {
  return <span className={`badge ${statusTone(children)}`}>{children || '—'}</span>
}

function NotionLink({ item, children }) {
  return (
    <a className="notion-link" href={item.url} target="_blank" rel="noreferrer">
      {children}<span aria-hidden="true">↗</span>
    </a>
  )
}

function Panel({ title, source, children }) {
  return (
    <section className="panel">
      <header className="panel-heading">
        <h2>{title}</h2>
        {source && <span>{source}</span>}
      </header>
      {children}
    </section>
  )
}

function MetricBand({ metrics }) {
  return (
    <section className="metric-band" aria-label="Key indicators">
      {metrics.map(m => (
        <button type="button" key={m.label} onClick={m.onClick}>
          <span>{m.label}</span>
          <strong className={m.tone || ''}>{m.value}</strong>
        </button>
      ))}
    </section>
  )
}

function FilterBar({ options, value, onChange }) {
  return (
    <div className="filter-bar">
      {options.map(([filter, label]) => (
        <button key={filter} type="button" className={value === filter ? 'selected' : ''} onClick={() => onChange(filter)}>
          {label}
        </button>
      ))}
    </div>
  )
}

function Pager({ items, children }) {
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(items.length / 10))
  const cur = Math.min(page, pageCount - 1)
  const start = cur * 10
  const visible = items.slice(start, start + 10)
  return (
    <>
      {children(visible)}
      <footer className="pager">
        <span>{items.length ? `Showing ${start + 1}–${Math.min(start + 10, items.length)} of ${items.length}` : 'No matching records'}</span>
        <button type="button" disabled={cur === 0} onClick={() => setPage(cur - 1)}>‹</button>
        <span>{cur + 1} / {pageCount}</span>
        <button type="button" disabled={cur === pageCount - 1} onClick={() => setPage(cur + 1)}>›</button>
      </footer>
    </>
  )
}

function TaskRows({ items }) {
  return (
    <div className="rows">
      {items.length
        ? items.map(item => (
            <div className="row" key={item.id}>
              <div>
                <NotionLink item={item}>{item.activityId ? `${item.activityId} · ` : ''}{item.name}</NotionLink>
                <p>{item.owner || '—'} · {formatDate(item.dueDate)}</p>
              </div>
              <Badge>{item.status}</Badge>
            </div>
          ))
        : <p className="empty">No matching records</p>}
    </div>
  )
}

/* ── Checkable task row (My Actions) ───────────────────── */
function CheckRow({ item, onDone }) {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(item.status === 'Done')
  const toggle = async () => {
    if (done || loading) return
    setLoading(true)
    try {
      await patch(item.id, 'Done')
      setDone(true)
      onDone && onDone(item.id)
    } catch { /* silent — user can retry */ }
    setLoading(false)
  }
  return (
    <div className={`action-row ${done ? 'action-done' : ''}`} data-owner={item.owner}>
      <button
        type="button"
        className={`action-check${done ? ' checked' : ''}${loading ? ' loading' : ''}`}
        onClick={toggle}
        aria-label={done ? 'Done' : 'Mark as done'}
        title={done ? 'Done' : 'Mark as done'}
      >
        {done ? '✓' : loading ? '…' : ''}
      </button>
      <div className="action-info">
        <NotionLink item={item}>{item.activityId ? `${item.activityId} · ` : ''}{item.name}</NotionLink>
        <p>{item.owner || '—'} · {formatDate(item.dueDate)}</p>
      </div>
      <Badge>{item.status}</Badge>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════
   OVERVIEW
   ════════════════════════════════════════════════════════ */
function MonthlySummaryBanner({ tracker }) {
  // Find the 5th-of-month "Submit Monthly Risk Summary" recurring task
  const summaryTask = tracker.items.find(i =>
    i.frequency === 'Monthly' && i.name?.toLowerCase().includes('risk summary')
  )
  const isDone = summaryTask?.status === 'Done'
  const kateTask = tracker.items.find(i =>
    i.frequency === 'Monthly' && i.name?.toLowerCase().includes('review and respond')
  )

  // Days overdue calculation
  let overdueText = ''
  if (summaryTask?.dueDate && !isDone) {
    const due = new Date(summaryTask.dueDate)
    const today = new Date()
    const diff = Math.floor((today - due) / 86400000)
    overdueText = diff > 0 ? ` · ${diff} day${diff === 1 ? '' : 's'} overdue` : ''
  }

  const now = new Date()
  const monthLabel = now.toLocaleString('en-GB', { month: 'long', year: 'numeric' }).toUpperCase()

  return (
    <div className={`monthly-banner${isDone ? ' submitted' : ''}`}>
      <div className="monthly-banner-inner">
        <div className="monthly-banner-left">
          <span className="monthly-pulse" />
          <div>
            <div className="monthly-label">{monthLabel} — MONTHLY RISK SUMMARY</div>
            <div className="monthly-stat">
              {isDone ? 'Submitted' : `Not submitted${overdueText}`}
            </div>
          </div>
        </div>
        <div className="monthly-pills">
          {summaryTask && (
            <span className={`mpill ${isDone ? 'mpill-good' : 'mpill-crit'}`}>
              Belinda: {isDone ? 'submitted' : 'draft needed'}
            </span>
          )}
          {kateTask && (
            <span className={`mpill ${kateTask.status === 'Done' ? 'mpill-good' : 'mpill-warn'}`}>
              Kate: {kateTask.status === 'Done' ? 'responded' : 'awaiting'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

/* Collapsible domain risk list — used in Overview */
function DomainRiskList({ risks }) {
  const [openDomain, setOpenDomain] = useState(null)
  const domains = Object.entries(risks.byDomain || {}).filter(([, v]) => v)
  const toggle = d => setOpenDomain(prev => prev === d ? null : d)
  return (
    <div className="domain-list">
      {domains.map(([label, value]) => {
        const isOpen = openDomain === label
        const domainRisks = risks.items.filter(i => i.domain === label)
        return (
          <div key={label} className="domain-item">
            <button type="button" className="domain-row" onClick={() => toggle(label)}>
              <span className="domain-name">{label}</span>
              <i className="domain-bar-track"><em style={{ width: `${risks.total ? value / risks.total * 100 : 0}%` }} /></i>
              <b className="domain-count">{value}</b>
              <span className={`wf-chev${isOpen ? ' open' : ''}`}>⌄</span>
            </button>
            {isOpen && (
              <div className="domain-risks">
                {domainRisks.map(r => (
                  <div className="domain-risk-row" key={r.id}>
                    <NotionLink item={r}>{r.riskId ? `${r.riskId} · ` : ''}{r.name}</NotionLink>
                    <div className="domain-risk-meta">
                      <Badge>{r.probability}</Badge>
                      <Badge>{r.controlStatus || r.category || '—'}</Badge>
                      <span>{r.owner || '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Overview({ risks, controls, tracker, onOpen }) {
  const active    = controls.byStatus.Active || 0
  const available = tracker.total - (tracker.byStatus.Skipped || 0)

  const metrics = [
    { label: 'Total risks',      value: risks.total,                                                           onClick: () => onOpen('risks', 'all') },
    { label: 'High probability', value: risks.byProbability.High || 0,       tone: 'critical',                 onClick: () => onOpen('risks', 'high') },
    { label: 'Open risks',       value: risks.byCategory.Open || 0,          tone: 'attention',                onClick: () => onOpen('risks', 'open') },
    { label: 'Controls active',  value: `${controls.total ? Math.round(active / controls.total * 100) : 0}%`, onClick: () => onOpen('controls', 'all') },
    { label: 'Activities done',  value: `${available ? Math.round((tracker.byStatus.Done || 0) / available * 100) : 0}%`, tone: 'good', onClick: () => onOpen('actions', 'Done') },
    { label: 'Overdue',          value: tracker.byStatus.Overdue || 0,       tone: 'critical',                 onClick: () => onOpen('actions', 'Overdue') },
  ]

  // Only true recurring tasks — Monthly / Quarterly / Annual
  const RECURRING_FREQUENCIES = ['Monthly', 'Quarterly', 'Annual', 'Annually']
  const recurring = tracker.items
    .filter(i => i.frequency && RECURRING_FREQUENCIES.includes(i.frequency) && !['Done', 'Skipped'].includes(i.status))
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
    .slice(0, 8)

  return (
    <>
      <MetricBand metrics={metrics} />
      <div className="two-columns">
        <Panel title="Risk Register — By Domain" source="Unified Risk Register">
          <DomainRiskList risks={risks} />
        </Panel>
        <Panel title="Recurring Governance Tasks" source="Governance Tracker">
          <TaskRows items={recurring} />
        </Panel>
      </div>
      <WorkflowsAccordion />
    </>
  )
}

// TODO Sam: add notionUrl for each workflow — the Notion page URL from the compliance hub
const WORKFLOWS = [
  { id: 'wf1',  num: 'WF 1',  name: 'New processing activity',         cadence: 'Event-based', trigger: 'New data processing activity identified',       owner: 'Belinda',           steps: 'DPIA screening → RoPA entry → LIA if needed → DPA check',                                         notionUrl: '' },
  { id: 'wf2',  num: 'WF 2',  name: 'Data breach',                     cadence: 'Event-based', trigger: 'Suspected or confirmed data breach',             owner: 'Belinda + Kate',    steps: 'Severity score → 72hr ICO clock → CFC notify → data subjects',                                    notionUrl: '' },
  { id: 'wf3',  num: 'WF 3',  name: 'Monthly risk review',             cadence: 'Monthly',     trigger: '5th of each month',                             owner: 'Belinda → Kate',    steps: 'Risk Register sweep → Controls check → Monthly Risk Summary → Kate review by 10th',               notionUrl: '' },
  { id: 'wf4',  num: 'WF 4',  name: 'Staff changes',                   cadence: 'Event-based', trigger: 'New starter or leaver',                         owner: 'Belinda',           steps: 'Access provisioning → DBS check → NDA → training → offboarding checklist',                        notionUrl: '' },
  { id: 'wf5',  num: 'WF 5',  name: 'Annual compliance cycle',         cadence: 'Annual',      trigger: 'January each year',                             owner: 'Belinda',           steps: 'Full RoPA review → policy review → DPIA review → ICO horizon scan → SAT',                          notionUrl: '' },
  { id: 'wf6',  num: 'WF 6',  name: 'Client dependency monitoring',    cadence: 'Monthly',     trigger: '1st of each month',                             owner: 'Kate',              steps: 'Update Revenue Concentration Tracker → quarterly review if threshold met',                          notionUrl: '' },
  { id: 'wf7',  num: 'WF 7',  name: 'Contract renewal & off-boarding', cadence: 'Event-based', trigger: 'Contract end or 90-day flag',                   owner: 'Kate + Belinda',    steps: 'Data export → deletion confirmation → DPA closure → Kontainer export',                            notionUrl: '' },
  { id: 'wf8',  num: 'WF 8',  name: 'Reputational risk monitoring',    cadence: 'Event-based', trigger: 'Press mention, complaint or incident',          owner: 'Kate + Hannah',     steps: 'Log in register → triage → response plan → ICO if applicable',                                    notionUrl: '' },
  { id: 'wf9',  num: 'WF 9',  name: 'Due diligence readiness',         cadence: 'Live now',    trigger: 'Active — investment raise ongoing',             owner: 'Kate + Belinda',    steps: 'Pre-meeting checklist → Data Room audit → compliance narrative → investor update',                 notionUrl: '' },
  { id: 'wf10', num: 'WF 10', name: 'Research safeguarding',           cadence: 'Event-based', trigger: 'New research project with participants',         owner: 'Sumaiya + Belinda', steps: 'Risk assessment → consent via Kontainer → DBS checks → field safety briefing',                    notionUrl: '' },
  { id: 'wf11', num: 'WF 11', name: 'Staff & partner concerns',        cadence: 'Event-based', trigger: 'Concern raised by staff or partner',            owner: 'Sumaiya',           steps: 'Triage → log in Safeguarding Register → escalate if needed → wellbeing support',                  notionUrl: '' },
  { id: 'wf12', num: 'WF 12', name: 'Safeguarding governance',         cadence: 'Quarterly',   trigger: 'End of each quarter',                           owner: 'Sumaiya',           steps: 'Quarterly review → DBS renewal check → training refresh → annual audit Dec',                       notionUrl: '' },
]

const WF_GROUPS = [
  {
    group: 'Scheduled — runs on a fixed cycle',
    workflows: ['wf3', 'wf5', 'wf6', 'wf12'],
  },
  {
    group: 'Event-based — triggered when something happens',
    workflows: ['wf1', 'wf2', 'wf4', 'wf7', 'wf8', 'wf10', 'wf11'],
  },
  {
    group: 'Active now',
    workflows: ['wf9'],
  },
]

function WorkflowsAccordion() {
  const [open, setOpen] = useState(null)
  const toggle = id => setOpen(prev => prev === id ? null : id)
  const wfMap = Object.fromEntries(WORKFLOWS.map(w => [w.id, w]))
  return (
    <Panel title="Workflows" source="">
      {WF_GROUPS.map(group => (
        <div key={group.group} className="wf-group">
          <div className="wf-group-label">{group.group}</div>
          {group.workflows.map(id => {
            const wf = wfMap[id]
            if (!wf) return null
            const isOpen = open === wf.id
            return (
              <div key={wf.id} className="wf-item">
                <button type="button" className="wf-row" onClick={() => toggle(wf.id)}>
                  <span className="wf-num">{wf.num}</span>
                  <span className="wf-name">{wf.name}</span>
                  <span className={`wf-cadence cadence-${wf.cadence.toLowerCase().replace(/\s/g,'-')}`}>{wf.cadence}</span>
                  <span className={`wf-chev${isOpen ? ' open' : ''}`}>⌄</span>
                </button>
                {isOpen && (
                  <div className="wf-detail">
                    <div className="wf-detail-grid">
                      <div><div className="wfd-lbl">Trigger</div><div className="wfd-val">{wf.trigger}</div></div>
                      <div><div className="wfd-lbl">Owner</div><div className="wfd-val">{wf.owner}</div></div>
                      <div><div className="wfd-lbl">Key steps</div><div className="wfd-val">{wf.steps}</div></div>
                    </div>
                    {wf.notionUrl && (
                      <a href={wf.notionUrl} target="_blank" rel="noreferrer" className="wf-notion-link">
                        Open in Notion ↗
                      </a>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </Panel>
  )
}

/* ══════════════════════════════════════════════════════════
   MY ACTIONS  (replaces GovernanceTracker on this tab)
   ════════════════════════════════════════════════════════ */
function MyActions({ tracker, filter, onFilter }) {
  const [view, setView] = useState('list')
  const [localDone, setLocalDone] = useState(new Set())

  const items = tracker.items
    .filter(i => filter === 'all' || i.status === filter)
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))

  const handleDone = id => setLocalDone(prev => new Set([...prev, id]))

  const urgent  = items.filter(i => i.status !== 'Done' && !localDone.has(i.id) && i.priority === 'High' && i.status === 'To Do' && i.dueDate && new Date(i.dueDate) <= new Date(Date.now() + 4 * 86400000))
  const overdue = items.filter(i => i.status === 'Overdue' && !localDone.has(i.id))
  const todo    = items.filter(i => i.status === 'To Do' && !localDone.has(i.id) && !urgent.includes(i))
  const inprog  = items.filter(i => i.status === 'In Progress' && !localDone.has(i.id))
  const done    = items.filter(i => i.status === 'Done' || localDone.has(i.id))

  return (
    <>
      <div className="actions-header">
        <div className="view-toggle">
          {[['list','List'],['board','Board'],['cal','Calendar']].map(([v,l]) => (
            <button key={v} type="button" className={view === v ? 'selected' : ''} onClick={() => setView(v)}>{l}</button>
          ))}
        </div>
        <FilterBar value={filter} onChange={onFilter} options={[['all','All'],['To Do','To Do'],['In Progress','In Progress'],['Overdue','Overdue'],['Done','Done']]} />
      </div>

      {view === 'list' && (
        <div className="actions-list">
          {urgent.length > 0 && (
            <div className="action-group">
              <div className="action-group-title critical">Urgent — due within 4 days <span className="count-badge">{urgent.length}</span></div>
              {urgent.map(i => <CheckRow key={i.id} item={i} onDone={handleDone} />)}
            </div>
          )}
          {overdue.length > 0 && (
            <div className="action-group">
              <div className="action-group-title attention">Overdue <span className="count-badge">{overdue.length}</span></div>
              {overdue.map(i => <CheckRow key={i.id} item={i} onDone={handleDone} />)}
            </div>
          )}
          {inprog.length > 0 && (
            <div className="action-group">
              <div className="action-group-title">In progress <span className="count-badge">{inprog.length}</span></div>
              {inprog.map(i => <CheckRow key={i.id} item={i} onDone={handleDone} />)}
            </div>
          )}
          {todo.length > 0 && (
            <div className="action-group">
              <div className="action-group-title">To do <span className="count-badge">{todo.length}</span></div>
              {todo.map(i => <CheckRow key={i.id} item={i} onDone={handleDone} />)}
            </div>
          )}
          {done.length > 0 && (
            <div className="action-group">
              <div className="action-group-title good">Done <span className="count-badge">{done.length}</span></div>
              {done.map(i => <CheckRow key={i.id} item={i} onDone={handleDone} />)}
            </div>
          )}
          {items.length === 0 && <p className="empty">No matching actions</p>}
        </div>
      )}

      {view === 'board' && (
        <div className="kanban">
          {[
            { label: 'Urgent',      tone: 'critical',  items: urgent },
            { label: 'Overdue',     tone: 'attention', items: overdue },
            { label: 'In Progress', tone: '',          items: inprog },
            { label: 'To Do',       tone: '',          items: todo },
            { label: 'Done',        tone: 'good',      items: done },
          ].map(col => (
            <div key={col.label} className="kan-col">
              <div className={`kan-col-header ${col.tone}`}>{col.label} <span>{col.items.length}</span></div>
              {col.items.map(i => (
                <div key={i.id} className="kan-card">
                  <NotionLink item={i}>{i.activityId ? `${i.activityId} · ` : ''}{i.name}</NotionLink>
                  <p>{i.owner || '—'} · {formatDate(i.dueDate)}</p>
                  <Badge>{i.status}</Badge>
                </div>
              ))}
              {col.items.length === 0 && <p className="empty" style={{fontSize:'10px',padding:'12px 0'}}>None</p>}
            </div>
          ))}
        </div>
      )}

      {view === 'cal' && <CalendarView tracker={tracker} />}
    </>
  )
}

/* ── Minimal calendar ──────────────────────────────────── */
function CalendarView({ tracker }) {
  const [offset, setOffset] = useState(0)
  const base = new Date()
  base.setMonth(base.getMonth() + offset)
  const year = base.getFullYear()
  const month = base.getMonth()
  const monthLabel = base.toLocaleString('en-GB', { month: 'long', year: 'numeric' })

  const firstDay = new Date(year, month, 1).getDay() // 0=Sun
  const startOffset = firstDay === 0 ? 6 : firstDay - 1 // Mon-start
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const today = new Date()

  // Index tasks by due date
  const byDate = {}
  tracker.items.forEach(item => {
    if (!item.dueDate) return
    const d = item.dueDate.slice(0, 10)
    if (!byDate[d]) byDate[d] = []
    byDate[d].push(item)
  })

  const cells = []
  // leading blanks
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  return (
    <div className="cal-wrap">
      <div className="cal-hdr">
        <button type="button" onClick={() => setOffset(o => o - 1)}>‹</button>
        <strong>{monthLabel}</strong>
        <button type="button" onClick={() => setOffset(o => o + 1)}>›</button>
      </div>
      <div className="cal-grid">
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => <div key={d} className="cal-dh">{d}</div>)}
        {cells.map((d, idx) => {
          if (!d) return <div key={`blank-${idx}`} className="cal-day blank" />
          const key = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
          const tasks = byDate[key] || []
          const isToday = today.getDate() === d && today.getMonth() === month && today.getFullYear() === year
          const hasUrgent = tasks.some(t => t.status === 'Overdue' || t.priority === 'High')
          return (
            <div key={d} className={`cal-day${isToday ? ' today' : ''}${hasUrgent ? ' has-urgent' : ''}`}>
              <div className="cal-dn">{d}</div>
              {tasks.slice(0, 3).map(t => (
                <a key={t.id} href={t.url} target="_blank" rel="noreferrer"
                   className={`cal-ev ${t.status === 'Overdue' ? 'ce-r' : t.status === 'Done' ? 'ce-g' : t.frequency ? 'ce-b' : 'ce-a'}`}
                   title={t.name}>
                  {t.name}
                </a>
              ))}
              {tasks.length > 3 && <div className="cal-more">+{tasks.length - 3}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════
   RISK REGISTER
   ════════════════════════════════════════════════════════ */
function RiskRegister({ risks, filter, onFilter }) {
  const [domainFilter, setDomainFilter] = useState(null)
  const rows = risks.items.filter(item => {
    const matchesDomain = !domainFilter || item.domain === domainFilter
    const matchesFilter =
      filter === 'all' ||
      (filter === 'high' && item.probability === 'High') ||
      (filter === 'open' && item.category === 'Open')
    return matchesDomain && matchesFilter
  })
  const toggleDomain = d => setDomainFilter(prev => prev === d ? null : d)
  return (
    <>
      <FilterBar value={filter} onChange={f => { onFilter(f); setDomainFilter(null) }} options={[['all','All risks'],['high','High probability'],['open','Open risks']]} />
      <Panel title="Risk Register — By Domain" source="Unified Risk Register">
        <div className="bars">
          {Object.entries(risks.byDomain || {}).filter(([,v]) => v).map(([label, value]) => (
            <button
              type="button"
              key={label}
              onClick={() => toggleDomain(label)}
              className={domainFilter === label ? 'bar-active' : ''}
            >
              <span>{label}</span>
              <i><em style={{ width: `${risks.total ? value / risks.total * 100 : 0}%` }} /></i>
              <b>{value}</b>
            </button>
          ))}
        </div>
        {domainFilter && (
          <div className="domain-active-label">
            Showing {domainFilter} risks
            <button type="button" className="domain-clear" onClick={() => setDomainFilter(null)}>✕ Clear</button>
          </div>
        )}
      </Panel>
      <Panel title="Risk Register — Records" source="Unified Risk Register">
        <Pager items={rows}>
          {visible => (
            <div className="data-table risk-table">
              <div className="table-head"><span>Risk</span><span>Domain</span><span>Probability</span><span>Impact</span><span>Control status</span><span>Risk category</span><span>Risk owner</span></div>
              {visible.map(item => (
                <div className="table-row" key={item.id}>
                  <NotionLink item={item}>{item.riskId ? `${item.riskId} · ` : ''}{item.name}</NotionLink>
                  <span>{item.domain || '—'}</span>
                  <Badge>{item.probability}</Badge>
                  <span>{item.consequences || '—'}</span>
                  <Badge>{item.controlStatus}</Badge>
                  <Badge>{item.category}</Badge>
                  <span>{item.owner || '—'}</span>
                </div>
              ))}
            </div>
          )}
        </Pager>
      </Panel>
    </>
  )
}

/* ══════════════════════════════════════════════════════════
   CONTROLS
   ════════════════════════════════════════════════════════ */
function Controls({ controls, filter, onFilter }) {
  const rows = controls.items.filter(i => filter === 'all' || i.status === filter)
  const c = controls.byStatus
  return (
    <>
      <section className="state-band">
        <div><strong>{c.Active || 0}</strong><span>Active</span></div>
        <div><strong>{c.Partial || 0}</strong><span>Partial</span></div>
        <div><strong>{c['Not In Place'] || 0}</strong><span>Not in place</span></div>
        <div><strong>{controls.total ? `${Math.round((c.Active || 0) / controls.total * 100)}%` : '0%'}</strong><span>Controls active</span></div>
      </section>
      <FilterBar value={filter} onChange={onFilter} options={[['all','All controls'],['Active','Active'],['Partial','Partial'],['Not In Place','Not in place']]} />
      <Panel title="Controls Register" source="Controls Register">
        <Pager items={rows}>
          {visible => (
            <div className="data-table controls-table">
              <div className="table-head"><span>Control</span><span>Domain</span><span>Control type</span><span>Status</span><span>Owner</span><span>Review date</span><span>Review frequency</span></div>
              {visible.map(item => (
                <div className="table-row" key={item.id}>
                  <NotionLink item={item}>{item.controlId ? `${item.controlId} · ` : ''}{item.name}</NotionLink>
                  <span>{item.domain || '—'}</span>
                  <span>{item.type || '—'}</span>
                  <Badge>{item.status}</Badge>
                  <span>{item.owner || '—'}</span>
                  <time>{formatDate(item.reviewDate)}</time>
                  <span>{item.reviewFrequency || '—'}</span>
                </div>
              ))}
            </div>
          )}
        </Pager>
      </Panel>
    </>
  )
}

/* ══════════════════════════════════════════════════════════
   MONTHLY RHYTHM
   ════════════════════════════════════════════════════════ */
function MonthlyRhythm({ tracker, risks, controls }) {
  const openTasks  = tracker.items.filter(i => !['Done','Skipped'].includes(i.status))
  const recurring  = tracker.items.filter(i => i.frequency && !['Done','Skipped'].includes(i.status))
  const highRisks  = risks.items.filter(i => i.probability === 'High')
  const gaps       = controls.items.filter(i => ['Partial','Not In Place'].includes(i.status))

  // Report readiness — auto checks
  const sumaiyaTask = tracker.items.find(i => i.frequency === 'Monthly' && i.name?.toLowerCase().includes('nil return'))
  const sumaiyaDone = sumaiyaTask?.status === 'Done'
  const overdueCount = tracker.byStatus.Overdue || 0

  const readiness = [
    { label: 'RAG by domain',       src: 'Manual — Belinda',      status: 'manual',   note: 'Review Risk Register before submitting' },
    { label: 'Outstanding risks',   src: 'Risk Register',         status: 'ready',    note: `${highRisks.length} high probability` },
    { label: 'Controls status',     src: 'Controls Register',     status: 'ready',    note: `${gaps.length} gap${gaps.length === 1 ? '' : 's'} present` },
    { label: 'Sumaiya nil return',  src: 'GT — 3rd-of-month task', status: sumaiyaDone ? 'ready' : 'missing', note: sumaiyaDone ? 'Received' : 'Not received — chase before submitting' },
    { label: 'Overdue tasks',       src: 'Governance Tracker',    status: 'ready',    note: `${overdueCount} overdue task${overdueCount === 1 ? '' : 's'}` },
    { label: 'Activity this month', src: 'Governance Tracker',    status: 'ready',    note: `${tracker.byStatus.Done || 0} completed this cycle` },
    { label: 'Recommendation',      src: 'Manual — Belinda',      status: 'manual',   note: 'Meeting yes/no + threshold' },
  ]

  const blocking = readiness.filter(r => r.status === 'missing')

  return (
    <>
      <MetricBand metrics={[
        { label: 'Open activities',  value: openTasks.length,              onClick: () => {} },
        { label: 'Overdue',          value: overdueCount, tone: 'critical', onClick: () => {} },
        { label: 'High probability', value: highRisks.length, tone: 'critical', onClick: () => {} },
        { label: 'Control gaps',     value: gaps.length, tone: 'attention', onClick: () => {} },
        { label: 'Recurring',        value: recurring.length,              onClick: () => {} },
        { label: 'Activities done',  value: tracker.byStatus.Done || 0, tone: 'good', onClick: () => {} },
      ]} />

      {/* Report readiness */}
      <Panel title="Report Readiness" source="RR · CR · GT">
        <div className="rr-list">
          {readiness.map(r => (
            <div key={r.label} className="rr-item">
              <div className={`rr-icon rr-${r.status}`}>
                {r.status === 'ready' ? '✓' : r.status === 'missing' ? '✗' : '–'}
              </div>
              <div className="rr-label">{r.label}</div>
              <div className="rr-src">{r.src}</div>
              <div className={`rr-status rr-status-${r.status}`}>{r.note}</div>
            </div>
          ))}
        </div>
        {blocking.length > 0 && (
          <div className="rr-blocker">
            <strong>{blocking.length} item{blocking.length > 1 ? 's' : ''} blocking: </strong>
            {blocking.map(b => b.label).join(', ')}
          </div>
        )}
      </Panel>

      {/* Monthly cycle */}
      <Panel title="The Monthly Cycle" source="Governance Tracker">
        <div className="cycle-grid">
          {[
            { day: '3rd', who: 'Sumaiya', what: 'Safeguarding nil return to Belinda' },
            { day: '5th', who: 'Belinda', what: 'Submit Monthly Risk Summary to Kate' },
            { day: '10th', who: 'Kate',   what: 'Review, respond and decide — meeting yes/no' },
          ].map((step, i, arr) => (
            <div key={step.day} className="cycle-pair">
              <div className="cycle-card">
                <div className="cycle-day">{step.day}</div>
                <div className="cycle-when">of each month</div>
                <div className="cycle-who">{step.who}</div>
                <div className="cycle-what">{step.what}</div>
              </div>
              {i < arr.length - 1 && <div className="cycle-arrow">→</div>}
            </div>
          ))}
        </div>
      </Panel>

      <div className="two-columns">
        <Panel title="Upcoming Deadlines" source="Governance Tracker">
          <TaskRows items={tracker.upcoming} />
        </Panel>
        <Panel title="High Probability Risks" source="Unified Risk Register">
          <TaskRows items={highRisks.map(i => ({ ...i, activityId: i.riskId, dueDate: i.reviewDate, status: i.controlStatus }))} />
        </Panel>
      </div>
    </>
  )
}

/* ══════════════════════════════════════════════════════════
   SAFEGUARDING
   ════════════════════════════════════════════════════════ */
function Safeguarding({ tracker, risks, controls }) {
  const taskRows    = tracker.items.filter(i => i.domain === 'Safeguarding')
  const riskRows    = risks.items.filter(i => i.domain === 'Safeguarding')
  const controlRows = controls.items.filter(i => i.domain === 'Safeguarding')
  const openTasks   = taskRows.filter(i => !['Done','Skipped'].includes(i.status))
  return (
    <>
      <section className="state-band">
        <div><strong>{openTasks.length}</strong><span>Open activities</span></div>
        <div><strong>{taskRows.filter(i => i.status === 'Overdue').length}</strong><span>Overdue</span></div>
        <div><strong>{riskRows.length}</strong><span>Risks</span></div>
        <div><strong>{controlRows.filter(i => i.status === 'Active').length}</strong><span>Controls active</span></div>
      </section>
      <div className="two-columns">
        <Panel title="Governance Tracker" source="Governance Tracker">
          <TaskRows items={taskRows} />
        </Panel>
        <Panel title="Risk Register" source="Unified Risk Register">
          <TaskRows items={riskRows.map(i => ({ ...i, activityId: i.riskId, dueDate: i.reviewDate, status: i.controlStatus }))} />
        </Panel>
      </div>
      <Panel title="Controls Register" source="Controls Register">
        <TaskRows items={controlRows.map(i => ({ ...i, activityId: i.controlId, dueDate: i.reviewDate, status: i.status }))} />
      </Panel>
    </>
  )
}

/* ══════════════════════════════════════════════════════════
   DOCUMENT LIBRARY
   ════════════════════════════════════════════════════════ */
function DocumentLibrary({ documents, filter, onFilter }) {
  const rows = documents.items.filter(i => filter === 'all' || i.status === filter)
  return (
    <>
      <MetricBand metrics={[
        { label: 'Approved',         value: documents.byStatus.Approved || 0,           tone: 'good',      onClick: () => onFilter('Approved') },
        { label: 'In review',        value: documents.byStatus['In review'] || 0,                          onClick: () => onFilter('In review') },
        { label: 'To be reviewed',   value: documents.byStatus['To be reviewed'] || 0,  tone: 'attention', onClick: () => onFilter('To be reviewed') },
        { label: 'Documents',        value: documents.total,                                               onClick: () => onFilter('all') },
      ]} />
      <FilterBar value={filter} onChange={onFilter} options={[['all','All documents'],['Approved','Approved'],['In review','In review'],['To be reviewed','To be reviewed']]} />
      <Panel title="Document Library" source="Document Library">
        <Pager items={rows}>
          {visible => (
            <div className="data-table document-table">
              <div className="table-head"><span>Document</span><span>Domain</span><span>Type</span><span>Owner</span><span>Status</span><span>Next review</span><span>Next approval</span></div>
              {visible.map(item => (
                <div className="table-row" key={item.id}>
                  <NotionLink item={item}>{item.docId ? `${item.docId} · ` : ''}{item.name}</NotionLink>
                  <span>{item.domain || '—'}</span>
                  <span>{item.type || '—'}</span>
                  <span>{item.owner || '—'}</span>
                  <Badge>{item.status}</Badge>
                  <time>{formatDate(item.nextReviewDate)}</time>
                  <time>{formatDate(item.nextApprovalDate)}</time>
                </div>
              ))}
            </div>
          )}
        </Pager>
      </Panel>
    </>
  )
}

/* ══════════════════════════════════════════════════════════
   RoPA
   ════════════════════════════════════════════════════════ */
function RoPA({ ropa, filter, onFilter }) {
  const rows = ropa.items.filter(i => filter === 'all' || i.flag === filter)
  const flags = [...new Set(ropa.items.map(i => i.flag).filter(Boolean))]
  return (
    <>
      <MetricBand metrics={[
        { label: 'Processing activities', value: ropa.total,                      onClick: () => onFilter('all') },
        { label: 'Reviewed',              value: ropa.byFlag.Reviewed || 0,       tone: 'good',      onClick: () => onFilter('Reviewed') },
        { label: 'LIA needed',            value: ropa.byFlag['LIA needed'] || 0,  tone: 'attention', onClick: () => onFilter('LIA needed') },
        { label: 'Review due',            value: ropa.byFlag['Review due'] || 0,                     onClick: () => onFilter('Review due') },
      ]} />
      <FilterBar value={filter} onChange={onFilter} options={[['all','All processing'], ...flags.map(f => [f, f])]} />
      <Panel title="Register of Processing Activities" source="RoPA">
        <Pager items={rows}>
          {visible => (
            <div className="data-table ropa-table">
              <div className="table-head"><span>Processing activity</span><span>Data subjects</span><span>Personal data</span><span>Purpose</span><span>Lawful basis</span><span>Systems</span><span>Retention</span><span>Flag</span></div>
              {visible.map(item => (
                <div className="table-row" key={item.id}>
                  <NotionLink item={item}>{item.name}</NotionLink>
                  <span>{item.subjects || '—'}</span>
                  <span>{item.personalData || '—'}</span>
                  <span>{item.purpose || '—'}</span>
                  <span>{item.basis || '—'}</span>
                  <span>{item.systems || '—'}</span>
                  <span>{item.retention || '—'}</span>
                  <Badge>{item.flag}</Badge>
                </div>
              ))}
            </div>
          )}
        </Pager>
      </Panel>
    </>
  )
}

/* ══════════════════════════════════════════════════════════
   IT TOOLS
   ════════════════════════════════════════════════════════ */
function ITTools({ tools, filter, onFilter }) {
  const rows = tools.items.filter(i =>
    filter === 'all' ||
    (filter === 'critical' && i.criticality === 'Critical') ||
    (filter === 'dpa'      && i.dpa === 'Pending') ||
    (filter === 'mfa'      && i.mfa !== 'Enabled')
  )
  const critical   = tools.items.filter(i => i.criticality === 'Critical').length
  const dpaPending = tools.items.filter(i => i.dpa === 'Pending').length
  const mfaEnabled = tools.items.filter(i => i.mfa === 'Enabled').length
  return (
    <>
      <MetricBand metrics={[
        { label: 'Tools and services',  value: tools.total,  onClick: () => onFilter('all') },
        { label: 'Critical suppliers',  value: critical,     tone: 'critical', onClick: () => onFilter('critical') },
        { label: 'DPA pending',         value: dpaPending,   tone: 'critical', onClick: () => onFilter('dpa') },
        { label: 'MFA enabled',         value: mfaEnabled,   tone: 'good',     onClick: () => onFilter('mfa') },
      ]} />
      <FilterBar value={filter} onChange={onFilter} options={[['all','All tools'],['critical','Critical'],['dpa','DPA pending'],['mfa','MFA not enabled']]} />
      <Panel title="Access Matrix" source="Access Matrix">
        <Pager items={rows}>
          {visible => (
            <div className="data-table tools-table">
              <div className="table-head"><span>Tool / supplier</span><span>Category</span><span>Owner</span><span>Criticality</span><span>DPA</span><span>MFA</span><span>Next review</span></div>
              {visible.map(item => (
                <div className="table-row" key={item.id}>
                  <NotionLink item={item}>{item.name}</NotionLink>
                  <span>{item.category || '—'}</span>
                  <span>{item.owner || '—'}</span>
                  <Badge>{item.criticality}</Badge>
                  <Badge>{item.dpa}</Badge>
                  <Badge>{item.mfa}</Badge>
                  <time>{formatDate(item.reviewDate)}</time>
                </div>
              ))}
            </div>
          )}
        </Pager>
      </Panel>
    </>
  )
}

/* ══════════════════════════════════════════════════════════
   STYLES
   ════════════════════════════════════════════════════════ */
function DashboardStyles() {
  return <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;500;600;700&display=swap');
    * { box-sizing: border-box; }
    body { margin: 0; background: #f7f4ee; color: #19332d; font-family: 'Work Sans', sans-serif; }
    button, select { font: inherit; }
    button { cursor: pointer; }
    .hub { min-height: 100vh; }

    /* header */
    .site-header { align-items: center; background: #17332d; color: #fff; display: flex; justify-content: space-between; min-height: 64px; padding: 0 4rem; }
    .brand { align-items: baseline; display: flex; gap: 14px; }
    .brand h1 { color: #fff; font-size: 25px; letter-spacing: -.07em; margin: 0; }
    .brand h1 span { color: #e7a642; }
    .brand p { color: rgba(255,255,255,.52); font-size: 10px; font-weight: 600; letter-spacing: .13em; margin: 0; text-transform: uppercase; }
    .header-actions { align-items: center; display: flex; gap: 10px; }
    .header-actions small { color: rgba(255,255,255,.5); font-size: 10px; }
    .header-actions select { background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.24); color: #fff; font-size: 11px; padding: 7px 9px; }
    .header-actions option { color: #19332d; }

    /* nav */
    .tab-nav { background: #17332d; display: flex; flex-wrap: wrap; padding: 0 3.25rem; }
    .tab-nav button { background: transparent; border: 0; border-bottom: 3px solid transparent; color: rgba(255,255,255,.52); font-size: 10px; font-weight: 600; letter-spacing: .09em; padding: 11px 13px 9px; text-transform: uppercase; }
    .tab-nav button:hover { color: #fff; }
    .tab-nav button.active { border-bottom-color: #e7a642; color: #fff; }

    /* content */
    .content { margin: 0 auto; max-width: 1500px; padding: 31px 4rem 52px; }
    .eyebrow { border-bottom: 1px solid #d8dfd9; color: #486058; font-size: 11px; font-weight: 600; letter-spacing: .12em; margin-bottom: 20px; padding-bottom: 14px; text-transform: uppercase; }

    /* monthly banner */
    .monthly-banner { background: #17332d; border-radius: 0; margin-bottom: 20px; }
    .monthly-banner.submitted { background: #1d3e35; }
    .monthly-banner-inner { align-items: center; display: flex; justify-content: space-between; padding: 14px 20px; }
    .monthly-pulse { animation: pulse 2s infinite; background: #e7a642; border-radius: 50%; display: inline-block; flex-shrink: 0; height: 8px; margin-right: 10px; width: 8px; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.25} }
    .monthly-banner-left { align-items: center; display: flex; }
    .monthly-label { color: rgba(255,255,255,.4); font-size: 9px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; margin-bottom: 3px; }
    .monthly-stat { color: #fff; font-size: 13px; font-weight: 500; }
    .monthly-pills { display: flex; gap: 6px; flex-shrink: 0; }
    .mpill { border-radius: 0; font-size: 9px; font-weight: 600; letter-spacing: .06em; padding: 4px 9px; text-transform: uppercase; }
    .mpill-crit { background: rgba(172,72,61,.35); border: 1px solid rgba(172,72,61,.4); color: #f0a0a0; }
    .mpill-warn { background: rgba(163,108,36,.25); border: 1px solid rgba(163,108,36,.35); color: #f0c060; }
    .mpill-good { background: rgba(62,126,86,.25); border: 1px solid rgba(62,126,86,.35); color: #a8d6b5; }

    /* metric band */
    .metric-band { background: #17332d; display: grid; grid-template-columns: repeat(6, minmax(0,1fr)); margin-bottom: 20px; }
    .metric-band button { background: transparent; border: 0; border-left: 1px solid rgba(255,255,255,.14); color: #fff; min-height: 104px; padding: 19px 20px; text-align: left; }
    .metric-band button:first-child { border-left: 0; }
    .metric-band button:hover { background: #24453d; box-shadow: inset 0 -3px #e7a642; }
    .metric-band span { color: rgba(255,255,255,.55); display: block; font-size: 9px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; }
    .metric-band strong { color: #fff; display: block; font-size: 31px; letter-spacing: -.06em; margin-top: 12px; }
    .metric-band strong.critical { color: #f1b0a8; }
    .metric-band strong.attention { color: #f2cc82; }
    .metric-band strong.good { color: #a8d6b5; }

    /* layout */
    .two-columns { display: grid; gap: 16px; grid-template-columns: minmax(0,1.1fr) minmax(300px,.9fr); margin-bottom: 20px; align-items: start; }

    /* panels */
    .panel { background: #fffdf8; border: 1px solid #dbe3dd; border-top: 3px solid #31594f; margin-bottom: 20px; min-width: 0; padding: 0 20px 16px; }
    .two-columns .panel { margin-bottom: 0; }
    .risk-top-grid { display: grid; gap: 16px; grid-template-columns: minmax(0,1.1fr) minmax(300px,.9fr); margin-bottom: 20px; align-items: start; }
    .risk-top-grid .panel { margin-bottom: 0; }
    .panel-heading { align-items: center; border-bottom: 1px solid #e0e6e1; display: flex; justify-content: space-between; margin-bottom: 8px; padding: 15px 0 12px; }
    .panel-heading h2 { font-size: 12px; letter-spacing: .08em; margin: 0; text-transform: uppercase; }
    .panel-heading span { border-bottom: 1px solid #bfd0c7; color: #547168; font-size: 9px; font-weight: 600; letter-spacing: .08em; padding-bottom: 2px; text-transform: uppercase; }

    /* bars */
    .bars > div, .bars > button { align-items: center; background: transparent; border: 0; border-bottom: 1px solid #e4e9e5; color: #19332d; display: grid; gap: 12px; grid-template-columns: minmax(100px,1fr) minmax(100px,2fr) 28px; padding: 12px 0; text-align: left; width: 100%; }
    .bars > div:last-child, .bars > button:last-child { border-bottom: 0; }
    .bars > button:hover { background: #f4f7f4; padding-left: 7px; }
    .bars span { font-size: 12px; font-weight: 600; }
    .bars i { background: #e4eae6; height: 5px; }
    .bars em { background: #31594f; display: block; height: 100%; }
    .bars b { font-size: 12px; text-align: right; }

    /* rows */
    .rows { padding: 0; }
    .row { align-items: center; border-bottom: 1px solid #e5ebe6; display: grid; gap: 10px; grid-template-columns: minmax(0,1fr) auto; padding: 12px 0; }
    .row:last-child { border-bottom: 0; }
    .notion-link { color: #193b32; font-size: 12px; font-weight: 600; text-decoration: none; }
    .notion-link span { color: #a56624; margin-left: 5px; }
    .notion-link:hover { color: #a56624; text-decoration: underline; text-underline-offset: 3px; }
    .row p { color: #7b8882; font-size: 10px; margin: 4px 0 0; }

    /* badges */
    .badge { border-left: 3px solid currentColor; display: inline-block; font-size: 9px; font-weight: 600; letter-spacing: .05em; padding: 4px 7px; text-transform: uppercase; white-space: nowrap; }
    .badge.good { background: #e7f2eb; color: #3e7e56; }
    .badge.critical { background: #fae9e5; color: #ac483d; }
    .badge.attention { background: #fbf0db; color: #a36c24; }

    /* filter bar */
    .filter-bar { border-bottom: 1px solid #d7dfd9; display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 18px; padding-bottom: 13px; }
    .filter-bar button { background: transparent; border: 1px solid #ced8d2; color: #60726b; font-size: 10px; font-weight: 600; padding: 6px 10px; }
    .filter-bar button.selected, .filter-bar button:hover { background: #31594f; border-color: #31594f; color: #fff; }

    /* state band */
    .state-band { background: #fffdf8; border-top: 3px solid #31594f; display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); margin-bottom: 20px; padding: 3px 0; }
    .state-band div { border-left: 1px solid #dde5df; padding: 14px 20px; }
    .state-band div:first-child { border-left: 0; }
    .state-band strong { color: #1d3e35; display: block; font-size: 25px; letter-spacing: -.06em; }
    .state-band span { color: #7c8983; display: block; font-size: 10px; margin-top: 5px; }

    /* tables */
    .data-table { min-width: 810px; }
    .table-head, .table-row { display: grid; gap: 10px; padding: 9px 8px; }
    .table-head { background: #f0f4f0; color: #587168; font-size: 9px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
    .table-row { align-items: center; border-bottom: 1px solid #e4e9e6; color: #5e7068; font-size: 11px; min-height: 48px; }
    .table-row:hover { background: #f4f8f4; }
    .tracker-table .table-head, .tracker-table .table-row { grid-template-columns: minmax(210px,2.4fr) 1fr .8fr 1fr .8fr .7fr .8fr; }
    .risk-table .table-head, .risk-table .table-row { grid-template-columns: minmax(220px,2.4fr) 1fr .8fr .8fr 1fr 1fr 1fr; }
    .controls-table .table-head, .controls-table .table-row { grid-template-columns: minmax(220px,2fr) 1fr 1fr .9fr 1fr .9fr 1fr; }
    .document-table .table-head, .document-table .table-row { grid-template-columns: minmax(220px,2fr) 1fr .8fr 1fr .9fr .9fr .9fr; }
    .ropa-table { min-width: 1060px; }
    .ropa-table .table-head, .ropa-table .table-row { grid-template-columns: minmax(210px,1.8fr) 1fr 1.1fr 1.2fr .9fr 1fr .8fr .8fr; }
    .tools-table .table-head, .tools-table .table-row { grid-template-columns: minmax(220px,1.8fr) 1fr 1fr .9fr .9fr .9fr .9fr; }
    .panel:has(.data-table) { overflow-x: auto; }

    /* pager */
    .pager { align-items: center; border-top: 1px solid #e4e9e6; display: flex; gap: 9px; justify-content: flex-end; margin-top: 13px; padding-top: 12px; }
    .pager span { color: #839089; font-size: 10px; }
    .pager button { background: #fff; border: 1px solid #d1dad4; color: #31594f; font-size: 12px; padding: 4px 8px; }
    .pager button:disabled { color: #c1c9c4; cursor: default; }
    .empty { color: #8a9690; font-size: 11px; padding: 24px 4px; text-align: center; }

    /* ── MY ACTIONS ── */
    .actions-header { align-items: center; display: flex; gap: 12px; margin-bottom: 16px; justify-content: space-between; flex-wrap: wrap; }
    .view-toggle { display: flex; gap: 0; border: 1px solid #ced8d2; overflow: hidden; }
    .view-toggle button { background: transparent; border: 0; border-right: 1px solid #ced8d2; color: #60726b; font-size: 10px; font-weight: 600; padding: 6px 11px; }
    .view-toggle button:last-child { border-right: 0; }
    .view-toggle button.selected { background: #31594f; color: #fff; }
    .action-group { margin-bottom: 16px; }
    .action-group-title { align-items: center; border-bottom: 1px solid #d7dfd9; color: #486058; display: flex; font-size: 10px; font-weight: 600; gap: 8px; letter-spacing: .09em; margin-bottom: 4px; padding-bottom: 8px; text-transform: uppercase; }
    .action-group-title.critical { color: #ac483d; }
    .action-group-title.attention { color: #a36c24; }
    .action-group-title.good { color: #3e7e56; }
    .count-badge { background: #e4eae6; border-radius: 10px; color: #486058; font-size: 9px; padding: 2px 7px; }
    .action-row { align-items: flex-start; border-bottom: 1px solid #e5ebe6; display: flex; gap: 10px; padding: 10px 6px; }
    .action-row:hover { background: #f4f8f4; }
    .action-row.action-done { opacity: .55; }
    .action-check { align-items: center; background: #fff; border: 1.5px solid #ced8d2; border-radius: 3px; color: #3e7e56; cursor: pointer; display: flex; flex-shrink: 0; font-size: 11px; font-weight: 700; height: 16px; justify-content: center; margin-top: 2px; width: 16px; }
    .action-check.checked { background: #31594f; border-color: #31594f; color: #fff; }
    .action-check.loading { background: #f0f4f0; color: #839089; }
    .action-info { flex: 1; min-width: 0; }
    .action-info p { color: #7b8882; font-size: 10px; margin: 4px 0 0; }

    /* kanban */
    .kanban { display: grid; gap: 12px; grid-template-columns: repeat(5, minmax(0,1fr)); }
    .kan-col { background: #f0f4f0; min-height: 200px; padding: 10px; }
    .kan-col-header { border-bottom: 1px solid #d7dfd9; color: #486058; font-size: 9px; font-weight: 600; letter-spacing: .09em; margin-bottom: 10px; padding-bottom: 8px; text-transform: uppercase; display: flex; justify-content: space-between; align-items: center; }
    .kan-col-header.critical { color: #ac483d; }
    .kan-col-header.attention { color: #a36c24; }
    .kan-col-header.good { color: #3e7e56; }
    .kan-col-header span { background: #dde5df; border-radius: 10px; font-size: 9px; padding: 2px 6px; }
    .kan-card { background: #fffdf8; border: 1px solid #dbe3dd; border-top: 3px solid #31594f; margin-bottom: 8px; padding: 10px 12px; }
    .kan-card p { color: #7b8882; font-size: 10px; margin: 6px 0 6px; }

    /* calendar */
    .cal-wrap { }
    .cal-hdr { align-items: center; border-bottom: 1px solid #d7dfd9; display: flex; gap: 12px; justify-content: space-between; margin-bottom: 12px; padding-bottom: 10px; }
    .cal-hdr strong { font-size: 13px; }
    .cal-hdr button { background: #fff; border: 1px solid #d1dad4; color: #31594f; font-size: 12px; padding: 4px 10px; }
    .cal-grid { display: grid; gap: 2px; grid-template-columns: repeat(7,1fr); }
    .cal-dh { color: #839089; font-size: 9px; font-weight: 600; letter-spacing: .08em; padding: 6px 4px; text-align: center; text-transform: uppercase; }
    .cal-day { background: #fffdf8; border: 1px solid #e4e9e6; min-height: 70px; padding: 5px 6px; }
    .cal-day.blank { background: transparent; border-color: transparent; }
    .cal-day.today { border-color: #31594f; border-width: 2px; }
    .cal-day.has-urgent { background: #fdf4f2; border-color: #dab0aa; }
    .cal-dn { color: #486058; font-size: 11px; font-weight: 600; margin-bottom: 3px; }
    .cal-day.today .cal-dn { color: #31594f; }
    .cal-ev { border-radius: 0; display: block; font-size: 9px; font-weight: 600; margin-bottom: 2px; overflow: hidden; padding: 2px 4px; text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
    .ce-r { background: #fae9e5; color: #ac483d; }
    .ce-a { background: #fbf0db; color: #a36c24; }
    .ce-g { background: #e7f2eb; color: #3e7e56; }
    .ce-b { background: #e3edf5; color: #3a6480; }
    .cal-more { color: #839089; font-size: 9px; padding: 1px 4px; }

    /* domain collapsible list (overview) */
    .domain-list { }
    .domain-item { border-bottom: 1px solid #e4e9e6; }
    .domain-item:last-child { border-bottom: 0; }
    .domain-row { align-items: center; background: transparent; border: 0; display: grid; gap: 12px; grid-template-columns: minmax(100px,1fr) minmax(100px,2fr) 28px 18px; padding: 12px 4px; text-align: left; width: 100%; cursor: pointer; }
    .domain-row:hover { background: #f4f8f4; padding-left: 7px; }
    .domain-name { font-size: 12px; font-weight: 600; }
    .domain-bar-track { background: #e4eae6; height: 5px; }
    .domain-bar-track em { background: #31594f; display: block; height: 100%; }
    .domain-count { font-size: 12px; text-align: right; }
    .domain-risks { background: #f7faf7; border-top: 1px solid #e4e9e6; padding: 8px 12px 8px 20px; }
    .domain-risk-row { align-items: center; border-bottom: 1px dashed #e4e9e6; display: flex; gap: 10px; justify-content: space-between; padding: 8px 0; }
    .domain-risk-row:last-child { border-bottom: 0; }
    .domain-risk-meta { align-items: center; display: flex; gap: 6px; flex-shrink: 0; }
    .domain-risk-meta span { color: #839089; font-size: 10px; }

    /* bar active state */
    .bars > button.bar-active { background: #eef4ee; }
    .domain-active-label { align-items: center; border-top: 1px solid #e4e9e6; color: #486058; display: flex; font-size: 10px; font-weight: 600; gap: 10px; justify-content: space-between; letter-spacing: .05em; padding: 8px 4px; text-transform: uppercase; }
    .domain-clear { background: transparent; border: 1px solid #ced8d2; color: #60726b; font-size: 10px; padding: 3px 8px; }
    .domain-clear:hover { background: #31594f; border-color: #31594f; color: #fff; }

    /* workflow groups */
    .wf-group { margin-bottom: 4px; }
    .wf-group-label { color: #839089; font-size: 9px; font-weight: 600; letter-spacing: .09em; margin: 14px 0 6px; text-transform: uppercase; }
    .wf-group:first-child .wf-group-label { margin-top: 4px; }
    .wf-item { border-bottom: 1px solid #e4e9e6; }
    .wf-item:last-child { border-bottom: 0; }
    .wf-row { align-items: center; background: transparent; border: 0; display: flex; gap: 10px; padding: 10px 4px; text-align: left; width: 100%; }
    .wf-row:hover { background: #f4f8f4; }
    .wf-num { color: #839089; font-size: 10px; width: 36px; flex-shrink: 0; }
    .wf-name { color: #19332d; flex: 1; font-size: 12px; font-weight: 600; }
    .wf-cadence { border: 1px solid #ced8d2; color: #60726b; font-size: 9px; font-weight: 600; letter-spacing: .05em; padding: 2px 7px; text-transform: uppercase; }
    .cadence-live-now { background: #fbf0db; border-color: #e7c87a; color: #a36c24; }
    .cadence-monthly { background: #e7f2eb; border-color: #a8d6b5; color: #3e7e56; }
    .wf-chev { color: #839089; flex-shrink: 0; font-size: 13px; transition: transform .2s; }
    .wf-chev.open { transform: rotate(180deg); }
    .wf-detail { background: #f4f8f4; border-top: 1px solid #e4e9e6; padding: 12px 12px 12px 50px; }
    .wf-detail-grid { display: flex; gap: 24px; flex-wrap: wrap; }
    .wf-detail-grid > div { flex: 1; min-width: 120px; }
    .wfd-lbl { color: #839089; font-size: 9px; font-weight: 600; letter-spacing: .08em; margin-bottom: 4px; text-transform: uppercase; }
    .wfd-val { color: #19332d; font-size: 11px; }
    .wf-notion-link { color: #a56624; display: inline-block; font-size: 10px; font-weight: 600; margin-top: 10px; text-decoration: none; }
    .wf-notion-link:hover { text-decoration: underline; }

    /* monthly rhythm */
    .rr-list { }
    .rr-item { align-items: center; border-bottom: 1px solid #e5ebe6; display: grid; gap: 12px; grid-template-columns: 28px 1fr 1fr auto; padding: 9px 0; }
    .rr-item:last-child { border-bottom: 0; }
    .rr-icon { align-items: center; border-radius: 50%; display: flex; font-size: 11px; font-weight: 700; height: 22px; justify-content: center; width: 22px; }
    .rr-ready  { background: #e7f2eb; color: #3e7e56; }
    .rr-missing{ background: #fae9e5; color: #ac483d; }
    .rr-manual { background: #f0f4f0; color: #839089; }
    .rr-label  { font-size: 12px; font-weight: 600; }
    .rr-src    { color: #839089; font-size: 10px; }
    .rr-status-ready  { color: #3e7e56; font-size: 10px; font-weight: 600; }
    .rr-status-missing{ color: #ac483d; font-size: 10px; font-weight: 600; }
    .rr-status-manual { color: #839089; font-size: 10px; }
    .rr-blocker { background: #fdf4f2; border-left: 4px solid #c55b45; color: #8e3f35; font-size: 11px; margin-top: 12px; padding: 10px 12px; }

    /* cycle */
    .cycle-grid { display: flex; align-items: center; gap: 0; margin: 4px 0 8px; }
    .cycle-pair { align-items: center; display: flex; flex: 1; gap: 0; }
    .cycle-card { background: #f0f4f0; flex: 1; padding: 14px 16px; text-align: center; }
    .cycle-day  { color: #1d3e35; font-size: 24px; font-weight: 700; letter-spacing: -.04em; }
    .cycle-when { color: #839089; font-size: 9px; font-weight: 600; letter-spacing: .08em; margin: 2px 0 8px; text-transform: uppercase; }
    .cycle-who  { color: #31594f; font-size: 12px; font-weight: 600; margin-bottom: 3px; }
    .cycle-what { color: #7b8882; font-size: 10px; }
    .cycle-arrow { color: #ced8d2; flex-shrink: 0; font-size: 18px; padding: 0 8px; }

    /* misc */
    .notice { background: #fffdf8; border-left: 4px solid #c55b45; color: #8e3f35; margin-bottom: 20px; padding: 15px; }
    .loading { color: #60726b; font-size: 12px; padding: 22px 0; }
    footer.site-footer { border-top: 1px solid #d8dfd9; color: #8a9690; font-size: 10px; letter-spacing: .1em; margin: 0 4rem; padding: 18px 0 24px; text-transform: uppercase; }

    /* responsive */
    @media (max-width: 900px) {
      .site-header { padding: 0 24px; }
      .tab-nav { padding: 0 18px; }
      .content { padding: 26px 24px 42px; }
      .metric-band { grid-template-columns: repeat(3,1fr); }
      .metric-band button:nth-child(4) { border-left: 0; }
      .two-columns { grid-template-columns: 1fr; }
      .kanban { grid-template-columns: 1fr 1fr; }
      footer.site-footer { margin: 0 24px; }
    }
    @media (max-width: 560px) {
      .site-header { align-items: flex-start; flex-direction: column; gap: 10px; padding: 14px 16px; }
      .header-actions { justify-content: space-between; width: 100%; }
      .brand p { font-size: 8px; }
      .tab-nav { padding: 0 9px; }
      .tab-nav button { font-size: 9px; padding: 10px 7px 8px; }
      .content { padding: 22px 16px 34px; }
      .metric-band, .state-band { grid-template-columns: 1fr; }
      .metric-band button, .state-band div { border-left: 0; border-top: 1px solid rgba(255,255,255,.14); }
      .metric-band button:first-child, .state-band div:first-child { border-top: 0; }
      .state-band div { border-top-color: #dde5df; }
      .panel { padding: 0 14px 14px; }
      .panel-heading span { display: none; }
      .kanban { grid-template-columns: 1fr; }
      .cycle-grid { flex-direction: column; }
      .cycle-arrow { transform: rotate(90deg); }
      .rr-item { grid-template-columns: 28px 1fr; }
      .rr-src, .rr-status-ready, .rr-status-missing, .rr-status-manual { display: none; }
      footer.site-footer { margin: 0 16px; }
    }
  `}</style>
}

/* ══════════════════════════════════════════════════════════
   ROOT
   ════════════════════════════════════════════════════════ */
export default function Dashboard() {
  const [tab,    setTab]    = useState('overview')
  const [filter, setFilter] = useState('all')
  const [person, setPerson] = useState('')
  const [data,   setData]   = useState({})
  const [error,  setError]  = useState('')
  const [loading,setLoading]= useState(true)
  const [synced, setSynced] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const keys = ['risks','controls','tracker','documents','ropa','tools']
    const results = await Promise.allSettled(keys.map(get))
    const next = Object.fromEntries(results.map((r, i) => [
      keys[i],
      r.status === 'fulfilled' ? r.value : { total: 0, items: [], byStatus: {}, byDomain: {}, byFlag: {} }
    ]))
    if (results.slice(0, 4).every(r => r.status === 'rejected')) setError('Could not load Notion data')
    setData(next); setSynced(new Date()); setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const personOptions = useMemo(() =>
    [...new Set(Object.values(data).flatMap(e => e?.items || []).flatMap(i => i.owner?.split(',').map(n => n.trim()) || []).filter(Boolean))].sort()
  , [data])

  const scoped = useMemo(() => {
    const only = ownerOf(person)
    const ri = (data.risks?.items     || []).filter(only)
    const ci = (data.controls?.items  || []).filter(only)
    const ti = (data.tracker?.items   || []).filter(only)
    const di = (data.documents?.items || []).filter(only)
    const pi = (data.ropa?.items      || []).filter(only)
    const oi = (data.tools?.items     || []).filter(only)
    const pending = ti.filter(i => i.dueDate && !['Done','Skipped'].includes(i.status)).sort((a,b) => a.dueDate.localeCompare(b.dueDate))
    return {
      risks: {
        ...data.risks, total: ri.length, items: ri,
        byProbability: count(ri, 'probability', ['High','Medium','Low']),
        byCategory:    count(ri, 'category',    ['Open','Addressed','Closed']),
        byDomain: Object.fromEntries(Object.entries(data.risks?.byDomain || {}).map(([d]) => [d, ri.filter(i => i.domain === d).length])),
      },
      controls: {
        ...data.controls, total: ci.length, items: ci,
        byStatus: count(ci, 'status', ['Active','Partial','Planned','Not In Place']),
      },
      tracker: {
        ...data.tracker, total: ti.length, items: ti,
        byStatus: count(ti, 'status', ['Done','In Progress','To Do','Overdue','Skipped']),
        upcoming: pending.slice(0, 5),
      },
      documents: {
        ...data.documents, total: di.length, items: di,
        byStatus: Object.fromEntries(Object.keys(data.documents?.byStatus || {}).map(s => [s, di.filter(i => i.status === s).length])),
      },
      ropa: {
        ...data.ropa, total: pi.length, items: pi,
        byFlag: pi.reduce((r, i) => i.flag ? { ...r, [i.flag]: (r[i.flag] || 0) + 1 } : r, {}),
      },
      tools: { ...data.tools, total: oi.length, items: oi },
    }
  }, [data, person])

  const tabs = [
    ['overview',     'Overview'],
    ['actions',      'My Actions'],
    ['risks',        'Risk Register'],
    ['controls',     'Controls'],
    ['monthly',      'Monthly Rhythm'],
    ['safeguarding', 'Safeguarding'],
    ['documents',    'Document Library'],
    ['ropa',         'RoPA'],
    ['tools',        'IT Tools'],
  ]

  const open = (nextTab, nextFilter = 'all') => { setTab(nextTab); setFilter(nextFilter) }

  const view =
    tab === 'overview'     ? <Overview {...scoped} onOpen={open} />
    : tab === 'actions'    ? <MyActions tracker={scoped.tracker} filter={filter} onFilter={setFilter} />
    : tab === 'risks'      ? <RiskRegister risks={scoped.risks} filter={filter} onFilter={setFilter} />
    : tab === 'controls'   ? <Controls controls={scoped.controls} filter={filter} onFilter={setFilter} />
    : tab === 'monthly'    ? <MonthlyRhythm tracker={scoped.tracker} risks={scoped.risks} controls={scoped.controls} />
    : tab === 'safeguarding'? <Safeguarding tracker={scoped.tracker} risks={scoped.risks} controls={scoped.controls} />
    : tab === 'documents'  ? <DocumentLibrary documents={scoped.documents} filter={filter} onFilter={setFilter} />
    : tab === 'ropa'       ? <RoPA ropa={scoped.ropa} filter={filter} onFilter={setFilter} />
    : <ITTools tools={scoped.tools} filter={filter} onFilter={setFilter} />

  return (
    <>
      <DashboardStyles />
      <main className="hub">
        <header className="site-header">
          <div className="brand">
            <h1>CONNECT<span>GO</span></h1>
            <p>Governance &amp; Compliance</p>
          </div>
          <div className="header-actions">
            {synced && <small>Last sync · {synced.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</small>}
            <select value={person} onChange={e => setPerson(e.target.value)} aria-label="Filter by person">
              <option value="">All people</option>
              {personOptions.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
        </header>

        <nav className="tab-nav" aria-label="Governance dashboard navigation">
          {tabs.map(([id, label]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => open(id)}>{label}</button>
          ))}
        </nav>

        <div className="content">
          <div className="eyebrow">{tabs.find(([id]) => id === tab)[1]} — ConnectGo Limited</div>
          {error   ? <div className="notice">Could not load Notion data: {error}</div>
           : loading? <div className="loading">Loading governance data from Notion…</div>
           : view}
        </div>

        <footer className="site-footer">ConnectGo Ltd · Confidential</footer>
      </main>
    </>
  )
}
