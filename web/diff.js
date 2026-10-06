// 有界的逐行比较。大文件保留精确增删内容，避免巨大的二维矩阵阻塞浏览器。
export function lineDiff(before, after) {
  const a = before.replace(/\r\n?/g, '\n').split('\n'), b = after.replace(/\r\n?/g, '\n').split('\n')
  let prefix = 0, suffix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - suffix - 1] === b[b.length - suffix - 1]) suffix++
  const left = a.slice(prefix, a.length - suffix), right = b.slice(prefix, b.length - suffix), rows = []
  let oldLine = 1, newLine = 1
  const push = (type, text) => rows.push({ type, text, oldLine: type === 'add' ? null : oldLine++, newLine: type === 'remove' ? null : newLine++ })
  for (let i = 0; i < prefix; i++) push('same', a[i])
  if (left.length && right.length && left.length * right.length <= 1000000) {
    const dp = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1))
    for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) dp[i][j] = left[i] === right[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    let i = 0, j = 0
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) { push('same', left[i++]); j++ }
      else if (i < left.length && (j === right.length || dp[i + 1][j] >= dp[i][j + 1])) push('remove', left[i++])
      else push('add', right[j++])
    }
  } else { left.forEach(text => push('remove', text)); right.forEach(text => push('add', text)) }
  for (let i = a.length - suffix; i < a.length; i++) push('same', a[i])
  return rows
}

export function readableResume(markdown) {
  const text = markdown.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\[\[e[0-9a-f]{3}\]\]/gi, '')
    .replace(/<br\s*\/?\s*>|<\/(?:h[1-6]|p|div|li|blockquote|tr)>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/^\s*\[[^\]]+\]:.*$/gm, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/^#{1,6}\s+/gm, '').replace(/[*_`]/g, '')
  // 只解码文本实体；该文档不会插入到页面中。
  return new DOMParser().parseFromString(text, 'text/html').body.textContent.split('\n').map(line => line.trim()).filter(Boolean).join('\n')
}
