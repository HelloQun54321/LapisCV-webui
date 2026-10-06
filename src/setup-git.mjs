import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export function setupGit(root = path.resolve(import.meta.dirname, '..')) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  let gitRoot
  try { gitRoot = fs.realpathSync(git(['rev-parse', '--show-toplevel'])) } catch { return false }
  if (gitRoot.toLowerCase() !== fs.realpathSync(root).toLowerCase()) return false
  let existing = ''
  try { existing = git(['config', '--local', '--get', 'core.hooksPath']) } catch {}
  if (existing && existing !== '.githooks') throw new Error(`项目已有 core.hooksPath=${existing}，请先合并现有钩子和 .githooks/pre-commit，不会覆盖现有配置`)
  const hook = path.join(root, '.githooks/pre-commit')
  if (fs.existsSync(hook)) fs.chmodSync(hook, 0o755)
  git(['config', '--local', 'core.hooksPath', '.githooks'])
  return true
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(setupGit() ? '项目 Git 提交检查已启用。' : '没有独立 Git 仓库，跳过提交检查安装。') }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
