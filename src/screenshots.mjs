// README 展示图：始终使用隔离的虚构示例，不读取 resumes/ 或上传图片。
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { buildWeb } from './build-web.mjs'
import { createApp } from './server.mjs'
import { findBrowser, launchBrowser } from './browser.mjs'

const project = path.resolve(import.meta.dirname, '..')
const base = path.join(project, '.local')
fs.mkdirSync(base, { recursive: true })
const root = fs.mkdtempSync(path.join(base, 'readme-demo-'))
const output = path.join(project, 'docs/images')
fs.mkdirSync(output, { recursive: true })
let browser, server
try {
  await buildWeb()
  browser = await launchBrowser(findBrowser())
  const avatarPage = await browser.newPage()
  const svgPath = path.join(project, 'assets/avatar.svg')
  const svg = fs.readFileSync(svgPath, 'utf8')
  const [, , width, height] = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number)
  await avatarPage.setViewport({ width, height, deviceScaleFactor: 3 })
  await avatarPage.goto(pathToFileURL(svgPath).href, { waitUntil: 'networkidle0' })
  await avatarPage.screenshot({ path: path.join(project, 'assets/avatar.png') })
  await avatarPage.close()

  for (const name of ['web', 'examples', 'assets/styles', 'assets/fonts', 'assets/icons']) {
    fs.cpSync(path.join(project, name), path.join(root, name), { recursive: true })
  }
  fs.copyFileSync(path.join(project, 'assets/avatar.png'), path.join(root, 'assets/avatar.png'))
  const app = createApp({ root })
  server = app.server
  for (const [company, title] of [['示例科技', '产品设计'], ['示例工作室', '产品运营']]) {
    app.store.create({ company, title, jd: '虚构示例岗位：关注用户需求、产品体验与协作交付。' })
  }
  let url
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    url = 'http://127.0.0.1:' + server.address().port
    try { await fetch(url + '/api/health'); break }
    catch (error) {
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
      if (error.cause?.message !== 'bad port' || attempt === 9) throw error
    }
  }
  const page = await browser.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(response.status() + ' ' + response.url())
  })
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1.5 })
  await page.goto(url, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => document.querySelector('#preview').dataset.documentId
    && document.querySelector('#preview-loading').hidden
    && document.querySelector('#preview').contentDocument?.querySelector('.resume-editor'))
  await page.click('#properties-toggle')
  await page.waitForFunction(() => document.querySelector('#properties-toggle').getAttribute('aria-expanded') === 'true')
  await page.evaluate(() => {
    for (const selector of ['#visual-link', '#theme']) document.querySelector(selector).closest('details').open = true
  })
  await page.evaluate(async () => {
    await document.fonts.ready
    await document.querySelector('#preview').contentDocument.fonts.ready
    document.activeElement?.blur()
  })
  await page.mouse.move(1, 1)
  const markdown = app.store.get('_master').markdown
  const frame = page.frames().find(frame => frame.parentFrame())
  assert.equal(await page.$eval('#properties-panel', el => el.getBoundingClientRect().width > 200 && !el.hidden), true)
  assert.ok((await frame.$eval('.page', el => el.textContent)).includes('示例大学'))
  assert.equal(await frame.$eval('.page', el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)')
  await page.screenshot({ path: path.join(output, 'workbench-light.png') })
  await page.click('#theme-toggle')
  await page.waitForFunction(() => document.documentElement.dataset.uiTheme === 'dark'
    && document.querySelector('#preview').contentWindow.getComputedStyle(document.querySelector('#preview').contentDocument.querySelector('.page')).backgroundColor === 'rgb(16, 18, 20)')
  await page.mouse.move(1, 1)
  await page.evaluate(() => document.activeElement?.blur())
  await page.screenshot({ path: path.join(output, 'workbench-dark.png') })
  assert.equal(app.store.get('_master').markdown, markdown, '切换日夜不能修改示例内容')
  assert.deepEqual(errors, [])
  console.log('已使用隔离虚构数据生成 docs/images/workbench-light.png 与 workbench-dark.png')
} finally {
  if (browser) await browser.close()
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
  assert.ok(root.startsWith(base + path.sep))
  fs.rmSync(root, { recursive: true, force: true })
}
