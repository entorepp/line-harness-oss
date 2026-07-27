import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'


const webRoot = resolve(import.meta.dirname, '..')
const redirectsPath = join(webRoot, 'public', '_redirects')
const redirects = readFileSync(redirectsPath, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))

const rules = redirects.map((line) => line.split(/\s+/))
const exact = rules.find(([source]) => source === '/cases')
const nested = rules.find(([source]) => source === '/cases/*')
if (!exact || exact.length !== 3 || exact[2] !== '308') {
  throw new Error('Flat Harness /cases must be a permanent 308 redirect')
}
if (!nested || nested.length !== 3 || nested[2] !== '308') {
  throw new Error('Flat Harness /cases/* must be a permanent 308 redirect')
}

const canonicalCasesUrl = new URL(exact[1])
const nestedTarget = new URL(nested[1].replace(':splat', 'case-id'))
if (canonicalCasesUrl.protocol !== 'https:' || canonicalCasesUrl.pathname !== '/cases') {
  throw new Error('FlatWorker target must be an HTTPS /cases URL')
}
if (nestedTarget.origin !== canonicalCasesUrl.origin || nestedTarget.pathname !== '/cases/case-id') {
  throw new Error('Flat Harness exact and nested case redirects do not share one canonical target')
}

const retiredOrigin = ['https://flatworker', 'flatcare.jp'].join('.')
const sourceRoots = [join(webRoot, 'src'), join(webRoot, 'public')]
const scan = (path) => {
  if (statSync(path).isDirectory()) {
    return readdirSync(path).flatMap((name) => scan(join(path, name)))
  }
  return [path]
}
for (const path of sourceRoots.flatMap(scan)) {
  if (readFileSync(path, 'utf8').includes(retiredOrigin)) {
    throw new Error(`Retired FlatWorker origin remains in ${path}`)
  }
}

const sidebar = readFileSync(join(webRoot, 'src', 'components', 'layout', 'sidebar.tsx'), 'utf8')
if (!sidebar.includes("{ href: '/cases', label: '案件一覧'")) {
  throw new Error('Flat Harness sidebar must route case users through /cases')
}

process.stdout.write(canonicalCasesUrl.toString().replace(/\/$/, ''))
