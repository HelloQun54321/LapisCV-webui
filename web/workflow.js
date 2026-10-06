import { lineDiff, readableResume } from './diff.js'
import { icon } from './icons.js'

const $ = id => document.getElementById(id)
const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const sourceKey = doc => JSON.stringify([doc.markdown, doc.theme])
const formatTime = value => new Date(value).toLocaleString('zh-CN', { hour12: false })
const metaLabels = { company: '公司', title: '岗位', status: '状态', created: '创建日期', sent: '投递日期', followUp: '下次跟进', notes: '备注' }

export function createWorkflow({ state, api, save, modal, closeModal, toast, escape, refreshList, loadDocument, switchTab, changed, triggerDownload, clearDraft, resizePaper, dirty, handleConflict }) {
  const urlFor = id => '/api/documents/' + encodeURIComponent(id)
  let proofSource = null, lastContext = '', loadedId = ''
  let backupBusy = false, finalBusy = false
  const storage = (key, fallback) => { try { return localStorage.getItem('resume-studio-' + key) ?? fallback } catch { return fallback } }
  const remember = (key, value) => { try { localStorage.setItem('resume-studio-' + key, value) } catch {} }

  function proofStatus() {
    const report = state.doc?.proof
    const current = report?.current && proofSource === sourceKey(state.doc)
    $('proof-summary').hidden = !report
    $('proof-summary').textContent = report ? `${report.pages} 页${current ? '' : ' · 需更新'}` : ''
    $('proof-summary').classList.toggle('stale', !!report && !current)
    $('proof-summary').title = report ? `${formatTime(report.timestamp)} 校样 · ${current ? '校样有效' : '需要更新校样'} · 版本 ${report.revision.slice(0, 8)}${current ? '' : '；内容、主题或素材已有变化'}` : ''
  }
  function rememberProof(report, source) {
    if (!state.doc || !report) return
    state.doc.proof = report
    proofSource = source
    proofStatus()
  }
  function updateProof(report, savedDocument) {
    if (!state.doc) return
    // 其他窗口校样的是磁盘版本，不能把本窗口尚未保存的草稿标为已校样。
    if (report?.current) proofSource = sourceKey(savedDocument)
    else if (report?.timestamp !== state.doc.proof?.timestamp) proofSource = null
    state.doc.proof = report
    proofStatus()
  }
  function onLoaded() {
    proofSource = state.doc.proof?.current ? sourceKey(state.doc) : null
    if (loadedId !== state.doc.id) { document.body.classList.remove('jd-reference'); loadedId = state.doc.id }
    $('jd-reference-editor').value = state.doc.jd
    lastContext = ''
    proofStatus(); onModeChange()
  }
  function onModeChange() {
    $('jd-reference-toggle').hidden = !state.doc || state.doc.master || state.tab !== 'resume'
    $('jd-reference-toggle').setAttribute('aria-pressed', String(document.body.classList.contains('jd-reference')))
    $('properties-toggle').setAttribute('aria-expanded', String(innerWidth <= 1030 ? document.body.classList.contains('properties-open') : !document.body.classList.contains('properties-hidden')))
  }
  function toggleJd() {
    if (!state.doc || state.doc.master) return
    if (state.mode !== 'visual' || state.tab !== 'resume') { state.mode = 'visual'; remember('editor-mode', 'visual'); switchTab('resume') }
    document.body.classList.toggle('jd-reference')
    $('jd-reference-editor').value = state.doc.jd
    onModeChange(); requestAnimationFrame(resizePaper)
  }
  $('jd-reference-toggle').onclick = toggleJd
  $('jd-reference-close').onclick = () => { document.body.classList.remove('jd-reference'); onModeChange(); requestAnimationFrame(resizePaper) }
  $('jd-reference-editor').oninput = () => { state.doc.jd = $('jd-reference-editor').value; changed({ preview: false }) }

  function setPanel(open) {
    document.body.classList.toggle('properties-hidden', !open)
    document.body.classList.toggle('properties-open', open && innerWidth <= 1030)
    if (open) document.body.classList.remove('jd-reference')
    remember('properties-open', String(open)); onModeChange(); requestAnimationFrame(resizePaper)
  }
  document.body.classList.toggle('properties-hidden', storage('properties-open', 'false') !== 'true')
  if (innerWidth <= 1030 && storage('properties-open', 'false') === 'true') document.body.classList.add('properties-open')
  document.querySelectorAll('.property-content details').forEach((section, index) => {
    const key = 'property-section-' + index
    section.open = storage(key, index === 8 ? 'true' : 'false') === 'true'
    section.addEventListener('toggle', () => remember(key, String(section.open)))
  })
  function updateContext(editor) {
    if (!editor.mounted || editor.loading || editor.documentId !== state.doc?.id) return
    const selection = editor.editor?.state.selection
    if (!selection) return
    const name = selection.node?.type.name
    let section = null, text = selection.empty ? '当前段落' : '选中文字'
    if (name === 'resumeAvatar') { section = 'avatar-settings'; text = '当前头像' }
    else if (name === 'resumeImage') { section = 'image-settings'; text = '当前图片' }
    else if (name === 'resumeDivider') { section = 'rule-settings'; text = '装饰横线' }
    else if (editor.tableTarget()) { section = 'table-settings'; text = '当前表格' }
    $('property-context').textContent = text
    document.querySelectorAll('.property-content details').forEach(el => el.classList.toggle('context-active', el.id === section))
    // 重新挂载会保留选区；只有用户正在纸面操作时才自动展开对象设置。
    if (editor.editor.isFocused) {
      if (section && section !== lastContext) { setPanel(true); $(section).open = true; $(section).scrollIntoView({ block: 'nearest' }) }
      lastContext = section || ''
    }
  }

  function diffHtml(before, after) {
    const rows = lineDiff(before, after), adds = rows.filter(row => row.type === 'add').length, removes = rows.filter(row => row.type === 'remove').length
    if (!adds && !removes) return '<p class="comparison-empty">两份内容相同。</p>'
    // 只显示变化及相邻上下文；大文件可从历史／定稿查看完整源码。
    const visible = rows.filter((row, index) => row.type !== 'same' || rows.slice(Math.max(0, index - 2), index + 3).some(next => next.type !== 'same'))
    return `<p class="diff-count">新增 ${adds} 行 · 删除 ${removes} 行</p><div class="diff-lines" title="左行号：参考版本；右行号：当前编辑">${visible.slice(0, 1200).map(row => `<div class="diff-line ${row.type}"><small>${row.oldLine ?? ''}</small><small>${row.newLine ?? ''}</small><b>${row.type === 'add' ? '+' : row.type === 'remove' ? '−' : ' '}</b><span>${escape(row.text) || '&nbsp;'}</span></div>`).join('')}</div>${visible.length > 1200 ? '<p class="property-hint">仅显示前 1200 行。</p>' : ''}`
  }
  function compare(reference, title, { back, restore } = {}) {
    const current = JSON.parse(JSON.stringify(state.doc))
    const metadata = Object.entries(metaLabels).filter(([key]) => (reference.meta?.[key] || '') !== (current.meta?.[key] || '')).map(([key, label]) => `<tr><th>${label}</th><td>${escape(reference.meta?.[key] || '—')}</td><td>${escape(current.meta?.[key] || '—')}</td></tr>`).join('')
    modal(title, `<div class="diff-legend"><span class="reference">− 参考版本</span><span class="current">＋ 当前编辑</span><small>含未保存编辑</small></div><div class="comparison-controls"><label>比较视图<select id="comparison-mode"><option value="text">简历正文</option><option value="source">完整 Markdown／HTML 源码</option></select></label></div><div id="comparison-content"></div><details class="comparison-extra"><summary>JD 差异</summary>${diffHtml(reference.jd || '', current.jd || '')}</details><details class="comparison-extra"><summary>主题与投递信息</summary><table class="comparison-meta"><thead><tr><th>项目</th><th>参考版本</th><th>当前编辑</th></tr></thead><tbody>${reference.theme !== current.theme ? `<tr><th>主题</th><td>${escape(reference.theme)}</td><td>${escape(current.theme)}</td></tr>` : ''}${metadata || '<tr><td colspan="3">投递信息相同。</td></tr>'}</tbody></table></details><div class="modal-actions">${back ? '<button id="comparison-back" class="secondary-button">返回列表</button>' : ''}${restore ? '<button id="comparison-restore" class="primary-button">恢复参考版本…</button>' : ''}</div>`)
    $('modal').classList.add('wide-modal')
    const render = () => { const plain = $('comparison-mode').value === 'text'; $('comparison-content').innerHTML = diffHtml(plain ? readableResume(reference.markdown) : reference.markdown, plain ? readableResume(current.markdown) : current.markdown) }
    $('comparison-mode').onchange = render; render()
    if (back) $('comparison-back').onclick = back
    if (restore) $('comparison-restore').onclick = restore
  }
  async function compareMaster() {
    if (!state.doc || state.doc.master) return
    const id = state.doc.id
    try { const master = await api(urlFor('_master')); if (state.doc?.id === id) compare(master, '与当前母版比较') } catch (error) { toast(error.message, true) }
  }
  async function renameVersion(version, initial = '') {
    modal('命名并保留版本', `<form id="version-name-form" class="modal-form"><p>命名后长期保留；清空名称取消保留。</p><label>版本名称<input id="version-name" maxlength="80" value="${escape(initial)}" placeholder="例如：产品运营初稿"></label><div class="modal-actions"><button class="primary-button">保存名称</button></div></form>`)
    $('version-name-form').onsubmit = async event => { event.preventDefault(); try { await api(urlFor(state.doc.id) + '/history/' + version, { method: 'PATCH', body: JSON.stringify({ label: $('version-name').value }) }); await showHistory() } catch (error) { toast(error.message, true) } }
  }
  function checkpoint() {
    modal('保留当前关键版本', '<form id="checkpoint-form" class="modal-form"><label>版本名称<input id="checkpoint-name" maxlength="80" required placeholder="例如：面试前调整完成"></label><div class="modal-actions"><button class="primary-button">保存关键版本</button></div></form>')
    $('checkpoint-form').onsubmit = async event => {
      event.preventDefault(); const label = $('checkpoint-name').value, button = event.submitter; button.disabled = true
      try { await save(); while (dirty()) await save(); await api(urlFor(state.doc.id) + '/history', { method: 'POST', body: JSON.stringify({ revision: state.doc.revision, label }) }); await showHistory(); toast('关键版本已长期保留') } catch (error) { toast(error.message, true); button.disabled = false }
    }
  }
  function restoreVersion(version) {
    modal('恢复这个历史版本？', '<p class="modal-note">恢复简历、JD、主题和投递信息，当前内容会先备份。</p><div class="modal-actions"><button id="restore-cancel" class="secondary-button">取消</button><button id="restore-confirm" class="primary-button">确认恢复</button></div>')
    $('restore-cancel').onclick = showHistory
    $('restore-confirm').onclick = async () => {
      try { await save(); const doc = await api(urlFor(state.doc.id) + '/restore', { method: 'POST', body: JSON.stringify({ version, revision: state.doc.revision }) }); clearDraft(doc.id); closeModal(); await loadDocument(doc.id, { discard: true }); await refreshList(); toast('历史版本已恢复') } catch (error) { if (error.status === 409) handleConflict(error); toast(error.message, true) }
    }
  }
  async function showHistory() {
    if (!state.doc) return
    if (state.conflict) return handleConflict({})
    try {
      const id = state.doc.id, history = await api(urlFor(id) + '/history')
      if (state.doc.id !== id) return
      modal('历史版本', `<div class="history-intro"><p class="modal-note">自动历史 40 次 · 命名版本长期保留</p><button id="history-checkpoint" class="secondary-button">${icon('plus')} 保留当前版本</button></div>${history.length ? history.map(h => `<div class="history-row"><div><strong>${escape(h.label || formatTime(h.timestamp))}${h.pinned ? '<span class="version-badge">长期保留</span>' : ''}</strong><small>${h.label ? formatTime(h.timestamp) + ' · ' : ''}${escape(h.reason)}</small></div><div class="history-actions"><button data-name="${h.version}">命名</button><button data-view="${h.version}">查看</button><button data-compare="${h.version}">比较</button><button data-restore="${h.version}">恢复…</button></div></div>`).join('') : '<div class="empty-state">尚无历史版本</div>'}`)
      $('modal').classList.add('history-modal')
      $('history-checkpoint').onclick = checkpoint
      document.querySelectorAll('[data-name]').forEach(button => { button.onclick = () => renameVersion(button.dataset.name, history.find(h => h.version === button.dataset.name).label) })
      document.querySelectorAll('[data-view]').forEach(button => { button.onclick = async () => {
        try { const old = await api(urlFor(id) + '/history/' + button.dataset.view); modal('查看历史内容', `<p class="modal-note">${escape(old.label || '')} · ${formatTime(old.timestamp)}</p><textarea class="version-source" readonly aria-label="历史 Markdown">${escape(old.markdown)}</textarea><div class="modal-actions"><button id="history-back" class="secondary-button">返回列表</button><button id="history-download" class="primary-button">下载源码</button></div>`); $('history-back').onclick = showHistory; $('history-download').onclick = async () => { const result = await api('/api/downloads', { method: 'POST', body: JSON.stringify({ text: old.markdown, filename: id + '-历史.md' }) }); triggerDownload(result.url, result.filename) } } catch (error) { toast(error.message, true) }
      } })
      document.querySelectorAll('[data-compare]').forEach(button => { button.onclick = async () => { try { const old = await api(urlFor(id) + '/history/' + button.dataset.compare); compare(old, '历史版本与当前编辑比较', { back: showHistory, restore: () => restoreVersion(button.dataset.compare) }) } catch (error) { toast(error.message, true) } } })
      document.querySelectorAll('[data-restore]').forEach(button => { button.onclick = async () => { try { const old = await api(urlFor(id) + '/history/' + button.dataset.restore); compare(old, '恢复前比较', { back: showHistory, restore: () => restoreVersion(button.dataset.restore) }) } catch (error) { toast(error.message, true) } } })
    } catch (error) { toast(error.message, true) }
  }
  function createFinal() {
    if (!state.doc || state.doc.master || finalBusy) return
    modal('保存投递定稿', `<form id="final-form" class="modal-form"><p>长期留存当前 PDF 和内容快照。</p><label>定稿名称<input id="final-name" maxlength="80" required value="${escape((state.doc.meta.title || '投递') + '定稿')}"></label><label>定稿日期<input id="final-date" type="date" required value="${escape(state.doc.meta.sent || localDate())}"></label><p class="modal-note">留档不改变投递状态。</p><div class="modal-actions"><button id="final-submit" class="primary-button">生成 PDF 并留档</button></div></form>`)
    $('final-form').onsubmit = async event => {
      event.preventDefault(); const label = $('final-name').value, date = $('final-date').value, id = state.doc.id
      finalBusy = true; event.submitter.disabled = true; event.submitter.textContent = '正在生成定稿…'
      try { await save(); while (dirty()) await save(); if (state.doc.id !== id) throw new Error('当前简历已切换，请重新保存定稿'); const source = sourceKey(state.doc); await api(urlFor(id) + '/finals', { method: 'POST', body: JSON.stringify({ revision: state.doc.revision, label, date }) }); if (state.doc.id === id) { const proof = await api(urlFor(id) + '/proof'); rememberProof(proof, source); await showFinals() } toast('投递定稿已长期留档') }
      catch (error) { toast(error.message, true); const button = $('final-submit'); if (button) { button.disabled = false; button.textContent = '重试生成定稿' } }
      finally { finalBusy = false }
    }
  }
  async function showFinals() {
    if (!state.doc || state.doc.master) return
    try {
      const id = state.doc.id, records = await api(urlFor(id) + '/finals')
      if (state.doc.id !== id) return
      modal('投递定稿档案', `<div class="history-intro"><p class="modal-note">定稿长期保留</p><button id="final-new" class="secondary-button">${icon('plus')} 保存当前定稿</button></div>${records.length ? records.map(record => `<div class="history-row"><div><strong>${escape(record.label)}</strong><small title="版本 ${record.revision.slice(0, 8)}">${record.date} · ${record.pages} 页</small></div><div class="history-actions"><button data-final-view="${record.version}">查看快照</button><button data-final-compare="${record.version}">比较</button><button data-final-download="${record.version}">下载 PDF</button></div></div>`).join('') : '<div class="empty-state">尚无定稿</div>'}`)
      $('modal').classList.add('history-modal'); $('final-new').onclick = createFinal
      document.querySelectorAll('[data-final-download]').forEach(button => { button.onclick = async () => { try { const result = await api(urlFor(id) + '/finals/' + button.dataset.finalDownload, { method: 'POST', body: '{}' }); triggerDownload(result.url, result.filename) } catch (error) { toast(error.message, true) } } })
      document.querySelectorAll('[data-final-compare]').forEach(button => { button.onclick = async () => { try { const record = await api(urlFor(id) + '/finals/' + button.dataset.finalCompare); compare(record, '投递定稿与当前编辑比较', { back: showFinals }) } catch (error) { toast(error.message, true) } } })
      document.querySelectorAll('[data-final-view]').forEach(button => { button.onclick = async () => {
        try { const record = await api(urlFor(id) + '/finals/' + button.dataset.finalView); modal('定稿内容快照', `<p class="modal-note">${escape(record.label)} · ${record.date} · ${record.pages} 页</p><details class="comparison-extra"><summary>文件信息</summary><p class="property-hint">版本 ${record.revision.slice(0, 8)} · PDF 校验摘要 ${record.pdfHash.slice(0, 16)}</p></details><details open><summary>简历 Markdown</summary><textarea class="version-source" readonly>${escape(record.markdown)}</textarea></details><details><summary>当时的 JD</summary><pre class="snapshot-jd">${escape(record.jd || '未填写 JD')}</pre></details><dl class="snapshot-meta">${Object.entries(metaLabels).map(([key, label]) => `<dt>${label}</dt><dd>${escape(record.meta[key] || '—')}</dd>`).join('')}<dt>主题</dt><dd>${escape(record.theme)}</dd></dl><div class="modal-actions"><button id="final-back" class="secondary-button">返回档案</button></div>`); $('final-back').onclick = showFinals } catch (error) { toast(error.message, true) }
      } })
    } catch (error) { toast(error.message, true) }
  }
  function backup() {
    if (backupBusy) return
    modal('完整备份工作台', '<p class="modal-note">包含源码、简历、PDF、素材、历史、定稿及回收站。</p><p class="property-hint">请先保存其他窗口中的编辑。</p><details class="comparison-extra"><summary>备份范围与恢复</summary><p class="property-hint">包括 JD、投递信息、字体、自动历史与命名版本。Git 提交历史、凭据、依赖、临时文件及未保存草稿不在包内。解压后按随包恢复说明启动。</p></details><div class="modal-actions"><button id="backup-start" class="primary-button">生成并下载 ZIP</button></div>')
    $('backup-start').onclick = async () => {
      backupBusy = true; const button = $('backup-start'); button.disabled = true; button.textContent = '正在打包…'
      try { await save(); while (dirty()) await save(); const result = await api('/api/backup', { method: 'POST', body: '{}' }); triggerDownload(result.url, result.filename); closeModal(); toast(`备份已下载 · ${result.files} 个文件`) }
      catch (error) { toast(error.message, true); button.disabled = false; button.textContent = '重试生成备份' }
      finally { backupBusy = false }
    }
  }
  return { onLoaded, onModeChange, proofStatus, rememberProof, updateProof, updateContext, setPanel, toggleJd, showHistory, checkpoint, compareMaster, createFinal, showFinals, backup, sourceKey }
}

