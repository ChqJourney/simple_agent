# Document Tools Redesign Roadmap

## 背景

当前项目最初的文档类工具主要面向文本文件：

- `get_document_outline`
- `search_files`
- `read_file_excerpt`

这套设计对于代码仓库、Markdown、TXT 还可以，但对于认证检测场景中更常见的文件类型并不够用。真实输入通常包括：

- `pdf`
- `docx`
- `xlsx`
- `pptx`

真实任务通常包括：

- 找条款
- 找证据
- 在整包材料中搜索关键词
- 按章节、页码、行号、表格区域读取
- 在程序文件、记录表单、标准条文之间做交叉核对

因此，这一轮重构的目标不是让工具“多支持几个扩展名”，而是把底层能力逐步从“文本文件处理”升级为“文档处理”。

## 本轮改造边界

本轮已经确认的边界如下：

- 暂时不改 `skill_loader`
- 先升级当前基础文档工具
- 先把 PDF、Word、Excel、PPTX 接通
- 允许直接废弃旧工具，不再保留兼容层
- 当前主工具聚焦：`get_document_structure`、`search_documents`、`read_document_segment`
- 再逐步补：解析缓存、PDF 更完整的按页码/行号读取、Word/Excel 复杂表格增强、PPTX 图表与版式增强

## 已完成内容

## 1. 引入可复用的 PDF 解析层

新增：

- `python_backend/document_readers/pdf_reader.py`

该模块基于已有的 `visual_line/pdf_reader.py` 改造而来，目标是服务 agent / tool，而不是单纯做底层库调用封装。

当前能力：

- 读取 PDF 基本信息
- 读取 PDF 内嵌 outline
- 按页读取
- 按视觉行读取
- 全文搜索
- 默认过滤页眉页脚
- 默认过滤旋转水印
- 默认过滤表格区域
- 将原始 span / line 尽量合并成更接近人类阅读习惯的视觉行

当前定位：

- 这是 PDF 类型专属的底层 reader
- 不是最终面向 LLM 的唯一工具入口
- 后续 `get_document_structure`、`search_documents`、`read_document_segment` 都应复用它

## 2. 新增 PDF 专属工具

新增：

- `pdf_get_info`
- `pdf_get_outline`
- `pdf_read_pages`
- `pdf_read_lines`
- `pdf_search`

目的：

- 先把 PDF 关键能力快速落地
- 给后续通用文档工具提供已验证的实现基础
- 保留一些 PDF 专属能力，例如视觉行、页眉页脚过滤、outline 读取

当前定位：

- 这些工具属于“专家型工具”
- 它们适合在过渡期直接给模型使用
- 长期来看，主入口仍应逐步收敛到按功能命名的通用工具

## 3. `get_document_outline` 已升级为 `get_document_structure`

新增主实现：

- `python_backend/tools/get_document_structure.py`

当前能力：

- 文本文件：
  - 支持 `md/txt/rst`
  - 提取 Markdown 标题和编号标题
  - 返回统一的 `document_structure` 结果
- PDF：
  - 优先读取内嵌 outline
  - 如果没有 outline，则回退为 page map
  - 返回统一的 `document_structure` 结果
- Word：
  - 支持 `docx`
  - 优先提取 Heading 样式
  - 回退为段落级或表格级结构 map
  - 返回统一的 `document_structure` 结果
- Excel：
  - 支持 `xlsx`
  - 输出 workbook / sheet 结构
  - 输出每个 sheet 的已用区域与表头候选
  - 返回统一的 `document_structure` 结果
- PPTX：
  - 支持 `pptx`
  - 输出 slide 列表、标题和文本块摘要
  - 返回统一的 `document_structure` 结果

结果形状已统一到一个更稳定的结构上，核心字段包括：

- `event: document_structure`
- `document_type`
- `structure_type`
- `nodes`
- `summary`

当前 `nodes` 中已经开始使用更通用的 `locator` 概念：

- 文本文件使用 `line_start/line_end`
- PDF 使用 `page_number`
- Word 使用 `paragraph_start/paragraph_end`
- Excel 使用 `sheet_name/row_start/row_end/column_start/column_end`
- PPTX 使用 `slide_number`

## 4. `search_files` 已升级为 `search_documents`

