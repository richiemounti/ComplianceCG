import { useState, useEffect, useCallback } from 'react'

// ── Config ───────────────────────────────────────────────────────

// ── Brand tokens ─────────────────────────────────────────────────
const C = {
  forest:   '#11302A',
  amber:    '#CD8028',
  yellow:   '#F0C71D',
  coral:    '#EE5C5F',
  olive:    '#858755',
  burgundy: '#511433',
  cream:    '#F5F2EC',
  white:    '#FFFFFF',
  positive: '#2d8a4e',
  border:   'rgba(17,48,42,0.09)',
  text:     '#11302A',
  textMid:  'rgba(17,48,42,0.6)',
  textDim:  'rgba(17,48,42,0.38)',
  sg:       "'Space Grotesk', sans-serif",
  ws:       "'Work Sans', sans-serif",
}

// ── Global styles injected once ──────────────────────────────────
const GLOBAL_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #root { background: ${C.cream}; min-height: 100vh; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
  a { color: inherit; }
`

// ── API helpers ──────────────────────────────────────────────────
async function fetchRisks() {
  const res = await fetch('/.netlify/functions/notion?db=risks')
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

async function fetchControls() {
  const res = await fetch('/.netlify/functions/notion?db=controls')
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

async function fetchTracker() {
  const res = await fetch('/.netlify/functions/notion?db=tracker')
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

async function fetchDb(db) {
  const res = await fetch(`/.netlify/functions/notion?db=${db}`)
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

// ── Shared UI primitives ─────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 0' }}>
      <div style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${C.border}`, borderTopColor: C.amber, animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
      <span style={{ fontFamily: C.ws, fontSize: 11, color: C.textDim }}>Loading from Notion…</span>
    </div>
  )
}

function ErrorMsg({ msg }) {
  return (
    <div style={{ background: `${C.coral}10`, border: `1px solid ${C.coral}30`, borderRadius: 4, padding: '10px 12px', fontFamily: C.ws, fontSize: 11, color: C.coral }}>
      {msg}
    </div>
  )
}

function Badge({ label, color = C.amber }) {
  return (
    <span style={{ display: 'inline-block', fontFamily: C.sg, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '3px 7px', borderRadius: 3, background: `${color}18`, color, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

function Dot({ color, size = 6 }) {
  return <div style={{ width: size, height: size, borderRadius: '50%', background: color, flexShrink: 0, marginTop: size === 6 ? 3 : 0 }} />
}

function BarRow({ label, value, max, color = C.amber }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontFamily: C.ws, fontSize: 12, color: C.textMid }}>{label}</span>
        <span style={{ fontFamily: C.sg, fontSize: 12, fontWeight: 600, color: C.text }}>{value}</span>
      </div>
      <div style={{ height: 3, background: 'rgba(17,48,42,0.07)', borderRadius: 2 }}>
        <div style={{ height: 3, width: `${pct}%`, background: color, borderRadius: 2, transition: 'width 1s ease' }} />
      </div>
    </div>
  )
}

function SectionCard({ title, sub, children, style = {} }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 4, padding: '22px 24px', ...style }}>
      <div style={{ fontFamily: C.sg, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.text, marginBottom: 3 }}>{title}</div>
      {sub && <div style={{ fontFamily: C.ws, fontSize: 11, color: C.textDim, marginBottom: 18 }}>{sub}</div>}
      {children}
    </div>
  )
}

function KpiCard({ label, value, sub, badge, badgeColor, topColor = C.amber, loading, error }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 4, padding: '20px 22px', position: 'relative', overflow: 'hidden', animation: 'fadeUp 0.4s ease both' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: topColor }} />
      <div style={{ fontFamily: C.sg, fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: C.textDim, marginBottom: 7 }}>{label}</div>
      {loading ? <Spinner /> : error ? <ErrorMsg msg={error} /> : (
        <>
          <div style={{ fontFamily: C.sg, fontSize: 30, fontWeight: 700, color: C.text, lineHeight: 1, marginBottom: 5 }}>{value ?? '—'}</div>
          <div style={{ fontFamily: C.ws, fontSize: 11, color: C.textMid }}>{sub}</div>
          {badge && <div style={{ marginTop: 8 }}><Badge label={badge} color={badgeColor || topColor} /></div>}
        </>
      )}
    </div>
  )
}

function RowItem({ name, meta, badge, badgeColor, last = false }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: last ? 'none' : '1px solid rgba(17,48,42,0.06)', gap: 8 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: C.ws, fontSize: 12, fontWeight: 500, color: C.text, lineHeight: 1.35 }}>{name}</div>
        {meta && <div style={{ fontFamily: C.ws, fontSize: 10, color: C.textDim, marginTop: 2 }}>{meta}</div>}
      </div>
      {badge && <Badge label={badge} color={badgeColor} />}
    </div>
  )
}

