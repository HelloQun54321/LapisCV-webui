import { Editor, Node, Extension, mergeAttributes } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TextStyleKit, TextStyle } from '@tiptap/extension-text-style'
import TextAlign from '@tiptap/extension-text-align'
import { DOMParser as PMParser, DOMSerializer, Slice } from '@tiptap/pm/model'
import { MarkdownSerializer, defaultMarkdownSerializer } from 'prosemirror-markdown'
import { marked } from 'marked'
import { TextSelection, NodeSelection, Plugin } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { withPrintPalette } from './appearance.js'
import { htmlBlockKind, projectProfile, photoDimensions } from './resume-layout.js'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { createAlignmentGuides } from './alignment-guides.js'

const blockTypes = ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'codeBlock', 'resumeEntry', 'resumeAvatar', 'resumeImage', 'resumeDivider', 'resumeTable', 'resumeRow', 'resumeCell', 'resumeHeader', 'rawBlock', 'horizontalRule']
const publicAttributes = {
  default: null,
  parseHTML: el => {
    const handled = new Set(['style', 'src', 'href', 'alt', 'start', 'contenteditable', 'draggable', 'spellcheck', 'translate'])
    const attrs = Object.fromEntries([...el.attributes].filter(attr => !handled.has(attr.name) && !/^on/i.test(attr.name)).map(attr => [attr.name, attr.value]))
    return Object.keys(attrs).length ? attrs : null
  },
  renderHTML: attrs => attrs.htmlAttributes || {},
}
const sourceAttributes = Extension.create({
  name: 'sourceAttributes',
  addGlobalAttributes: () => [{ types: blockTypes, attributes: { sourceId: { default: null, rendered: false }, htmlAttributes: publicAttributes } }, { types: ['blockquote', 'bulletList', 'orderedList', 'listItem', 'codeBlock', 'horizontalRule', 'resumeRow'], attributes: { style: { default: null } } }, { types: ['link', 'textStyle'], attributes: { htmlAttributes: publicAttributes } }, { types: ['textStyle'], attributes: { extraStyle: { default: null, parseHTML: el => { const copy = el.cloneNode(); for (const key of ['font-size', 'font-family', 'line-height', 'color', 'background-color', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-line']) copy.style.removeProperty(key); return copy.getAttribute('style') || null }, renderHTML: attrs => attrs.extraStyle ? { style: attrs.extraStyle } : {} } } }],
})
const StyledText = TextStyle.extend({ parseHTML() { return this.parent().map(rule => ({ ...rule, getAttrs: el => el.hasAttribute('style') ? rule.getAttrs(el) : publicAttributes.parseHTML(el) ? {} : false })) } })
const Entry = Node.create({
  name: 'resumeEntry', group: 'block', content: 'heading paragraph', defining: true,
  parseHTML: () => [{ tag: 'div.entry-title', priority: 100 }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { class: 'entry-title' }), 0],
})
const Icon = Node.create({
  name: 'resumeIcon', group: 'inline', inline: true, atom: true,
  addAttributes: () => ({ code: { default: 'e618', parseHTML: el => el.dataset.icon || el.getAttribute('src')?.match(/(e[0-9a-f]{3})\.png/i)?.[1], rendered: false }, ratio: { default: .87, parseHTML: el => parseFloat(el.style.height) || .87, rendered: false } }),
  parseHTML: () => [{ tag: 'img.ic' }],
  renderHTML: ({ node }) => ['img', { class: 'ic', src: '/assets/icons/' + node.attrs.code + '.png', 'data-icon': node.attrs.code, alt: '', style: 'height:' + node.attrs.ratio + 'em' }],
})
const Avatar = Node.create({
  name: 'resumeAvatar', group: 'block', atom: true, draggable: true,
  addAttributes: () => ({
    src: { default: '', parseHTML: el => el.getAttribute('src')?.replace(/^\//, '') },
    alt: { default: '' },
    style: { default: null, parseHTML: el => el.getAttribute('style') },
  }),
  parseHTML: () => [{ tag: 'img.avatar', priority: 110 }, { tag: 'img[alt="avatar"]', priority: 110 }],
  renderHTML: ({ HTMLAttributes }) => ['img', mergeAttributes(HTMLAttributes, { class: 'avatar', src: /^assets\//.test(HTMLAttributes.src) ? '/' + HTMLAttributes.src : HTMLAttributes.src })],
})
const Divider = Node.create({
  name: 'resumeDivider', group: 'block', atom: true, draggable: true,
  addAttributes: () => ({ style: { default: null } }),
  parseHTML: () => [{ tag: 'div.resume-divider', priority: 110 }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { class: 'resume-divider', 'aria-label': '装饰横线' })],
})
const Table = Node.create({ name: 'resumeTable', group: 'block', content: 'resumeRow+', isolating: true,
  addAttributes: () => ({ style: { default: null } }), parseHTML: () => [{ tag: 'table' }], renderHTML: ({ HTMLAttributes }) => ['table', HTMLAttributes, ['tbody', 0]] })
const Row = Node.create({ name: 'resumeRow', content: '(resumeCell | resumeHeader)+', parseHTML: () => [{ tag: 'tr' }], renderHTML: ({ HTMLAttributes }) => ['tr', HTMLAttributes, 0] })
const Cell = Node.create({ name: 'resumeCell', content: 'block+', isolating: true, addAttributes: () => ({ style: { default: null } }), parseHTML: () => [{ tag: 'td' }], renderHTML: ({ HTMLAttributes }) => ['td', HTMLAttributes, 0] })
const Header = Cell.extend({ name: 'resumeHeader', parseHTML: () => [{ tag: 'th' }], renderHTML: ({ HTMLAttributes }) => ['th', HTMLAttributes, 0] })
const Image = Node.create({
  name: 'resumeImage', group: 'inline', inline: true, atom: true, draggable: true,
  addAttributes: () => ({ src: { default: '', parseHTML: el => el.getAttribute('src')?.replace(/^\//, '') }, alt: { default: '' }, title: { default: null }, style: { default: null } }),
  parseHTML: () => [{ tag: 'img:not(.ic):not(.avatar)' }],
  renderHTML: ({ HTMLAttributes }) => ['img', mergeAttributes(HTMLAttributes, { src: /^assets\//.test(HTMLAttributes.src) ? '/' + HTMLAttributes.src : HTMLAttributes.src })],
})
function safeHtml(doc, html) {
  const container = doc.createElement('div')
  container.innerHTML = html
  container.querySelectorAll('script,iframe,object,embed,form,input,button,textarea,select,link,meta,base').forEach(el => el.remove())
  container.querySelectorAll('*').forEach(el => {
    for (const attr of [...el.attributes]) if (/^on/i.test(attr.name) || (['href', 'src'].includes(attr.name) && /^\s*(javascript|vbscript):/i.test(attr.value))) el.removeAttribute(attr.name)
  })
  return container
}
function pastedHtml(doc, html) {
  const container = safeHtml(doc, html)
  container.querySelectorAll('style').forEach(el => el.remove())
  const properties = new Set(['font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'color', 'font-size', 'font-family', 'text-align'])
  container.querySelectorAll('*').forEach(el => {
    if (el.hasAttribute('style')) {
      for (const property of [...el.style]) if (!properties.has(property)) el.style.removeProperty(property)
      const size = el.style.fontSize.match(/^([\d.]+)(px|pt)$/)
      if (size) el.style.fontSize = Math.max(6, Math.min(40, Number(size[1]) * (size[2] === 'px' ? .75 : 1))) + 'pt'
      else el.style.removeProperty('font-size')
      if (el.style.fontFamily) el.style.fontFamily = /宋|SimSun|serif/i.test(el.style.fontFamily) && !/sans/i.test(el.style.fontFamily) ? 'SourceHanSerifCN' : /Consolas|Mono|Courier/i.test(el.style.fontFamily) ? 'JetBrainsMono' : 'SourceHanSansCN'
    }
    for (const attr of [...el.attributes]) if (!['style', 'href', 'src', 'alt', 'title', 'start'].includes(attr.name)) el.removeAttribute(attr.name)
  })
  return container.innerHTML
}
const Raw = Node.create({
  name: 'rawBlock', group: 'block', atom: true,
  addAttributes: () => ({ raw: { default: '', rendered: false }, html: { default: '', rendered: false }, hidden: { default: false, rendered: false } }),
  renderHTML: () => ['div', { class: 'preserved-block' }],
  addNodeView: () => ({ node, editor, view }) => {
    const dom = view.dom.ownerDocument.createElement('div')
    dom.className = node.attrs.hidden ? 'preserved-source' : 'preserved-block'
    dom.contentEditable = 'false'
    if (!node.attrs.hidden) {
      dom.title = '双击编辑此自定义块，或在源码模式编辑'
      dom.append(...safeHtml(dom.ownerDocument, node.attrs.html).childNodes)
      dom.ondblclick = event => { event.preventDefault(); editor.options.onEditRaw?.(node) }
    }
    return { dom }
  },
})
const blockFormatting = Extension.create({
  name: 'blockFormatting',
  addGlobalAttributes: () => [{ types: ['paragraph', 'heading'], attributes: {
    paragraphStyle: { default: null, parseHTML: el => { const copy = el.cloneNode(); copy.style.removeProperty('text-align'); return copy.getAttribute('style') || null }, renderHTML: attrs => attrs.paragraphStyle ? { style: attrs.paragraphStyle } : {} },
  } }],
})
const defaultNodes = defaultMarkdownSerializer.nodes
function profileProjection(doc) {
  const blocks = [], positions = []
  doc.forEach((node, pos) => {
    let kind
    if (node.type.name === 'rawBlock') kind = node.attrs.hidden ? { kind: 'source' } : htmlBlockKind(node.attrs.html)
    else if (node.type.name === 'heading' && node.attrs.level <= 2) kind = { kind: node.attrs.level === 1 ? 'name' : 'section' }
    else if (node.type.name === 'resumeAvatar') kind = { kind: 'avatar', photoSize: photoDimensions(node.attrs.style) }
    else { let avatar = false, photoSize = {}; node.descendants(child => { if (!avatar && child.type.name === 'resumeAvatar') { avatar = true; photoSize = photoDimensions(child.attrs.style) } }); kind = { kind: 'content', avatar, photoSize } }
    blocks.push(kind); positions.push({ from: pos, to: pos + node.nodeSize })
  })
  return { ...projectProfile(blocks), positions }
}
function contactDecorations(doc, projection) {
  const decorations = []
  projection.blocks.forEach((attrs, index) => {
    if (attrs['data-profile-role'] !== 'info') return
    const pos = projection.positions[index].from, node = doc.nodeAt(pos)
    const paragraph = node.type.name === 'paragraph' ? node : node.firstChild?.type.name === 'paragraph' ? node.firstChild : null
    if (!paragraph) return
    const start = pos + (paragraph === node ? 0 : 1)
    decorations.push(Decoration.node(start, start + paragraph.nodeSize, { 'data-profile-contacts': 'true' }))
    paragraph.forEach((child, offset, index) => {
      const at = start + 1 + offset
      if (child.type.name === 'hardBreak') {
        decorations.push(Decoration.widget(at, view => {
          const spacer = view.dom.ownerDocument.createElement('span')
          spacer.className = 'resume-contact-separator'; spacer.setAttribute('aria-hidden', 'true')
          return spacer
        }, { side:-1, key:'contact-break-' + at, ignoreSelection:true }))
      }
      if (child.isText) {
        const next = paragraph.maybeChild(index + 1)
        const padding = next?.type.name === 'hardBreak' ? child.text.match(/[\u2003\s]+$/)?.[0] : null
        if (padding) decorations.push(Decoration.inline(at + child.text.length - padding.length, at + child.text.length, { class:'resume-contact-padding' }))
        for (const match of child.text.matchAll(/\u2003{2,}/g)) {
          if (padding && match.index >= child.text.length - padding.length) continue
          decorations.push(Decoration.inline(at + match.index, at + match.index + match[0].length, { class:'resume-contact-soft-break' }))
        }
      }
    })
  })
  return decorations
}
const layoutProjection = Extension.create({
  name: 'layoutProjection',
  addProseMirrorPlugins: () => [new Plugin({ props: {
    decorations(state) {
      const projection = profileProjection(state.doc)
      return DecorationSet.create(state.doc, [...projection.blocks.flatMap((attrs, i) => Object.keys(attrs).length ? [Decoration.node(projection.positions[i].from, projection.positions[i].to, attrs)] : []), ...contactDecorations(state.doc, projection)])
    },
  } })],
})
const hasHtml = node => {
  let found = !!node.attrs.htmlAttributes || !!node.attrs.style || !!node.attrs.paragraphStyle || !!node.attrs.textAlign
  node.descendants(child => { if (child.attrs.htmlAttributes || child.attrs.style || child.attrs.paragraphStyle || child.attrs.textAlign || child.marks.some(mark => mark.attrs.htmlAttributes || mark.attrs.extraStyle)) found = true })
  return found
}
const serializeHtml = (state, node) => {
  const el = DOMSerializer.fromSchema(node.type.schema).serializeNode(node, { document: document })
  el.querySelectorAll?.('[data-icon]').forEach(img => img.replaceWith(document.createTextNode('[[' + img.dataset.icon + ']]')))
  el.querySelectorAll?.('img').forEach(img => { if (img.getAttribute('src')?.startsWith('/assets/')) img.setAttribute('src', img.getAttribute('src').slice(1)) })
  if (el.nodeName === 'IMG' && el.getAttribute('src')?.startsWith('/assets/')) el.setAttribute('src', el.getAttribute('src').slice(1))
  state.write(el.outerHTML); if (!node.isInline) state.closeBlock(node)
}
const serializer = new MarkdownSerializer({
  text: defaultNodes.text,
  paragraph: (state, node) => hasHtml(node) ? serializeHtml(state, node) : defaultNodes.paragraph(state, node),
  heading: (state, node) => hasHtml(node) ? serializeHtml(state, node) : defaultNodes.heading(state, node),
  blockquote: (state, node) => hasHtml(node) ? serializeHtml(state, node) : defaultNodes.blockquote(state, node),
  bulletList: (state, node) => hasHtml(node) ? serializeHtml(state, node) : defaultNodes.bullet_list(state, node),
  orderedList: (state, node) => {
    if (hasHtml(node)) return serializeHtml(state, node)
    const start = node.attrs.start || 1, width = String(start + node.childCount - 1).length
    state.renderList(node, ' '.repeat(width + 2), index => String(start + index).padStart(width, ' ') + '. ')
  },
  listItem: defaultNodes.list_item, codeBlock: (state, node) => hasHtml(node) ? serializeHtml(state, node) : defaultNodes.code_block(state, node),
  horizontalRule: serializeHtml,
  hardBreak: defaultNodes.hard_break,
  resumeEntry: serializeHtml, resumeAvatar: serializeHtml, resumeImage: serializeHtml, resumeDivider: serializeHtml, resumeTable: serializeHtml,
  resumeIcon: (state, node) => state.write('[[' + node.attrs.code + ']]'),
  rawBlock: (state, node) => { state.write(node.attrs.raw); state.closeBlock(node) },
}, {
  bold: defaultMarkdownSerializer.marks.strong,
  italic: defaultMarkdownSerializer.marks.em,
  code: defaultMarkdownSerializer.marks.code,
  link: {
    open: (state, mark, parent, index) => {
      if (!mark.attrs.htmlAttributes) return defaultMarkdownSerializer.marks.link.open(state, mark, parent, index)
      const el = document.createElement('a'); for (const [key, value] of Object.entries(mark.attrs.htmlAttributes)) el.setAttribute(key, value); el.setAttribute('href', mark.attrs.href); return el.outerHTML.replace('</a>', '')
    },
    close: (state, mark, parent, index) => mark.attrs.htmlAttributes ? '</a>' : defaultMarkdownSerializer.marks.link.close(state, mark, parent, index),
  },
  underline: { open: '<u>', close: '</u>', mixable: true },
  strike: { open: '<s>', close: '</s>', mixable: true },
  textStyle: {
    open: (_state, mark) => {
      const el = document.createElement('span')
      for (const [key, value] of Object.entries(mark.attrs.htmlAttributes || {})) el.setAttribute(key, value)
      el.style.cssText = mark.attrs.extraStyle || ''
      for (const [key, value] of Object.entries(mark.attrs)) if (value != null && !['htmlAttributes', 'extraStyle'].includes(key)) el.style[key] = value
      return el.outerHTML.replace('</span>', '')
    }, close: '</span>', mixable: true,
  },
})

// sourceId 和原始片段只在内存中使用；未改动的块逐字保存，CSS/注释不经过富文本转换。
export class VisualEditor {
  constructor({ element, markdown, onChange, onSelection, onLayout, onEditRaw, iconMetrics = {} }) {
    this.original = markdown
    this.records = new Map()
    this.serial = 0
    this.loading = true
    this.onChange = onChange
    this.onLayout = onLayout
    this.keepPasteFormatting = true
    this.alignmentGuidesEnabled = true
    this.iconMetrics = iconMetrics
    this.editor = new Editor({
      element,
      extensions: [StarterKit.configure({ trailingNode: false, link: { openOnClick: false } }), TextStyleKit.configure({ textStyle: false }), StyledText, TextAlign.configure({ types: ['heading', 'paragraph'] }), sourceAttributes, blockFormatting, layoutProjection, Entry, Icon, Avatar, Image, Divider, Table, Row, Cell, Header, Raw],
      onEditRaw,
      content: '<p></p>',
      editorProps: {
        attributes: state => ({ class: 'resume-editor', 'aria-label': '简历图形化编辑器', spellcheck: 'false', ...profileProjection(state.doc).container }),
        transformPastedHTML: html => pastedHtml(this.editor.view.dom.ownerDocument, html),
        handlePaste: (view, event) => {
          if (this.keepPasteFormatting) return false
          const text = event.clipboardData?.getData('text/plain')
          if (!text) return false
          const container = view.dom.ownerDocument.createElement('div')
          for (const line of text.replace(/\r\n?/g, '\n').split('\n')) { const p = view.dom.ownerDocument.createElement('p'); p.textContent = line; container.append(p) }
          const parsed = PMParser.fromSchema(view.state.schema).parse(container, { preserveWhitespace: true })
          view.dispatch(view.state.tr.replaceSelection(new Slice(parsed.content, 0, 0)).scrollIntoView())
          return true
        },
      },
      onUpdate: () => { if (!this.loading) { this.onChange?.(this.getMarkdown()); this.onLayout?.() } },
      onSelectionUpdate: () => onSelection?.(this),
      onTransaction: () => onSelection?.(this),
    })
    this.editor.chain().setContent(this.parse(markdown), { emitUpdate: false }).setMeta('addToHistory', false).run()
    this.loading = false
    this.mounted = true
    onSelection?.(this)
  }
  parse(markdown) {
    const doc = this.editor.view.dom.ownerDocument
    const nodes = []
    // Marked 会规范化换行；映射回原始字节位置，兼容 CRLF 与混合换行。
    let normalized = '', cursor = 0
    const offsets = [0]
    for (let i = 0; i < markdown.length; i++) {
      if (markdown[i] === '\r') { normalized += '\n'; if (markdown[i + 1] === '\n') i++ } else normalized += markdown[i]
      offsets.push(i + 1)
    }
    const tokens = marked.lexer(normalized)
    const preserve = raw => {
      const id = 's' + ++this.serial
      const node = this.editor.schema.nodes.rawBlock.create({ raw, hidden: true, sourceId: id })
      this.records.set(id, { raw, json: JSON.stringify(node.toJSON()) }); nodes.push(node.toJSON())
    }
    for (const token of tokens) {
      const start = normalized.indexOf(token.raw, cursor)
      if (start < 0) throw new Error('该源码包含尚未支持的结构，请使用 Markdown 源码模式编辑；原文件未修改')
      if (start > cursor) preserve(markdown.slice(offsets[cursor], offsets[start]))
      const raw = markdown.slice(offsets[start], offsets[start + token.raw.length])
      cursor = start + token.raw.length
      const id = 's' + ++this.serial
      let node
      const hidden = token.type === 'space' || /^\s*(<!--|<style\b)/i.test(token.raw)
      if (hidden) node = this.editor.schema.nodes.rawBlock.create({ raw, hidden: true, sourceId: id })
      else {
        const blockTokens = [token]; blockTokens.links = tokens.links
        const html = marked.parser(blockTokens).replace(/\[\[(e[0-9a-f]{3})\]\]/gi, (_m, code) => `<img class="ic" data-icon="${code.toLowerCase()}" src="/assets/icons/${code.toLowerCase()}.png" style="height:${this.iconRatio(code)}em">`).replace(/(src|href)="assets\//g, '$1="/assets/')
        const container = safeHtml(doc, html)
        // 无法建模的表格/自定义容器不拆散，原样保存并显示。
        const unsupported = container.querySelector('section,aside,article,header,footer,nav,figure,figcaption,details,summary,dl,dt,dd,colgroup,col,caption,ruby,rt,rp,sup,sub,small,mark,time,abbr,svg,video,audio') || [...container.querySelectorAll('div')].some(el => !el.classList.contains('entry-title') && !el.classList.contains('resume-divider'))
        const parsed = PMParser.fromSchema(this.editor.schema).parse(container, { preserveWhitespace: true })
        if (unsupported || parsed.childCount !== 1 || (token.raw.trim() && !parsed.textContent && !container.querySelector('img,hr,.resume-divider,table'))) node = this.editor.schema.nodes.rawBlock.create({ raw, html, hidden: false, sourceId: id })
        else node = parsed.firstChild.type.create({ ...parsed.firstChild.attrs, sourceId: id }, parsed.firstChild.content, parsed.firstChild.marks)
      }
      this.records.set(id, { raw, json: JSON.stringify(node.toJSON()) })
      nodes.push(node.toJSON())
    }
    if (cursor < normalized.length) preserve(markdown.slice(offsets[cursor]))
    if (!nodes.length) nodes.push({ type: 'paragraph' })
    return { type: 'doc', content: nodes }
  }
  getMarkdown() {
    let output = ''
    const used = new Set()
    this.editor.state.doc.forEach(node => {
      const record = this.records.get(node.attrs.sourceId)
      if (record && !used.has(node.attrs.sourceId) && record.json === JSON.stringify(node.toJSON())) output += record.raw
      else {
        const text = node.type.name === 'rawBlock' ? node.attrs.raw : serializer.serialize(this.editor.schema.nodes.doc.create(null, node)).trimEnd() + '\n\n'
        if (output && !output.endsWith('\n') && text) output += '\n\n'
        output += text
      }
      used.add(node.attrs.sourceId)
    })
    return output
  }
  insertMarkdown(markdown) { this.editor.chain().focus().insertContent(this.parse(markdown).content).run() }
  iconRatio(code) { const metric = this.iconMetrics[code.toLowerCase()]; return metric ? Number((metric.h / metric.ref).toFixed(3)) : .9 }
  insertIcon(code) { this.editor.chain().focus().insertContent({ type: 'resumeIcon', attrs: { code, ratio: this.iconRatio(code) } }).run() }
  unmount() { this.cancelImageDrag?.(); this.imageHandles?.remove(); if (this.mounted) this.editor.unmount(); this.mounted = false }
  mount(element, markdown) {
    this.editor.mount(element); this.mounted = true
    if (this.getMarkdown() !== markdown) {
      const content = this.editor.schema.nodeFromJSON(this.parse(markdown)).content
      this.editor.view.dispatch(closeHistory(this.editor.state.tr).replaceWith(0, this.editor.state.doc.content.size, content))
    }
  }
  imageTarget(avatar = true) {
    const { selection } = this.editor.state
    if (selection instanceof NodeSelection && selection.node.type.name === (avatar ? 'resumeAvatar' : 'resumeImage')) return { node: selection.node, pos: selection.from }
    let found = null
    this.editor.state.doc.descendants((node, pos) => { if (!found && node.type.name === (avatar ? 'resumeAvatar' : 'resumeImage')) found = { node, pos } })
    return found
  }
  imageElement(avatar = true) { const target = this.imageTarget(avatar); return target ? this.editor.view.nodeDOM(target.pos) : null }
  updateImageHandles(lockRatio = true) {
    if (this.draggingImage) return
    this.imageHandles?.remove()
    const { selection } = this.editor.state
    if (!(selection instanceof NodeSelection) || !['resumeAvatar', 'resumeImage'].includes(selection.node.type.name)) return
    const avatar = selection.node.type.name === 'resumeAvatar', el = this.imageElement(avatar), doc = el.ownerDocument, win = doc.defaultView, rect = el.getBoundingClientRect(), css = win.getComputedStyle(el)
    const overlay = doc.createElement('div'); this.imageHandles = overlay
    overlay.className = 'image-edit-handles'
    overlay.style.cssText = `position:absolute;left:${rect.x + win.scrollX}px;top:${rect.y + win.scrollY}px;width:${rect.width}px;height:${rect.height}px;pointer-events:none;border:1px solid #8aa7c5;box-sizing:border-box;z-index:10001`
    for (const kind of ['move', 'resize']) {
      const handle = doc.createElement('button'); handle.type = 'button'; handle.dataset.handle = kind
      handle.title = kind === 'move' ? '拖动移动图片，Alt 暂时取消吸附，Esc 取消拖动' : '拖动缩放图片'; handle.setAttribute('aria-label', handle.title); handle.textContent = kind === 'move' ? '↕' : ''
      handle.style.cssText = `position:absolute;${kind === 'move' ? 'left:calc(50% - 8px);top:-19px;width:16px;height:16px;cursor:move' : 'right:-5px;bottom:-5px;width:9px;height:9px;cursor:nwse-resize'};padding:0;border:1px solid #8aa7c5;background:white;color:#6785a8;font:12px sans-serif;pointer-events:auto;border-radius:2px`
      handle.onpointerdown = event => {
        event.preventDefault(); event.stopPropagation(); handle.setPointerCapture(event.pointerId); this.draggingImage = true
        const x = event.clientX, y = event.clientY, initialWidth = parseFloat(css.width), initialHeight = parseFloat(css.height), ratio = initialHeight / initialWidth
        const guides = kind === 'move' ? createAlignmentGuides(el) : null
        this.alignmentGuides = guides
        let deltaX = 0, deltaY = 0
        let lastX = x, lastY = y, moved = false
        const preview = move => {
          lastX = move.clientX; lastY = move.clientY
          deltaX = move.clientX - x; deltaY = move.clientY - y
          moved ||= Math.abs(deltaX) + Math.abs(deltaY) >= .5
          if (kind === 'move') {
            if (moved) {
              const snap = guides.move({left:rect.left+deltaX,right:rect.right+deltaX,top:rect.top+deltaY,bottom:rect.bottom+deltaY}, {enabled:this.alignmentGuidesEnabled,bypass:move.altKey})
              deltaX += snap.dx; deltaY += snap.dy
            }
            overlay.style.left = rect.x + win.scrollX + deltaX + 'px'; overlay.style.top = rect.y + win.scrollY + deltaY + 'px'
          }
          else { overlay.style.width = Math.max(4, rect.width + deltaX) + 'px'; overlay.style.height = Math.max(4, lockRatio ? (initialWidth + deltaX) * ratio + rect.height - initialHeight : rect.height + deltaY) + 'px' }
        }
        const key = keyEvent => {
          if (keyEvent.key === 'Escape') { keyEvent.preventDefault(); keyEvent.stopPropagation(); finish(true) }
          else if (keyEvent.key === 'Alt') preview({clientX:lastX,clientY:lastY,altKey:keyEvent.type==='keydown'})
        }
        const finish = cancelled => {
          handle.onpointermove = handle.onpointerup = handle.onpointercancel = handle.onlostpointercapture = null
          doc.removeEventListener('keydown', key, true); doc.removeEventListener('keyup', key, true); win.removeEventListener('blur', cancel)
          if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
          guides?.destroy(); this.alignmentGuides = null; this.cancelImageDrag = null; this.draggingImage = false
          if (cancelled || !moved || Math.abs(deltaX) + Math.abs(deltaY) < .5) { this.updateImageHandles(lockRatio); return }
          const mm = pixels => Math.round(pixels * 25.4 / 96 * 100) / 100
          if (kind === 'move') this.setImageStyle({ left: mm((css.left !== 'auto' ? parseFloat(css.left) : -(parseFloat(css.right) || 0)) + deltaX), top: mm((parseFloat(css.top) || 0) + deltaY) }, avatar)
          else {
            const width = Math.max(1, Math.min(180, mm(initialWidth + deltaX))), height = Math.max(1, Math.min(250, lockRatio ? Math.round(width * ratio * 100) / 100 : mm(initialHeight + deltaY)))
            this.setImageStyle({ width, height }, avatar)
          }
        }
        const cancel = () => finish(true)
        this.cancelImageDrag = cancel
        handle.onpointermove = preview; handle.onpointerup = () => finish(false)
        handle.onpointercancel = handle.onlostpointercapture = cancel
        doc.addEventListener('keydown', key, true); doc.addEventListener('keyup', key, true); win.addEventListener('blur', cancel)
      }
      overlay.append(handle)
    }
    doc.body.append(overlay)
  }
  setImageStyle(input, avatar = true) {
    const target = this.imageTarget(avatar)
    if (!target) return
    const el = this.editor.view.dom.ownerDocument.createElement('img'); el.style.cssText = target.node.attrs.style || ''
    for (const [key, value] of Object.entries(input)) {
      if (['width', 'height', 'left', 'top'].includes(key)) el.style.setProperty(key, Number(value) + 'mm', 'important')
      else if (key === 'objectPosition') el.style.setProperty('object-position', value, 'important')
    }
    if (input.left != null) { el.style.setProperty('position', 'relative', 'important'); el.style.setProperty('right', 'auto', 'important') }
    this.editor.view.dispatch(closeHistory(this.editor.state.tr).setNodeMarkup(target.pos, undefined, { ...target.node.attrs, style: el.style.cssText }))
  }
  replaceImage(src, avatar = true) {
    const target = this.imageTarget(avatar)
    if (target) this.editor.view.dispatch(closeHistory(this.editor.state.tr).setNodeMarkup(target.pos, undefined, { ...target.node.attrs, src }))
    else if (avatar) {
      let pos = this.editor.state.doc.content.size
      this.editor.state.doc.forEach((node, at) => { if (pos === this.editor.state.doc.content.size && node.type.name === 'heading' && node.attrs.level === 2) pos = at })
      this.editor.view.dispatch(closeHistory(this.editor.state.tr).insert(pos, this.editor.schema.nodes.resumeAvatar.create({ src })))
    } else this.editor.chain().focus().insertContent({ type: 'resumeImage', attrs: { src } }).run()
  }
  removeImage(avatar = true) { const target = this.imageTarget(avatar); if (target) this.editor.view.dispatch(closeHistory(this.editor.state.tr).delete(target.pos, target.pos + target.node.nodeSize)) }
  ruleTargets(all = false) {
    const { selection } = this.editor.state
    if (!all && selection instanceof NodeSelection && selection.node.type.name === 'resumeDivider') return [{ node: selection.node, pos: selection.from }]
    const targets = []; let current = null
    this.editor.state.doc.descendants((node, pos) => { if (node.type.name === 'heading' && node.attrs.level === 2) { const target = { node, pos }; targets.push(target); if (pos <= selection.from) current = target } })
    return all ? targets : current ? [current] : targets.slice(0, 1)
  }
  setRule(input, all = false) {
    return withPrintPalette(this.editor.view.dom.ownerDocument, () => this.setPrintRule(input, all))
  }
  setPrintRule(input, all = false) {
    const units = { thickness: 'mm', width: '%', gap: 'mm', x: 'mm', y: 'mm', color: '', style: '' }
    const tr = closeHistory(this.editor.state.tr)
    for (const { node, pos } of this.ruleTargets(all)) {
      const el = this.editor.view.dom.ownerDocument.createElement('div'); el.style.cssText = node.attrs.paragraphStyle || node.attrs.style || ''
      const dom = this.editor.view.nodeDOM(pos), css = dom.ownerDocument.defaultView.getComputedStyle(dom)
      const pseudo = node.type.name === 'resumeDivider' || dom.hasAttribute('data-resume-rule') ? dom.ownerDocument.defaultView.getComputedStyle(dom, '::after') : null
      const defaults = { thickness: parseFloat(pseudo?.borderTopWidth || css.borderBottomWidth) * 25.4 / 96 || .25, gap: node.type.name === 'heading' ? parseFloat(css.paddingBottom) * 25.4 / 96 : 2, color: pseudo?.borderTopColor || css.borderBottomColor, style: (pseudo?.borderTopStyle || css.borderBottomStyle) === 'none' ? 'solid' : pseudo?.borderTopStyle || css.borderBottomStyle }
      for (const [key, value] of Object.entries(defaults)) if (!el.style.getPropertyValue('--resume-rule-' + key)) el.style.setProperty('--resume-rule-' + key, value + units[key])
      for (const [key, value] of Object.entries(input)) if (key in units) el.style.setProperty('--resume-rule-' + key, value + units[key])
      const attrs = { ...node.attrs, htmlAttributes: { ...node.attrs.htmlAttributes, 'data-resume-rule': 'true' } }
      attrs[node.type.name === 'heading' ? 'paragraphStyle' : 'style'] = el.style.cssText
      tr.setNodeMarkup(pos, undefined, attrs)
    }
    this.editor.view.dispatch(tr)
  }
  editRaw(sourceId, raw) {
    let target
    this.editor.state.doc.descendants((node, pos) => { if (node.type.name === 'rawBlock' && node.attrs.sourceId === sourceId) target = { node, pos } })
    raw = raw.trimEnd() + '\n\n' // HTML 块后保留空行，避免下一章节被 Markdown 当作 HTML 原文吞入。
    if (target) this.editor.view.dispatch(closeHistory(this.editor.state.tr).setNodeMarkup(target.pos, undefined, { ...target.node.attrs, raw, html: marked.parse(raw) }))
  }
  insertTable(rows, columns) {
    const cell = this.editor.schema.nodes.resumeCell, paragraph = this.editor.schema.nodes.paragraph
    this.editor.chain().focus().insertContent({ type: 'resumeTable', content: Array.from({ length: rows }, () => ({ type: 'resumeRow', content: Array.from({ length: columns }, () => cell.create(null, paragraph.create()).toJSON()) })) }).run()
  }
  tableTarget() { const { $from } = this.editor.state.selection; for (let depth = $from.depth; depth > 0; depth--) if ($from.node(depth).type.name === 'resumeTable') return { node: $from.node(depth), pos: $from.before(depth) }; return null }
  changeTable(action) {
    const target = this.tableTarget(); if (!target) return false
    const rows = target.node.content.content
    if (rows.some(row => row.content.content.some(cell => Number(cell.attrs.htmlAttributes?.colspan || 1) > 1 || Number(cell.attrs.htmlAttributes?.rowspan || 1) > 1))) return false
    const content = rows.map(row => row.toJSON()), makeCell = () => ({ type: 'resumeCell', content: [{ type: 'paragraph' }] })
    if (action === 'row-add') content.push({ type: 'resumeRow', content: Array.from({ length: content[0].content.length }, makeCell) })
    if (action === 'column-add') content.forEach(row => row.content.push(makeCell()))
    if (action === 'row-remove' && content.length > 1) content.pop()
    if (action === 'column-remove' && content[0].content.length > 1) content.forEach(row => row.content.pop())
    const node = this.editor.schema.nodeFromJSON({ ...target.node.toJSON(), content })
    const tr = closeHistory(this.editor.state.tr).replaceWith(target.pos, target.pos + target.node.nodeSize, node)
    tr.setSelection(TextSelection.near(tr.doc.resolve(target.pos + 4)))
    this.editor.view.dispatch(tr); return true
  }
  syncLayout(markdown) {
    const block = markdown.match(/<style\b[^>]*\bdata-webui-layout[^>]*>[\s\S]*?<\/style>\s*/i)?.[0]
    let found = null, afterStyle = 0
    this.editor.state.doc.forEach((node, pos) => {
      if (node.type.name !== 'rawBlock') return
      if (/^\s*<style\b/i.test(node.attrs.raw)) afterStyle = pos + node.nodeSize
      if (/^\s*<style\b[^>]*\bdata-webui-layout/i.test(node.attrs.raw)) found = { node, pos }
    })
    const tr = closeHistory(this.editor.state.tr)
    if (found) {
      if (block) tr.setNodeMarkup(found.pos, undefined, { ...found.node.attrs, raw: block })
      else tr.delete(found.pos, found.pos + found.node.nodeSize)
    } else if (block) {
      const id = 's' + ++this.serial
      const node = this.editor.schema.nodes.rawBlock.create({ raw: '\n\n' + block, hidden: true, sourceId: id })
      this.records.set(id, { raw: node.attrs.raw, json: JSON.stringify(node.toJSON()) })
      tr.insert(afterStyle, node)
    }
    this.editor.view.dispatch(tr)
  }
  setParagraph(input) {
    const map = { lineHeight: 'line-height', before: 'margin-top', after: 'margin-bottom', indent: 'padding-left' }
    this.editor.chain().focus().command(({ state, tr }) => {
      const { from, to } = state.selection
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!['paragraph', 'heading'].includes(node.type.name)) return
        const el = this.editor.view.dom.ownerDocument.createElement('div')
        el.style.cssText = node.attrs.paragraphStyle || ''
        for (const [key, value] of Object.entries(input)) if (map[key] && Number.isFinite(Number(value))) el.style.setProperty(map[key], key === 'lineHeight' ? String(Number(value)) : Number(value) + 'mm', 'important')
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, paragraphStyle: el.style.cssText })
      })
      return true
    }).run()
  }
  groups(kind = 'section') {
    const all = []
    let position = 0, parent = -1
    this.editor.state.doc.forEach(node => {
      const section = node.type.name === 'heading' && node.attrs.level === 2
      if (section) parent++
      all.push({ node, position, parent, section })
      position += node.nodeSize
    })
    const groups = []
    all.forEach((item, index) => {
      if (kind === 'section' ? !item.section : item.node.type.name !== 'resumeEntry') return
      let next = index + 1
      while (next < all.length && !(kind === 'section' ? all[next].section : all[next].section || all[next].node.type.name === 'resumeEntry')) next++
      groups.push({ from: item.position, to: next < all.length ? all[next].position : position, title: item.node.type.name === 'resumeEntry' ? item.node.firstChild.textContent.trim() : item.node.textContent.trim(), parent: item.parent })
    })
    return groups
  }
  moveGroup(kind, index, direction) {
    const groups = this.groups(kind), current = groups[index], target = groups[index + direction]
    if (!current || !target || (kind === 'entry' && current.parent !== target.parent)) return false
    const content = this.editor.state.doc.slice(current.from, current.to).content
    const destination = direction < 0 ? target.from : target.to - (current.to - current.from)
    const tr = closeHistory(this.editor.state.tr).delete(current.from, current.to).insert(destination, content)
    tr.setSelection(TextSelection.near(tr.doc.resolve(destination + 1))).scrollIntoView()
    this.editor.view.dispatch(tr); this.editor.view.focus(); return true
  }
  moveEntryTo(index, sectionIndex) {
    const current = this.groups('entry')[index], target = this.groups('section')[sectionIndex]
    if (!current || !target || current.parent === sectionIndex) return false
    const content = this.editor.state.doc.slice(current.from, current.to).content
    const tr = closeHistory(this.editor.state.tr).delete(current.from, current.to)
    const destination = tr.mapping.map(target.to, -1)
    tr.insert(destination, content).setSelection(TextSelection.near(tr.doc.resolve(destination + 1))).scrollIntoView()
    this.editor.view.dispatch(tr); this.editor.view.focus(); return true
  }
  deleteGroup(kind, index) {
    const current = this.groups(kind)[index]
    if (!current) return
    const protectedStyles = []
    this.editor.state.doc.nodesBetween(current.from, current.to, node => { if (node.type.name === 'rawBlock' && /^\s*<style\b/i.test(node.attrs.raw)) protectedStyles.push(node) })
    const tr = closeHistory(this.editor.state.tr).delete(current.from, current.to)
    for (const node of protectedStyles.reverse()) tr.insert(current.from, node)
    this.editor.view.dispatch(tr)
  }
  selectGroup(kind, index) { const group = this.groups(kind)[index]; if (group) this.editor.commands.setTextSelection(group.from + 1); this.editor.commands.focus() }
  command(name, value) {
    const chain = this.editor.chain().focus()
    const commands = {
      bold: () => chain.toggleBold(), italic: () => chain.toggleItalic(), underline: () => chain.toggleUnderline(), strike: () => chain.toggleStrike(),
      undo: () => chain.undo(), redo: () => chain.redo(), bullet: () => chain.toggleBulletList(), ordered: () => chain.toggleOrderedList(),
      fontFamily: () => value ? chain.setFontFamily(value) : chain.unsetFontFamily(), fontSize: () => value ? chain.setFontSize(value + 'pt') : chain.unsetFontSize(), color: () => chain.setColor(value),
      align: () => chain.setTextAlign(value), heading: () => value === 'paragraph' ? chain.setParagraph() : chain.setHeading({ level: Number(value) }),
      clear: () => chain.unsetAllMarks(),
    }
    if (commands[name]) commands[name]().run()
  }
  get selection() { const { from, to } = this.editor.state.selection; return this.editor.state.doc.textBetween(from, to, ' ') }
  destroy() { this.cancelImageDrag?.(); this.alignmentGuides?.destroy(); this.imageHandles?.remove(); this.editor.destroy() }
}
