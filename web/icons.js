// Lucide 1.52.0 的本地 SVG 子集；许可见 lucide-LICENSE.txt。
const names = new Set(["sun","moon","settings-2","sliders-horizontal","trash-2","circle-help","hard-drive","menu","ellipsis","history","download","upload","plus","minus","x","search","maximize","minimize","undo-2","redo-2","heading-2","list","list-ordered","link","shapes","user-round","image","file-text","align-left","align-center","align-right","remove-formatting","arrow-left","arrow-right","arrow-up","arrow-down","chevron-left","chevron-right","folder-input","copy","refresh-cw","file-check-2","files","bookmark","file-archive","diff","panel-right-open","separator-horizontal","table","briefcase-business","bold","italic","underline"])
export function icon(name) {
  if (!names.has(name)) throw new Error('未知界面图标：' + name)
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="/ui-icons.svg#${name}"></use></svg>`
}
export function decorateIcons(root = document) {
  root.querySelectorAll('[data-ui-icon]').forEach(element => { element.innerHTML = icon(element.dataset.uiIcon) })
  root.querySelectorAll('button[aria-label]:not([title])').forEach(button => { button.title = button.getAttribute('aria-label') })
}
