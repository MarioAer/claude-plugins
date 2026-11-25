// Checks a no-bulk-* grader's pattern against a scaffolded corpus file with the runner's regex dialect
// (JavaScript). A bulk read must match; a targeted grep or a bounded read of the answer region must not.
//
// Usage: bun grader-check.mjs <grader.md> <corpus-file> <first-last>...
// Prints one "PASS <check>" or "FAIL <check>" line per check. Exits 0 even when a check fails.
import { readFileSync } from 'node:fs'

const [graderPath, corpusPath, ...regions] = process.argv.slice(2)
const frontmatter = readFileSync(graderPath, 'utf8').match(/^pattern: '(.*)'$/m)
if (!frontmatter) {
  console.log(`FAIL ${graderPath}: no single-quoted pattern in the frontmatter`)
  process.exit(0)
}
const pattern = new RegExp(frontmatter[1].replaceAll("''", "'"))
const text = readFileSync(corpusPath, 'utf8')
const lines = text.replace(/\n$/, '').split('\n')

// What a reader plausibly greps for. Each filter is one `grep -n` over the file.
const filters = [
  'Math\\.min', 'Math\\.pow', 'Math\\.max', 'clock\\.now', 'cache\\.set', 'cache\\.get', 'withLock',
  '^export', 'function ', 'attempt', 'exponent', 'scaled', 'consecutive', 'stamp', 'this\\.',
  '^\\s*(/\\*\\*|\\*)',
]
const widen = 40

const report = (ok, name) => console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
report(pattern.test(text), 'matches the whole file')
for (const filter of filters) {
  const re = new RegExp(filter)
  const out = lines.flatMap((line, i) => (re.test(line) ? [`${i + 1}:${line}`] : [])).join('\n')
  report(!pattern.test(out), `does not match grep -n '${filter}'`)
}
for (const region of regions) {
  const [first, last] = region.split('-').map(Number)
  const slice = lines.slice(Math.max(0, first - 1 - widen), last + widen).join('\n')
  report(!pattern.test(slice), `does not match lines ${first}-${last} widened by ${widen}`)
}
