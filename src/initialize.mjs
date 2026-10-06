import fs from 'node:fs'
import path from 'node:path'

// 公共示例与个人工作数据分开：首次使用时复制，已有数据永不覆盖。
export function initializeWorkspace(root = path.resolve(import.meta.dirname, '..')) {
  root = path.resolve(root)
  const created = []
  for (const [source, target, required] of [
    ['examples/resume.md', 'resumes/_master/resume.md', true],
    ['examples/template.md', 'resumes/_template.md', false],
  ]) {
    const destination = path.join(root, target)
    if (fs.existsSync(destination)) continue
    const example = path.join(root, source)
    if (!fs.existsSync(example)) {
      if (required) throw new Error('缺少母版和 examples/resume.md，请恢复示例文件后重试')
      continue
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    try {
      fs.copyFileSync(example, destination, fs.constants.COPYFILE_EXCL)
      created.push(target)
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
  }
  return created
}
