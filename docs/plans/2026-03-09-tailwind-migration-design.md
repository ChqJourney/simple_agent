# Tailwind CSS 迁移设计文档

**日期**: 2026-03-09  
**类型**: UI 重构  
**状态**: 已批准

## 背景

当前项目混合使用了 Tailwind CSS 和传统 CSS（App.css），样式不统一，维护成本高。需要完全迁移到 Tailwind CSS，并重新设计 UI 为现代简约风格，使用素雅的中性灰白色调。

## 设计目标

1. 完全移除传统 CSS，统一使用 Tailwind CSS
2. 实现现代简约风格的 UI 设计
3. 使用中性灰白色调，体现素雅美感
4. 保持暗色模式支持
5. 提升代码可维护性和一致性

## 设计系统

### 配色方案

**中性灰白色调** - 灵感来自 Linear、Notion 等现代应用

#### 亮色模式

```
主背景:     #FFFFFF / #FAFAFA (浅灰)
次背景:     #F5F5F5 / #F0F0F0 (侧边栏)
主文字:     #1A1A1A / #333333
次要文字:   #666666 / #999999
强调色:     #3B82F6 (蓝色)
成功色:     #10B981 (绿色)
警告色:     #F59E0B (橙色)
边框:       #E5E7EB
```

#### 暗色模式

```
主背景:     #18181B
次背景:     #1F1F23 / #27272A
主文字:     #E4E4E7
次要文字:   #A1A1AA
强调色:     #60A5FA (亮蓝)
边框:       #3F3F46
```

### 圆角系统

```
小圆角:  8px  - 按钮、输入框、小标签
中圆角:  12px - 卡片、消息框、下拉菜单
大圆角:  16px - 模态框、大容器
```

### 间距系统

遵循 Tailwind 默认间距系统（4px 基准）：
- `p-1`: 4px
- `p-2`: 8px
- `p-3`: 12px
- `p-4`: 16px
- `p-6`: 24px
- `p-8`: 32px

### 阴影系统

```
sm:   shadow-sm   - 微阴影（按钮悬停）
md:   shadow-md   - 中阴影（卡片）
lg:   shadow-lg   - 大阴影（下拉菜单）
xl:   shadow-xl   - 超大阴影（模态框）
2xl:  shadow-2xl  - 最大阴影（强调元素）
```

## 组件设计

### 1. 布局组件

#### App Container
- 主容器：`h-screen flex bg-white dark:bg-gray-900`
- 侧边栏：`w-64 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700`
- 主内容区：`flex-1 flex flex-col`

#### Sidebar
```tsx
// 展开
className="w-64 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col"

// 折叠
className="w-12 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col items-center py-4"
```

### 2. 消息组件

#### MessageItem
```tsx
// 用户消息
className="max-w-[85%] ml-auto bg-blue-50 dark:bg-blue-950 text-gray-900 dark:text-gray-100 rounded-2xl px-4 py-3"

// AI 消息
className="max-w-[85%] bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-2xl px-4 py-3"

// 工具消息
className="max-w-[85%] bg-orange-50 dark:bg-orange-950 text-gray-900 dark:text-gray-100 rounded-xl px-4 py-3 text-sm"

// 消息头部
className="flex justify-between items-center mb-2"

// 角色
className="font-semibold text-xs text-gray-600 dark:text-gray-400"

// Token 使用
className="text-xs text-gray-400 dark:text-gray-500"
```

#### MessageInput
```tsx
// 容器
className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"

// 输入框
className="flex-1 resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-100"

// 发送按钮
className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed transition-colors"
```

### 3. 模态框

#### Modal
```tsx
// 遮罩
className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"

// 内容
className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto max-w-2xl w-full mx-4"

// 头部
className="p-6 border-b border-gray-200 dark:border-gray-700"

// 内容
className="p-6"

// 底部
className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3"
```

### 4. 按钮

```tsx
// 主按钮
className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"

// 次按钮
className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-lg transition-colors"

// 文本按钮
className="px-4 py-2 text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"

// 图标按钮
className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
```

### 5. 输入框

```tsx
// 文本输入
className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"

// 选择框
className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"

// 文本域
className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none transition-colors"
```

### 6. 代码块

```tsx
// 代码容器
className="bg-gray-900 dark:bg-black rounded-lg p-3 my-2 overflow-x-auto"

// 代码文本
className="text-sm text-gray-100 font-mono"

// 内联代码
className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 text-red-600 dark:text-red-400 rounded text-sm font-mono"
```

