import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export function versionParts(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error('版本号必须采用 major.minor.patch，例如 2.0.1')
  const parts = value.split('.').map(Number)
  if (parts.some(n => !Number.isSafeInteger(n))) throw new Error('版本号超过安全整数范围')
  return parts
}
export function isGreater(next, previous) {
  const a = versionParts(next), b = versionParts(previous)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}
export function checkRelease(root = process.cwd()) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  let previous
  try { previous = JSON.parse(git(['show', 'HEAD:package.json'])).version } catch { return }
  const pkg = JSON.parse(git(['show', ':package.json']))
  const lock = JSON.parse(git(['show', ':package-lock.json']))
  if (!isGreater(pkg.version, previous)) throw new Error(`当前提交没有递增版本号（HEAD ${previous}，暂存区 ${pkg.version}）。请使用 npm run iterate -- "改动说明" --files <本次文件...> 完成迭代。`)
  if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) throw new Error('package.json 与 package-lock.json 的版本号不同步')
  const changelog = git(['show', ':CHANGELOG.md'])
  if (!changelog.includes(`## [${pkg.version}]`)) throw new Error('CHANGELOG.md 缺少本次版本的变更记录')
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { checkRelease() }
  catch (error) { console.error('提交检查失败：' + error.message); process.exitCode = 1 }
}
