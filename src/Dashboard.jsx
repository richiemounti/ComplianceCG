import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Monitoring rules and chart calculations.
const {localDay, overdue, score: riskScore, rating, isHigh, monitor} = (() => {
const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const score = risk => {
  if (risk.riskScore == null || String(risk.riskScore).trim() === '') return null
  const stored = Number(risk.riskScore)
  return Number.isFinite(stored) && stored >= 0 ? stored : null
}
const rating = risk => String(risk.riskRating || '').toLowerCase().replace(/^[^a-z]+/, '').trim()
const isHigh = risk => ['high', 'very high', 'critical'].includes(rating(risk))
const overdue = (date, today) => Boolean(date && date.slice(0, 10) < today)
function monitor(risks, controls, tasks, today = localDay()) {
  const active = risks.filter(r => r.category !== 'Closed')
  const high = active.filter(isHigh)
  const reviews = active.filter(r => overdue(r.reviewDate, today))
  const gaps = controls.filter(c => c.status !== 'Active')
  const late = tasks.filter(t => !['Done', 'Skipped'].includes(t.status) && (t.status === 'Overdue' || overdue(t.dueDate, today)))
  return { active, high, reviews, gaps, late }
}

return {localDay,overdue,score,rating,isHigh,monitor}
})();
const {trendPoints,trendChange} = (() => {
function trendPoints(history, domain, days, now = new Date()) {
  const end = now.toISOString().slice(0, 10)
  const start = new Date(`${end}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - days + 1)
  const cutoff = start.toISOString().slice(0, 10)
  return history.filter(row => row.version === 2 && row.day >= cutoff && row.day <= end).sort((a,b) => a.day.localeCompare(b.day)).map(row => {
    const items = row.items.filter(item => domain === 'all' || item.domain === domain)
    const scored = items.filter(item => typeof item.score === 'number' && Number.isFinite(item.score) && item.score >= 0)
    const domains = Object.fromEntries([...new Set(items.map(i => i.domain))].map(domain => {
      const values = scored.filter(i => i.domain === domain)
      return [domain, values.length ? values.reduce((sum,i) => sum + i.score, 0) : null]
    }))
    return { day: row.day, capturedAt: row.capturedAt, total: items.length && !scored.length ? null : scored.reduce((sum,item) => sum + item.score, 0),
      count: items.length, unscored: items.length - scored.length, domains }
  })
}
function trendChange(points) {
  if (points.length < 2) return null
  const first = points[0].total, last = points.at(-1).total
  if (first === null || last === null) return null
  return { absolute: last - first, percent: first ? (last - first) / first * 100 : null }
}

return {trendPoints,trendChange}
})();
const {dateKey,parseDay,weekRange,reviewSources,reviewOccurrences} = (() => {
const steps = {monthly:1, quarterly:3, annually:12, annual:12, yearly:12}
const dateKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
function parseDay(value) {
  const key = String(value || '').slice(0,10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null
  const [y,m,d] = key.split('-').map(Number)
  const result = new Date(y,m-1,d,12)
  return dateKey(result) === key ? result : null
}
function weekRange(now = new Date()) {
  const start = new Date(now.getFullYear(),now.getMonth(),now.getDate(),12)
  start.setDate(start.getDate()-(start.getDay()+6)%7)
  const end = new Date(start); end.setDate(end.getDate()+6)
  return {start:dateKey(start),end:dateKey(end)}
}
function reviewSources(risks, controls) {
  return [...risks.filter(r=>r.category!=='Closed').map(r=>({...r,kind:'Risk'})), ...controls.map(c=>({...c,kind:'Control'}))]
}
// Always calculate from the original anchor so Jan 31 -> Feb 28 -> Mar 31.
function reviewOccurrences(sources, start, end) {
  const first=parseDay(start), last=parseDay(end)
  if (!first || !last || first>last) return []
  const result=[]
  for (const item of sources) {
    const anchor=parseDay(item.reviewDate)
    if (!anchor || anchor>last) continue
    const step=steps[String(item.reviewFrequency || '').trim().toLowerCase()]
    const append=due=>{const key=dateKey(due);if(key>=start&&key<=end)result.push({...item,dueDate:key,occurrenceId:`${item.kind}:${item.id}:${key}`,recurring:Boolean(step)})}
    if (!step) { append(anchor); continue }
    const distance=(first.getFullYear()-anchor.getFullYear())*12+first.getMonth()-anchor.getMonth()
    for (let n=Math.max(0,Math.floor(distance/step));;n++) {
      const month=new Date(anchor.getFullYear(),anchor.getMonth()+n*step,1,12)
      const due=new Date(month.getFullYear(),month.getMonth(),Math.min(anchor.getDate(),new Date(month.getFullYear(),month.getMonth()+1,0).getDate()),12)
      if(due>last)break
      append(due)
    }
  }
  return result.sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.name.localeCompare(b.name))
}

return {dateKey,parseDay,weekRange,reviewSources,reviewOccurrences}
})();
const RiskTrend = (() => {

const colors = ['#31594f', '#ac6545', '#657aaf', '#96783d', '#8b6899', '#5e9095', '#8b8d48']
const label = day => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day:'numeric', month:'short', timeZone:'UTC' })
const number = value => value == null ? '—' : Number(value.toFixed(2)).toLocaleString('en-GB')

function LineChart({ points, series, title }) {
  const max = Math.max(1, ...points.flatMap(p => series.map(s => s.value(p))))
  const first = Date.parse(points[0].day), last = Date.parse(points.at(-1).day)
  const x = p => 48 + (last === first ? .5 : (Date.parse(p.day) - first) / (last - first)) * 580
  const y = value => 180 - value / max * 145
  return <svg viewBox="0 0 660 220" role="img" aria-label={title} className="trend-svg">
    <title>{title + '. Exact values are available in the snapshot table below.'}</title>
    {[0, .5, 1].map(ratio => <g key={ratio}><line x1="48" x2="628" y1={y(max * ratio)} y2={y(max * ratio)} stroke="#e4e9e2"/><text x="38" y={y(max * ratio) + 4} textAnchor="end">{number(max * ratio)}</text></g>)}
    {series.map(s => <g key={s.name}>{points.map((point,i) => {
      const previous = points[i-1]
      if (s.value(point) == null) return null
      // A missing daily snapshot leaves a visible gap rather than an invented value.
      return <g key={point.day}>{previous && s.value(previous) != null && Date.parse(point.day) - Date.parse(previous.day) === 86400000 && <line x1={x(previous)} y1={y(s.value(previous))} x2={x(point)} y2={y(s.value(point))} stroke={s.color} strokeWidth="2.5"/>}<circle cx={x(point)} cy={y(s.value(point))} r="3.5" fill={s.color}><title>{point.day + ' · ' + s.name + ': ' + number(s.value(point))}</title></circle></g>
    })}</g>)}
    <text x="48" y="207">{label(points[0].day)}</text>{points.length > 1 && <text x="628" y="207" textAnchor="end">{label(points.at(-1).day)}</text>}
  </svg>
}

function RiskTrend({ history = [], domain, error, stale }) {
  const [days, setDays] = useState(90)
  const points = trendPoints(history, domain, days)
  const change = trendChange(points)
  const latest = points.at(-1)
  const domains = [...new Set(points.flatMap(p => Object.keys(p.domains)))].sort()
  const series = domains.map((name,i) => ({name, color:colors[i % colors.length], value:p => Object.hasOwn(p.domains, name) ? p.domains[name] : 0}))
  return <section className="monitor-panel trend-panel">
    <header><div><span className="monitor-kicker">RISK OVER TIME</span><h2>Total risk score</h2></div><div className="watch-tabs trend-range" aria-label="History period">{[30,90,365].map(value => <button key={value} aria-pressed={days === value} className={days === value ? 'selected' : ''} onClick={() => setDays(value)}>{value === 365 ? '1 year' : `${value} days`}</button>)}</div></header>
    <p className="subtle">Sum of recorded Notion Risk Scores for non-closed risks. No estimated scores are substituted. Person and domain filters apply to each historical snapshot.</p>
    {points.some(p => p.unscored > 0) && <p className="trend-warning">Some snapshots have missing scores. Their totals include only scored risks; changes in coverage can affect the trend.</p>}
    {(error || stale) && <p className="trend-warning" role="status">{error || 'Risk source is unavailable. The history below may be stale.'}</p>}
    {!latest ? <div className="trend-empty"><strong>No recorded history in this period</strong><p>Daily snapshots begin after deployment and a successful Notion sync. Past scores cannot be reconstructed from the current register.</p></div> : <>
      <div className="trend-summary"><div><strong>{number(latest.total)}</strong><span>Latest recorded total · {label(latest.day)}</span></div><div><strong className={change?.absolute > 0 ? 'danger' : ''}>{change ? `${change.absolute > 0 ? '+' : ''}${number(change.absolute)}` : '—'}</strong><span>{change ? `${change.percent === null ? 'Percentage unavailable from a zero baseline' : `${change.percent > 0 ? '+' : ''}${number(change.percent)}%`} · since ${label(points[0].day)}` : 'Change needs two snapshots with recorded totals'}</span></div><div><strong>{latest.unscored}</strong><span>Unscored risks excluded from total · {latest.count} risks in scope</span></div></div>
      <div className="trend-charts"><div><h3>Total exposure</h3><LineChart points={points} series={[{name:'Total score', color:colors[0], value:p => p.total}]} title="Total risk score over time"/></div><div><h3>Score by domain</h3><LineChart points={points} series={series} title="Risk score by domain over time"/><div className="trend-legend">{series.map(s => <span key={s.name}><i style={{background:s.color}}/>{s.name}</span>)}</div></div></div>
      <p className="subtle">{points.length} daily snapshots · dates in UTC · today's point updates with each successful sync. Gaps indicate missing snapshots. Changes can reflect scores, additions, closures, or ownership/domain changes.</p>
      <details className="trend-details"><summary>View snapshot values</summary><div className="watch-scroll"><table><thead><tr><th>Date (UTC)</th><th>Total score</th><th>Risks</th><th>Unscored</th>{domains.map(d => <th key={d}>{d}</th>)}</tr></thead><tbody>{points.map(p => <tr key={p.day}><td>{p.day}</td><td>{number(p.total)}</td><td>{p.count}</td><td>{p.unscored}</td>{domains.map(d => <td key={d}>{number(Object.hasOwn(p.domains, d) ? p.domains[d] : 0)}</td>)}</tr>)}</tbody></table></div></details>
    </>}
  </section>
}



return RiskTrend
})();
const LiveOverview = (() => {
const score = riskScore;

const dateLabel = value => value ? new Date(value.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'No date set'
const sourceNames = { risks: 'Risk register', controls: 'Controls', tracker: 'Governance tasks', documents: 'Documents', ropa: 'RoPA', tools: 'IT tools' }
function LiveOverview({ risks, controls, tracker, health, onOpen }) {
  const [domain, setDomain] = useState('all')
  const [queue, setQueue] = useState('risks')
  const [cell, setCell] = useState(null)
  const [highOnly, setHighOnly] = useState(false)
  const inDomain = item => domain === 'all' || (item.domain || 'Unassigned') === domain
  const m = monitor(risks.items.filter(inDomain), controls.items.filter(inDomain), tracker.items.filter(inDomain))
  const domains = [...new Set([...risks.items, ...controls.items, ...tracker.items].map(r => r.domain || 'Unassigned'))].sort()
  const unavailable = ['risks', 'controls', 'tracker'].some(key => !health[key]?.updated)
  const stale = Object.values(health).some(s => s.error)
  const watch = [...m.active].filter(r => !highOnly || isHigh(r)).filter(r => !cell || (r.probability === cell.probability && r.consequences === cell.consequence)).sort((a,b) => (score(b) ?? -1) - (score(a) ?? -1))
  const rows = queue === 'risks' ? watch : queue === 'reviews' ? m.reviews : queue === 'controls' ? m.gaps : m.late
  const choose = value => { setQueue(value); setCell(null); setHighOnly(false) }
  const metrics = [
    ['risks', 'High rated risks', m.high.length, 'Notion High / Very High / Critical · excluding closed', 'danger'],
    ['controls', 'Control gaps', m.gaps.length, 'Controls not marked active', 'amber'],
    ['reviews', 'Overdue risk reviews', m.reviews.length, 'Review date before today', 'amber'],
    ['tasks', 'Overdue actions', m.late.length, 'Open tasks past their deadline', 'danger'],
  ]
  return <div className="monitor">
    <div className="monitor-title"><div><span className="monitor-kicker">GOVERNANCE INTELLIGENCE</span><h1>Risk monitoring</h1><p>Your current exposure. Your next priorities.</p></div><label>Monitor domain<select value={domain} onChange={e => { setDomain(e.target.value); setCell(null) }}><option value="all">All domains</option>{domains.map(d => <option key={d}>{d}</option>)}</select></label></div>
    <div className={`posture ${unavailable || stale ? 'uncertain' : ''}`}><span className="posture-icon">◉</span><div><strong>{unavailable ? 'Monitoring data incomplete' : stale ? 'Some sources need attention' : m.high.length || m.late.length || m.reviews.length || m.gaps.length ? 'Attention required' : 'No priority signals in recorded data'}</strong><p>{unavailable ? 'Connect the unavailable sources to establish your current risk position.' : `${m.active.length} non-closed risks in scope · ${m.active.filter(r => score(r) === null).length} unscored · ${m.active.filter(r => !r.owner).length} without an owner · ${m.active.filter(r => !r.riskRating).length} without a rating`}</p></div><span className="posture-date">{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span></div>
    <div className="monitor-metrics">{metrics.map(([key,label,value,note,tone]) => <button key={key} onClick={() => { choose(key); setHighOnly(key === 'risks') }} className={queue === key ? 'is-selected' : ''}><span>{label}<span aria-hidden="true">↗</span></span><strong className={tone}>{!health[key === 'controls' ? 'controls' : key === 'tasks' ? 'tracker' : 'risks']?.updated ? '—' : value}</strong><small>{note}</small></button>)}</div>
    <RiskTrend history={risks.history} domain={domain} error={risks.historyError} stale={health.risks?.error} />
    <div className="monitor-grid"><section className="monitor-panel"><header><div><span className="monitor-kicker">EXPOSURE</span><h2>Risk landscape</h2></div><span className="subtle">{health.risks?.updated ? m.active.length : '—'} non-closed risks</span></header><p className="subtle">Select a cell to inspect its risks below.</p><div className="live-matrix"><span className="axis">Impact ↓ / Likelihood →</span>{['Low','Medium','High'].map(p => <span className="axis" key={p}>{p}</span>)}{['Major','Moderate','Minor'].flatMap((consequence,i) => [<span className="axis" key={consequence}>{consequence}</span>, ...['Low','Medium','High'].map((probability,j) => {  return <button key={`${consequence}-${probability}`} className={`heat neutral ${cell?.consequence === consequence && cell?.probability === probability ? 'heat-selected' : ''}`} aria-label={`${consequence} impact, ${probability} likelihood`} onClick={() => { setCell({ consequence, probability }); setQueue('risks'); setHighOnly(false) }}><strong>{health.risks?.updated ? m.active.filter(r => r.probability === probability && r.consequences === consequence).length : '—'}</strong><small>risks</small></button> })])}</div><p className="subtle">Matrix shows risk counts by the recorded probability and consequences. Scores and ratings come directly from Notion.</p></section>
    <section className="monitor-panel"><header><div><span className="monitor-kicker">COVERAGE</span><h2>Exposure by domain</h2></div><button className="text-button" onClick={() => onOpen('risks')}>Open register ↗</button></header><div className="exposure-list">{domains.filter(d => domain === 'all' || d === domain).map(d => { const items = risks.items.filter(r => (r.domain || 'Unassigned') === d && r.category !== 'Closed'); const high = items.filter(r => isHigh(r)).length; return <button key={d} onClick={() => setDomain(d)}><div><span>{d}</span><strong>{items.length}<small> risks</small></strong></div><div className="exposure-track"><i style={{width: `${items.length / Math.max(1, risks.total) * 100}%`}} /></div><small>{high} rated High / Very High / Critical · {items.filter(r => !r.owner).length} unassigned</small></button> })}{!domains.length && <p className="empty">No domain data available.</p>}</div></section></div>
    <section className="monitor-panel watch-panel"><header><div><span className="monitor-kicker">TAKE ACTION</span><h2>Priority watchlist</h2></div><span className="subtle">{rows.length} records</span></header><div className="watch-tabs">{[['risks','Risk watchlist'],['controls','Control gaps'],['reviews','Overdue reviews'],['tasks','Overdue actions']].map(([key,label]) => <button key={key} className={queue === key ? 'selected' : ''} onClick={() => choose(key)}>{label}</button>)}{highOnly && <button onClick={() => setHighOnly(false)}>High ratings only ×</button>}{cell && <button onClick={() => setCell(null)}>Clear matrix filter ×</button>}</div><div className="watch-scroll"><table><thead><tr><th>{queue === 'controls' ? 'Control' : queue === 'tasks' ? 'Action' : 'Risk'}</th><th>Domain</th><th>Owner</th><th>{queue === 'risks' ? 'Score' : 'Status'}</th><th>{queue === 'tasks' ? 'Due date' : 'Review date'}</th></tr></thead><tbody>{rows.slice(0, 20).map(r => <tr key={r.id}><td><a href={r.url} target="_blank" rel="noreferrer">{r.name} ↗</a></td><td>{r.domain || 'Unassigned'}</td><td>{r.owner || 'Unassigned'}</td><td><span className={`monitor-pill ${queue === 'risks' && isHigh(r) ? 'danger' : ''}`}>{queue === 'risks' ? score(r) ?? 'Unscored' : r.status || r.category || 'Unknown'}</span></td><td>{dateLabel(queue === 'tasks' ? r.dueDate : r.reviewDate)}</td></tr>)}</tbody></table></div>{!rows.length && <p className="empty">{unavailable ? 'Data unavailable for this view. Check source health below.' : 'No matching records in this scope.'}</p>}{rows.length > 20 && <p className="subtle">Showing the first 20 records. <button className="text-button" onClick={() => onOpen(queue === 'tasks' ? 'actions' : queue === 'controls' ? 'controls' : 'risks')}>Open full register ↗</button></p>}</section>
    <section className="source-health" aria-label="Source health"><div><strong>Source health</strong><span>Notion · refreshes every 60 seconds</span></div>{Object.entries(sourceNames).map(([key,label]) => <div key={key}><span className={`source-dot ${health[key]?.error ? 'failed' : health[key]?.updated ? '' : 'pending'}`} /><span>{label}<small>{health[key]?.error ? health[key]?.updated ? 'Stale · retrying' : 'Unavailable' : health[key]?.updated ? `Synced ${new Date(health[key].updated).toLocaleTimeString('en-GB')}` : 'Waiting'}</small></span></div>)}</section>
  </div>
}






return LiveOverview
})();
const {ReviewCalendar,ReviewActions} = (() => {

function useToday() {
  const [today,setToday]=useState(()=>dateKey(new Date()))
  useEffect(()=>{const timer=setInterval(()=>setToday(dateKey(new Date())),30000);return()=>clearInterval(timer)},[])
  return today
}
function ReviewList({items,empty}) {
  return items.length ? <ul className="review-list">{items.map(item=><li key={item.occurrenceId || `${item.kind}:${item.id}`}><div><span className="review-kind">{item.kind}</span> <a href={item.url} target="_blank" rel="noreferrer">Review {item.name} ↗</a><small>{item.owner || 'Unassigned owner'} · {item.reviewFrequency || 'One dated review'}</small></div><time dateTime={item.dueDate || item.reviewDate}>{(item.dueDate || item.reviewDate || '').slice(0,10)}</time></li>)}</ul> : <p className="empty">{empty}</p>
}
function ReviewActions({risks,controls,health={}}) {
  const today=useToday(), range=weekRange(parseDay(today))
  const sources=reviewSources(risks.items,controls.items)
  const due=reviewOccurrences(sources,range.start,range.end)
  const overdue=sources.filter(item=>parseDay(item.reviewDate)&&item.reviewDate.slice(0,10)<range.start)
  const unscheduled=sources.filter(item=>!parseDay(item.reviewDate))
  const incomplete=['risks','controls'].some(key=>!health[key]?.updated || health[key]?.error)
  return <section className="review-panel"><h2>Risk and control reviews due this week</h2><p className="review-note">{range.start} – {range.end} · Monday to Sunday · filtered by the selected person</p>
    {incomplete&&<p role="status" className="trend-warning">Review sources are unavailable or stale. This schedule may be incomplete.</p>}
    <ReviewList items={due} empty="No scheduled risk or control reviews this week."/>
    {!!overdue.length&&<details><summary>{overdue.length} earlier review dates need attention</summary><p className="review-note">These are the dates still recorded in Notion. After completing a review, move its Review Date to the next due date in the register.</p><ReviewList items={overdue} /></details>}
    {!!unscheduled.length&&<details><summary>{unscheduled.length} reviews have no valid date</summary><ReviewList items={unscheduled}/></details>}
    <p className="review-note">Open an action to review its record in Notion. Calendar occurrences show planned reviews; they do not prove that a review was completed.</p>
  </section>
}
function ReviewCalendar({risks,controls,health}) {
  const today=useToday()
  const [offset,setOffset]=useState(0),[kind,setKind]=useState('All'),[selected,setSelected]=useState(null)
  const now=parseDay(today), month=new Date(now.getFullYear(),now.getMonth()+offset,1,12)
  const start=dateKey(month), end=dateKey(new Date(month.getFullYear(),month.getMonth()+1,0,12))
  const sources=reviewSources(risks.items,controls.items).filter(item=>kind==='All'||item.kind===kind)
  const events=reviewOccurrences(sources,start,end)
  const blanks=(month.getDay()+6)%7, days=parseDay(end).getDate()
  const changeMonth=delta=>{setOffset(value=>value+delta);setSelected(null)}
  return <div className="review-calendar"><ReviewActions risks={risks} controls={controls} health={health}/>
    <section className="review-panel"><div className="review-toolbar"><div><h2>Review calendar</h2><p className="review-note">Monthly, quarterly and annual reviews repeat from the recorded Review Date. Dates refresh with Notion every 60 seconds.</p></div><label>Review type <select value={kind} onChange={event=>setKind(event.target.value)}>{['All','Risk','Control'].map(value=><option key={value}>{value}</option>)}</select></label></div>
      <div className="review-toolbar"><button onClick={()=>changeMonth(-1)}>‹ Previous month</button><h3>{month.toLocaleDateString('en-GB',{month:'long',year:'numeric'})}</h3><button onClick={()=>changeMonth(1)}>Next month ›</button><button onClick={()=>{setOffset(0);setSelected(today)}}>Today</button></div>
      <div className="review-grid-scroll"><div className="review-grid">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day=><div className="review-day-label" key={day}>{day}</div>)}{Array.from({length:blanks},(_,i)=><div key={'blank'+i}/>)}{Array.from({length:days},(_,i)=>{
        const key=`${start.slice(0,8)}${String(i+1).padStart(2,'0')}`, matches=events.filter(item=>item.dueDate===key)
        return <button className={`review-day ${key===today?'today':''} ${key===selected?'selected':''}`} key={key} onClick={()=>setSelected(key)} aria-label={`${key}: ${matches.length} reviews`} aria-pressed={key===selected}><strong>{i+1}</strong>{matches.slice(0,2).map(item=><span key={item.occurrenceId}>{item.kind}: {item.name}</span>)}{matches.length>2&&<small>+{matches.length-2} more — select date</small>}</button>
      })}</div></div>
      <h3>{selected?`Reviews on ${selected}`:'All reviews this month'} ({events.filter(item=>!selected||item.dueDate===selected).length})</h3>
      {selected&&<button onClick={()=>setSelected(null)}>Show all dates</button>}
      <ReviewList items={events.filter(item=>!selected||item.dueDate===selected)} empty="No reviews scheduled for this selection."/>
    </section>
  </div>
}

return {ReviewCalendar,ReviewActions}
})();

/* ── API helpers ─────────────────────────────────────────── */
const get = key => fetch(`/.netlify/functions/notion?db=${key}`, { cache: 'no-store', signal: AbortSignal.timeout(30000) }).then(async res => {
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
const scoreBand = risk => rating(risk) || 'unrated'

/* ── Shared components ───────────────────────────────────── */
function Badge({ children }) {
  return <span className={`badge ${statusTone(children)}`}>{children || '—'}</span>
}
function NotionLink({ item, children }) {
  return <a className="notion-link" href={item.url} target="_blank" rel="noreferrer">{children}<span aria-hidden="true">↗</span></a>
}
function Panel({ title, source, children, className = '' }) {
  return (
    <section className={`panel ${className}`}>
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
// Tables show ten records per page; wide tables can still scroll horizontally.
function ScrollTable({ items, head, row: RowFn, pageSize = 10, minWidth = 810, columns }) {
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const start = (currentPage - 1) * pageSize
  const pageItems = items.slice(start, start + pageSize)

  useEffect(() => { setPage(1) }, [items])
  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  return (
    <div className="table-wrap">
      <div className="table-scroll">
        <div className="data-table" style={{ minWidth, '--table-columns': columns }}>
          <div className="table-head">{head}</div>
          {items.length ? pageItems.map(RowFn) : <div className="table-row" style={{ gridColumn: '1/-1', color: '#8a9690', fontSize: 11 }}>No matching records</div>}
        </div>
      </div>
      {items.length > pageSize && (
        <nav className="table-pagination" aria-label="Table pages">
          <span>Showing {start + 1}–{Math.min(start + pageSize, items.length)} of {items.length}</span>
          <div className="page-controls">
            <button type="button" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 1} aria-label="Previous page">‹</button>
            {Array.from({ length: pageCount }, (_, index) => index + 1).map(number => (
              <button type="button" key={number} className={number === currentPage ? 'current' : ''} onClick={() => setPage(number)} aria-current={number === currentPage ? 'page' : undefined}>{number}</button>
            ))}
            <button type="button" onClick={() => setPage(currentPage + 1)} disabled={currentPage === pageCount} aria-label="Next page">›</button>
          </div>
        </nav>
      )}
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
    <Panel title="Workflows" source="" className="workflow-panel">
      <div className="workflow-groups">
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
function MyActions({ tracker, risks, controls, health, filter, onFilter }) {
  const [view, setView] = useState('list')
  const [localDone, setLocalDone] = useState(new Set())
  const handleDone = id => setLocalDone(prev => new Set([...prev, id]))

  const allItems = [...tracker.items].sort((a,b) => (a.dueDate||'9999').localeCompare(b.dueDate||'9999'))

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
      <ReviewActions risks={risks} controls={controls} health={health} />
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
function RiskProfile({ risks, title, source, onCellSelect, onBandSelect }) {
  const rows = ['Major', 'Moderate', 'Minor']
  const columns = ['Low', 'Medium', 'High']
  const bands = [
    { key: 'critical', label: 'Critical', range: 'Notion rating', tone: 'critical' },
    { key: 'very high', label: 'Very High', range: 'Notion rating', tone: 'critical' },
    { key: 'high', label: 'High', range: 'Notion rating', tone: 'critical' },
    { key: 'medium', label: 'Medium', range: 'Notion rating', tone: 'attention' },
    { key: 'low', label: 'Low', range: 'Notion rating', tone: 'good' },
    { key: 'unrated', label: 'Unrated', range: 'No rating recorded', tone: '' },
  ]
  const categoryCount = category => risks.items.filter(r => r.category === category).length
  const Cell = ({ consequence, probability }) => {
    const matching = risks.items.filter(r => r.consequences === consequence && r.probability === probability)
    const className = 'risk-matrix-cell neutral'
    const content = <><strong>{matching.length}</strong><span>risks</span></>
    return onCellSelect
      ? <button type="button" className={className} onClick={() => onCellSelect({ consequence, probability })} aria-label={`${consequence}, ${probability}: ${matching.length} risks`}>{content}</button>
      : <div className={className}>{content}</div>
  }
  return (
    <Panel title={title} source={source} className="risk-profile-panel">
      <div className="risk-profile-summary">
        {bands.map(band => {
          const value = risks.items.filter(r => scoreBand(r) === band.key).length
          const content = <><span>{band.label} <small>{band.range}</small></span><strong>{value}</strong></>
          return onBandSelect
            ? <button type="button" key={band.key} className={band.tone} onClick={() => onBandSelect(band.key)}>{content}</button>
            : <div key={band.key} className={band.tone}>{content}</div>
        })}
      </div>
      <div className="risk-profile-body">
        <div className="risk-matrix-wrap" aria-label="Risk score matrix">
          <div className="risk-matrix-label">Risk counts by consequence and probability</div>
          <div className="risk-matrix">
            <span className="matrix-corner" />
            {columns.map(column => <span key={column} className="matrix-heading">{column}</span>)}
            {rows.flatMap(row => [
              <span key={`${row}-label`} className="matrix-heading matrix-row-heading">{row}</span>,
              ...columns.map(column => <Cell key={`${row}-${column}`} consequence={row} probability={column} />),
            ])}
          </div>
        </div>
        <div className="risk-lifecycle" aria-label="Risk lifecycle">
          <span>Open <strong>{categoryCount('Open')}</strong></span>
          <span>Addressed <strong>{categoryCount('Addressed')}</strong></span>
          <span>Ongoing <strong>{categoryCount('Ongoing')}</strong></span>
          <span>Closed <strong>{categoryCount('Closed')}</strong></span>
        </div>
      </div>
    </Panel>
  )
}

function RiskRegister({ risks, filter, onFilter }) {
  const [domainFilter, setDomainFilter] = useState(null)
  const [profileFilter, setProfileFilter] = useState(null)
  const [search, setSearch] = useState('')
  const rows = risks.items.filter(i => {
    const mDomain = !domainFilter || i.domain === domainFilter
    const mProfile = !profileFilter || (profileFilter.type === 'cell'
      ? i.probability === profileFilter.probability && i.consequences === profileFilter.consequence
      : scoreBand(i) === profileFilter.band)
    const mFilter = filter==='all'||(filter==='high'&&i.probability==='High')||(filter==='open'&&i.category==='Open')
    const mSearch = !search || i.name?.toLowerCase().includes(search.toLowerCase()) || i.domain?.toLowerCase().includes(search.toLowerCase()) || i.owner?.toLowerCase().includes(search.toLowerCase())
    return mDomain && mProfile && mFilter && mSearch
  })
  return (
    <>
      <div className="search-filter-row">
        <SearchBox value={search} onChange={setSearch} placeholder="Search risks…" />
        <FilterBar value={filter} onChange={f=>{onFilter(f);setDomainFilter(null);setProfileFilter(null)}} options={[['all','All risks'],['high','High probability'],['open','Open risks']]} />
      </div>
      <RiskProfile
        risks={risks}
        title="Current Risk Profile"
        source="Unified Risk Register"
        onCellSelect={({ consequence, probability }) => setProfileFilter({ type: 'cell', consequence, probability })}
        onBandSelect={band => setProfileFilter({ type: 'band', band })}
      />
      {profileFilter && <div className="domain-active-label">Showing {profileFilter.type === 'cell' ? `${profileFilter.consequence} / ${profileFilter.probability}` : profileFilter.band}<button type="button" className="domain-clear" onClick={() => setProfileFilter(null)}>× Clear</button></div>}
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
          minWidth={2140}
          columns="68px minmax(240px,2.1fr) minmax(120px,1fr) minmax(120px,1fr) 100px minmax(140px,1.1fr) 95px minmax(130px,1fr) minmax(130px,1fr) 110px 130px 100px 100px 110px"
          head={<><span>{risks.columns?.riskId || 'Risk ID'}</span><span>{risks.columns?.title || 'Risk'}</span><span>{risks.columns?.owner || 'Risk Owner'}</span><span>{risks.columns?.domain || 'Domain'}</span><span>{risks.columns?.probability || 'Probability'}</span><span>{risks.columns?.consequences || 'Consequences'}</span><span>{risks.columns?.riskScore || 'Risk Score'}</span><span>{risks.columns?.controlStatus || 'Control Status'}</span><span>{risks.columns?.category || 'Risk Category'}</span><span>{risks.columns?.reviewDate || 'Review Date'}</span><span>{risks.columns?.reviewFrequency || 'Review Frequency'}</span><span>Severity Score</span><span>Risk Rating</span><span>Score Date</span></>}
          row={item => (
            <div className="table-row risk-table-row" key={item.id}>
              <span>{item.riskId ?? '—'}</span>
              <NotionLink item={item}>{item.name}</NotionLink>
              <span>{item.owner||'—'}</span>
              <span>{item.domain||'—'}</span>
              <Badge>{item.probability}</Badge>
              <span>{item.consequences||'—'}</span>
              <strong className="score-value">{riskScore(item) ?? '—'}</strong>
              <Badge>{item.controlStatus}</Badge>
              <Badge>{item.category}</Badge>
              <time>{formatDate(item.reviewDate)}</time>
              <span>{item.reviewFrequency||'—'}</span><span>{item.severityScore ?? '—'}</span><span>{item.riskRating || 'Unrated'}</span><time>{formatDate(item.scoreDate)}</time>
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
          minWidth={1450}
          columns="80px minmax(240px,2fr) minmax(120px,1fr) minmax(130px,1fr) 105px minmax(120px,1fr) 110px 135px"
          head={<><span>{controls.columns?.controlId || 'Control ID'}</span><span>{controls.columns?.title || 'Control'}</span><span>{controls.columns?.domain || 'Domain'}</span><span>{controls.columns?.type || 'Control Type'}</span><span>{controls.columns?.status || 'Status'}</span><span>{controls.columns?.owner || 'Owner'}</span><span>{controls.columns?.reviewDate || 'Review Date'}</span><span>{controls.columns?.reviewFrequency || 'Review Frequency'}</span></>}
          row={item => (
            <div className="table-row controls-table-row" key={item.id}>
              <span>{item.controlId ?? '—'}</span>
              <NotionLink item={item}>{item.name}</NotionLink>
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
      <RiskProfile risks={{ ...risks, total: riskRows.length, items: riskRows }} title="Safeguarding Risk Profile" source="Unified Risk Register" />
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
          minWidth={1520}
          columns="68px minmax(230px,2fr) minmax(120px,1fr) minmax(110px,.9fr) minmax(120px,1fr) 105px 115px 120px 130px"
          head={<><span>{documents.columns?.docId || 'Doc ID'}</span><span>{documents.columns?.title || 'Document'}</span><span>{documents.columns?.domain || 'Domain'}</span><span>{documents.columns?.type || 'Type'}</span><span>{documents.columns?.owner || 'Owner'}</span><span>{documents.columns?.status || 'Status'}</span><span>{documents.columns?.reviewCycle || 'Review Cycle'}</span><span>{documents.columns?.nextReviewDate || 'Next Review Date'}</span><span>{documents.columns?.nextApprovalDate || 'Next Approval Date'}</span></>}
          row={item => (
            <div className="table-row document-table-row" key={item.id}>
              <span>{item.docId ?? '—'}</span>
              <NotionLink item={item}>{item.name}</NotionLink>
              <span>{item.domain||'—'}</span>
              <span>{item.type||'—'}</span>
              <span>{item.owner||'—'}</span>
              <Badge>{item.status}</Badge>
              <span>{item.reviewCycle||'—'}</span>
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
          minWidth={1640}
          columns="minmax(220px,1.8fr) minmax(130px,1fr) minmax(140px,1.1fr) minmax(150px,1.2fr) minmax(120px,.9fr) minmax(130px,1fr) 110px minmax(120px,1fr) 110px"
          head={<><span>{ropa.columns?.title || 'Processing Activity'}</span><span>{ropa.columns?.subjects || 'Data Subjects'}</span><span>{ropa.columns?.personalData || 'Personal Data'}</span><span>{ropa.columns?.purpose || 'Purpose'}</span><span>{ropa.columns?.basis || 'Lawful Basis'}</span><span>{ropa.columns?.systems || 'Systems'}</span><span>{ropa.columns?.retention || 'Retention'}</span><span>{ropa.columns?.owner || 'Owner'}</span><span>{ropa.columns?.flag || 'Flag'}</span></>}
          row={item => (
            <div className="table-row ropa-table-row" key={item.id}>
              <NotionLink item={item}>{item.name}</NotionLink>
              <span>{item.subjects||'—'}</span>
              <span>{item.personalData||'—'}</span>
              <span>{item.purpose||'—'}</span>
              <span>{item.basis||'—'}</span>
              <span>{item.systems||'—'}</span>
              <span>{item.retention||'—'}</span>
              <span>{item.owner||'—'}</span>
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
          minWidth={1220}
          columns="minmax(220px,1.8fr) 1fr 1fr .9fr .9fr .9fr .9fr"
          head={<><span>{tools.columns?.title || 'Tool / Supplier'}</span><span>{tools.columns?.category || 'Category'}</span><span>{tools.columns?.owner || 'Owner'}</span><span>{tools.columns?.criticality || 'Criticality'}</span><span>{tools.columns?.dpa || 'DPA'}</span><span>{tools.columns?.mfa || 'MFA'}</span><span>{tools.columns?.reviewDate || 'Next Review'}</span></>}
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
                <ScrollTable items={retired} minWidth={1220} columns="minmax(220px,1.8fr) 1fr 1fr .9fr .9fr .9fr .9fr" head={<><span>{tools.columns?.title || 'Tool / Supplier'}</span><span>{tools.columns?.category || 'Category'}</span><span>{tools.columns?.owner || 'Owner'}</span><span>{tools.columns?.criticality || 'Criticality'}</span><span>{tools.columns?.dpa || 'DPA'}</span><span>{tools.columns?.mfa || 'MFA'}</span><span>{tools.columns?.reviewDate || 'Next Review'}</span></>} row={ToolRow} />
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

    /* live risk profile */
    .risk-profile-panel { padding-bottom: 18px; }
    .risk-profile-summary { border-bottom: 1px solid #e0e6e1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-bottom: 16px; }
    .risk-profile-summary > div, .risk-profile-summary > button { align-items: center; background: transparent; border: 0; border-left: 1px solid #e0e6e1; display: flex; justify-content: space-between; padding: 11px 14px; text-align: left; }
    .risk-profile-summary > :first-child { border-left: 0; }
    .risk-profile-summary > button:hover { background: #f4f8f4; }
    .risk-profile-summary span { color: #60726b; display: block; font-size: 10px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
    .risk-profile-summary small { color: #8a9690; font-size: 9px; font-weight: 500; }
    .risk-profile-summary strong { font-size: 22px; letter-spacing: -.05em; }
    .risk-profile-summary .critical strong { color: #ac483d; }
    .risk-profile-summary .attention strong { color: #a36c24; }
    .risk-profile-summary .good strong { color: #3e7e56; }
    .risk-profile-body { align-items: end; display: grid; gap: 20px; grid-template-columns: minmax(360px, 1.35fr) minmax(220px, .65fr); }
    .risk-matrix-label { color: #7c8983; font-size: 9px; font-weight: 600; letter-spacing: .08em; margin-bottom: 7px; text-transform: uppercase; }
    .risk-matrix { display: grid; gap: 5px; grid-template-columns: 90px repeat(3, minmax(62px, 1fr)); }
    .matrix-heading { align-items: center; color: #60726b; display: flex; font-size: 9px; font-weight: 600; justify-content: center; letter-spacing: .06em; min-height: 22px; text-transform: uppercase; }
    .matrix-row-heading { justify-content: flex-start; }
    .risk-matrix-cell { align-items: center; border: 1px solid transparent; display: flex; flex-direction: column; justify-content: center; min-height: 54px; padding: 5px; }
    button.risk-matrix-cell { cursor: pointer; }
    button.risk-matrix-cell:hover { border-color: #31594f; box-shadow: inset 0 0 0 1px #31594f; }
    .risk-matrix-cell strong { font-size: 17px; letter-spacing: -.04em; }
    .risk-matrix-cell span { color: currentColor; font-size: 9px; opacity: .7; }
    .risk-matrix-cell.score-critical { background: #fae9e5; color: #ac483d; }
    .risk-matrix-cell.score-attention { background: #fbf0db; color: #a36c24; }
    .risk-matrix-cell.score-good { background: #e7f2eb; color: #3e7e56; }
    .risk-lifecycle { border-left: 1px solid #e0e6e1; display: grid; gap: 10px; padding: 3px 0 3px 20px; }
    .risk-lifecycle span { align-items: center; color: #60726b; display: flex; font-size: 11px; justify-content: space-between; }
    .risk-lifecycle strong { color: #19332d; font-size: 18px; letter-spacing: -.04em; }
    .score-value { font-size: 13px; text-align: center; }
    .score-value.score-high { color: #ac483d; }
    .score-value.score-elevated { color: #a36c24; }
    .score-value.score-good { color: #3e7e56; }

    /* tables + pagination */
    .table-scroll { border: 1px solid #e4e9e6; overflow-x: auto; }
    .table-scroll::-webkit-scrollbar { height: 6px; }
    .table-scroll::-webkit-scrollbar-track { background: #f0f4f0; }
    .table-scroll::-webkit-scrollbar-thumb { background: #b0c0b8; border-radius: 3px; }
    .data-table { min-width: 810px; }
    .table-head, .table-row { display: grid; gap: 10px; grid-template-columns: var(--table-columns, minmax(220px, 2fr) repeat(6, minmax(110px, 1fr))); padding: 9px 8px; }
    .table-head { background: #f0f4f0; color: #587168; font-size: 9px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
    .table-row { align-items: center; border-bottom: 1px solid #e4e9e6; color: #5e7068; font-size: 11px; min-height: 48px; }
    .table-row:hover { background: #f4f8f4; }
    .table-pagination { align-items: center; color: #6f7f78; display: flex; font-size: 10px; justify-content: space-between; gap: 12px; padding: 10px 2px 0; }
    .page-controls { display: flex; gap: 4px; max-width: 60%; overflow-x: auto; padding-bottom: 2px; }
    .page-controls button { background: #fffdf8; border: 1px solid #ced8d2; color: #486058; flex: 0 0 auto; font-size: 10px; line-height: 1; min-width: 27px; padding: 6px 8px; }
    .page-controls button:hover:not(:disabled), .page-controls button.current { background: #31594f; border-color: #31594f; color: #fff; }
    .page-controls button:disabled { cursor: not-allowed; opacity: .4; }

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
    .workflow-panel { min-height: 0; padding-bottom: 12px; }
    .workflow-groups { align-items: start; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 20px; }
    .wf-group-col { align-self: start; min-width: 0; }
    .wf-group-label { color: #839089; font-size: 9px; font-weight: 600; letter-spacing: .09em; margin: 12px 0 6px; text-transform: uppercase; }
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
      .risk-profile-body { grid-template-columns: 1fr; }
      .risk-lifecycle { border-left: 0; border-top: 1px solid #e0e6e1; grid-template-columns: repeat(3, 1fr); padding: 12px 0 0; }
      .workflow-groups { grid-template-columns: repeat(2, minmax(0, 1fr)); }
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
      .risk-profile-summary { grid-template-columns: 1fr; }
      .risk-profile-summary > div, .risk-profile-summary > button { border-left: 0; border-top: 1px solid #e0e6e1; }
      .risk-profile-summary > :first-child { border-top: 0; }
      .risk-profile-body { gap: 14px; }
      .risk-matrix { grid-template-columns: 72px repeat(3, minmax(52px, 1fr)); }
      .risk-lifecycle { grid-template-columns: 1fr; }
      .panel { padding: 0 14px 14px; }
      .panel-heading span { display: none; }
      .workflow-groups { grid-template-columns: 1fr; }
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
  const [health, setHealth] = useState({})
  const inFlight = useRef(false)

  const load = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    const keys = ['risks','controls','tracker','documents','ropa','tools']
    const results = await Promise.allSettled(keys.map(get))
    const now = new Date()
    setData(previous => Object.fromEntries(keys.map((key, i) => [key, results[i].status === 'fulfilled' ? results[i].value : previous[key]])))
    setHealth(previous => Object.fromEntries(keys.map((key, i) => [key, results[i].status === 'fulfilled' ? { updated: now.toISOString(), error: false } : { ...previous[key], error: true }])))
    const failed = keys.filter((_,i) => results[i].status === 'rejected')
    setError(failed.length ? `Refresh failed: ${failed.join(', ')}. Last available records are retained; unavailable sources have no data.` : '')
    if (!failed.length) setSynced(now)
    setLoading(false)
    inFlight.current = false
  }, [])
  useEffect(() => {
    load()
    const timer = setInterval(() => { if (!document.hidden) load() }, 60000)
    const resume = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', resume)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', resume) }
  }, [load])

  // Deduplicated person list — no duplicates from "Dr Kate McAlpine" vs "Kate McAlpine"
  const personOptions = useMemo(() => {
    const raw = Object.values(data).flatMap(e => e?.items||[]).flatMap(i => i.owner?.split(',').map(n=>n.trim())||[]).filter(Boolean)
    return dedupeNames(raw)
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
    const ti = (data.tracker?.items||[]).filter(only).map(item => !['Done','Skipped'].includes(item.status) && overdue(item.dueDate, localDay()) ? { ...item, status: 'Overdue' } : item)
    const di = (data.documents?.items||[]).filter(only)
    const pi = (data.ropa?.items||[]).filter(only)
    const oi = (data.tools?.items||[]).filter(only)
    const pending = ti.filter(i=>i.dueDate&&!['Done','Skipped'].includes(i.status)).sort((a,b)=>a.dueDate.localeCompare(b.dueDate))
    return {
      risks: { ...data.risks, history: (data.risks?.history || []).map(day => ({ ...day, items: day.items.filter(only) })), total:ri.length, items:ri, byProbability:count(ri,'probability',['High','Medium','Low']), byCategory:count(ri,'category',['Open','Addressed','Ongoing','Closed']), byDomain:Object.fromEntries(Object.entries(data.risks?.byDomain||{}).map(([d])=>[d,ri.filter(i=>i.domain===d).length])) },
      controls: { ...data.controls, total:ci.length, items:ci, byStatus:count(ci,'status',['Active','Partial','Planned','Not In Place']) },
      tracker: { ...data.tracker, total:ti.length, items:ti, byStatus:count(ti,'status',['Done','In Progress','To Do','Overdue','Skipped']), upcoming:pending.slice(0,5) },
      documents: { ...data.documents, total:di.length, items:di, byStatus:Object.fromEntries(Object.keys(data.documents?.byStatus||{}).map(s=>[s,di.filter(i=>i.status===s).length])) },
      ropa: { ...data.ropa, total:pi.length, items:pi, byFlag:pi.reduce((r,i)=>i.flag?{...r,[i.flag]:(r[i.flag]||0)+1}:r,{}) },
      tools: { ...data.tools, total:oi.length, items:oi },
    }
  }, [data, person])

  const tabs = [
    ['overview','Live monitoring'],
    ['actions','My Actions'],
    ['reviews','Review Calendar'],
    ['risks','Risk Register'],
    ['controls','Controls'],
    ['safeguarding','Safeguarding'],
    ['documents','Document Library'],
    ['ropa','RoPA'],
    ['tools','IT Tools'],
  ]

  const open = (nextTab, nextFilter='all') => { setTab(nextTab); setFilter(nextFilter) }

  const view =
    tab==='overview'     ? <LiveOverview {...scoped} health={health} onOpen={open} />
    : tab==='actions'    ? <MyActions tracker={scoped.tracker} risks={scoped.risks} controls={scoped.controls} health={health} filter={filter} onFilter={setFilter} />
    : tab==='reviews'    ? <ReviewCalendar risks={scoped.risks} controls={scoped.controls} health={health} />
    : tab==='risks'      ? <RiskRegister risks={scoped.risks} filter={filter} onFilter={setFilter} />
    : tab==='controls'   ? <Controls controls={scoped.controls} filter={filter} onFilter={setFilter} />
    : tab==='safeguarding'?<Safeguarding tracker={scoped.tracker} risks={scoped.risks} controls={scoped.controls} />
    : tab==='documents'  ? <DocumentLibrary documents={scoped.documents} filter={filter} onFilter={setFilter} />
    : tab==='ropa'       ? <RoPA ropa={scoped.ropa} filter={filter} onFilter={setFilter} />
    : <ITTools tools={scoped.tools} filter={filter} onFilter={setFilter} />

  return (
    <>
      <DashboardStyles />
      <style>{".monitor { --ink:#193c34; --muted:#73837e; }\n.monitor-title { display:flex; justify-content:space-between; align-items:center; gap:20px; margin-bottom:26px; }\n.monitor-kicker { font-size:10px; letter-spacing:.16em; font-weight:600; color:#75867e; }\n.monitor-title h1 { font-size:36px; letter-spacing:-1.5px; margin:8px 0; font-weight:500; }\n.monitor-title p,.posture p { color:#73837e; font-size:13px; margin:5px 0; }\n.monitor-title label { display:grid; gap:8px; font-size:11px; color:#73837e; }\n.monitor-title select { min-width:180px; padding:10px 12px; border:1px solid #d7dfda; background:#fff; color:#193c34; border-radius:6px; }\n.posture { display:flex; align-items:center; gap:16px; padding:20px 24px; background:#edf2eb; border:1px solid #d7e1d4; border-radius:8px; margin-bottom:20px; }\n.posture.uncertain { background:#fff4e2; border-color:#ebd9b9; }\n.posture-icon { font-size:28px; color:#9b7029; }\n.posture strong { font-size:15px; }.posture-date { margin-left:auto; font-size:11px; color:#64776c; }\n.monitor-metrics { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-bottom:24px; }\n.monitor-metrics button { border:1px solid #dfe5df; border-radius:8px; background:#fff; text-align:left; padding:20px; color:#193c34; }\n.monitor-metrics button.is-selected { border-color:#638273; box-shadow:0 0 0 1px #638273; }\n.monitor-metrics button>span { display:flex; justify-content:space-between; font-size:12px; }.monitor-metrics strong { display:block; font-size:36px; font-weight:500; margin:16px 0 10px; }.monitor-metrics small { color:#7b877f; font-size:10px; }\n.monitor .danger { color:#af5141; }.monitor .amber { color:#9d722b; }\n.monitor-grid { display:grid; grid-template-columns:1.05fr 1fr; gap:24px; margin-bottom:24px; }\n.monitor-panel { background:#fff; border:1px solid #dfe5df; border-radius:8px; padding:24px; min-width:0; }\n.monitor-panel header { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:18px; }.monitor-panel h2 { font-size:19px; font-weight:500; margin:6px 0 0; letter-spacing:-.5px; }.subtle { font-size:11px; color:#7b877f; line-height:1.6; }\n.live-matrix { display:grid; grid-template-columns:90px repeat(3,1fr); gap:7px; margin:18px 0; }.axis { font-size:10px; color:#73837e; align-self:center; text-align:center; }.heat { min-height:65px; border:2px solid transparent; border-radius:5px; }.heat strong { display:block; font-size:22px; font-weight:500; }.heat small { font-size:9px; opacity:.7; }.heat-low { background:#e7efe5; color:#496e45; }.heat-medium { background:#f8edcf; color:#9d722b; }.heat-high { background:#f4dcd6; color:#af5141; }.heat-selected,.heat:hover { border-color:#31594f; }.matrix-legend { display:flex; justify-content:flex-end; gap:14px; font-size:10px; color:#73837e; }\n.text-button { border:0; background:none; color:#31594f; font-size:11px; padding:4px; }.exposure-list { max-height:330px; overflow:auto; }.exposure-list button { display:block; width:100%; border:0; border-bottom:1px solid #eef0ec; background:transparent; text-align:left; padding:13px 0; color:#193c34; }.exposure-list button>div:first-child { display:flex; justify-content:space-between; font-size:12px; }.exposure-list small { font-size:10px; color:#7b877f; font-weight:400; }.exposure-track { height:5px; background:#eef1eb; margin:9px 0 5px; border-radius:5px; }.exposure-track i { display:block; height:100%; background:#6d8e77; border-radius:5px; }\n.watch-tabs { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:20px; }.watch-tabs button { border:1px solid #e0e5df; background:#fff; border-radius:5px; color:#73837e; padding:8px 12px; font-size:11px; }.watch-tabs button.selected { background:#193c34; color:white; border-color:#193c34; }.watch-scroll { overflow-x:auto; }.watch-scroll table { width:100%; border-collapse:collapse; text-align:left; min-width:640px; }.watch-scroll th { background:#f6f8f4; font-size:9px; text-transform:uppercase; letter-spacing:.08em; padding:12px; color:#73837e; font-weight:500; }.watch-scroll td { padding:16px 12px; border-bottom:1px solid #eef0ec; font-size:11px; color:#73837e; }.watch-scroll td:first-child { width:40%; }.watch-scroll a { color:#193c34; text-decoration:none; font-weight:500; }.watch-scroll a:hover { text-decoration:underline; }.monitor-pill { display:inline-block; background:#f2f4ee; border-radius:4px; padding:5px 8px; font-size:10px; }\n.source-health { display:flex; flex-wrap:wrap; gap:22px; margin-top:24px; padding:20px 0; }.source-health>div { display:flex; align-items:center; gap:7px; font-size:10px; color:#526b5e; }.source-health>div:first-child { display:grid; margin-right:auto; }.source-health small { display:block; font-size:9px; color:#7b877f; margin-top:5px; }.source-health>div:first-child span { font-size:9px; color:#7b877f; }.source-dot { width:6px; height:6px; border-radius:50%; background:#6b9371; }.source-dot.failed { background:#ba654d; }.source-dot.pending { background:#aaa; }\n.refresh-button { border:1px solid #758e83; border-radius:5px; background:transparent; color:#fff; padding:7px 10px; font-size:11px; }.refresh-button:disabled { opacity:.5; cursor:wait; }.sync-status { color:#c6d5ca; font-size:10px; }\nbutton:focus-visible,a:focus-visible,select:focus-visible { outline:2px solid #c59a47; outline-offset:3px; }\n@media(max-width:950px) { .monitor-metrics { grid-template-columns:repeat(2,1fr); }.monitor-grid { grid-template-columns:1fr; } }\n@media(max-width:560px) { .monitor-title { align-items:flex-start; flex-direction:column; }.monitor-title h1 { font-size:30px; }.monitor-metrics { gap:10px; }.monitor-metrics button { padding:14px; }.monitor-metrics strong { font-size:30px; }.posture-date { display:none; }.monitor-panel { padding:16px; }.live-matrix { grid-template-columns:65px repeat(3,1fr); }.header-actions { flex-wrap:wrap; }.monitor-panel header { flex-wrap:wrap; } }\n.trend-panel { margin-bottom:24px; }\n.trend-range { margin:0; }\n.trend-summary { display:grid; grid-template-columns:repeat(3,1fr); gap:24px; padding:16px 0 22px; border-bottom:1px solid #e4e9e2; }\n.trend-summary strong { display:block; font-size:30px; font-weight:500; color:#31594f; margin-bottom:8px; }\n.trend-summary span { display:block; color:#73837e; font-size:11px; line-height:1.6; }\n.trend-charts { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:24px; margin:20px 0; }\n.trend-charts h3 { font-size:12px; font-weight:500; }\n.trend-svg { width:100%; height:auto; display:block; overflow:visible; }\n.trend-svg text { fill:#73837e; font-size:11px; font-family:inherit; }\n.trend-legend { display:flex; gap:12px; flex-wrap:wrap; font-size:10px; color:#73837e; padding-left:7%; }\n.trend-legend span { display:flex; align-items:center; gap:5px; }\n.trend-legend i { height:7px; width:7px; border-radius:50%; }\n.trend-warning { font-size:12px; color:#9d722b; background:#fff4e2; padding:12px; border-radius:5px; }\n.trend-empty { padding:30px 16px; text-align:center; background:#f6f8f4; border-radius:6px; margin:18px 0; }\n.trend-empty strong { font-size:14px; font-weight:500; }.trend-empty p { font-size:12px; color:#73837e; max-width:520px; margin:12px auto 0; line-height:1.7; }\n.trend-details { border-top:1px solid #e4e9e2; padding-top:15px; }.trend-details summary { font-size:11px; cursor:pointer; padding-bottom:12px; }\n@media(max-width:750px) { .trend-charts { grid-template-columns:1fr; }.trend-summary { gap:14px; }.trend-summary strong { font-size:24px; } }\n@media(max-width:420px) { .trend-summary { grid-template-columns:1fr; }.trend-summary>div { display:grid; grid-template-columns:75px 1fr; align-items:center; }.trend-summary strong { margin:0; } }\n.neutral { background:#edf1eb; color:#31594f; }\n\n.review-panel{background:#fff;border:1px solid #dfe5df;border-radius:8px;padding:24px;margin-bottom:24px;color:#193c34}.review-panel h2{font-size:21px;font-weight:500;margin:0 0 10px}.review-panel h3{font-size:16px;font-weight:500}.review-note{font-size:12px;color:#63776e;line-height:1.6}.review-toolbar{display:flex;gap:16px;align-items:center;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap}.review-toolbar button,.review-panel>button,.review-toolbar select{padding:9px 12px;border:1px solid #cad6ce;background:#f7f9f5;border-radius:5px;color:#193c34}.review-toolbar label{font-size:12px}.review-list{list-style:none;padding:0;margin:16px 0}.review-list li{display:flex;gap:16px;justify-content:space-between;align-items:center;padding:13px 0;border-bottom:1px solid #e7ece6;font-size:13px}.review-list a{color:#193c34;text-decoration:none}.review-list a:hover{text-decoration:underline}.review-list small{display:block;color:#64776c;margin-top:6px}.review-list time{white-space:nowrap;font-size:12px}.review-kind{display:inline-block;background:#edf2e9;font-size:10px;padding:3px 6px;border-radius:3px;margin-right:5px}.review-panel details{margin:15px 0}.review-panel summary{cursor:pointer;font-size:13px}.review-grid-scroll{overflow-x:auto}.review-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px;min-width:650px;margin-bottom:24px}.review-day-label{text-align:center;padding:10px;font-size:12px;color:#63776e}.review-day{min-height:120px;text-align:left;background:#fafbf8;border:1px solid #e0e6dc;border-radius:4px;padding:8px;color:#193c34;display:flex;flex-direction:column;gap:6px;overflow:hidden}.review-day.today{border:2px solid #6b896e}.review-day.selected{background:#e7efe1;outline:2px solid #31594f}.review-day span{display:block;font-size:10px;background:#e8eee3;padding:5px;border-radius:3px;overflow-wrap:anywhere}.review-day small{font-size:10px}.review-day strong{font-size:13px}@media(max-width:560px){.review-panel{padding:16px}.review-list li{align-items:flex-start}.review-toolbar{gap:10px}}\n"}</style>
      <main className="hub">
        <header className="site-header">
          <div className="brand"><h1>CONNECT<span>GO</span></h1><p>Governance &amp; Compliance</p></div>
          <div className="header-actions">
            <span className="sync-status" role="status">{loading ? 'Syncing…' : error ? 'Source interruption' : 'Auto-refresh · 60s'}</span>
            <button className="refresh-button" onClick={load} disabled={loading}>↻ Refresh</button>
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
          {error && <div className="notice" role="alert">{error}</div>}
          {loading && !Object.keys(health).length ? <div className="loading">Loading governance data from Notion…</div> : view}
        </div>
        <footer className="site-footer">ConnectGo Ltd · Confidential</footer>
      </main>
    </>
  )
}