新增主实现：

- `python_backend/tools/search_documents.py`

当前能力：

- 文本文件：
  - 支持原有文本扩展名集合
  - 支持 `plain` / `regex`
  - 支持大小写敏感控制
  - 支持上下文行
- PDF：
  - 使用 PDF reader 的视觉行内容做搜索
  - 返回页码、行号、列号
  - 结果结构与文本结果统一
- Word：
  - 按段落搜索正文
  - 返回段落号与样式名
  - 支持表格单元格搜索
  - 支持上下文段落 / 表格行
- Excel：
  - 按单元格搜索
  - 返回 sheet / row / column / cell_ref
  - 支持上下文行
- PPTX：
  - 按 slide 文本块搜索
  - 支持备注文本搜索
  - 返回 slide / shape 定位

结果形状已统一到：

- `event: document_search_results`
- `results`
- `summary`

单条结果现在统一包含：

- `path`
- `document_type`
- `locator`
- `match_text`
- `context_before`
- `context_after`

其中：

- 文本文件结果包含 `line` / `column`
- PDF 结果包含 `page_number` / `line_number` / `column`
- Word 结果包含 `paragraph_index` 和可选 `style_name`
- Word 表格结果还会包含 `table_index / row_index / column_index`
- Excel 结果包含 `sheet_name / row_index / column_index / cell_ref`
- PPTX 结果包含 `slide_number` 和可选 `shape_index`

## 5. 新增 `read_document_segment`

新增主实现：

- `python_backend/tools/read_document_segment.py`

当前能力：

- 文本文件：
  - 按行范围读取
  - 按字符范围读取
- PDF：
  - 按页范围读取
  - 按页内视觉行范围读取
- Word：
  - 按段落范围读取
  - 支持上下文段落
  - 按表格 / 行列范围读取
- Excel：
  - 按 sheet + 行列范围读取
  - 支持上下文行
- PPTX：
  - 按 slide 范围读取
  - 输出 slide 标题、正文和 notes

结果形状统一为：

- `event: document_segment`
- `document_type`
- `segment_type`
- `locator`
- `content`
- `summary`

## 6. 前端与测试已同步

已同步更新：

- `src/utils/toolMessages.ts`
- `src/utils/toolMessages.test.ts`
- `python_backend/tests/test_get_document_outline_tool.py`
- `python_backend/tests/test_search_files_tool.py`
- `python_backend/tests/test_read_file_excerpt_tool.py`
- `python_backend/tests/test_pdf_tools.py`
- `python_backend/tests/test_tool_registry.py`

当前已经验证通过：

```bash
python -m unittest python_backend.tests.test_search_files_tool \
  python_backend.tests.test_read_file_excerpt_tool \
  python_backend.tests.test_tool_registry \
  python_backend.tests.test_get_document_outline_tool \
  python_backend.tests.test_pdf_tools
```

## 当前设计取舍

## 1. 内部实现按文件类型拆

内部实现应按文件类型拆分，因为不同格式的定位语义不同：

- PDF：`page` / `line` / `outline`
- Word：`heading` / `paragraph` / `table`
- Excel：`sheet` / `row` / `column` / `table region`
- PPTX：`slide` / `text box` / `notes`

所以底层 reader / parser 适合按类型建立：

- `pdf_reader`
- `word_reader`
- `excel_reader`
- `pptx_reader`

## 2. 对外主工具按功能收口

面向 LLM 的主工具不应该无限按文件类型扩张，否则工具面会越来越大，模型也更难选。

主入口建议逐步收敛为：

- `get_document_structure`
- `search_documents`
- `read_document_segment`

这样模型在大多数文档任务里，只需要先做：

1. 看结构
2. 搜命中
3. 读片段

## 3. 类型专属工具保留为专家能力

像下面这些工具仍然值得保留：

- `pdf_read_lines`
- `pdf_get_outline`
- 未来可能的 `xlsx_read_cells`

原因是它们有明显的格式专属语义，不适合一开始就强行抽象成最通用的接口。

因此当前推荐策略是：

- 主工具按功能收口
- 专家工具按格式保留
- 主工具内部复用类型专属 reader

## 当前不足

虽然本轮已经把方向扳正，但仍有明显缺口：

