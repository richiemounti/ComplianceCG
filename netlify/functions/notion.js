const TOKEN = process.env.NOTION_TOKEN

const DS = {
  risks: '32cc7c4e-dba0-4b15-a963-9fabbb9ee4f5',
  controls: '670cf485-bb60-4f31-88d0-9c0a9ce31996',
  tracker: '0a17cd5a-e06b-44f4-9a0b-71df06c3e71e',
  documents: '55797539-d2d1-48aa-a883-a2eb86c24b0f',
  ropa: '30560bfb-014e-802d-984c-ecadae7f1a5e',
  tools: '38360bfb-014e-802e-bcb6-d9c66c05e0f3',
}

async function queryAll(databaseId) {
  const pages = []
  let cursor
  do {
    const body = { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }
    const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
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

const prop = (page, name) => page.properties[name]
const sel = (page, name) => prop(page, name)?.select?.name ?? null
const date = (page, name) => prop(page, name)?.date?.start ?? null
const plain = values => values?.map(value => value.plain_text).join('') ?? ''
const text = (page, name) => plain(prop(page, name)?.rich_text)
const number = (page, name) => prop(page, name)?.number ?? null
const url = (page, name) => prop(page, name)?.url ?? null
const people = (page, name) => {
  const value = prop(page, name)
  return value?.people?.map(person => person.name).join(', ') || text(page, name)
}
const propertyByNames = (page, names) => {
  const requested = names.map(name => name.toLowerCase())
  return Object.entries(page.properties).find(([name]) => requested.includes(name.toLowerCase()))?.[1]
}
const propertyNameByNames = (page, names, fallback) => {
  const requested = names.map(name => name.toLowerCase())
  return Object.keys(page?.properties || {}).find(name => requested.includes(name.toLowerCase())) || fallback
}
const titlePropertyName = (page, fallback = 'Name') =>
  Object.entries(page?.properties || {}).find(([, value]) => value.type === 'title')?.[0] || fallback
const propertyText = value => {
  if (!value) return ''
  if (value.type === 'title') return plain(value.title)
  if (value.type === 'rich_text') return plain(value.rich_text)
  if (value.type === 'select') return value.select?.name || ''
  if (value.type === 'status') return value.status?.name || ''
  if (value.type === 'multi_select') return value.multi_select?.map(option => option.name).join(', ') || ''
  if (value.type === 'people') return value.people?.map(person => person.name).join(', ') || ''
  if (value.type === 'date') return value.date?.start || ''
  if (value.type === 'number') return value.number ?? ''
  if (value.type === 'formula') return value.formula?.string ?? value.formula?.number ?? ''
  return ''
}
const namedText = (page, names) => propertyText(propertyByNames(page, names))
const namedDate = (page, names) => propertyByNames(page, names)?.date?.start ?? ''
const title = page => {
  const activity = plain(prop(page, 'Activity')?.title)
  if (activity) return activity
  const firstTitle = Object.values(page.properties).find(value => value.type === 'title')
  return plain(firstTitle?.title)
}
const link = page => ({ id: page.id, url: page.url, name: title(page) })

function aggregateRisks(pages) {
  const byProbability = { High: 0, Medium: 0, Low: 0 }
  const byDomain = { 'Data Protection': 0, Safeguarding: 0, Commercial: 0, Operational: 0, Regulatory: 0, Reputational: 0 }
  const byControlStatus = { 'In Place': 0, Partial: 0, 'Not In Place': 0, 'Not Applicable': 0 }
  const byCategory = { Open: 0, Addressed: 0, Closed: 0 }
  for (const page of pages) {
    const probability = sel(page, 'Probability'); if (probability && probability in byProbability) byProbability[probability]++
    const domain = sel(page, 'Domain'); if (domain && domain in byDomain) byDomain[domain]++
    const control = sel(page, 'Control Status'); if (control && control in byControlStatus) byControlStatus[control]++
    const category = sel(page, 'Risk Category'); if (category && category in byCategory) byCategory[category]++
  }
  const sample = pages[0]
  const columns = {
    riskId: propertyNameByNames(sample, ['Risk ID'], 'Risk ID'),
    title: titlePropertyName(sample, 'Risk'),
    owner: propertyNameByNames(sample, ['Risk Owner'], 'Risk Owner'),
    domain: propertyNameByNames(sample, ['Domain'], 'Domain'),
    probability: propertyNameByNames(sample, ['Probability'], 'Probability'),
    consequences: propertyNameByNames(sample, ['Consequences'], 'Consequences'),
    controlStatus: propertyNameByNames(sample, ['Control Status'], 'Control Status'),
    category: propertyNameByNames(sample, ['Risk Category'], 'Risk Category'),
    reviewDate: propertyNameByNames(sample, ['Review Date'], 'Review Date'),
    reviewFrequency: propertyNameByNames(sample, ['Review Frequency'], 'Review Frequency'),
  }
  return {
    total: pages.length, byProbability, byDomain, byControlStatus, byCategory, columns,
    items: pages.map(page => ({ ...link(page), riskId: number(page, 'Risk ID'), domain: sel(page, 'Domain'), probability: sel(page, 'Probability'), owner: people(page, 'Risk Owner'), consequences: sel(page, 'Consequences'), category: sel(page, 'Risk Category'), controlStatus: sel(page, 'Control Status'), reviewDate: date(page, 'Review Date'), reviewFrequency: sel(page, 'Review Frequency') })),
  }
}

function aggregateControls(pages) {
  const byStatus = { Active: 0, Partial: 0, Planned: 0, 'Not In Place': 0 }
  const byDomain = { 'Data Protection': 0, Safeguarding: 0, Commercial: 0 }
  for (const page of pages) {
    const status = sel(page, 'Status'); if (status && status in byStatus) byStatus[status]++
    const domain = sel(page, 'Domain'); if (domain && domain in byDomain) byDomain[domain]++
  }
  const sample = pages[0]
  const columns = {
    controlId: propertyNameByNames(sample, ['Control ID'], 'Control ID'),
    title: titlePropertyName(sample, 'Control'),
    domain: propertyNameByNames(sample, ['Domain'], 'Domain'),
    type: propertyNameByNames(sample, ['Control Type'], 'Control Type'),
    status: propertyNameByNames(sample, ['Status'], 'Status'),
    owner: propertyNameByNames(sample, ['Owner'], 'Owner'),
    reviewDate: propertyNameByNames(sample, ['Review Date'], 'Review Date'),
    reviewFrequency: propertyNameByNames(sample, ['Review Frequency'], 'Review Frequency'),
  }
  return { total: pages.length, byStatus, byDomain, columns, items: pages.map(page => ({ ...link(page), controlId: number(page, 'Control ID'), domain: sel(page, 'Domain'), type: sel(page, 'Control Type'), status: sel(page, 'Status'), owner: text(page, 'Owner'), reviewDate: date(page, 'Review Date'), reviewFrequency: sel(page, 'Review Frequency') })) }
}

function aggregateDocuments(pages) {
  const byStatus = {}
  const byDomain = {}
  const items = pages.map(page => ({ ...link(page), docId: number(page, 'Doc ID'), documentUrl: url(page, 'Document Link'), domain: sel(page, 'Domain'), owner: sel(page, 'Owner'), type: sel(page, 'Type'), status: sel(page, 'Status'), reviewCycle: sel(page, 'Review Cycle'), nextReviewDate: date(page, 'Next Review Date'), nextApprovalDate: date(page, 'Next Approval Date'), lastUpdated: page.last_edited_time }))
  for (const item of items) { if (item.status) byStatus[item.status] = (byStatus[item.status] || 0) + 1; if (item.domain) byDomain[item.domain] = (byDomain[item.domain] || 0) + 1 }
  const sample = pages[0]
  const columns = {
    docId: propertyNameByNames(sample, ['Doc ID'], 'Doc ID'),
    title: titlePropertyName(sample, 'Document'),
    domain: propertyNameByNames(sample, ['Domain'], 'Domain'),
    owner: propertyNameByNames(sample, ['Owner'], 'Owner'),
    type: propertyNameByNames(sample, ['Type'], 'Type'),
    status: propertyNameByNames(sample, ['Status'], 'Status'),
    reviewCycle: propertyNameByNames(sample, ['Review Cycle'], 'Review Cycle'),
    nextReviewDate: propertyNameByNames(sample, ['Next Review Date'], 'Next Review Date'),
    nextApprovalDate: propertyNameByNames(sample, ['Next Approval Date'], 'Next Approval Date'),
  }
  return { total: pages.length, byStatus, byDomain, columns, items }
}

function aggregateTracker(pages) {
  const byStatus = { Done: 0, 'In Progress': 0, 'To Do': 0, Overdue: 0, Skipped: 0 }
  const items = pages.map(page => ({
    ...link(page),
    activityId: number(page, 'Activity ID'),
    dueDate: date(page, 'Due Date'),
    completedDate: date(page, 'Completed Date'),
    owner: people(page, 'Owner'),
    status: sel(page, 'Status'),
    domain: sel(page, 'Domain'),
    type: sel(page, 'Type'),
    frequency: sel(page, 'Frequency'),
    priority: sel(page, 'Priority'),
  }))
  for (const item of items) if (item.status && item.status in byStatus) byStatus[item.status]++
  const pending = items.filter(item => item.dueDate && !['Done', 'Skipped'].includes(item.status)).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  return { total: pages.length, byStatus, upcoming: pending.slice(0, 5), items }
}

function aggregateRopa(pages) {
  const items = pages.map(page => ({
    ...link(page),
    subjects: namedText(page, ['Data subjects', 'Data Subject']),
    personalData: namedText(page, ['Personal data', 'Categories of personal data', 'Data']),
    purpose: namedText(page, ['Purpose', 'Purpose of processing']),
    basis: namedText(page, ['Lawful basis', 'Lawful Basis']),
    systems: namedText(page, ['Systems', 'System', 'IT systems']),
    retention: namedText(page, ['Retention', 'Retention period']),
    flag: namedText(page, ['Flag', 'Status', 'Review status']),
    owner: namedText(page, ['Owner', 'Data owner']),
  }))
  const byFlag = items.reduce((result, item) => item.flag ? { ...result, [item.flag]: (result[item.flag] || 0) + 1 } : result, {})
  const sample = pages[0]
  const columns = {
    title: titlePropertyName(sample, 'Processing Activity'),
    subjects: propertyNameByNames(sample, ['Data subjects', 'Data Subject'], 'Data Subjects'),
    personalData: propertyNameByNames(sample, ['Personal data', 'Categories of personal data', 'Data'], 'Personal Data'),
    purpose: propertyNameByNames(sample, ['Purpose', 'Purpose of processing'], 'Purpose'),
    basis: propertyNameByNames(sample, ['Lawful basis', 'Lawful Basis'], 'Lawful Basis'),
    systems: propertyNameByNames(sample, ['Systems', 'System', 'IT systems'], 'Systems'),
    retention: propertyNameByNames(sample, ['Retention', 'Retention period'], 'Retention'),
    owner: propertyNameByNames(sample, ['Owner', 'Data owner'], 'Owner'),
    flag: propertyNameByNames(sample, ['Flag', 'Status', 'Review status'], 'Flag'),
  }
  return { total: pages.length, byFlag, columns, items }
}

function aggregateTools(pages) {
  const items = pages.map(page => ({
    ...link(page),
    category: namedText(page, ['Category', 'Tool category', 'Type']),
    owner: namedText(page, ['Owner', 'System owner']),
    criticality: namedText(page, ['Criticality', 'Critical']),
    dpa: namedText(page, ['DPA', 'DPA status', 'Data processing agreement']),
    mfa: namedText(page, ['MFA', 'MFA status']),
    reviewDate: namedDate(page, ['Next review', 'Review date', 'Review Date']),
  }))
  const sample = pages[0]
  const columns = {
    title: titlePropertyName(sample, 'Tool / Supplier'),
    category: propertyNameByNames(sample, ['Category', 'Tool category', 'Type'], 'Category'),
    owner: propertyNameByNames(sample, ['Owner', 'System owner'], 'Owner'),
    criticality: propertyNameByNames(sample, ['Criticality', 'Critical'], 'Criticality'),
    dpa: propertyNameByNames(sample, ['DPA', 'DPA status', 'Data processing agreement'], 'DPA'),
    mfa: propertyNameByNames(sample, ['MFA', 'MFA status'], 'MFA'),
    reviewDate: propertyNameByNames(sample, ['Next review', 'Review date', 'Review Date'], 'Next Review'),
  }
  return { total: pages.length, columns, items }
}

exports.handler = async event => {
  if (!TOKEN) return { statusCode: 500, body: JSON.stringify({ error: 'NOTION_TOKEN is not configured' }) }

  // Task checkbox write-back: POST /.netlify/functions/notion?action=patch&pageId=<id>
  if (event.queryStringParameters?.action === 'patch') {
    const pageId = event.queryStringParameters?.pageId
    if (!pageId) return { statusCode: 400, body: JSON.stringify({ error: 'Missing pageId' }) }
    try {
      const body = JSON.parse(event.body || '{}')
      const result = await patchPage(pageId, body.status || 'Done')
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ ok: true, id: result.id }),
      }
    } catch (error) {
      return { statusCode: 500, body: JSON.stringify({ error: error.message }) }
    }
  }

  const db = event.queryStringParameters?.db
  if (!db || !DS[db]) return { statusCode: 400, body: JSON.stringify({ error: 'Invalid db param' }) }
  if (!TOKEN) return { statusCode: 500, body: JSON.stringify({ error: 'NOTION_TOKEN is not configured' }) }
  try {
    const pages = await queryAll(DS[db])
    const body = db === 'risks' ? aggregateRisks(pages) : db === 'controls' ? aggregateControls(pages) : db === 'tracker' ? aggregateTracker(pages) : db === 'documents' ? aggregateDocuments(pages) : db === 'ropa' ? aggregateRopa(pages) : aggregateTools(pages)
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) }
  } catch (error) { return { statusCode: 500, body: JSON.stringify({ error: error.message }) } }
}
