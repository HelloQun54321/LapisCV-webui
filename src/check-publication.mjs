import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function publicationIssues(entries) {
  const issues = []
  for (const { name, content } of entries) {
    const file = name.replaceAll('\\', '/')
    if (/^(?:resumes|\.local|assets\/uploads)\//i.test(file)
      || /(?:^|\/)\.env(?:$|\.(?!example$|sample$))/i.test(file)
      || /\.(?:pdf|docx|zip|bak)$/i.test(file)) {
      issues.push(`${file}：个人数据、凭据或备份路径不可发布`)
    }
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content || '')
    if (buffer.includes(0)) continue // 字体、图标等二进制素材另行人工核对来源。
    const text = buffer.toString('utf8')
    if (/(?:github_pat_[A-Za-z0-9_]{22,}|gh[pousr]_[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(text)) {
      issues.push(`${file}：疑似访问令牌或私钥，请先移除并撤销凭据`)
    }
  }
  return issues
}

export function checkPublication(root = process.cwd(), { staged = false } = {}) {
  const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 })
  const records = new Map()
  const collect = (output, index) => {
    for (const record of output.toString('utf8').split('\0').filter(Boolean)) {
      const tab = record.indexOf('\t')
      const [mode, typeOrHash, hashOrStage] = record.slice(0, tab).split(' ')
      if (!index && typeOrHash !== 'blob') continue
      const name = record.slice(tab + 1), hash = index ? typeOrHash : hashOrStage
      records.set(name + '\0' + hash, { name, hash })
    }
  }
  collect(git(['ls-files', '--stage', '-z']), true)
  if (!staged) {
    const commits = git(['rev-list', '--all']).toString('utf8').trim().split('\n').filter(Boolean)
    for (const commit of commits) collect(git(['ls-tree', '-r', '-z', commit]), false)
  }
  const issues = publicationIssues([...records.values()].map(({ name, hash }) => ({ name, content: git(['cat-file', 'blob', hash]) })))
  if (issues.length) throw new Error([...new Set(issues)].join('\n'))
  return records.size
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const count = checkPublication(process.cwd(), { staged: process.argv.includes('--staged') })
    console.log(`发布检查通过：${count} 个文件版本；请继续人工核对截图与新增示例中的个人信息。`)
  } catch (error) { console.error('发布检查失败：' + error.message); process.exitCode = 1 }
}
