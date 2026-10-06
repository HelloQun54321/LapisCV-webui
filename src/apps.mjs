// 投递文件夹管理。
//
// 工作方式:resumes/_master/resume.md 是母版(唯一真相,只维护你的真实信息)。
// 每拿到一份 JD,就从母版**整份复制**出一个子版,放进以「公司-岗位」命名的文件夹里改。
// 复制而不是引用,是为了让每份子版自包含:母版以后再改,已经投出去的那些不受影响。
//
// 用法:
//   node src/apps.mjs new "<公司>" "<岗位>"        新建投递文件夹(从母版复制一份子版)
//   node src/apps.mjs index                        重新生成 resumes/INDEX.md
//   node src/apps.mjs status "<公司-岗位>" "<状态>"  改某份投递的状态
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const RESUMES = path.join(root, 'resumes')
const MASTER = path.join(RESUMES, '_master', 'resume.md')
const INDEX = path.join(RESUMES, 'INDEX.md')
// 取本地日期。不能用 toISOString():那是 UTC,在东八区会整体差一天
const _d = new Date()
const TODAY = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, '0')}-${String(_d.getDate()).padStart(2, '0')}`

const [cmd, ...args] = process.argv.slice(2)

const STATUSES = ['待投递', '已投递', '已回复', '面试中', '已拒', '已关闭']
// 文件名以 _ 开头的目录是内部目录(_master),不算投递记录
const isApp = (name) => !name.startsWith('_') && !name.startsWith('.')

function die(msg) {
  console.error(msg)
  process.exit(1)
}
function usage() {
  die(
    '用法:\n' +
      '  node src/apps.mjs new "<公司>" "<岗位>"\n' +
      '  node src/apps.mjs index\n' +
      '  node src/apps.mjs status "<公司-岗位>" "<状态>"\n' +
      `\n状态可选:${STATUSES.join(' / ')}`,
  )
}

// 文件夹名要能跨平台落地:Windows 不允许 \ / : * ? " < > |,空格折成连字符
function safeName(s) {
  return String(s)
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '-')
    .replace(/[. ]+$/, '')
}

const jdSkeleton = (company, title) => `# JD 原文

> 把岗位描述**原样**贴到这里,不要改成摘要。
> 以后回头核对「当时到底要求什么」要靠它。

- 公司:${company}
- 岗位:${title}
- 来源链接:
- 抓取时间:${TODAY}

---

(在这里粘贴 JD 原文)
`

const metaSkeleton = (company, title) => `公司: ${company}
岗位: ${title}
创建: ${TODAY}
状态: 待投递
`

// meta.md 是手改友好的 "键: 值" 格式,改动后跑 index 即可反映到总览
function readMeta(dir) {
  const f = path.join(dir, 'meta.md')
  const meta = { 公司: '', 岗位: '', 创建: '', 状态: '', 投递日期: '', 下次跟进: '' }
  if (!fs.existsSync(f)) return meta
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([^:：]+)\s*[:：]\s*(.*)$/.exec(line)
    if (m && m[1].trim() in meta) meta[m[1].trim()] = m[2].trim()
  }
  return meta
}

function listApps() {
  if (!fs.existsSync(RESUMES)) return []
  return fs
    .readdirSync(RESUMES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && isApp(d.name))
    .map((d) => d.name)
    .sort()
}

function writeIndex() {
  const apps = listApps()
  const rows = apps.map((name) => {
    const dir = path.join(RESUMES, name)
    const m = readMeta(dir)
    const settingsFile = path.join(dir, '.webui.json')
    const archived = fs.existsSync(settingsFile) && JSON.parse(fs.readFileSync(settingsFile, 'utf8')).archived === true
    const hasPdf = fs.existsSync(path.join(dir, 'resume.pdf'))
    const hasJd = fs.existsSync(path.join(dir, 'jd.md'))
    const link = (f) => (fs.existsSync(path.join(dir, f)) ? `[${f}](${encodeURI(name)}/${f})` : '—')
    const cell = value => value.replace(/\|/g, '\\|')
    return `| ${cell(m.公司 || '?')} | ${cell(m.岗位 || '?')} | ${m.创建 || '?'} | ${m.状态 || '待投递'} | ${archived ? '已归档' : '—'} | ${m.投递日期 || '—'} | ${m.下次跟进 || '—'} | ${hasJd ? '✓' : '—'} | ${link('resume.md')} | ${hasPdf ? link('resume.pdf') : '未生成'} |`
  })

  const out = `# 投递总览