- `docx` 目前已经支持段落与表格，但仍以正文文本和规则表格为主
- Word 对复杂表格、嵌套表格、批注、修订、页眉页脚仍未覆盖
- `xlsx` 目前已经支持 workbook / sheet / 单元格区域，但仍以规则表格和已用区域为主
- Excel 对复杂 merged cells、多表混排、公式链路、图表对象仍未覆盖
- `pptx` 目前已经支持 slide 标题、文本框文本和备注文本
- PPTX 对图表、表格对象、图片内文字、复杂版式定位仍未覆盖
- 还不支持扫描版 PDF OCR
- PDF 搜索目前主要是视觉行级别，还没有章节标题回填
- 还没有文档解析缓存层，后续多轮读取会重复解析

## 接下来建议做的内容

## 第一优先级：新增 `read_document_segment`

建议新增通用读取工具：

- `read_document_segment`

它应该成为下一阶段的主入口读取工具，用于替代当前过于文本化的 `read_file_excerpt`。

建议支持的统一参数：

- `path`
- `locator`
- `max_chars`
- `include_context`

第一阶段先支持：

- 文本文件
  - 按行读取
- PDF
  - 按页读取
  - 按页内行号读取

这样就能和已经完成的两个主工具形成稳定闭环：

1. `get_document_structure`
2. `search_documents`
3. `read_document_segment`

## 第二优先级：Word 深化支持

新增 `word_reader`，建议基于 `python-docx`。

当前已完成：

- 提取标题层级
- 提取段落文本
- 提取 TRF 类表格的行列文本
- 支持段落搜索
- 支持表格单元格搜索
- 支持按段落定位读取
- 支持按表格 / 行范围定位读取

接下来优先补：

- 复杂表格和嵌套表格
- 表头识别与列名映射增强
- 表格内更稳定的上下文定位
- 基于表格结构的条款/判定抽取

## 第三优先级：Excel 支持

新增 `excel_reader`，建议基于 `openpyxl`。

建议不要把 Excel 强行看成普通文档大纲，而是把它视为“工作簿 + sheet + 区域 + 表格”。

当前已完成：

- 列出 sheet
- 识别已用区域
- 识别表头候选
- 按 sheet + 行列范围读取
- 按关键词在单元格中搜索
- 接入 `get_document_structure`
- 接入 `search_documents`
- 接入 `read_document_segment`

接下来优先补：

- 多表区域切分
- merged cells 归并语义
- 更稳定的表头识别与列名映射
- 公式值 / 原公式切换读取
- 对检测记录类表格的区域抽取增强

## 第四优先级：PPTX 支持

新增 `pptx_reader`，建议基于 `python-pptx`。

当前已完成：

- 读取 slide 标题
- 读取文本框文本
- 读取备注文本
- 支持全文搜索
- 接入 `get_document_structure`
- 接入 `search_documents`
- 接入 `read_document_segment`

接下来优先补：

- 图表与表格对象文本抽取
- 图片 OCR 接入后的二次增强
- 更稳定的版式块定位
- slide 内表格和文本块的细粒度读取

PPTX 的结构提取建议输出：

- slide 列表
- 标题
- 文本摘要

## 第五优先级：解析缓存

建议增加文档缓存层，否则同一文档会被：

- 搜一次
- 读一次
- 再读一次

重复解析成本会越来越高。

建议缓存 key：

- `path`
- `mtime`
- `size`
- `parser_options`

建议缓存对象：

- 已解析结构
- 页内容
- 搜索中间结果

## 推荐的近期实施顺序

建议按下面顺序继续：

1. 加解析缓存
2. 强化 Word 复杂表格与 Excel 表格区域抽取
3. 最后再处理 OCR 和更复杂的结构增强

## 总结

本轮已经完成的关键转向是：

- 从“文本文件工具”转向“文档工具”
- 从“按旧名字维持功能”转向“按统一功能入口收口”
- 先用 PDF 打通一条真实链路

当前最重要的下一步，已经从“补齐闭环”切换成“把表格型文档继续做深”，尤其是：

- Excel 区域化读取
- Word / Excel 表格结构化抽取

因为认证检测场景里，真正高频的证据很多都落在表格而不是纯正文里。
