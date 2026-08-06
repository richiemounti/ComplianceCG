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
    const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
    })
    if (!res.ok) throw new Error(`Notion ${res.status}`)
    const data = await res.json()
    pages.push(...data.results)
    cursor = data.has_more ? data.next_cursor : undefined
  } while (cursor)
  return pages
}

const prop = (page, name) => page.properties[name]
const textValues = values => values?.map(value => value.plain_text).join('') || ''
const sel = (page, name) => prop(page, name)?.select?.name || prop(page, name)?.status?.name || null
const multi = (page, name) => prop(page, name)?.multi_select?.map(value => value.name).join(', ') || sel(page, name)
const txt = (page, name) => textValues(prop(page, name)?.rich_text)
const date = (page, name) => prop(page, name)?.date?.start || null
const people = (page, name) => prop(page, name)?.people?.map(value => value.name).join(', ') || txt(page, name) || sel(page, name)
const title = page => textValues(Object.values(page.properties).find(value => value.type === 'title')?.title)
const record = page => ({ id: page.id, url: page.url, name: title(page) })

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
  return { total: pages.length, byProbability, byDomain, byControlStatus, byCategory, items: pages.map(page => ({ ...record(page), owner: people(page, 'Risk Owner'), domain: sel(page, 'Domain'), probability: sel(page, 'Probability'), category: sel(page, 'Risk Category'), controlStatus: sel(page, 'Control Status'), reviewDate: date(page, 'Review Date') })) }
}

function aggregateControls(pages) {
  const byStatus = { Active: 0, Partial: 0, Planned: 0, 'Not In Place': 0 }
  const byDomain = { 'Data Protection': 0, Safeguarding: 0, Commercial: 0 }
  for (const page of pages) { const status = sel(page, 'Status'); if (status && status in byStatus) byStatus[status]++; const domain = sel(page, 'Domain'); if (domain && domain in byDomain) byDomain[domain]++ }
  return { total: pages.length, byStatus, byDomain, items: pages.map(page => ({ ...record(page), owner: people(page, 'Owner'), status: sel(page, 'Status'), domain: sel(page, 'Domain'), type: sel(page, 'Control Type'), reviewDate: date(page, 'Review Date') })) }
}

function aggregateTracker(pages) {
  const byStatus = { Done: 0, 'In Progress': 0, 'To Do': 0, Overdue: 0, Skipped: 0 }
  const items = pages.map(page => ({ ...record(page), owner: people(page, 'Owner'), dueDate: date(page, 'Due Date'), status: sel(page, 'Status'), domain: sel(page, 'Domain'), type: sel(page, 'Type'), priority: sel(page, 'Priority') }))
  for (const item of items) if (item.status && item.status in byStatus) byStatus[item.status]++
  const upcoming = items.filter(item => item.dueDate && !['Done', 'Skipped'].includes(item.status)).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5)
  return { total: pages.length, byStatus, items, upcoming }
}

function aggregateDocuments(pages) { const items = pages.map(page => ({ ...record(page), owner: people(page, 'Owner'), domain: sel(page, 'Domain'), status: sel(page, 'Status'), type: multi(page, 'Type'), nextReviewDate: date(page, 'Next Review Date'), nextApprovalDate: date(page, 'Next Approval Date') })); return { total: pages.length, items } }
function aggregateRopa(pages) { const items = pages.map(page => ({ ...record(page), owner: people(page, 'Owner'), businessFunction: multi(page, 'Business Function'), dpiaProgress: sel(page, 'DPIA Progress'), lastRetentionReviewDate: date(page, 'Last Retention Review Date') })); return { total: pages.length, items } }
function aggregateTools(pages) { const items = pages.map(page => ({ ...record(page), owner: people(page, 'Reviewed By') || people(page, 'Owner'), toolStatus: sel(page, 'Tool Status'), mfaStatus: sel(page, '2FA/MFA Status') || (prop(page, 'MFA Enabled')?.checkbox ? 'Enabled' : 'Not confirmed'), nextRenewalDate: date(page, 'Next Renewal Date') })); return { total: pages.length, items } }

exports.handler = async event => {
  const db = event.queryStringParameters?.db
  if (!db || !DS[db]) return { statusCode: 400, body: JSON.stringify({ error: 'Invalid db param' }) }
  if (!TOKEN) return { statusCode: 500, body: JSON.stringify({ error: 'NOTION_TOKEN is not configured' }) }
  try {
    const pages = await queryAll(DS[db])
    const result = db === 'risks' ? aggregateRisks(pages) : db === 'controls' ? aggregateControls(pages) : db === 'tracker' ? aggregateTracker(pages) : db === 'documents' ? aggregateDocuments(pages) : db === 'ropa' ? aggregateRopa(pages) : aggregateTools(pages)
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(result) }
  } catch (error) { return { statusCode: 500, body: JSON.stringify({ error: error.message }) } }
}
