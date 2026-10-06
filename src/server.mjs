import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID, randomBytes } from 'node:crypto'
import { ResumeStore, AppError, STATUSES, atomicWrite } from './store.mjs'
import { renderResume, themes } from './render.mjs'
import { findBrowser, requireNativeBrowser, launchBrowser, removeDirQuietly } from './browser.mjs'
import { buildWeb } from './build-web.mjs'
import { buildBackup } from './backup.mjs'

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ttf': 'font/ttf', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' }
const PREVIEW_CSP = "default-src 'none'; img-src 'self' data:; font-src 'self'; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'"
async function bodyJson(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError('请求需要 JSON 格式', 415)
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 8 * 1024 * 1024) throw new AppError('请求超过 8 MB 限制', 413)
    chunks.push(chunk)
  }
  try { const data = JSON.parse(Buffer.concat(chunks).toString()); if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error(); return data }
  catch { throw new AppError('JSON 格式不正确') }
}
const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)) }

export function createApp({ root = path.resolve(import.meta.dirname, '..') } = {}) {
  const store = new ResumeStore(root)
  const token = randomBytes(32).toString('hex')
  let pendingExports = 0
  let exportQueue = Promise.resolve()
  let backingUp = false
  const downloads = new Map()
  function downloadable(bytes, filename, mime) {
    for (const [key, item] of downloads) if (Date.now() - item.created > 300000) downloads.delete(key)
    while (downloads.size >= 12) downloads.delete(downloads.keys().next().value)
    const key = randomUUID()
    downloads.set(key, { bytes, filename, mime, created: Date.now() })
    return { url: '/api/downloads/' + key, filename }
  }
  const exportPdf = async snapshot => {
    const rendering = store.renderVersion(snapshot.theme)
    const browserPath = findBrowser()
    requireNativeBrowser(browserPath, 'WebUI PDF 导出')
    const temp = path.join(root, '.local', 'exports', randomUUID())
    fs.mkdirSync(temp, { recursive: true })
    const htmlPath = path.join(temp, 'resume.html')
    const { html } = renderResume({ root, markdown: snapshot.markdown, theme: snapshot.theme, htmlPath })
    atomicWrite(htmlPath, html)
    let browser
    try {
      browser = await launchBrowser(browserPath, ['--disable-lcd-text'])
      const page = await browser.newPage()
      await page.setJavaScriptEnabled(false)
      await page.setRequestInterception(true)
      page.on('request', request => {
        try {
          const url = new URL(request.url())
          if (url.protocol === 'data:') return request.continue()
          if (url.protocol !== 'file:') return request.abort()
          const file = fileURLToPath(url)
          if (file !== htmlPath) store.assertInside(file, path.join(root, 'assets'))
          return request.continue()
        } catch { return request.abort() }
      })
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0', timeout: 30000 })
      await page.emulateMediaType('print')
      const report = await page.evaluate(async () => {
        await document.fonts.ready
        const cs = getComputedStyle(document.body)
        const want = ['--text-font', '--title-font'].map(k => cs.getPropertyValue(k).trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
        return want.map(family => ({ family, statuses: [...document.fonts].filter(f => f.family.replace(/^['"]|['"]$/g, '') === family).map(f => f.status) }))
      })
      if (report.some(f => !f.statuses.length || f.statuses.includes('error'))) throw new AppError('正文或标题字体未能加载，请检查主题字体配置', 422)
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, timeout: 30000 })
      // 只把当前版本的导出写回目录，编辑中产生的新版本不会被旧任务覆盖。
      try {
        if (store.get(snapshot.id).revision === snapshot.revision) {
          const dir = store.directory(snapshot.id)
          atomicWrite(path.join(dir, 'resume.pdf'), pdf)
          atomicWrite(path.join(dir, 'resume.html'), renderResume({ root, markdown: snapshot.markdown, theme: snapshot.theme, htmlPath: path.join(dir, 'resume.html') }).html)
          store.recordProof(snapshot, (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, rendering)
          store.writeIndex()
        }
      } catch (error) { if (error.status !== 404) throw error }
      return Buffer.from(pdf)
    } finally { if (browser) await browser.close(); removeDirQuietly(temp) }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    try {
      const port = server.address()?.port
      const hosts = [`127.0.0.1:${port}`, `localhost:${port}`]
      if (!hosts.includes(req.headers.host)) throw new AppError('仅允许本机地址访问', 403)
      const origin = req.headers.origin
      if (origin && !hosts.map(h => `http://${h}`).includes(origin)) throw new AppError('拒绝跨站请求', 403)
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new AppError('拒绝跨站请求', 403)
      if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-local-token'] !== token) throw new AppError('本地会话已失效，请刷新页面', 403)
      const url = new URL(req.url, `http://${req.headers.host}`)
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      const [namespace, resource, id, action, version] = parts
      if (namespace === 'api') {
        if (req.method === 'GET' && resource === 'health') return json(res, { app: 'resume-cn-webui', root: path.resolve(root), pid: process.pid })
        if (req.method === 'GET' && resource === 'bootstrap') {
          let browser = null, browserError = null
          try { browser = findBrowser(); requireNativeBrowser(browser, 'WebUI') } catch (e) { browserError = e.message }
          return json(res, { token, themes: themes(root), statuses: STATUSES, documents: store.list(), browser, browserError, root })
        }
        if (resource === 'documents') {
          if (!id && req.method === 'GET') return json(res, store.list())
          if (!id && req.method === 'POST') return json(res, store.create(await bodyJson(req)), 201)
          if (id && !action && req.method === 'GET') return json(res, store.get(id))
          if (id && !action && req.method === 'PUT') return json(res, store.save(id, await bodyJson(req)))
          if (action === 'history' && req.method === 'GET') return json(res, version ? store.version(id, version) : store.history(id))
          if (action === 'history' && !version && req.method === 'POST') return json(res, store.checkpoint(id, await bodyJson(req)), 201)
          if (action === 'history' && version && req.method === 'PATCH') return json(res, store.nameVersion(id, version, await bodyJson(req)))
          if (action === 'proof' && req.method === 'GET') return json(res, store.get(id).proof)
          if (action === 'finals' && req.method === 'GET') return json(res, version ? store.final(id, version) : store.finals(id))
          if (action === 'finals' && version && req.method === 'POST') {
            const record = store.final(id, version)
            return json(res, downloadable(store.finalPdf(id, version), `${id}-${record.date}-${record.label.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')}.pdf`, 'application/pdf'))
          }
          if (action === 'restore' && req.method === 'POST') {
            const input = await bodyJson(req)
            const old = store.version(id, input.version)
            return json(res, store.save(id, { markdown: old.markdown, jd: old.jd, theme: old.theme, meta: { ...old.meta, sent: old.meta.sent || '', followUp: old.meta.followUp || '' }, revision: input.revision }, '恢复历史前备份'))
          }
          if (action === 'archived' && req.method === 'PATCH') return json(res, store.setArchived(id, await bodyJson(req)))
          // 保留旧版 /archive 的删除语义，避免旧页面在服务重启后执行成归档。
          if ((action === 'trash' || action === 'archive') && req.method === 'POST') { store.moveToTrash(id, (await bodyJson(req)).revision); return json(res, { ok: true }) }
          if ((action === 'export' || action === 'finals' && !version) && req.method === 'POST') {
            const input = await bodyJson(req)
            const snapshot = store.get(id)
            store.checkRevision(snapshot, input.revision)
            if (action === 'finals') {
              if (snapshot.master) throw new AppError('请先创建投递子版，再保存投递定稿')
              if (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 80 || /[\r\n\x00]/.test(input.label)) throw new AppError('定稿名称须为 1–80 个字符')
              store.validateDate(input.date || '')
            }
            if (pendingExports >= 3) throw new AppError('导出任务较多，请稍后重试', 503)
            pendingExports++
            const job = exportQueue.then(() => exportPdf(snapshot))
            exportQueue = job.catch(() => {})
            try {
              const pdf = await job
              if (action === 'finals') return json(res, store.saveFinal(snapshot, pdf, input), 201)
              const filename = (snapshot.master ? '母版简历' : id) + '.pdf'
              const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length
              if (req.headers.accept === 'application/json') return json(res, { ...downloadable(pdf, filename, 'application/pdf'), pages, proof: (() => { try { return store.get(id).proof } catch { return null } })(), saved: (() => { try { return store.get(id).revision === snapshot.revision } catch { return false } })() })
              res.writeHead(200, { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="resume.pdf"; filename*=UTF-8''${encodeURIComponent((snapshot.master ? '母版简历' : id) + '.pdf')}`, 'X-Resume-Revision': snapshot.revision })
              return res.end(pdf)
            } finally { pendingExports-- }
          }
        }
        if (resource === 'backup' && req.method === 'POST') {
          if (backingUp) throw new AppError('正在准备备份，请稍后重试', 409)
          backingUp = true
          try { const backup = await buildBackup(root); return json(res, { ...downloadable(backup.bytes, backup.filename, 'application/zip'), files: backup.files }) }
          finally { backingUp = false }
        }
        if (resource === 'downloads' && !id && req.method === 'POST') {
          const input = await bodyJson(req)
          if (typeof input.text !== 'string' || Buffer.byteLength(input.text) > 2 * 1024 * 1024 || typeof input.filename !== 'string' || !/^[^\\/\x00-\x1f]{1,200}\.(md|json|txt)$/i.test(input.filename)) throw new AppError('下载内容或文件名无效')
          const mime = { '.json': 'application/json', '.txt': 'text/plain', '.md': 'text/markdown' }[path.extname(input.filename).toLowerCase()]
          return json(res, downloadable(Buffer.from(input.text), input.filename, mime + '; charset=utf-8'))
        }
        if (resource === 'downloads' && id && req.method === 'GET') {
          const item = downloads.get(id)
          if (!item || Date.now() - item.created > 300000) throw new AppError('下载链接已过期，请重新导出', 404)
          res.writeHead(200, { 'Content-Type': item.mime, 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(item.filename)}` })
          return res.end(item.bytes)
        }
        if (resource === 'render' && req.method === 'POST') {
          const input = await bodyJson(req)
          if (typeof input.markdown !== 'string' || Buffer.byteLength(input.markdown) > 1024 * 1024) throw new AppError('简历内容无效或过长')
          let { html } = renderResume({ root, markdown: input.markdown, theme: input.theme, htmlPath: path.join(root, 'preview.html') })
          html = html.replace('<meta charset="utf-8">', `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`)
          return json(res, { html })
        }
        if (resource === 'trash' && req.method === 'GET') return json(res, store.trash())
        if (resource === 'trash' && id && req.method === 'POST') return json(res, store.restoreTrash(id))
        if (resource === 'upload' && req.method === 'POST') {
          const { data } = await bodyJson(req)
          const match = typeof data === 'string' && data.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/)
          if (!match) throw new AppError('仅支持 PNG、JPEG、WebP 图片')
          const bytes = Buffer.from(match[2], 'base64')
          if (bytes.length > 5 * 1024 * 1024 || bytes.length < 12) throw new AppError('图片大小须在 12 B 到 5 MB 之间')
          const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
          if (!valid) throw new AppError('图片格式与内容不符')
          const name = randomUUID() + '.' + (match[1] === 'jpeg' ? 'jpg' : match[1])
          const dir = path.join(root, 'assets', 'uploads')
          fs.mkdirSync(dir, { recursive: true })
          atomicWrite(path.join(dir, name), bytes)
          return json(res, { path: 'assets/uploads/' + name }, 201)
        }
        throw new AppError('接口不存在', 404)
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw new AppError('方法不允许', 405)
      let file
      if (namespace === 'assets') file = path.join(root, ...parts)
      else if (parts.length === 0) file = path.join(root, 'web', 'index.html')
      else if (namespace === 'pdf-assets' && parts.length === 3 && ['cmaps', 'standard_fonts', 'wasm'].includes(resource)) file = path.join(root, 'web', ...parts)
      else if (parts.length === 1 && ['app.js', 'app.css', 'appearance.js', 'resume-layout.js', 'layout.js', 'workflow.js', 'diff.js', 'workflow.css', 'icons.js', 'ui-icons.svg', 'visual-editor.bundle.js', 'visual-editor.css', 'pdf-proof.bundle.js', 'pdf-worker.js'].includes(namespace)) file = path.join(root, 'web', namespace)
      else throw new AppError('页面不存在', 404)
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new AppError('文件不存在', 404)
      store.assertInside(file, path.join(root, namespace === 'assets' ? 'assets' : 'web'))
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' blob:; frame-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
      if (req.method === 'HEAD') return res.end()
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res)
    } catch (e) {
      if (res.headersSent) return res.destroy()
      if (!e.status) console.error(e)
      json(res, { error: e.status ? e.message : '操作失败，请查看服务日志', ...e.details }, e.status || 500)
    }
  })
  server.requestTimeout = 120000
  server.headersTimeout = 15000
  return { server, store }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildWeb()
  const port = Number(process.env.PORT || 3210)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 需要是 1–65535 的整数')
  const { server } = createApp()
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，请设置 PORT 后重试。` : error.message); process.exitCode = 1 })
  server.listen(port, '127.0.0.1', () => console.log(`\n简历工作台已启动：http://127.0.0.1:${port}\n数据目录：${path.resolve(import.meta.dirname, '..', 'resumes')}\n按 Ctrl+C 停止服务。\n`))
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); server.closeIdleConnections() })
}
