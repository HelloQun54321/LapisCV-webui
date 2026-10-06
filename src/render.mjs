// CLI 和 WebUI 共用同一条 Markdown → HTML 渲染链。
import fs from 'node:fs'
import path from 'node:path'
import { marked } from 'marked'
import { resumeLayouts, resolveResumeLayout, htmlBlockKind, projectProfile, decorateContactBreaks } from '../web/resume-layout.js'

export function themes(root) {
  const names = fs.readdirSync(path.join(root, 'assets/styles')).filter(f => f.endsWith('.css') && f !== 'main.css').map(f => f.slice(0, -4))
  return [...resumeLayouts.map(layout => layout.id).filter(id => names.includes(id)), ...names.filter(id => !resumeLayouts.some(layout => layout.id === id))]
}

export function renderResume({ root, markdown, theme = 'classic', htmlPath }) {
  theme = resolveResumeLayout(theme)
  const STYLE_DIR = path.join(root, 'assets/styles')
  if (!themes(root).includes(theme)) throw new Error('没有主题「' + theme + '」')
  const themePath = path.join(STYLE_DIR, theme + '.css')
  // 页面尺寸与边距:LapisCV 推荐 A4,上下 13mm、左右 15mm
  const PAGE = { size: 'A4', w: '210mm', h: '297mm', tb: '13mm', lr: '15mm' }

  // 图标占位符 [[eXXX]] → <img>。高度按图标在字体里的实际墨迹高度换算,
  // 这样 PDF(浏览器)和 Word(图片)用的是同一张图、同一个尺寸,不会跑偏。
  const iconSheet = JSON.parse(fs.readFileSync(path.join(root, 'assets/icons/manifest.json'), 'utf8'))
  let md = markdown
  md = md.replace(/\[\[(e[0-9a-fA-F]{3})\]\]/g, (all, code) => {
    const c = code.toLowerCase()
    const it = iconSheet[c]
    const em = it ? (it.h / it.ref).toFixed(3) : '0.9'
    return `<img class="ic" src="assets/icons/${c}.png" style="height:${em}em" alt="">`
  })
  const tokens = marked.lexer(md)
  const fragments = tokens.map(token => {
    const block = [token]; block.links = tokens.links
    return marked.parser(block)
  })
  const projection = projectProfile(fragments.map(htmlBlockKind))
  let body = fragments.map((html, index) => {
    if (projection.blocks[index]['data-profile-role'] === 'info') html = decorateContactBreaks(html)
    const attributes = { ...projection.blocks[index] }, style = attributes.style
    delete attributes.style
    const attrs = Object.entries(attributes).map(([key, value]) => `${key}="${value}"`).join(' ')
    return html.replace(/^(\s*)<([a-z][\w-]*)([^>]*)>/i, (_all, lead, tag, original) => {
      let rest = original
      if (style) {
        if (/\bstyle=["']/i.test(rest)) rest = rest.replace(/\bstyle=(["'])(.*?)\1/i, (_m, quote, css) => 'style=' + quote + css + ';' + style + quote)
        else rest += ' style="' + style + '"'
      }
      return lead + '<' + tag + (attrs ? ' ' + attrs : '') + rest + '>'
    })
  }).join('')
  body = `<div class="resume-content" data-profile-avatar="${projection.container['data-profile-avatar']}" style="${projection.container.style}">\n${body}</div>`

  // HTML 写在 PDF 旁边(可能在 resumes/<名字>/ 子目录里),所以要把素材引用
  // 改写成「相对 HTML 所在目录」的路径,否则图片会 404。
  const relToRoot = path.relative(path.dirname(htmlPath), root).split(path.sep).join('/')
  const assetPrefix = relToRoot ? relToRoot + '/' : ''
  if (assetPrefix) body = body.replace(/(src|href)="assets\//g, `$1="${assetPrefix}assets/`)

  // 顺序必须与上游一致:main.css 在前、主题文件在后。
  // 主题靠「写在后面」来做覆盖(serif 就是靠这个把 h1 改成左对齐、把头像的边框和光晕去掉)。
  let css =
    fs.readFileSync(path.join(STYLE_DIR, 'main.css'), 'utf8') +
    '\n' +
    fs.readFileSync(themePath, 'utf8')
  // 字体在 assets/fonts 下,CSS 里的相对路径按内联后的位置修正。
  //
  // ⚠ 这里踩过一个很隐蔽的坑:CSS 里的 url() 是**按 HTML 文档所在目录**解析的,
  // 而 HTML 输出在 resumes/<名字>/ 下,不是项目根目录。所以必须补上和图片同一套的
  // assetPrefix(../../ 这种),否则路径指向 resumes/<名字>/assets/fonts/... 直接 404。
  //
  // 而 @font-face 加载失败是**静默的** —— 浏览器不报错,直接回退系统字体。
  // Windows 上有 Noto Sans SC 兜底,看着一切正常;一到 Linux(没有 CJK 系统字体)
  // 中文就会**整片消失**。所以下面紧跟一道自检,见 assertFontUrlsResolve()。
  css = css.replaceAll('../fonts/', assetPrefix + 'assets/fonts/')

  // 页边距统一由 @page 控制:PDF 与网页预览保持一致
  const layoutCss = `
  @page { size: ${PAGE.size}; margin: ${PAGE.tb} ${PAGE.lr}; }
  html { margin: 0; padding: 0; }
  body {
    margin: 0;
    padding: 0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    --background-primary: #fff;
  }

  /* 独立横线与单个章节的线条属性由简历中的 CSS 变量保存，屏幕与 PDF 共用。 */
  h2[data-resume-rule] { position: relative; border-bottom: none !important; padding-bottom: var(--resume-rule-gap, 1mm) !important; }
  .resume-divider { position: relative; height: 1mm; margin: var(--resume-rule-gap, 2mm) 0; padding: 0; border: none; break-inside: avoid; cursor: pointer; }
  h2[data-resume-rule]::after, .resume-divider::after {
    content: ''; position: absolute; pointer-events: none;
    left: var(--resume-rule-x, 0mm); bottom: calc(-1 * var(--resume-rule-y, 0mm));
    width: var(--resume-rule-width, 100%);
    border-top: var(--resume-rule-thickness, .25mm) var(--resume-rule-style, solid) var(--resume-rule-color, #a2b6d4);
  }
  table { max-width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #d8e1ed; padding: 1mm 2mm; vertical-align: top; }

  /* 屏幕预览:套一张 A4 纸的壳,所见即所得 */
  @media screen {
    body { background: #e9edf2; padding: 0; box-shadow: none; }
    .page {
      box-sizing: border-box;
      width: ${PAGE.w};
      min-height: ${PAGE.h};
      padding: ${PAGE.tb} ${PAGE.lr};
      margin: 8mm auto;
      background: #fff;
      box-shadow: 0 0 4mm 0 #a7bbc969;
    }
  }

  /* 打印 / 导出 PDF:边距交给 @page,壳只做透明化,避免重复计算 */
  @media print {
    .page {
      width: auto;
      min-height: 0;
      padding: 0;
      margin: 0;
      background: #fff;
      box-shadow: none;
    }
  }
  `

  const html = `<!doctype html>
  <html lang="zh-CN">
  <head>
  <meta charset="utf-8">
  <title>简历</title>
  <style>
  ${css}
  ${layoutCss}
  </style>
  </head>
  <body>
  <div class="page">
  ${body}
  </div>
  </body>
  </html>
  `



  // 自检:CSS 里每个本地字体 url() 都必须能解析到真实文件。
  //
  // 为什么非要有这道检查:@font-face 加载失败**不报错**,浏览器只是悄悄回退系统字体。
  // 2026-09 就因此中过一次招 —— 字体路径少了 ../../ 前缀,Windows 上有 Noto Sans SC
  // 兜底所以完全看不出来,换到没装 CJK 字体的 Linux 上中文直接整片消失,
  // 而且一路静默产出了好几版没有中文的 PDF。
  //
  // 这里做的是静态检查(纯 Node,不需要浏览器),所以 puppeteer 和 WSL-CLI 两条路都覆盖。
  function assertFontUrlsResolve() {
    const urls = [...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1])
    const broken = []
    for (const raw of urls) {
      if (/^(data:|https?:|\/\/)/.test(raw)) continue // 外链和 data: 不检查
      // 去掉缓存破坏参数(?t=...)和锚点,它们只对 HTTP 有意义,本地文件按纯路径找
      const u = raw.split(/[?#]/)[0]
      if (!u) continue
      const resolved = path.resolve(path.dirname(htmlPath), u)
      if (!fs.existsSync(resolved)) broken.push({ u: raw, resolved })
    }
    if (broken.length) {
      throw new Error(
        '字体文件路径解析不到(会导致 @font-face 静默失效、中文消失):\n' +
        broken.map((b) => `  CSS 里写: ${b.u}\n  实际去找: ${b.resolved}`).join('\n') +
        `\n\nHTML 在 ${path.dirname(htmlPath)}/,CSS 里的相对 url() 是按这个目录解析的。`
      )
    }
  }
  assertFontUrlsResolve()
  return { html, css, themePath }


}
