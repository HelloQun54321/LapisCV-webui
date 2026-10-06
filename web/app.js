import { VisualEditor } from './visual-editor.bundle.js'
import { writeLayout, removeLayout, layoutFields, readLayoutSettings } from './layout.js'
import { createWorkflow, filterDocuments } from './workflow.js'
import { icon, decorateIcons } from './icons.js'
import { createAppearance, applyPaperAppearance, withPrintPalette } from './appearance.js'
import { resumeLayouts } from './resume-layout.js'
const $ = id => document.getElementById(id)
const state = { doc: null, documents: [], token: '', tab: 'resume', baseline: '', sequence: 0, saving: null, saveTimer: null, renderTimer: null, renderRequest: 0, renderAbort: null, zoom: null, paperHeight: 1123, conflict: false, switching: false, exporting: false }
let storageRoot = ''
let toastTimer
let visualEditor = null
let styleTicket = 0
let proofReader = null
let proofTicket = 0
let proofResult = null
let editingScroll = 0
let replaceOrdinaryImage = false
const styleSignature = () => state.doc.theme + [...state.doc.markdown.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi)].map(match => match[0]).join('')
state.mode = localStorage.getItem('resume-studio-editor-mode') === 'source' ? 'source' : 'visual'
const isVisual = () => state.tab === 'resume' && state.mode === 'visual'
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const urlFor = id => '/api/documents/' + encodeURIComponent(id)
const content = doc => ({ markdown: doc.markdown, jd: doc.jd, theme: doc.theme, meta: { ...doc.meta } })
const fingerprint = doc => JSON.stringify(content(doc))
const dirty = () => state.doc && fingerprint(state.doc) !== state.baseline
const storageKey = id => `resume-studio:${storageRoot}:${id}`
const formatTime = value => new Date(value).toLocaleString('zh-CN', { hour12: false })
const workflow = createWorkflow({ state, api, save, modal, closeModal, toast, escape, refreshList, loadDocument, switchTab, changed, triggerDownload, clearDraft, resizePaper, dirty, handleConflict })
decorateIcons()
let proofPrintColors = false
const appearance = createAppearance({ modal, closeModal, onChange: theme => {
  applyPaperAppearance($('preview').contentDocument, theme)
  $('proof-print-colors').hidden = theme !== 'dark'
  proofReader?.setReadingTheme(proofPrintColors ? 'light' : theme)
  requestAnimationFrame(() => { resizePaper(); if (state.doc) updateEditorMeta() })
} })

