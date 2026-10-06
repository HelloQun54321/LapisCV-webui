export const layoutFields = {
  textSize: [6, 24], lineHeight: [1, 3], h1Size: [10, 40], h2Size: [8, 24],
  marginTop: [3, 35], marginBottom: [3, 35], marginLeft: [3, 35], marginRight: [3, 35],
  sectionBefore: [0, 15], sectionAfter: [0, 10], avatarWidth: [10, 50], avatarHeight: [10, 65], cropX: [0, 100], cropY: [0, 100],
  infoSize: [6, 16], infoLineHeight: [1, 2.5], infoColumns: [1, 2], infoGap: [0, 20], nameGap: [0, 12], infoLeft: [-30, 30], infoTop: [-30, 30],
  contactGap: [0, 12],
}
const choices = { nameAlign: ['auto', 'left', 'center', 'right'], infoAlign: ['auto', 'left', 'center', 'right'], avatarSide: ['auto', 'left', 'right'], contactFlow: ['auto', 'inline', 'stacked'] }
const fonts = ['SourceHanSansCN', 'SourceHanSerifCN', 'JetBrainsMono']
const layoutBlock = /<style\b(?=[^>]*\bdata-webui-layout(?:\s|=|>))[^>]*>[\s\S]*?<\/style>\s*/gi
function storedLayout(markdown) {
  const block = markdown.match(/<style\b[^>]*\bdata-webui-layout[^>]*>[\s\S]*?<\/style>/i)?.[0] || ''
  const values = block.match(/data-layout-values="([^"]*)"/)?.[1]
  if (values) { try { return JSON.parse(decodeURIComponent(values)) } catch {} }
  const result = {}, variables = { textSize: 'text-size', lineHeight: 'line-height', h1Size: 'h1-size', h2Size: 'h2-size', textFont: 'text-font', titleFont: 'title-font', accent: 'color-accent' }
  for (const [key, variable] of Object.entries(variables)) { const value = block.match(new RegExp('--' + variable + ':\\s*([^;]+)'))?.[1]?.trim(); if (value) result[key] = ['textFont', 'titleFont', 'accent'].includes(key) ? value : parseFloat(value) }
  const section = block.match(/h2\s*\{([^}]+)\}/)?.[1] || '', avatar = block.match(/\.avatar[^{}]*\{([^}]+)\}/)?.[1] || ''
  for (const [key, css, property] of [['sectionBefore', section, 'margin-top'], ['sectionAfter', section, 'margin-bottom'], ['avatarWidth', avatar, 'width'], ['avatarHeight', avatar, 'height']]) { const value = css.match(new RegExp(property + ':\\s*([\\d.]+)mm'))?.[1]; if (value) result[key] = Number(value) }
  const margins = block.match(/@page\s*\{[^}]*margin:\s*([\d.]+)mm\s+([\d.]+)mm\s+([\d.]+)mm\s+([\d.]+)mm/)
  if (margins) ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'].forEach((key, index) => { result[key] = Number(margins[index + 1]) })
  const crop = avatar.match(/object-position:\s*([\d.]+)%\s+([\d.]+)%/)
  if (crop) { result.cropX = Number(crop[1]); result.cropY = Number(crop[2]) }
  return result
}
export function readLayoutSettings(markdown) { return storedLayout(markdown) }
export function validateLayout(input) {
  const settings = {}
  for (const [key, range] of Object.entries(layoutFields)) if (input[key] != null && input[key] !== '') {
    const value = Number(input[key])
    if (!Number.isFinite(value) || value < range[0] || value > range[1]) throw new Error(`${key} 应在 ${range[0]}–${range[1]} 之间`)
    settings[key] = Math.round(value * 100) / 100
  }
  for (const key of ['textFont', 'titleFont']) if (input[key]) { if (!fonts.includes(input[key])) throw new Error('请选择已配置的字体'); settings[key] = input[key] }
  for (const [key, options] of Object.entries(choices)) if (input[key] != null) { if (!options.includes(input[key])) throw new Error('请选择有效的布局选项'); settings[key] = input[key] }
  if (settings.infoColumns != null && !Number.isInteger(settings.infoColumns)) throw new Error('基本信息分栏只能为 1 或 2')
  if (input.accent) { if (!/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(input.accent)) throw new Error('主题色格式无效'); settings.accent = input.accent }
  return settings
}
export function writeLayout(markdown, input) {
  const s = validateLayout({ ...storedLayout(markdown), ...input })
  const variables = { textSize: ['text-size', 'pt'], lineHeight: ['line-height', ''], h1Size: ['h1-size', 'pt'], h2Size: ['h2-size', 'pt'], textFont: ['text-font', ''], titleFont: ['title-font', ''], accent: ['color-accent', ''] }
  let css = 'body {\n'
  for (const [key, [name, unit]] of Object.entries(variables)) if (s[key] != null) css += `  --${name}: ${s[key]}${unit};\n`
  css += '}\n'
  if (s.contactGap != null) css += `body { --profile-contact-gap: ${s.contactGap}mm; }\n`
  if (s.contactFlow && s.contactFlow !== 'auto') {
    const horizontal = s.contactFlow === 'inline'
    css += `body { --profile-contact-break: ${horizontal ? 'none' : 'block'}; --profile-contact-separator: ${horizontal ? 'inline-block' : 'none'}; --profile-contact-padding: ${horizontal ? 'inline' : 'none'}; --profile-contact-soft-break: ${horizontal ? 'inline-block' : 'block'}; }\n`
  }
  if (s.contactGap != null) css += `body { --profile-contact-padding: none; --profile-contact-padded-separator-width: ${s.contactGap}mm; --profile-contact-soft-space-size: 0px; --profile-contact-soft-space-width: ${s.contactGap}mm; }\n`
  if (s.nameAlign && s.nameAlign !== 'auto') css += `body { --profile-name-align: ${s.nameAlign}; }\n[data-profile-role="name"] { text-align: ${s.nameAlign} !important; }\n`
  if (s.infoAlign && s.infoAlign !== 'auto') css += `body { --profile-info-align: ${s.infoAlign}; --profile-info-center-correction: ${s.infoAlign === 'center' ? 1 : 0}; }\n[data-profile-role="info"], [data-profile-role="info"] p { text-align: ${s.infoAlign} !important; }\n`
  if (s.infoSize != null) css += `body { --blockquote-size: ${s.infoSize}pt; }\n[data-profile-role="info"] :is(p,li,code,span,strong,a) { font-size: ${s.infoSize}pt !important; }\n`
  if (s.infoLineHeight != null) css += `[data-profile-role="info"], [data-profile-role="info"] :is(p,li,code,span,strong,a) { line-height: ${s.infoLineHeight} !important; }\n`
  if (s.infoColumns != null) css += `body { --profile-info-columns: ${s.infoColumns}; }\n`
  if (s.nameGap != null) css += `body { --profile-name-gap: ${s.nameGap}mm; }\n[data-profile-role="name"] { margin-bottom: ${s.nameGap}mm !important; }\n`
  if (s.infoGap != null) css += `[data-profile-role="info"][data-profile-last] { margin-bottom: ${s.infoGap}mm !important; }\n`
  if (s.infoLeft != null || s.infoTop != null) css += '[data-profile-role="info"] { position: relative; ' + (s.infoLeft != null ? `left: ${s.infoLeft}mm; ` : '') + (s.infoTop != null ? `top: ${s.infoTop}mm; ` : '') + '}\n'
  if (s.avatarSide && s.avatarSide !== 'auto') {
    const left = s.avatarSide === 'left'
    css += `body { --profile-avatar-side: ${s.avatarSide}; --profile-photo-column: ${left ? 1 : 2}; --profile-text-column: ${left ? 2 : 1}; --profile-grid-columns: ${left ? 'var(--avatar-width) minmax(0,1fr)' : 'minmax(0,1fr) var(--avatar-width)'}; }\n`
    css += `body { --profile-contact-photo-left-factor: ${left ? 1 : 0}; --profile-contact-photo-right-factor: ${left ? 0 : 1}; }\n`
    css += `.avatar, img[alt="avatar"] { float: ${s.avatarSide}; }\n`
    css += `[data-profile-role="info"] :is(img.avatar, img[alt="avatar"]) { margin-left: ${left ? '0' : 'auto'} !important; margin-right: ${left ? 'auto' : '0'} !important; }\n`
    css += `[data-profile-role="avatar"]:is(img), [data-profile-role="avatar"] img.avatar { justify-self: ${left ? 'start' : 'end'}; }\n`
  }
  if (s.sectionBefore != null) css += `body { --profile-section-before: ${s.sectionBefore}mm; }\n`
  if (s.sectionBefore != null || s.sectionAfter != null) css += 'h2, [data-profile-role="section"] { ' + (s.sectionBefore != null ? `margin-top: ${s.sectionBefore}mm !important; ` : '') + (s.sectionAfter != null ? `margin-bottom: ${s.sectionAfter}mm !important; ` : '') + '}\n'
  if (['marginTop', 'marginBottom', 'marginLeft', 'marginRight'].every(key => s[key] != null)) {
    css += `@page { size: A4; margin: ${s.marginTop}mm ${s.marginRight}mm ${s.marginBottom}mm ${s.marginLeft}mm; }\n`
    css += `@media screen { .page { padding: ${s.marginTop}mm ${s.marginRight}mm ${s.marginBottom}mm ${s.marginLeft}mm; } }\n`
  }
  if (s.avatarWidth != null || s.avatarHeight != null || s.cropX != null || s.cropY != null) {
    css += '.avatar, img[alt="avatar"] { ' + (s.avatarWidth != null ? `width: ${s.avatarWidth}mm !important; ` : '') + (s.avatarHeight != null ? `height: ${s.avatarHeight}mm !important; ` : '') + (s.cropX != null && s.cropY != null ? `object-position: ${s.cropX}% ${s.cropY}% !important; ` : '') + '}\n'
  }
  const block = `<style data-webui-layout data-layout-values="${encodeURIComponent(JSON.stringify(s))}">\n${css}</style>\n\n`
  if (layoutBlock.test(markdown)) { layoutBlock.lastIndex = 0; let used = false; return markdown.replace(layoutBlock, () => { if (used) return ''; used = true; return block }) }
  layoutBlock.lastIndex = 0
  const ends = [...markdown.matchAll(/<\/style>/gi)]
  const position = ends.length ? ends.at(-1).index + ends.at(-1)[0].length : 0
  return markdown.slice(0, position) + (position ? '\n\n' : '') + block + markdown.slice(position)
}
export function removeLayout(markdown) { layoutBlock.lastIndex = 0; return markdown.replace(layoutBlock, '') }
