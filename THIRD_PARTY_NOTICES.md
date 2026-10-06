# 第三方素材与依赖

项目代码与本项目新增的示例、占位头像采用根目录 [MIT LICENSE](LICENSE)。下列第三方内容保留各自的许可证和版权声明。软件许可证不授予使用者填写的个人简历、照片或投递数据的权利。

## 随仓库分发的素材

| 内容 | 来源与版权 | 许可证文件 |
|---|---|---|
| 简历样式、Lapis CV Icon 字体、派生章节图标 | [BingyanStudio/LapisCV](https://github.com/BingyanStudio/LapisCV)，Copyright 2024 YiNN；CSS 原作者 GoForceX、YiNN | [MIT](licenses/LapisCV-MIT.txt)；样式保留原作者头部声明 |
| Source Han Sans CN 2.004 字体 | [Adobe Source Han Sans](https://github.com/adobe-fonts/source-han-sans)，字体内版权为 2014–2021 Adobe，Reserved Font Name: Source | [SIL OFL 1.1](licenses/SourceHanSans-OFL.txt)；保留字体内版权与保留名称 |
| Source Han Serif CN 2.003 字体 | [Adobe Source Han Serif](https://github.com/adobe-fonts/source-han-serif)，字体内版权为 2017–2024 Adobe，Reserved Font Name: Source | [SIL OFL 1.1](licenses/SourceHanSerif-OFL.txt)；保留字体内版权与保留名称 |
| JetBrains Mono 2.304 | [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono)，Copyright 2020 The JetBrains Mono Project Authors | [SIL OFL 1.1](licenses/JetBrainsMono-OFL.txt) |
| 工作台 SVG 图标与奖杯图标 | [Lucide](https://github.com/lucide-icons/lucide)，Lucide Icons and Contributors；Feather 派生部分 Cole Bemis | [ISC / MIT](web/lucide-LICENSE.txt)；奖杯源文件也保留说明 |

字体文件未经修改。OFL 允许字体随软件分发，须保留许可和版权；修改字体时仍需遵守 OFL 与保留名称规则。公开示例头像是本项目的几何占位图，不来自个人照片。

## npm 依赖

依赖通过 `npm ci` 安装，不将 `node_modules` 上传到本仓库。安装版本以 `package-lock.json` 为准，完整依赖许可保留在各 npm 包中。前端打包使用 `legalComments: 'eof'` 保留法务注释；重新分发打包产物时应保留这些注释及本文件。

| 直接依赖 | 官方项目 | 许可 |
|---|---|---|
| `@tiptap/core`、`@tiptap/extension-text-align`、`@tiptap/extension-text-style`、`@tiptap/pm`、`@tiptap/starter-kit` | [Tiptap](https://github.com/ueberdosis/tiptap) | MIT |
| `prosemirror-markdown` | [ProseMirror](https://github.com/ProseMirror/prosemirror-markdown) | MIT |
| `docx` | [docx](https://github.com/dolanmiu/docx) | MIT |
| `esbuild` | [esbuild](https://github.com/evanw/esbuild) | MIT |
| `jszip` | [JSZip](https://github.com/Stuk/jszip) | MIT 或 GPL-3.0-or-later，本项目按 MIT 选项使用 |
| `marked` | [Marked](https://github.com/markedjs/marked) | MIT |
| `pdfjs-dist` | [Mozilla PDF.js](https://github.com/mozilla/pdf.js) | Apache-2.0 |
| `puppeteer-core` | [Puppeteer](https://github.com/puppeteer/puppeteer) | Apache-2.0 |

本文件用于明确归属；完整条款以各许可文件为准。