async function api(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', 'X-Local-Token': state.token, ...options.headers } })
  if (!res.ok) {
    let data
    try { data = await res.json() } catch { data = { error: '服务暂时无法响应' } }
    const error = new Error(data.error || '操作失败')
    error.status = res.status; error.current = data.current
    throw error
  }
  return options.binary ? res : res.json()
}
function toast(message, error = false) {
  $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true }, error ? 7000 : 3500)
}
function notice(message, error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); $('notice').hidden = !message }
function saveLabel(message, type = '') {
  $('save-state').textContent = message; $('save-state').className = 'save-state ' + type
  $('save-button').classList.toggle('pending', type === 'pending'); $('save-button').classList.toggle('error', type === 'error')
  $('save-button').setAttribute('aria-label', `保存当前编辑（${message}）`)
}
function writeDraft() {
  if (!state.doc) return
  try { localStorage.setItem(storageKey(state.doc.id), JSON.stringify({ ...content(state.doc), revision: state.doc.revision, timestamp: Date.now() })) }
  catch { notice('浏览器草稿空间不足，请及时保存到本地文件。', true) }
}
function clearDraft(id) { try { localStorage.removeItem(storageKey(id)) } catch {} }
function readDraft(id) { try { return JSON.parse(localStorage.getItem(storageKey(id))) } catch { return null } }
function changed({ preview = true } = {}) {
  state.sequence++
  writeDraft()
  saveLabel(dirty() ? '尚未保存' : '已保存', dirty() ? 'pending' : '')
  if (preview) scheduleRender()
  scheduleSave()
  workflow.proofStatus()
}
function scheduleSave() {
  clearTimeout(state.saveTimer)
  if ($('autosave').checked && dirty() && !state.conflict) state.saveTimer = setTimeout(() => save().catch(() => {}), 1000)
}
async function save({ announce = false } = {}) {
  clearTimeout(state.saveTimer)
  if (!state.doc) return null
  if (state.conflict) throw new Error('请先处理版本冲突')
  if (state.saving) { await state.saving; if (dirty()) return save({ announce }); return state.doc }
  if (!dirty()) { if (announce) toast('当前内容已保存'); return state.doc }
  const snapshot = { ...content(state.doc), revision: state.doc.revision }
  const id = state.doc.id
  saveLabel('正在保存…', 'pending')
  state.saving = api(urlFor(id), { method: 'PUT', body: JSON.stringify(snapshot) }).then(saved => {
    if (state.doc?.id === id) {
      state.doc.revision = saved.revision
      state.doc.modified = saved.modified
      state.doc.archived = saved.archived
      state.baseline = fingerprint(saved)
      if (!dirty()) { clearDraft(id); saveLabel('已保存'); $('draft-banner').hidden = true }
      else { writeDraft(); saveLabel('尚未保存', 'pending'); scheduleSave() }
      const summary = state.documents.find(d => d.id === id)
      if (summary) Object.assign(summary, { meta: saved.meta, theme: saved.theme, modified: saved.modified, hasJd: !!saved.jd.trim(), archived: saved.archived })
      renderList(); renderHeader()
    }
    if (announce) toast('已保存到本地文件')
    return saved
  }).catch(error => {
    saveLabel('保存失败', 'error')
    if (error.status === 409) handleConflict(error)
    else { notice('保存失败：' + error.message + '。草稿仍保留在浏览器，可重试保存。', true); toast(error.message, true) }
    throw error
  }).finally(() => { state.saving = null })
  return state.saving
}
function handleConflict(error) {
  if (state.conflict && $('modal').open) return
  state.conflict = true
  clearTimeout(state.saveTimer)
  writeDraft()
  notice('文件已被另一窗口或外部编辑器更新。当前草稿已保留，请处理版本冲突。', true)
  modal('发现新的文件版本', `<p class="modal-note">文件已在别处修改。覆盖前会保留旧版。</p><div class="modal-actions"><button id="conflict-download" class="secondary-button">下载草稿</button><button id="conflict-reload" class="secondary-button">加载最新</button><button id="conflict-overwrite" class="primary-button">用草稿覆盖</button></div>`)
  $('conflict-download').onclick = () => downloadDraft()
  $('conflict-reload').onclick = async () => { closeModal(); state.conflict = false; await loadDocument(state.doc.id, { discard: true }); notice('已加载最新文件，之前的草稿仍可通过提示恢复。') }
  $('conflict-overwrite').onclick = async () => {
    try {
      const latest = await api(urlFor(state.doc.id))
      state.doc.revision = latest.revision
      state.conflict = false
      await save({ announce: true })
      closeModal(); notice('')
    } catch (e) { state.conflict = true; toast(e.message, true) }
  }
}
function renderList() {
  const archivedOnly = $('archive-filter').value === 'archived'
  $('follow-filter').disabled = archivedOnly
  if (archivedOnly && $('follow-filter').value) { $('follow-filter').value = ''; localStorage.setItem('resume-studio-follow-filter', '') }
  const result = filterDocuments(state.documents, { search: $('search').value, status: $('status-filter').value, follow: $('follow-filter').value, group: $('group-by').value, archive: $('archive-filter').value })
  const filtered = result.filtered
  for (const [id, active] of [['rail-documents', !archivedOnly], ['rail-archive', archivedOnly]]) {
    $(id).classList.toggle('active', active); $(id).setAttribute('aria-pressed', String(active))
  }
  $('list-caption').textContent = archivedOnly ? '已归档投递' : '我的简历'
  const selectedFilters = ['status-filter', 'follow-filter', 'group-by'].filter(id => $(id).value).map(id => $(id).selectedOptions[0].textContent)
  if ($('archive-filter').value === 'all') selectedFilters.unshift('全部记录')
  $('list-filter-summary').hidden = selectedFilters.length === 0
  $('list-filter-summary').textContent = selectedFilters.join(' · ')
  const opened = new Map([...$('document-list').querySelectorAll('details')].map(el => [el.dataset.group, el.open]))
  $('document-count').textContent = String(state.documents.length).padStart(2, '0')
  $('follow-summary').textContent = result.due ? `${result.due} 份待跟进` : '暂无到期跟进'
  $('document-list').innerHTML = [...result.groups].map(([group, docs]) => `<details class="document-group" data-group="${escape(group)}" ${opened.get(group) === false ? '' : 'open'}><summary>${escape(group)}<small>${docs.length}</small></summary>${docs.map(d => `<div class="document-card ${state.doc?.id === d.id ? 'active' : ''}"><button class="document-item ${state.doc?.id === d.id ? 'active' : ''}" data-document="${escape(d.id)}" title="${escape(d.master ? '母版：完整经历' : `${d.meta.company} · ${d.meta.title} · ${d.meta.status}${d.archived ? ' · 已归档' : ''}${d.meta.followUp ? ' · 跟进 ' + d.meta.followUp : ''}`)}" ${state.doc?.id === d.id ? 'aria-current="page"' : ''}><span class="doc-symbol" aria-hidden="true">${icon(d.archived ? 'file-archive' : 'file-text')}</span><span class="doc-item-copy"><strong>${escape(d.master ? '母版简历' : d.meta.company || d.id)}</strong><small>${escape(d.master ? '完整经历' : `${d.meta.title || '投递版本'} · ${d.meta.status}${d.archived ? ' · 已归档' : ''}`)}</small>${d.meta.followUp && !d.archived ? `<small class="follow-date ${result.isDue(d) ? 'due' : ''}">${result.isDue(d) ? '待跟进 ' : '跟进 '}${escape(d.meta.followUp)}</small>` : ''}</span></button>${!d.master ? `<button class="document-menu icon-button" data-manage="${escape(d.id)}" aria-label="管理${escape(d.meta.company || d.id)}投递" title="管理投递">${icon('ellipsis')}</button>` : ''}</div>`).join('')}</details>`).join('')
  $('list-empty').hidden = filtered.length !== 0
  $('document-list').querySelectorAll('[data-document]').forEach(button => { button.onclick = () => loadDocument(button.dataset.document).catch(e => toast(e.message, true)) })
  $('document-list').querySelectorAll('[data-manage]').forEach(button => { button.onclick = () => showDocumentMenu(button.dataset.manage) })
}
function renderHeader() {
  if (!state.doc) return
  const { master, meta, archived } = state.doc
  const title = master ? '母版简历' : meta.company + ' · ' + meta.title
  $('doc-title').textContent = title
  $('doc-title').title = master ? '母版 · 完整经历' : `${title} · ${meta.status}${archived ? ' · 已归档' : ''}${meta.sent ? ' · 投递 ' + meta.sent : ''}${meta.followUp ? ' · 跟进 ' + meta.followUp : ''}`
  $('archive-badge').hidden = !archived
  $('doc-description').textContent = master ? '母版 · 完整经历' : `${meta.status} · 创建于 ${meta.created}`
  document.title = `${title} · 简历工作台`
  workflow.proofStatus()
}
async function refreshList() { state.documents = await api('/api/documents'); renderList() }
async function loadDocument(id, { discard = false } = {}) {
  if (state.switching) return
  state.switching = true
  try {
    if (dirty() && !discard) await save()
    const doc = await api(urlFor(id))
    closeProof()
    state.doc = doc; state.baseline = fingerprint(doc); state.sequence++; state.conflict = false
    $('preview').removeAttribute('data-document-id')
    localStorage.setItem('resume-studio-active:' + storageRoot, id)
    $('theme').value = doc.theme
    $('jd-tab').disabled = doc.master; $('details-tab').disabled = doc.master
    for (const key of ['company', 'title', 'created', 'status', 'notes', 'sent', 'followUp']) $('meta-' + key).value = doc.meta[key] || ''
    workflow.onLoaded()
    switchTab('resume'); renderHeader(); renderList(); scheduleRender(0)
    saveLabel('已保存')
    $('sidebar').classList.remove('open')
    const draft = readDraft(id)
    $('draft-banner').hidden = !draft || fingerprint({ ...doc, ...draft }) === state.baseline
    $('recover-draft').onclick = () => recoverDraft(draft)
    $('discard-draft').onclick = () => { clearDraft(id); $('draft-banner').hidden = true }
  } finally { state.switching = false }
}
function recoverDraft(draft) {
  if (!draft) return
  const apply = () => {
    Object.assign(state.doc, content(draft))
    $('theme').value = state.doc.theme
    for (const key of ['company', 'title', 'created', 'status', 'notes', 'sent', 'followUp']) $('meta-' + key).value = state.doc.meta[key] || ''
    switchTab(state.tab); renderHeader(); $('draft-banner').hidden = true; changed(); toast('已恢复浏览器草稿')
  }
  if (draft.revision !== state.doc.revision) {
    modal('恢复较早的草稿', `<p class="modal-note">此草稿早于当前文件，恢复将替换编辑内容；现有文件会先备份。</p><div class="modal-actions"><button id="draft-cancel" class="secondary-button">取消</button><button id="draft-confirm" class="primary-button">恢复草稿</button></div>`)
    $('draft-cancel').onclick = closeModal; $('draft-confirm').onclick = () => { closeModal(); apply() }
  } else apply()
}
function switchTab(tab) {
  if (!state.doc || (state.doc.master && tab !== 'resume')) return
  state.renderRequest++; state.renderAbort?.abort(); styleTicket++
  $('preview').onload = null
  closeProof()
  state.tab = tab
  workflow.onModeChange()
  if (visualEditor?.documentId !== state.doc.id) { visualEditor?.destroy(); visualEditor = null }
  else if (!isVisual()) visualEditor?.unmount()
  document.body.dataset.editMode = isVisual() ? 'visual' : 'source'
  document.body.dataset.tab = tab
  document.body.classList.remove('preview-focus', 'source-preview')
  $('source-preview-toggle').setAttribute('aria-pressed', 'false')
  $('source-preview-toggle').textContent = '查看预览'
  $('focus-button').setAttribute('aria-label', '展开预览'); $('focus-button').title = '展开预览'; $('focus-button').innerHTML = icon('maximize')
  $('document-toolbar').hidden = tab === 'details'
  $('visual-toolbar').hidden = !isVisual()
  $('source-tools').hidden = isVisual() || tab === 'details'
  $('visual-mode').setAttribute('aria-pressed', String(state.mode === 'visual'))
  $('source-mode').setAttribute('aria-pressed', String(state.mode === 'source'))
  $('visual-mode').disabled = tab !== 'resume'; $('source-mode').disabled = tab !== 'resume'
  $('properties-toggle').hidden = tab !== 'resume'
  document.querySelectorAll('.tab[data-tab]').forEach(button => { const active = button.dataset.tab === tab; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)) })
  $('editor-view').hidden = tab === 'details'; $('details-view').hidden = tab !== 'details'
  if (tab !== 'details') {
    $('editor').value = tab === 'resume' ? state.doc.markdown : state.doc.jd
    $('editor').placeholder = tab === 'jd' ? '粘贴岗位 JD 原文…' : '从姓名开始，写下你的经历…'
    $('editor').setAttribute('aria-label', tab === 'jd' ? '岗位 JD 编辑器' : 'Markdown 编辑器')
    $('import-button').title = tab === 'jd' ? '导入岗位 JD 原文' : '导入 Markdown'
    $('source-button').title = tab === 'jd' ? '下载岗位 JD 原文' : '下载 Markdown 源文件'
    $('source-button').innerHTML = icon('download') + (tab === 'jd' ? ' 下载原文' : ' MD')
    $('editor').scrollTop = 0
    $('editor-language').textContent = tab === 'resume' ? 'Markdown' : 'JD · 原文'
    $('avatar-button').disabled = tab !== 'resume'; $('icons-button').disabled = tab !== 'resume'
    updateEditorMeta()
  }
  scheduleRender(0)
}
function updateEditorMeta() {
  $('character-count').textContent = $('editor').value.length.toLocaleString('zh-CN') + ' 字符'
  const editor = $('editor'), measure = $('code-measure')
  measure.style.width = Math.max(10, editor.clientWidth - 38) + 'px'
  measure.innerHTML = editor.value.split('\n').map(line => '<div>' + (escape(line) || '<br>') + '</div>').join('')
  $('line-numbers').innerHTML = [...measure.children].map((line, i) => `<div style="height:${line.getBoundingClientRect().height || 24}px">${i + 1}</div>`).join('')
  $('line-numbers').scrollTop = $('editor').scrollTop
}
function editorChanged() {
  state.doc[state.tab === 'jd' ? 'jd' : 'markdown'] = $('editor').value
  updateEditorMeta(); changed({ preview: state.tab === 'resume' })
}
function insert(text, selectionOffset) {
  if (state.tab === 'details') switchTab('resume')
  if (isVisual() && visualEditor) { visualEditor.insertMarkdown(text); return }
  const editor = $('editor')
  const start = editor.selectionStart, end = editor.selectionEnd
  editor.setRangeText(text, start, end, 'end')
  editor.focus()
  if (selectionOffset != null) editor.setSelectionRange(start + selectionOffset, start + text.length - selectionOffset)
  editorChanged()
}
const snippets = {
  heading: '\n\n## [[e618]] 章节名称\n\n',
  list: '\n- 内容\n',
  entry: '\n\n<div class="entry-title">\n  <h3>职位 · 公司 / 项目名称</h3>\n  <p>开始时间 - 结束时间</p>\n</div>\n\n- 工作内容与成果\n',
  link: '[链接文字](https://example.com)',
  break: '\n\n<hr>\n\n'
}
function applySnippet(name) { if (!state.doc) return; if (isVisual() && visualEditor && name === 'bold') { visualEditor.command('bold'); return } if (name === 'bold') { const selected = $('editor').value.slice($('editor').selectionStart, $('editor').selectionEnd) || '重点内容'; insert('**' + selected + '**', 2) } else insert(snippets[name]) }
function scheduleRender(delay = 280) { clearTimeout(state.renderTimer); state.renderTimer = setTimeout(renderPreview, delay) }
function measurePaper() {
  const frame = $('preview')
  const paper = frame.contentDocument?.querySelector('.page')
  if (!paper) return
  state.paperHeight = Math.max(1123, paper.scrollHeight)
  frame.style.height = state.paperHeight + 'px'
  resizePaper()
}
function visualControls(editor) {
  const e = editor.editor
  if (!e) return
  document.querySelectorAll('[data-format]').forEach(button => {
    const name = button.dataset.format
    const active = name === 'align' ? e.isActive({ textAlign: button.dataset.value }) : e.isActive({ bullet: 'bulletList', ordered: 'orderedList' }[name] || name)
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active))
    if (name === 'undo' || name === 'redo') button.disabled = !e.can()[name]()
  })
  const attrs = e.getAttributes('textStyle')
  if (document.activeElement !== $('text-font')) $('text-font').value = attrs.fontFamily || ''
  if (document.activeElement !== $('text-size')) $('text-size').value = (attrs.fontSize || '').replace('pt', '')
  $('text-kind').value = String(e.isActive('heading') ? e.getAttributes('heading').level : 'paragraph')
  if (/^#[\da-f]{6}$/i.test(attrs.color || '')) $('text-color').value = attrs.color
  const { $from } = e.state.selection
  const element = $from.depth ? e.view.nodeDOM($from.before()) : null
  if (element?.nodeType === 1) {
    const css = element.ownerDocument.defaultView.getComputedStyle(element)
    const values = { lineHeight: parseFloat(css.lineHeight) / parseFloat(css.fontSize), before: parseFloat(css.marginTop) * 25.4 / 96, after: parseFloat(css.marginBottom) * 25.4 / 96, indent: parseFloat(css.paddingLeft) * 25.4 / 96 }
    document.querySelectorAll('[data-paragraph]').forEach(control => { if (document.activeElement !== control && Number.isFinite(values[control.dataset.paragraph])) control.value = Math.round(values[control.dataset.paragraph] * 100) / 100 })
  }
  if (editor.mounted) readObjectControls(editor)
  workflow.updateContext(editor)
}
const mm = value => Number.isFinite(parseFloat(value)) ? Math.round(parseFloat(value) * 25.4 / 96 * 100) / 100 : 0
function colorHex(value) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
  const context = canvas.getContext('2d'); context.fillStyle = value; context.fillRect(0, 0, 1, 1)
  return '#' + [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(n => n.toString(16).padStart(2, '0')).join('')
}
function readObjectControls(editor = visualEditor) {
  return withPrintPalette($('preview').contentDocument, () => readPrintObjectControls(editor))
}
function readPrintObjectControls(editor = visualEditor) {
  if (!editor?.mounted) return
  for (const avatar of [true, false]) {
    const el = editor.imageElement(avatar), css = el ? el.ownerDocument.defaultView.getComputedStyle(el) : null
    const selected = editor.editor.state.selection.node?.type.name === (avatar ? 'resumeAvatar' : 'resumeImage')
    const targetHint = $(avatar ? 'avatar-target' : 'picture-target')
    targetHint.textContent = el ? selected ? '当前' + (avatar ? '头像' : '图片') : avatar ? '第一个头像' : '第一张图片' : '没有' + (avatar ? '头像' : '图片')
    targetHint.hidden = selected
    const values = css ? { width: mm(css.width), height: mm(css.height), left: css.left !== 'auto' ? mm(css.left) : -mm(css.right), top: mm(css.top) } : {}
    const controls = document.querySelectorAll(avatar ? '[data-image], [data-layout="avatarWidth"], [data-layout="avatarHeight"], [data-layout="cropX"], [data-layout="cropY"]' : '[data-picture]')
    const position = css?.objectPosition.split(' ') || ['50%', '50%']
    Object.assign(values, { avatarWidth: values.width, avatarHeight: values.height, cropX: parseFloat(position[0]), cropY: parseFloat(position[1]) })
    controls.forEach(control => { control.disabled = !el; const key = control.dataset.image || control.dataset.picture || control.dataset.layout; if (el && document.activeElement !== control) control.value = values[key] })
    $(avatar ? 'remove-avatar' : 'remove-image').disabled = !el
  }
  const target = editor.ruleTargets()[0], el = target ? editor.editor.view.nodeDOM(target.pos) : null
  const css = el ? el.ownerDocument.defaultView.getComputedStyle(el) : null
  const pseudo = el && (target.node.type.name === 'resumeDivider' || el.hasAttribute('data-resume-rule')) ? el.ownerDocument.defaultView.getComputedStyle(el, '::after') : null
  const get = key => css?.getPropertyValue('--resume-rule-' + key).trim()
  const defaults = { thickness: mm(pseudo?.borderTopWidth || css?.borderBottomWidth) || .25, width: 100, gap: target?.node.type.name === 'resumeDivider' ? 2 : css ? mm(css.paddingBottom) : 1, x: 0, y: 0, style: 'solid', color: pseudo?.borderTopColor || css?.borderBottomColor || '#a2b6d4' }
  document.querySelectorAll('[data-rule]').forEach(control => { control.disabled = !target; if (document.activeElement === control) return; const key = control.dataset.rule, value = get(key) || defaults[key]; control.value = key === 'color' ? colorHex(value) : key === 'style' ? value : parseFloat(value) })
  document.querySelectorAll('[data-table]').forEach(button => { button.disabled = !editor.tableTarget() })
  editor.updateImageHandles($('image-ratio-lock').checked)
}
function readLayoutControls() {
  return withPrintPalette($('preview').contentDocument, readPrintLayoutControls)
}
function readPrintLayoutControls() {
  const doc = $('preview').contentDocument, win = doc?.defaultView
  if (!win || !doc.querySelector('.page')) return
  const body = win.getComputedStyle(doc.body), paper = win.getComputedStyle(doc.querySelector('.page'))
  const heading = doc.querySelector('h2'), avatar = doc.querySelector('.avatar')
  const h2 = heading ? win.getComputedStyle(heading) : null, image = avatar ? win.getComputedStyle(avatar) : null
  const mm = value => Math.round(parseFloat(value) * 25.4 / 96 * 100) / 100
  const get = name => body.getPropertyValue('--' + name).trim().replaceAll('"', '').replaceAll("'", '')
  const position = image?.objectPosition.split(' ') || ['50%', '50%']
  const stored = readLayoutSettings(state.doc.markdown)
  const info = doc.querySelector('[data-profile-role="info"]')
  const infoStyle = info ? win.getComputedStyle(info) : null
  const infoTextStyle = info?.querySelector('p') ? win.getComputedStyle(info.querySelector('p')) : infoStyle
  const name = doc.querySelector('[data-profile-role="name"]'), nameStyle = name ? win.getComputedStyle(name) : null
  $('layout-description').textContent = resumeLayouts.find(layout => layout.id === state.doc.theme)?.description || '自定义排版'
  const values = {
    textSize: parseFloat(get('text-size')), lineHeight: parseFloat(get('line-height')), h1Size: parseFloat(get('h1-size')), h2Size: parseFloat(get('h2-size')),
    textFont: get('text-font'), titleFont: get('title-font'), accent: get('color-accent').slice(0, 7),
    marginTop: mm(paper.paddingTop), marginBottom: mm(paper.paddingBottom), marginLeft: mm(paper.paddingLeft), marginRight: mm(paper.paddingRight),
    sectionBefore: h2 ? mm(h2.marginTop) : 2.4, sectionAfter: h2 ? mm(h2.marginBottom) : 1.9,
    avatarWidth: image ? mm(image.width) : 22, avatarHeight: image ? mm(image.height) : 32, cropX: parseFloat(position[0]), cropY: parseFloat(position[1]),
    nameAlign: stored.nameAlign || 'auto', infoAlign: stored.infoAlign || 'auto', avatarSide: stored.avatarSide || 'auto',
    contactFlow: stored.contactFlow || 'auto', contactGap: parseFloat(get('profile-contact-gap')) || 0,
    infoSize: parseFloat(get('blockquote-size')), infoLineHeight: stored.infoLineHeight ?? (Math.round(parseFloat(infoTextStyle?.lineHeight) / parseFloat(infoTextStyle?.fontSize) * 100) / 100 || 1.6),
    infoColumns: Number(get('profile-info-columns')) || 1, nameGap: stored.nameGap ?? (nameStyle ? mm(nameStyle.marginBottom) : 0),
    infoGap: stored.infoGap ?? (infoStyle ? mm(infoStyle.marginBottom) : 0), infoLeft: stored.infoLeft ?? 0, infoTop: stored.infoTop ?? 0,
  }
  document.querySelectorAll('[data-layout]').forEach(control => { if (document.activeElement !== control && values[control.dataset.layout] != null) control.value = values[control.dataset.layout] })
  $('remove-avatar').disabled = !avatar
}
async function refreshVisualStyles() {
  if (!visualEditor?.mounted || !isVisual()) return
  const editor = visualEditor, signature = styleSignature(), ticket = ++styleTicket
  try {
    const { html } = await api('/api/render', { method: 'POST', body: JSON.stringify({ markdown: state.doc.markdown, theme: state.doc.theme }) })
    if (ticket !== styleTicket || editor !== visualEditor || !isVisual()) return
    const rendered = new DOMParser().parseFromString(html, 'text/html'), doc = $('preview').contentDocument
    doc.querySelectorAll('style[data-visual-render]').forEach(style => style.remove())
    rendered.querySelectorAll('style').forEach(style => { const copy = doc.createElement('style'); copy.dataset.visualRender = ''; copy.textContent = style.textContent; doc.head.append(copy) })
    const frameStyle = doc.createElement('style'); frameStyle.dataset.visualRender = ''; frameStyle.textContent = '.page{margin:0!important;box-shadow:none!important}html,body{overflow:hidden}'
    doc.head.append(frameStyle)
    applyPaperAppearance(doc, appearance.theme)
    doc.querySelector('.page').getBoundingClientRect()
    await doc.fonts.ready
    if (ticket !== styleTicket || editor !== visualEditor) return
    editor.styleSignature = signature; editor.theme = state.doc.theme
    readLayoutControls(); readObjectControls(); measurePaper()
  } catch (error) { toast('排版更新失败：' + error.message, true) }
}
function renderOutline() {
  if (!visualEditor) return
  const render = kind => {
    const groups = visualEditor.groups(kind)
    return groups.map((group, index) => `<div class="outline-row ${kind === 'entry' ? 'outline-entry' : ''}"><button class="outline-title" data-outline-select="${kind}" data-index="${index}" title="${escape(group.title)}">${escape(group.title || '未命名')}</button><div><button data-outline-move="${kind}" data-index="${index}" data-direction="-1" aria-label="上移${escape(group.title)}" ${index === 0 || kind === 'entry' && groups[index - 1]?.parent !== group.parent ? 'disabled' : ''}>${icon('arrow-up')}</button><button data-outline-move="${kind}" data-index="${index}" data-direction="1" aria-label="下移${escape(group.title)}" ${index === groups.length - 1 || kind === 'entry' && groups[index + 1]?.parent !== group.parent ? 'disabled' : ''}>${icon('arrow-down')}</button>${kind === 'entry' ? `<button data-outline-transfer="${index}" title="移到其他章节" aria-label="将${escape(group.title)}移到其他章节">${icon('folder-input')}</button>` : ''}<button data-outline-delete="${kind}" data-index="${index}" aria-label="删除${escape(group.title)}">${icon('trash-2')}</button></div></div>`).join('')
  }
  $('document-outline').innerHTML = render('section') + '<div class="outline-caption">经历条目</div>' + render('entry')
  decorateIcons($('document-outline'))
  document.querySelectorAll('[data-outline-select]').forEach(button => { button.onclick = () => visualEditor.selectGroup(button.dataset.outlineSelect, Number(button.dataset.index)) })
  document.querySelectorAll('[data-outline-move]').forEach(button => { button.onclick = () => visualEditor.moveGroup(button.dataset.outlineMove, Number(button.dataset.index), Number(button.dataset.direction)) })
  document.querySelectorAll('[data-outline-transfer]').forEach(button => { button.onclick = () => {
    const index = Number(button.dataset.outlineTransfer), parent = visualEditor.groups('entry')[index].parent
    modal('移动经历到其他章节', `<form id="transfer-form" class="modal-form"><label>目标章节<select id="transfer-section">${visualEditor.groups('section').map((group, at) => `<option value="${at}" ${at === parent ? 'disabled' : ''}>${escape(group.title)}</option>`).join('')}</select></label><div class="modal-actions"><button class="primary-button">移动</button></div></form>`)
    $('transfer-form').onsubmit = event => { event.preventDefault(); const section = Number($('transfer-section').value); closeModal(); visualEditor.moveEntryTo(index, section) }
  } })
  document.querySelectorAll('[data-outline-delete]').forEach(button => { button.onclick = () => {
    const kind = button.dataset.outlineDelete, index = Number(button.dataset.index), title = visualEditor.groups(kind)[index]?.title
    modal('删除这段内容？', `<p class="modal-note">删除「${escape(title)}」及其内容，可撤销。</p><div class="modal-actions"><button id="delete-cancel" class="secondary-button">取消</button><button id="delete-confirm" class="danger-button">删除</button></div>`)
    $('delete-cancel').onclick = closeModal; $('delete-confirm').onclick = () => { closeModal(); visualEditor.deleteGroup(kind, index) }
  } })
}
async function renderPreview() {
  if (!state.doc || state.tab !== 'resume') return
  if (isVisual() && visualEditor?.mounted && visualEditor.documentId === state.doc.id && visualEditor.getMarkdown() === state.doc.markdown) { if (visualEditor.styleSignature !== styleSignature()) await refreshVisualStyles(); else measurePaper(); return }
  const ticket = ++state.renderRequest
  state.renderAbort?.abort(); state.renderAbort = new AbortController()
  try {
    const { html } = await api('/api/render', { method: 'POST', body: JSON.stringify({ markdown: state.doc.markdown, theme: state.doc.theme }), signal: state.renderAbort.signal })
    if (ticket !== state.renderRequest) return
    if (visualEditor?.documentId !== state.doc.id) { visualEditor?.destroy(); visualEditor = null }
    visualEditor?.unmount()
    const frame = $('preview')
    frame.style.visibility = 'hidden'
    $('preview-loading').hidden = false
    frame.onload = async () => {
      try {
        await frame.contentDocument.fonts.ready
        if (ticket !== state.renderRequest) return
        if (isVisual()) {
          const paper = frame.contentDocument.querySelector('.page')
          paper.querySelectorAll('style').forEach(style => frame.contentDocument.head.append(style.cloneNode(true)))
          frame.contentDocument.querySelectorAll('style').forEach(style => { style.dataset.visualRender = '' })
          paper.replaceChildren()
          const style = frame.contentDocument.createElement('style')
          style.textContent = '.resume-editor{outline:none;min-height:260mm;white-space:pre-wrap;overflow-wrap:break-word;caret-color:#50739b}.resume-editor .preserved-source{display:none!important}.resume-editor .preserved-block{position:relative}.resume-editor .ProseMirror-selectednode{outline:1px solid #8aa7c5}.resume-editor .ProseMirror-gapcursor{display:none}.resume-editor .ProseMirror-separator{display:none}.resume-editor img{max-width:100%}.resume-editor a{cursor:text}.resume-editor hr{border:0;border-top:1px dashed #b7c5d8;margin:8mm 0;position:relative;overflow:visible}.resume-editor hr::after{content:"分页符";position:absolute;left:50%;transform:translateX(-50%);top:-7px;background:white;padding:0 10px;font:10px sans-serif;color:#90a2bb;white-space:nowrap}'
          frame.contentDocument.head.append(style)
          if (visualEditor) visualEditor.mount(paper, state.doc.markdown)
          else visualEditor = new VisualEditor({ element: paper, markdown: state.doc.markdown, iconMetrics: state.iconMetrics,
            onChange: markdown => { state.doc.markdown = markdown; $('editor').value = markdown; $('character-count').textContent = markdown.length.toLocaleString('zh-CN') + ' 字符'; changed({ preview: false }); renderOutline(); if (visualEditor && visualEditor.styleSignature !== styleSignature()) refreshVisualStyles() },
            onSelection: visualControls, onLayout: () => requestAnimationFrame(measurePaper),
            onEditRaw: node => {
              modal('编辑自定义块', `<form id="raw-form" class="modal-form"><p class="modal-note">只修改此块，可撤销。</p><textarea id="raw-source" class="version-source">${escape(node.attrs.raw)}</textarea><div class="modal-actions"><button class="primary-button">应用</button></div></form>`)
              $('raw-form').onsubmit = event => { event.preventDefault(); const raw = $('raw-source').value; closeModal(); visualEditor.editRaw(node.attrs.sourceId, raw) }
            },
          })
          visualEditor.documentId = state.doc.id; visualEditor.theme = state.doc.theme; visualEditor.styleSignature = styleSignature()
          visualEditor.keepPasteFormatting = $('paste-format').checked
          visualEditor.alignmentGuidesEnabled = $('alignment-guides').checked
          readLayoutControls(); readObjectControls(); renderOutline()
          frame.contentDocument.addEventListener('pointerup', () => visualControls(visualEditor))
          frame.contentDocument.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save({ announce: true }).catch(e => toast(e.message, true)) } })
        }
        applyPaperAppearance(frame.contentDocument, appearance.theme)
        measurePaper()
        frame.style.visibility = 'visible'
        frame.dataset.documentId = state.doc.id
        $('preview-loading').hidden = true
    } catch (error) { toast('编辑器加载失败：' + error.message, true) }
    }
    frame.srcdoc = html.replace('</head>', '<style>@media screen { .page { margin:0; box-shadow:none; } html,body { overflow:hidden; } }</style></head>')
  } catch (error) { if (error.name !== 'AbortError') toast('预览失败：' + error.message, true) }
}
function resizePaper() {
  const stage = $('preview-stage')
  const fit = Math.max(.25, (stage.clientWidth - (window.innerWidth <= 700 ? 24 : 40)) / 794)
  const zoom = state.zoom ?? Math.min(fit, 1)
  $('preview').style.transform = `scale(${zoom})`
  $('paper-wrap').style.width = 794 * zoom + 'px'; $('paper-wrap').style.height = state.paperHeight * zoom + 'px'
  $('zoom-fit').textContent = `${Math.round(zoom * 100)}%`
  $('zoom-fit').title = state.zoom == null ? '已适应宽度；点击重新适应' : '点击适应宽度'
  proofReader?.setZoom(zoom)
}
function triggerDownload(url, filename) {
  const link = document.createElement('a')
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove()
}
async function download(blob, filename) {
  try { const result = await api('/api/downloads', { method: 'POST', body: JSON.stringify({ text: await blob.text(), filename }) }); triggerDownload(result.url, filename) }
  catch (e) { toast('下载失败：' + e.message, true) }
}
function downloadDraft() { download(new Blob([JSON.stringify(content(state.doc), null, 2)], { type: 'application/json' }), state.doc.id + '-草稿.json'); toast('草稿包含简历、JD、主题和投递信息') }
async function exportPdf() {
  if (!state.doc || state.exporting) return
  state.exporting = true; $('export-button').disabled = true; $('export-button').textContent = '正在生成…'
  try {
    await save()
    // 保存期间仍可输入，继续保存到内容稳定再取导出快照。
    while (dirty()) await save()
    const id = state.doc.id, revision = state.doc.revision, proofSource = workflow.sourceKey(state.doc)
    const result = await api(urlFor(id) + '/export', { method: 'POST', body: JSON.stringify({ revision }), headers: { Accept: 'application/json' } })
    if (state.doc.id === id) workflow.rememberProof(result.proof, proofSource)
    triggerDownload(result.url, result.filename)
    toast(`PDF 已生成并下载（${result.pages || '?'} 页）${result.saved ? '，已保存到对应简历目录' : '，导出期间的新编辑内容已保留'}`)
  } catch (error) { if (error.status === 409) handleConflict(error); toast('导出失败：' + error.message, true) }
  finally { state.exporting = false; $('export-button').disabled = false; $('export-button').innerHTML = icon('download') + ' 导出 PDF' }
}
function closeProof({ focus = false } = {}) {
  proofTicket++
  const wasOpen = document.body.classList.contains('proof-open')
  proofReader?.destroy(); proofReader = null; proofResult = null
  document.body.classList.remove('proof-open')
  $('proof-view').hidden = true; $('proof-toolbar').hidden = true; $('paper-wrap').hidden = false
  $('properties-panel').inert = false; $('editor-panel').inert = false; $('theme').disabled = false
  if (wasOpen) { $('preview-loading').hidden = true; $('preview-stage').scrollTop = editingScroll; measurePaper(); if (focus && isVisual()) visualEditor?.editor.view.focus() }
  if (state.doc) workflow.proofStatus()
}
async function openProof() {
  if (!state.doc || state.exporting) return
  const alreadyOpen = document.body.classList.contains('proof-open')
  if (!alreadyOpen) editingScroll = $('preview-stage').scrollTop
  const ticket = ++proofTicket
  state.exporting = true
  $('proof-button').disabled = true; $('proof-refresh').disabled = true; $('export-button').disabled = true; $('proof-download').disabled = true
  document.body.classList.add('proof-open')
  $('proof-view').hidden = false; $('proof-toolbar').hidden = false; $('paper-wrap').hidden = true
  $('properties-panel').inert = true; $('editor-panel').inert = true; $('theme').disabled = true
  $('proof-status').textContent = '正在生成 PDF…'
  $('preview-loading').hidden = false
  try {
    await save()
    while (dirty()) await save()
    const id = state.doc.id, revision = state.doc.revision, proofSource = workflow.sourceKey(state.doc)
    const [{ PdfProof }, result] = await Promise.all([
      import('./pdf-proof.bundle.js'),
      api(urlFor(id) + '/export', { method: 'POST', body: JSON.stringify({ revision }), headers: { Accept: 'application/json' } }),
    ])
    if (ticket !== proofTicket || state.doc.id !== id) return
    proofReader?.destroy()
    proofReader = new PdfProof({ container: $('proof-view'), scrollRoot: $('preview-stage'),
      theme: proofPrintColors ? 'light' : appearance.theme,
      onPage: (page, total) => { if (document.activeElement !== $('proof-page')) $('proof-page').value = page; $('proof-page').max = total; $('proof-total').textContent = '/ ' + total; $('proof-prev').disabled = page <= 1; $('proof-next').disabled = page >= total },
      onError: error => toast('校样显示失败：' + error.message + '，可点击导出 PDF 查看', true),
    })
    resizePaper()
    $('preview-stage').scrollTop = 0
    const pages = await proofReader.open(result.url)
    if (ticket !== proofTicket) return
    proofResult = { ...result, created: Date.now() }
    workflow.rememberProof(result.proof, proofSource)
    $('proof-status').textContent = `${pages} 页 · 实际 PDF`
    $('proof-status').title = `${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 校样 · A4`
    $('proof-download').disabled = false
  } catch (error) {
    if (ticket === proofTicket) { closeProof(); if (error.status === 409) handleConflict(error); toast('校样失败：' + error.message, true) }
  } finally {
    state.exporting = false; $('proof-button').disabled = false; $('proof-refresh').disabled = false; $('export-button').disabled = false
    if (ticket === proofTicket) $('preview-loading').hidden = true
  }
}
function modal(title, html) {
  $('modal').classList.remove('wide-modal', 'history-modal')
  $('modal-title').textContent = title; $('modal-body').innerHTML = html
  decorateIcons($('modal-body'))
  if (!$('modal').open) $('modal').showModal()
}
function closeModal() { $('modal').close() }
async function newApplication(source = '_master') {
  if (!state.doc) return
  try { await save() } catch { return }
  modal(source === '_master' ? '新建投递版本' : '复制当前投递版本', `<form id="new-form" class="modal-form"><label>公司名称<input id="new-company" placeholder="例如：字节跳动" maxlength="100" required></label><label>目标岗位<input id="new-title" placeholder="例如：AI 产品运营" maxlength="100" required></label><label>岗位 JD（选填）<textarea id="new-jd" rows="5" placeholder="粘贴岗位描述原文"></textarea></label><div class="modal-actions"><button type="button" id="new-cancel" class="secondary-button">取消</button><button type="submit" class="primary-button">创建投递版本</button></div></form>`)
  $('new-cancel').onclick = closeModal
  $('new-form').onsubmit = async event => {
    event.preventDefault()
    const button = event.submitter; button.disabled = true
    try {
      const doc = await api('/api/documents', { method: 'POST', body: JSON.stringify({ company: $('new-company').value, title: $('new-title').value, jd: $('new-jd').value, source }) })
      closeModal(); await refreshList(); await loadDocument(doc.id); toast('投递版本已创建')
    } catch (error) { toast(error.message, true); button.disabled = false }
  }
}
async function showHistory() { return workflow.showHistory() }
async function showTrash() {
  try {
    const items = await api('/api/trash')
    modal('回收站', items.length ? `${items.map(item => `<div class="trash-row"><div><strong>${escape(item.id)}</strong><small>${formatTime(item.timestamp)}</small></div><button class="secondary-button" data-trash="${item.key}">恢复</button></div>`).join('')}` : '<div class="empty-state">回收站为空</div>')
    document.querySelectorAll('[data-trash]').forEach(button => { button.onclick = async () => { try { await api('/api/trash/' + button.dataset.trash, { method: 'POST', body: '{}' }); await refreshList(); await showTrash(); toast('投递版本已恢复') } catch (e) { toast(e.message, true) } } })
  } catch (e) { toast(e.message, true) }
}
async function setDocumentArchived() {
  if (!state.doc || state.doc.master || state.switching) return
  const id = state.doc.id, archived = !state.doc.archived
  try {
    await save()
    if (state.doc?.id !== id || state.switching) return
    state.switching = true
    const saved = await api(urlFor(id) + '/archived', { method: 'PATCH', body: JSON.stringify({ revision: state.doc.revision, archived }) })
    Object.assign(state.doc, { archived: saved.archived, revision: saved.revision, modified: saved.modified })
    if (dirty()) writeDraft(); else clearDraft(id)
    $('archive-filter').value = archived ? 'archived' : 'active'
    localStorage.setItem('resume-studio-archive-filter', $('archive-filter').value)
    closeModal(); await refreshList(); renderHeader()
    toast(archived ? '已归档，可在已归档列表查看' : '已取消归档')
  } catch (e) { if (e.status === 409) handleConflict(e); else toast(e.message, true) }
  finally { state.switching = false; scheduleSave() }
}
function deleteDocument() {
  if (!state.doc || state.doc.master) return
  const id = state.doc.id
  modal('删除这份投递？', `<p class="modal-note">${escape(state.doc.meta.company)} · ${escape(state.doc.meta.title)}<br>移入回收站，可恢复。</p><div class="modal-actions"><button id="delete-cancel" class="secondary-button">取消</button><button id="delete-confirm" class="danger-button">删除投递</button></div>`)
  $('delete-cancel').onclick = closeModal
  $('delete-confirm').onclick = async () => {
    const button = $('delete-confirm'); button.disabled = true
    try {
      await save()
      if (state.doc?.id !== id || state.switching) throw new Error('请重新打开这份投递后删除')
      await api(urlFor(id) + '/trash', { method: 'POST', body: JSON.stringify({ revision: state.doc.revision }) })
      clearDraft(id); closeModal(); state.doc = null; await refreshList(); await loadDocument('_master', { discard: true }); toast('已移入回收站')
    } catch (e) { button.disabled = false; if (e.status === 409) handleConflict(e); else toast(e.message, true) }
  }
}
function showDocumentMenu(id) {
  const doc = state.documents.find(doc => doc.id === id)
  if (!doc || doc.master) return
  modal(`${doc.meta.company} · ${doc.meta.title}`, `<div class="more-actions"><button id="manage-details">${icon('briefcase-business')}投递信息</button><button id="manage-copy">${icon('copy')}复制为新投递</button><button id="manage-archive">${icon('file-archive')}${doc.archived ? '取消归档' : '归档投递'}</button><button id="manage-delete" class="delete-action">${icon('trash-2')}删除投递…</button></div>`)
  const run = action => async () => {
    try {
      if (state.doc?.id !== id) await loadDocument(id)
      if (state.doc?.id !== id || state.switching) return toast('请稍后重试', true)
      closeModal(); action()
    } catch (e) { toast(e.message, true) }
  }
  $('manage-details').onclick = run(() => switchTab('details'))
  $('manage-copy').onclick = run(() => newApplication(id))
  $('manage-archive').onclick = run(setDocumentArchived)
  $('manage-delete').onclick = run(deleteDocument)
}
async function showIcons() {
  try { const icons = await api('/assets/icons/manifest.json'); modal('插入简历图标', '<div class="icon-grid">' + Object.keys(icons).map(code => `<button class="icon-choice" data-icon="${code}"><img src="/assets/icons/${code}.png" alt="图标 ${code}"><span>${code}</span></button>`).join('') + '</div>'); document.querySelectorAll('[data-icon]').forEach(button => { button.onclick = () => { closeModal(); if (isVisual() && visualEditor) visualEditor.insertIcon(button.dataset.icon); else insert('[[' + button.dataset.icon + ']]') } }) } catch (e) { toast(e.message, true) }
}
function showHelp() {
  modal('使用指南', `<div class="help-content"><dl class="help-steps"><dt>准备</dt><dd>母版保存完整经历，新建投递版本按岗位调整。</dd><dt>编辑</dt><dd>直接编辑纸面，或切换 Markdown 源码；JD 对照在右侧打开。</dd><dt>投递</dt><dd>分页校样 → 保存定稿 → 记录投递状态与跟进日期。</dd><dt>恢复与备份</dt><dd>历史版本可命名保留；更多操作可下载完整 ZIP 备份。</dd></dl><table class="help-shortcuts"><tr><th>保存</th><td>Ctrl / ⌘ + S</td><th>撤销 / 重做</th><td>Ctrl + Z / Y</td></tr><tr><th>加粗</th><td>Ctrl + B</td><th>纯文本粘贴</th><td>Ctrl + Shift + V</td></tr></table></div>`)
}
function showMore() {
  if (!state.doc) return
  const actions = [
    ...(!state.doc.master ? [['more-final', 'file-check-2', '保存投递定稿'], ['more-finals', 'files', '投递定稿档案'], ['more-jd', 'panel-right-open', '对照岗位 JD'], ['more-compare', 'diff', '与当前母版比较']] : []),
    ['more-checkpoint', 'bookmark', '保留当前关键版本'], ['more-history', 'history', '历史版本'], ['more-backup', 'file-archive', '完整备份工作台 ZIP'], ['more-download', 'download', state.tab === 'jd' ? '下载岗位 JD 原文' : '下载 Markdown 源文件'], ['more-duplicate', 'copy', '复制当前简历'], ['more-refresh', 'refresh-cw', '重新加载本地文件'],
    ...(!state.doc.master ? [['more-archive', 'file-archive', state.doc.archived ? '取消归档' : '归档投递'], ['more-delete', 'trash-2', '删除投递…']] : []),
  ]
  modal('更多操作', '<div class="more-actions">' + actions.map(([id, name, label]) => `<button id="${id}"${id === 'more-delete' ? ' class="delete-action"' : ''}>${icon(name)}${label}</button>`).join('') + '</div>')
  $('more-checkpoint').onclick = workflow.checkpoint
  $('more-backup').onclick = workflow.backup
  if (!state.doc.master) {
    $('more-final').onclick = workflow.createFinal; $('more-finals').onclick = workflow.showFinals
    $('more-jd').onclick = () => { closeModal(); workflow.toggleJd() }; $('more-compare').onclick = workflow.compareMaster
  }
  $('more-history').onclick = showHistory
  $('more-download').onclick = () => { closeModal(); sourceDownload() }
  $('more-duplicate').onclick = () => newApplication(state.doc.id)
  $('more-refresh').onclick = async () => { try { await save(); closeModal(); await loadDocument(state.doc.id); toast('已重新加载文件') } catch (e) { toast(e.message, true) } }
  if ($('more-archive')) $('more-archive').onclick = setDocumentArchived
  if ($('more-delete')) $('more-delete').onclick = deleteDocument
}
function sourceDownload() { const isJd = state.tab === 'jd'; download(new Blob([isJd ? state.doc.jd : state.doc.markdown], { type: (isJd ? 'text/plain' : 'text/markdown') + ';charset=utf-8' }), state.doc.id + (isJd ? '-JD.txt' : '.md')) }