function DonutRing({ pct, color, size = 100 }) {
  const r = (size - 10) / 2
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(17,48,42,0.07)" strokeWidth={9} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={9}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 1.2s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: C.sg, fontSize: 17, fontWeight: 700, color, lineHeight: 1 }}>{pct}%</span>
        <span style={{ fontFamily: C.ws, fontSize: 8, color: C.textDim, letterSpacing: '0.05em', textTransform: 'uppercase', marginTop: 2 }}>Active</span>
      </div>
    </div>
  )
}

function RegisterTab({ title, sub, data, loading, error, owner, fields }) {
  // RoPA and some IT-tool records do not have a person owner. Keep those
  // visible when filtering rather than incorrectly showing an empty register.
  const items = (data?.items || []).filter(item => owner === 'All people' || !item.owner || item.owner.includes(owner))
  if (loading) return <SectionCard title={title}><Spinner /></SectionCard>
  if (error) return <SectionCard title={title}><ErrorMsg msg={error} /></SectionCard>
  return <SectionCard title={title} sub={sub}>
    {!items.length ? <p style={{ fontFamily: C.ws, fontSize: 12, color: C.textDim }}>No matching records</p> : items.map((item, i) => (
      <a key={item.id} href={item.url} target="_blank" rel="noreferrer" style={{ display: 'grid', gridTemplateColumns: `minmax(220px, 2fr) repeat(${fields.length - 1}, minmax(100px, 1fr))`, gap: 12, padding: '11px 0', borderBottom: i < items.length - 1 ? `1px solid ${C.border}` : 'none', textDecoration: 'none' }}>
        <span style={{ fontFamily: C.ws, fontSize: 12, fontWeight: 600, color: C.text }}>{item.name} ↗</span>
        {fields.slice(1).map(field => <span key={field} style={{ fontFamily: C.ws, fontSize: 11, color: C.textMid }}>{item[field] || '—'}</span>)}
      </a>
    ))}
  </SectionCard>
}

function RegisterProgress({ title, items, definitions }) {
  const total = items?.length || 0
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: 12, marginBottom: 14 }}>
    {definitions.map(({ label, test, color }) => {
      const count = (items || []).filter(test).length
      return <div key={label} style={{ background: C.white, border: `1px solid ${C.border}`, borderTop: `3px solid ${color}`, borderRadius: 4, padding: '15px 17px' }}>
        <div style={{ fontFamily: C.sg, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: C.textDim }}>{label}</div>
        <div style={{ fontFamily: C.sg, fontSize: 25, fontWeight: 700, color: C.text, margin: '7px 0 3px' }}>{count}</div>
        <div style={{ fontFamily: C.ws, fontSize: 10, color: C.textDim }}>{total} total records</div>
      </div>
    })}
  </div>
}

// ── Tab panels ───────────────────────────────────────────────────

