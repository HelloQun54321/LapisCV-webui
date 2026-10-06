import { icon } from './icons.js'

const storageKey = 'resume-studio-appearance'
const defaults = { theme: 'light', font: 'system', size: '14' }
const readingCss = `@media screen {
  html[data-ui-theme=dark] { color-scheme:dark; background:#101214!important }
  html[data-ui-theme=dark] body, html[data-ui-theme=dark] .page { background:#101214!important; color:#e7e9ea!important }
  html[data-ui-theme=dark] .page :where(p,li,span,div,section,blockquote,td,th,strong,em,b,i,u,code,pre) { color:#d7dce0!important; background-color:transparent!important; border-color:#48515a!important; caret-color:#e7e9ea!important }
  html[data-ui-theme=dark] .page :where(h1,h2,h3,h4,h5,h6) { color:#f2f4f5!important; background-color:transparent!important; border-color:#48515a!important }
  html[data-ui-theme=dark] .page :where(a,a span) { color:#6ab8f7!important }
  html[data-ui-theme=dark] .page :where(hr,table,img.avatar) { border-color:#48515a!important }
  html[data-ui-theme=dark] .page :where(h2,[data-resume-rule],.resume-divider)::after { border-color:#48515a!important }
  html[data-ui-theme=dark] .page hr::after { color:#a0a8b1!important; background:#101214!important }
  html[data-ui-theme=dark] .page img.ic { filter:brightness(1.8) saturate(.65) }
  html[data-ui-theme=dark] .page ::selection { background:#1d9bf04d!important; color:#fff!important }
}`

// Only the iframe head receives a screen stylesheet; model/Markdown/print CSS stay independent.
export function applyPaperAppearance(doc, theme) {
  if (!doc?.head) return
  doc.documentElement.dataset.uiTheme = theme
  let style = doc.getElementById('webui-reading-theme')
  if (!style) {
    style = doc.createElement('style')
    style.id = 'webui-reading-theme'
    style.textContent = readingCss
  }
  doc.head.append(style)
}

// Inspect original document colors even while screen reading colors are active.
export function withPrintPalette(doc, callback) {
  const sheet = doc?.getElementById('webui-reading-theme')?.sheet
  const disabled = sheet?.disabled
  if (sheet) sheet.disabled = true
  try { return callback() } finally { if (sheet) sheet.disabled = disabled }
}

export function createAppearance({ modal, closeModal, onChange }) {
  let saved
  try { saved = JSON.parse(localStorage.getItem(storageKey)) } catch {}
  const prefs = { ...defaults }
  if (['light', 'dark'].includes(saved?.theme)) prefs.theme = saved.theme
  if (['system', 'sourceHan'].includes(saved?.font)) prefs.font = saved.font
  if (['14', '15', '16'].includes(String(saved?.size))) prefs.size = String(saved.size)
  const toggle = document.getElementById('theme-toggle')
  function apply() {
    const root = document.documentElement
    root.dataset.uiTheme = prefs.theme
    root.dataset.uiFont = prefs.font
    root.style.setProperty('--ui-size', prefs.size + 'px')
    const dark = prefs.theme === 'dark'
    toggle.innerHTML = icon(dark ? 'sun' : 'moon')
    toggle.setAttribute('aria-pressed', String(dark))
    toggle.setAttribute('aria-label', dark ? '切换日间模式' : '切换夜间模式')
    toggle.title = toggle.getAttribute('aria-label')
    onChange(prefs.theme)
  }
  function update(changes) {
    Object.assign(prefs, changes)
    localStorage.setItem(storageKey, JSON.stringify(prefs))
    apply()
  }
  toggle.onclick = () => update({ theme: prefs.theme === 'dark' ? 'light' : 'dark' })
  document.getElementById('appearance-button').onclick = () => {
    modal('外观与字体', `<div class="appearance-settings modal-form">
      <label>界面主题<select id="appearance-theme"><option value="light">日间 · Codex 浅色</option><option value="dark">夜间 · X 深色</option></select></label>
      <label>工作台字体<select id="appearance-font"><option value="system">系统字体 · 微软雅黑 / Segoe UI</option><option value="sourceHan">思源黑体</option></select></label>
      <label>界面字号<select id="appearance-size"><option value="14">标准 · 14 px</option><option value="15">舒适 · 15 px</option><option value="16">大字 · 16 px</option></select></label>
      <p class="modal-note">外观设置自动记住。简历字体与字号在「排版」中调整；夜间纸面使用屏幕阅读配色，PDF 保留原始打印颜色。</p>
      <div class="modal-actions"><button id="appearance-done" class="primary-button">完成</button></div></div>`)
    for (const key of ['theme', 'font', 'size']) {
      const control = document.getElementById('appearance-' + key)
      control.value = prefs[key]
      control.onchange = () => update({ [key]: control.value })
    }
    document.getElementById('appearance-done').onclick = closeModal
  }
  apply()
  return { get theme() { return prefs.theme } }
}
