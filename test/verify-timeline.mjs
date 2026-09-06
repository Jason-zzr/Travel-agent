import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const fixtureRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(process.cwd(), 'test', 'fixtures', 'd7-export')
const timelinePath = path.join(fixtureRoot, 'timeline.json')
const icsPath = path.join(fixtureRoot, 'itinerary.ics')
const timeline = JSON.parse(fs.readFileSync(timelinePath, 'utf8'))
const unfolded = fs.readFileSync(icsPath, 'utf8').replace(/\r?\n[ \t]/g, '')
const events = [...unfolded.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)END:VEVENT/g)].map((match) =>
  Object.fromEntries(
    match[1]
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const separator = line.indexOf(':')
        return [line.slice(0, separator), line.slice(separator + 1)]
      })
  )
)
const expected = timeline.items
assert.equal(events.length, expected.length, 'ICS VEVENT count differs from timeline')
for (const item of expected) {
  const event = events.find((candidate) => candidate.UID === `${item.itemId}@travel-harness.local`)
  assert.ok(event, `missing VEVENT for ${item.itemId}`)
  assert.equal(event.DTSTART, toIcsUtc(item.date, item.startTime, false))
  assert.equal(
    event.DTEND ?? event.DTSTART,
    toIcsUtc(item.date, item.endTime, item.crossesMidnight)
  )
  if (item.itemClass === 'BACKUP') assert.equal(event.DTEND, undefined)
}
console.log(JSON.stringify({ ok: true, events: events.length, zeroDurationBackups: true }))

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function toIcsUtc(date, time, nextDay) {
  const instant = new Date(`${date}T${time}:00+08:00`)
  if (nextDay) instant.setUTCDate(instant.getUTCDate() + 1)
  return instant
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}
