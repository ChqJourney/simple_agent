# Tailwind CSS 迁移实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将项目完全迁移到 Tailwind CSS，实现现代简约风格的 UI 设计，使用中性灰白色调。

**Architecture:** 完全移除传统 CSS，使用 Tailwind CSS 工具类重构所有组件样式。采用中性灰白色调配色方案，中等圆角设计，保持暗色模式支持。

**Tech Stack:** Tailwind CSS, PostCSS, Autoprefixer, Vite, React 19, TypeScript

---

## Task 1: 安装 Tailwind CSS 依赖

**Files:**
- Modify: `package.json`

**Step 1: 安装 Tailwind CSS 及相关依赖**

```bash
npm install -D tailwindcss postcss autoprefixer
```

Expected: 安装成功，package.json 中添加了 devDependencies

**Step 2: 初始化 Tailwind 配置**

```bash
npx tailwindcss init -p
```

Expected: 创建 `tailwind.config.js` 和 `postcss.config.js` 文件

**Step 3: 验证安装**

Run: `ls -la | grep -E "tailwind|postcss"`

Expected: 看到 tailwind.config.js 和 postcss.config.js 文件

---

## Task 2: 配置 Tailwind CSS

**Files:**
- Modify: `tailwind.config.js`
- Create: `src/index.css`
- Modify: `src/main.tsx`

**Step 1: 更新 tailwind.config.js**

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'media',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Avenir', 'Helvetica', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
```

**Step 2: 创建 src/index.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* 滚动条样式 */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 4px;
}

::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: #a1a1a1;
}

@media (prefers-color-scheme: dark) {
  ::-webkit-scrollbar-track {
    background: #27272a;
  }

  ::-webkit-scrollbar-thumb {
    background: #3f3f46;
  }

  ::-webkit-scrollbar-thumb:hover {
    background: #52525b;
  }
}

/* 光标闪烁动画 */
@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.animate-blink {
  animation: blink 1s infinite;
}
```

**Step 3: 更新 src/main.tsx**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

**Step 4: 验证配置**

Run: `npm run dev`

Expected: 开发服务器启动成功，控制台无错误

**Step 5: 提交配置**

```bash
git add tailwind.config.js postcss.config.js src/index.css src/main.tsx package.json package-lock.json
git commit -m "chore: setup Tailwind CSS configuration"
```

---

## Task 3: 迁移 App.tsx

**Files:**
- Modify: `src/App.tsx`

**Step 1: 更新 App.tsx 样式**

将第34行的:
```tsx
<div className="app-container flex h-screen bg-white">
```

替换为:
```tsx
<div className="flex h-screen bg-white dark:bg-gray-900">
```

将第39行的:
```tsx
<div className="p-4 bg-yellow-100 text-yellow-800 text-center">
```

替换为:
```tsx
<div className="p-4 bg-yellow-50 dark:bg-yellow-950 text-yellow-900 dark:text-yellow-200 text-center text-sm">
```

将第42行的:
```tsx
<code className="text-sm">cd python_backend && python main.py</code>
```

替换为:
```tsx
<code className="text-xs bg-yellow-100 dark:bg-yellow-900 px-1.5 py-0.5 rounded">cd python_backend && python main.py</code>
```

**Step 2: 删除 App.css 导入**

删除第5行:
```tsx
import './App.css';
```

**Step 3: 验证修改**

Run: `npm run dev`

Expected: 应用正常运行，无样式错误

**Step 4: 提交**

```bash
git add src/App.tsx
git commit -m "refactor: migrate App.tsx to Tailwind CSS"
```

---

## Task 4: 迁移 Sidebar 组件

**Files:**
- Modify: `src/components/Sidebar/Sidebar.tsx`

**Step 1: 更新折叠状态样式**

将第16行的:
```tsx
<div className="sidebar-collapsed w-12 bg-gray-100 border-r flex flex-col items-center py-4">
```

替换为:
```tsx
<div className="w-12 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col items-center py-4">
```

**Step 2: 更新展开状态样式**

将第28行的:
```tsx
<div className="sidebar w-64 bg-gray-100 border-r flex flex-col">
```

替换为:
```tsx
<div className="w-64 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col transition-all duration-200">
```

**Step 3: 更新头部样式**

将第29行到第37行替换为:
```tsx
<div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
  <h2 className="font-semibold text-gray-800 dark:text-gray-100">AI Agent</h2>
  <button
    onClick={() => setIsCollapsed(true)}
    className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors text-gray-600 dark:text-gray-300"
  >
    ◀
  </button>
</div>
```

**Step 4: 更新内容区域样式**

将第39行替换为:
```tsx
<div className="flex-1 overflow-y-auto p-4 space-y-4">
```

