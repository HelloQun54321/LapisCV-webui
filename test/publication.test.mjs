import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { initializeWorkspace } from '../src/initialize.mjs'
import { publicationIssues, checkPublication } from '../src/check-publication.mjs'

function fixture(t) {
  const base = os.tmpdir(), root = fs.mkdtempSync(path.join(base, 'resume-public-test-'))
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(base) + path.sep))
    fs.rmSync(root, { recursive: true, force: true })
  })
  fs.mkdirSync(path.join(root, 'examples'))
  fs.writeFileSync(path.join(root, 'examples/resume.md'), '# 虚构示例\n')
  fs.writeFileSync(path.join(root, 'examples/template.md'), '# 空白模板\n')
  return root
}

test('首次生成私有工作数据，再次初始化及示例更新不覆盖已有母版', t => {
  const root = fixture(t)
  assert.deepEqual(initializeWorkspace(root), ['resumes/_master/resume.md', 'resumes/_template.md'])
  const master = path.join(root, 'resumes/_master/resume.md')
  fs.writeFileSync(master, '# 已编辑的私有母版\n')
  fs.writeFileSync(path.join(root, 'examples/resume.md'), '# 新版示例\n')
  assert.deepEqual(initializeWorkspace(root), [])
  assert.equal(fs.readFileSync(master, 'utf8'), '# 已编辑的私有母版\n')
  assert.equal(fs.readFileSync(path.join(root, 'examples/resume.md'), 'utf8'), '# 新版示例\n')
})

test('发布副本 Git 忽略个人文件，强制暂存会被检查拦截', t => {
  const root = fixture(t)
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init', '-q'])
  fs.copyFileSync(path.resolve(import.meta.dirname, '../.gitignore'), path.join(root, '.gitignore'))
  initializeWorkspace(root)
  for (const name of ['resumes/_master/resume.md', 'resumes/_master/.webui.json', 'resumes/公司-岗位/jd.md', 'assets/uploads/photo.png', '.local/history/private.json', '.env', 'backup.zip']) {
    assert.equal(git(['-c', 'core.quotepath=false', 'check-ignore', '--', name]).trim(), name)
  }
  git(['add', '--', '.gitignore', 'examples/resume.md', 'examples/template.md'])
  assert.equal(checkPublication(root, { staged: true }), 3)
  git(['add', '-f', '--', 'resumes/_master/resume.md'])
  assert.throws(() => checkPublication(root, { staged: true }), /个人数据/)
})

test('发布检查同时扫描旧提交，删掉当前文件不能掩盖历史泄漏', t => {
  const root = fixture(t)
  const git = args => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init', '-q'])
  git(['config', 'user.name', 'Publication Test'])
  git(['config', 'user.email', 'test@example.com'])
  fs.mkdirSync(path.join(root, 'resumes/_master'), { recursive: true })
  fs.writeFileSync(path.join(root, 'resumes/_master/resume.md'), '# 历史测试数据\n')
  git(['add', '--', 'resumes/_master/resume.md'])
  git(['commit', '-qm', 'fixture baseline'])
  git(['rm', '--', 'resumes/_master/resume.md'])
  git(['commit', '-qm', 'remove fixture'])
  assert.equal(checkPublication(root, { staged: true }), 0)
  assert.throws(() => checkPublication(root), /个人数据/)
})

test('发布检查拦截令牌与私钥，允许虚构示例和字体二进制', () => {
  assert.equal(publicationIssues([{ name: 'examples/resume.md', content: 'lin@example.com' }]).length, 0)
  assert.equal(publicationIssues([{ name: 'assets/fonts/font.ttf', content: Buffer.from([0, 1, 2]) }]).length, 0)
  assert.equal(publicationIssues([{ name: 'token.txt', content: 'ghp_' + 'a'.repeat(36) }]).length, 1)
  assert.equal(publicationIssues([{ name: 'key.txt', content: ['-----BEGIN ', 'PRIVATE KEY-----'].join('') }]).length, 1)
})
