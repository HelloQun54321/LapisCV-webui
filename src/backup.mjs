import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { localDate } from './store.mjs'

// 备份可重建的工作台和全部持久数据；不复制依赖、缓存、凭据或运行中的锁文件。
export async function buildBackup(root) {
  const zip = new JSZip(), skipped = [], manifest = []
  const excluded = new Set(['node_modules', '.git', '.env', '.idea', 'coverage', '.nyc_output', 'test-results', 'playwright-report', 'chrome', '_render', '_dx'])
  const generated = new Set(['visual-editor.bundle.js', 'pdf-proof.bundle.js', 'pdf-worker.js', 'pdf-assets'])
  const temporary = /^(?:exports|backups|.*-test-.*|test-.*|qa-.*|iteration-test-.*)$/
  const visit = (dir, prefix = '') => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix ? prefix + '/' + item.name : item.name
      if (excluded.has(item.name) || item.name.startsWith('.env.') || item.isSymbolicLink() || /\.(?:log|tmp|lock|swp|swo)$/.test(item.name) || prefix === 'web' && generated.has(item.name) || prefix === '.local' && (temporary.test(item.name) || item.name === 'runtime.json')) { skipped.push(relative); continue }
      const file = path.join(dir, item.name)
      if (item.isDirectory()) visit(file, relative)
      else { const bytes = fs.readFileSync(file); zip.file(relative, bytes, { date: fs.statSync(file).mtime }); manifest.push({ path: relative, bytes: bytes.length }) }
    }
  }
  visit(root)
  const timestamp = Date.now()
  zip.file('BACKUP-INFO.json', JSON.stringify({ format: 1, timestamp, files: manifest, excluded: skipped }, null, 2))
  zip.file('恢复备份说明.txt', '本备份包含工作台源码、简历、JD、投递信息、PDF、素材与字体，以及 .local 中的自动历史、命名版本、投递定稿和回收站。\n\n恢复：解压到一个新的文件夹，安装 Node.js 22 或更新版本和 Chrome / Edge；在该目录执行 npm ci，再双击启动简历工作台.cmd。依赖与前端构建产物会自动重新生成。\n\n不包含 node_modules、Git 提交历史、凭据、服务日志或临时测试与导出文件。浏览器尚未保存的草稿属于原浏览器；生成备份前请先保存所有编辑窗口。\n')
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 3 } })
  return { bytes, filename: `简历工作台备份-${localDate()}-${timestamp}.zip`, files: manifest.length }
}
