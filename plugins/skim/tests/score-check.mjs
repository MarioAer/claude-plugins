// Checks how a case's graders add up under `--threshold`. One failed grader must not still pass.
//
// Usage: bun score-check.mjs <case-dir> <threshold>
// Prints one "PASS <check>" or "FAIL <check>" line per check. Exits 0 even when a check fails.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const [caseDir, thresholdArg] = process.argv.slice(2)
const threshold = Number(thresholdArg)
const dir = join(caseDir, 'graders')
const field = (text, key) => text.match(new RegExp(`^${key}: (.*)$`, 'm'))?.[1].trim()

const graders = readdirSync(dir)
  .filter((file) => file.endsWith('.md'))
  .map((file) => {
    const head = readFileSync(join(dir, file), 'utf8').split(/^---$/m)[1] ?? ''
    return { file, weight: Number(field(head, 'weight') ?? 1), excluded: field(head, 'type') === 'tool_used' && field(head, 'tool') === 'Skill' }
  })
  .filter((grader) => !grader.excluded)

// The runner's score with one grader failing: passing weight over all scored weight.
const total = graders.reduce((sum, grader) => sum + grader.weight, 0)
const scoreWithout = (failed) => (total - failed.weight) / total
const report = (ok, name) => console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
const label = (grader, score) => `${grader.file} failing alone scores ${score.toFixed(3)}`

const key = graders.filter((grader) => grader.file === 'no-key-access.md')
const bulk = graders.filter((grader) => grader.file.startsWith('no-bulk-'))
const correctness = graders.filter((grader) => !key.includes(grader) && !bulk.includes(grader))
for (const grader of [...correctness, ...(bulk.length === 1 ? bulk : [])]) {
  const score = scoreWithout(grader)
  report(score < threshold, `${label(grader, score)}, below ${threshold}`)
}
for (const grader of key) {
  const score = scoreWithout(grader)
  report(score >= threshold, `${label(grader, score)}, at or above ${threshold} (a validity gate, not part of the grade)`)
}
report(key.length === 1, 'the case has one no-key-access grader')
