import { useCallback, useEffect, useMemo, useState } from 'react'

const get = key => fetch(`/.netlify/functions/notion?db=${key}`).then(async response => {
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `API error ${response.status}`)
  return data
})

const formatDate = value => value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`)) : '—'
const count = (items, property, values) => values.reduce((result, value) => ({ ...result, [value]: items.filter(item => item[property] === value).length }), {})
const statusTone = value => ['Done', 'Active', 'Approved', 'Closed', 'In Place', 'Enabled'].includes(value) ? 'good' : ['High', 'Overdue', 'Not In Place', 'Not in place', 'Pending'].includes(value) ? 'critical' : 'attention'

function Badge({ children }) {
  return <span className={`badge ${statusTone(children)}`}>{children || '—'}</span>
}

function NotionLink({ item, children }) {
  return <a className="notion-link" href={item.url} target="_blank" rel="noreferrer">{children}<span aria-hidden="true">↗</span></a>
}

function Panel({ title, source, children }) {
  return <section className="panel"><header className="panel-heading"><h2>{title}</h2>{source && <span>{source}</span>}</header>{children}</section>
}

function MetricBand({ metrics }) {
  return <section className="metric-band" aria-label="Key indicators">{metrics.map(metric => <button type="button" key={metric.label} onClick={metric.onClick}><span>{metric.label}</span><strong className={metric.tone || ''}>{metric.value}</strong></button>)}</section>
}

function FilterBar({ options, value, onChange }) {
  return <div className="filter-bar">{options.map(([filter, label]) => <button key={filter} type="button" className={value === filter ? 'selected' : ''} onClick={() => onChange(filter)}>{label}</button>)}</div>
}

function Pager({ items, children }) {
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(items.length / 10))
  const currentPage = Math.min(page, pageCount - 1)
  const start = currentPage * 10
  const visible = items.slice(start, start + 10)
  return <>{children(visible)}<footer className="pager"><span>{items.length ? `Showing ${start + 1}–${Math.min(start + 10, items.length)} of ${items.length}` : 'No matching records'}</span><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>‹</button><span>{currentPage + 1} / {pageCount}</span><button type="button" disabled={currentPage === pageCount - 1} onClick={() => setPage(currentPage + 1)}>›</button></footer></>
}

function Overview({ risks, controls, tracker, documents, onOpen }) {
  const active = controls.byStatus.Active || 0
  const available = tracker.total - (tracker.byStatus.Skipped || 0)
  const metrics = [
    { label: 'Total risks', value: risks.total, onClick: () => onOpen('risks', 'all') },
    { label: 'High probability', value: risks.byProbability.High || 0, tone: 'critical', onClick: () => onOpen('risks', 'high') },
    { label: 'Open risks', value: risks.byCategory.Open || 0, tone: 'attention', onClick: () => onOpen('risks', 'open') },
    { label: 'Controls active', value: `${controls.total ? Math.round(active / controls.total * 100) : 0}%`, onClick: () => onOpen('controls', 'Active') },
    { label: 'Activities done', value: `${available ? Math.round((tracker.byStatus.Done || 0) / available * 100) : 0}%`, onClick: () => onOpen('tracker', 'Done') },
    { label: 'Overdue', value: tracker.byStatus.Overdue || 0, tone: 'critical', onClick: () => onOpen('tracker', 'Overdue') },
  ]
  const domains = Object.entries(risks.byDomain || {}).filter(([, value]) => value)
  return <><MetricBand metrics={metrics} /><div className="two-columns"><Panel title="Risk Register — By Domain" source="Unified Risk Register"><div className="bars">{domains.map(([label, value]) => <button type="button" key={label} onClick={() => onOpen('risks', 'all')}><span>{label}</span><i><em style={{ width: `${risks.total ? value / risks.total * 100 : 0}%` }} /></i><b>{value}</b></button>)}</div></Panel><Panel title="Upcoming Deadlines" source="Governance Tracker"><TaskRows items={tracker.upcoming} /></Panel></div></>
}

function TaskRows({ items }) {
  return <div className="rows">{items.length ? items.map(item => <div className="row" key={item.id}><div><NotionLink item={item}>{item.activityId ? `${item.activityId} · ` : ''}{item.name}</NotionLink><p>{item.owner || '—'} · {formatDate(item.dueDate)}</p></div><Badge>{item.status}</Badge></div>) : <p className="empty">No matching records</p>}</div>
}

function GovernanceTracker({ tracker, filter, onFilter }) {
  const rows = tracker.items.filter(item => filter === 'all' || item.status === filter).sort((left, right) => (left.dueDate || '9999').localeCompare(right.dueDate || '9999'))
  return <><FilterBar value={filter} onChange={onFilter} options={[['all', 'All'], ['To Do', 'To Do'], ['In Progress', 'In Progress'], ['Overdue', 'Overdue'], ['Done', 'Done'], ['Skipped', 'Skipped']]} /><Panel title="Governance Tracker" source="Governance Tracker"><Pager items={rows}>{visible => <div className="data-table tracker-table"><div className="table-head"><span>Activity</span><span>Person responsible</span><span>Deadline</span><span>Domain</span><span>Type</span><span>Priority</span><span>Status</span></div>{visible.map(item => <div className="table-row" key={item.id}><NotionLink item={item}>{item.activityId ? `${item.activityId} · ` : ''}{item.name}</NotionLink><span>{item.owner || '—'}</span><time>{formatDate(item.dueDate)}</time><span>{item.domain || '—'}</span><span>{item.type || '—'}</span><Badge>{item.priority}</Badge><Badge>{item.status}</Badge></div>)}</div>}</Pager></Panel></>
}

function RiskRegister({ risks, filter, onFilter }) {
  const rows = risks.items.filter(item => filter === 'all' || filter === 'high' && item.probability === 'High' || filter === 'open' && item.category === 'Open')
  return <><FilterBar value={filter} onChange={onFilter} options={[['all', 'All risks'], ['high', 'High probability'], ['open', 'Open risks']]} /><div className="two-columns"><Panel title="Risk Register — By Domain" source="Unified Risk Register"><div className="bars">{Object.entries(risks.byDomain || {}).filter(([, value]) => value).map(([label, value]) => <div key={label}><span>{label}</span><i><em style={{ width: `${risks.total ? value / risks.total * 100 : 0}%` }} /></i><b>{value}</b></div>)}</div></Panel><Panel title="High Probability" source="Unified Risk Register"><TaskRows items={risks.items.filter(item => item.probability === 'High').map(item => ({ ...item, activityId: item.riskId, dueDate: item.reviewDate, status: item.controlStatus }))} /></Panel></div><Panel title="Risk Register — Records" source="Unified Risk Register"><Pager items={rows}>{visible => <div className="data-table risk-table"><div className="table-head"><span>Risk</span><span>Domain</span><span>Probability</span><span>Impact</span><span>Control status</span><span>Risk category</span><span>Risk owner</span></div>{visible.map(item => <div className="table-row" key={item.id}><NotionLink item={item}>{item.riskId ? `${item.riskId} · ` : ''}{item.name}</NotionLink><span>{item.domain || '—'}</span><Badge>{item.probability}</Badge><span>{item.consequences || '—'}</span><Badge>{item.controlStatus}</Badge><Badge>{item.category}</Badge><span>{item.owner || '—'}</span></div>)}</div>}</Pager></Panel></>
}

function Controls({ controls, filter, onFilter }) {
  const rows = controls.items.filter(item => filter === 'all' || item.status === filter)
  const counts = controls.byStatus
  return <><section className="state-band"><div><strong>{counts.Active || 0}</strong><span>Active</span></div><div><strong>{counts.Partial || 0}</strong><span>Partial</span></div><div><strong>{counts['Not In Place'] || 0}</strong><span>Not in place</span></div><div><strong>{controls.total ? `${Math.round((counts.Active || 0) / controls.total * 100)}%` : '0%'}</strong><span>Controls active</span></div></section><FilterBar value={filter} onChange={onFilter} options={[['all', 'All controls'], ['Active', 'Active'], ['Partial', 'Partial'], ['Not In Place', 'Not in place']]} /><Panel title="Controls Register" source="Controls Register"><Pager items={rows}>{visible => <div className="data-table controls-table"><div className="table-head"><span>Control</span><span>Domain</span><span>Control type</span><span>Status</span><span>Owner</span><span>Review date</span><span>Review frequency</span></div>{visible.map(item => <div className="table-row" key={item.id}><NotionLink item={item}>{item.controlId ? `${item.controlId} · ` : ''}{item.name}</NotionLink><span>{item.domain || '—'}</span><span>{item.type || '—'}</span><Badge>{item.status}</Badge><span>{item.owner || '—'}</span><time>{formatDate(item.reviewDate)}</time><span>{item.reviewFrequency || '—'}</span></div>)}</div>}</Pager></Panel></>
}

function DocumentLibrary({ documents, filter, onFilter }) {
  const rows = documents.items.filter(item => filter === 'all' || item.status === filter)
  return <><MetricBand metrics={[{ label: 'Approved', value: documents.byStatus.Approved || 0, tone: 'good', onClick: () => onFilter('Approved') }, { label: 'In review', value: documents.byStatus['In review'] || 0, onClick: () => onFilter('In review') }, { label: 'To be reviewed', value: documents.byStatus['To be reviewed'] || 0, tone: 'attention', onClick: () => onFilter('To be reviewed') }, { label: 'Documents', value: documents.total, onClick: () => onFilter('all') }]} /><FilterBar value={filter} onChange={onFilter} options={[['all', 'All documents'], ['Approved', 'Approved'], ['In review', 'In review'], ['To be reviewed', 'To be reviewed']]} /><Panel title="Document Library" source="Document Library"><Pager items={rows}>{visible => <div className="data-table document-table"><div className="table-head"><span>Document</span><span>Domain</span><span>Type</span><span>Owner</span><span>Status</span><span>Next review</span><span>Next approval</span></div>{visible.map(item => <div className="table-row" key={item.id}><NotionLink item={item}>{item.docId ? `${item.docId} · ` : ''}{item.name}</NotionLink><span>{item.domain || '—'}</span><span>{item.type || '—'}</span><span>{item.owner || '—'}</span><Badge>{item.status}</Badge><time>{formatDate(item.nextReviewDate)}</time><time>{formatDate(item.nextApprovalDate)}</time></div>)}</div>}</Pager></Panel></>
}

const ownerOf = person => item => !person || item.owner?.split(',').map(name => name.trim()).includes(person)

function DashboardStyles() {
  return <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;500;600;700&display=swap');
    * { box-sizing: border-box; }
    body { margin: 0; background: #f7f4ee; color: #19332d; font-family: 'Work Sans', sans-serif; }
    button, select { font: inherit; }
    button { cursor: pointer; }
    .hub { min-height: 100vh; }
    .site-header { align-items: center; background: #17332d; color: #fff; display: flex; justify-content: space-between; min-height: 64px; padding: 0 4rem; }
    .brand { align-items: baseline; display: flex; gap: 14px; }
    .brand h1 { color: #fff; font-size: 25px; letter-spacing: -.07em; margin: 0; }
    .brand h1 span { color: #e7a642; }
    .brand p { color: rgba(255,255,255,.52); font-size: 10px; font-weight: 600; letter-spacing: .13em; margin: 0; text-transform: uppercase; }
    .header-actions { align-items: center; display: flex; gap: 10px; }
    .header-actions small { color: rgba(255,255,255,.5); font-size: 10px; }
    .header-actions select { background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.24); color: #fff; font-size: 11px; padding: 7px 9px; }
    .header-actions option { color: #19332d; }
    .tab-nav { background: #17332d; display: flex; flex-wrap: wrap; padding: 0 3.25rem; }
    .tab-nav button { background: transparent; border: 0; border-bottom: 3px solid transparent; color: rgba(255,255,255,.52); font-size: 10px; font-weight: 600; letter-spacing: .09em; padding: 11px 13px 9px; text-transform: uppercase; }
    .tab-nav button:hover { color: #fff; }
    .tab-nav button.active { border-bottom-color: #e7a642; color: #fff; }
    .content { margin: 0 auto; max-width: 1500px; padding: 31px 4rem 52px; }
    .eyebrow { border-bottom: 1px solid #d8dfd9; color: #486058; font-size: 11px; font-weight: 600; letter-spacing: .12em; margin-bottom: 20px; padding-bottom: 14px; text-transform: uppercase; }
    .metric-band { background: #17332d; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); margin-bottom: 20px; }
    .metric-band button { background: transparent; border: 0; border-left: 1px solid rgba(255,255,255,.14); color: #fff; min-height: 104px; padding: 19px 20px; text-align: left; }
    .metric-band button:first-child { border-left: 0; }
    .metric-band button:hover { background: #24453d; box-shadow: inset 0 -3px #e7a642; }
    .metric-band span { color: rgba(255,255,255,.55); display: block; font-size: 9px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; }
    .metric-band strong { color: #fff; display: block; font-size: 31px; letter-spacing: -.06em; margin-top: 12px; }
    .metric-band strong.critical { color: #f1b0a8; }
    .metric-band strong.attention { color: #f2cc82; }
    .metric-band strong.good { color: #a8d6b5; }
    .two-columns { display: grid; gap: 16px; grid-template-columns: minmax(0, 1.1fr) minmax(300px, .9fr); margin-bottom: 20px; }
    .panel { background: #fffdf8; border: 1px solid #dbe3dd; border-top: 3px solid #31594f; margin-bottom: 20px; min-width: 0; padding: 0 20px 16px; }
    .two-columns .panel { margin-bottom: 0; }
    .panel-heading { align-items: center; border-bottom: 1px solid #e0e6e1; display: flex; justify-content: space-between; margin-bottom: 8px; padding: 15px 0 12px; }
    .panel-heading h2 { font-size: 12px; letter-spacing: .08em; margin: 0; text-transform: uppercase; }
    .panel-heading span { border-bottom: 1px solid #bfd0c7; color: #547168; font-size: 9px; font-weight: 600; letter-spacing: .08em; padding-bottom: 2px; text-transform: uppercase; }
    .bars > div, .bars > button { align-items: center; background: transparent; border: 0; border-bottom: 1px solid #e4e9e5; color: #19332d; display: grid; gap: 12px; grid-template-columns: minmax(100px,1fr) minmax(100px,2fr) 28px; padding: 12px 0; text-align: left; width: 100%; }
    .bars > div:last-child, .bars > button:last-child { border-bottom: 0; }
    .bars > button:hover { background: #f4f7f4; padding-left: 7px; }
    .bars span { font-size: 12px; font-weight: 600; }
    .bars i { background: #e4eae6; height: 5px; }
    .bars em { background: #31594f; display: block; height: 100%; }
    .bars b { font-size: 12px; text-align: right; }
    .rows { padding: 0; }
    .row { align-items: center; border-bottom: 1px solid #e5ebe6; display: grid; gap: 10px; grid-template-columns: minmax(0,1fr) auto; padding: 12px 0; }
    .row:last-child { border-bottom: 0; }
    .notion-link { color: #193b32; font-size: 12px; font-weight: 600; text-decoration: none; }
    .notion-link span { color: #a56624; margin-left: 5px; }
    .notion-link:hover { color: #a56624; text-decoration: underline; text-underline-offset: 3px; }
    .row p { color: #7b8882; font-size: 10px; margin: 4px 0 0; }
    .badge { border-left: 3px solid currentColor; display: inline-block; font-size: 9px; font-weight: 600; letter-spacing: .05em; padding: 4px 7px; text-transform: uppercase; white-space: nowrap; }
    .badge.good { background: #e7f2eb; color: #3e7e56; }.badge.critical { background: #fae9e5; color: #ac483d; }.badge.attention { background: #fbf0db; color: #a36c24; }
    .filter-bar { border-bottom: 1px solid #d7dfd9; display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 18px; padding-bottom: 13px; }
    .filter-bar button { background: transparent; border: 1px solid #ced8d2; color: #60726b; font-size: 10px; font-weight: 600; padding: 6px 10px; }
    .filter-bar button.selected, .filter-bar button:hover { background: #31594f; border-color: #31594f; color: #fff; }
    .state-band { background: #fffdf8; border-top: 3px solid #31594f; display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); margin-bottom: 20px; padding: 3px 0; }
    .state-band div { border-left: 1px solid #dde5df; padding: 14px 20px; }.state-band div:first-child { border-left: 0; }
    .state-band strong { color: #1d3e35; display: block; font-size: 25px; letter-spacing: -.06em; }.state-band span { color: #7c8983; display: block; font-size: 10px; margin-top: 5px; }
    .data-table { min-width: 810px; }.table-head, .table-row { display: grid; gap: 10px; padding: 9px 8px; }.table-head { background: #f0f4f0; color: #587168; font-size: 9px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }.table-row { align-items: center; border-bottom: 1px solid #e4e9e6; color: #5e7068; font-size: 11px; min-height: 48px; }.table-row:hover { background: #f4f8f4; }.tracker-table .table-head, .tracker-table .table-row { grid-template-columns: minmax(210px,2.4fr) 1fr .8fr 1fr .8fr .7fr .8fr; }.risk-table .table-head, .risk-table .table-row { grid-template-columns: minmax(220px,2.4fr) 1fr .8fr .8fr 1fr 1fr 1fr; }.controls-table .table-head, .controls-table .table-row { grid-template-columns: minmax(220px,2fr) 1fr 1fr .9fr 1fr .9fr 1fr; }.document-table .table-head, .document-table .table-row { grid-template-columns: minmax(220px,2fr) 1fr .8fr 1fr .9fr .9fr .9fr; }
    .panel:has(.data-table) { overflow-x: auto; }.pager { align-items: center; border-top: 1px solid #e4e9e6; display: flex; gap: 9px; justify-content: flex-end; margin-top: 13px; padding-top: 12px; }.pager span { color: #839089; font-size: 10px; }.pager button { background: #fff; border: 1px solid #d1dad4; color: #31594f; font-size: 12px; padding: 4px 8px; }.pager button:disabled { color: #c1c9c4; cursor: default; }.empty { color: #8a9690; font-size: 11px; padding: 24px 4px; text-align: center; }
    .notice { background: #fffdf8; border-left: 4px solid #c55b45; color: #8e3f35; margin-bottom: 20px; padding: 15px; }.loading { color: #60726b; font-size: 12px; padding: 22px 0; }footer.site-footer { border-top: 1px solid #d8dfd9; color: #8a9690; font-size: 10px; letter-spacing: .1em; margin: 0 4rem; padding: 18px 0 24px; text-transform: uppercase; }
    @media (max-width: 900px) { .site-header { padding: 0 24px; }.tab-nav { padding: 0 18px; }.content { padding: 26px 24px 42px; }.metric-band { grid-template-columns: repeat(3, 1fr); }.metric-band button:nth-child(4) { border-left: 0; }.two-columns { grid-template-columns: 1fr; } footer.site-footer { margin: 0 24px; } }
    @media (max-width: 560px) { .site-header { align-items: flex-start; flex-direction: column; gap: 10px; padding: 14px 16px; }.header-actions { justify-content: space-between; width: 100%; }.brand p { font-size: 8px; }.tab-nav { padding: 0 9px; }.tab-nav button { font-size: 9px; padding: 10px 7px 8px; }.content { padding: 22px 16px 34px; }.metric-band, .state-band { grid-template-columns: 1fr; }.metric-band button, .state-band div { border-left: 0; border-top: 1px solid rgba(255,255,255,.14); }.metric-band button:first-child, .state-band div:first-child { border-top: 0; }.state-band div { border-top-color: #dde5df; }.panel { padding: 0 14px 14px; }.panel-heading span { display: none; } footer.site-footer { margin: 0 16px; } }
  `}</style>
}