$('editor').addEventListener('input', editorChanged)
$('visual-mode').onclick = () => { state.mode = 'visual'; localStorage.setItem('resume-studio-editor-mode', state.mode); switchTab('resume') }
$('source-mode').onclick = () => { state.mode = 'source'; localStorage.setItem('resume-studio-editor-mode', state.mode); switchTab('resume') }
document.querySelectorAll('[data-format]').forEach(button => { button.onmousedown = event => event.preventDefault(); button.onclick = () => visualEditor?.command(button.dataset.format, button.dataset.value) })
for (const [id, name] of [['text-font', 'fontFamily'], ['text-size', 'fontSize'], ['text-kind', 'heading'], ['text-color', 'color']]) $(id).onchange = () => { if ($(id).checkValidity()) visualEditor?.command(name, $(id).value); else $(id).reportValidity() }
document.querySelectorAll('[data-visual-insert]').forEach(button => { button.onclick = () => applySnippet(button.dataset.visualInsert) })
$('visual-icons').onclick = showIcons
$('visual-avatar').onclick = () => $('avatar-file').click()
document.querySelectorAll('[data-layout]').forEach(control => { control.onchange = () => {
  if (!visualEditor?.mounted || !control.checkValidity()) { control.reportValidity(); return }
  try {
    const key = control.dataset.layout
    if (['avatarWidth', 'avatarHeight', 'cropX', 'cropY'].includes(key)) {
      if (key.startsWith('crop')) visualEditor.setImageStyle({ objectPosition: document.querySelector('[data-layout="cropX"]').value + '% ' + document.querySelector('[data-layout="cropY"]').value + '%' })
      else {
        const el = visualEditor.imageElement(), css = el.ownerDocument.defaultView.getComputedStyle(el), width = parseFloat(css.width), height = parseFloat(css.height), value = Number(control.value)
        const dimensions = { [key === 'avatarWidth' ? 'width' : 'height']: value }
        if ($('image-ratio-lock').checked) dimensions[key === 'avatarWidth' ? 'height' : 'width'] = Math.round(value * (key === 'avatarWidth' ? height / width : width / height) * 100) / 100
        visualEditor.setImageStyle(dimensions)
      }
      readObjectControls(); return
    }
    const settings = key.startsWith('margin') ? Object.fromEntries(['marginTop', 'marginBottom', 'marginLeft', 'marginRight'].map(name => [name, document.querySelector('[data-layout="' + name + '"]').value])) : { [key]: control.value }
    visualEditor.syncLayout(writeLayout(state.doc.markdown, settings))
  } catch (error) { toast(error.message, true) }
} })
document.querySelectorAll('[data-paragraph]').forEach(control => { control.onchange = () => { if (!control.checkValidity()) { control.reportValidity(); return } visualEditor?.setParagraph({ [control.dataset.paragraph]: control.value }) } })
$('reset-layout').onclick = () => { if (visualEditor) visualEditor.syncLayout(removeLayout(state.doc.markdown)) }
$('remove-avatar').onclick = () => visualEditor?.removeImage()
$('remove-image').onclick = () => visualEditor?.removeImage(false)
document.querySelectorAll('[data-image], [data-picture]').forEach(control => { control.onchange = () => { if (control.checkValidity()) visualEditor?.setImageStyle({ [control.dataset.image || control.dataset.picture]: Number(control.value) }, !control.dataset.picture); else control.reportValidity() } })
document.querySelectorAll('[data-nudge]').forEach(button => { button.onclick = () => { const [key, amount] = button.dataset.nudge.split(':'), control = document.querySelector('[data-image="' + key + '"]'); const value = Math.round((Number(control.value) + Number(amount)) * 100) / 100; if (value >= Number(control.min) && value <= Number(control.max)) visualEditor?.setImageStyle({ [key]: value }) } })
document.querySelectorAll('[data-image-scale]').forEach(button => { button.onclick = () => { const el = visualEditor?.imageElement(); if (!el) return; const css = el.ownerDocument.defaultView.getComputedStyle(el), scale = Number(button.dataset.imageScale); visualEditor.setImageStyle({ width: Math.round(mm(css.width) * scale * 100) / 100, height: Math.round(mm(css.height) * scale * 100) / 100 }) } })
document.querySelectorAll('[data-rule]').forEach(control => { control.onchange = () => { if (control.checkValidity()) visualEditor?.setRule({ [control.dataset.rule]: control.value }, $('rule-scope').value === 'all'); else control.reportValidity() } })
$('visual-divider').onclick = () => visualEditor?.editor.chain().focus().insertContent({ type: 'resumeDivider' }).run()
$('visual-image').onclick = () => { replaceOrdinaryImage = false; $('image-file').click() }
$('replace-image').onclick = () => { replaceOrdinaryImage = true; $('image-file').click() }
$('visual-table').onclick = () => {
  modal('插入表格', '<form id="table-form" class="modal-form"><label>行数<input id="table-rows" type="number" min="1" max="20" value="2" required></label><label>列数<input id="table-columns" type="number" min="1" max="10" value="2" required></label><div class="modal-actions"><button class="primary-button">插入</button></div></form>')
  $('table-form').onsubmit = event => { event.preventDefault(); const rows = Number($('table-rows').value), columns = Number($('table-columns').value); closeModal(); visualEditor?.insertTable(rows, columns) }
}
document.querySelectorAll('[data-table]').forEach(button => { button.onclick = () => { if (!visualEditor?.changeTable(button.dataset.table)) toast('请先点击普通表格。含合并单元格的表格可在源码模式调整行列。', true) } })
$('visual-link').onclick = () => {
  if (!visualEditor) return
  const editor = visualEditor.editor, attrs = editor.getAttributes('link')
  if (attrs.href) editor.chain().focus().extendMarkRange('link').run()
  const selected = visualEditor.selection
  modal('编辑链接', `<form id="link-form" class="modal-form"><label>显示文字<input id="link-text" value="${escape(selected)}" required></label><label>网址／邮箱／电话<input id="link-url" type="url" value="${escape(attrs.href || '')}" placeholder="https://、mailto: 或 tel:" required></label><div class="modal-actions">${attrs.href ? '<button id="unlink" type="button" class="secondary-button">取消链接</button>' : ''}<button class="primary-button" type="submit">应用链接</button></div></form>`)
  if ($('unlink')) $('unlink').onclick = () => { closeModal(); editor.chain().focus().extendMarkRange('link').unsetLink().run() }
  $('link-form').onsubmit = event => { event.preventDefault(); const url = $('link-url').value; if (!/^(https?:\/\/|mailto:|tel:)/i.test(url)) return toast('请填写 http、https、mailto 或 tel 链接', true); const text = $('link-text').value; closeModal(); if (text === selected && selected) editor.chain().focus().setLink({ href: url }).run(); else { const marks = (editor.state.storedMarks || editor.state.selection.$from.marks()).filter(mark => mark.type.name !== 'link').map(mark => mark.toJSON()); editor.chain().focus().insertContent({ type: 'text', text, marks: [...marks, { type: 'link', attrs: { ...attrs, href: url } }] }).run() } }
}
$('editor').addEventListener('scroll', () => { $('line-numbers').scrollTop = $('editor').scrollTop })
$('editor').addEventListener('keydown', event => { if (event.key === 'Tab') { event.preventDefault(); insert('  ') } })
document.querySelectorAll('.tab[data-tab]').forEach(button => { button.onclick = () => switchTab(button.dataset.tab) })
document.querySelectorAll('[data-insert]').forEach(button => { button.onmousedown = event => event.preventDefault(); button.onclick = () => applySnippet(button.dataset.insert) })
for (const key of ['company', 'title', 'created', 'status', 'notes', 'sent', 'followUp']) $('meta-' + key).addEventListener('input', () => { state.doc.meta[key] = $('meta-' + key).value.replace(/[\r\n]+/g, ' · '); renderHeader(); changed({ preview: false }) })
$('details-view').onsubmit = event => event.preventDefault()
$('theme').onchange = () => { state.doc.theme = $('theme').value; changed() }
$('search').oninput = renderList
for (const id of ['status-filter', 'follow-filter', 'group-by', 'archive-filter']) $(id).onchange = () => { localStorage.setItem('resume-studio-' + id, $(id).value); renderList() }
$('save-button').onclick = () => save({ announce: true }).catch(e => { if (state.conflict) handleConflict({ current: state.doc }); else toast(e.message, true) })
$('export-button').onclick = exportPdf
$('proof-button').onclick = () => document.body.classList.contains('proof-open') ? closeProof({ focus: true }) : openProof()
$('proof-back').onclick = () => closeProof({ focus: true })
$('proof-refresh').onclick = openProof
$('proof-page').onchange = () => { const number = $('proof-page').value; $('proof-page').blur(); proofReader?.goToPage(number) }
$('proof-prev').onclick = () => proofReader?.goToPage(Number($('proof-page').value) - 1)
$('proof-next').onclick = () => proofReader?.goToPage(Number($('proof-page').value) + 1)
$('proof-print-colors').onclick = () => {
  proofPrintColors = !proofPrintColors
  $('proof-print-colors').setAttribute('aria-pressed', String(proofPrintColors))
  proofReader?.setReadingTheme(proofPrintColors ? 'light' : appearance.theme)
}
$('proof-download').onclick = () => { if (!proofResult) return; if (Date.now() - proofResult.created > 240000) return exportPdf(); triggerDownload(proofResult.url, proofResult.filename) }
$('paste-format').checked = localStorage.getItem('resume-studio-paste-format') !== 'false'
$('paste-format').onchange = () => { localStorage.setItem('resume-studio-paste-format', $('paste-format').checked); if (visualEditor) visualEditor.keepPasteFormatting = $('paste-format').checked }
$('alignment-guides').checked = localStorage.getItem('resume-studio-alignment-guides') !== 'false'
$('alignment-guides').onchange = () => { localStorage.setItem('resume-studio-alignment-guides', $('alignment-guides').checked); if (visualEditor) visualEditor.alignmentGuidesEnabled = $('alignment-guides').checked }
$('new-button').onclick = () => newApplication()
$('trash-button').onclick = showTrash
$('help-button').onclick = showHelp
$('more-button').onclick = showMore
$('icons-button').onclick = showIcons
$('source-button').onclick = sourceDownload
$('import-button').onclick = () => $('import-file').click()
$('avatar-button').onclick = () => $('avatar-file').click()
$('autosave').onchange = () => { $('visual-autosave').checked = $('autosave').checked; localStorage.setItem('resume-studio-autosave', String($('autosave').checked)); scheduleSave() }
$('visual-autosave').onchange = () => { $('autosave').checked = $('visual-autosave').checked; $('autosave').onchange() }
$('menu-button').onclick = () => { if (window.innerWidth <= 700) { document.body.classList.remove('sidebar-collapsed'); $('sidebar').classList.toggle('open') } else document.body.classList.toggle('sidebar-collapsed'); requestAnimationFrame(resizePaper) }
function toggleFilters() {
  $('list-filters').hidden = !$('list-filters').hidden
  $('filter-toggle').setAttribute('aria-expanded', String(!$('list-filters').hidden))
}
$('filter-toggle').onclick = toggleFilters
$('list-filter-summary').onclick = () => { $('list-filters').hidden = false; $('filter-toggle').setAttribute('aria-expanded', 'true') }
for (const [id, archive] of [['rail-documents', 'active'], ['rail-archive', 'archived']]) $(id).onclick = () => {
  $('archive-filter').value = archive; $('archive-filter').onchange()
  document.body.classList.remove('sidebar-collapsed')
  if (window.innerWidth <= 700) $('sidebar').classList.add('open')
  requestAnimationFrame(resizePaper)
}
$('source-preview-toggle').onclick = () => {
  const active = document.body.classList.toggle('source-preview')
  $('source-preview-toggle').setAttribute('aria-pressed', String(active))
  $('source-preview-toggle').textContent = active ? '返回源码' : '查看预览'
  resizePaper()
}
$('properties-toggle').onclick = () => {
  if (!isVisual()) { state.mode = 'visual'; localStorage.setItem('resume-studio-editor-mode', state.mode); switchTab('resume'); workflow.setPanel(true) }
  else workflow.setPanel(window.innerWidth <= 1030 ? !document.body.classList.contains('properties-open') : document.body.classList.contains('properties-hidden'))
}
$('properties-close').onclick = () => workflow.setPanel(false)
$('modal-close').onclick = closeModal
$('modal').addEventListener('click', event => { if (event.target === $('modal')) { const rect = $('modal').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeModal() } })
$('focus-button').onclick = () => {
  const expanded = document.body.classList.toggle('preview-focus'), label = expanded ? '退出展开预览' : '展开预览'
  $('focus-button').setAttribute('aria-label', label); $('focus-button').title = label; $('focus-button').innerHTML = icon(expanded ? 'minimize' : 'maximize'); resizePaper()
}
$('zoom-fit').onclick = () => { state.zoom = null; resizePaper() }
$('zoom-in').onclick = () => { const current = state.zoom ?? parseInt($('zoom-fit').textContent.match(/\d+/)?.[0] || '60') / 100; state.zoom = Math.min(1.5, current + .1); resizePaper() }
$('zoom-out').onclick = () => { const current = state.zoom ?? parseInt($('zoom-fit').textContent.match(/\d+/)?.[0] || '60') / 100; state.zoom = Math.max(.25, current - .1); resizePaper() }
new ResizeObserver(resizePaper).observe($('preview-stage'))
new ResizeObserver(() => { if (state.doc && state.tab !== 'details') updateEditorMeta() }).observe($('editor'))
$('import-file').onchange = async event => {
  const file = event.target.files[0]; event.target.value = ''
  if (!file || !state.doc) return
  if (file.size > 1024 * 1024) return toast('导入文件不能超过 1 MB', true)
  const target = state.tab === 'jd' ? 'jd' : 'markdown', text = await file.text()
  modal(target === 'jd' ? '导入岗位 JD' : '导入 Markdown 文件', `<p class="modal-note">将用 ${escape(file.name)} 替换当前${target === 'jd' ? 'JD' : '简历'}内容。当前版本会先保存，历史版本可恢复。</p><div class="modal-actions"><button id="import-cancel" class="secondary-button">取消</button><button id="import-confirm" class="primary-button">确认导入</button></div>`)
  $('import-cancel').onclick = closeModal
  $('import-confirm').onclick = async () => { try { await save(); state.doc[target] = text; switchTab(target === 'jd' ? 'jd' : 'resume'); closeModal(); changed({ preview: target === 'markdown' }); toast(target === 'jd' ? '已导入岗位 JD' : '已导入 Markdown') } catch (e) { toast(e.message, true) } }
}
async function uploadPicture(event, avatar) {
  const file = event.target.files[0]; event.target.value = ''
  if (!file || !state.doc) return
  if (file.size > 5 * 1024 * 1024) return toast('图片文件不能超过 5 MB', true)
  const id = state.doc.id
  try {
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file) })
    const result = await api('/api/upload', { method: 'POST', body: JSON.stringify({ data }) })
    if (state.doc.id !== id) return toast('图片已上传，请回到原简历后重新插入')
    if (isVisual() && visualEditor?.mounted) {
      if (avatar || replaceOrdinaryImage) visualEditor.replaceImage(result.path, avatar)
      else visualEditor.editor.chain().focus().insertContent({ type: 'resumeImage', attrs: { src: result.path, style: 'width:30mm;height:auto' } }).run()
      readObjectControls(); toast('图片已更新，可按 Ctrl+Z 撤销'); return
    }
    const tag = `<img class="avatar" src="${result.path}">`
    const avatarPattern = /<img\b(?=[^>]*(?:class=["'][^"']*\bavatar\b|alt=["']avatar["']))[^>]*>/i
    if (avatar && avatarPattern.test(state.doc.markdown)) state.doc.markdown = state.doc.markdown.replace(avatarPattern, old => old.replace(/src=["'][^"']*["']/i, `src="${result.path}"`))
    else if (!avatar) state.doc.markdown += `\n\n<img src="${result.path}" style="width:30mm;height:auto">\n`
    else { const firstSection = state.doc.markdown.indexOf('\n## '); state.doc.markdown = firstSection >= 0 ? state.doc.markdown.slice(0, firstSection) + '\n\n' + tag + '\n' + state.doc.markdown.slice(firstSection) : state.doc.markdown + '\n\n' + tag + '\n' }
    switchTab('resume'); changed(); toast('头像已插入，原有图片文件仍保留')
  } catch (e) { toast(e.message, true) }
}
$('avatar-file').onchange = event => uploadPicture(event, true)
$('image-file').onchange = event => uploadPicture(event, false)
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save({ announce: true }).catch(e => toast(e.message, true)) }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b' && document.activeElement === $('editor')) { event.preventDefault(); applySnippet('bold') }
  if (event.key === 'F1') { event.preventDefault(); showHelp() }
})
window.addEventListener('beforeunload', event => { if (dirty()) { writeDraft(); event.preventDefault(); event.returnValue = '' } })
setInterval(async () => {
  if (!state.doc || state.saving || state.switching || state.conflict || document.hidden) return
  try {
    const requestedId = state.doc.id, requestedRevision = state.doc.revision
    const latest = await api(urlFor(requestedId))
    if (state.saving || state.switching || latest.id !== state.doc?.id || requestedRevision !== state.doc.revision) return
    if (latest.revision !== state.doc.revision) {
      if (dirty()) handleConflict({ current: latest })
      else { await loadDocument(latest.id, { discard: true }); toast('已同步外部文件修改') }
    }
    else workflow.updateProof(latest.proof, latest)
    await refreshList()
  } catch (error) { if (error.status === 404) notice('当前简历已被移走，请选择其他简历或检查本地目录。', true) }
}, 8000)

