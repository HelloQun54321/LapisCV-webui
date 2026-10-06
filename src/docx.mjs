// 构建 Word 版:resume.md -> resume.docx
// 用法: node docx.mjs [输入.md] [输出.docx]
//
// 目标:与 build.mjs 出的 PDF 在视觉上尽量一致,所以版式参数全部按 PDF 的 CSS 换算:
//   字体微软雅黑(两边都能渲染)· 主题色 #2f5a9e · 正文 10pt/行高 1.8 · 页边距 13/15mm
//   图标 → 同一张 PNG(build.mjs 里也是这张图)· 头像 → 22mm×32mm 浮动图片
import fs from 'node:fs'
import path from 'node:path'
import { marked } from 'marked'
import {
  Document, Packer, Paragraph, TextRun, ExternalHyperlink, PageBreak, ImageRun, Tab,
  AlignmentType, BorderStyle, TabStopType,
  HorizontalPositionRelativeFrom, HorizontalPositionAlign,
  VerticalPositionRelativeFrom, TextWrappingType, TextWrappingSide,
} from 'docx'

// 脚本位于 src/,项目根目录是它的上一层
const root = path.resolve(import.meta.dirname, '..')

// 版式主题 = assets/styles/<主题名>.css,与 build.mjs 共用同一批主题文件。
// 默认 classic;--theme serif 换成宋体标题、姓名靠左的那套。
const STYLE_DIR = path.join(root, 'assets/styles')
const argv = process.argv.slice(2)
const themeIdx = argv.indexOf('--theme')
const theme = themeIdx >= 0 ? argv[themeIdx + 1] : 'classic'
if (!theme) {
  console.error('用法:node src/docx.mjs [输入.md] [输出.docx] [--theme 主题名]')
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
const positional = themeIdx >= 0 ? argv.filter((_, i) => i !== themeIdx && i !== themeIdx + 1) : argv
const mdPath = positional[0] ? path.resolve(positional[0]) : path.join(root, 'resumes/_master/resume.md')
const outPath = positional[1] ? path.resolve(positional[1]) : path.join(root, 'resumes/_master/resume.docx')

const md = fs.readFileSync(mdPath, 'utf8')

// —— 版式参数 ——
// 原则:字体、字号、颜色一律**从 CSS 推导**,不在引擎里手抄。
// CSS 的取值顺序与浏览器(以及上游 vscode 的 markdown.styles)一致:
// main.css → 主题文件 → 简历 md 里的 <style> 覆盖。
// 这样改主题色/字号只需要改 CSS 一处,PDF 和 Word 不会各说各话。
// 去掉 @media 块:里面的覆盖只在特定媒体下生效(如 @media screen 把 --text-normal
// 设成 unset 供屏幕预览用),导出 Word 不能采纳,否则会拿到 unset 这类无效值。
function stripMediaBlocks(css) {
  let out = '', i = 0
  while (i < css.length) {
    const m = /@media[^{]*\{/.exec(css.slice(i))
    if (!m) { out += css.slice(i); break }
    out += css.slice(i, i + m.index)
    let j = i + m.index + m[0].length, depth = 1
    while (j < css.length && depth > 0) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++ }
    i = j
  }
  return out
}
const cssText = stripMediaBlocks([
  fs.readFileSync(path.join(STYLE_DIR, 'main.css'), 'utf8'),
  fs.readFileSync(themePath, 'utf8'),
  (md.match(/<style[^>]*>([\s\S]*?)<\/style>/i) || [])[1] || '',
].join('\n'))

// 同名变量取最后一次声明(等价于 CSS 的后者覆盖前者);unset/initial 之类视为「未设置」
const UNUSABLE = /^(unset|initial|inherit|revert|revert-layer)$/i
function cssVar(name, fallback) {
  const re = new RegExp('--' + name + '\\s*:\\s*([^;]+);', 'g')
  let v = null, m
  while ((m = re.exec(cssText))) {
    const val = m[1].replace(/!important/i, '').trim()
    if (val && !UNUSABLE.test(val)) v = val
  }
  return v ?? fallback
}
const ptOf = (name, fallback) => {
  const m = String(cssVar(name, fallback)).match(/([\d.]+)\s*pt/i)
  return m ? parseFloat(m[1]) : parseFloat(fallback)
}
// #rrggbb / #rrggbbaa 叠到白底上取实色(DOCX 的颜色不支持透明度)
function flatten(hex, alphaMul = 1, fallback = '000000') {
  const h = String(hex || '').replace('#', '').trim()
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return fallback
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  const a = (h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1) * alphaMul
  return ch.map((c) => Math.round(c * a + 255 * (1 - a)).toString(16).padStart(2, '0')).join('').toUpperCase()
}

const TWIP_MM = 56.6929
const EMU_MM = 36000
const PAGE_W = 11906, PAGE_H = 16838          // A4
const M_LR = Math.round(15 * TWIP_MM)         // 左右 15mm
const M_TB = Math.round(13 * TWIP_MM)         // 上下 13mm
const TAB_RIGHT = PAGE_W - M_LR * 2           // 版心右边界

// 字体:仓库自带的字体只在 PDF 里通过 @font-face 生效,Word 是按名字找系统字体,
// 所以这些别名必须换成同风格的系统字体,否则 Word 会 fallback 跑版。
const BUNDLED_TO_SYSTEM = {
  sourcehansanscn: 'Microsoft YaHei',
  sourcehansanserifcn: 'SimSun',
  sourcehanserifcn: 'SimSun',
  jetbrainsmono: 'Consolas',
  'lapiscv icon': 'Microsoft YaHei',
}
const systemFontOf = (name) => BUNDLED_TO_SYSTEM[String(name).toLowerCase()] ?? name
const fontObj = (name) => ({ ascii: name, hAnsi: name, eastAsia: name, cs: name })

const cssFont = cssVar('text-font', "'Microsoft YaHei'").split(',')[0].replace(/['"]/g, '').trim()
const FONT_NAME = systemFontOf(cssFont)
if (FONT_NAME !== cssFont) {
  console.log(`  · 正文字体 ${cssFont} 不是系统字体,Word 版改用 ${FONT_NAME}(PDF 仍用原字体;两边要完全一致,请在 md 的 <style> 里把 --text-font 设成系统字体)`)
}
const FONT = fontObj(FONT_NAME)

// 标题字体单独看 --title-font:classic 与正文一样是黑体,serif 则是宋体
const cssTitleFont = cssVar('title-font', "'Microsoft YaHei'").split(',')[0].replace(/['"]/g, '').trim()
const TITLE_FONT_NAME = systemFontOf(cssTitleFont)
if (TITLE_FONT_NAME !== cssTitleFont && TITLE_FONT_NAME !== FONT_NAME) {
  console.log(`  · 标题字体 ${cssTitleFont} 不是系统字体,Word 版改用 ${TITLE_FONT_NAME}`)
}
const TITLE_FONT = fontObj(TITLE_FONT_NAME)
const TEXT = flatten(cssVar('text-normal', '#353a42'))                       // --text-normal
const ACCENT_HEX = cssVar('color-accent', '#00327dac')
const ACCENT = flatten(ACCENT_HEX)                                           // --color-accent(透明则叠白)
const RULE = flatten(ACCENT_HEX, 0.4)                                        // h2 下划线 = accent 40% 叠白
const S_H1 = Math.round(ptOf('h1-size', '16pt') * 2)                         // w:sz 用半磅
const S_H2 = Math.round(ptOf('h2-size', '12pt') * 2)
const S_H3 = Math.round(ptOf('h3-size', '10.5pt') * 2)
const S_BODY = Math.round(ptOf('text-size', '10pt') * 2)
const S_CONTACT = Math.round(ptOf('blockquote-size', '9.5pt') * 2)
// Word 的「倍数行距」按字体自身行高计算,和 CSS 的 line-height 不是一回事,
// 所以统一用「固定值」(exact):行距 = 字号(pt) × 该元素的 line-height × 20 twips。
// 下面三个倍数是 LapisCV 的结构性取值(见 main.css 的 h1 / h2 / blockquote 规则)。
const L_BODY = Math.round(ptOf('text-size', '10pt') * parseFloat(cssVar('line-height', '1.8')) * 20)
const L_H1 = Math.round(ptOf('h1-size', '16pt') * 1.5 * 20)
const L_H2 = Math.round(ptOf('h2-size', '12pt') * 1 * 20)
const L_H3 = Math.round(ptOf('h3-size', '10.5pt') * parseFloat(cssVar('line-height', '1.8')) * 20)
const L_CONTACT = Math.round(ptOf('blockquote-size', '9.5pt') * 1.6 * 20)
// 项目符号:Word / LibreOffice 在悬挂缩进下对制表位处理不一致,所以不用制表位,
// 直接用「•」+ 空格。左边距取 CSS 里 ul 的缩进(3mm)再往前留出符号位。
const LIST_LEFT = Math.round(4.4 * TWIP_MM), LIST_HANG = Math.round(2.0 * TWIP_MM)
const S_BULLET = Math.round(ptOf('text-size', '10pt') * 2 * 0.9)             // 「•」略小于正文
// 头像默认尺寸取 CSS 的 --avatar-width / --avatar-height;md 里 img 上的行内 style 可覆盖。
// 证件照是竖版,宽高不相等,所以不能只读宽度;未定义 --avatar-height 时才退回与宽度相等
// (与 main.css 里 `height: var(--avatar-height, var(--avatar-width))` 的行为一致)。
const mmVar = (name, fallbackMm) => {
  const v = parseFloat(String(cssVar(name, fallbackMm + 'mm')).replace(/[^\d.]/g, ''))
  return Number.isFinite(v) && v > 0 ? v : fallbackMm
}
const AVATAR_DEFAULT_W_MM = mmVar('avatar-width', 22)
const AVATAR_DEFAULT_H_MM = mmVar('avatar-height', AVATAR_DEFAULT_W_MM)
// 头像顶端距「上边距」的距离(mm),取各自主题 PDF 的实测值。
// 基准用「页边距」而不是「段落」:后者各家查看器解释不一致,Word 里会明显偏上。
// classic 头像落在版心内偏上;serif 的主题用 margin-top:-29mm 把头像顶到接近纸张顶端,
// 所以那边的相对偏移是负的。
const AVATAR_TOP_MM = { classic: 13.0, serif: 0.5 }[theme] ?? 13.0
const AVATAR_TOP_EMU = Math.round(AVATAR_TOP_MM * 36000)

// 姓名与联系方式的对齐方式同样来自 CSS:classic 居中,serif 改成了靠左。
// 只认直接选中该标签的选择器(如 "h1, blockquote p { text-align: ... }"),
// 忽略 "h3 a" 这类后代选择器;后面的规则覆盖前面的,与浏览器一致。
function cssAlignOf(tag, fallback) {
  const src = cssText.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const num = { left: AlignmentType.LEFT, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED, center: AlignmentType.CENTER }
  let val = fallback
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(src))) {
    if (!m[1].split(',').map((s) => s.trim()).includes(tag)) continue
    const d = /(?:^|;)\s*text-align\s*:\s*([a-z-]+)/i.exec(m[2])
    if (d) val = d[1].toLowerCase()
  }
  return num[val] ?? AlignmentType.CENTER
}
const ALIGN_HEADER = cssAlignOf('h1', 'center')

const iconSheet = JSON.parse(fs.readFileSync(path.join(root, 'assets/icons/manifest.json'), 'utf8'))
const iconCache = new Map()
function iconImage(code, sizeHalfPt) {
  const it = iconSheet[code]
  if (!it) return null
  let buf = iconCache.get(code)
  if (!buf) { buf = fs.readFileSync(path.join(root, 'assets/icons', code + '.png')); iconCache.set(code, buf) }
  const fontPx = (sizeHalfPt || S_BODY) * (2 / 3)         // 半磅 → px(96dpi)
  return new ImageRun({
    type: 'png',
    data: buf,
    transformation: {
      width: Math.round((it.w / it.ref) * fontPx),
      height: Math.round((it.h / it.ref) * fontPx),
    },
  })
}

const decode = (s) => String(s ?? '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  // &emsp; 是 1em 宽的空格,必须还原成 em space,不能用普通空格顶替
  // (联系方式那一行用了多个 &emsp;,换成普通空格会窄 10mm 以上)
  .replace(/&emsp;|&#8195;/g, '\u2003')
  .replace(/&nbsp;|&#160;/g, '\u00a0')
  // 图标字体的 PUA 字形(`&#xeXXX;`)Word 里没有对应字体,直接去掉,免得显示成乱码/字面实体
  .replace(/&#x[eE][0-9a-fA-F]{3};[ \t]?/g, '')
  .replace(/[\uE000-\uF8FF][ \t]?/g, '')
const stripTags = (s) => decode(String(s ?? '').replace(/<[^>]*>/g, ''))

// 行内 token → TextRun / ImageRun / 超链接
function inline(tokens, opt = {}) {
  const out = []
  for (const t of tokens || []) {
    switch (t.type) {
      case 'text': {
        // 文本里可能夹着图标占位符 [[eXXX]]
        const parts = String(t.text ?? t.raw ?? '').split(/(\[\[e[0-9a-fA-F]{3}\]\])/g)
        for (const p of parts) {
          if (!p) continue
          const m = p.match(/^\[\[(e[0-9a-fA-F]{3})\]\]$/)
          if (m) {
            const img = iconImage(m[1].toLowerCase(), opt.size)
            if (img) out.push(img)
          } else {
            out.push(new TextRun({ text: decode(p), ...opt }))
          }
        }
        break
      }
      case 'strong': out.push(...inline(t.tokens, { ...opt, bold: true })); break
      case 'em': out.push(...inline(t.tokens, { ...opt, italics: true })); break
      case 'codespan': out.push(new TextRun({ text: decode(t.text), ...opt })); break
      case 'link': {
        const runs = inline(t.tokens, { ...opt, color: opt.linkColor || ACCENT })
        out.push(new ExternalHyperlink({
          children: runs.length ? runs : [new TextRun({ text: t.href, color: opt.linkColor || ACCENT, ...opt })],
          link: t.href,
        }))
        break
      }
      case 'br': out.push(new TextRun({ break: 1 })); break
      case 'html': {
        const raw = t.raw || ''
        if (/<img|class="icon"/i.test(raw)) break
        const s = stripTags(raw)
        if (s.trim()) out.push(new TextRun({ text: s, ...opt }))
        break
      }
      default:
        if (t.tokens) out.push(...inline(t.tokens, opt))
        else if (t.text) out.push(new TextRun({ text: decode(t.text), ...opt }))
    }
  }
  return out
}

// “左标题 / 右时间”一行
function entryTitle(raw) {
  const inner = (raw.match(/<div[^>]*(?:class|alt)="entry-title"[^>]*>([\s\S]*?)<\/div>/i) || [])[1]
  if (!inner) return null
  const h3 = (inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i) || [])[1] || ''
  const p = (inner.match(/<p[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || ''
  const a = inner.match(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i)
  const children = [new TextRun({ text: stripTags(h3), bold: true, size: S_H3, color: TEXT, font: TITLE_FONT })]
  const right = stripTags(p)
  if (right) {
    // 必须用 OOXML 的 <w:tab/> 元素;字面 \t 会被 Word 当作空格,右对齐就失效
    children.push(new TextRun({ children: [new Tab()], size: S_BODY, font: FONT }))
    children.push(new TextRun({ text: right, size: S_BODY, color: TEXT, font: FONT }))
  } else if (a) {
    children.push(new TextRun({ children: [new Tab()], size: S_BODY, font: FONT }))
    children.push(new ExternalHyperlink({
      children: [new TextRun({ text: stripTags(a[2]), size: S_BODY, color: ACCENT, font: FONT })],
      link: a[1],
    }))
  }
  return new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: TAB_RIGHT }],
    spacing: { before: 0, after: 0, line: L_H3, lineRule: 'exact' },
    children,
  })
}

// 块级 token → Paragraph
function blocks(tokens, ctx) {
  const out = []
  for (const t of tokens) {
    switch (t.type) {
      case 'heading': {
        if (t.depth === 1) {
          out.push(new Paragraph({
            alignment: ALIGN_HEADER,
            spacing: { before: 0, after: 0, line: L_H1, lineRule: 'exact' },
            children: [
              ...inline(t.tokens, { bold: true, size: S_H1, color: TEXT, font: TITLE_FONT }),
              ...(ctx.avatar ? [ctx.avatar] : []),   // 头像浮动锚定在姓名这一段
            ],
          }))
        } else if (t.depth === 2) {
          out.push(new Paragraph({
            spacing: { before: 193, after: 108, line: L_H2, lineRule: 'exact' },
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 3 } },
            children: inline(t.tokens, { bold: true, size: S_H2, color: ACCENT, font: TITLE_FONT }),
          }))
        } else {
          out.push(new Paragraph({
            spacing: { before: 0, after: 0, line: L_H3, lineRule: 'exact' },
            children: inline(t.tokens, { bold: true, size: S_H3, color: TEXT, font: TITLE_FONT }),
          }))
        }
        break
      }
      case 'blockquote': {
        // 联系方式:居中、9.5pt、正文色(链接也不上主题色,与 CSS 的 blockquote a 一致)
        const paras = t.tokens && t.tokens[0] && t.tokens[0].type === 'paragraph' ? t.tokens : [t]
        for (const bq of paras) {
          out.push(new Paragraph({
            alignment: ALIGN_HEADER,
            spacing: { before: 0, after: 0, line: L_CONTACT, lineRule: 'exact' },
            children: inline(bq.tokens, { size: S_CONTACT, color: TEXT, font: FONT, linkColor: TEXT }),
          }))
        }
        break
      }
      case 'paragraph': {
        const runs = inline(t.tokens, { size: S_BODY, color: TEXT, font: FONT })
        if (runs.length) out.push(new Paragraph({
          spacing: { before: 0, after: 0, line: L_BODY, lineRule: 'exact' },
          children: runs,
        }))
        break
      }
      case 'list': {
        for (const item of t.items || []) {
          let toks = []
          for (const it of item.tokens || []) {
            if (it.type === 'text' && it.tokens) { toks = it.tokens; break }
            if (it.type === 'text' && it.text) { toks = [{ type: 'text', text: it.text }]; break }
          }
          const runs = inline(toks, { size: S_BODY, color: TEXT, font: FONT })
          if (runs.length) out.push(new Paragraph({
            indent: { left: LIST_LEFT, hanging: LIST_HANG },
            spacing: { before: 0, after: 0, line: L_BODY, lineRule: 'exact' },
            children: [
              new TextRun({ text: '•', size: S_BULLET, color: TEXT, font: FONT }),
              new TextRun({ text: ' ', size: S_BODY, font: FONT }),
              ...runs,
            ],
          }))
        }
        break
      }
      case 'html': {
        if (/class="avatar"/.test(t.raw || '')) break   // 头像已作为浮动图片处理
        const et = entryTitle(t.raw || '')
        if (et) out.push(et)
        break
      }
      case 'hr': out.push(new Paragraph({ children: [new PageBreak()] })); break
      default:
        if (t.tokens) out.push(...blocks(t.tokens, ctx))
    }
  }
  return out
}

const tokens = marked.lexer(md)

// 头像:从 md 里的 <img class="avatar" src="..."> 读取,做成浮动图片放在版心右上
let avatar = null
// 注意排除被注释掉的头像(`<!-- <img class="avatar" ...> -->` 也会匹配到 class="avatar")
const avatarTag = (tokens.find((t) => t.type === 'html' && /class="avatar"/.test(t.raw || '') && !/^\s*<!--/.test(t.raw || '')) || {}).raw || ''
const avatarSrc = (avatarTag.match(/src="([^"]+)"/) || [])[1]
// 远程 URL 在 docx 里用不了(需要先下载成文件),静默跳过
const isRemote = /^https?:/i.test(avatarSrc || '')
const avatarFile = avatarSrc && !isRemote ? path.resolve(root, avatarSrc) : null
if (avatarFile && !fs.existsSync(avatarFile)) {
  console.warn(`! 头像文件不存在,已跳过: ${avatarFile}`)
}
if (avatarFile && fs.existsSync(avatarFile)) {
  // 尺寸优先取 img 上的行内 style(如 width:22mm;height:32mm),取不到就用默认值
  const mmOf = (prop, fallback) => {
    const m = avatarTag.match(new RegExp(prop + '\\s*:\\s*([\\d.]+)mm', 'i'))
    return m ? parseFloat(m[1]) : fallback
  }
  const wMm = mmOf('width', AVATAR_DEFAULT_W_MM)
  const hMm = mmOf('height', AVATAR_DEFAULT_H_MM)
  const ext = path.extname(avatarFile).slice(1).toLowerCase()
  avatar = new ImageRun({
    type: ext === 'jpeg' ? 'jpg' : ext,
    data: fs.readFileSync(avatarFile),
    transformation: {
      width: Math.round((wMm / 25.4) * 96),
      height: Math.round((hMm / 25.4) * 96),
    },
    floating: {
      horizontalPosition: { relative: HorizontalPositionRelativeFrom.MARGIN, align: HorizontalPositionAlign.RIGHT },
      verticalPosition: { relative: VerticalPositionRelativeFrom.MARGIN, offset: AVATAR_TOP_EMU },
      wrap: { type: TextWrappingType.SQUARE, side: TextWrappingSide.LEFT },
      margins: { left: 4 * EMU_MM, top: 0, bottom: 0, right: 0 },
      // 置于最上层:与 CSS 里 .avatar 的 z-index 一致,避免章节横线穿过照片
      behindDocument: false,
      allowOverlap: true,
      zIndex: 1000,
    },
  })
}

const children = blocks(tokens, { avatar })

const doc = new Document({
  creator: 'resume-cn',
  title: '简历',
  sections: [{
    properties: {
      page: {
        size: { width: PAGE_W, height: PAGE_H },
        margin: { top: M_TB, bottom: M_TB, left: M_LR, right: M_LR },
      },
    },
    children,
  }],
})

fs.writeFileSync(outPath, await Packer.toBuffer(doc))
console.log(`✓ 源文件: ${mdPath}`)
console.log(`✓ DOCX  : ${outPath}`)
console.log(`  段落数: ${children.length}${avatar ? ' · 含浮动头像' : ''}`)
