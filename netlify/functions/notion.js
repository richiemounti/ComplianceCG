const TOKEN = process.env.VITE_NOTION_TOKEN

const DS = {
  risks:    '32cc7c4e-dba0-4b15-a963-9fabbb9ee4f5',
  controls: '670cf485-bb60-4f31-88d0-9c0a9ce31996',
  tracker:  '0a17cd5a-e06b-44f4-9a0b-71df06c3e71e',
}

async function queryAll(databaseId) {
  const pages = []
  let cursor
  do {
    const body = { page_size: 100 }
    if (cursor) body.start_cursor = cursor
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

const sel  = (page, prop) => page.properties[prop]?.select?.name ?? null
const txt  = (page, prop) => page.properties[prop]?.rich_text?.[0]?.plain_text ?? ''
const dt   = (page, prop) => page.properties[prop]?.date?.start ?? null
const titl = (page)       => page.properties['Activity']?.title?.[0]?.plain_text ?? ''

function aggregateRisks(pages) {
  const byProbability   = { High: 0, Medium: 0, Low: 0 }
  const byDomain        = { 'Data Protection': 0, Safeguarding: 0, Commercial: 0, Operational: 0, Regulatory: 0, Reputational: 0 }
  const byControlStatus = { 'In Place': 0, Partial: 0, 'Not In Place': 0, 'Not Applicable': 0 }
  const byCategory      = { Open: 0, Addressed: 0, Closed: 0 }
  for (const p of pages) {
    const prob = sel(p, 'Probability');   if (prob && prob in byProbability)   byProbability[prob]++
    const dom  = sel(p, 'Domain');        if (dom  && dom  in byDomain)        byDomain[dom]++
    const cs   = sel(p, 'Control Status'); if (cs  && cs   in byControlStatus) byControlStatus[cs]++
    const cat  = sel(p, 'Risk Category'); if (cat  && cat  in byCategory)      byCategory[cat]++
  }
  return { total: pages.length, byProbability, byDomain, byControlStatus, byCategory }
}

function aggregateControls(pages) {
  const byStatus = { Active: 0, Partial: 0, Planned: 0, 'Not In Place': 0 }
  const byDomain = { 'Data Protection': 0, Safeguarding: 0, Commercial: 0 }
  for (const p of pages) {
    const s = sel(p, 'Status'); if (s && s in byStatus) byStatus[s]++
    const d = sel(p, 'Domain'); if (d && d in byDomain) byDomain[d]++
  }
  return { total: pages.length, byStatus, byDomain }
}

function aggregateTracker(pages) {
  const byStatus = { Done: 0, 'In Progress': 0, 'To Do': 0, Overdue: 0, Skipped: 0 }
  for (const p of pages) {
    const s = sel(p, 'Status'); if (s && s in byStatus) byStatus[s]++
  }
  const upcoming = pages
    .filter(p => {
      const s = sel(p, 'Status')
      return s && !['Done', 'Skipped'].includes(s) && dt(p, 'Due Date')
    })
    .sort((a, b) => dt(a, 'Due Date') < dt(b, 'Due Date') ? -1 : 1)
    .slice(0, 5)
    .map(p => ({ name: titl(p), dueDate: dt(p, 'Due Date'), owner: txt(p, 'Owner'), status: sel(p, 'Status') }))
  return { total: pages.length, byStatus, upcoming }
}

exports.handler = async (event) => {
  const db = event.queryStringParameters?.db
  if (!db || !DS[db]) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid db param' }) }
  }
  try {
    const pages = await queryAll(DS[db])
    const result = db === 'risks' ? aggregateRisks(pages)
      : db === 'controls' ? aggregateControls(pages)
      : aggregateTracker(pages)
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) }
  }
}