async function boot() {
  $('save-button').disabled = true; $('export-button').disabled = true
  try {
    const setup = await api('/api/bootstrap')
    state.token = setup.token; storageRoot = setup.root; state.documents = setup.documents
    state.iconMetrics = await api('/assets/icons/manifest.json')
    $('meta-status').innerHTML = setup.statuses.map(status => `<option>${escape(status)}</option>`).join('')
    $('status-filter').innerHTML = '<option value="">所有状态</option>' + setup.statuses.map(status => `<option>${escape(status)}</option>`).join('')
    for (const id of ['status-filter', 'follow-filter', 'group-by', 'archive-filter']) { const previous = localStorage.getItem('resume-studio-' + id); if ([...$(id).options].some(option => option.value === previous)) $(id).value = previous }
    $('theme').innerHTML = setup.themes.map(theme => `<option value="${escape(theme)}">${escape(resumeLayouts.find(layout => layout.id === theme)?.name || theme)}</option>`).join('')
    $('autosave').checked = localStorage.getItem('resume-studio-autosave') !== 'false'
    $('visual-autosave').checked = $('autosave').checked
    const active = localStorage.getItem('resume-studio-active:' + storageRoot)
    const id = state.documents.some(doc => doc.id === active) ? active : '_master'
    await loadDocument(id)
    if (setup.browserError) notice('PDF 导出需要本机 Chrome / Edge：' + setup.browserError, true)
    $('save-button').disabled = false; $('export-button').disabled = !!setup.browserError; $('proof-button').disabled = !!setup.browserError
  } catch (error) { notice('连接失败：' + error.message + '。请确认本地服务正在运行，然后刷新页面。', true); saveLabel('连接失败', 'error') }
}
boot()