function OverviewTab({ risks, controls, tracker, loading, errors }) {
  const r = risks || {}
  const c = controls || {}
  const t = tracker || {}

  const highN        = r.byProbability?.High ?? 0
  const openN        = r.byCategory?.Open ?? 0
  const inActiveN    = c.byStatus?.Active ?? 0
  const controlPct   = c.total > 0 ? Math.round((inActiveN / c.total) * 100) : 0
  const doneN        = t.byStatus?.Done ?? 0
  const overdueN     = t.byStatus?.Overdue ?? 0
  const denom        = (t.total || 0) - (t.byStatus?.Skipped || 0)
  const completionPct = denom > 0 ? Math.round((doneN / denom) * 100) : 0

  const upcoming = t.upcoming || []

  return (
    <div>
      <div style={{ fontFamily: C.sg, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.textDim, marginBottom: 14 }}>
        KEY INDICATORS — {new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }).toUpperCase()}
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard label="Total Risks" value={r.total} sub="Unified risk register" topColor={C.forest} loading={loading.risks} error={errors.risks} />
        <KpiCard label="High Probability" value={highN} sub="Requiring attention"
          topColor={highN > 0 ? C.coral : C.positive}
          badge={highN > 0 ? 'Action needed' : 'Under control'}
          badgeColor={highN > 0 ? C.coral : C.positive}
          loading={loading.risks} error={errors.risks} />
        <KpiCard label="Open Risks" value={openN} sub="Awaiting mitigation" topColor={C.amber} loading={loading.risks} error={errors.risks} />
        <KpiCard label="Controls Active" value={c.total ? `${controlPct}%` : null} sub={c.total ? `${inActiveN} of ${c.total} controls` : ''}
          topColor={controlPct >= 80 ? C.positive : controlPct >= 50 ? C.amber : C.coral}
          badge={controlPct >= 80 ? 'Strong coverage' : controlPct >= 50 ? 'Partial coverage' : 'Gaps present'}
          badgeColor={controlPct >= 80 ? C.positive : controlPct >= 50 ? C.amber : C.coral}
          loading={loading.controls} error={errors.controls} />
        <KpiCard label="Activities Done" value={t.total ? `${completionPct}%` : null} sub={t.total ? `${doneN} of ${denom} activities` : ''}
          topColor={completionPct >= 70 ? C.positive : completionPct >= 40 ? C.amber : C.coral}
          loading={loading.tracker} error={errors.tracker} />
        <KpiCard label="Overdue" value={overdueN} sub="Past due date"
          topColor={overdueN > 0 ? C.coral : C.positive}
          badge={overdueN > 0 ? 'Action needed' : 'All on track'}
          badgeColor={overdueN > 0 ? C.coral : C.positive}
          loading={loading.tracker} error={errors.tracker} />
      </div>

      {/* Safeguarding status strip */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: C.sg, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.textDim, marginBottom: 10 }}>SAFEGUARDING STATUS</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          {[
            { label: 'SFP Appointed', value: 'Pending', sub: 'Sumaiya Karim — in progress', color: C.coral },
            { label: 'Incidents YTD', value: '0 reported', sub: `Jan – ${new Date().toLocaleDateString('en-GB',{month:'short'})} ${new Date().getFullYear()}`, color: C.positive },
            { label: 'Code of Conduct', value: 'Not verified', sub: 'Sign-off status unconfirmed', color: C.amber },
            { label: 'Mandatory Training', value: 'Not verified', sub: 'Completion rate unknown', color: C.amber },
          ].map(({ label, value, sub, color }) => (
            <div key={label} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 4, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <Dot color={color} size={10} />
              <div>
                <div style={{ fontFamily: C.sg, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.textDim, marginBottom: 3 }}>{label}</div>
                <div style={{ fontFamily: C.sg, fontSize: 13, fontWeight: 600, color }}>{value}</div>
                <div style={{ fontFamily: C.ws, fontSize: 10, color: C.textDim }}>{sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Lower grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <SectionCard title="Risk Register — By Domain" sub={r.total ? `${r.total} total risks across all domains` : ' '}>
          {loading.risks ? <Spinner /> : errors.risks ? <ErrorMsg msg={errors.risks} /> :
            Object.entries(r.byDomain || {}).filter(([,v]) => v > 0).map(([k, v]) =>
              <BarRow key={k} label={k} value={v} max={r.total} color={C.forest} />
            )
          }
        </SectionCard>

        <SectionCard title="Upcoming Deadlines" sub="Next activities due">
          {loading.tracker ? <Spinner /> : errors.tracker ? <ErrorMsg msg={errors.tracker} /> :
            !upcoming.length
              ? <p style={{ fontFamily: C.ws, fontSize: 12, color: C.textDim }}>No upcoming items</p>
              : upcoming.map((item, i) => {
                  const isOverdue = item.status === 'Overdue'
                  const sc = isOverdue ? C.coral : item.status === 'In Progress' ? C.amber : 'rgba(17,48,42,0.25)'
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: i < upcoming.length - 1 ? '1px solid rgba(17,48,42,0.06)' : 'none', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flex: 1 }}>
                        <Dot color={sc} />
                        <div>
                          <div style={{ fontFamily: C.ws, fontSize: 12, fontWeight: 500, color: C.text, lineHeight: 1.35 }}>{item.name}</div>
                          <div style={{ fontFamily: C.ws, fontSize: 10, color: C.textDim, marginTop: 2 }}>{item.dueDate} · {item.owner}</div>
                        </div>
                      </div>
                      <Badge label={item.status} color={sc} />
                    </div>
                  )
                })
          }
        </SectionCard>
      </div>
    </div>
  )
}

