import { useCallback, useEffect, useMemo, useState } from 'react'

/* ── API helpers ─────────────────────────────────────────── */
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
  }).then(r => r.json())

/* ── Utilities ───────────────────────────────────────────── */
const formatDate = v =>
  v ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${v}T00:00:00`)) : '—'
const count = (items, prop, vals) =>
  vals.reduce((r, v) => ({ ...r, [v]: items.filter(i => i[prop] === v).length }), {})
const statusTone = v =>
  ['Done','Active','Approved','Closed','In Place','Enabled'].includes(v) ? 'good'
  : ['High','Overdue','Not In Place','Not in place','Pending'].includes(v) ? 'critical'
  : 'attention'
const displayName = name => {
  const cleaned = name.replace(/^dr\s+/i,'').trim()
  return /^sumaiya(?:\s|$)/i.test(cleaned) ? 'Sumaiya' : cleaned
}
const normaliseName = name => displayName(name).toLowerCase()
const dedupeNames = names => {
  const seen = new Map()
  for (const name of names) {
    const key = normaliseName(name)
    if (!seen.has(key)) seen.set(key, displayName(name))
  }
  return [...seen.values()].sort()
}

const RECURRING = ['Monthly','Quarterly','Annual','Annually']

/* ── Shared components ───────────────────────────────────── */
function Badge({ children }) {
  return <span className={`badge ${statusTone(children)}`}>{children || '—'}</span>
}
function NotionLink({ item, children }) {
  return <a className="notion-link" href={item.url} target="_blank" rel="noreferrer">{children}<span aria-hidden="true">↗</span></a>
}
function Panel({ title, source, children }) {
  return (
    <section className="panel">
      <header className="panel-heading"><h2>{title}</h2>{source && <span>{source}</span>}</header>
      {children}
    </section>
  )
}
function MetricBand({ metrics }) {
  return (
    <section className="metric-band" aria-label="Key indicators">
      {metrics.map(m => (
        <button type="button" key={m.label} onClick={m.onClick}>
          <span>{m.label}</span><strong className={m.tone || ''}>{m.value}</strong>
        </button>
      ))}
    </section>
  )
}
function FilterBar({ options, value, onChange }) {
  return (
    <div className="filter-bar">
      {options.map(([f, l]) => (
        <button key={f} type="button" className={value === f ? 'selected' : ''} onClick={() => onChange(f)}>{l}</button>
      ))}
    </div>
  )
}
function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="search-box-wrap">
      <input
        className="search-box"
        type="search"
        placeholder={placeholder || 'Search…'}
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label={placeholder || 'Search'}
      />
    </div>
  )
}
// Scrollable table wrapper — no pager, just a scrollable div capped at maxRows visible
function ScrollTable({ items, head, row: RowFn, maxRows = 12 }) {
  const rowH = 48 // px per row (matches .table-row min-height)
  const headH = 34
  const maxH = headH + rowH * maxRows
  const needsScroll = items.length > maxRows
  return (
    <div style={{ overflowX: 'auto' }}>
      <div
        style={{
          maxHeight: needsScroll ? `${maxH}px` : undefined,
          overflowY: needsScroll ? 'auto' : undefined,
        }}
        className="scroll-table-body"
      >
        <div className="data-table" style={{ minWidth: 810 }}>
          <div className="table-head">{head}</div>
          {items.length ? items.map(RowFn) : <div className="table-row" style={{ gridColumn: '1/-1', color: '#8a9690', fontSize: 11 }}>No matching records</div>}
        </div>
      </div>
    </div>
  )
}

/* ── Checkable task row ──────────────────────────────────── */
function CheckRow({ item, onDone }) {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(item.status === 'Done')
  const toggle = async () => {
    if (done || loading) return
    setLoading(true)
    try { await patch(item.id, 'Done'); setDone(true); onDone && onDone(item.id) } catch { }
    setLoading(false)
  }
  return (
    <div className={`action-row${done ? ' action-done' : ''}`}>
      <button type="button" className={`action-check${done ? ' checked' : ''}${loading ? ' loading' : ''}`} onClick={toggle} aria-label={done ? 'Done' : 'Mark as done'}>
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

/* ── TaskRows (simple read-only list) ────────────────────── */
function TaskRows({ items }) {
  return (
    <div className="rows">
      {items.length
        ? items.map(i => (
            <div className="row" key={i.id}>
              <div>
                <NotionLink item={i}>{i.activityId ? `${i.activityId} · ` : ''}{i.name}</NotionLink>
                <p>{i.owner || '—'} · {formatDate(i.dueDate)}</p>
              </div>
              <Badge>{i.status}</Badge>
            </div>
          ))
        : <p className="empty">No matching records</p>}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════
   OVERVIEW
   ════════════════════════════════════════════════════════ */
// Collapsible domain list used on Overview
function DomainRiskList({ risks }) {
  const [openDomain, setOpenDomain] = useState(null)
  const domains = Object.entries(risks.byDomain || {}).filter(([, v]) => v)
  return (
    <div className="domain-list">
      {domains.map(([label, value]) => {
        const isOpen = openDomain === label
        const domainRisks = risks.items.filter(i => i.domain === label)
        return (
          <div key={label} className="domain-item">
            <button type="button" className="domain-row" onClick={() => setOpenDomain(isOpen ? null : label)}>
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

const WORKFLOWS = [
  { id:'wf1',  num:'WF 1',  name:'New processing activity',         cadence:'Event-based', group:'event', trigger:'New data processing activity identified',       owner:'Belinda',            steps:'DPIA screening → RoPA entry → LIA if needed → DPA check' },
  { id:'wf2',  num:'WF 2',  name:'Data breach',                     cadence:'Event-based', group:'event', trigger:'Suspected or confirmed data breach',             owner:'Belinda + Kate',     steps:'Severity score → 72hr ICO clock → CFC notify → data subjects' },
  { id:'wf3',  num:'WF 3',  name:'Monthly risk review',             cadence:'Monthly',     group:'sched', trigger:'5th of each month',                             owner:'Belinda → Kate',     steps:'Risk Register sweep → Controls check → Monthly Risk Summary → Kate review by 10th' },
  { id:'wf4',  num:'WF 4',  name:'Staff changes',                   cadence:'Event-based', group:'event', trigger:'New starter or leaver',                         owner:'Belinda',            steps:'Access provisioning → DBS check → NDA → training → offboarding checklist' },
  { id:'wf5',  num:'WF 5',  name:'Annual compliance cycle',         cadence:'Annual',      group:'sched', trigger:'January each year',                             owner:'Belinda',            steps:'Full RoPA review → policy review → DPIA review → ICO horizon scan → SAT' },
  { id:'wf6',  num:'WF 6',  name:'Client dependency monitoring',    cadence:'Monthly',     group:'sched', trigger:'1st of each month',                             owner:'Kate',               steps:'Update Revenue Concentration Tracker → quarterly review if threshold met' },
  { id:'wf7',  num:'WF 7',  name:'Contract renewal & off-boarding', cadence:'Event-based', group:'event', trigger:'Contract end or 90-day flag',                   owner:'Kate + Belinda',     steps:'Data export → deletion confirmation → DPA closure → Kontainer export' },
  { id:'wf8',  num:'WF 8',  name:'Reputational risk monitoring',    cadence:'Event-based', group:'event', trigger:'Press mention, complaint or incident',          owner:'Kate + Hannah',      steps:'Log in register → triage → response plan → ICO if applicable' },
  { id:'wf9',  num:'WF 9',  name:'Due diligence readiness',         cadence:'Live now',    group:'live',  trigger:'Active — investment raise ongoing',             owner:'Kate + Belinda',     steps:'Pre-meeting checklist → Data Room audit → compliance narrative → investor update' },
  { id:'wf10', num:'WF 10', name:'Research safeguarding',           cadence:'Event-based', group:'event', trigger:'New research project with participants',         owner:'Sumaiya + Belinda',  steps:'Risk assessment → consent via Kontainer → DBS checks → field safety briefing' },
  { id:'wf11', num:'WF 11', name:'Staff & partner concerns',        cadence:'Event-based', group:'event', trigger:'Concern raised by staff or partner',            owner:'Sumaiya',            steps:'Triage → log in Safeguarding Register → escalate if needed → wellbeing support' },
  { id:'wf12', num:'WF 12', name:'Safeguarding governance',         cadence:'Quarterly',   group:'sched', trigger:'End of each quarter',                           owner:'Sumaiya',            steps:'Quarterly review → DBS renewal check → training refresh → annual audit Dec' },
]

const WF_GROUPS = [
  { key:'live',  label:'Active now' },
  { key:'sched', label:'Scheduled — runs on a fixed cycle' },
  { key:'event', label:'Event-based — triggered when something happens' },
]

function WorkflowsAccordion() {
  const [open, setOpen] = useState(null)
  return (
    <Panel title="Workflows" source="">
      <div className="wf-two-col">
        {WF_GROUPS.map(g => (
          <div key={g.key} className="wf-group-col">
            <div className="wf-group-label">{g.label}</div>
            {WORKFLOWS.filter(w => w.group === g.key).map(wf => {
              const isOpen = open === wf.id
              return (
                <div key={wf.id} className="wf-item">
                  <button type="button" className="wf-row" onClick={() => setOpen(isOpen ? null : wf.id)}>
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
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </Panel>
  )
}

function Overview({ risks, controls, tracker, onOpen }) {
  const active    = controls.byStatus.Active || 0
  const available = tracker.total - (tracker.byStatus.Skipped || 0)
  const metrics = [
    { label:'Total risks',      value:risks.total,                                                            onClick:() => onOpen('risks','all') },
    { label:'High probability', value:risks.byProbability.High||0,      tone:'critical',                      onClick:() => onOpen('risks','high') },
    { label:'Open risks',       value:risks.byCategory.Open||0,         tone:'attention',                     onClick:() => onOpen('risks','open') },
    { label:'Controls active',  value:`${controls.total ? Math.round(active/controls.total*100) : 0}%`,      onClick:() => onOpen('controls','all') },
    { label:'Activities done',  value:`${available ? Math.round((tracker.byStatus.Done||0)/available*100) : 0}%`, tone:'good', onClick:() => onOpen('actions','Done') },
    { label:'Overdue',          value:tracker.byStatus.Overdue||0,      tone:'critical',                      onClick:() => onOpen('actions','Overdue') },
  ]
  const recurring = tracker.items
    .filter(i => i.frequency && RECURRING.includes(i.frequency) && !['Done','Skipped'].includes(i.status))
    .sort((a,b) => (a.dueDate||'9999').localeCompare(b.dueDate||'9999'))
    .slice(0,8)
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

/* ══════════════════════════════════════════════════════════
   MY ACTIONS
   ════════════════════════════════════════════════════════ */
function MyActions({ tracker, filter, onFilter }) {
  const [view, setView] = useState('list')
  const [localDone, setLocalDone] = useState(new Set())
  const handleDone = id => setLocalDone(prev => new Set([...prev, id]))

  const allItems = tracker.items.sort((a,b) => (a.dueDate||'9999').localeCompare(b.dueDate||'9999'))

  // Hide done tasks from list/calendar; show completed count card instead
  const activeSrc = allItems.filter(i => !['Done','Skipped'].includes(i.status) && !localDone.has(i.id))
  const doneCount = allItems.filter(i => i.status === 'Done' || localDone.has(i.id)).length

  const items = activeSrc.filter(i => filter === 'all' || i.status === filter)
  const urgent  = items.filter(i => i.priority === 'High' && i.status === 'To Do' && i.dueDate && new Date(i.dueDate) <= new Date(Date.now() + 4*86400000))
  const overdue = items.filter(i => i.status === 'Overdue')
  const inprog  = items.filter(i => i.status === 'In Progress')
  const todo    = items.filter(i => i.status === 'To Do' && !urgent.includes(i))

  return (
    <>
      <div className="actions-header">
        <div className="view-toggle">
          {[['list','List'],['cal','Calendar']].map(([v,l]) => (
            <button key={v} type="button" className={view===v?'selected':''} onClick={() => setView(v)}>{l}</button>
          ))}
        </div>
        <FilterBar value={filter} onChange={onFilter} options={[['all','All'],['To Do','To Do'],['In Progress','In Progress'],['Overdue','Overdue']]} />
      </div>

      {/* Completed tasks summary card */}
      <div className="done-card">
        <strong>{doneCount}</strong>
        <span>tasks completed to date</span>
        <a href="https://www.notion.so" target="_blank" rel="noreferrer" className="done-link">View in Notion ↗</a>
      </div>

      {view === 'list' && (
        <div className="actions-list">
          {urgent.length > 0 && <div className="action-group"><div className="action-group-title critical">Urgent — due within 4 days <span className="count-badge">{urgent.length}</span></div>{urgent.map(i => <CheckRow key={i.id} item={i} onDone={handleDone} />)}</div>}
          {overdue.length > 0 && <div className="action-group"><div className="action-group-title attention">Overdue <span className="count-badge">{overdue.length}</span></div>{overdue.map(i => <CheckRow key={i.id} item={i} onDone={handleDone} />)}</div>}
          {inprog.length > 0  && <div className="action-group"><div className="action-group-title">In progress <span className="count-badge">{inprog.length}</span></div>{inprog.map(i => <CheckRow key={i.id} item={i} onDone={handleDone} />)}</div>}
          {todo.length > 0    && <div className="action-group"><div className="action-group-title">To do <span className="count-badge">{todo.length}</span></div>{todo.map(i => <CheckRow key={i.id} item={i} onDone={handleDone} />)}</div>}
          {items.length === 0 && <p className="empty">No open actions{filter !== 'all' ? ' matching this filter' : ''}</p>}
        </div>
      )}

      {view === 'cal' && <CalendarView tracker={{ ...tracker, items: activeSrc }} />}
    </>
  )
}

/* ── Calendar ────────────────────────────────────────────── */
function CalendarView({ tracker }) {
  const [offset, setOffset] = useState(0)
  const now  = new Date()
  const base = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const year = base.getFullYear()
  const month = base.getMonth()
  const monthLabel = base.toLocaleString('en-GB', { month: 'long', year: 'numeric' })
  const startOffset = (() => { const d = base.getDay(); return d === 0 ? 6 : d - 1 })()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const byDate = {}
  tracker.items.forEach(i => {
    if (!i.dueDate) return
    const d = i.dueDate.slice(0,10)
    if (!byDate[d]) byDate[d] = []
    byDate[d].push(i)
  })
  const cells = [...Array(startOffset).fill(null), ...Array.from({length:daysInMonth},(_,k)=>k+1)]
  return (
    <div className="cal-wrap">
      <div className="cal-hdr">
        <button type="button" className="cal-nav" onClick={() => setOffset(o=>o-1)}>‹ Prev</button>
        <strong>{monthLabel}</strong>
        <button type="button" className="cal-nav" onClick={() => setOffset(o=>o+1)}>Next ›</button>
      </div>
      <div className="cal-legend">
        {[['ce-r','Overdue'],['ce-a','To Do'],['ce-g','Done'],['ce-b','Recurring']].map(([cls,lbl])=>(
          <span key={cls} className="cal-leg-item"><span className={`cal-leg-dot ${cls}`}/>{lbl}</span>
        ))}
      </div>
      <div className="cal-grid">
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=><div key={d} className="cal-dh">{d}</div>)}
        {cells.map((d,idx) => {
          if (!d) return <div key={`b${idx}`} className="cal-day blank"/>
          const key=`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
          const tasks=byDate[key]||[]
          const isToday=now.getDate()===d&&now.getMonth()===month&&now.getFullYear()===year
          const hasUrgent=tasks.some(t=>t.status==='Overdue'||t.priority==='High')
          return (
            <div key={d} className={`cal-day${isToday?' today':''}${hasUrgent?' has-urgent':''}`}>
              <div className="cal-dn">{d}</div>
              {tasks.slice(0,2).map(t=>(
                <a key={t.id} href={t.url} target="_blank" rel="noreferrer"
                   className={`cal-ev ${t.status==='Overdue'?'ce-r':t.status==='Done'?'ce-g':t.frequency?'ce-b':'ce-a'}`}
                   title={t.name}>{t.name}</a>
              ))}
              {tasks.length>2&&<div className="cal-more">+{tasks.length-2} more</div>}
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
  const [search, setSearch] = useState('')
  const rows = risks.items.filter(i => {
    const mDomain = !domainFilter || i.domain === domainFilter
    const mFilter = filter==='all'||(filter==='high'&&i.probability==='High')||(filter==='open'&&i.category==='Open')
    const mSearch = !search || i.name?.toLowerCase().includes(search.toLowerCase()) || i.domain?.toLowerCase().includes(search.toLowerCase()) || i.owner?.toLowerCase().includes(search.toLowerCase())
    return mDomain && mFilter && mSearch
  })
  return (
    <>
      <div className="search-filter-row">
        <SearchBox value={search} onChange={setSearch} placeholder="Search risks…" />
        <FilterBar value={filter} onChange={f=>{onFilter(f);setDomainFilter(null)}} options={[['all','All risks'],['high','High probability'],['open','Open risks']]} />
      </div>
      <Panel title="Risk Register — By Domain" source="Unified Risk Register">
        <div className="bars">
          {Object.entries(risks.byDomain||{}).filter(([,v])=>v).map(([label,value])=>(
            <button type="button" key={label} onClick={()=>setDomainFilter(domainFilter===label?null:label)} className={domainFilter===label?'bar-active':''}>
              <span>{label}</span>
              <i><em style={{width:`${risks.total?value/risks.total*100:0}%`}}/></i>
              <b>{value}</b>
            </button>
          ))}
        </div>
        {domainFilter && <div className="domain-active-label">Showing {domainFilter}<button type="button" className="domain-clear" onClick={()=>setDomainFilter(null)}>✕ Clear</button></div>}
      </Panel>
      <Panel title="Risk Register — Records" source={`Unified Risk Register${rows.length!==risks.total?` · ${rows.length} shown`:''}`}>
        <ScrollTable
          items={rows}
          head={<><span>Risk</span><span>Domain</span><span>Probability</span><span>Impact</span><span>Control status</span><span>Risk category</span><span>Risk owner</span></>}
          row={item => (
            <div className="table-row risk-table-row" key={item.id}>
              <NotionLink item={item}>{item.riskId?`${item.riskId} · `:''}{item.name}</NotionLink>
              <span>{item.domain||'—'}</span>
              <Badge>{item.probability}</Badge>
              <span>{item.consequences||'—'}</span>
              <Badge>{item.controlStatus}</Badge>
              <Badge>{item.category}</Badge>
              <span>{item.owner||'—'}</span>
            </div>
          )}
        />
      </Panel>
    </>
  )
}

