import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { versionParts, isGreater } from './check-release.mjs'
import { setupGit } from './setup-git.mjs'

export function nextVersion(previous, bump = 'patch') {
  const [major, minor, patch] = versionParts(previous)
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`
  throw new Error('--bump 只支持 patch、minor、major')
}
export function finishIteration({ root, summary, files, bump = 'patch' }) {
  root = path.resolve(root)
  if (!summary?.trim() || summary.length > 300 || /[\r\n\x00]/.test(summary)) throw new Error('请提供单行改动说明（最多 300 字符）')
  if (!Array.isArray(files) || !files.length) throw new Error('必须用 --files 指定本次迭代的文件，避免把用户其他改动一起提交')
  files = [...new Set(files.map(file => {
    if (typeof file !== 'string' || path.isAbsolute(file) || /[\x00\r\n]/.test(file)) throw new Error('文件参数必须是项目内的相对路径')
    const resolved = path.resolve(root, file), relative = path.relative(root, resolved).replaceAll('\\', '/')
    if (!relative || relative.startsWith('../') || relative === '..' || relative.split('/').includes('.git')) throw new Error('禁止提交项目以外或 .git 内的路径')
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) throw new Error('请逐个指定文件，不能把整个目录一起暂存：' + file)
    return relative
  }))]
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  if (!setupGit(root)) throw new Error('请在独立项目的 Git 仓库中运行')
  const generated = ['package.json', 'package-lock.json', 'CHANGELOG.md']
  const allowed = new Set([...files, ...generated])
  const staged = git(['diff', '--cached', '--name-only', '-z']).split('\0').filter(Boolean)
  const unrelated = staged.filter(file => !allowed.has(file))
  if (unrelated.length) throw new Error('暂存区存在本次范围以外的改动，请先保留或处理：' + unrelated.join('、'))
  const removed = new Set(git(['diff', '--cached', '--diff-filter=D', '--name-only', '-z']).split('\0').filter(Boolean))
  const filesToAdd = files.filter(file => {
    const ignored = spawnSync('git', ['check-ignore', '-q', '--', file], { cwd: root }).status === 0
    if (!ignored) return true
    if (removed.has(file)) return false // 已经 git rm --cached 的派生文件保持本地存在。
    throw new Error('指定文件已被 .gitignore 忽略：' + file)
  })
  if (!git(['--literal-pathspecs', 'status', '--porcelain', '--', ...files])) throw new Error('指定文件没有改动，不创建空迭代或递增版本')
  const local = path.join(root, '.local')
  fs.mkdirSync(local, { recursive: true })
  const lockFile = path.join(local, 'iteration.lock')
  let lock
  try { lock = fs.openSync(lockFile, 'wx') } catch { throw new Error('另一个迭代流程正在运行；若此前中断，请确认没有运行任务后移除 .local/iteration.lock') }
  try {
    const testDir = path.join(root, 'test')
    const testFiles = fs.existsSync(testDir) ? fs.readdirSync(testDir).filter(file => file.endsWith('.test.mjs')).map(file => path.join(testDir, file)) : []
    if (!testFiles.length) throw new Error('没有找到项目验证用的 test/*.test.mjs')
    console.log('运行验证…')
    const testEnvironment = { ...process.env }
    // 测试中调用迭代命令时，子进程仍需独立执行测试，不能继承 Node 的测试工作进程标记。
    delete testEnvironment.NODE_TEST_CONTEXT
    const test = spawnSync(process.execPath, ['--test', ...testFiles], { cwd: root, env: testEnvironment, stdio: 'inherit', timeout: 120000 })
    if (test.error || test.status !== 0) throw new Error('验证未通过，不递增版本、不创建提交')
    const pkgPath = path.join(root, 'package.json'), pkgLockPath = path.join(root, 'package-lock.json'), changelogPath = path.join(root, 'CHANGELOG.md')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    const pkgLock = JSON.parse(fs.readFileSync(pkgLockPath, 'utf8'))
    const headVersion = JSON.parse(git(['show', 'HEAD:package.json'])).version
    if (pkg.version !== headVersion) throw new Error(`工作区版本 ${pkg.version} 与 HEAD ${headVersion} 不一致，请先处理上一次未完成的版本更新`)
    const version = nextVersion(headVersion, bump)
    if (!isGreater(version, headVersion)) throw new Error('版本号必须递增')
    try { git(['rev-parse', '--verify', `refs/tags/v${version}`]); throw new Error(`标签 v${version} 已存在`) } catch (error) { if (error.message === `标签 v${version} 已存在`) throw error }
    const stagedAfterTest = git(['diff', '--cached', '--name-only', '-z']).split('\0').filter(Boolean)
    if (stagedAfterTest.some(file => !allowed.has(file))) throw new Error('验证期间暂存区出现其他改动，请先处理后再提交')
    pkg.version = version
    pkgLock.version = version
    if (!pkgLock.packages?.['']) throw new Error('package-lock.json 缺少根包数据')
    pkgLock.packages[''].version = version
    const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const changelog = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8').replace(/^\uFEFF/, '') : '# CHANGELOG\n\n'
    const entry = `## [${version}] - ${date}\n\n- ${summary.trim()}\n\n`
    const previousEntries = changelog.replace(/^# CHANGELOG\s*/, '')
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
    fs.writeFileSync(pkgLockPath, JSON.stringify(pkgLock, null, 2) + '\n')
    fs.writeFileSync(changelogPath, '# CHANGELOG\n\n' + entry + previousEntries)
    git(['--literal-pathspecs', 'add', '--', ...filesToAdd, ...generated])
    const title = `chore(release): v${version} ${summary.trim()}`
    console.log(git(['commit', '-m', title]))
    git(['tag', `v${version}`])
    const commit = git(['rev-parse', '--short', 'HEAD'])
    console.log(`迭代完成：v${version} · ${commit}（已本地提交与打标签）`)
    return { version, commit }
  } finally { fs.closeSync(lock); fs.unlinkSync(lockFile) }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), index = args.indexOf('--files'), bumpIndex = args.indexOf('--bump')
    if (index < 1) throw new Error('用法：npm run iterate -- "改动说明" [--bump patch|minor|major] --files <文件...>')
    if (bumpIndex >= index) throw new Error('--bump 必须放在 --files 之前')
    finishIteration({ root: path.resolve(import.meta.dirname, '..'), summary: args[0], bump: bumpIndex >= 0 ? args[bumpIndex + 1] : 'patch', files: args.slice(index + 1) })
  } catch (error) { console.error('迭代未完成：' + error.message); process.exitCode = 1 }
}