function RisksTab({ risks, loading, errors }) {
  const r = risks || {}
  if (loading.risks) return <SectionCard title="Risk Register"><Spinner /></SectionCard>
  if (errors.risks)  return <SectionCard title="Risk Register"><ErrorMsg msg={errors.risks} /></SectionCard>

  return (
    <div>
      <SectionCard title="Risk Register — Domain Breakdown" sub={`${r.total} total risks · Live from Notion`} style={{ marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
          {Object.entries(r.byDomain || {}).map(([domain, count]) => {
            const pct = r.total > 0 ? Math.round((count / r.total) * 100) : 0
            return (
              <div key={domain} style={{ background: C.cream, borderRadius: 4, padding: '14px 16px' }}>
                <div style={{ fontFamily: C.sg, fontSize: 8, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.textDim, marginBottom: 6 }}>{domain}</div>
                <div style={{ fontFamily: C.sg, fontSize: 26, fontWeight: 700, color: C.text, lineHeight: 1 }}>{count}</div>
                <div style={{ fontFamily: C.ws, fontSize: 10, color: C.textDim, marginTop: 3 }}>{pct}% of total</div>
                <div style={{ height: 3, background: 'rgba(17,48,42,0.07)', borderRadius: 2, marginTop: 8 }}>
                  <div style={{ height: 3, width: `${pct}%`, background: C.amber, borderRadius: 2, transition: 'width 1s ease' }} />
                </div>
              </div>
            )
          })}
        </div>
      </SectionCard>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
        {[
          { title: 'Probability', items: [
            { label: 'High', value: r.byProbability?.High ?? 0, color: C.coral },
            { label: 'Medium', value: r.byProbability?.Medium ?? 0, color: C.amber },
            { label: 'Low', value: r.byProbability?.Low ?? 0, color: C.positive },
          ]},
          { title: 'Category', items: [
            { label: 'Open', value: r.byCategory?.Open ?? 0, color: C.amber },
            { label: 'Addressed', value: r.byCategory?.Addressed ?? 0, color: C.olive },
            { label: 'Closed', value: r.byCategory?.Closed ?? 0, color: C.positive },
          ]},
          { title: 'Control Status', items: [
            { label: 'In Place', value: r.byControlStatus?.['In Place'] ?? 0, color: C.positive },
            { label: 'Partial', value: r.byControlStatus?.Partial ?? 0, color: C.amber },
            { label: 'Not In Place', value: r.byControlStatus?.['Not In Place'] ?? 0, color: C.coral },
          ]},
        ].map(({ title, items }) => (
          <SectionCard key={title} title={title} sub=" ">
            {items.map(({ label, value, color }, i) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: i < items.length - 1 ? '1px solid rgba(17,48,42,0.06)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Dot color={color} size={8} />
                  <span style={{ fontFamily: C.ws, fontSize: 13, color: C.text }}>{label}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: C.sg, fontSize: 20, fontWeight: 700, color }}>{value}</span>
                  <Badge label={`${r.total > 0 ? Math.round((value/r.total)*100) : 0}%`} color={color} />
                </div>
              </div>
            ))}
          </SectionCard>
        ))}
      </div>
    </div>
  )
}

