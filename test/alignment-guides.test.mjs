import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createApp } from '../src/server.mjs'
import { renderResume } from '../src/render.mjs'
import { findBrowser, launchBrowser } from '../src/browser.mjs'
import { buildWeb } from '../src/build-web.mjs'
import { listenForBrowser } from './local-server.mjs'

test('智能辅助线：缩放下移动吸附、Alt 自由移动、Esc 取消、普通图片、一步撤销与偏好记忆', async t => {
  const project=path.resolve(import.meta.dirname,'..'), base=path.join(project,'.local')
  await buildWeb()
  const root=fs.mkdtempSync(path.join(base,'guides-test-'))
  const source='# 辅助线验收\n\n<blockquote><p>138 0000 0000<br>design@example.com</p><img class="avatar" src="assets/avatar.png" style="width:18mm;height:24mm;left:-8mm;top:0mm"><p>求职方向：产品设计</p></blockquote>\n\n## 工作经历\n\n<div class="entry-title"><h3>产品设计师 · 示例公司</h3><p>2026</p></div>\n\n- 项目内容保持完整。\n\n<img class="logo" src="assets/avatar.png" style="width:24mm;height:32mm">\n'
  fs.mkdirSync(path.join(root,'resumes/_master'),{recursive:true});fs.writeFileSync(path.join(root,'resumes/_master/resume.md'),source)
  for(const name of ['web','assets'])fs.cpSync(path.join(project,name),path.join(root,name),{recursive:true})
  const {server,store}=createApp({root}), url=await listenForBrowser(server), browser=await launchBrowser(findBrowser())
  t.after(async()=>{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections()});assert.ok(root.startsWith(base+path.sep));fs.rmSync(root,{recursive:true,force:true})})
  const page=await browser.newPage(),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.setViewport({width:1440,height:1000});await page.goto(url,{waitUntil:'networkidle0'})
  const frame=()=>page.frames().find(item=>item.parentFrame())
  const ready=()=>page.waitForFunction(()=>document.querySelector('#preview').contentDocument?.querySelector('.resume-editor[contenteditable="true"] .avatar'))
  await ready();await page.click('#properties-toggle')
  await page.click('#zoom-out')
  await page.$eval('#visual-autosave',el=>{el.checked=false;el.dispatchEvent(new Event('change'))})
  const geometry=selector=>frame().$eval(selector,el=>{
    const rect=el.getBoundingClientRect(),paper=el.closest('.page'),p=paper.getBoundingClientRect(),css=getComputedStyle(paper)
    return {left:rect.left,right:rect.right,center:(rect.left+rect.right)/2,contentRight:p.right-parseFloat(css.paddingRight),paperCenter:(p.left+p.right)/2}
  })
  const screen=async selector=>{
    const box=await frame().$eval(selector,el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})
    const paper=await page.$eval('#preview',el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,scale:r.width/el.offsetWidth}})
    return{x:paper.x+(box.x+box.width/2)*paper.scale,y:paper.y+(box.y+box.height/2)*paper.scale,scale:paper.scale}
  }
  const start=async(selector,align='right')=>{
    const point=await screen(selector);await page.mouse.click(point.x,point.y)
    await frame().waitForSelector('[data-handle="move"]')
    const shape=await geometry(selector),box=await screen('[data-handle="move"]'),scale=box.scale
    const dx=(align==='center'?shape.paperCenter-shape.center:shape.contentRight-shape.right)+1.2
    await page.mouse.move(box.x,box.y);await page.mouse.down()
    await page.mouse.move(box.x+dx*scale,box.y,{steps:8})
    return {shape,scale}
  }
  assert.equal(await page.$eval('#alignment-guides',el=>el.checked),true)
  const first=await start('.avatar')
  assert.ok(first.scale<1,'实际测试缩放后的纸面')
  assert.ok(await frame().$$eval('.alignment-guide[data-axis="x"]',els=>els.length)>0)
  assert.ok(await frame().$$eval('.alignment-guide[data-axis="x"]',els=>els.every(el=>getComputedStyle(el).borderLeftStyle==='dashed' && getComputedStyle(el).borderLeftColor==='rgb(36, 122, 202)')))
  assert.ok(await frame().$$eval('.alignment-guide-label',els=>els.some(el=>el.textContent==='正文右边缘')))
  const outline=await frame().$eval('.image-edit-handles',el=>el.getBoundingClientRect().right)
  assert.ok(Math.abs(outline-first.shape.contentRight)<.1,'轮廓已吸附正文边缘')
  assert.equal(await page.$eval('#editor',el=>el.value),source,'拖动预览不改模型')
  assert.equal(store.get('_master').markdown,source)
  await page.screenshot({path:path.join(base,'qa-alignment-guides.png')})
  await page.mouse.up()
  assert.ok(Math.abs((await geometry('.avatar')).right-first.shape.contentRight)<.05)
  assert.equal(await frame().$('.alignment-guides'),null)
  await page.click('[data-format="undo"]')
  assert.equal(await page.$eval('#editor',el=>el.value),source,'一次撤销恢复整次移动')

  const vertical=await frame().evaluate(()=>({imageTop:document.querySelector('.avatar').getBoundingClientRect().top,nameTop:document.querySelector('h1').getBoundingClientRect().top}))
  const selected=await screen('.avatar');await page.mouse.click(selected.x,selected.y)
  const verticalHandle=await screen('[data-handle="move"]')
  await page.mouse.move(verticalHandle.x,verticalHandle.y);await page.mouse.down()
  await page.mouse.move(verticalHandle.x,verticalHandle.y+(vertical.nameTop-vertical.imageTop+1.2)*verticalHandle.scale,{steps:8})
  assert.ok(await frame().$$eval('.alignment-guide[data-axis="y"]',els=>els.length)>0)
  assert.ok(Math.abs(await frame().$eval('.image-edit-handles',el=>el.getBoundingClientRect().top)-vertical.nameTop)<.1)
  await page.mouse.up()
  assert.ok(Math.abs(await frame().$eval('.avatar',el=>el.getBoundingClientRect().top)-vertical.nameTop)<.05)
  await page.click('[data-format="undo"]')
  assert.equal(await page.$eval('#editor',el=>el.value),source)

  await page.click('#theme-toggle')
  const focus=await screen('.avatar');await page.mouse.click(focus.x,focus.y);await page.keyboard.down('Alt')
  const free=await start('.avatar')
  assert.ok(await frame().$$eval('.alignment-guide[data-snapped="false"]',els=>els.length)>0)
  assert.ok(await frame().$$eval('.alignment-guide[data-axis="x"]',els=>els.every(el=>getComputedStyle(el).borderLeftStyle==='dashed' && getComputedStyle(el).borderLeftColor==='rgb(98, 170, 245)')))
  await page.mouse.up();await page.keyboard.up('Alt')
  assert.ok(Math.abs((await geometry('.avatar')).right-free.shape.contentRight-1.2)<.05,'Alt 保留自由位置')
  await page.click('[data-format="undo"]')

  await start('.avatar');await page.keyboard.press('Escape');await page.mouse.up()
  assert.equal(await frame().$('.alignment-guides'),null)
  assert.equal(await page.$eval('#editor',el=>el.value),source,'取消不产生内容更改')
  await page.$eval('#alignment-guides',el=>{el.checked=false;el.dispatchEvent(new Event('change'))})
  const disabled=await start('.avatar')
  assert.equal(await frame().$$eval('.alignment-guide',els=>els.length),0)
  await page.mouse.up()
  assert.ok(Math.abs((await geometry('.avatar')).right-disabled.shape.contentRight-1.2)<.05)
  await page.click('[data-format="undo"]')
  await page.$eval('#alignment-guides',el=>{el.checked=true;el.dispatchEvent(new Event('change'))})
  const picture=await start('img.logo','center')
  assert.ok(await frame().$$eval('.alignment-guide-label',els=>els.some(el=>el.textContent==='纸面中线')))
  await page.mouse.up()
  assert.ok(Math.abs((await geometry('img.logo')).center-picture.shape.paperCenter)<.05)
  await page.click('[data-format="undo"]')
  assert.equal(await page.$eval('#editor',el=>el.value),source)
  await page.click('#save-button');await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存')
  const stored=store.get('_master').markdown
  assert.equal(stored,source)
  assert.ok(!renderResume({root,markdown:stored,htmlPath:path.join(root,'fixture.html')}).html.includes('alignment-guide'),'导出渲染不包含辅助线')
  await page.$eval('#alignment-guides',el=>{el.checked=false;el.dispatchEvent(new Event('change'))})
  await page.reload({waitUntil:'networkidle0'});await ready()
  assert.equal(await page.$eval('#alignment-guides',el=>el.checked),false)
  assert.equal(store.get('_master').markdown,source)
  assert.ok(await page.$eval('#preview-stage',el=>el.getBoundingClientRect().top+parseFloat(getComputedStyle(el).paddingTop))<=100)
  assert.deepEqual(errors,[])
})
