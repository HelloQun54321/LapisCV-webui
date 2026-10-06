// 生成屏幕预览图 preview.png(A4 纸张样式,所见即所得,不发 PDF)
// 用法: node preview.mjs [输入.html] [输出.png]
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { findBrowser, requireNativeBrowser, launchBrowser } from './browser.mjs'

// 脚本位于 src/,项目根目录是它的上一层
const root = path.resolve(import.meta.dirname, '..')
// 用法: node preview.mjs [输入.html] [输出.png]
const htmlPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'resumes/_master/resume.html')
const pngPath = process.argv[3] ? path.resolve(process.argv[3]) : path.join(root, 'resumes/_master/preview.png')

if (!fs.existsSync(htmlPath)) {
  console.error('未找到 resume.html,请先运行:npm run build')
  process.exit(1)
}

const browserPath = findBrowser()
// 截图要走 CDP,所以必须是本机原生浏览器(WSL 那头的 Windows 版连不上调试端口)
requireNativeBrowser(browserPath, 'preview.mjs')

const browser = await launchBrowser(browserPath)
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 900, height: 1200, deviceScaleFactor: 2 })
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' })
  await page.screenshot({ path: pngPath, fullPage: true })
} finally {
  await browser.close()
}
console.log(`✓ 浏览器: ${browserPath}`)
console.log(`✓ 预览图: ${pngPath}`)
