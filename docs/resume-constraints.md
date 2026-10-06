# 简历渲染与内容约束

本文件面向修改渲染、字体、版式及简历内容的开发者与代理，记录兼容性要求和已验证的行为。**改动前请先读完「关键约束」一节。**

## WebUI 与数据入口

本目录是基于 resume-cn 工具链发展的独立开源工作台。公开示例采用虚构资料，使用者的简历和投递数据保存在不入库的本机目录。简历内容与素材的约束沿用下文，服务需求以用户授权为准。

- 启动：`npm start`，默认 `http://127.0.0.1:3210`。Windows 双击「启动简历工作台.cmd」可在后台启动。
- 新代码：`src/server.mjs`（HTTP API）、`src/store.mjs`（文件、版本与回收站）、`src/render.mjs`（CLI/WebUI 共用渲染）、`web/`（网页）。
- 数据：仍使用 `resumes/`；主题选择写入每份简历的 `.webui.json`。`.local/` 保存历史、回收站与日志，忽略入库。
- 网页预览与 PDF 必须共用渲染函数；不要维护两套版式参数。服务默认只监听 loopback，修改请求验证本地会话与来源。
- 网页存盘使用 revision 检查，不允许静默覆盖其他窗口或外部编辑器的新内容；覆盖和恢复前保留快照。
- 界面采用双层左侧导航，日间为白灰配色、夜间为黑灰配色；顶部保持紧凑，把可用空间优先给编辑与简历预览。
- 夜间纸面和 PDF 校样使用屏幕阅读配色，头像保留原色；PDF / Word 导出继续读取原始简历参数。界面字体偏好与简历排版字体分开保存，不能把夜间计算颜色写回 Markdown。
- 验证：`npm test` 使用 .local 下的独立夹具，不能改动真实母版做测试。需要 PDF 时使用本机浏览器，Word 仍然按需。

## 这是什么

中文简历工具链:用 Markdown 写简历,一条命令生成 **A4 PDF**(默认输出)。**Word(.docx) 按需生成**,不是默认动作 —— 除非用户明确要求,不要主动出 Word 版。

