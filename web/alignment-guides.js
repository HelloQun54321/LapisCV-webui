// Editing-only geometry: never inserted into the ProseMirror document or exported HTML.
function nearest(anchors, references, tolerance) {
  let best = null
  for (const reference of references) for (const anchor of anchors) {
    if (reference.kind !== anchor.kind) continue
    const delta = reference.at - anchor.at, distance = Math.abs(delta)
    if (distance > tolerance) continue
    if (!best || distance < best.distance - .1 || (Math.abs(distance - best.distance) < .1 && reference.priority < best.reference.priority)) best = { delta, distance, reference }
  }
  return best
}

function referencesFor(element) {
  const doc = element.ownerDocument, win = doc.defaultView, paper = element.closest('.page')
  if (!paper) return { x:[], y:[], paper:null }
  const bounds = paper.getBoundingClientRect(), css = win.getComputedStyle(paper), x = [], y = []
  const add = (list, at, kind, label, start, end, priority = 1) => list.push({ at, kind, label, start, end, priority })
  add(x, (bounds.left + bounds.right) / 2, 'center', '纸面中线', bounds.top, bounds.bottom, 0)
  add(x, bounds.left + parseFloat(css.paddingLeft), 'edge', '正文左边缘', bounds.top, bounds.bottom, 0)
  add(x, bounds.right - parseFloat(css.paddingRight), 'edge', '正文右边缘', bounds.top, bounds.bottom, 0)
  add(y, bounds.top + parseFloat(css.paddingTop), 'edge', '正文上边缘', bounds.left, bounds.right, 0)
  add(y, bounds.bottom - parseFloat(css.paddingBottom), 'edge', '正文下边缘', bounds.left, bounds.right, 0)
  add(y, (bounds.top + bounds.bottom) / 2, 'center', '纸面水平中线', bounds.left, bounds.right, 0)
  for (const node of [...paper.querySelectorAll('h1,h2,h3,p,img:not(.ic),table')].slice(0, 200)) {
    if (node === element || node.contains(element) || !node.getClientRects().length) continue
    const rect = node.getBoundingClientRect()
    if (rect.width < 4 || rect.height < 4) continue
    const label = node.tagName === 'H1' ? '姓名' : node.tagName === 'H2' ? '章节标题' : node.tagName === 'H3' ? '经历标题' : node.tagName === 'IMG' ? '图片' : '正文'
    // Text ranges give actual horizontal text edges, rather than full-width paragraph boxes.
    let horizontal = rect
    if (node.textContent.trim() && node.tagName !== 'TABLE') {
      const range = doc.createRange(); range.selectNodeContents(node)
      const textRect = range.getBoundingClientRect()
      if (textRect.width > 0) horizontal = textRect
    }
    add(x, horizontal.left, 'edge', label + '左边缘', rect.top, rect.bottom)
    add(x, horizontal.right, 'edge', label + '右边缘', rect.top, rect.bottom)
    add(x, (horizontal.left + horizontal.right) / 2, 'center', label + '中线', rect.top, rect.bottom)
    add(y, rect.top, 'edge', label + '顶端', rect.left, rect.right)
    add(y, rect.bottom, 'edge', label + '底端', rect.left, rect.right)
    add(y, (rect.top + rect.bottom) / 2, 'center', label + '水平中线', rect.left, rect.right)
  }
  return { x, y, paper:bounds }
}

export function createAlignmentGuides(element) {
  const doc = element.ownerDocument, win = doc.defaultView, references = referencesFor(element)
  const frame = win.frameElement, scale = frame ? frame.getBoundingClientRect().width / frame.offsetWidth : 1
  const tolerance = 5 / (scale || 1)
  const overlay = doc.createElement('div')
  overlay.className = 'alignment-guides'; overlay.setAttribute('aria-hidden', 'true')
  overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:10002'
  doc.body.append(overlay)
  function line(axis, match, rect, snapped) {
    if (!match) return
    const { at, start, end, label } = match.reference, vertical = axis === 'x'
    const low = Math.max(vertical ? references.paper.top : references.paper.left, Math.min(start, vertical ? rect.top : rect.left) - 12)
    const high = Math.min(vertical ? references.paper.bottom : references.paper.right, Math.max(end, vertical ? rect.bottom : rect.right) + 12)
    const guide = doc.createElement('div'); guide.className = 'alignment-guide'; guide.dataset.axis = axis; guide.dataset.snapped = String(snapped)
    const color = win.document.documentElement.dataset.uiTheme === 'dark' ? '#62aaf5' : '#247aca'
    guide.style.cssText = `position:absolute;${vertical ? `left:${at + win.scrollX}px;top:${low + win.scrollY}px;height:${high - low}px;border-left:1px dashed ${color}` : `top:${at + win.scrollY}px;left:${low + win.scrollX}px;width:${high - low}px;border-top:1px dashed ${color}`};pointer-events:none`
    const tag = doc.createElement('span'); tag.className = 'alignment-guide-label'; tag.textContent = label + (snapped ? '' : ' · 未吸附')
    const tagX = Math.max(0, Math.min((vertical ? at + 5 : rect.left + 5), (references.paper?.right || win.innerWidth) - 130))
    const tagY = Math.max(2, (vertical ? rect.top - 22 : at + 4))
    tag.style.cssText = `position:absolute;left:${tagX + win.scrollX}px;top:${tagY + win.scrollY}px;background:${color};color:white;padding:2px 5px;border-radius:3px;font:11px/1.4 sans-serif;white-space:nowrap;pointer-events:none`
    overlay.append(guide, tag)
  }
  return {
    move(rect, { enabled = true, bypass = false } = {}) {
      overlay.replaceChildren()
      if (!enabled || !references.paper) return { dx:0, dy:0 }
      const x = nearest([{at:rect.left,kind:'edge'},{at:rect.right,kind:'edge'},{at:(rect.left+rect.right)/2,kind:'center'}], references.x, tolerance)
      const y = nearest([{at:rect.top,kind:'edge'},{at:rect.bottom,kind:'edge'},{at:(rect.top+rect.bottom)/2,kind:'center'}], references.y, tolerance)
      const dx = bypass ? 0 : x?.delta || 0, dy = bypass ? 0 : y?.delta || 0
      const aligned = { left:rect.left+dx, right:rect.right+dx, top:rect.top+dy, bottom:rect.bottom+dy }
      line('x', x, aligned, !bypass); line('y', y, aligned, !bypass)
      return { dx, dy }
    },
    destroy() { overlay.remove() },
  }
}
