import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

// 已运行的浏览器或并行验收可能正在读取资源，避免反复覆盖同一批文件。
function copyChanged(source, destination) {
  if (fs.statSync(source).isDirectory()) {
    if (!fs.existsSync(destination)) fs.mkdirSync(destination, { recursive: true })
    for (const name of fs.readdirSync(source)) copyChanged(path.join(source, name), path.join(destination, name))
  } else {
    const data = fs.readFileSync(source)
    if (!fs.existsSync(destination) || !data.equals(fs.readFileSync(destination))) fs.writeFileSync(destination, data)
  }
}

export async function buildWeb(root = path.resolve(import.meta.dirname, '..')) {
  for (const name of ['visual-editor', 'pdf-proof']) {
    const result = await build({ entryPoints: [path.join(root, `web/${name}.js`)], outfile: path.join(root, `web/${name}.bundle.js`), write: false, bundle: true, format: 'esm', platform: 'browser', target: ['chrome110'], minify: true, legalComments: 'eof' })
    for (const output of result.outputFiles) {
      const data = Buffer.from(output.contents)
      if (fs.existsSync(output.path) && data.equals(fs.readFileSync(output.path))) continue
      const temporaryDir = path.join(root, '.local'); fs.mkdirSync(temporaryDir, { recursive: true })
      const temporary = path.join(temporaryDir, `${name}-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`)
      fs.writeFileSync(temporary, data)
      try {
        for (let attempt = 0; ; attempt++) {
          try { fs.renameSync(temporary, output.path); break }
          catch (error) { if (!['EACCES', 'EPERM', 'EBUSY'].includes(error.code) || attempt >= 20) throw error; await new Promise(resolve => setTimeout(resolve, 50)) }
        }
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
    }
  }
  // 使用 URL 转换兼容 Windows 盘符、空格和非 ASCII 路径。
  const distribution = path.dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')))
  copyChanged(path.join(distribution, 'legacy/build/pdf.worker.min.mjs'), path.join(root, 'web/pdf-worker.js'))
  for (const name of ['cmaps', 'standard_fonts', 'wasm']) copyChanged(path.join(distribution, name), path.join(root, 'web/pdf-assets', name))
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.join(import.meta.dirname, 'build-web.mjs')) await buildWeb()
