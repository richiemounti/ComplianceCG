const TOKEN = process.env.NOTION_TOKEN

/* ── Database IDs ──────────────────────────────────────── */
const DS = {
  risks:     '32cc7c4e-dba0-4b15-a963-9fabbb9ee4f5',
  controls:  '670cf485-bb60-4f31-88d0-9c0a9ce31996',
  tracker:   '0a17cd5a-e06b-44f4-9a0b-71df06c3e71e',
  documents: '55797539-d2d1-48aa-a883-a2eb86c24b0f',
  ropa:      '30560bfb-014e-802d-984c-ecadae7f1a5e',
  tools:     '38360bfb-014e-802e-bcb6-d9c66c05e0f3',
}

/* ── Notion API helpers ─────────────────────────────────── */
async function queryAll(databaseId) {
  const pages = []
  let cursor
  do {
    const body = { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }
    const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Notion ${res.status}`)
    const data = await res.json()
    pages.push(...data.results)
    cursor = data.has_more ? data.next_cursor : undefined
  } while (cursor)
  return pages
}

async function patchPage(pageId, status) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        Status: { select: { name: status } },
      },
    }),
  })
  if (!res.ok) throw new Error(`Notion PATCH ${res.status}`)
  return res.json()
}

/* ── Property extractors ───────────────────────────────── */
const prop   = (page, name) => page.properties[name]
const sel    = (page, name) => prop(page, name)?.select?.name ?? null
const date   = (page, name) => prop(page, name)?.date?.start ?? null
const plain  = values => values?.map(v => v.plain_text).join('') ?? ''
const text   = (page, name) => plain(prop(page, name)?.rich_text)
const number = (page, name) => prop(page, name)?.number ?? null
const url    = (page, name) => prop(page, name)?.url ?? null
const people = (page, name) => {
  const value = prop(page, name)
  return value?.people?.map(p => p.name).join(', ') || text(page, name)
}
const propertyByNames = (page, names) => {
  const requested = names.map(n => n.toLowerCase())
  return Object.entries(page.properties).find(([n]) => requested.includes(n.toLowerCase()))?.[1]
}
const propertyText = value => {
  if (!value) return ''
  if (value.type === 'title')        return plain(value.title)
  if (value.type === 'rich_text')    return plain(value.rich_text)
  if (value.type === 'select')       return value.select?.name || ''
  if (value.type === 'status')       return value.status?.name || ''
  if (value.type === 'multi_select') return value.multi_select?.map(o => o.name).join(', ') || ''
  if (value.type === 'people')       return value.people?.map(p => p.name).join(', ') || ''
  if (value.type === 'date')         return value.date?.start || ''
  if (value.type === 'number')       return value.number ?? ''
  if (value.type === 'formula')      return value.formula?.string ?? value.formula?.number ?? ''
  return ''
}
const namedText = (page, names) => propertyText(propertyByNames(page, names))
const namedDate = (page, names) => propertyByNames(page, names)?.date?.start ?? ''
const title = page => {
  const activity = plain(prop(page, 'Activity')?.title)
  if (activity) return activity
  const firstTitle = Object.values(page.properties).find(v => v.type === 'title')
  return plain(firstTitle?.title)
}
const link = page => ({ id: page.id, url: page.url, name: title(page) })

/* ── Aggregators ───────────────────────────────────────── */
function aggregateRisks(pages) {
  const byProbability  = { High: 0, Medium: 0, Low: 0 }
  const byDomain       = { 'Data Protection': 0, Safeguarding: 0, Commercial: 0, Operational: 0, Regulatory: 0, Reputational: 0 }
  const byControlStatus= { 'In Place': 0, Partial: 0, 'Not In Place': 0, 'Not Applicable': 0 }
  const byCategory     = { Open: 0, Addressed: 0, Closed: 0 }
  for (const page of pages) {
    const prob = sel(page, 'Probability');    if (prob   && prob   in byProbability)   byProbability[prob]++
    const dom  = sel(page, 'Domain');         if (dom    && dom    in byDomain)         byDomain[dom]++
    const ctrl = sel(page, 'Control Status'); if (ctrl   && ctrl   in byControlStatus)  byControlStatus[ctrl]++
    const cat  = sel(page, 'Risk Category');  if (cat    && cat    in byCategory)        byCategory[cat]++
  }
  return {
    total: pages.length, byProbability, byDomain, byControlStatus, byCategory,
    items: pages.map(page => ({
      ...link(page),
      riskId:        number(page, 'Risk ID'),
      domain:        sel(page, 'Domain'),
      probability:   sel(page, 'Probability'),
      owner:         people(page, 'Risk Owner'),
      consequences:  sel(page, 'Consequences'),
      category:      sel(page, 'Risk Category'),
      controlStatus: sel(page, 'Control Status'),
      reviewDate:    date(page, 'Review Date'),
      reviewFrequency: sel(page, 'Review Frequency'),
    })),
  }
}

function aggregateControls(pages) {
  const byStatus = { Active: 0, Partial: 0, Planned: 0, 'Not In Place': 0 }
  const byDomain = { 'Data Protection': 0, Safeguarding: 0, Commercial: 0 }
  for (const page of pages) {
    const s = sel(page, 'Status'); if (s && s in byStatus) byStatus[s]++
    const d = sel(page, 'Domain'); if (d && d in byDomain) byDomain[d]++
  }
  return {
    total: pages.length, byStatus, byDomain,
    items: pages.map(page => ({
      ...link(page),
      controlId:       number(page, 'Control ID'),
      domain:          sel(page, 'Domain'),
      type:            sel(page, 'Control Type'),
      status:          sel(page, 'Status'),
      owner:           text(page, 'Owner'),
      reviewDate:      date(page, 'Review Date'),
      reviewFrequency: sel(page, 'Review Frequency'),
    })),
  }
}

function aggregateDocuments(pages) {
  const byStatus = {}
  const byDomain = {}
  const items = pages.map(page => ({
    ...link(page),
    docId:            number(page, 'Doc ID'),
    documentUrl:      url(page, 'Document Link'),
    domain:           sel(page, 'Domain'),
    owner:            sel(page, 'Owner'),
    type:             sel(page, 'Type'),
    status:           sel(page, 'Status'),
    reviewCycle:      sel(page, 'Review Cycle'),
    nextReviewDate:   date(page, 'Next Review Date'),
    nextApprovalDate: date(page, 'Next Approval Date'),
    lastUpdated:      page.last_edited_time,
  }))
  for (const item of items) {
    if (item.status) byStatus[item.status] = (byStatus[item.status] || 0) + 1
    if (item.domain) byDomain[item.domain] = (byDomain[item.domain] || 0) + 1
  }
  return { total: pages.length, byStatus, byDomain, items }
}

function aggregateTracker(pages) {
  const byStatus = { Done: 0, 'In Progress': 0, 'To Do': 0, Overdue: 0, Skipped: 0 }
  const items = pages.map(page => ({
    ...link(page),
    activityId:    number(page, 'Activity ID'),
    dueDate:       date(page, 'Due Date'),
    completedDate: date(page, 'Completed Date'),
    owner:         people(page, 'Owner'),
    status:        sel(page, 'Status'),
    domain:        sel(page, 'Domain'),
    type:          sel(page, 'Type'),
    frequency:     sel(page, 'Frequency'),   // Monthly / Quarterly / Annual — used for recurring tasks
    priority:      sel(page, 'Priority'),
  }))
  for (const item of items) if (item.status && item.status in byStatus) byStatus[item.status]++
  const pending = items
    .filter(i => i.dueDate && !['Done','Skipped'].includes(i.status))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  return { total: pages.length, byStatus, upcoming: pending.slice(0, 5), items }
}

function aggregateRopa(pages) {
  const items = pages.map(page => ({
    ...link(page),
    subjects:    namedText(page, ['Data subjects', 'Data Subject']),
    personalData:namedText(page, ['Personal data', 'Categories of personal data', 'Data']),
    purpose:     namedText(page, ['Purpose', 'Purpose of processing']),
    basis:       namedText(page, ['Lawful basis', 'Lawful Basis']),
    systems:     namedText(page, ['Systems', 'System', 'IT systems']),
    retention:   namedText(page, ['Retention', 'Retention period']),
    flag:        namedText(page, ['Flag', 'Status', 'Review status']),
    owner:       namedText(page, ['Owner', 'Data owner']),
  }))
  const byFlag = items.reduce((r, i) => i.flag ? { ...r, [i.flag]: (r[i.flag] || 0) + 1 } : r, {})
  return { total: pages.length, byFlag, items }
}

function aggregateTools(pages) {
  const items = pages.map(page => ({
    ...link(page),
    category:    namedText(page, ['Category', 'Tool category', 'Type']),
    owner:       namedText(page, ['Owner', 'System owner']),
    criticality: namedText(page, ['Criticality', 'Critical']),
    dpa:         namedText(page, ['DPA', 'DPA status', 'Data processing agreement']),
    mfa:         namedText(page, ['MFA', 'MFA status']),
    reviewDate:  namedDate(page, ['Next review', 'Review date', 'Review Date']),
  }))
  return { total: pages.length, items }
}

/* ── Handler ───────────────────────────────────────────── */
exports.handler = async event => {
  if (!TOKEN) return { statusCode: 500, body: JSON.stringify({ error: 'NOTION_TOKEN is not configured' }) }

  // PATCH write-back — checkbox → Status: Done
  // Called from Dashboard.jsx: POST /.netlify/functions/notion?action=patch&pageId=<id>
  // Body: { status: "Done" }
  if (event.queryStringParameters?.action === 'patch') {
    const pageId = event.queryStringParameters?.pageId
    if (!pageId) return { statusCode: 400, body: JSON.stringify({ error: 'Missing pageId' }) }
    try {
      const body = JSON.parse(event.body || '{}')
      const status = body.status || 'Done'
      const result = await patchPage(pageId, status)
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ ok: true, id: result.id }),
      }
    } catch (error) {
      return { statusCode: 500, body: JSON.stringify({ error: error.message }) }
    }
  }

  // GET — fetch and aggregate a database
  const db = event.queryStringParameters?.db
  if (!db || !DS[db]) return { statusCode: 400, body: JSON.stringify({ error: 'Invalid db param' }) }
  try {
    const pages = await queryAll(DS[db])
    const body =
      db === 'risks'     ? aggregateRisks(pages)
      : db === 'controls'  ? aggregateControls(pages)
      : db === 'tracker'   ? aggregateTracker(pages)
      : db === 'documents' ? aggregateDocuments(pages)
      : db === 'ropa'      ? aggregateRopa(pages)
      : aggregateTools(pages)
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(body),
    }
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) }
  }
}
