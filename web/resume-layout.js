// Public names describe composition; existing IDs stay stable for saved documents.
export const resumeLayouts = [
  { id: 'classic', name: '居中标准', description: '姓名居中，联系方式横排，求职意向另起一行，头像靠右。' },
  { id: 'serif', name: '左对齐标题', description: '姓名与基本信息靠左，放大姓名标题，正文单栏。' },
  { id: 'banner', name: '横向名片', description: '头像与姓名、基本信息组成横向页头，正文通栏排列。' },
]

// Existing documents and history may still refer to retired layouts.
export function resolveResumeLayout(theme = 'classic') {
  return ['sidebar', 'sectioned'].includes(theme) ? 'classic' : theme
}

// Separators only exist in the rendered view; the original line breaks stay in Markdown.
export function decorateContactBreaks(html) {
  return html.replace(/^(\s*(?:<blockquote\b[^>]*>\s*)?)<p\b([^>]*)>([\s\S]*?)<\/p>/i, (_all, prefix, attrs, content) => {
    const projected = content.replace(/((?:\u2003|&emsp;){2,})(?!\s*<br\b)/gi, '<span class="resume-contact-soft-break">$1</span>')
      .replace(/((?:\u2003|&emsp;|\s)*)(<br\b[^>]*>)/gi, (_m, padding, br) => (padding ? '<span class="resume-contact-padding">' + padding + '</span>' : '') + '<span class="resume-contact-separator" aria-hidden="true"></span>' + br)
    return prefix + '<p data-profile-contacts="true"' + attrs + '>' + projected + '</p>'
  })
}

export function htmlBlockKind(html) {
  const source = html.trim()
  if (!source || /^(<!--|<style\b)/i.test(source)) return { kind: 'source' }
  if (/^<h2\b/i.test(source)) return { kind: 'section' }
  if (/^<h1\b/i.test(source)) return { kind: 'name' }
  const avatar = /<img\b[^>]*(?:class=["'][^"']*\bavatar\b|alt=["']avatar["'])/i.test(source)
  const solo = /^<img\b/i.test(source) || /^<p\b[^>]*>\s*<img\b[^>]*>\s*<\/p>$/i.test(source)
  const image = avatar ? source.match(/<img\b[^>]*(?:class=["'][^"']*\bavatar\b[^"']*["']|alt=["']avatar["'])[^>]*>/i)?.[0] : ''
  const imageStyle = image?.match(/style=(["'])(.*?)\1/i)?.[2] || ''
  return { kind: avatar && solo ? 'avatar' : 'content', avatar, photoSize: photoDimensions(imageStyle) }
}

export function photoDimensions(style = '') {
  const dimensions = {}
  for (const key of ['width', 'height', 'top']) {
    const value = style?.match(new RegExp('(?:^|;)\\s*' + key + ':\\s*([+-]?[\\d.]+(?:mm|cm|px|pt))', 'i'))?.[1]
    if (value) dimensions[key] = value
  }
  return dimensions
}

// Presentation attributes never enter the Markdown model. Both render paths use these roles.
export function projectProfile(blocks) {
  let inProfile = true, row = 0, lastInfo = -1, hasAvatar = false, sectionStart = false, photoSize = {}
  const attrs = blocks.map((block, index) => {
    if (block.kind === 'source') return {}
    if (block.kind === 'section') { inProfile = false; sectionStart = true; return { 'data-profile-role': 'section' } }
    if (!inProfile) {
      const result = { 'data-profile-role': 'content' }
      if (sectionStart) { result['data-section-start'] = 'true'; sectionStart = false }
      return result
    }
    if (!hasAvatar && (block.kind === 'avatar' || block.avatar)) photoSize = block.photoSize || {}
    hasAvatar ||= block.kind === 'avatar' || !!block.avatar
    const role = block.kind === 'name' ? 'name' : block.kind === 'avatar' ? 'avatar' : 'info'
    if (role === 'info') lastInfo = index
    const result = { 'data-profile-role': role }
    if (role !== 'avatar') result.style = '--profile-row:' + (++row)
    if (block.avatar && role === 'info') result['data-profile-photo'] = 'nested'
    return result
  })
  if (lastInfo >= 0) attrs[lastInfo]['data-profile-last'] = 'true'
  const sizeStyle = Object.entries(photoSize).map(([key,value])=>'--profile-photo-' + key + ':' + value).join(';')
  return { blocks: attrs, container: { 'data-profile-avatar': String(hasAvatar), style: '--profile-rows:' + Math.max(1, row) + (sizeStyle ? ';' + sizeStyle : '') } }
}