**Step 5: 更新底部样式**

将第44行到第51行替换为:
```tsx
<div className="p-4 border-t border-gray-200 dark:border-gray-700">
  <button
    onClick={onOpenSettings}
    className="w-full px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-lg transition-colors"
  >
    Settings
  </button>
</div>
```

**Step 6: 更新展开按钮样式**

将第18-22行替换为:
```tsx
<button
  onClick={() => setIsCollapsed(false)}
  className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors text-gray-600 dark:text-gray-300"
>
  ▶
</button>
```

**Step 7: 验证修改**

Run: `npm run dev`

Expected: 侧边栏正常显示，折叠/展开功能正常

**Step 8: 提交**

```bash
git add src/components/Sidebar/Sidebar.tsx
git commit -m "refactor: migrate Sidebar to Tailwind CSS"
```

---

## Task 5: 迁移 WorkspaceSelector 组件

**Files:**
- Modify: `src/components/Sidebar/WorkspaceSelector.tsx`

**Step 1: 读取文件内容**

Read: `src/components/Sidebar/WorkspaceSelector.tsx`

Expected: 查看当前样式

**Step 2: 根据实际内容更新样式**

（具体样式更新将在读取文件后确定）

**Step 3: 验证修改**

Run: `npm run dev`

Expected: 工作区选择器正常工作

**Step 4: 提交**

```bash
git add src/components/Sidebar/WorkspaceSelector.tsx
git commit -m "refactor: migrate WorkspaceSelector to Tailwind CSS"
```

---

## Task 6: 迁移 SessionList 组件

**Files:**
- Modify: `src/components/Sidebar/SessionList.tsx`

**Step 1: 读取文件内容**

Read: `src/components/Sidebar/SessionList.tsx`

Expected: 查看当前样式

**Step 2: 根据实际内容更新样式**

（具体样式更新将在读取文件后确定）

**Step 3: 验证修改**

Run: `npm run dev`

Expected: 会话列表正常显示

**Step 4: 提交**

```bash
git add src/components/Sidebar/SessionList.tsx
git commit -m "refactor: migrate SessionList to Tailwind CSS"
```

---

## Task 7: 迁移 ChatContainer 组件

**Files:**
- Modify: `src/components/Chat/ChatContainer.tsx`

**Step 1: 读取文件内容**

Read: `src/components/Chat/ChatContainer.tsx`

Expected: 查看当前样式

**Step 2: 根据实际内容更新样式**

（具体样式更新将在读取文件后确定）

**Step 3: 验证修改**

Run: `npm run dev`

Expected: 聊天容器正常工作

**Step 4: 提交**

```bash
git add src/components/Chat/ChatContainer.tsx
git commit -m "refactor: migrate ChatContainer to Tailwind CSS"
```

---

## Task 8: 迁移 MessageList 组件

**Files:**
- Modify: `src/components/Chat/MessageList.tsx`

**Step 1: 读取文件内容**

Read: `src/components/Chat/MessageList.tsx`

Expected: 查看当前样式

**Step 2: 根据实际内容更新样式**

（具体样式更新将在读取文件后确定）

**Step 3: 验证修改**

Run: `npm run dev`

Expected: 消息列表正常显示

**Step 4: 提交**

```bash
git add src/components/Chat/MessageList.tsx
git commit -m "refactor: migrate MessageList to Tailwind CSS"
```

---

## Task 9: 迁移 MessageItem 组件

**Files:**
- Modify: `src/components/Chat/MessageItem.tsx`

**Step 1: 更新消息容器样式**

将第30行的:
```tsx
<div className={`message-item ${message.role}`}>
```

替换为:
```tsx
<div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
  isUser 
    ? 'ml-auto bg-blue-50 dark:bg-blue-950' 
    : isTool 
    ? 'bg-orange-50 dark:bg-orange-950 rounded-xl text-sm'
    : 'bg-gray-50 dark:bg-gray-800'
}`}>
```

**Step 2: 更新消息头部样式**

将第31行替换为:
```tsx
<div className="flex justify-between items-center mb-2">
```

**Step 3: 更新角色标签样式**

将第32-34行替换为:
```tsx
<span className="font-semibold text-xs text-gray-600 dark:text-gray-400">
  {isUser ? 'You' : isTool ? 'Tool' : 'Assistant'}
