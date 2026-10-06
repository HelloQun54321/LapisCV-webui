// 素材生成:图标字体抠图(+ 可选的头像 SVG 栅格化)
// 用法: node src/assets-gen.mjs
//   图标:按下面的 CODES 生成 assets/icons/*.png 与 manifest.json(构建的输入)
//   头像:如果存在 assets/avatar.svg,顺带栅格化成 assets/avatar.png(没有就跳过)
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { findBrowser, requireNativeBrowser, launchBrowser } from './browser.mjs'

// 脚本位于 src/,项目根目录是它的上一层
const root = path.resolve(import.meta.dirname, '..')
const ACCENT = '#2f5a9e'
// 图标字体里全部 21 个图标,生成齐全,这样任何一个都能用 [[eXXX]] 在 PDF/Word 里引用
const CODES = [
  'e600', 'e603', 'e60e', 'e60f', 'e611', 'e618', 'e631', 'e635', 'e638', 'e673', 'e69c',
  'e6b3', 'e782', 'e799', 'e7ca', 'e80c', 'e885', 'e8ae', 'e8b4', 'e8b5', 'ecfa',
]
const REF = 256 // 图标栅格化参考字号(px)

// 原先这里把浏览器路径**硬编码**成 'C:/Program Files/...',换台机器/换个盘就挂,
// 在 WSL 里更是必挂。改走共用定位逻辑,并在下面要求它是本机原生浏览器 ——
// 这个脚本要靠 page.evaluate 把 canvas 里量到的字形度量取回来,跨 VM 那条路给不了。
const browserPath = findBrowser()
requireNativeBrowser(browserPath, 'assets-gen.mjs')

const browser = await launchBrowser(browserPath)
try {
  // 1) 头像(可选):把 assets/avatar.svg 栅格化,宽高比保持 SVG 自身的 viewBox
  const avatarSvg = path.join(root, 'assets/avatar.svg')
  if (fs.existsSync(avatarSvg)) {
    const svg = fs.readFileSync(avatarSvg, 'utf8')
    const vb = (svg.match(/viewBox="([^"]+)"/) || [])[1]
    const [,, w, h] = vb ? vb.split(/[\s,]+/).map(Number) : [0, 0, 220, 320]
    const scale = 3
    const p1 = await browser.newPage()
    await p1.setViewport({ width: w, height: h, deviceScaleFactor: scale })
    await p1.goto(pathToFileURL(avatarSvg).href, { waitUntil: 'networkidle0' })
    await p1.screenshot({ path: path.join(root, 'assets/avatar.png') })
    await p1.close()
    console.log(`头像: assets/avatar.png (${w * scale}x${h * scale})`)
  } else {
    console.log('头像: 未发现 assets/avatar.svg,跳过')
  }

  // 2) 图标:在 canvas 里按 REF 字号绘制,裁到墨迹边界
  const p2 = await browser.newPage()
  await p2.setContent('<html><body></body></html>')
  const fontUrl = 'data:font/ttf;base64,' + fs.readFileSync(path.join(root, 'assets/fonts/iconfont.ttf')).toString('base64')
  const metrics = await p2.evaluate(async (fontUrl, codes, accent, REF) => {
    const face = new FontFace('LapisCV Icon', `url(${fontUrl})`)
    await face.load()
    document.fonts.add(face)
    const out = {}
    for (const code of codes) {
      const ch = String.fromCodePoint(parseInt(code, 16))
      const c = document.createElement('canvas')
      c.width = REF * 2; c.height = REF * 2
      const ctx = c.getContext('2d')
      ctx.font = `${REF}px "LapisCV Icon"`
      ctx.fillStyle = accent
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(ch, REF, REF) // 基线落在 y = REF
      const d = ctx.getImageData(0, 0, c.width, c.height).data
      let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          if (d[(y * c.width + x) * 4 + 3] > 0) {
            if (x < minX) minX = x; if (x > maxX) maxX = x
            if (y < minY) minY = y; if (y > maxY) maxY = y
          }
        }
      }
      const w = maxX - minX + 1, h = maxY - minY + 1
      const cc = document.createElement('canvas')
      cc.width = w; cc.height = h
      cc.getContext('2d').drawImage(c, minX, minY, w, h, 0, 0, w, h)
      out[code] = { png: cc.toDataURL('image/png'), w, h, ascent: REF - minY, descent: maxY - REF, ref: REF }
    }
    return out
  }, fontUrl, CODES, ACCENT, REF)

  const dir = path.join(root, 'assets/icons')
  fs.mkdirSync(dir, { recursive: true })
  const manifest = {}
  for (const [code, m] of Object.entries(metrics)) {
    fs.writeFileSync(path.join(dir, code + '.png'), Buffer.from(m.png.split(',')[1], 'base64'))
    manifest[code] = { w: m.w, h: m.h, ascent: m.ascent, descent: m.descent, ref: m.ref }
  }
  // 手工补充的图标:字体里没有、从开源 SVG 栅格化来的(目前只有 e900 奖杯)。
  // 它们的 PNG 直接放在 assets/icons/ 下,度量登记在 static.json —— 合并进来,
  // 否则重跑本脚本会把这些条目从 manifest 里抹掉,build/docx 就找不到尺寸了。
  const staticPath = path.join(dir, 'static.json')
  if (fs.existsSync(staticPath)) {
    Object.assign(manifest, JSON.parse(fs.readFileSync(staticPath, 'utf8')))
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log('图标(REF=' + REF + '):')
  for (const [c, m] of Object.entries(manifest)) {
    console.log(`  ${c}: ${m.w}x${m.h}  基线以上 ${m.ascent}  基线以下 ${m.descent}  → 高度 ${(m.h / m.ref).toFixed(3)}em`)
  }
} finally {
  await browser.close()
}