export default function Dashboard() {
  const [tab, setTab] = useState('overview')
  const [filter, setFilter] = useState('all')
  const [person, setPerson] = useState('')
  const [data, setData] = useState({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [synced, setSynced] = useState(null)
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { const [risks, controls, tracker, documents] = await Promise.all(['risks', 'controls', 'tracker', 'documents'].map(get)); setData({ risks, controls, tracker, documents }); setSynced(new Date()) } catch (reason) { setError(reason.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  const personOptions = useMemo(() => [...new Set(Object.values(data).flatMap(entry => entry?.items || []).flatMap(item => item.owner?.split(',').map(name => name.trim()) || []).filter(Boolean))].sort(), [data])
  const scoped = useMemo(() => {
    const onlyPerson = ownerOf(person)
    const riskItems = (data.risks?.items || []).filter(onlyPerson)
    const controlItems = (data.controls?.items || []).filter(onlyPerson)
    const trackerItems = (data.tracker?.items || []).filter(onlyPerson)
    const documentItems = (data.documents?.items || []).filter(onlyPerson)
    return {
      risks: { ...data.risks, total: riskItems.length, items: riskItems, byProbability: count(riskItems, 'probability', ['High', 'Medium', 'Low']), byCategory: count(riskItems, 'category', ['Open', 'Addressed', 'Closed']), byDomain: Object.fromEntries(Object.entries(data.risks?.byDomain || {}).map(([domain]) => [domain, riskItems.filter(item => item.domain === domain).length])) },
      controls: { ...data.controls, total: controlItems.length, items: controlItems, byStatus: count(controlItems, 'status', ['Active', 'Partial', 'Planned', 'Not In Place']) },
      tracker: { ...data.tracker, total: trackerItems.length, items: trackerItems, byStatus: count(trackerItems, 'status', ['Done', 'In Progress', 'To Do', 'Overdue', 'Skipped']), upcoming: trackerItems.filter(item => item.dueDate && !['Done', 'Skipped'].includes(item.status)).sort((left, right) => left.dueDate.localeCompare(right.dueDate)).slice(0, 5) },
      documents: { ...data.documents, total: documentItems.length, items: documentItems, byStatus: Object.fromEntries(Object.keys(data.documents?.byStatus || {}).map(status => [status, documentItems.filter(item => item.status === status).length])) },
    }
  }, [data, person])
  const tabs = [['overview', 'Overview'], ['tracker', 'Governance Tracker'], ['risks', 'Risk Register'], ['controls', 'Controls'], ['documents', 'Document Library']]
  const open = (nextTab, nextFilter = 'all') => { setTab(nextTab); setFilter(nextFilter) }
  const view = tab === 'overview' ? <Overview {...scoped} onOpen={open} /> : tab === 'tracker' ? <GovernanceTracker tracker={scoped.tracker} filter={filter} onFilter={setFilter} /> : tab === 'risks' ? <RiskRegister risks={scoped.risks} filter={filter} onFilter={setFilter} /> : tab === 'controls' ? <Controls controls={scoped.controls} filter={filter} onFilter={setFilter} /> : <DocumentLibrary documents={scoped.documents} filter={filter} onFilter={setFilter} />
  return <><DashboardStyles /><main className="hub"><header className="site-header"><div className="brand"><h1>CONNECT<span>GO</span></h1><p>Governance &amp; Compliance</p></div><div className="header-actions">{synced && <small>Last sync · {synced.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</small>}<select value={person} onChange={event => setPerson(event.target.value)} aria-label="Filter by person"><option value="">All people</option>{personOptions.map(name => <option key={name} value={name}>{name}</option>)}</select></div></header><nav className="tab-nav" aria-label="Governance dashboard navigation">{tabs.map(([id, label]) => <button className={tab === id ? 'active' : ''} onClick={() => open(id)} key={id}>{label}</button>)}</nav><div className="content"><div className="eyebrow">{tabs.find(([id]) => id === tab)[1]} — ConnectGo Limited</div>{error ? <div className="notice">Could not load Notion data: {error}</div> : loading ? <div className="loading">Loading governance data from Notion...</div> : view}</div><footer className="site-footer">ConnectGo Ltd · Confidential</footer></main></>
}