/* ══════════════════════════════════════════════════════════
   CONTROLS
   ════════════════════════════════════════════════════════ */
function Controls({ controls, filter, onFilter }) {
  const [search, setSearch] = useState('')
  const rows = controls.items.filter(i => {
    const mFilter = filter==='all'||i.status===filter
    const mSearch = !search || i.name?.toLowerCase().includes(search.toLowerCase()) || i.domain?.toLowerCase().includes(search.toLowerCase())
    return mFilter && mSearch
  })
  const c = controls.byStatus
  return (
    <>
      <section className="state-band">
        <div><strong>{c.Active||0}</strong><span>Active</span></div>
        <div><strong>{c.Partial||0}</strong><span>Partial</span></div>
        <div><strong>{c['Not In Place']||0}</strong><span>Not in place</span></div>
        <div><strong>{controls.total?`${Math.round((c.Active||0)/controls.total*100)}%`:'0%'}</strong><span>Controls active</span></div>
      </section>
      <div className="search-filter-row">
        <SearchBox value={search} onChange={setSearch} placeholder="Search controls…" />
        <FilterBar value={filter} onChange={onFilter} options={[['all','All controls'],['Active','Active'],['Partial','Partial'],['Not In Place','Not in place']]} />
      </div>
      <Panel title="Controls Register" source="Controls Register">
        <ScrollTable
          items={rows}
          head={<><span>Control</span><span>Domain</span><span>Control type</span><span>Status</span><span>Owner</span><span>Review date</span><span>Review frequency</span></>}
          row={item => (
            <div className="table-row controls-table-row" key={item.id}>
              <NotionLink item={item}>{item.controlId?`${item.controlId} · `:''}{item.name}</NotionLink>
              <span>{item.domain||'—'}</span>
              <span>{item.type||'—'}</span>
              <Badge>{item.status}</Badge>
              <span>{item.owner||'—'}</span>
              <time>{formatDate(item.reviewDate)}</time>
              <span>{item.reviewFrequency||'—'}</span>
            </div>
          )}
        />
      </Panel>
    </>
  )
}

