// 浏览器定位与启动:build / preview / assets-gen 三个脚本共用。
//
// 为什么单独抽一个模块:这套脚本要在三种环境下跑,而"浏览器在哪、路径怎么写"完全不同 ——
//   ① Linux / macOS 原生浏览器(含 @puppeteer/browsers 下到 ~/.cache 的那个)
//   ② WSL 里调用 Windows 上装的浏览器(**跨 VM**,路径、user-data-dir 全要转成 Windows 形式)
//   ③ Windows 上直接用(脚本看到的路径本身就是 C:\...)
// 散在三个脚本里各写一份,必然写歪 —— 之前就是这个状况:
// preview.mjs 抄了一份只有 Windows 路径的 findBrowser,assets-gen.mjs 干脆把
// 'C:/Program Files/...' 硬编码进去,结果换到 WSL 全军覆没。
//
// **WSL 用户建议装一个 Linux 版 Chrome**,一条命令:
//     npx @puppeteer/browsers install chrome@stable
// 装完三个脚本都能原生跑,不需要任何跨 VM 的绕法(第 ② 种情况只剩兜底价值)。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'
import puppeteer from 'puppeteer-core'

// @puppeteer/browsers 下载的 Linux Chrome 放在 ~/.cache/puppeteer/chrome/linux-<版本>/,
// 版本号不固定,所以扫目录、取最新的那个。
function findPuppeteerCacheBrowser() {
  const root = path.join(os.homedir(), '.cache/puppeteer/chrome')
  if (!fs.existsSync(root)) return null
  const versions = fs
    .readdirSync(root)
    .filter((d) => d.startsWith('linux-'))
    .sort()
    .reverse()
  for (const v of versions) {
    const exe = path.join(root, v, 'chrome-linux64/chrome')
    if (fs.existsSync(exe)) return exe
  }
  return null
}

// 顺序即优先级:环境变量 > 原生 Linux > puppeteer 缓存 > WSL 调 Windows > Windows 原生 > macOS。
// **原生排在 Windows 前面**是有意的:能原生跑就别跨 VM。
export function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/snap/bin/chromium',
    findPuppeteerCacheBrowser(),
    // WSL:驱动 Windows 上已装的浏览器
    '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
    '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe',
    // Windows 原生(在 Windows 上用 Node 直接跑)
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean)
  for (const p of candidates) if (fs.existsSync(p)) return p
  throw new Error(
    '未找到 Chrome/Edge。三选一:\n' +
    '  ① 装一个 Linux 版 Chrome(推荐):npx @puppeteer/browsers install chrome@stable\n' +
    '  ② 用环境变量 CHROME_PATH 指向浏览器可执行文件\n' +
    '  ③ 直接安装 Chrome / Edge'
  )
}

// WSL 里调用 Windows 版浏览器时,**凡是交给浏览器进程的路径都必须是 Windows 形式**。
// 否则浏览器读不懂这个路径,不是开一个新的无头实例,而是去连已经在跑的那个会话,
// puppeteer 直接报 "Failed to launch the browser process: Code: 21"。
//
// 另外:这条路**只够打印 PDF**。preview 需要的截图、assets-gen 需要的 page.evaluate
// 往返都做不了(Windows Chrome 的 DevTools 端口开在 Windows 自己的 127.0.0.1 上,
// WSL 这边是另一个 loopback,连过去 ECONNREFUSED)。所以那两个脚本会明确拒绝这条路。
export function isWindowsBrowserFromWsl(browserPath) {
  return process.platform === 'linux' && /^\/mnt\/[a-z]\//i.test(browserPath)
}

// /mnt/d/foo/bar → D:\foo\bar
export function toWindowsPath(p) {
  const m = /^\/mnt\/([a-zA-Z])\/(.*)$/.exec(p)
  return m ? `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}` : p
}

// D:\foo\bar → /mnt/d/foo/bar
export function toWslPath(p) {
  const m = /^([a-zA-Z]):\\(.*)$/.exec(p)
  return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : p
}

// 浏览器要往 user-data-dir 里写东西,得给它一个 Windows 认得的目录:优先用 Windows 的 %TEMP%
export function wslBrowserProfileDir() {
  try {
    const winTemp = execSync('cmd.exe /c echo %TEMP%', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
    const dir = toWslPath(winTemp)
    if (fs.existsSync(dir)) return fs.mkdtempSync(path.join(dir, 'resume-cn-chrome-'))
  } catch {
    // 取不到就往下兜底
  }
  const fallback = '/mnt/c/Windows/Temp'
  if (fs.existsSync(fallback)) return fs.mkdtempSync(path.join(fallback, 'resume-cn-chrome-'))
  throw new Error('WSL 里找不到 Windows 可写的临时目录,无法启动 Windows 版浏览器')
}

// 删配置目录必须吞异常:Windows 上浏览器子进程可能还没完全退出、目录被占用,
// fs.rmSync 会抛 EBUSY/EPERM —— 那是清理失败,不该让构建失败。
export function removeDirQuietly(dir) {
  if (!dir) return
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // 留给系统清理临时目录
  }
}

// 给需要 page.evaluate / 元素截图的脚本用:这条路要求浏览器能被 CDP 连上,
// 也就是必须是**本机原生**的浏览器,不能是 WSL 那头的 Windows 版。
export function requireNativeBrowser(browserPath, scriptName) {
  if (isWindowsBrowserFromWsl(browserPath)) {
    throw new Error(
      `${scriptName} 需要能和浏览器建立调试连接,而 WSL 里调用的 Windows 版浏览器做不到\n` +
      '(它的调试端口开在 Windows 自己的 127.0.0.1 上,WSL 这边连过去会被拒绝)。\n' +
      '请装一个 Linux 版 Chrome 后重试:\n' +
      '    npx @puppeteer/browsers install chrome@stable'
    )
  }
}

// 统一的启动入口。extraArgs 会和默认参数合并。
export async function launchBrowser(browserPath, extraArgs = []) {
  return puppeteer.launch({
    executablePath: browserPath,
    headless: true,
    args: [
      '--allow-file-access-from-files',
      '--no-sandbox',
      // --font-render-hinting=none:关掉字体渲染微调,让输出在不同机器上更稳定
      '--font-render-hinting=none',
      ...extraArgs,
    ],
  })
}
