import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createApp } from '../src/server.mjs'
import { findBrowser, launchBrowser } from '../src/browser.mjs'
import { buildWeb } from '../src/build-web.mjs'
import { listenForBrowser } from './local-server.mjs'

test('双层导航与日夜外观：屏幕阅读、原始颜色保存、字体偏好、实际 PDF 与窄窗口', async t => {
  const project = path.resolve(import.meta.dirname, '..'), base = path.join(project, '.local')
  await buildWeb()
  const root = fs.mkdtempSync(path.join(base, 'appearance-test-'))
  const markdown = '# 设计验收\n\n> 产品设计师 · 本地测试数据\n\n<img class="avatar" src="assets/avatar.png">\n\n## 工作经历\n\n<div class="entry-title"><h3>产品设计师 · 示例公司</h3><p>2024.03 — 至今</p></div>\n\n- 建立组件和交互规范，持续改善产品体验。\n- 将复杂流程整理为清晰的任务与操作。\n\n## 项目经历\n\n- 中文简历工作台：编辑、投递管理与 PDF 校样。\n\n## 专业技能\n\n- 用户研究、信息架构、界面设计与原型验证。\n'
  fs.mkdirSync(path.join(root, 'resumes/_master'), { recursive: true })
  fs.writeFileSync(path.join(root, 'resumes/_master/resume.md'), markdown)
  for (const name of ['web', 'assets']) fs.cpSync(path.join(project, name), path.join(root, name), { recursive: true })
  const { server, store } = createApp({ root })
  const url = await listenForBrowser(server), browser = await launchBrowser(findBrowser())
  t.after(async () => {
    await browser.close()
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
    assert.ok(root.startsWith(base + path.sep)); fs.rmSync(root, { recursive: true, force: true })
  })
  const child = store.create({ company: '示例科技', title: '产品设计', jd: '关注用户体验与设计系统。' })
  store.setArchived(child.id, { revision: child.revision, archived: true })
  const page = await browser.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', res => { if (res.status() >= 400 && !res.url().endsWith('/favicon.ico')) errors.push(res.status() + ' ' + res.url()) })
  await page.setViewport({ width: 1440, height: 1000 })
  await page.goto(url, { waitUntil: 'networkidle0' })
  const ready = () => page.waitForFunction(() => document.querySelector('#preview').dataset.documentId && document.querySelector('#preview-loading').hidden && document.querySelector('#preview').contentDocument?.querySelector('.resume-editor'))
  await ready()
  const paperStyle = selector => page.$eval('#preview', (el, target) => {
    const css = el.contentWindow.getComputedStyle(el.contentDocument.querySelector(target))
    return { background: css.backgroundColor, color: css.color, border: css.borderBottomColor, font: css.fontFamily, size: css.fontSize }
  }, selector)
  const revision = store.get('_master').revision
  const light = await paperStyle('.page'), heading = await paperStyle('h2')
  assert.equal(light.background, 'rgb(255, 255, 255)')
  assert.equal(await page.$eval('#list-filters', el => el.hidden), true)
  await page.click('#rail-archive')
  assert.equal(await page.$eval('#archive-filter', el => el.value), 'archived')
  assert.equal(await page.$eval('#rail-archive', el => el.getAttribute('aria-pressed')), 'true')
  assert.ok(await page.$('[data-document="' + child.id + '"]'))
  await page.click('#rail-documents')
  await page.screenshot({ path: path.join(base, 'qa-modern-day.png') })
  await page.click('#theme-toggle')
  const dark = await paperStyle('.page')
  assert.equal(dark.background, 'rgb(16, 18, 20)')
  assert.equal(dark.color, 'rgb(231, 233, 234)')
  assert.equal(await page.$eval('#theme-toggle', el => el.getAttribute('aria-label')), '切换日间模式')
  await page.click('#appearance-button')
  await page.select('#appearance-font', 'sourceHan')
  await page.select('#appearance-size', '16')
  await page.click('#appearance-done')
  await page.waitForFunction(() => document.fonts.check('16px StudioSans'))
  assert.equal(await page.$eval('.brand', el => getComputedStyle(el).fontSize), '16.8px')
  const darkFont = await paperStyle('h2')
  assert.equal(darkFont.font, heading.font)
  assert.equal(darkFont.size, heading.size)
  assert.ok(await page.$eval('#document-toolbar', el => el.getBoundingClientRect().height <= 38.1), '大字模式保留紧凑桌面工具栏')
  await page.emulateMediaType('print')
  assert.equal((await paperStyle('.page')).background, light.background)
  assert.equal((await paperStyle('h2')).color, heading.color)
  await page.emulateMediaType('screen')
  assert.equal(store.get('_master').markdown, markdown)
  assert.equal(store.get('_master').revision, revision)
  await page.reload({ waitUntil: 'networkidle0' }); await ready()
  assert.equal(await page.evaluate(() => document.documentElement.dataset.uiFont), 'sourceHan')
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), '16px')
  await page.click('#appearance-button')
  await page.select('#appearance-font', 'system')
  await page.select('#appearance-size', '14')
  await page.click('#appearance-done')
  await page.screenshot({ path: path.join(base, 'qa-modern-night.png') })
  await page.reload({ waitUntil: 'networkidle0' }); await ready()
  assert.equal((await paperStyle('.page')).background, dark.background)
  assert.equal(store.get('_master').markdown, markdown)

  const avatar = await page.$eval('#preview', el => {
    const r = el.contentDocument.querySelector('.avatar').getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  await page.click('#proof-button')
  await page.waitForFunction(() => document.querySelector('.pdf-proof-page')?.dataset.ready === 'true')
  const pdfPixels = () => page.$eval('.pdf-proof-page canvas', (canvas, photo) => {
    const ctx = canvas.getContext('2d'), scale = canvas.width / 794
    return { corner: [...ctx.getImageData(2, 2, 1, 1).data], photo: [...ctx.getImageData(Math.round(photo.x * scale), Math.round(photo.y * scale), 1, 1).data] }
  }, avatar)
  const nightPdf = await pdfPixels()
  assert.deepEqual(nightPdf.corner, [16, 18, 20, 255])
  await page.click('#proof-print-colors')
  const printPdf = await pdfPixels()
  assert.deepEqual(printPdf.corner, [255, 255, 255, 255])
  assert.deepEqual(nightPdf.photo, printPdf.photo, '头像保持原始颜色')
  await page.click('#proof-print-colors')
  assert.deepEqual(await pdfPixels(), nightPdf)
  await page.screenshot({ path: path.join(base, 'qa-modern-night-proof.png') })
  await page.click('#proof-back')
  assert.equal(store.get('_master').markdown, markdown)

  // Night reading border must never become the saved default when adjusting thickness.
  await page.click('#properties-toggle')
  const frame = page.frames().find(f => f.parentFrame())
  await frame.click('h2')
  await page.$eval('#rule-settings', el => { el.open = true })
  const expectedColor = await page.$eval('[data-rule=color]', el => el.value)
  await page.$eval('[data-rule=thickness]', el => { el.value = '0.4'; el.dispatchEvent(new Event('change')) })
  await page.click('#save-button')
  await page.waitForFunction(() => document.querySelector('#save-state').textContent === '已保存')
  assert.ok(store.get('_master').markdown.includes('--resume-rule-color:'))
  const actual = await page.$eval('#preview', async el => {
    const { withPrintPalette } = await import('/appearance.js')
    return withPrintPalette(el.contentDocument, () => el.contentWindow.getComputedStyle(el.contentDocument.querySelector('h2')).getPropertyValue('--resume-rule-color').trim())
  })
  assert.ok(actual !== 'rgb(72, 81, 90)' && expectedColor !== '#48515a')
  await page.click('#properties-close')
  for (const width of [1440, 1280, 1024, 390]) {
    await page.setViewport({ width, height: 900 })
    const layout = await page.evaluate(() => {
      const stage = document.querySelector('#preview-stage'), rect = stage.getBoundingClientRect()
      return { top: rect.top + parseFloat(getComputedStyle(stage).paddingTop), bottom: innerHeight - rect.bottom, overflow: document.documentElement.scrollWidth - innerWidth, toolbar: document.querySelector('#document-toolbar').getBoundingClientRect().height }
    })
    assert.ok(layout.top <= (width === 390 ? 220 : 100), JSON.stringify({ width, ...layout }))
    assert.ok(layout.bottom <= 11 && layout.overflow <= 1, JSON.stringify({ width, ...layout }))
    if (width === 1440) assert.ok(layout.toolbar <= 38.1)
    await page.click('#source-mode')
    if (width === 390) await page.screenshot({ path: path.join(base, 'qa-modern-mobile.png') })
    const sourceLayout = await page.$eval('#editor', el => ({ height: el.getBoundingClientRect().height, body: document.body.className, mode: document.body.dataset.editMode, grid: getComputedStyle(document.querySelector('.work-grid')).height, panel: getComputedStyle(document.querySelector('.editor-panel')).display }))
    assert.ok(sourceLayout.height > 500, JSON.stringify({ width, ...sourceLayout }))
    if (width <= 1030) {
      await page.click('#source-preview-toggle')
      assert.equal(await page.$eval('.preview-panel', el => getComputedStyle(el).display), 'flex')
      await page.click('#source-preview-toggle')
      assert.equal(await page.$eval('.editor-panel', el => getComputedStyle(el).display), 'flex')
    }
    await page.click('#visual-mode'); await ready()
  }
  assert.deepEqual(errors, [])
})
