// 把两张整页图裁同一区块、缩放到同一比例后上下拼在一起,便于逐项比对
// 用法: node _compare.mjs A.png B.png 输出.png [起始mm] [高度mm]
import fs from 'node:fs'
import puppeteer from 'puppeteer-core'

const [aPath, bPath, out, startMm = '0', heightMm = '150'] = process.argv.slice(2)
const toUri = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64')

const b = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--allow-file-access-from-files', '--no-sandbox'],
})
try {
  const p = await b.newPage()
  await p.setContent(`<img id="a" src="${toUri(aPath)}"><img id="b" src="${toUri(bPath)}">`)
  await p.waitForFunction(() => document.getElementById('a').complete && document.getElementById('b').complete && document.getElementById('a').naturalWidth > 0 && document.getElementById('b').naturalWidth > 0)
  const url = await p.evaluate((startMm, heightMm) => {
    const a = document.getElementById('a'), bb = document.getElementById('b')
    const TARGET_W = 1200                     // 统一输出宽度
    const outW = TARGET_W
    const pxPerMmOut = TARGET_W / 210         // 输出比例
    const cropH = Math.round(+heightMm * pxPerMmOut)
    const topOut = Math.round(+startMm * pxPerMmOut)
    const c = document.createElement('canvas')
    c.width = outW; c.height = cropH * 2 + 14
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 0, c.width, c.height)
    const draw = (img, dy) => {
      const scale = TARGET_W / img.naturalWidth  // 按页宽归一化
      const sy = Math.round(+startMm * (img.naturalHeight / 297))
      const sh = Math.round(+heightMm * (img.naturalHeight / 297))
      ctx.drawImage(img, 0, sy, img.naturalWidth, sh, 0, dy, TARGET_W, cropH)
      ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'
      ctx.fillText('top=PDF  bottom=DOCX', 8, dy + 20)
    }
    draw(a, 0)
    draw(bb, cropH + 14)
    return c.toDataURL('image/png')
  }, startMm, heightMm)
  fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'))
  console.log('saved', out)
} finally {
  await b.close()
}