/* ══════════════════════════════════════════════════════════
   SAFEGUARDING
   ════════════════════════════════════════════════════════ */
function Safeguarding({ tracker, risks, controls }) {
  const taskRows    = tracker.items.filter(i => i.domain==='Safeguarding')
  const riskRows    = risks.items.filter(i => i.domain==='Safeguarding')
  const controlRows = controls.items.filter(i => i.domain==='Safeguarding')
  const openTasks   = taskRows.filter(i => !['Done','Skipped'].includes(i.status))
  return (
    <>
      <section className="state-band">
        <div><strong>{openTasks.length}</strong><span>Open activities</span></div>
        <div><strong>{taskRows.filter(i=>i.status==='Overdue').length}</strong><span>Overdue</span></div>
        <div><strong>{riskRows.length}</strong><span>Risks</span></div>
        <div><strong>{controlRows.filter(i=>i.status==='Active').length}</strong><span>Controls active</span></div>
      </section>
      <div className="two-columns">
        <Panel title="Governance Tracker" source="Governance Tracker"><TaskRows items={taskRows} /></Panel>
        <Panel title="Risk Register" source="Unified Risk Register"><TaskRows items={riskRows.map(i=>({...i,activityId:i.riskId,dueDate:i.reviewDate,status:i.controlStatus}))} /></Panel>
      </div>
      <Panel title="Controls Register" source="Controls Register"><TaskRows items={controlRows.map(i=>({...i,activityId:i.controlId,dueDate:i.reviewDate,status:i.status}))} /></Panel>
    </>
  )
}

