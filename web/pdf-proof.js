import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'

GlobalWorkerOptions.workerSrc = '/pdf-worker.js'

// 校样来自导出文件，分页交给打印引擎；画布只负责显示，不参与简历保存。
export class PdfProof {
  constructor({ container, scrollRoot, onPage, onError, theme = 'light' }) {
    this.container = container
    this.scrollRoot = scrollRoot
    this.onPage = onPage
    this.onError = onError
    this.zoom = 1
    this.tasks = new Set()
    this.abort = new AbortController()
    this.closed = false
    this.theme = theme
    this.originals = new Map()
  }
  async open(url) {
    const response = await fetch(url, { signal: this.abort.signal })
    if (!response.ok) throw new Error('PDF 校样链接已失效，请重新生成')
    const data = new Uint8Array(await response.arrayBuffer())
    if (this.closed) return
    this.loading = getDocument({ data, isEvalSupported: false, useSystemFonts: false, cMapUrl: '/pdf-assets/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdf-assets/standard_fonts/', wasmUrl: '/pdf-assets/wasm/' })
    this.pdf = await this.loading.promise
    if (this.closed) return
    this.container.replaceChildren()
    this.sheets = []
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) this.render(Number(entry.target.dataset.page)).catch(error => { if (!this.closed) this.onError?.(error) })
    }, { root: this.scrollRoot, rootMargin: '400px 0px' })
    this.trackPage = () => {
      const top = this.scrollRoot.getBoundingClientRect().top + 24
      let current = 1
      for (const sheet of this.sheets) { if (sheet.getBoundingClientRect().top <= top) current = Number(sheet.dataset.page); else break }
      this.onPage?.(current, this.pdf.numPages)
    }
    this.scrollRoot.addEventListener('scroll', this.trackPage, { passive: true })
    for (let number = 1; number <= this.pdf.numPages; number++) {
      const sheet = document.createElement('article')
      sheet.className = 'pdf-proof-page'
      sheet.dataset.page = number
      sheet.innerHTML = `<div class="pdf-proof-sheet"><span class="pdf-page-loading">正在显示第 ${number} 页…</span><canvas role="img" aria-label="PDF 校样第 ${number} 页"></canvas></div><div class="pdf-page-label">第 ${number} 页 / 共 ${this.pdf.numPages} 页</div>`
      this.container.append(sheet)
      this.sheets.push(sheet)
      this.observer.observe(sheet)
    }
    this.setZoom(this.zoom)
    await this.render(1)
    this.trackPage()
    return this.pdf.numPages
  }
  setZoom(zoom) {
    this.zoom = zoom
    for (const sheet of this.sheets || []) {
      const width = Number(sheet.dataset.width || 794), height = Number(sheet.dataset.height || 1123)
      sheet.style.width = width * zoom + 'px'
      sheet.firstChild.style.height = height * zoom + 'px'
    }
  }
  setReadingTheme(theme) {
    this.theme = theme
    for (const sheet of this.sheets || []) this.paint(sheet)
  }
  paint(sheet) {
    const canvas = sheet.querySelector('canvas'), original = this.originals.get(Number(sheet.dataset.page))
    if (!original) return
    const context = canvas.getContext('2d')
    context.drawImage(original.canvas, 0, 0)
    if (this.theme !== 'dark') return
    if (!original.night) {
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
      const data = pixels.data
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2]
        const ink = Math.pow(1 - (r * .2126 + g * .7152 + b * .0722) / 255, .65)
        const target = b > r + 24 && b > g + 8 ? [106, 184, 247] : [231, 233, 234]
        data[i] = Math.round(16 + (target[0] - 16) * ink)
        data[i + 1] = Math.round(18 + (target[1] - 18) * ink)
        data[i + 2] = Math.round(20 + (target[2] - 20) * ink)
      }
      original.night = pixels
    }
    context.putImageData(original.night, 0, 0)
    // Keep photos and other large raster pictures in their original colors.
    const coords = original.images
    for (let i = 0; i < coords.length; i += 6) {
      const x1 = coords[i] * canvas.width, y1 = coords[i + 1] * canvas.height
      const x2 = coords[i + 2] * canvas.width, y2 = coords[i + 3] * canvas.height
      const x3 = coords[i + 4] * canvas.width, y3 = coords[i + 5] * canvas.height
      if (Math.hypot(x2 - x1, y2 - y1) / original.ratio < 32 || Math.hypot(x3 - x1, y3 - y1) / original.ratio < 32) continue
      context.save(); context.beginPath()
      context.moveTo(x1, y1); context.lineTo(x2, y2); context.lineTo(x2 + x3 - x1, y2 + y3 - y1); context.lineTo(x3, y3); context.closePath()
      context.clip(); context.drawImage(original.canvas, 0, 0); context.restore()
    }
  }
  goToPage(number) {
    const sheet = this.sheets?.[Math.max(1, Math.min(this.pdf.numPages, Number(number) || 1)) - 1]
    if (sheet) this.scrollRoot.scrollTop += sheet.getBoundingClientRect().top - this.scrollRoot.getBoundingClientRect().top - 20
    this.trackPage?.()
  }
  async render(number) {
    const sheet = this.sheets[number - 1]
    if (this.closed || sheet.dataset.rendering) return
    sheet.dataset.rendering = 'true'
    const page = await this.pdf.getPage(number)
    if (this.closed) return
    const viewport = page.getViewport({ scale: 96 / 72 })
    const canvas = sheet.querySelector('canvas'), ratio = Math.min(2, window.devicePixelRatio || 1.5)
    sheet.dataset.width = viewport.width
    sheet.dataset.height = viewport.height
    this.setZoom(this.zoom)
    canvas.width = Math.ceil(viewport.width * ratio)
    canvas.height = Math.ceil(viewport.height * ratio)
    const task = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport, transform: [ratio, 0, 0, ratio, 0, 0], recordImages: true })
    this.tasks.add(task)
    try {
      await task.promise
      if (!this.closed) {
        const original = document.createElement('canvas'); original.width = canvas.width; original.height = canvas.height
        original.getContext('2d').drawImage(canvas, 0, 0)
        this.originals.set(number, { canvas: original, images: Array.from(page.imageCoordinates || task.imageCoordinates || []), ratio })
        this.paint(sheet)
        sheet.querySelector('.pdf-page-loading').remove(); sheet.dataset.ready = 'true'; this.observer.unobserve(sheet); page.cleanup()
      }
    } catch (error) { if (!this.closed) throw error }
    finally { this.tasks.delete(task) }
  }
  destroy() {
    this.closed = true
    this.abort.abort()
    this.observer?.disconnect()
    if (this.trackPage) this.scrollRoot.removeEventListener('scroll', this.trackPage)
    for (const task of this.tasks) task.cancel()
    this.loading?.destroy().catch(() => {})
    this.originals.clear()
    this.container.replaceChildren()
  }
}
