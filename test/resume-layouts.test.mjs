import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createApp } from '../src/server.mjs'
import { themes, renderResume } from '../src/render.mjs'
import { findBrowser, launchBrowser } from '../src/browser.mjs'
import { buildWeb } from '../src/build-web.mjs'
import { listenForBrowser } from './local-server.mjs'
import { resumeLayouts, decorateContactBreaks, htmlBlockKind } from '../web/resume-layout.js'
import { writeLayout, removeLayout, validateLayout } from '../web/layout.js'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const project = path.resolve(import.meta.dirname, '..')
test('个人信息布局保留自定义内容、校验选项并支持恢复模板默认', () => {
  const source = '<style>body { --color-accent:#444444; }</style>\n\n# 姓名\n\n> 联系方式\n'
  const result = writeLayout(source, { nameAlign: 'left', infoAlign: 'right', avatarSide: 'left', infoColumns: 2, infoSize: 9.5, infoLeft: -1.2 })
  assert.ok(result.includes('--profile-avatar-side: left'))
  assert.ok(result.includes('--profile-info-columns: 2'))
  const restored = writeLayout(result, { nameAlign: 'auto', avatarSide: 'auto' })
  assert.ok(!restored.includes('--profile-avatar-side:'))
  assert.ok(!restored.includes('--profile-name-align:'))
  assert.ok(restored.includes('infoLeft'))
  assert.equal(removeLayout(restored), source)
  assert.throws(() => validateLayout({ nameAlign: 'arbitrary' }))
  assert.throws(() => validateLayout({ infoColumns: 1.5 }))
  assert.throws(() => validateLayout({ infoSize: 100 }))
  assert.throws(() => validateLayout({ contactFlow:'unknown' }))
  assert.throws(() => validateLayout({ contactGap:20 }))
  const contacts = '<blockquote><p>电话\u2003\u2003<br>邮箱<br>链接</p></blockquote>'
  assert.equal((decorateContactBreaks(contacts).match(/<br>/g)||[]).length,2)
  assert.ok(decorateContactBreaks(contacts).includes('resume-contact-padding'))
  assert.ok(decorateContactBreaks('<p>电话\u2003\u2003邮箱</p>').includes('resume-contact-soft-break'))
  assert.deepEqual(htmlBlockKind('<img class="avatar" style="width:19.16mm!important;top:-4.59mm!important">').photoSize,{width:'19.16mm',top:'-4.59mm'})
})