/* ══════════════════════════════════════════════════════════
   DOCUMENT LIBRARY
   ════════════════════════════════════════════════════════ */
function DocumentLibrary({ documents, filter, onFilter }) {
  const [search, setSearch] = useState('')
  const rows = documents.items.filter(i => {
    const mFilter = filter==='all'||i.status===filter
    const mSearch = !search || i.name?.toLowerCase().includes(search.toLowerCase()) || i.domain?.toLowerCase().includes(search.toLowerCase()) || (i.docId && String(i.docId).includes(search))
    return mFilter && mSearch
  })
  return (
    <>
      <MetricBand metrics={[
        { label:'Approved',       value:documents.byStatus.Approved||0,          tone:'good',      onClick:()=>onFilter('Approved') },
        { label:'In review',      value:documents.byStatus['In review']||0,                        onClick:()=>onFilter('In review') },
        { label:'To be reviewed', value:documents.byStatus['To be reviewed']||0, tone:'attention', onClick:()=>onFilter('To be reviewed') },
        { label:'Documents',      value:documents.total,                                            onClick:()=>onFilter('all') },
      ]} />
      <div className="search-filter-row">
        <SearchBox value={search} onChange={setSearch} placeholder="Search documents…" />
        <FilterBar value={filter} onChange={onFilter} options={[['all','All documents'],['Approved','Approved'],['In review','In review'],['To be reviewed','To be reviewed']]} />
      </div>
      <Panel title="Document Library" source="Document Library">
        <ScrollTable
          items={rows}
          head={<><span>Document</span><span>Domain</span><span>Type</span><span>Owner</span><span>Status</span><span>Next review</span><span>Next approval</span></>}
          row={item => (
            <div className="table-row document-table-row" key={item.id}>
              <NotionLink item={item}>{item.docId?`${item.docId} · `:''}{item.name}</NotionLink>
              <span>{item.domain||'—'}</span>
              <span>{item.type||'—'}</span>
              <span>{item.owner||'—'}</span>
              <Badge>{item.status}</Badge>
              <time>{formatDate(item.nextReviewDate)}</time>
              <time>{formatDate(item.nextApprovalDate)}</time>
            </div>
          )}
        />
      </Panel>
    </>
  )
}

/* ══════════════════════════════════════════════════════════
   RoPA
   ════════════════════════════════════════════════════════ */