共 ${apps.length} 份 · 更新于 ${TODAY}

| 公司 | 岗位 | 创建 | 状态 | 归档 | 投递日期 | 下次跟进 | JD | 子版 | 产物 |
|---|---|---|---|---|---|---|---|---|---|
${rows.length ? rows.join('\n') : '| — | — | — | — | — | — | — | — | — | — |'}

> 本文件由 \`npm run apps\` 自动生成,**不要手改**。
> 状态改在各自文件夹的 \`meta.md\` 里,然后重新生成即可。
> 状态取值:${STATUSES.join(' / ')}
`
  fs.writeFileSync(INDEX, out, 'utf8')
  return apps.length
}

function cmdNew(company, title) {
  if (!company || !title) usage()
  if (!fs.existsSync(MASTER)) {
    die(`找不到母版:${path.relative(root, MASTER)}\n先把你的真实简历写进母版,再从母版复制子版。`)
  }
  const name = `${safeName(company)}-${safeName(title)}`
  const dir = path.join(RESUMES, name)
  // 绝不覆盖:已存在的文件夹里可能有一份针对该岗位改好的子版,那是不可再生的
  if (fs.existsSync(dir)) {
    die(
      `已存在投递文件夹:resumes/${name}\n` +
        '为免覆盖已经改好的子版,这里不会自动处理。\n' +
        '换个岗位名,或先把旧文件夹改名/删除。',
    )
  }
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(MASTER, path.join(dir, 'resume.md')) // 整份复制,自包含
  fs.writeFileSync(path.join(dir, 'jd.md'), jdSkeleton(company, title), 'utf8')
  fs.writeFileSync(path.join(dir, 'meta.md'), metaSkeleton(company, title), 'utf8')
  const total = writeIndex()

  console.log(`✓ 新建投递文件夹: resumes/${name}`)
  console.log('  ├─ resume.md   子版(从母版复制,在这里针对 JD 改)')
  console.log('  ├─ jd.md       把 JD 原文贴进来')
  console.log('  └─ meta.md     投递状态')
  console.log(`✓ 投递总览已更新: resumes/INDEX.md(共 ${total} 份)`)
  console.log(`\n下一步:\n  node src/build.mjs resumes/${name}/resume.md resumes/${name}/resume.pdf`)
}

function cmdStatus(folder, status) {
  if (!folder || !status) usage()
  const name = safeName(folder)
  const dir = path.join(RESUMES, name)
  if (!fs.existsSync(path.join(dir, 'meta.md'))) {
    die(`找不到 resumes/${name}/meta.md。现有投递记录:\n  ${listApps().join('\n  ') || '(无)'}`)
  }
  const f = path.join(dir, 'meta.md')
  let text = fs.readFileSync(f, 'utf8')
  if (/^\s*状态\s*[:：]/m.test(text)) text = text.replace(/^\s*状态\s*[:：].*$/m, `状态: ${status}`)
  else text = text.trimEnd() + `\n状态: ${status}\n`
  fs.writeFileSync(f, text, 'utf8')
  writeIndex()
  console.log(`✓ resumes/${name} 状态 → ${status}(总览已同步)`)
  if (!STATUSES.includes(status)) console.log(`  提示:常用状态是 ${STATUSES.join(' / ')}`)
}

switch (cmd) {
  case 'new':
    cmdNew(args[0], args[1])
    break
  case 'index':
    console.log(`✓ 投递总览已更新: resumes/INDEX.md(共 ${writeIndex()} 份)`)
    break
  case 'status':
    cmdStatus(args[0], args[1])
    break
  default:
    usage()
}