export function filterDocuments(documents, { search = '', status = '', follow = '', group = '', archive = 'active' } = {}) {
  const today = localDate(), nextWeek = new Date(); nextWeek.setDate(nextWeek.getDate() + 7)
  const upcoming = localDate(nextWeek), query = search.trim().toLowerCase()
  const due = doc => !doc.master && !doc.archived && !['已拒', '已关闭'].includes(doc.meta.status) && !!doc.meta.followUp && doc.meta.followUp <= today
  const filtered = documents.filter(doc => {
    const matches = (doc.master ? '母版简历完整经历' : doc.id + doc.meta.company + doc.meta.title + doc.meta.status + doc.meta.notes).toLowerCase().includes(query)
    if (!matches) return false
    if (doc.master) return true
    if (archive === 'active' && doc.archived || archive === 'archived' && !doc.archived) return false
    if (status && doc.meta.status !== status) return false
    if (follow === 'due' && !due(doc)) return false
    if (follow === 'week' && (doc.archived || !doc.meta.followUp || doc.meta.followUp < today || doc.meta.followUp > upcoming || ['已拒', '已关闭'].includes(doc.meta.status))) return false
    return true
  })
  const groups = new Map()
  for (const doc of filtered) {
    const key = doc.master ? '母版' : doc.archived && archive === 'all' ? '已归档' : group === 'company' ? doc.meta.company || '未填写公司' : group === 'status' ? doc.meta.status : doc.archived ? '已归档' : '投递版本'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(doc)
  }
  return { groups, filtered, due: documents.filter(due).length, isDue: due }
}