test('三套简历版式：已删除版式回退、编辑与预览一致、跨页 PDF、个人信息调节与往返保存', async t => {
  await buildWeb()
  const base = path.join(project, '.local'), root = fs.mkdtempSync(path.join(base, 'layout-test-'))
  fs.mkdirSync(path.join(root, 'resumes/_master'), { recursive:true })
  const source = '# 林晓\n\n<blockquote><p>产品设计师 · 上海<br>138 0000 0000<br>lin@example.com</p><img class="avatar" src="assets/avatar.png" alt="" style="width:22mm;height:30mm"><p><strong>求职方向：产品设计 / 用户体验</strong></p></blockquote>\n\n<!-- 保留这条私人注释 -->\n\n## [[e618]] 工作经历\n\n<div class="entry-title"><h3>产品设计师 · 示例科技</h3><p>2024.03 — 至今</p></div>\n\n- 参与产品研究，整理需求并建立设计规范。\n- 从用户反馈中识别问题，持续改善核心任务流程。\n\n## 项目经历\n\n<div class="entry-title"><h3>简历工作台</h3><p>2026.06 — 至今</p></div>\n\n- 将内容编辑、版本管理和投递记录整理为统一流程。\n- 提供清晰的页面结构和可调整的阅读体验。\n\n## 专业技能\n\n- 用户研究、信息架构、交互设计、设计系统。\n\n<hr>\n\n## 补充经历\n\n- 第二页测试内容必须完整保留。\n'
  fs.writeFileSync(path.join(root, 'resumes/_master/resume.md'), source)
  for (const name of ['web','assets']) fs.cpSync(path.join(project,name),path.join(root,name),{recursive:true})
  const { server,store }=createApp({root}), url=await listenForBrowser(server), browser=await launchBrowser(findBrowser())
  t.after(async()=>{ await browser.close(); await new Promise(resolve=>{server.close(resolve);server.closeAllConnections()});assert.ok(root.startsWith(base+path.sep));fs.rmSync(root,{recursive:true,force:true}) })
  assert.deepEqual(themes(root), resumeLayouts.map(layout=>layout.id))
  assert.deepEqual(themes(root), ['classic', 'serif', 'banner'])
  for (const layout of resumeLayouts) renderResume({root,markdown:source,theme:layout.id,htmlPath:path.join(root,'resumes/_master/fixture.html')})
  const child=store.create({company:'模板测试',title:'设计'})
  for (const retired of ['sidebar', 'sectioned']) {
    assert.equal(fs.existsSync(path.join(root, 'assets/styles', retired + '.css')), false)
    const settingsFile = path.join(root, 'resumes', child.id, '.webui.json')
    const settings = JSON.stringify({theme:retired, archived:false})
    fs.writeFileSync(settingsFile, settings)
    const current = store.get(child.id)
    assert.equal(current.theme, 'classic')
    assert.equal(current.markdown, source)
    assert.equal(fs.readFileSync(settingsFile, 'utf8'), settings, '读取旧模板记录不写回用户文件')
    const htmlPath = path.join(root, 'resumes', child.id, 'fixture.html')
    assert.equal(renderResume({root, markdown:source, theme:retired, htmlPath}).html, renderResume({root, markdown:source, theme:'classic', htmlPath}).html)
    const old = store.snapshot({...current, theme:retired, markdown:source + '\n'}, '旧模板历史')
    const restored = store.save(child.id, {...old, revision:current.revision})
    assert.equal(restored.theme, 'classic')
    assert.equal(restored.markdown, source + '\n', '旧历史可正常恢复内容')
    store.save(child.id, {markdown:source, revision:restored.revision})
  }
  const page=await browser.newPage(), errors=[]
  page.on('pageerror', e=>errors.push(e.message))
  await page.setViewport({width:1440,height:1000})
  await page.goto(url,{waitUntil:'networkidle0'})
  await page.click('[data-document="'+child.id+'"]')
  const ready=()=>page.waitForFunction(id=>document.querySelector('#preview').dataset.documentId===id && document.querySelector('#preview-loading').hidden && document.querySelector('#preview').contentDocument?.querySelector('.resume-editor'),{},child.id)
  await ready();await page.click('#properties-toggle')
  await page.$eval('#theme',el=>{el.closest('details').open=true})
  assert.deepEqual(await page.$$eval('#theme option',els=>els.map(el=>el.textContent)),resumeLayouts.map(layout=>layout.name))
  const geometry=()=>page.$eval('#preview',async el=>{
    const doc=el.contentDocument,win=el.contentWindow
    await doc.fonts.load('12px SourceHanSansCN', '中文')
    await doc.fonts.ready
    const take=selector=>{const node=typeof selector==='string'?doc.querySelector(selector):selector,r=node.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,align:win.getComputedStyle(node).textAlign}}
    const contact = doc.querySelector('[data-profile-contacts]')
    const contactY = [...contact.childNodes].filter(node=>node.nodeType===3 && node.textContent.trim()).map(node=>{const range=doc.createRange();range.selectNodeContents(node);return range.getBoundingClientRect().y})
    const photoStyle=win.getComputedStyle(doc.querySelector('.avatar'))
    return {name:take('h1'),info:take('blockquote'),photo:take('.avatar'),section:take('h2'),lastSection:take([...doc.querySelectorAll('h2')].at(-1)),entry:take('.entry-title'),contactY,breakDisplay:win.getComputedStyle(contact.querySelector('br')).display,fontReady:doc.fonts.check('12px SourceHanSansCN', '中文'),photoStyle:{width:parseFloat(photoStyle.width),height:parseFloat(photoStyle.height),padding:photoStyle.padding,borders:['Top','Right','Bottom','Left'].map(side=>({width:photoStyle['border'+side+'Width'],style:photoStyle['border'+side+'Style'],color:photoStyle['border'+side+'Color']}))}}
  })
  const assertPhotoFrame=(result,label)=>{
    assert.ok(result.photoStyle.borders.every(edge=>edge.width==='2px'&&edge.style==='solid'),label+' 头像四边必须均为 2px 实线，包括引用块内的左边')
    assert.equal(new Set(result.photoStyle.borders.map(edge=>edge.color)).size,1,label+' 四边颜色一致')
    assert.equal(result.photoStyle.padding,'0px',label+' 照片直接贴合边框')
    assert.ok(Math.abs(result.photoStyle.width-22*96/25.4)<.1,label+' 保留自定义照片宽度')
    assert.ok(Math.abs(result.photoStyle.height-30*96/25.4)<.1,label+' 保留自定义照片高度')
    assert.ok(Math.abs(result.photo.w-result.photoStyle.width-4)<.1,label+' 水平边框总宽度')
    assert.ok(Math.abs(result.photo.h-result.photoStyle.height-4)<.1,label+' 垂直边框总高度')
  }
  const snapshots={}
  for(const layout of resumeLayouts){
    await page.select('#theme',layout.id)
    await page.waitForFunction(description=>document.querySelector('#layout-description').textContent===description,{},layout.description)
    await page.click('#save-button');await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存')
    assert.equal(store.get(child.id).markdown,source)
    const visual=await geometry();snapshots[layout.id]=visual
    assert.equal(visual.fontReady,true,layout.id+' 中文字体应加载成功')
    assertPhotoFrame(visual,layout.id+' 图形编辑')
    assert.ok(visual.photo.x>=0 && visual.photo.x+visual.photo.w<=794)
    assert.equal(visual.breakDisplay,'none')
    const contactSpread = Math.max(...visual.contactY)-Math.min(...visual.contactY)
    assert.ok(contactSpread<1,layout.id+' 联系方式排列')
    await page.screenshot({path:path.join(base,'qa-layout-'+layout.id+'.png')})
    await page.click('#source-mode')
    await page.waitForFunction(()=>document.querySelector('#preview-loading').hidden && document.querySelector('#preview').contentDocument?.querySelector('.resume-content') && !document.querySelector('#preview').contentDocument?.querySelector('.resume-editor'))
    const preview=await geometry()
    assertPhotoFrame(preview,layout.id+' 源码预览')
    for(const key of ['name','info','photo','section','entry'])for(const metric of ['x','y','w','h'])assert.ok(Math.abs(visual[key][metric]-preview[key][metric])<1,layout.id+' '+key+'.'+metric+' '+visual[key][metric]+' / '+preview[key][metric])
    assert.equal(await page.$eval('#editor',el=>el.value),source)
    await page.click('#theme-toggle')
    const night=await geometry()
    assertPhotoFrame(night,layout.id+' 夜间预览')
    assert.notEqual(night.photoStyle.borders[0].color,preview.photoStyle.borders[0].color)
    assert.equal(night.photo.w,preview.photo.w,'夜间只改变边框颜色，不改变尺寸')
    await page.click('#visual-mode');await ready()
    assertPhotoFrame(await geometry(),layout.id+' 夜间图形编辑')
    await page.click('#theme-toggle')
    await page.emulateMediaType('print')
    assertPhotoFrame(await geometry(),layout.id+' 打印版式')
    await page.emulateMediaType('screen')
    await page.click('#proof-button')
    await page.waitForSelector('.pdf-proof-page[data-ready="true"]',{timeout:20000})
    assert.equal(await page.$$eval('.pdf-proof-page',els=>els.length),2,layout.id+' 强制分页必须生成两页')
    const pdf=fs.readFileSync(path.join(root,'resumes',child.id,'resume.pdf'))
    assert.equal(pdf.subarray(0,5).toString(),'%PDF-')
    const printedTask = getDocument({ data:new Uint8Array(pdf), verbosity:0 })
    const printed = await printedTask.promise
    const secondPage = await (await printed.getPage(2)).getTextContent()
    const secondPageText = secondPage.items.map(item=>item.str).join('').normalize('NFKC').replace(/\s/g, '')
    assert.ok(secondPageText.includes('测试内容必须完整保留'), layout.id + ' 第二页：' + secondPageText)
    await printedTask.destroy()
    await page.click('#proof-back')
  }
  assert.ok(snapshots.banner.photo.x<snapshots.banner.info.x+snapshots.banner.info.w/2,'横向名片默认照片靠左')
  await page.select('#theme','banner')
  await page.waitForFunction(()=>document.querySelector('#layout-description').textContent.includes('横向页头'))
  await page.$eval('#profile-settings',el=>{el.open=true})
  const change=async(key,value)=>page.$eval('[data-layout="'+key+'"]',(el,value)=>{el.value=value;el.dispatchEvent(new Event('change'))},value)
  await change('contactFlow','stacked')
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#preview').contentDocument.querySelector('[data-profile-contacts] br')).display==='block')
  assert.ok(Math.max(...(await geometry()).contactY)-Math.min(...(await geometry()).contactY)>10)
  await change('contactFlow','auto')
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#preview').contentDocument.querySelector('[data-profile-contacts] br')).display==='none')
  await change('contactGap','5.5')
  await page.waitForFunction(()=>Math.abs(document.querySelector('#preview').contentDocument.querySelector('.resume-contact-separator').getBoundingClientRect().width-5.5*96/25.4)<.1)
  await change('avatarSide','right')
  await page.waitForFunction(()=>document.querySelector('#preview').contentWindow.getComputedStyle(document.querySelector('#preview').contentDocument.body).getPropertyValue('--profile-photo-column').trim()==='2')
  assert.ok((await geometry()).photo.x>600,'头像可调到右侧')
  await change('nameAlign','right');await change('infoAlign','left');await change('infoColumns','2');await change('infoSize','8.5');await change('infoLeft','1.5')
  await page.click('#save-button');await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存')
  const stored=store.get(child.id).markdown
  assert.ok(stored.includes('data-webui-layout'))
  const content = stored.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  assert.ok(!content.includes('data-profile-role')&&!content.includes('--profile-row')&&!content.includes('data-profile-contacts')&&!content.includes('resume-contact-separator'))
  assert.ok(stored.includes('保留这条私人注释'))
  await page.click('#theme-toggle')
  assert.equal(await page.$eval('#preview',el=>el.contentWindow.getComputedStyle(el.contentDocument.querySelector('.page')).backgroundColor),'rgb(16, 18, 20)')
  await page.click('#source-mode');await page.click('#visual-mode');await ready()
  assert.equal(store.get(child.id).markdown,stored)
  await page.reload({waitUntil:'networkidle0'});await ready()
  assert.equal(await page.$eval('[data-layout=avatarSide]',el=>el.value),'right')
  assert.equal((await geometry()).name.align,'right')
  assert.equal(store.get('_master').markdown,source)
  await page.setViewport({width:390,height:844})
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  assert.ok(await page.$eval('#preview-stage',el=>el.getBoundingClientRect().top+parseFloat(getComputedStyle(el).paddingTop)<=220))
  assert.deepEqual(errors,[])
})
