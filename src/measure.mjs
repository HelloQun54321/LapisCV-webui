// 量一张整页渲染图的版式数据,输出 mm 坐标(按 A4 折算)。
// 用途:核对 PDF / Word 两份文件的实际落点,或为 docx.mjs 的常量取值提供依据。
//
// 用法:
//   node src/measure.mjs <整页png> [头像横向区间,默认 168-200]
//
// 需要先有"整页"图,获取方式见 AGENTS.md 的「本机验证环境」一节
// (用 LibreOffice 把 pdf / docx 渲染成 png)。
import fs from 'node:fs'
import puppeteer from 'puppeteer-core'

const png = process.argv[2]
const [bandFrom, bandTo] = (process.argv[3] || '168-200').split('-').map(Number)
if (!png) {
  console.error('用法: node src/measure.mjs <整页png> [头像横向区间mm,如 168-200]')
  process.exit(1)
}

const isBlank = (d, k) => d[k + 3] < 128 || (d[k] > 250 && d[k + 1] > 250 && d[k + 2] > 250)
const isInk = (d, k) => d[k + 3] > 128 && d[k] < 150 && d[k + 1] < 150 && d[k + 2] < 150

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--allow-file-access-from-files', '--no-sandbox'],
})
try {
  const page = await browser.newPage()
  await page.setContent(`<img id="i" src="data:image/png;base64,${fs.readFileSync(png).toString('base64')}">`)
  await page.waitForFunction(() => document.getElementById('i').complete && document.getElementById('i').naturalWidth > 0)

  const r = await page.evaluate((bandFrom, bandTo) => {
    const img = document.getElementById('i')
    const c = document.createElement('canvas')
    c.width = img.naturalWidth; c.height = img.naturalHeight
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    const mmX = 210 / c.width, mmY = 297 / c.height
    const blank = (x, y) => { const k = (y * c.width + x) * 4; return d[k + 3] < 128 || (d[k] > 250 && d[k + 1] > 250 && d[k + 2] > 250) }
    const ink = (x, y) => { const k = (y * c.width + x) * 4; return d[k + 3] > 128 && d[k] < 150 && d[k + 1] < 150 && d[k + 2] < 150 }

    // 1) 整体墨迹边界(文字/图片/线条都算)
    let top = -1, bot = -1, left = 1e9, right = -1
    for (let y = 0; y < c.height; y++) {
      let hit = false
      for (let x = 0; x < c.width; x++) {
        if (ink(x, y)) { hit = true; if (x < left) left = x; if (x > right) right = x }
      }
      if (hit) { if (top < 0) top = y; bot = y }
    }

    // 2) 实心色块(头像这类):逐行找「最长连续非白像素段」。
    //    文字每行被字间空隙打断,最长连续段只有几毫米;实心块能有 20mm 以上。
    //    再按行合并成块,只保留高度 >= 5mm 的,顺便滤掉章节下划线那种细线。
    const solid = []
    for (let y = 0; y < c.height; y++) {
      let best = 0, bs = -1, s = -1
      for (let x = 0; x < c.width; x++) {
        if (!blank(x, y)) { if (s < 0) s = x } else if (s >= 0) { const len = (x - s) * mmX; if (len > best) { best = len; bs = s } s = -1 }
      }
      if (s >= 0) { const len = (c.width - s) * mmX; if (len > best) { best = len; bs = s } }
      if (best >= 12) solid.push({ y, x1: bs, x2: bs + best / mmX })
    }
    // 合并时要求横向位置重叠(否则会把头像和附近的章节下划线并成一块,
    // 横向范围被拉成整页宽)
    const blocks = []
    for (const r of solid) {
      const last = blocks[blocks.length - 1]
      const overlap = last ? Math.min(last.x2, r.x2) - Math.max(last.x1, r.x1) : 0
      const lastW = last ? last.x2 - last.x1 : 0
      if (last && r.y - last.y2 <= 3 && overlap > lastW * 0.6) {
        last.y2 = r.y
        last.x1 = Math.min(last.x1, r.x1)
        last.x2 = Math.max(last.x2, r.x2)
      } else blocks.push({ y1: r.y, y2: r.y, x1: r.x1, x2: r.x2 })
    }

    const mm = (v, per) => +(v * per).toFixed(2)
    // 先按高度滤掉细线(章节下划线只有一两行),再把被浅色像素断开的同一色块合起来
    const tall = blocks.filter((b) => (b.y2 - b.y1 + 1) * mmY >= 5)
    const merged = []
    for (const b of tall) {
      const last = merged[merged.length - 1]
      const ov = last ? Math.min(last.x2, b.x2) - Math.max(last.x1, b.x1) : 0
      const minW = last ? Math.min(last.x2 - last.x1, b.x2 - b.x1) : 0
      if (last && (b.y1 - last.y2) * mmY <= 2 && ov > minW * 0.6) {
        last.y2 = b.y2
        last.x1 = Math.min(last.x1, b.x1)
        last.x2 = Math.max(last.x2, b.x2)
      } else merged.push({ ...b })
    }
    const found = merged.map((b) => ({
      上: mm(b.y1, mmY), 下: mm(b.y2 + 1, mmY), 高: mm(b.y2 + 1 - b.y1, mmY),
      左: mm(b.x1, mmX), 右: mm(b.x2, mmX),
      ...(b.x1 * mmX >= bandFrom - 2 && b.x1 * mmX <= bandTo ? { 在头像区间: true } : {}),
    }))

    return {
      图片尺寸: `${c.width}x${c.height}`,
      内容边界_mm: { 上: mm(top, mmY), 下: mm(bot + 1, mmY), 左: mm(left, mmX), 右: mm(right + 1, mmX) },
      内容高度_mm: mm(bot + 1 - top, mmY),
      实心色块_mm: found.length ? found : '未检出 5mm 以上的连续色块',
    }
  }, bandFrom, bandTo)

  console.log(JSON.stringify(r, null, 2))
} finally {
  await browser.close()
}
