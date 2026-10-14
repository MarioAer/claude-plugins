// The store's io interface over Node, for tests. Mirrors hooks/io.js, which adapts the mods API.
import { readFile, writeFile, mkdir, lstat, stat, realpath } from 'node:fs/promises'
import { dirname } from 'node:path'
import { execFile } from 'node:child_process'

export function nodeIo({ today = '2026-01-01' } = {}) {
  return {
    async read(path) {
      try { return await readFile(path, 'utf8') } catch { return null }
    },
    async write(path, text) {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, text, 'utf8')
    },
    async stat(path) {
      let link
      try { link = await lstat(path) } catch { return null }
      const isLink = link.isSymbolicLink()
      let target = link
      let realPath
      try { target = await stat(path); realPath = await realpath(path) } catch { /* dangling link */ }
      const kind = target.isFile() ? 'file' : target.isDirectory() ? 'dir' : 'other'
      return { kind: isLink && target === link ? 'other' : kind, isLink, mtimeMs: target.mtimeMs, realPath }
    },
    run(argv, init = {}) {
      return new Promise((resolve) => {
        execFile(argv[0], argv.slice(1), { cwd: init.cwd, timeout: init.timeoutMs ?? 30000 },
          (error, stdout, stderr) => resolve({ exitCode: error ? (error.code ?? 1) : 0, stdout, stderr }))
      })
    },
    sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) },
    today() { return today },
  }
}