function RoPA({ ropa, filter, onFilter }) {
  const rows = ropa.items.filter(i => filter==='all'||i.flag===filter)
  const flags = [...new Set(ropa.items.map(i=>i.flag).filter(Boolean))]
  return (
    <>
      <MetricBand metrics={[
        { label:'Processing activities', value:ropa.total,                     onClick:()=>onFilter('all') },
        { label:'Reviewed',              value:ropa.byFlag.Reviewed||0,        tone:'good',      onClick:()=>onFilter('Reviewed') },
        { label:'LIA needed',            value:ropa.byFlag['LIA needed']||0,   tone:'attention', onClick:()=>onFilter('LIA needed') },
        { label:'Review due',            value:ropa.byFlag['Review due']||0,                     onClick:()=>onFilter('Review due') },
      ]} />
      <FilterBar value={filter} onChange={onFilter} options={[['all','All processing'],...flags.map(f=>[f,f])]} />
      <Panel title="Register of Processing Activities" source="RoPA">
        <ScrollTable
          items={rows}
          head={<><span>Processing activity</span><span>Data subjects</span><span>Personal data</span><span>Purpose</span><span>Lawful basis</span><span>Systems</span><span>Retention</span><span>Flag</span></>}
          row={item => (
            <div className="table-row ropa-table-row" key={item.id}>
              <NotionLink item={item}>{item.name}</NotionLink>
              <span>{item.subjects||'—'}</span>
              <span>{item.personalData||'—'}</span>
              <span>{item.purpose||'—'}</span>
              <span>{item.basis||'—'}</span>
              <span>{item.systems||'—'}</span>
              <span>{item.retention||'—'}</span>
              <Badge>{item.flag}</Badge>
            </div>
          )}
        />
      </Panel>
    </>
  )
}

/* ══════════════════════════════════════════════════════════
   IT TOOLS
   ════════════════════════════════════════════════════════ */
