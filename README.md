# StudyPlannerWeb

一个极简 H5 原型，用于展示 5 岁小朋友的“每日活动安排 + 每周复盘”计划表。

## 功能亮点

- 按周表格展示 7 天活动
- 每日可选活动：数学、语文、英语、视力训练、篮球训练
- 完成每项活动自动计分（默认 10 分，可修改）
- 每周目标默认 100 分，可在设置里调整
- 周末复盘：显示总积分、是否达标、补全建议
- 本地存储数据，刷新后保留

## 运行步骤

1. 打开 `StudyPlannerWeb` 文件夹。
2. 在 VS Code 中打开文件夹。
3. 直接在浏览器中打开 `index.html`，或使用本地静态服务器。

### 推荐方式：使用 Python 内置服务器

```bash
cd /Users/cici/ProjectSunny/StudyPlannerWeb
python3 -m http.server 8000
```

然后在浏览器访问 `http://127.0.0.1:8000`。

### 或者使用 VS Code Live Server 插件

- 右键 `index.html` → `Open with Live Server`

## 文件说明

- `index.html`：页面结构
- `styles.css`：样式
- `app.js`：业务逻辑、打分与复盘

## 未来扩展

- 增加更多活动项目
- 增加奖励系统与积分商城
- 支持家长账号与多设备同步