</span>
```

**Step 4: 更新 token 使用样式**

将第35-39行替换为:
```tsx
{message.usage && (
  <span className="text-xs text-gray-400 dark:text-gray-500">
    {message.usage.total_tokens} tokens
  </span>
)}
```

**Step 5: 更新消息内容样式**

将第42行替换为:
```tsx
<div className="prose prose-sm dark:prose-invert max-w-none text-gray-900 dark:text-gray-100 leading-relaxed">
```

**Step 6: 更新工具调用容器样式**

将第52行替换为:
```tsx
<div className="mt-3 space-y-2">
```

**Step 7: 验证修改**

Run: `npm run dev`

Expected: 消息正常显示，样式正确

**Step 8: 提交**

```bash
git add src/components/Chat/MessageItem.tsx
git commit -m "refactor: migrate MessageItem to Tailwind CSS"
```

---

## Task 10: 迁移 StreamingMessage 组件

**Files:**
- Modify: `src/components/Chat/StreamingMessage.tsx`

**Step 1: 读取文件内容**

Read: `src/components/Chat/StreamingMessage.tsx`

Expected: 查看当前样式

**Step 2: 根据实际内容更新样式**

（具体样式更新将在读取文件后确定）

**Step 3: 验证修改**

Run: `npm run dev`

Expected: 流式消息正常显示

**Step 4: 提交**

```bash
git add src/components/Chat/StreamingMessage.tsx
git commit -m "refactor: migrate StreamingMessage to Tailwind CSS"
```

---

## Task 11: 迁移 MessageInput 组件

**Files:**
- Modify: `src/components/Chat/MessageInput.tsx`

**Step 1: 更新容器样式**

将第40行的:
```tsx
<form onSubmit={handleSubmit} className="message-input-container p-4 border-t">
```

替换为:
```tsx
<form onSubmit={handleSubmit} className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
```

**Step 2: 更新输入框样式**

将第42-50行替换为:
```tsx
<textarea
  ref={textareaRef}
  value={content}
  onChange={(e) => setContent(e.target.value)}
  onKeyDown={handleKeyDown}
  placeholder={placeholder}
  disabled={disabled}
  rows={1}
  className="flex-1 resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed transition-colors"
/>
```

**Step 3: 更新发送按钮样式**

将第52-58行替换为:
```tsx
<button
  type="submit"
  disabled={disabled || !content.trim()}
  className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed transition-colors font-medium"
>
  Send