function ControlsTab({ controls, loading, errors }) {
  const c = controls || {}
  if (loading.controls) return <SectionCard title="Controls"><Spinner /></SectionCard>
  if (errors.controls)  return <SectionCard title="Controls"><ErrorMsg msg={errors.controls} /></SectionCard>

  const activeN = c.byStatus?.Active ?? 0
  const pct = c.total > 0 ? Math.round((activeN / c.total) * 100) : 0
  const ringColor = pct >= 80 ? C.positive : pct >= 50 ? C.amber : C.coral

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      <SectionCard title="Controls Coverage" sub={`${c.total} controls registered`}>
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          <DonutRing pct={pct} color={ringColor} />
          <div style={{ flex: 1 }}>
            {Object.entries(c.byStatus || {}).map(([status, count]) => {
              const col = status === 'Active' ? C.positive : status === 'Partial' ? C.amber : status === 'Planned' ? C.olive : C.coral
              return <BarRow key={status} label={status} value={count} max={c.total} color={col} />
            })}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Controls — By Domain" sub={`${c.total} controls across domains`}>
        {Object.entries(c.byDomain || {}).map(([domain, count]) =>
          <BarRow key={domain} label={domain} value={count} max={c.total} color={C.forest} />
        )}
        <div style={{ background: C.cream, borderRadius: 4, padding: '12px 14px', marginTop: 16 }}>
          <div style={{ fontFamily: C.sg, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.textDim, marginBottom: 8 }}>Status legend</div>
          {[
            { label: 'Active — fully implemented', color: C.positive },
            { label: 'Partial — partially implemented', color: C.amber },
            { label: 'Planned — scheduled', color: C.olive },
            { label: 'Not In Place — gap present', color: C.coral },
          ].map(({ label, color }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
              <Dot color={color} />
              <span style={{ fontFamily: C.ws, fontSize: 11, color: C.textMid }}>{label}</span>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  )
}

function RhythmTab({ tracker, loading, errors }) {
  const t = tracker || {}
  if (loading.tracker) return <SectionCard title="Compliance Rhythm"><Spinner /></SectionCard>
  if (errors.tracker)  return <SectionCard title="Compliance Rhythm"><ErrorMsg msg={errors.tracker} /></SectionCard>

  const done        = t.byStatus?.Done ?? 0
  const inProgress  = t.byStatus?.['In Progress'] ?? 0
  const overdue     = t.byStatus?.Overdue ?? 0
  const notStarted  = t.byStatus?.['To Do'] ?? 0
  const denom       = (t.total || 0) - (t.byStatus?.Skipped || 0)
  const pct         = denom > 0 ? Math.round((done / denom) * 100) : 0
  const rhythmColor = pct >= 70 ? C.positive : pct >= 40 ? C.amber : C.coral
  const upcoming    = t.upcoming || []

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      <SectionCard title="Activity Status" sub={`${t.total} governance activities total`}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 18 }}>
          {[
            { label: 'Done', value: done, color: C.positive },
            { label: 'In Progress', value: inProgress, color: C.amber },
            { label: 'Overdue', value: overdue, color: overdue > 0 ? C.coral : C.textDim },
            { label: 'To Do', value: notStarted, color: C.textDim },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: C.cream, borderRadius: 4, padding: '12px 10px', textAlign: 'center' }}>
              <div style={{ fontFamily: C.sg, fontSize: 24, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
              <div style={{ fontFamily: C.ws, fontSize: 10, color: C.textDim, marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontFamily: C.sg, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.textDim }}>Completion rate</span>
          <span style={{ fontFamily: C.sg, fontSize: 14, fontWeight: 700, color: rhythmColor }}>{pct}%</span>
        </div>
        <div style={{ height: 5, background: 'rgba(17,48,42,0.07)', borderRadius: 3 }}>
          <div style={{ height: 5, width: `${pct}%`, background: rhythmColor, borderRadius: 3, transition: 'width 1.2s ease' }} />
        </div>
      </SectionCard>

      <SectionCard title="Upcoming Deadlines" sub="Next 5 activities due">
        {!upcoming.length
          ? <p style={{ fontFamily: C.ws, fontSize: 12, color: C.textDim }}>Nothing upcoming</p>
          : upcoming.map((item, i) => {
              const isOverdue = item.status === 'Overdue'
              const sc = isOverdue ? C.coral : item.status === 'In Progress' ? C.amber : 'rgba(17,48,42,0.25)'
              return (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: i < upcoming.length - 1 ? '1px solid rgba(17,48,42,0.06)' : 'none', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: C.ws, fontSize: 12, fontWeight: 500, color: C.text }}>{item.name}</div>
                    <div style={{ fontFamily: C.ws, fontSize: 10, color: C.textDim, marginTop: 2 }}>{item.dueDate} · {item.owner}</div>
                  </div>
                  <Badge label={item.status} color={sc} />
                </div>
              )
            })
        }
      </SectionCard>
    </div>
  )
}