function ITTools({ tools, filter, onFilter }) {
  const [retiredOpen, setRetiredOpen] = useState(false)
  // Active = anything not retired
  const RETIRED_VALS = ['Retired','Decommissioned','Legacy','Inactive']
  const isRetired = i => RETIRED_VALS.some(v => i.criticality===v || i.name?.toLowerCase().includes('retired') || i.category?.toLowerCase().includes('retired'))
  const active  = tools.items.filter(i => !isRetired(i))
  const retired = tools.items.filter(i => isRetired(i))
  const rows = active.filter(i =>
    filter==='all'||
    (filter==='critical'&&i.criticality==='Critical')||
    (filter==='dpa'&&i.dpa==='Pending')||
    (filter==='mfa'&&i.mfa!=='Enabled')
  )
  const critical   = active.filter(i=>i.criticality==='Critical').length
  const dpaPending = active.filter(i=>i.dpa==='Pending').length
  const mfaEnabled = active.filter(i=>i.mfa==='Enabled').length
  const ToolRow = item => (
    <div className="table-row tools-table-row" key={item.id}>
      <NotionLink item={item}>{item.name}</NotionLink>
      <span>{item.category||'—'}</span>
      <span>{item.owner||'—'}</span>
      <Badge>{item.criticality}</Badge>
      <Badge>{item.dpa}</Badge>
      <Badge>{item.mfa}</Badge>
      <time>{formatDate(item.reviewDate)}</time>
    </div>
  )
  return (
    <>
      <MetricBand metrics={[
        { label:'Active tools',         value:active.length, onClick:()=>onFilter('all') },
        { label:'Critical suppliers',   value:critical,      tone:'critical', onClick:()=>onFilter('critical') },
        { label:'DPA pending',          value:dpaPending,    tone:'critical', onClick:()=>onFilter('dpa') },
        { label:'MFA enabled',          value:mfaEnabled,    tone:'good',     onClick:()=>onFilter('mfa') },
      ]} />
      <FilterBar value={filter} onChange={onFilter} options={[['all','All tools'],['critical','Critical'],['dpa','DPA pending'],['mfa','MFA not enabled']]} />
      <Panel title="Access Matrix — Active Tools" source="Access Matrix">
        <ScrollTable
          items={rows}
          head={<><span>Tool / supplier</span><span>Category</span><span>Owner</span><span>Criticality</span><span>DPA</span><span>MFA</span><span>Next review</span></>}
          row={ToolRow}
        />
        {retired.length > 0 && (
          <div className="retired-section">
            <button type="button" className="retired-toggle" onClick={()=>setRetiredOpen(o=>!o)}>
              <span>Retired / decommissioned tools ({retired.length})</span>
              <span className={`wf-chev${retiredOpen?' open':''}`}>⌄</span>
            </button>
            {retiredOpen && (
              <div style={{marginTop:8}}>
                <ScrollTable items={retired} head={<><span>Tool / supplier</span><span>Category</span><span>Owner</span><span>Criticality</span><span>DPA</span><span>MFA</span><span>Next review</span></>} row={ToolRow} />
              </div>
            )}
          </div>
        )}
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
    button, select, input { font: inherit; }
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

    /* metric band */
    .metric-band { background: #17332d; display: grid; grid-template-columns: repeat(6,minmax(0,1fr)); margin-bottom: 20px; }
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
    .panel-heading { align-items: center; border-bottom: 1px solid #e0e6e1; display: flex; justify-content: space-between; margin-bottom: 8px; padding: 15px 0 12px; }
    .panel-heading h2 { font-size: 12px; letter-spacing: .08em; margin: 0; text-transform: uppercase; }
    .panel-heading span { border-bottom: 1px solid #bfd0c7; color: #547168; font-size: 9px; font-weight: 600; letter-spacing: .08em; padding-bottom: 2px; text-transform: uppercase; }

    /* bars */
    .bars > div, .bars > button { align-items: center; background: transparent; border: 0; border-bottom: 1px solid #e4e9e5; color: #19332d; display: grid; gap: 12px; grid-template-columns: minmax(100px,1fr) minmax(100px,2fr) 28px; padding: 12px 0; text-align: left; width: 100%; }
    .bars > div:last-child, .bars > button:last-child { border-bottom: 0; }
    .bars > button:hover { background: #f4f7f4; padding-left: 7px; }
    .bars > button.bar-active { background: #eef4ee; }
    .bars span { font-size: 12px; font-weight: 600; }
    .bars i { background: #e4eae6; height: 5px; }
    .bars em { background: #31594f; display: block; height: 100%; }
    .bars b { font-size: 12px; text-align: right; }
    .domain-active-label { align-items: center; border-top: 1px solid #e4e9e6; color: #486058; display: flex; font-size: 10px; font-weight: 600; gap: 10px; justify-content: space-between; letter-spacing: .05em; padding: 8px 4px; text-transform: uppercase; }
    .domain-clear { background: transparent; border: 1px solid #ced8d2; color: #60726b; font-size: 10px; padding: 3px 8px; }
    .domain-clear:hover { background: #31594f; border-color: #31594f; color: #fff; }

    /* domain collapsible list */
    .domain-item { border-bottom: 1px solid #e4e9e6; }
    .domain-item:last-child { border-bottom: 0; }
    .domain-row { align-items: center; background: transparent; border: 0; cursor: pointer; display: grid; gap: 12px; grid-template-columns: minmax(100px,1fr) minmax(100px,2fr) 28px 18px; padding: 12px 4px; text-align: left; width: 100%; }
    .domain-row:hover { background: #f4f8f4; }
    .domain-name { font-size: 12px; font-weight: 600; }
    .domain-bar-track { background: #e4eae6; height: 5px; }
    .domain-bar-track em { background: #31594f; display: block; height: 100%; }
    .domain-count { font-size: 12px; text-align: right; }
    .domain-risks { background: #f7faf7; border-top: 1px solid #e4e9e6; padding: 8px 12px 8px 20px; }
    .domain-risk-row { align-items: center; border-bottom: 1px dashed #e4e9e6; display: flex; gap: 10px; justify-content: space-between; padding: 8px 0; }
    .domain-risk-row:last-child { border-bottom: 0; }
    .domain-risk-meta { align-items: center; display: flex; flex-shrink: 0; gap: 6px; }
    .domain-risk-meta span { color: #839089; font-size: 10px; }

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

    /* filter + search */
    .search-filter-row { align-items: flex-start; display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
    .search-box-wrap { flex-shrink: 0; }
    .search-box { background: #fffdf8; border: 1px solid #ced8d2; color: #19332d; font-size: 11px; padding: 6px 10px; width: 220px; outline: none; }
    .search-box:focus { border-color: #31594f; }
    .filter-bar { border-bottom: 1px solid #d7dfd9; display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 18px; padding-bottom: 13px; }
    .filter-bar button { background: transparent; border: 1px solid #ced8d2; color: #60726b; font-size: 10px; font-weight: 600; padding: 6px 10px; }
    .filter-bar button.selected, .filter-bar button:hover { background: #31594f; border-color: #31594f; color: #fff; }

    /* state band */
    .state-band { background: #fffdf8; border-top: 3px solid #31594f; display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); margin-bottom: 20px; padding: 3px 0; }
    .state-band div { border-left: 1px solid #dde5df; padding: 14px 20px; }
    .state-band div:first-child { border-left: 0; }
    .state-band strong { color: #1d3e35; display: block; font-size: 25px; letter-spacing: -.06em; }
    .state-band span { color: #7c8983; display: block; font-size: 10px; margin-top: 5px; }

    /* scroll table */
    .scroll-table-body { border: 1px solid #e4e9e6; }
    .scroll-table-body::-webkit-scrollbar { width: 5px; }
    .scroll-table-body::-webkit-scrollbar-track { background: #f0f4f0; }
    .scroll-table-body::-webkit-scrollbar-thumb { background: #b0c0b8; border-radius: 3px; }
    .data-table { min-width: 810px; }
    .table-head, .table-row { display: grid; gap: 10px; padding: 9px 8px; }
    .table-head { background: #f0f4f0; color: #587168; font-size: 9px; font-weight: 600; letter-spacing: .08em; position: sticky; top: 0; text-transform: uppercase; z-index: 1; }
    .table-row { align-items: center; border-bottom: 1px solid #e4e9e6; color: #5e7068; font-size: 11px; min-height: 48px; }
    .table-row:hover { background: #f4f8f4; }
    .risk-table-row     { grid-template-columns: minmax(220px,2.4fr) 1fr .8fr .8fr 1fr 1fr 1fr; }
    .controls-table-row { grid-template-columns: minmax(220px,2fr) 1fr 1fr .9fr 1fr .9fr 1fr; }
    .document-table-row { grid-template-columns: minmax(220px,2fr) 1fr .8fr 1fr .9fr .9fr .9fr; }
    .ropa-table-row     { grid-template-columns: minmax(210px,1.8fr) 1fr 1.1fr 1.2fr .9fr 1fr .8fr .8fr; min-width: 1060px; }
    .tools-table-row    { grid-template-columns: minmax(220px,1.8fr) 1fr 1fr .9fr .9fr .9fr .9fr; }

    /* MY ACTIONS */
    .actions-header { align-items: center; display: flex; gap: 12px; margin-bottom: 12px; justify-content: space-between; flex-wrap: wrap; }
    .view-toggle { display: flex; gap: 0; border: 1px solid #ced8d2; overflow: hidden; }
    .view-toggle button { background: transparent; border: 0; border-right: 1px solid #ced8d2; color: #60726b; font-size: 10px; font-weight: 600; padding: 6px 11px; }
    .view-toggle button:last-child { border-right: 0; }
    .view-toggle button.selected { background: #31594f; color: #fff; }
    .done-card { align-items: center; background: #e7f2eb; border-left: 4px solid #3e7e56; display: flex; gap: 12px; margin-bottom: 14px; padding: 10px 14px; }
    .done-card strong { color: #1d3e35; font-size: 22px; letter-spacing: -.04em; }
    .done-card span { color: #3e7e56; font-size: 11px; font-weight: 600; flex: 1; }
    .done-link { color: #a56624; font-size: 10px; font-weight: 600; text-decoration: none; }
    .done-link:hover { text-decoration: underline; }
    .action-group { margin-bottom: 16px; }
    .action-group-title { align-items: center; border-bottom: 1px solid #d7dfd9; color: #486058; display: flex; font-size: 10px; font-weight: 600; gap: 8px; letter-spacing: .09em; margin-bottom: 4px; padding-bottom: 8px; text-transform: uppercase; }
    .action-group-title.critical { color: #ac483d; }
    .action-group-title.attention { color: #a36c24; }
    .action-group-title.good { color: #3e7e56; }
    .count-badge { background: #e4eae6; border-radius: 10px; color: #486058; font-size: 9px; padding: 2px 7px; }
    .action-row { align-items: flex-start; border-bottom: 1px solid #e5ebe6; display: flex; gap: 10px; padding: 10px 6px; }
    .action-row:hover { background: #f4f8f4; }
    .action-row.action-done { opacity: .5; }
    .action-check { align-items: center; background: #fff; border: 1.5px solid #ced8d2; border-radius: 3px; color: #3e7e56; cursor: pointer; display: flex; flex-shrink: 0; font-size: 11px; font-weight: 700; height: 16px; justify-content: center; margin-top: 2px; width: 16px; }
    .action-check.checked { background: #31594f; border-color: #31594f; color: #fff; }
    .action-check.loading { background: #f0f4f0; color: #839089; }
    .action-info { flex: 1; min-width: 0; }
    .action-info p { color: #7b8882; font-size: 10px; margin: 4px 0 0; }

    /* calendar */
    .cal-wrap { }
    .cal-hdr { align-items: center; display: flex; gap: 12px; justify-content: space-between; margin-bottom: 8px; padding-bottom: 10px; border-bottom: 1px solid #d7dfd9; }
    .cal-hdr strong { font-size: 13px; }
    .cal-nav { background: #fff; border: 1px solid #d1dad4; color: #31594f; font-size: 11px; font-weight: 600; padding: 5px 12px; }
    .cal-legend { display: flex; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
    .cal-leg-item { align-items: center; display: flex; font-size: 10px; color: #7b8882; gap: 5px; }
    .cal-leg-dot { border-radius: 2px; height: 10px; width: 14px; display: inline-block; }
    .cal-grid { display: grid; gap: 2px; grid-template-columns: repeat(7,1fr); }
    .cal-dh { color: #839089; font-size: 9px; font-weight: 600; letter-spacing: .08em; padding: 5px 4px; text-align: center; text-transform: uppercase; }
    .cal-day { background: #fffdf8; border: 1px solid #e4e9e6; min-height: 72px; overflow: hidden; padding: 5px 5px 3px; }
    .cal-day.blank { background: transparent; border-color: transparent; }
    .cal-day.today { border-color: #31594f; border-width: 2px; }
    .cal-day.has-urgent { background: #fdf4f2; border-color: #dab0aa; }
    .cal-dn { color: #486058; font-size: 11px; font-weight: 600; margin-bottom: 3px; }
    .cal-day.today .cal-dn { color: #31594f; }
    .cal-ev { border-radius: 0; display: block; font-size: 9px; font-weight: 600; margin-bottom: 2px; overflow: hidden; padding: 2px 5px; text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
    .ce-r { background: #fae9e5; color: #ac483d; }
    .ce-a { background: #fbf0db; color: #a36c24; }
    .ce-g { background: #e7f2eb; color: #3e7e56; }
    .ce-b { background: #e3edf5; color: #3a6480; }
    .cal-more { color: #839089; font-size: 9px; padding: 1px 4px; }

    /* workflows two-col */
    .wf-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 0 28px; }
    .wf-group-col { }
    .wf-group-label { color: #839089; font-size: 9px; font-weight: 600; letter-spacing: .09em; margin: 14px 0 6px; text-transform: uppercase; }
    .wf-item { border-bottom: 1px solid #e4e9e6; }
    .wf-item:last-child { border-bottom: 0; }
    .wf-row { align-items: center; background: transparent; border: 0; display: flex; gap: 10px; padding: 9px 4px; text-align: left; width: 100%; }
    .wf-row:hover { background: #f4f8f4; }
    .wf-num { color: #839089; font-size: 10px; flex-shrink: 0; width: 36px; }
    .wf-name { color: #19332d; flex: 1; font-size: 12px; font-weight: 600; min-width: 0; }
    .wf-cadence { border: 1px solid #ced8d2; color: #60726b; font-size: 9px; font-weight: 600; letter-spacing: .05em; padding: 2px 7px; text-transform: uppercase; flex-shrink: 0; }
    .cadence-live-now { background: #fbf0db; border-color: #e7c87a; color: #a36c24; }
    .cadence-monthly, .cadence-quarterly, .cadence-annual { background: #e7f2eb; border-color: #a8d6b5; color: #3e7e56; }
    .wf-chev { color: #839089; flex-shrink: 0; font-size: 13px; transition: transform .2s; }
    .wf-chev.open { transform: rotate(180deg); }
    .wf-detail { background: #f4f8f4; border-top: 1px solid #e4e9e6; padding: 10px 10px 10px 50px; }
    .wf-detail-grid { display: flex; gap: 16px; flex-wrap: wrap; }
    .wf-detail-grid > div { flex: 1; min-width: 100px; }
    .wfd-lbl { color: #839089; font-size: 9px; font-weight: 600; letter-spacing: .08em; margin-bottom: 3px; text-transform: uppercase; }
    .wfd-val { color: #19332d; font-size: 11px; }
    /* IT tools retired section */
    .retired-section { border-top: 1px solid #e4e9e6; margin-top: 12px; padding-top: 4px; }
    .retired-toggle { align-items: center; background: transparent; border: 0; color: #839089; display: flex; font-size: 10px; font-weight: 600; gap: 8px; justify-content: space-between; letter-spacing: .06em; padding: 8px 0; text-transform: uppercase; width: 100%; }
    .retired-toggle:hover { color: #486058; }

    /* misc */
    .notice { background: #fffdf8; border-left: 4px solid #c55b45; color: #8e3f35; margin-bottom: 20px; padding: 15px; }
    .loading { color: #60726b; font-size: 12px; padding: 22px 0; }
    .empty { color: #8a9690; font-size: 11px; padding: 24px 4px; text-align: center; }
    footer.site-footer { border-top: 1px solid #d8dfd9; color: #8a9690; font-size: 10px; letter-spacing: .1em; margin: 0 4rem; padding: 18px 0 24px; text-transform: uppercase; }

    /* responsive */
    @media (max-width: 900px) {
      .site-header { padding: 0 24px; }
      .tab-nav { padding: 0 18px; }
      .content { padding: 26px 24px 42px; }
      .metric-band { grid-template-columns: repeat(3,1fr); }
      .metric-band button:nth-child(4) { border-left: 0; }
      .two-columns { grid-template-columns: 1fr; }
      .wf-two-col { grid-template-columns: 1fr; }
      footer.site-footer { margin: 0 24px; }
    }
    @media (max-width: 560px) {
      .site-header { align-items: flex-start; flex-direction: column; gap: 10px; padding: 14px 16px; }
      .header-actions { justify-content: space-between; width: 100%; }
      .tab-nav { padding: 0 9px; }
      .tab-nav button { font-size: 9px; padding: 10px 7px 8px; }
      .content { padding: 22px 16px 34px; }
      .metric-band, .state-band { grid-template-columns: 1fr; }
      .metric-band button, .state-band div { border-left: 0; border-top: 1px solid rgba(255,255,255,.14); }
      .metric-band button:first-child, .state-band div:first-child { border-top: 0; }
      .state-band div { border-top-color: #dde5df; }
      .panel { padding: 0 14px 14px; }
      .panel-heading span { display: none; }
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
  const [person, setPerson] = useState('Kate McAlpine')
  const [data,   setData]   = useState({})
  const [error,  setError]  = useState('')
  const [loading,setLoading]= useState(true)
  const [synced, setSynced] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const keys = ['risks','controls','tracker','documents','ropa','tools']
    const results = await Promise.allSettled(keys.map(get))
    const next = Object.fromEntries(results.map((r,i) => [
      keys[i], r.status==='fulfilled' ? r.value : { total:0, items:[], byStatus:{}, byDomain:{}, byFlag:{} }
    ]))
    if (results.slice(0,4).every(r => r.status==='rejected')) setError('Could not load Notion data')
    setData(next); setSynced(new Date()); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  // Deduplicated person list — no duplicates from "Dr Kate McAlpine" vs "Kate McAlpine"
  const personOptions = useMemo(() => {
    const raw = Object.values(data).flatMap(e => e?.items||[]).flatMap(i => i.owner?.split(',').map(n=>n.trim())||[]).filter(Boolean)
    const names = dedupeNames(raw)
    return names.includes('Kate McAlpine') ? names : ['Kate McAlpine', ...names]
  }, [data])

  const scoped = useMemo(() => {
    // Match person filter against normalised name to handle Dr/no-Dr variants
    const only = person
      ? item => {
          const names = (item.owner||'').split(',').map(n=>n.trim())
          return names.some(n => normaliseName(n) === normaliseName(person))
        }
      : () => true
    const ri = (data.risks?.items||[]).filter(only)
    const ci = (data.controls?.items||[]).filter(only)
    const ti = (data.tracker?.items||[]).filter(only)
    const di = (data.documents?.items||[]).filter(only)
    const pi = (data.ropa?.items||[]).filter(only)
    const oi = (data.tools?.items||[]).filter(only)
    const pending = ti.filter(i=>i.dueDate&&!['Done','Skipped'].includes(i.status)).sort((a,b)=>a.dueDate.localeCompare(b.dueDate))
    return {
      risks: { ...data.risks, total:ri.length, items:ri, byProbability:count(ri,'probability',['High','Medium','Low']), byCategory:count(ri,'category',['Open','Addressed','Closed']), byDomain:Object.fromEntries(Object.entries(data.risks?.byDomain||{}).map(([d])=>[d,ri.filter(i=>i.domain===d).length])) },
      controls: { ...data.controls, total:ci.length, items:ci, byStatus:count(ci,'status',['Active','Partial','Planned','Not In Place']) },
      tracker: { ...data.tracker, total:ti.length, items:ti, byStatus:count(ti,'status',['Done','In Progress','To Do','Overdue','Skipped']), upcoming:pending.slice(0,5) },
      documents: { ...data.documents, total:di.length, items:di, byStatus:Object.fromEntries(Object.keys(data.documents?.byStatus||{}).map(s=>[s,di.filter(i=>i.status===s).length])) },
      ropa: { ...data.ropa, total:pi.length, items:pi, byFlag:pi.reduce((r,i)=>i.flag?{...r,[i.flag]:(r[i.flag]||0)+1}:r,{}) },
      tools: { ...data.tools, total:oi.length, items:oi },
    }
  }, [data, person])

  const tabs = [
    ['overview','Overview'],
    ['actions','My Actions'],
    ['risks','Risk Register'],
    ['controls','Controls'],
    ['safeguarding','Safeguarding'],
    ['documents','Document Library'],
    ['ropa','RoPA'],
    ['tools','IT Tools'],
  ]

  const open = (nextTab, nextFilter='all') => { setTab(nextTab); setFilter(nextFilter) }

  const view =
    tab==='overview'     ? <Overview {...scoped} onOpen={open} />
    : tab==='actions'    ? <MyActions tracker={scoped.tracker} filter={filter} onFilter={setFilter} />
    : tab==='risks'      ? <RiskRegister risks={scoped.risks} filter={filter} onFilter={setFilter} />
    : tab==='controls'   ? <Controls controls={scoped.controls} filter={filter} onFilter={setFilter} />
    : tab==='safeguarding'?<Safeguarding tracker={scoped.tracker} risks={scoped.risks} controls={scoped.controls} />
    : tab==='documents'  ? <DocumentLibrary documents={scoped.documents} filter={filter} onFilter={setFilter} />
    : tab==='ropa'       ? <RoPA ropa={scoped.ropa} filter={filter} onFilter={setFilter} />
    : <ITTools tools={scoped.tools} filter={filter} onFilter={setFilter} />

  return (
    <>
      <DashboardStyles />
      <main className="hub">
        <header className="site-header">
          <div className="brand"><h1>CONNECT<span>GO</span></h1><p>Governance &amp; Compliance</p></div>
          <div className="header-actions">
            {synced && <small>Last sync · {synced.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</small>}
            <select value={person} onChange={e=>setPerson(e.target.value)} aria-label="Filter by person">
              <option value="">All people</option>
              {personOptions.map(name=><option key={name} value={name}>{name}</option>)}
            </select>
          </div>
        </header>
        <nav className="tab-nav" aria-label="Governance dashboard navigation">
          {tabs.map(([id,label])=>(
            <button key={id} className={tab===id?'active':''} onClick={()=>open(id)}>{label}</button>
          ))}
        </nav>
        <div className="content">
          <div className="eyebrow">{tabs.find(([id])=>id===tab)[1]} — ConnectGo Limited</div>
          {error    ? <div className="notice">Could not load Notion data: {error}</div>
           : loading ? <div className="loading">Loading governance data from Notion…</div>
           : view}
        </div>
        <footer className="site-footer">ConnectGo Ltd · Confidential</footer>
      </main>
    </>
  )
}