### 7. 工具调用显示

```tsx
// 工具调用容器
className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 my-2"

// 工具名称
className="font-semibold text-sm text-gray-700 dark:text-gray-300 mb-2"

// 工具参数
className="bg-gray-100 dark:bg-gray-900 rounded p-2 text-xs overflow-x-auto"
```

### 8. 推理块

```tsx
// 推理容器
className="bg-gray-50 dark:bg-gray-800 border-l-4 border-gray-400 dark:border-gray-500 px-3 py-2 my-2 text-sm text-gray-600 dark:text-gray-400"
```

### 9. 状态指示

#### 连接状态
```tsx
// 已连接
className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400"

// 断开连接
className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400"

// 加载中
className="animate-pulse flex items-center gap-2 text-xs text-yellow-600 dark:text-yellow-400"
```

### 10. 滚动条

使用 Tailwind 默认滚动条，或添加自定义样式：

```css
/* 在 tailwind.config.js 中配置 */
scrollbar: {
  width: '8px',
  track: {
    background: '#f1f1f1',
    borderRadius: '4px',
  },
  thumb: {
    background: '#c1c1c1',
    borderRadius: '4px',
    '&:hover': {
      background: '#a1a1a1',
    },
  },
}
```

## 实施步骤

### 阶段 1: 安装和配置（15分钟）
1. 安装 Tailwind CSS 及相关依赖
   - `tailwindcss`
   - `postcss`
   - `autoprefixer`
2. 初始化 Tailwind 配置
3. 配置 `tailwind.config.js`
   - 自定义颜色
   - 自定义圆角
   - 配置暗色模式
4. 创建 `postcss.config.js`
5. 更新 `src/main.tsx` 引入 Tailwind

### 阶段 2: 组件迁移（2-3小时）
按优先级迁移组件：

1. **基础组件**
   - App.tsx (布局)
   - Sidebar.tsx
   - ChatContainer.tsx

2. **消息相关**
   - MessageList.tsx
   - MessageItem.tsx
   - MessageInput.tsx
   - StreamingMessage.tsx

3. **工具和推理**
   - ToolCallDisplay.tsx
   - ToolConfirmModal.tsx
   - ReasoningBlock.tsx

4. **设置**
   - SettingsModal.tsx
   - ProviderConfig.tsx

5. **其他**
   - SessionList.tsx
   - WorkspaceSelector.tsx

### 阶段 3: 清理和优化（1小时）
1. 删除 `src/App.css`
2. 测试所有组件样式
3. 测试暗色模式
4. 调整细节和动画
5. 优化性能

## 配置文件示例

### tailwind.config.js

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'media', // 或 'class' 如果需要手动切换
  theme: {
    extend: {
      colors: {
        // 可以添加自定义颜色
      },
      borderRadius: {
        // 使用默认的圆角配置
      },
    },
  },
  plugins: [],
}
```

### postcss.config.js

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

### src/main.tsx 更新

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css' // 引入 Tailwind CSS

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

### src/index.css (新建)

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* 可以添加自定义基础样式 */
```

## 风险和注意事项

1. **暗色模式**: 当前使用 `prefers-color-scheme`，保持一致
2. **动画**: 保留现有的动画效果（光标闪烁、脉冲等）
3. **滚动条**: 确保自定义滚动条样式正确应用
4. **响应式**: 虽然是桌面应用，但保持一定的响应式设计
5. **字体**: 保持 Inter 字体系列

## 成功标准

1. ✅ 所有组件使用 Tailwind CSS
2. ✅ App.css 文件已删除
3. ✅ UI 风格统一，符合现代简约设计
4. ✅ 配色为中性灰白色调
5. ✅ 暗色模式正常工作
6. ✅ 所有交互功能正常
7. ✅ 性能无明显下降

## 时间估算

- 安装配置: 15 分钟
- 组件迁移: 2-3 小时
- 测试优化: 1 小时
- **总计**: 约 4 小时

## 参考资料

- [Tailwind CSS 官方文档](https://tailwindcss.com/)
- [Tailwind CSS with Vite](https://tailwindcss.com/docs/guides/vite)
- [Tailwind CSS Dark Mode](https://tailwindcss.com/docs/dark-mode)