function SafeguardingTab({ risks, loading, errors }) {
  const r = risks || {}
  const sgRisks = [
    { name: 'Vacant safeguarding lead — governance gap', meta: 'Probability: High · Consequences: Major', badge: 'Open · High', color: C.coral },
    { name: 'Safeguarding incident during field research', meta: 'Probability: Medium · Consequences: Major', badge: 'Open', color: C.amber },
    { name: 'Failure to report safeguarding concerns', meta: 'Probability: Medium · Consequences: Major', badge: 'Open', color: C.amber },
    { name: 'Inconsistent safeguarding training across staff', meta: 'Probability: Medium · Consequences: Moderate', badge: 'Open', color: C.amber },
    { name: 'Inappropriate one-on-one interactions', meta: 'Probability: Low · Consequences: Major', badge: 'Open', color: C.amber },
    { name: 'Publication of images without consent', meta: 'Probability: Low · Consequences: Major', badge: 'Open', color: C.amber },
  ]
  const forms = [
    { icon: '🚨', label: 'Safeguarding Incident Report Form', sub: 'Report within 24 hours', url: 'https://forms.gle/bxUfXpGnETCLXrPf6' },
    { icon: '🔗', label: 'Field Visit Pre-Departure Form', sub: 'Required ≥12 hrs before travel', url: 'https://forms.gle/6KrsSfQYJGxKgidb9' },
    { icon: '🔗', label: 'Code of Conduct Sign-off Form', sub: 'Required for all staff & contractors', url: 'https://forms.gle/TrKsotFPR55ocGeX8' },
    { icon: '🔒', label: 'Anonymous Code of Conduct Breach', sub: 'Confidential reporting channel', url: 'https://docs.google.com/forms/d/e/1FAIpQLSdGLuBYGg6SQyZlseDJzF7mYKQvXXz5NbQIOAlsGlgKEYP3LA/viewform' },
  ]
  const consentForms = [
    { icon: '📸', label: 'General Photo Consent', sub: 'Adults · general use', url: 'https://connect-go.kontainer.com/consent/consent-collections/2184bcbf6b594d889802b4d263482185' },
    { icon: '📸', label: 'Media Consent — Children', sub: 'Required for any child participants', url: 'https://connect-go.kontainer.com/consent/consent-collections/9d58ca5e291a4415a6539009ecdc7705' },
    { icon: '📸', label: 'Media Consent — Adult Researchers', sub: 'Adults in research context', url: 'https://connect-go.kontainer.com/consent/consent-collections/74f7034c2a3f4bc9877ca5d996335819' },
    { icon: '🔗', label: 'Professional Reference Check', sub: 'Recruitment screening', url: 'https://docs.google.com/forms/d/e/1FAIpQLSeo6JzaHUHemAr-YL3VjCUnBok-dLskHIYDgPfktkuGU0ikFg/viewform' },
  ]

  return (
    <div>
      {/* Status cards */}
      <div style={{ fontFamily: C.sg, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.textDim, marginBottom: 10 }}>GOVERNANCE STATUS</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Safeguarding Focal Person', value: 'Sumaiya Karim', sub: 'Appointment in progress', topColor: C.coral, badge: 'Pending formal appointment', badgeColor: C.coral },
          { label: 'Incidents This Year', value: '0', sub: `Jan – ${new Date().toLocaleDateString('en-GB',{month:'short',year:'numeric'})} · No reports`, topColor: C.positive, badge: 'All clear', badgeColor: C.positive },
          { label: 'Code of Conduct Sign-off', value: 'Not verified', sub: 'Status unconfirmed across team', topColor: C.amber, badge: 'Action: confirm with Sumaiya', badgeColor: C.amber },
          { label: 'Mandatory Training', value: 'Not verified', sub: 'Completion rate unknown', topColor: C.amber, badge: 'Action: confirm with Sumaiya', badgeColor: C.amber },
        ].map(({ label, value, sub, topColor, badge, badgeColor }) => (
          <div key={label} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 4, padding: '20px 22px', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: topColor }} />
            <div style={{ fontFamily: C.sg, fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: C.textDim, marginBottom: 7 }}>{label}</div>
            <div style={{ fontFamily: C.sg, fontSize: value.length > 6 ? 16 : 28, fontWeight: 700, color: C.text, lineHeight: 1.1, marginBottom: 5 }}>{value}</div>
            <div style={{ fontFamily: C.ws, fontSize: 11, color: C.textMid, marginBottom: 8 }}>{sub}</div>
            <Badge label={badge} color={badgeColor} />
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* Active risks */}
        <SectionCard title="Safeguarding Risks — Active" sub={`${r.byDomain?.Safeguarding ?? 14} safeguarding risks in register`}>
          {loading.risks ? <Spinner /> : errors.risks ? <ErrorMsg msg={errors.risks} /> :
            sgRisks.map((risk, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: i < sgRisks.length - 1 ? '1px solid rgba(17,48,42,0.06)' : 'none', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: C.ws, fontSize: 12, fontWeight: 500, color: C.text, lineHeight: 1.35 }}>{risk.name}</div>
                  <div style={{ fontFamily: C.ws, fontSize: 10, color: C.textDim, marginTop: 2 }}>{risk.meta}</div>
                </div>
                <Badge label={risk.badge} color={risk.color} />
              </div>
            ))
          }
          <div style={{ marginTop: 10 }}>
            <Badge label="+ 8 further safeguarding risks in register" color={C.textDim} />
          </div>
        </SectionCard>

        {/* Reporting & contacts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SectionCard title="Report an Incident" sub="All incidents must be reported within 24 hours">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {forms.map(({ icon, label, sub, url }) => (
                <a key={label} href={url} target="_blank" rel="noreferrer"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: C.cream, borderRadius: 4, textDecoration: 'none' }}>
                  <span style={{ fontSize: 14 }}>{icon}</span>
                  <div>
                    <div style={{ fontFamily: C.sg, fontSize: 11, fontWeight: 600, color: C.forest }}>{label}</div>
                    <div style={{ fontFamily: C.ws, fontSize: 10, color: C.textDim }}>{sub}</div>
                  </div>
                </a>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Key Contacts" sub="Safeguarding escalation chain">
            {[
              { name: 'Safeguarding Focal Person', meta: 'Sumaiya Karim · appointment in progress', badge: 'Pending', color: C.coral },
              { name: 'Director (escalation)', meta: 'Dr Kate McAlpine · kate@connectgo.co.uk', badge: 'Active', color: C.positive },
              { name: 'DPO (data safeguarding)', meta: 'Belinda Mziray · belinda@connectgo.co.uk', badge: 'Active', color: C.positive },
            ].map((c, i, arr) => (
              <div key={c.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: i < arr.length - 1 ? '1px solid rgba(17,48,42,0.06)' : 'none' }}>
                <div>
                  <div style={{ fontFamily: C.ws, fontSize: 12, fontWeight: 500, color: C.text }}>{c.name}</div>
                  <div style={{ fontFamily: C.ws, fontSize: 10, color: C.textDim, marginTop: 2 }}>{c.meta}</div>
                </div>
                <Badge label={c.badge} color={c.color} />
              </div>
            ))}
          </SectionCard>
        </div>
      </div>

      {/* Consent forms */}
      <SectionCard title="Consent Forms" sub="Required before photography, filming, or data collection" style={{ marginTop: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
          {consentForms.map(({ icon, label, sub, url }) => (
            <a key={label} href={url} target="_blank" rel="noreferrer"
              style={{ padding: '10px 14px', background: C.cream, borderRadius: 4, textDecoration: 'none', display: 'block' }}>
              <div style={{ fontFamily: C.sg, fontSize: 10, fontWeight: 700, color: C.forest, marginBottom: 2 }}>{icon} {label}</div>
              <div style={{ fontFamily: C.ws, fontSize: 10, color: C.textDim }}>{sub}</div>
            </a>
          ))}
        </div>
      </SectionCard>
    </div>
  )
}