</button>
```

**Step 4: 验证修改**

Run: `npm run dev`

Expected: 输入框正常工作，样式正确

**Step 5: 提交**

```bash
git add src/components/Chat/MessageInput.tsx
git commit -m "refactor: migrate MessageInput to Tailwind CSS"
```

---

## Task 12: 迁移 ReasoningBlock 组件

**Files:**
- Modify: `src/components/Reasoning/ReasoningBlock.tsx`

**Step 1: 读取文件内容**

Read: `src/components/Reasoning/ReasoningBlock.tsx`

Expected: 查看当前样式

**Step 2: 根据实际内容更新样式**

（具体样式更新将在读取文件后确定）

**Step 3: 验证修改**

Run: `npm run dev`

Expected: 推理块正常显示

**Step 4: 提交**

```bash
git add src/components/Reasoning/ReasoningBlock.tsx
git commit -m "refactor: migrate ReasoningBlock to Tailwind CSS"
```

---

## Task 13: 迁移 ToolCallDisplay 组件

**Files:**
- Modify: `src/components/Tools/ToolCallDisplay.tsx`

**Step 1: 读取文件内容**

Read: `src/components/Tools/ToolCallDisplay.tsx`

Expected: 查看当前样式

**Step 2: 根据实际内容更新样式**

（具体样式更新将在读取文件后确定）

**Step 3: 验证修改**

Run: `npm run dev`

Expected: 工具调用显示正常

**Step 4: 提交**

```bash
git add src/components/Tools/ToolCallDisplay.tsx
git commit -m "refactor: migrate ToolCallDisplay to Tailwind CSS"
```

---

## Task 14: 迁移 ToolConfirmModal 组件

**Files:**
- Modify: `src/components/Tools/ToolConfirmModal.tsx`

**Step 1: 读取文件内容**

Read: `src/components/Tools/ToolConfirmModal.tsx`

Expected: 查看当前样式

**Step 2: 根据实际内容更新样式**

（具体样式更新将在读取文件后确定）

**Step 3: 验证修改**

Run: `npm run dev`

Expected: 工具确认模态框正常工作

**Step 4: 提交**

```bash
git add src/components/Tools/ToolConfirmModal.tsx
git commit -m "refactor: migrate ToolConfirmModal to Tailwind CSS"
```

---

## Task 15: 迁移 SettingsModal 组件

**Files:**
- Modify: `src/components/Settings/SettingsModal.tsx`

**Step 1: 读取文件内容**

Read: `src/components/Settings/SettingsModal.tsx`

Expected: 查看当前样式

**Step 2: 根据实际内容更新样式**

（具体样式更新将在读取文件后确定）

**Step 3: 验证修改**

Run: `npm run dev`

Expected: 设置模态框正常工作

**Step 4: 提交**

```bash
git add src/components/Settings/SettingsModal.tsx
git commit -m "refactor: migrate SettingsModal to Tailwind CSS"
```

---

## Task 16: 迁移 ProviderConfig 组件

**Files:**
- Modify: `src/components/Settings/ProviderConfig.tsx`

**Step 1: 读取文件内容**

Read: `src/components/Settings/ProviderConfig.tsx`

Expected: 查看当前样式

**Step 2: 根据实际内容更新样式**

（具体样式更新将在读取文件后确定）

**Step 3: 验证修改**

Run: `npm run dev`

Expected: 提供商配置正常工作

**Step 4: 提交**

```bash
git add src/components/Settings/ProviderConfig.tsx
git commit -m "refactor: migrate ProviderConfig to Tailwind CSS"
```

---

## Task 17: 更新 markdown 组件样式

**Files:**
- Modify: `src/utils/markdown.tsx`

**Step 1: 读取文件内容**

Read: `src/utils/markdown.tsx`

Expected: 查看当前 markdown 组件配置

**Step 2: 根据实际内容更新样式**

（具体样式更新将在读取文件后确定，确保代码块、内联代码等样式正确）

**Step 3: 验证修改**

Run: `npm run dev`

Expected: Markdown 渲染正常，代码高亮正确

**Step 4: 提交**

```bash
git add src/utils/markdown.tsx
git commit -m "refactor: update markdown components for Tailwind CSS"
```

---

## Task 18: 删除 App.css

**Files:**
- Delete: `src/App.css`

**Step 1: 删除 App.css**

```bash
rm src/App.css
```

Expected: App.css 文件被删除

**Step 2: 验证删除**

Run: `ls src/App.css`

Expected: 文件不存在

**Step 3: 验证应用运行**

Run: `npm run dev`

Expected: 应用正常运行，无样式错误

**Step 4: 提交**

```bash
git add -A
git commit -m "refactor: remove App.css, fully migrated to Tailwind CSS"
```

---

## Task 19: 全面测试

**Step 1: 测试亮色模式**

- 启动应用
- 检查所有组件样式
- 验证颜色、圆角、间距是否符合设计

Expected: 所有组件样式正确，符合现代简约风格

**Step 2: 测试暗色模式**

- 切换系统暗色模式
- 检查所有组件暗色样式
- 验证对比度和可读性

Expected: 暗色模式正常工作，颜色对比度合适

**Step 3: 测试交互功能**

- 测试消息发送和接收
- 测试侧边栏折叠/展开
- 测试会话切换
- 测试设置模态框
- 测试工具确认

Expected: 所有交互功能正常

**Step 4: 测试响应式**

- 调整窗口大小
- 验证布局自适应

Expected: 布局正常，无样式溢出

---

## Task 20: 最终清理和文档

**Files:**
- Update: `README.md`

**Step 1: 更新 README**

添加 Tailwind CSS 相关说明：
- 技术栈中添加 Tailwind CSS
- 添加样式系统说明
- 添加自定义样式指南

**Step 2: 检查未使用的导入**

运行: `npm run dev`

检查控制台是否有未使用导入的警告

Expected: 无警告

**Step 3: 最终提交**

```bash
git add .
git commit -m "docs: update README with Tailwind CSS information"
```

**Step 4: 创建完成标签**

```bash
git tag -a v0.2.0-tailwind -m "Migrated to Tailwind CSS with modern minimalist design"
```

---

## 验收标准

- [ ] 所有组件使用 Tailwind CSS
- [ ] App.css 文件已删除
- [ ] UI 风格统一，符合现代简约设计
- [ ] 配色为中性灰白色调
- [ ] 暗色模式正常工作
- [ ] 所有交互功能正常
- [ ] 代码块、内联代码样式正确
- [ ] 无控制台错误或警告
- [ ] 应用性能良好

---

## 注意事项

1. **渐进式迁移**: 按顺序执行每个任务，确保每一步都能正常工作
2. **测试优先**: 每完成一个组件就测试，及时发现和修复问题
3. **暗色模式**: 始终同时添加 `dark:` 变体
4. **圆角统一**: 使用 `rounded-lg` (8px)、`rounded-xl` (12px)、`rounded-2xl` (16px)
5. **颜色一致**: 严格遵循设计系统的配色方案
6. **提交频繁**: 每完成一个组件就提交，方便回滚
7. **保留功能**: 只改样式，不改功能逻辑