- 版式来自开源模板 [LapisCV](https://github.com/BingyanStudio/LapisCV)(MIT),样式和字体已随仓库放好
- 内置三种版式：**居中标准**(`classic`，默认)、**左对齐标题**(`serif`)、**横向名片**(`banner`)。名称描述布局，字体可单独调整。旧的 `sidebar`、`sectioned` 保存记录和历史在读取、渲染、恢复时回退到 `classic`，只读操作不得改写源文件或设置文件。切换见「常用命令」。
- `web/resume-layout.js` 生成个人信息与章节的显示属性，网页编辑与 HTML / PDF 共用；不得把这些属性写回用户内容。横向页头由网页与 PDF 支持，Word 转换仍沿用原有段落布局。
- 默认居中页头必须使用横向联系方式，求职意向独立一行。来源中的 `<br>` 与 em space 由显示层映射到可调的横排／竖排间隔，不改原始内容。检查空间时也要检查头像与文字、第一条经历是否相互遮挡。
- 依赖极轻:**一个浏览器** + Node 的几个纯 JS 库(`marked` / `puppeteer-core` / `docx`)。PDF 用浏览器无头打印,Word 用 `docx` 直接生成 OOXML
- **不需要 Python / TeX / Docker**,也不需要数据库或任何常驻服务
- ⚠️ **"零依赖"只在原生环境成立。** macOS / Windows / 装了浏览器的 Linux,直接用系统浏览器即可;
  **WSL 里推荐装一个 Linux 版 Chrome**,否则只有 `build.mjs` 能靠命令行调 Windows 版浏览器兜底,
  `preview.mjs` 和 `assets-gen.mjs` 会明确拒绝运行。装法见「浏览器与运行环境」。

## 目录结构

```
LapisCV-webui/
├─ src/                     构建脚本(全部是 ESM,项目根目录 = 脚本目录的上一层)
│  ├─ browser.mjs           浏览器定位与启动,三个用到浏览器的脚本共用(见「浏览器与运行环境」)
│  ├─ build.mjs             md → html → pdf(Chrome 无头打印)
│  ├─ docx.mjs              md → docx(直接生成 OOXML)
│  ├─ preview.mjs           html → png(屏幕预览图)
│  ├─ apps.mjs              投递管理:new 建文件夹 / index 生成总览 / status 改状态
│  ├─ compare.mjs           把两张整页图裁同一区域、缩放后上下拼接,便于比对
│  ├─ measure.mjs           量一张整页图的版式数据(内容边界、头像色块),输出 mm 坐标
│  └─ assets-gen.mjs        从 SVG / 图标字体生成头像 PNG 与图标 PNG + manifest
├─ assets/                  素材,脚本与所有简历共用
│  ├─ fonts/                思源黑体、思源宋体、JetBrains Mono、图标字体
│  ├─ styles/               主题文件:文件名 = 主题名,构建时用 --theme 选
│  │   ├─ main.css          版式骨架,所有主题共用(取值顺序必须排在最前)
│  │   ├─ classic.css       主题 classic(默认)
│  │   ├─ serif.css         左对齐标题
│  │   └─ banner.css        横向名片
│  ├─ icons/                图标 PNG + manifest.json(尺寸数据);static.json 存非字体图标的度量
│  ├─ icons-src/            非字体图标的 SVG 源(如 trophy.svg,含许可说明)
│  ├─ icon-sheet.png        字体里 21 个图标的对照表(不含 icons-src/ 来的图标)
│  └─ avatar.svg / .png     头像源文件与成品(可选;没有就不放头像)
└─ resumes/
   ├─ _master/resume.md     母版:用户真实信息,唯一真相。不带参数的命令都操作它
   ├─ _template.md          空白模板
   ├─ INDEX.md              投递总览(apps.mjs 生成,不要手改)
   └─ <公司>-<岗位>/        一份投递 = 一个文件夹(自包含)
      ├─ resume.md          子版:从母版整份复制,只在这里针对 JD 改
      ├─ jd.md              该岗位 JD 原文
      ├─ meta.md            投递状态
      └─ resume.pdf         产物
```

结构是「母版 + 每个 JD 一个自包含子版」,细节和取舍见 [命令行指南](../README-cli.md) 的「母版 + 子版」一节。要点:**子版必须是母版的整份副本,不能是引用或补丁**——否则母版一改,已投出去的版本跟着变,隔离就失效了。

## 常用命令

**默认只产出 PDF。** DOCX 是按需的(`npm run docx`)—— 除非用户明确要求 Word 版,不要主动跑 `docx.mjs`,也不要为了 Word 去改版式。

```bash
npm run build      # ← 默认动作:生成母版的 resume.pdf(classic 主题)
npm run preview    # 生成屏幕预览图(核对排版用)
npm run watch      # 监听 md,改一次重编一次
npm run icons      # 重新生成图标 PNG 与 manifest(改了图标集才需要)

npm run docx       # 按需:生成 resume.docx(用户要求时才跑)

# 投递管理(母版 + 子版流程)
npm run new -- "公司名" "岗位名"        # 从母版复制出子版,建 resumes/公司-岗位/
npm run apps                            # 刷新 resumes/INDEX.md
npm run status -- "公司-岗位" "已投递"   # 改某份投递的状态

# 换主题:--theme <主题名>,不写就是 classic。位置参数与 --theme 可以任意顺序混用
npm run build:serif
npm run docx:serif

# 任意简历 / 任意主题(路径参数优先于默认值)
node src/build.mjs resumes/<名字>/resume.md resumes/<名字>/resume.pdf [--theme serif]
node src/docx.mjs  resumes/<名字>/resume.md resumes/<名字>/resume.docx [--theme serif]
node src/preview.mjs <html> <png>
node src/compare.mjs a.png b.png out.png [起始mm] [高度mm]
node src/measure.mjs <整页png> [头像横向区间mm,默认 168-200]
```

主题名就是 `assets/styles/` 下的主文件名(不含 `.css`)。写错会报错并列出可用主题,不会静默退回默认。

## 简历 Markdown 约定

| 作用 | 写法 |
|---|---|
| 姓名(居中大标题) | `# 名字` |
| 联系方式(居中) | `>` 引用块;多个 `&emsp;&emsp;` 分隔 |
| 章节标题 | `## 章节名`,可带图标 |
| 一处经历(左标题 / 右标签) | `<div class="entry-title"><h3>职位 - 公司</h3><p>2020.03 - 2023.08</p></div>` |
| 条目 | `- 内容` |
| 图标 | `[[e618]]`(见下) |
| 头像 | `<img class="avatar" src="assets/avatar-xxx.png">` |
| 强制分页 | 单独一行 `<hr>` |
| 样式覆盖 | md 里写一段 `<style>…</style>`,会内联进 HTML 并覆盖主题变量 |

**图标有两种写法,选错了 Word 会出乱码:**

- `[[e618]]` —— **推荐**。构建时替换成同一张 PNG,PDF 和 Word 用的是完全相同的素材。
- `&#xe618;` —— LapisCV 原生的图标字体字形写法。**只在「只出 PDF」时可用**,Word 里没有这个字体。

图标清单见 `assets/icon-sheet.png`(字体里的 21 个)。新增图标有两条路:

- **字体图标**:改 `src/assets-gen.mjs` 顶部的 `CODES` 后跑 `npm run icons`。
- **非字体图标**(字体里没有、从开源 SVG 栅格化来的,目前只有 `e900` 奖杯):SVG 源放 `assets/icons-src/`,PNG 直接放 `assets/icons/`,度量写进 `assets/icons/static.json`。`npm run icons` 会把 `static.json` 合并进 `manifest.json`,所以不会被抹掉 —— **别再手工改 `manifest.json` 而不写 `static.json`**,那样一跑 `npm run icons` 就丢。
  栅格化时要与字体图标对齐:**线色用强调色 `#2f5a9e`,墨迹高度取 `h/ref ≈ 0.87`**(现有章节图标在 0.852–0.887 之间)。`w`/`h`/`ref` 是唯一被 `build.mjs` 与 `docx.mjs` 用到的三个值(`ascent`/`descent` 目前无人读),PDF 与 Word 都按 `w/ref`、`h/ref` 等比缩放。
  已收录:`e900` = Lucide `trophy`(ISC 许可,免费商用)。

  ⚠️ **图标栅格化对 Chrome 版本敏感。** 同一份 `iconfont.ttf`、同一段 canvas 代码,
  Chrome 150 与 153 生成的 PNG 会有 **1–2px / 256px(≈0.8%)** 的墨迹边界差异 ——
  来源是抗锯齿边缘的 alpha 阈值判定。实测:当前入库的 21 个图标由 **Windows Chrome 150**
  生成,与更早的原版有 5/12 个逐字节一致、总偏差 18px;Linux Chrome 153 则是 3/12、26px。
  **重跑 `npm run icons` 会按 `findBrowser()` 的结果重新生成,数值会变** —— 这是已知且可接受的,
  不要当成 bug。真正要守住的是「图标 PNG 与 `manifest.json` 必须同批生成」,否则尺寸对不上。

## 关键约束(改代码前必读)

这些是实际踩过的坑,不是理论洁癖:

1. **PDF 与 DOCX 不可能逐像素一致**,因为一个是 Chrome 排版、一个是 Word 排版引擎。目标只能是「版式参数一致」:字体、字号、行距、颜色、页边距、缩进、图标素材。中文断行位置会有一两个字的差异,这是引擎固有的,不要试图消除。

2. **版式参数一律从 CSS 推导,不要往 `docx.mjs` 里手抄常量**。字号、行距、颜色、字体、姓名对齐都由脚本从 `assets/styles/*.css` + 简历 md 的 `<style>` 实时算出,并剥掉 `@media` 块。改主题只改 CSS 一处,两份文件自动一致;要加新参数也走"从 CSS 变量推导",不要新增硬编码。

   这条是踩过坑才立的:早先版本把样例的主题色 `#2f5a9e` 手抄进了引擎,而 CSS 默认是 `#00327dac` —— **没有覆盖主题色的简历会拿到两份颜色不一致的文件**。手抄就会出这种事。

2a. **CSS 的叠加顺序必须是 `main.css` → 主题文件 → md 里的 `<style>`,`main.css` 必须在前。** 主题是靠在后面重写规则来做覆盖的(serif 就靠这个把 `h1` 改成左对齐、把头像的边框和光晕去掉),顺序反了这些覆盖全部失效,而且**不会报错**,只会静默出一份不对的版式。上游 vscode 版的 `markdown.styles` 就是 `[main.css, 主题.css]` 这个顺序。

    这条也是踩过坑的:早先 `build.mjs`/`docx.mjs` 都是把 `main.css` 接在主题文件后面,结果 serif 的姓名还是居中的、头像还带着本该被去掉的光晕。

2b. **字体别名必须映射成系统字体**。仓库自带的思源黑体/宋体只在 PDF 里靠 `@font-face` 生效,Word 是按名字找系统字体。脚本会做映射(`SourceHanSansCN → Microsoft YaHei`、`SourceHanSerifCN → SimSun`、`JetBrainsMono → Consolas`)并打印提示。把自带字体名直接写进 DOCX 会 fallback 跑版;新增字体别名记得加进映射表。

    **标题字体单独取 `--title-font`**,不能和正文共用一个:classic 两者都是黑体,serif 的标题是宋体、正文仍是黑体。共用会让 serif 的 Word 版标题变成微软雅黑。

2c. **头像的浮动锚点 `AVATAR_TOP_MM` 是按主题实测的常量**(classic 13.0mm、serif 0.5mm,基准是「上边距」),这是全项目唯一一处刻意硬编码的版式值。原因是头像的流内位置取决于标题块的实际排版高度,没法从 CSS 变量推出来。

    换了主题、或改了 `main.css`/主题文件里影响标题块高度的规则(h1 的字号、padding、margin,blockquote 的 margin),这个值都要**重新实测**。取数方法见「渲染验证方法」:分别把 PDF 和 DOCX 渲染成图,用 `src/measure.mjs` 量头像色块的 `上` 值,两者对齐即可(实测过 classic 在 26.0mm、serif 在 13.5mm 处,减去 13mm 上边距就是这两个常量)。

    注意:这个锚点和头像的**尺寸无关**(浮动元素的上边缘位置由流内位置决定,不由图片高度决定)。所以把头像从小一寸改成别的尺寸,不需要重测;只有改标题块高度才需要。

2d. **头像形状是本地改过的:方形证件照 —— 直角、保留一圈细边框、无光晕。** 上游默认是圆形(正方形 + `border-radius:50%` + `border: 2px solid var(--border-color)` + 3mm 白色光晕)。三个属性要分开看,不能一起删:

    - **去掉 `border-radius:50%`**:竖版证件照会被裁成椭圆。
    - **去掉 3mm 白色光晕(`box-shadow`)**:它向外扩散,占掉右上角约 3mm 正文空间,撞上第一条经历的日期行。
    - **`border` 必须保留**:它不是装饰而是轮廓 —— 白底证件照与纸张同色,没有这圈线就分不出照片边界,白纸上只会「浮着一个人头」。这条实测对比过。**曾经误把它和圆角、光晕一起删掉,别再删。**

    规则在 `assets/styles/main.css` 的 `.avatar`(所有版式共用);尺寸在各版式的 `--avatar-width` / `--avatar-height`，可在网页中另行调节。

    **小心主题文件把 border 覆盖掉**:`serif.css` 尾部上游原本有 `box-shadow: none; border: none`(为去圆头像的边框和光晕而写),留着会按 CSS 顺序盖掉 main.css 的 `border`,serif 主题就又没边框了 —— 那两行已删除,只保留位置调整。以后加新主题时留意别把 `border: none` 带进来。

    **引用块只能清除自身的引用边线，不能给 `blockquote *` 清除 `border-inline-start`。** 个人信息内嵌的头像也属于引用块子元素，后者会让头像左边框消失，形成上、右、下 2px 而左边 0px 的不对称边框。三个版式的编辑、预览和日夜显示都要检查四边宽度、样式与颜色相同，照片贴合边框且无额外内边距；尺寸仍指照片内容，外框宽高各增加两侧边框的总厚度。

    `--avatar-height` 是本地新增的变量(上游只有 `--avatar-width`,即正方形)。`main.css` 与 `docx.mjs` 都按 `var(--avatar-height, var(--avatar-width))` 的语义取值:不定义高度就退回等于宽度,与上游行为一致。

    `object-fit: cover` 会把比例不符的照片居中裁剪(不拉伸),所以框的宽高比最好和照片一致。

3. **Word 的行距必须用固定值**。`src/docx.mjs` 里统一用 `lineRule: 'exact'` + twips 值。Word 的「倍数行距」是按字体自身行高算的,和 CSS 的 `line-height` 不是一回事——用倍数会让 DOCX 明显比 PDF 松。

4. **右对齐的制表位必须用 `new Tab()`**(输出 `<w:tab/>`)。写字符串 `'\t'` 会在 XML 文本节点里变成字面制表符,Word 会规范化成空格,右对齐直接失效。

5. **`&emsp;` 必须还原成 em space**(`\u2003`),不能用普通空格顶替。联系方式那行用了多个 `&emsp;`,换成普通空格会短 10mm 以上。

6. **头像的浮动定位基准用「页边距」(`VerticalPositionRelativeFrom.MARGIN`)**,不要用「段落」。段落基准在不同渲染器里解释不一致(Word / LibreOffice / JS 预览库各不相同),会出现位置漂移。

7. **md 里的图片路径写 `assets/...` 就行**。`build.mjs` 会按 HTML 的输出位置自动改写成相对路径(如 `../../assets/...`),不要手工写 `../`。

7a. **CSS 里的 `url()` 也要补同一套前缀 —— 漏了会让 `@font-face` 静默失效。**
    图片走的是 HTML 属性(`src`/`href`),CSS 走的是 `url()`,两者基准都是 **HTML 文档所在目录**(`resumes/<名字>/`),不是项目根目录。
    `build.mjs` 早先只改了 HTML 属性、漏了 CSS,于是 `assets/fonts/...` 解析成 `resumes/<名字>/assets/fonts/...` → 404 → **浏览器不报错,直接回退系统字体**。
    Windows 上有 `Noto Sans SC` 兜底所以看不出来,**一到没装 CJK 字体的 Linux,中文会整片消失** —— 而且会一路静默产出没有中文的 PDF。
    `build.mjs` 现在对此有**两道自检**:静态检查每个本地 `url()` 能否解析到真实文件(覆盖 puppeteer 和 CLI 两条路),以及运行时检查 `--text-font`/`--title-font` 是否真有 `@font-face` 注册成功。
    **动了字体或路径相关代码后,务必确认构建没有抛这两类错;不要用「Windows 上看着正常」当作验收。**

8. **验收 .docx 一定要用 Word 或 WPS,不要相信编辑器里的预览插件**。VS Code 的 Office Viewer 之类底层是 JS 库,对浮动图片定位和 `<w:tab/>` 支持不完整,会显示出并不存在的错误。

9. **`src/assets-gen.mjs` 生成的 `assets/icons/manifest.json` 是构建的输入**,`build.mjs` 和 `docx.mjs` 都依赖它。删掉图标 PNG 就没法构建。

10. **子版必须是母版的整份副本,不能改成"引用/继承/补丁"。** 每份投递文件夹里的 `resume.md` 是 `_master/resume.md` 的完整拷贝,这是刻意设计:母版继续演进时,已经投出去的子版必须保持原样(否则你无法复现"当时投的到底是哪一版")。不要为了"省重复"把它改成 `@import`、变量替换、或 patch 文件——那会把这份隔离破坏掉。

    同理,**`apps.mjs new` 遇到同名文件夹必须报错而不是覆盖**:文件夹里可能是一份已经针对该岗位改好的子版,不可再生。

11. **`apps.mjs` 里的日期不能再用 `toISOString()`。** 那是 UTC,在东八区会整体差一天(实测把 09-13 记成了 09-12)。要取本地日期,用 `getFullYear/getMonth/getDate` 拼。

12. **简历本来就要「包装」,放手做;要分清楚的是「能不能被核实」。**

    **该主动做的(不要畏手畏脚、不要以「真实性」为由推脱):**
    挑最相关的经历、调整顺序、换更强的动词、把真实成果量化、按 JD 对齐关键词、砍掉无关内容、把平淡的流水账写得有分量、把同一个项目针对不同岗位写出不同侧重。这些就是简历写作本身。

    **要交给用户拍板的(分界不是「够不够朴素」,而是「这句能不能被背调核实」):**
    雇主名、职位名称、任职时间、学历、证书、以及可查证的硬指标(营收、团队人数、排名、专利)。这类内容如果为了凑效果被写成用户无法自圆其说的样子,风险是实打实的:offer 撤销、入职后解除、背调不过。遇到需要虚构这类事实才能成立的写法,代理应该**明确标出来**(「这里我给你写成了 X,你需要确认能兜住」)让用户决定,而不是自己默默加进去、也不该直接拒绝整单需求。

    **简言之:包装由代理做,可核实事实的最终版本由用户签字。** 代理既不要当道德警察,也不要在用户没意识到的地方埋雷。用户才是为这份简历负责的人。

13. **有异议必须先问,不能自作主张。** 只要代理的判断和用户的意思不一致,代理就只能**把意见说出来、等用户拍板**,绝不能一边陈述异议、一边已经把文件改了。

    例如：代理对某处头衔或措辞有异议时，应先说明理由并等待用户决定，不能在提出异议的同时擅自改写源文件。

    这条与约束 12 的关系:约束 12 说「可核实事实的最终版本由用户签字」——**签字就是用户的决定**。用户确认最终事实口径后，代理应按用户决定执行。有异议应先说明，不能擅自改成代理偏好的版本。

    判断标准:**凡会改变简历最终呈现内容的动作**(改字、改标题、删条目、换措辞、调顺序),只要代理心里有「我觉得应该不一样」的声音,就先停下来说明、等用户回复再动手。允许直接做的只有用户已经明确点名要求的那一件事本身。

## 浏览器与运行环境

三个脚本(`build.mjs` / `preview.mjs` / `assets-gen.mjs`)都要驱动浏览器,定位逻辑统一在 `src/browser.mjs`,**不要在脚本里另写一份**。
`findBrowser()` 的优先级:**`CHROME_PATH` > Linux/macOS 原生 > `~/.cache/puppeteer` > WSL 调 Windows 版 > Windows 原生 > macOS**。

**WSL 用户强烈建议装一个 Linux 版 Chrome**(不需要 sudo,也不碰系统包):

```bash
npx @puppeteer/browsers install chrome@stable
```

装完三个脚本都能原生跑,没有跨 VM 开销、没有 `/mnt` 路径约束。**注意它默认会把整个 Chrome(约 400MB)下到当前目录**,
记得在项目外执行,或装完把 `chrome/` 挪到 `~/.cache/puppeteer/`(`.gitignore` 已兜底忽略)。

三条环境相关的坑,都实际踩过:

1. **只把 `CHROME_PATH` 指到 `/mnt/c/...` 是不够的。** WSL 里驱动 Windows 版浏览器时,
   `--user-data-dir` 和 `file://` URL **也必须转成 Windows 形式**,否则浏览器读不懂路径、
   不是开新实例而是去连已有会话,puppeteer 报 `Code: 21`。
2. **WSL 里 puppeteer 驱动不了 Windows 版浏览器。** 它的 DevTools 端口开在 Windows 自己的
   `127.0.0.1`,WSL 这边的 `127.0.0.1` 是另一个 loopback,连过去 `ECONNREFUSED`。
   所以 `build.mjs` 在这条路上改用 **Chrome 命令行的 `--print-to-pdf`** 兜底;
   `preview.mjs` / `assets-gen.mjs` **做不了**(前者要截图、后者要 `page.evaluate` 往返),
   它们会通过 `requireNativeBrowser()` 明确报错,提示你装 Linux 版 Chrome —— 这是有意的,不要绕。
3. **Windows 版浏览器读不到 `/mnt` 以外的路径**,所以走 CLI 兜底时输入/输出必须在 `/mnt/<盘符>/` 下。

排查用:裸调 Linux Chrome 的 CLI 时**必须带 `--disable-background-networking --disable-sync` 等**,
否则它会卡在 GCM 网络注册上、看起来像"卡死"(puppeteer 会自带这批参数,所以走 puppeteer 反而没事)。

## 版本控制

个人简历与投递数据所在的整个 `resumes/`、上传素材 `assets/uploads/` 与 `.local/` 不入公开 Git；程序、虚构示例、主题、字体、图标和占位头像入库。构建产物与完整备份按 `.gitignore` 忽略。
**改动素材类二进制文件(图标 PNG、字体)之前先确认工作区干净**,出问题才能 `git checkout` 回去。

## 渲染验证方法

- 可安装 LibreOffice，将 DOCX 渲染成图后与 PDF 比对。以下命令使用 Bash，Windows Git Bash 中需将可执行文件路径替换为实际安装位置：

```bash
SO="soffice"
# docx → png
"$SO" \
  --headless --norestore --convert-to 'png:writer_png_Export' --outdir <目录> <文件.docx>
# pdf → png
"$SO" \
  --headless --norestore --infilter="draw_pdf_import" --convert-to png --outdir <目录> <文件.pdf>
```

- 注意:LibreOffice 的渲染**只用于自查**,不代表 Word 的最终效果,更不代表编辑器预览插件的效果。它对 PDF 的裁剪路径(如 `border-radius` 的圆形头像)还原不准,常把圆显示成方 —— **量位置可靠,判断形状不可靠**。PDF 导入的栅格恰好是 120dpi(每毫米 4.7238px),所以量出来的 mm 是准的。

- 想量屏幕渲染(而不是 PDF)时,别截整页 PNG(周围有灰底和阴影,不好归一化),直接截 `.page` 元素 —— 它正好是一张 A4:

```js
// 元素截图,像素↔毫米精确对应(实测 1588x2246 = 210x297mm)
const el = await page.$('.page')
await el.screenshot({ path: out })
```

- 两种渲染路径要**交叉验证**:`.page` 元素截图(Chromium 屏幕样式)和 LibreOffice 的 PDF 栅格,头像落点实测只差 0.2mm 左右,互为佐证。

## 日常两种活

### A. 维护母版(用户信息变了:换了工作、加了项目)

只改 `resumes/_master/resume.md`,然后出预览:

```bash
npm run build      # → resumes/_master/resume.pdf
```

母版是"内容最全、不针对任何岗位"的那一版,所有子版都从它复制。**不要把某个岗位的定向调整写进母版。**

### B. 拿到一份新 JD(最常见的活)

```bash
npm run new -- "公司名" "岗位名"                       # 1) 从母版复制出子版
# 2) 把 JD 原文贴进 resumes/公司-岗位/jd.md
# 3) 针对这份 JD 改 resumes/公司-岗位/resume.md
node src/build.mjs "resumes/公司-岗位/resume.md" "resumes/公司-岗位/resume.pdf"   # 4) 出 PDF
npm run status -- "公司-岗位" "已投递"                  # 5) 投出去后记状态
```

改子版时的写作约定(图标 `[[eXXX]]`、头像 `<img class="avatar">`、`<div class="entry-title">` 等)见上面「简历 Markdown 约定」一节,和以前一样。

**注意:从头到尾不要动母版。** 针对 JD 的取舍(删哪段、突出哪段、换什么措辞)只发生在子版里。
