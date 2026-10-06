// 构建脚本:resume.md -> resume.html -> resume.pdf
// 用法: node build.mjs [输入.md] [输出.pdf] [--theme 主题名]
// 依赖: marked(Markdown 解析) + puppeteer-core(驱动本机已装的 Chrome/Edge 打印 PDF)
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { renderResume } from './render.mjs'
import {
  findBrowser, isWindowsBrowserFromWsl, toWindowsPath, wslBrowserProfileDir,
  removeDirQuietly, launchBrowser,
} from './browser.mjs'

// 脚本位于 src/,项目根目录是它的上一层
const root = path.resolve(import.meta.dirname, '..')

// 版式主题 = assets/styles/<主题名>.css,再叠一份共用的 main.css。
// 默认 classic(黑体、姓名居中);--theme serif 换成宋体标题、姓名靠左。
const STYLE_DIR = path.join(root, 'assets/styles')
const argv = process.argv.slice(2)
const themeIdx = argv.indexOf('--theme')
const theme = themeIdx >= 0 ? argv[themeIdx + 1] : 'classic'
if (!theme) {
  console.error('用法:node src/build.mjs [输入.md] [输出.pdf] [--theme 主题名]')
  process.exit(1)
}
const themePath = path.join(STYLE_DIR, theme + '.css')
if (!fs.existsSync(themePath)) {
  const names = fs.readdirSync(STYLE_DIR)
    .filter((f) => f.endsWith('.css') && f !== 'main.css')
    .map((f) => f.replace(/\.css$/, ''))
  console.error(`没有主题「${theme}」。当前可用主题:${names.join('、')}`)
  process.exit(1)
}
// --theme 的值不是位置参数,摘掉之后剩下的才是 [输入.md] [输出.pdf]
const positional = themeIdx >= 0 ? argv.filter((_, i) => i !== themeIdx && i !== themeIdx + 1) : argv
const mdPath = positional[0] ? path.resolve(positional[0]) : path.join(root, 'resumes/_master/resume.md')
const pdfPath = positional[1] ? path.resolve(positional[1]) : path.join(root, 'resumes/_master/resume.pdf')
// HTML 输出在 PDF 旁边(默认都在项目根目录),这样 md 里的相对图片路径能正确解析
const htmlPath = path.join(path.dirname(pdfPath), path.basename(pdfPath).replace(/\.pdf$/i, '') + '.html')

// 浏览器定位与跨环境路径处理全部在 src/browser.mjs —— 三个脚本共用一份,别再在本地抄。

const { html } = renderResume({ root, markdown: fs.readFileSync(mdPath, 'utf8'), theme, htmlPath })
fs.writeFileSync(htmlPath, html, 'utf8')

const browserPath = findBrowser()
const isWinFromWsl = isWindowsBrowserFromWsl(browserPath)

// 两条渲染路径:
//  ① 原生平台(含 Linux 上的原生 Chrome):puppeteer 驱动,打印选项可控。
//  ② WSL + Windows 版浏览器:puppeteer **走不通** —— Windows 版 Chrome 把 DevTools
//     端口开在 Windows 自己的 127.0.0.1 上,WSL 这边的 127.0.0.1 是另一个 loopback,
//     连过去直接 ECONNREFUSED。所以改用 Chrome 命令行的 --print-to-pdf:
//     HTML 和输出都在 Windows 盘上,Windows 自己读写即可,不需要跨 VM 连端口。
if (isWinFromWsl) {
  if (!/^\/mnt\/[a-z]\//i.test(htmlPath)) {
    throw new Error(
      'WSL 里只能用 Windows 版浏览器,而它读不到 /mnt 以外的路径:\n' +
      `  ${htmlPath}\n` +
      '请把输入/输出放到 /mnt/<盘符>/ 下(如 /mnt/d/...);或安装 Linux 版 Chrome 并用 CHROME_PATH 指定。'
    )
  }
  const profileDir = wslBrowserProfileDir()
  const before = fs.existsSync(pdfPath) ? fs.statSync(pdfPath).mtimeMs : 0
  try {
    execFileSync(browserPath, [
      '--headless=new', '--disable-gpu',
      '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${toWindowsPath(profileDir)}`,
      // 与 puppeteer 那条路保持同一组渲染开关
      '--allow-file-access-from-files', '--no-sandbox',
      '--font-render-hinting=none', '--disable-lcd-text',
      // 去掉命令行打印默认带的页眉页脚(文件路径、页码)
      '--no-pdf-header-footer',
      `--print-to-pdf=${toWindowsPath(pdfPath)}`,
      'file:///' + toWindowsPath(htmlPath).replace(/\\/g, '/'),
    ], { stdio: 'ignore' })
  } finally {
    // 清掉本次的浏览器配置目录,别在 Windows 的 Temp 里越堆越多(清理失败不报错)
    removeDirQuietly(profileDir)
  }
  // 命令行打印没有可靠的失败信号,靠「文件确实被改写了」来判定
  if (!fs.existsSync(pdfPath) || fs.statSync(pdfPath).mtimeMs <= before) {
    throw new Error('浏览器没有产出 PDF:' + pdfPath)
  }
} else {
  // --disable-lcd-text:关掉次像素抗锯齿,文字渲染更接近 Word,便于两份文件比对
  const browser = await launchBrowser(browserPath, ['--disable-lcd-text'])
  try {
    const page = await browser.newPage()
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' })

    // 运行时自检:页头声明的正文字体 / 标题字体,必须真的有一份 @font-face 注册成功。
    // 静态路径检查只能证明"文件在",证明不了"浏览器认这个字体名" —— 名字写错、
    // format 不支持、字体文件损坏,都会让 @font-face 静默失效并回退系统字体。
    // 只查这两个字体(页面一定用到);全部 @font-face 都查会误报,因为字体是懒加载的。
    const fontReport = await page.evaluate(async () => {
      await document.fonts.ready
      const cs = getComputedStyle(document.body)
      const want = [cs.getPropertyValue('--text-font'), cs.getPropertyValue('--title-font')]
        .map((v) => v.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
      const out = {}
      for (const fam of [...new Set(want)]) {
        const faces = [...document.fonts].filter(
          (f) => f.family.replace(/^['"]|['"]$/g, '') === fam
        )
        out[fam] = faces.length ? faces.map((f) => f.status).join(',') : 'NOT_REGISTERED'
      }
      return out
    })
    const bad = Object.entries(fontReport).filter(([, s]) => /NOT_REGISTERED|error/.test(s))
    if (bad.length) {
      throw new Error(
        '正文/标题字体没有注册成功,@font-face 已静默失效(中文会回退系统字体或直接消失):\n' +
        bad.map(([f, s]) => `  ${f}: ${s}`).join('\n') +
        '\n请检查 assets/styles/*.css 里的 @font-face 与 --text-font / --title-font 是否对得上。'
      )
    }

    await page.emulateMediaType('print')
    // preferCSSPageSize:用 CSS 里的 @page(A4 + 13/15mm 边距),不在这里再设一遍
    await page.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true })
  } finally {
    await browser.close()
  }
}

console.log(`✓ 浏览器: ${browserPath}${isWinFromWsl ? '(WSL 调用 Windows 版)' : ''}`)
console.log(`✓ 主题  : ${theme}(${path.relative(root, themePath)})`)
console.log(`✓ 源文件: ${mdPath}`)
console.log(`✓ HTML  : ${htmlPath}`)
console.log(`✓ PDF   : ${pdfPath}`)