// ── Main app ─────────────────────────────────────────────────────

const TABS = [
  { id: 'overview',      label: 'Overview' },
  { id: 'risks',         label: 'Risk Register' },
  { id: 'controls',      label: 'Controls' },
  { id: 'rhythm',        label: 'Compliance Rhythm' },
  { id: 'safeguarding',  label: 'Safeguarding' },
  { id: 'documents',     label: 'Document Library' },
  { id: 'ropa',          label: 'RoPA' },
  { id: 'tools',         label: 'IT Tools' },
]

export default function Dashboard() {
  const [tab, setTab]           = useState('overview')
  const [risks, setRisks]       = useState(null)
  const [controls, setControls] = useState(null)
  const [tracker, setTracker]   = useState(null)
  const [documents, setDocuments] = useState(null)
  const [ropa, setRopa] = useState(null)
  const [tools, setTools] = useState(null)
  const [owner, setOwner] = useState('All people')
  const [loading, setLoading]   = useState({ risks: true, controls: true, tracker: true })
  const [errors, setErrors]     = useState({})
  const [lastSync, setLastSync] = useState(null)
  const [syncing, setSyncing]   = useState(false)

  const load = useCallback(async () => {
    setSyncing(true)
    setLoading({ risks: true, controls: true, tracker: true, documents: true, ropa: true, tools: true })
    setErrors({})
    const run = async (key, fn, set) => {
      try { set(await fn()) }
      catch (e) { setErrors(p => ({ ...p, [key]: e.message })) }
      finally { setLoading(p => ({ ...p, [key]: false })) }
    }
    await Promise.all([
      run('risks',    fetchRisks,    setRisks),
      run('controls', fetchControls, setControls),
      run('tracker',  fetchTracker,  setTracker),
      run('documents', () => fetchDb('documents'), setDocuments),
      run('ropa', () => fetchDb('ropa'), setRopa),
      run('tools', () => fetchDb('tools'), setTools),
    ])
    setLastSync(new Date())
    setSyncing(false)
  }, [])

  useEffect(() => { load() }, [load])

  const currentTab = TABS.find(t => t.id === tab)

  return (
    <div style={{ minHeight: '100vh', background: C.cream, fontFamily: C.ws }}>
      <style>{GLOBAL_CSS}</style>

      {/* Header */}
      <div style={{ background: C.forest, borderBottom: `3px solid ${C.amber}`, position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 40px', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span style={{ fontFamily: C.sg, fontSize: 20, fontWeight: 700, color: C.cream, letterSpacing: '-0.01em' }}>
              CONNECT<span style={{ color: C.amber }}>GO</span>
            </span>
            <span style={{ fontFamily: C.sg, fontSize: 9, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.38)' }}>
              Governance &amp; Compliance
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {lastSync && (
              <span style={{ fontFamily: C.sg, fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(245,242,236,0.35)' }}>
                LAST SYNC: {lastSync.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <select aria-label="Filter by owner" value={owner} onChange={e => setOwner(e.target.value)} style={{ background: C.forest, border: `1px solid ${C.yellow}`, borderRadius: 3, padding: '7px 9px', fontFamily: C.sg, fontSize: 10, color: C.yellow }}>
              <option>All people</option>
              <option>Belinda Mziray</option>
              <option>Kate McAlpine</option>
              <option>Sumaiya Karim</option>
              <option>Samuel Mounsey</option>
            </select>
            <button onClick={load} disabled={syncing} style={{
              background: syncing ? 'rgba(255,255,255,0.06)' : `${C.yellow}22`,
              border: `1px solid ${syncing ? 'rgba(255,255,255,0.12)' : C.yellow}`,
              borderRadius: 3, padding: '7px 14px',
              fontFamily: C.sg, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
              color: syncing ? 'rgba(255,255,255,0.25)' : C.yellow,
              cursor: syncing ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
            }}>
              {syncing ? '↻ Syncing…' : '↻ Sync'}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 40px', display: 'flex', gap: 28 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '0 0 14px', background: 'none', border: 'none',
              borderBottom: `2px solid ${tab === t.id ? C.yellow : 'transparent'}`,
              fontFamily: C.sg, fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase',
              color: tab === t.id ? C.yellow : 'rgba(245,242,236,0.45)',
              cursor: 'pointer', transition: 'all 0.18s', whiteSpace: 'nowrap',
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* Page label */}
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '20px 40px 8px' }}>
        <div style={{ fontFamily: C.sg, fontSize: 9, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.textDim }}>
          {currentTab?.label?.toUpperCase()} — CONNECTGO LIMITED
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '14px 40px 52px' }}>
        {tab === 'overview'     && <OverviewTab     risks={risks} controls={controls} tracker={tracker} loading={loading} errors={errors} />}
        {tab === 'risks'        && <RisksTab        risks={risks} loading={loading} errors={errors} />}
        {tab === 'risks'        && <div style={{ marginTop: 14 }}><RegisterTab title="Risk Register — Records" sub="Click a risk to open and edit it in Notion" data={risks} loading={loading.risks} error={errors.risks} owner={owner} fields={['name', 'owner', 'probability', 'controlStatus']} /></div>}
        {tab === 'controls'     && <ControlsTab     controls={controls} loading={loading} errors={errors} />}
        {tab === 'controls'     && <div style={{ marginTop: 14 }}><RegisterTab title="Controls — Records" sub="Click a control to open and edit it in Notion" data={controls} loading={loading.controls} error={errors.controls} owner={owner} fields={['name', 'owner', 'status', 'reviewDate']} /></div>}
        {tab === 'rhythm'       && <RhythmTab       tracker={tracker} loading={loading} errors={errors} />}
        {tab === 'safeguarding' && <SafeguardingTab risks={risks} loading={loading} errors={errors} />}
        {tab === 'documents' && <RegisterTab title="Document Library" sub="In review, approved and upcoming review dates" data={documents} loading={loading.documents} error={errors.documents} owner={owner} fields={['name', 'domain', 'status', 'nextReviewDate']} />}
        {tab === 'ropa' && <><RegisterProgress title="RoPA progress" items={ropa?.items} definitions={[{ label: 'DPIA REQUIRED', test: x => x.dpiaProgress && x.dpiaProgress !== 'N/A', color: C.coral }, { label: 'RETENTION REVIEW', test: x => !x.lastRetentionReviewDate, color: C.amber }, { label: 'ACTIVITIES', test: () => true, color: C.forest }]} /><RegisterTab title="Register of Processing Activities" sub="Business function, DPIA progress and retention review — click a record to edit in Notion" data={ropa} loading={loading.ropa} error={errors.ropa} owner={owner} fields={['name', 'businessFunction', 'dpiaProgress', 'lastRetentionReviewDate']} /></>}
        {tab === 'tools' && <><RegisterProgress title="IT tools progress" items={tools?.items} definitions={[{ label: 'MFA NOT CONFIRMED', test: x => x.mfaStatus !== 'Enabled', color: C.coral }, { label: 'REVIEW REQUIRED', test: x => x.toolStatus !== 'Active', color: C.amber }, { label: 'TOOLS REGISTERED', test: () => true, color: C.forest }]} /><RegisterTab title="IT Tools & Access Matrix" sub="Tool status, MFA and renewal date — click a record to edit in Notion" data={tools} loading={loading.tools} error={errors.tools} owner={owner} fields={['name', 'toolStatus', 'mfaStatus', 'nextRenewalDate']} /></>}
      </div>

      {/* Footer */}
      <div style={{ borderTop: `1px solid ${C.border}`, padding: '14px 40px', maxWidth: 1400, margin: '0 auto', display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: C.sg, fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.textDim }}>
          ConnectGo Ltd · ICO Registered · Dr Kate McAlpine, Director
        </span>
        <span style={{ fontFamily: C.sg, fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.textDim }}>
          Confidential
        </span>
      </div>
    </div>
  )
}
