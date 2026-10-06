# LapisCV WebUI · 命令行指南

本指南介绍通过命令行将 Markdown 简历生成 **A4 PDF**，以及管理独立投递版本的方法。Word 可通过 `npm run docx` 按需生成。字体已随项目提供，网页操作见 [使用与自定义指南](docs/editing-guide.md)。

这些脚本来自工作台早期的本地 `resume-cn` 工具链，排版样式与简历图标基于开源上游 [LapisCV](https://github.com/BingyanStudio/LapisCV)。Markdown 文件也可由本地 Agent 读写，协作流程见 [Agent 协作指南](docs/agent-workflow.md)。

- 内容源:**母版** `resumes/_master/resume.md`(纯文本,你或 AI 都能直接改)。每投一个岗位就复制一份**子版**,见下文「母版 + 子版」
- 生成:`npm run build` → `resume.pdf`(**默认**);`npm run docx` → `resume.docx`(按需)
- 版式：内置居中标准、左对齐标题、横向名片三种布局，字体可以单独调整，见下文「切换主题」。
- 基于开源模板 [LapisCV](https://github.com/BingyanStudio/LapisCV)(MIT)
- 代理开发流程与版式约束见 [AGENTS.md](./AGENTS.md)

## 环境要求

- Node.js ≥ 22.12
- 本机已安装 Chrome 或 Edge(用于把 HTML 打印成 PDF,脚本会自动查找)

无需 Python、无需 TeX、无需 Docker、无需联网下载字体。

## 快速开始

```bash
npm ci               # 安装依赖并从 examples/ 初始化私有母版；已有数据不覆盖

npm run build        # ← 默认动作:生成 resume.pdf(classic 主题)
npm run preview      # 生成屏幕预览图(核对排版用)
npm run watch        # 监听 md,改一次自动重编
npm run docx         # 需要 Word 版时才跑,生成 resume.docx

npm run build:serif  # 换 serif 主题出 PDF(输出仍是 resume.pdf,会覆盖)
npm run docx:serif   # 换 serif 主题出 Word
npm run icons        # 改了图标集才需要

npm run new -- "公司名" "岗位名"   # 新建一份投递:从母版复制子版
npm run apps                       # 刷新投递总览 resumes/INDEX.md
npm run status -- "公司-岗位" "已投递"   # 改某份投递的状态
```

**默认只出 PDF,默认用 classic 主题。** 上面不带参数的命令都操作**母版** `resumes/_master/resume.md`。

## 目录结构

```
LapisCV-webui/
├─ AGENTS.md                给 AI 代理的说明(改动前必读)
├─ src/                     构建脚本
│  ├─ build.mjs             md → html → pdf
│  ├─ docx.mjs              md → docx
│  ├─ preview.mjs           html → png(屏幕预览)
│  ├─ apps.mjs              新建投递文件夹 / 生成投递总览 / 改状态
│  ├─ compare.mjs           两张整页图同框拼接,便于比对
│  └─ assets-gen.mjs        生成头像 PNG 与图标 PNG
├─ assets/                  素材(所有简历共用)
│  ├─ fonts/                思源黑体、思源宋体、JetBrains Mono、图标字体
│  ├─ styles/               三种版式各一个文件 + 共用的 main.css
│  │   ├─ main.css          版式骨架(所有主题共用)
│  │   ├─ classic.css       主题 classic:黑体、姓名居中
│  │   ├─ serif.css         左对齐标题
│  │   └─ banner.css        横向名片
│  ├─ icons/                图标 PNG + manifest.json
│  ├─ icon-sheet.png        21 个内置图标对照表
│  └─ avatar.svg / .png     头像源文件与成品(可选,没有就不放头像)
└─ resumes/
   ├─ _master/              母版:你的真实信息,唯一真相
   │  └─ resume.md          所有子版都从这一份复制出去
   ├─ _template.md          空白模板(起新母版用)
   ├─ INDEX.md              投递总览(自动生成,列出所有投递与状态)
   └─ 公司-岗位/            一份投递 = 一个文件夹
      ├─ resume.md          子版(从母版整份复制,只在这里针对 JD 改)
      ├─ jd.md              该岗位的 JD 原文
      ├─ meta.md            投递状态
      └─ resume.pdf         产物
```

## 导出 Word(.docx)—— 按需,不是默认

默认只出 PDF。遇到明确要求 Word 的网申系统时,再跑 `npm run docx` 生成 `resume.docx`。

**`.docx` 和 `.doc` 的区别**：本项目输出 Office Open XML 格式的 `.docx`，不直接生成旧版 `.doc`。若接收方明确要求 `.doc`，可用 Word 打开导出文件后另存为对应格式，并检查转换后的排版。

**Word 版是照着 PDF 的版式参数 1:1 换算的**,不是简化版:

| | 做法 |
|---|---|
| 字体 | 两边都用 **微软雅黑**(系统自带,Word 打开即正确,不依赖字体嵌入) |
| 字号 / 行距 | 正文 10pt / 行距 1.8,章节 12pt,姓名 16pt;Word 用「固定值」而非「倍数」(Word 的倍数行距按字体自身行高算,和 CSS 的 line-height 不是一回事) |
| 颜色 | 主题色 `#2f5a9e`、正文色 `#353a42`,与 CSS 变量一一对应 |
| 页边距 | A4,上下 13mm、左右 15mm |
| 图标 | 用**同一张 PNG**,PDF 和 Word 完全同一份素材 |
| 头像 | 同一张图,22mm×32mm 浮动在右上,文字环绕 |
| 列表 / 左右对齐 | 项目符号缩进、职位左 / 标签右的制表位,均按 PDF 实测值换算 |

> **残余差异(无法消除)**:PDF 由 Chrome 排版、Word 由自己的排版引擎排版,两者对中文的断行规则不同,个别段落的**换行位置可能差一两个字**。这是两个引擎的差异,不是配置问题。
>
> **验收 .docx 一律以 Word / WPS 为准**。VS Code 的 Office Viewer 这类预览插件底层是 JS 库,对浮动图片定位和 `<w:tab/>` 支持不完整,**会显示出并不存在的错误**(实测过:预览里右侧标签没对齐、头像位置偏高,在 WPS 里其实都是正常的)。
>
> 自查可用 `node src/compare.mjs a.png b.png out.png` 把两份渲染图同框拼接,但要知道它反映的是 Chromium/LibreOffice 的效果,不是 Word 的。

## 编写简历

用普通 Markdown 写即可,重点约定:

| 作用 | 写法 |
|------|------|
| 姓名(居中大标题) | `# 你的名字` |
| 联系方式(居中一行) | 以 `>` 引用块开头,用 `&emsp;&emsp;` 分隔各段 |
| 章节标题 | `## 章节名`,可带图标 |
| 一条经历的标题行(左标题 / 右标签) | `<div class="entry-title"><h3>职位 - 公司</h3><p>2020.03 - 2023.08</p></div>` |
| 条目 | `- 内容` |
| 头像 | `<img class="avatar" src="assets/uploads/my-photo.png">` |
| 强制分页 | 单独一行 `<hr>` |
| 样式覆盖 | 在 md 里写一段 `<style>…</style>`,会内联进 HTML 并覆盖主题变量 |

### 图标有两种写法

| 写法 | 例子 | PDF | Word | 说明 |
|---|---|---|---|---|
| 图片占位符 | `[[e618]]` | ✅ | ✅ | **推荐**:构建时替换成同一张 PNG,两份文件用完全相同的素材 |
| 字体字形 | `&#xe618;` | ✅ | ❌ 会变乱码 | LapisCV 原生写法,只适合「只出 PDF」 |

内置图标共 21 个,对照表见 `assets/icon-sheet.png`,常用的:

- `[[e60f]]` 电话 · `[[e7ca]]` 邮箱 · `[[e8ae]]` 定位 · `[[e600]]` GitHub
- `[[e80c]]` 教育 · `[[e618]]` 工作 · `[[e635]]` 项目 · `[[ecfa]]` 技能 · `[[e8b5]]` 团队 · `[[e673]]` 编辑

新增图标:改 `src/assets-gen.mjs` 顶部的 `CODES`,然后跑 `npm run icons`。

## 切换主题

内置三种版式，使用同一份内容。网页名称描述排列方式，命令行继续使用稳定的主题 ID：

| 网页名称 | 主题 ID | 布局 |
|---|---|---|
| 居中标准 | `classic`（默认） | 姓名居中、联系方式横排、求职意向独立一行、头像靠右 |
| 左对齐标题 | `serif` | 较大的左对齐姓名标题，正文单栏 |
| 横向名片 | `banner` | 头像与姓名、基本信息并排的页头 |

各版式保留方形证件照和细边框。网页可另行调整字体、个人信息对齐、分栏、字号、间距、头像方向与位置，见 [编辑指南](docs/editing-guide.md)。横向页头与联系方式排列用于网页与 PDF；Word 仍沿用原有段落布局。旧的 `sidebar`、`sectioned` 保存记录在网页及 PDF 渲染时回退到 `classic`。

切换方式（`--theme` 后是主题 ID，不写就是 `classic`）：

```bash
npm run build:serif                                    # 或下面这种等价写法
node src/build.mjs resumes/_master/resume.md resumes/_master/resume.pdf --theme serif
node src/build.mjs resumes/_master/resume.md resumes/_master/resume.pdf --theme banner
node src/docx.mjs  resumes/_master/resume.md resumes/_master/resume.docx --theme serif
```

主题对母版和子版都适用——子版构建时同样可以加 `--theme`。

主题文件放在 `assets/styles/`,主文件名就是主题名。想再加一套,照 `classic.css` 复制一份改名即可(它会自动出现在可用列表里);构建时写错主题名会报错并列出所有可用主题。

## 调整样式

改对应主题文件顶部的变量即可(默认主题是 `assets/styles/classic.css`):

```css
--text-size: 10pt;          /* 正文字号 */
--line-height: 1.8;         /* 行高 */
--h1-size: 16pt;            /* 姓名字号 */
--h2-size: 12pt;            /* 章节标题字号 */
--color-accent: #00327dac;  /* 主题色 */
```

`main.css` 是所有主题共用的版式骨架,**必须排在主题文件前面**(主题靠"写在后面"来覆盖它)。浏览器和 Word 两边都按这个顺序取值。

页面尺寸与页边距在 `src/build.mjs` 的 `PAGE` 常量里(A4,上下 13mm、左右 15mm),`src/docx.mjs` 里有对应值。

**字号、行距、颜色、字体这些,Word 版是直接从 CSS 推导的**(`assets/styles/*.css` + 简历 md 里的 `<style>`,按浏览器同样的覆盖顺序取值),所以**改主题只需要改 CSS 一处**,两份文件会自动保持一致 —— 不存在"改了 PDF 忘了改 Word"的问题。

唯一要留意的是**字体**:仓库自带的思源黑体只在 PDF 里通过 `@font-face` 生效,Word 是按名字找系统字体,所以引擎会自动换成同风格的系统字体(如微软雅黑),构建时会打印提示。**想让两份文件字体也完全一致,就在 md 的 `<style>` 里把 `--text-font` 直接设成系统字体**(如 `'Microsoft YaHei'`)。

## 母版 + 子版(每投一个岗位一份)

这套结构解决两个问题:**母版不会被反复改乱**,以及**能一眼看出投过哪些公司**。

```
resumes/_master/resume.md         母版 —— 你的真实信息,唯一真相
        ↓ 每拿到一份 JD,整份复制
resumes/公司-岗位/resume.md       子版 —— 只针对这一份 JD 改
```

**关键点:子版是从母版"整份复制"出来的自包含文件,不是引用、不是补丁、不是 diff。**
所以母版以后怎么改,已经投出去的那些子版都不受影响;反过来,在任何子版里怎么改,也污染不到母版。

### 三步走

```bash
# 1) 新建一份投递(文件夹名 = 公司-岗位)
npm run new -- "示例公司" "后端开发"
#    → resumes/示例公司-后端开发/
#        resume.md   从母版复制的子版
#        jd.md       把 JD 原文贴进来
#        meta.md     投递状态

# 2) 针对这份 JD 改子版(改 resume.md),然后出 PDF
node src/build.mjs "resumes/示例公司-后端开发/resume.md" "resumes/示例公司-后端开发/resume.pdf"

# 3) 投出去之后改状态
npm run status -- "示例公司-后端开发" "已投递"
```

### 投递总览

`resumes/INDEX.md` 是所有投递的清单,由 `npm run apps` 自动生成:

```bash
npm run apps
```

| 公司 | 岗位 | 创建 | 状态 | JD | 子版 | 产物 |
|---|---|---|---|---|---|---|
| 示例公司 | 后端开发 | 2026-09-13 | 已投递 | ✓ | resume.md | resume.pdf |

状态取值:`待投递 / 已投递 / 已回复 / 面试中 / 已拒 / 已关闭`。
**总览文件不要手改**——状态改在各文件夹的 `meta.md` 里,然后重新生成。

### 几条设计上的取舍

- **重名会直接报错,绝不覆盖。** 同一个公司+岗位重复新建时,脚本会拒绝并提示你改名。因为已存在的文件夹里可能有一份改好的子版,那是不可再生的——宁可麻烦一点,也不能悄悄覆盖掉。
- **子版自带 `jd.md`。** 把 JD 原文存一份,以后回头核对"当时到底要求什么"才有依据;只存改过的简历会让 JD 信息丢失。
- **母版只放事实,子版才做定向调整。** 母版保持"内容最全、不针对任何岗位";每份子版是它的一个侧重版本。这样母版始终是可复用的基准,不会越改越窄。

### 自定义路径

所有脚本都接受显式路径,也支持 `--theme`:

```bash
node src/docx.mjs    "resumes/<文件夹>/resume.md" "resumes/<文件夹>/resume.docx"
node src/preview.mjs "resumes/<文件夹>/resume.html" "resumes/<文件夹>/preview.png"
```

## 头像

**默认就是方形证件照**:小一寸 2.2×3.2cm,直角,带一圈细边框,浮动在版心右上角。

> 这里改过上游的设计。LapisCV 原版是**圆形**头像(28mm 正方形 + `border-radius:50%` + 2px 边框 + 一圈 3mm 白色光晕)。逐项的处置:
>
> - **去掉圆角** —— 竖版证件照会被裁成**椭圆**。
> - **去掉光晕** —— 那是一圈向外扩散 3mm 的白色,会占掉右上角约 3mm 的正文空间,和第一条经历的日期行撞在一起。
> - **保留边框** —— 它不是装饰,是轮廓。白底证件照和白纸是同一个颜色,没有这圈线就分不出照片的边界,印出来只是"白纸上浮着一个人头"(实测对比过)。所以边框必须留。
>
> 改动记在 `AGENTS.md` 里,重新同步上游时注意别覆盖回去。

真实照片放进忽略入库的 `assets/uploads/`，或通过网页上传；保留 `assets/avatar.png` 为公开占位图。在 md 里引用自己的上传文件：

```markdown
<img class="avatar" src="assets/uploads/my-photo.png">
```

尺寸和形状都在 `assets/styles/<主题>.css` 顶部的变量里（各版式独立配置）：

```css
--avatar-width: 22mm;    /* 宽 */
--avatar-height: 32mm;   /* 高;不写则等于宽度(方形) */
```

`object-fit: cover` 会把比例不符的照片**居中裁剪**填满这个框,不会拉伸变形 —— 所以按 `--avatar-width/height` 的比例准备照片最好(证件照按小一寸准备即可)。

**单份简历想用别的尺寸**,不用改主题文件,在 md 顶部加一段 `<style>` 覆盖就行,Word 那边会自动读这段 style 里的 width/height:

```html
<style>
.avatar, img[alt="avatar"] { width: 25mm; height: 35mm; }   /* 例如一寸 */
</style>
```

想彻底去掉头像,把 md 里那行 `<img class="avatar" ...>` 删掉或注释掉即可(注释掉的那种写法也能被正确识别)。

## 许可与致谢

- 版式模板:[BingyanStudio/LapisCV](https://github.com/BingyanStudio/LapisCV)(MIT License)
- 字体:思源黑体 / 思源宋体(Source Han Sans / Serif,SIL Open Font License 1.1)、JetBrains Mono(OFL)
