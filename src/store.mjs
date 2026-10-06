import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { themes } from './render.mjs'
import { resolveResumeLayout } from '../web/resume-layout.js'
import { initializeWorkspace } from './initialize.mjs'

export const STATUSES = ['待投递', '已投递', '已回复', '面试中', '已拒', '已关闭']
export class AppError extends Error {
  constructor(message, status = 400, details = {}) { super(message); this.status = status; this.details = details }
}
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function atomicWrite(file, content) {
  const tmp = file + '.' + randomUUID() + '.tmp'
  try { fs.writeFileSync(tmp, content); fs.renameSync(tmp, file) }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) }
}
const read = (file, fallback = '') => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : fallback
const hash = value => createHash('sha256').update(value).digest('hex')
const field = (text, key) => text.match(new RegExp(`^${key}[ \\t]*[:：][ \\t]*([^\\r\\n]*)`, 'm'))?.[1]?.trim() || ''
const safeName = value => value.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, '-').replace(/[. ]+$/, '')
const textField = (value, label, max = 200) => {
  if (typeof value !== 'string' || value.length > max || /[\r\n\x00]/.test(value)) throw new AppError(`${label}格式不正确`)
  return value.trim()
}
export class ResumeStore {
  constructor(root) {
    this.root = path.resolve(root)
    initializeWorkspace(this.root)
    this.resumes = path.join(this.root, 'resumes')
    this.local = path.join(this.root, '.local')
    fs.mkdirSync(path.join(this.local, 'history'), { recursive: true })
    fs.mkdirSync(path.join(this.local, 'trash'), { recursive: true })
  }
  directory(id) {
    if (typeof id !== 'string' || !id || id.length > 180 || id === '.' || id === '..' || /[\\/\x00-\x1f]/.test(id) || id.startsWith('.') || (id.startsWith('_') && id !== '_master')) throw new AppError('无效的简历标识')
    const dir = path.join(this.resumes, id)
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new AppError('简历不存在', 404)
    this.assertInside(dir, this.resumes)
    return dir
  }
  assertInside(file, base = this.root) {
    const relative = path.relative(fs.realpathSync(base), fs.realpathSync(file))
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new AppError('禁止访问项目以外的文件', 403)
    return file
  }
  readFile(dir, name, fallback = '') {
    const file = path.join(dir, name)
    if (fs.existsSync(file)) this.assertInside(file, dir)
    return read(file, fallback)
  }
  get(id) {
    const dir = this.directory(id)
    const markdown = this.readFile(dir, 'resume.md')
    const jd = this.readFile(dir, 'jd.md')
    const rawMeta = this.readFile(dir, 'meta.md')
    const rawSettings = this.readFile(dir, '.webui.json', '{}')
    let settings
    try { settings = JSON.parse(rawSettings) } catch { throw new AppError('简历的 .webui.json 不是有效 JSON', 422) }
    const meta = { company: field(rawMeta, '公司'), title: field(rawMeta, '岗位'), created: field(rawMeta, '创建'), status: field(rawMeta, '状态') || '待投递', notes: field(rawMeta, '备注'), sent: field(rawMeta, '投递日期'), followUp: field(rawMeta, '下次跟进') }
    const revision = hash(JSON.stringify([markdown, jd, rawMeta, rawSettings]))
    const modified = fs.existsSync(path.join(dir, 'resume.md')) ? fs.statSync(path.join(dir, 'resume.md')).mtimeMs : 0
    const theme = resolveResumeLayout(settings.theme || 'classic')
    return { id, markdown, jd, meta, theme, revision, modified, master: id === '_master', archived: id !== '_master' && settings.archived === true, proof: this.proofInfo(id, { markdown, theme }) }
  }
  list() {
    return fs.readdirSync(this.resumes, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.isSymbolicLink() && (d.name === '_master' || !/^[_.]/.test(d.name)))
      .filter(d => fs.existsSync(path.join(this.resumes, d.name, 'resume.md')))
      .map(d => { const { markdown, jd, ...rest } = this.get(d.name); return { ...rest, hasJd: !!jd.trim(), characters: markdown.length } })
      .sort((a, b) => Number(b.master) - Number(a.master) || b.modified - a.modified)
  }
  checkRevision(current, revision) {
    if (revision !== current.revision) throw new AppError('文件已有更新。请先加载最新版本，或保留当前草稿再合并。', 409, { current })
  }
  historyDir(id) { return path.join(this.local, 'history', Buffer.from(id).toString('base64url')) }
  snapshot(current, reason = '保存前备份', label = '') {
    const dir = this.historyDir(current.id)
    fs.mkdirSync(dir, { recursive: true })
    this.assertInside(dir, this.local)
    const version = `${Date.now()}-${randomUUID()}`
    atomicWrite(path.join(dir, version + '.json'), JSON.stringify({ ...current, version, timestamp: Date.now(), reason, label, pinned: !!label }))
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse()
    const automatic = files.filter(file => !JSON.parse(read(path.join(dir, file))).pinned)
    for (const file of automatic.slice(40)) fs.unlinkSync(path.join(dir, file))
    return this.version(current.id, version)
  }
  save(id, input, reason) {
    const current = this.get(id)
    this.checkRevision(current, input.revision)
    const markdown = input.markdown ?? current.markdown
    const jd = input.jd ?? current.jd
    if (typeof markdown !== 'string' || Buffer.byteLength(markdown) > 1024 * 1024 || typeof jd !== 'string' || Buffer.byteLength(jd) > 1024 * 1024) throw new AppError('简历或 JD 超过 1 MB 限制')
    const theme = resolveResumeLayout(input.theme ?? current.theme)
    if (!themes(this.root).includes(theme)) throw new AppError('主题不存在')
    const meta = { ...current.meta, ...input.meta }
    for (const key of ['sent', 'followUp']) {
      meta[key] = textField(meta[key] ?? '', key)
      this.validateDate(meta[key])
    }
    for (const key of ['company', 'title', 'created', 'status', 'notes']) meta[key] = textField(meta[key], key, key === 'notes' ? 2000 : 200)
    if (!STATUSES.includes(meta.status)) throw new AppError('投递状态无效')
    if (JSON.stringify([markdown, jd, theme, meta]) === JSON.stringify([current.markdown, current.jd, current.theme, current.meta])) return current
    this.snapshot(current, reason)
    const dir = this.directory(id)
    atomicWrite(path.join(dir, 'resume.md'), markdown)
    if (!current.master) {
      atomicWrite(path.join(dir, 'jd.md'), jd)
      let raw = this.readFile(dir, 'meta.md')
      for (const [key, label] of Object.entries({ company: '公司', title: '岗位', created: '创建', status: '状态', sent: '投递日期', followUp: '下次跟进', notes: '备注' })) {
        const re = new RegExp(`^${label}[ \\t]*[:：][^\\r\\n]*`, 'm')
        raw = re.test(raw) ? raw.replace(re, () => `${label}: ${meta[key]}`) : raw.trimEnd() + `\n${label}: ${meta[key]}\n`
      }
      atomicWrite(path.join(dir, 'meta.md'), raw)
    }
    const settings = JSON.parse(this.readFile(dir, '.webui.json', '{}'))
    atomicWrite(path.join(dir, '.webui.json'), JSON.stringify({ ...settings, theme }, null, 2) + '\n')
    this.writeIndex()
    return this.get(id)
  }
  create(input) {
    const company = textField(input.company, '公司')
    const title = textField(input.title, '岗位')
    if (!company || !title) throw new AppError('请填写公司和岗位')
    if (input.jd != null && (typeof input.jd !== 'string' || Buffer.byteLength(input.jd) > 1024 * 1024)) throw new AppError('JD 格式无效或超过 1 MB 限制')
    const id = `${safeName(company)}-${safeName(title)}`
    if (id.length > 150 || /^[_.]/.test(id) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(id)) throw new AppError('文件夹名称无效或过长')
    const dir = path.join(this.resumes, id)
    if (fs.existsSync(dir)) throw new AppError('同名投递已存在，请使用不同的公司或岗位名', 409)
    const source = this.get(input.source || '_master')
    fs.mkdirSync(dir)
    atomicWrite(path.join(dir, 'resume.md'), source.markdown)
    atomicWrite(path.join(dir, 'jd.md'), typeof input.jd === 'string' ? input.jd : '')
    atomicWrite(path.join(dir, 'meta.md'), `公司: ${company}\n岗位: ${title}\n创建: ${localDate()}\n状态: 待投递\n备注: \n`)
    atomicWrite(path.join(dir, '.webui.json'), JSON.stringify({ theme: source.theme }, null, 2) + '\n')
    this.writeIndex()
    return this.get(id)
  }
  history(id) {
    this.directory(id)
    const dir = this.historyDir(id)
    if (!fs.existsSync(dir)) return []
    this.assertInside(dir, this.local)
    return fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse().map(file => {
      this.assertInside(path.join(dir, file), this.local)
      const { version, timestamp, reason, markdown, theme, label = '', pinned = false } = JSON.parse(read(path.join(dir, file)))
      return { version, timestamp, reason, theme, label, pinned, characters: markdown.length }
    })
  }
  version(id, version) {
    this.directory(id)
    if (!/^\d+-[a-f0-9-]{36}$/.test(version)) throw new AppError('历史版本标识无效')
    const file = path.join(this.historyDir(id), version + '.json')
    if (!fs.existsSync(file)) throw new AppError('历史版本不存在', 404)
    this.assertInside(file, this.local)
    return JSON.parse(read(file))
  }
  validateDate(value) {
    if (!value) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AppError('日期须为 YYYY-MM-DD')
    const date = new Date(value + 'T12:00:00')
    if (!Number.isFinite(date.getTime()) || localDate(date) !== value) throw new AppError('日期无效')
  }
  checkpoint(id, input) {
    const current = this.get(id)
    this.checkRevision(current, input.revision)
    const label = textField(input.label, '版本名称', 80)
    if (!label) throw new AppError('请填写版本名称')
    return this.snapshot(current, '手动保留版本', label)
  }
  nameVersion(id, version, input) {
    const old = this.version(id, version)
    const label = textField(input.label, '版本名称', 80)
    atomicWrite(path.join(this.historyDir(id), version + '.json'), JSON.stringify({ ...old, label, pinned: !!label }))
    return this.version(id, version)
  }
  contentHash(doc) { return hash(JSON.stringify([doc.markdown, doc.theme])) }
  renderVersion(theme) {
    // 样式和素材发生外部修改时，旧校样也必须提示更新。
    const assets = path.join(this.root, 'assets'), stamps = []
    const walk = dir => {
      if (!fs.existsSync(dir)) return
      for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (item.isSymbolicLink()) continue
        const file = path.join(dir, item.name)
        if (item.isDirectory()) walk(file)
        else { const stat = fs.statSync(file); stamps.push([path.relative(assets, file), stat.size, stat.mtimeMs]) }
      }
    }
    walk(assets)
    return hash(JSON.stringify([theme, stamps]))
  }
  proofInfo(id, doc) {
    const file = path.join(this.local, 'proofs', Buffer.from(id).toString('base64url') + '.json')
    if (!fs.existsSync(file)) return null
    this.assertInside(file, this.local)
    const report = JSON.parse(read(file))
    return { ...report, current: report.contentHash === this.contentHash(doc) && report.renderVersion === this.renderVersion(doc.theme) }
  }
  recordProof(snapshot, pages, rendering = this.renderVersion(snapshot.theme)) {
    const dir = path.join(this.local, 'proofs'); fs.mkdirSync(dir, { recursive: true })
    this.assertInside(dir, this.local)
    const report = { pages, timestamp: Date.now(), revision: snapshot.revision, contentHash: this.contentHash(snapshot), renderVersion: rendering }
    atomicWrite(path.join(dir, Buffer.from(snapshot.id).toString('base64url') + '.json'), JSON.stringify(report))
    return report
  }
  finalDir(id) { return path.join(this.local, 'finals', Buffer.from(id).toString('base64url')) }
  saveFinal(snapshot, pdf, input) {
    const current = this.get(snapshot.id)
    this.checkRevision(current, snapshot.revision)
    if (current.master) throw new AppError('请先创建投递子版，再保存投递定稿')
    const label = textField(input.label, '定稿名称', 80)
    if (!label) throw new AppError('请填写定稿名称')
    const date = textField(input.date || localDate(), '定稿日期')
    this.validateDate(date)
    const version = `${Date.now()}-${randomUUID()}`, dir = path.join(this.finalDir(snapshot.id), version)
    const base = this.finalDir(snapshot.id)
    if (fs.existsSync(base)) this.assertInside(base, this.local)
    fs.mkdirSync(dir, { recursive: true })
    this.assertInside(dir, this.local)
    const record = { ...snapshot, proof: undefined, version, label, date, timestamp: Date.now(), pages: (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, pdfHash: hash(pdf) }
    atomicWrite(path.join(dir, 'resume.pdf'), pdf)
    atomicWrite(path.join(dir, 'snapshot.json'), JSON.stringify(record))
    return record
  }
  finals(id) {
    this.directory(id)
    const dir = this.finalDir(id)
    if (!fs.existsSync(dir)) return []
    this.assertInside(dir, this.local)
    return fs.readdirSync(dir).filter(version => /^\d+-[a-f0-9-]{36}$/.test(version)).sort().reverse().filter(version => fs.existsSync(path.join(dir, version, 'snapshot.json'))).map(version => {
      const { label, date, timestamp, pages, revision, pdfHash } = this.final(id, version)
      return { version, label, date, timestamp, pages, revision, pdfHash }
    })
  }
  final(id, version) {
    this.directory(id)
    if (!/^\d+-[a-f0-9-]{36}$/.test(version)) throw new AppError('定稿标识无效')
    const file = path.join(this.finalDir(id), version, 'snapshot.json')
    if (!fs.existsSync(file)) throw new AppError('定稿不存在', 404)
    this.assertInside(file, this.local)
    return JSON.parse(read(file))
  }
  finalPdf(id, version) {
    const record = this.final(id, version), file = path.join(this.finalDir(id), version, 'resume.pdf')
    this.assertInside(file, this.local)
    const bytes = fs.readFileSync(file)
    if (hash(bytes) !== record.pdfHash) throw new AppError('定稿 PDF 已被外部修改，请从备份恢复', 422)
    return bytes
  }
  setArchived(id, input) {
    const current = this.get(id)
    if (current.master) throw new AppError('母版不能归档')
    this.checkRevision(current, input.revision)
    if (typeof input.archived !== 'boolean') throw new AppError('归档状态无效')
    if (current.archived === input.archived) return current
    this.snapshot(current, input.archived ? '归档前备份' : '取消归档前备份')
    const dir = this.directory(id), settings = JSON.parse(this.readFile(dir, '.webui.json', '{}'))
    atomicWrite(path.join(dir, '.webui.json'), JSON.stringify({ ...settings, archived: input.archived }, null, 2) + '\n')
    this.writeIndex()
    return this.get(id)
  }
  // 兼容旧版本的调用；旧 archive 操作始终表示移入回收站。
  archive(id, revision) { return this.moveToTrash(id, revision) }
  moveToTrash(id, revision) {
    if (id === '_master') throw new AppError('母版不能移入回收站')
    this.checkRevision(this.get(id), revision)
    const dir = this.directory(id)
    const key = randomUUID()
    atomicWrite(path.join(dir, '.trash-info.json'), JSON.stringify({ id, key, timestamp: Date.now() }))
    fs.renameSync(dir, path.join(this.local, 'trash', key))
    this.writeIndex()
  }
  trash() {
    return fs.readdirSync(path.join(this.local, 'trash'), { withFileTypes: true }).filter(d => d.isDirectory() && !d.isSymbolicLink()).map(d => JSON.parse(read(path.join(this.local, 'trash', d.name, '.trash-info.json')))).sort((a, b) => b.timestamp - a.timestamp)
  }
  restoreTrash(key) {
    const item = this.trash().find(x => x.key === key)
    if (!item) throw new AppError('回收站记录不存在', 404)
    const target = path.join(this.resumes, item.id)
    if (fs.existsSync(target)) throw new AppError('同名简历已经存在，恢复前请先处理重名', 409)
    fs.renameSync(path.join(this.local, 'trash', key), target)
    fs.unlinkSync(path.join(target, '.trash-info.json'))
    this.writeIndex()
    return this.get(item.id)
  }
  writeIndex() {
    const apps = this.list().filter(d => !d.master)
    const cell = value => value.replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ')
    const rows = apps.map(({ id, meta, hasJd, archived }) => `| ${cell(meta.company)} | ${cell(meta.title)} | ${meta.created} | ${meta.status} | ${archived ? '已归档' : '—'} | ${meta.sent || '—'} | ${meta.followUp || '—'} | ${hasJd ? '✓' : '—'} | [resume.md](${encodeURIComponent(id)}/resume.md) | ${fs.existsSync(path.join(this.resumes, id, 'resume.pdf')) ? `[resume.pdf](${encodeURIComponent(id)}/resume.pdf)` : '未生成'} |`)
    atomicWrite(path.join(this.resumes, 'INDEX.md'), `# 投递总览\n\n共 ${apps.length} 份 · 更新于 ${localDate()}\n\n| 公司 | 岗位 | 创建 | 状态 | 归档 | 投递日期 | 下次跟进 | JD | 子版 | 产物 |\n|---|---|---|---|---|---|---|---|---|---|\n${rows.length ? rows.join('\n') : '| — | — | — | — | — | — | — | — | — | — |'}\n\n> 本文件由 WebUI 或 \`npm run apps\` 自动生成，不要手改。\n`)
  }
}
