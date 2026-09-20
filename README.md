# 规则引擎（GoRules ZEN）

> 完整使用说明见 **[使用手册.md](使用手册.md)**

基于开源 [GoRules ZEN Engine](https://github.com/gorules/zen) 搭建的决策规则系统：
**业务人员在可视化界面里编辑规则（JDM JSON），Python 服务加载同一份规则文件做求值**。

```
规则引擎/
├── rules/                  # 决策规则（JDM JSON，唯一事实来源，可进 Git）
│   ├── shipping-fee.json   # 示例：运费计算（决策表 + 表达式）
│   └── customer-score.json # 示例：客户评分（决策表 + Switch 分流）
├── editor/                 # 可视化编辑器（React + @gorules/jdm-editor）
│   ├── server.mjs          # Node 服务：规则文件 CRUD + 模拟器求值 API
│   └── src/App.tsx         # 编辑器界面（画布 / 决策表 / 模拟器）
└── engine/                 # Python 引擎
    ├── app.py              # FastAPI 服务：REST 求值
    ├── run.py              # CLI 求值
    └── requirements.txt
```

## 数据流

```
业务人员                    应用系统
┌───────────────────┐      ┌──────────────────────┐
│ 可视化编辑器        │      │ Python 引擎服务       │
│ 画布/决策表/表达式  │      │ zen-engine 求值       │
│ 模拟器(带轨迹回放)  │      └──────────▲───────────┘
└─────────┬─────────┘                 │ 读取
          │ 保存 .json                 │
          ▼                           │
      ┌───────────────────────────────┘
      │  rules/*.json  ← 唯一事实来源
      └──────────────────────────────
```

## 一、启动可视化编辑器

```bash
cd editor
npm install          # 首次
npm run build        # 构建前端（首次或 src 变更后）
npm start            # 打开 http://localhost:8700
```

开发模式（前端热更新，需另开终端跑 `npm run server`）：

```bash
npm run dev          # vite: http://localhost:5173（/api 已代理到 8700）
```

### 编辑器功能
- **画布**：拖拽添加节点（决策表 / 表达式 / Switch / 函数 / 子决策），连线编排
- **决策表**：电子表格式编辑条件和结果
- **模拟器**：右侧面板填入测试数据 → Run，画布会高亮执行路径与每个节点的输入输出
- **业务模式 / 开发模式**：右上角切换，业务模式给业务人员更友好的表格视图
- **保存 / 新建 / 删除**：规则文件落在 `rules/` 目录

### 模拟器原理
编辑器把整图 POST 到 `editor/server.mjs` 的 `/api/simulate`，
Node 端用 `@gorules/zen-engine`（Rust 原生绑定，与 Python 端同一引擎内核）带 trace 求值后返回。

## 二、启动 Python 引擎

```bash
cd engine
pip install -r requirements.txt   # 首次

# 方式1: REST 服务
uvicorn app:app --host 0.0.0.0 --port 8800

# 方式2: 命令行
python run.py shipping-fee "{\"customer\":{\"tier\":\"vip\"},\"order\":{\"total\":800},\"cart\":{\"weight\":12}}"
```

### REST 接口
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/decisions` | 列出所有规则 |
| GET | `/api/decisions/{name}/content` | 查看规则内容 |
| POST | `/api/decisions/{name}/evaluate` | 求值，body: `{"context": {...}}` |
| POST | `/api/evaluate` | 按 key 求值，body: `{"key": "shipping-fee.json", "context": {...}}` |

调用示例：

```bash
curl -X POST http://localhost:8800/api/decisions/shipping-fee/evaluate \
  -H "Content-Type: application/json" \
  -d '{"context": {"customer": {"tier": "vip"}, "order": {"total": 800}, "cart": {"weight": 12}}}'
```

Python 调用：

```python
import requests
resp = requests.post(
    "http://localhost:8800/api/decisions/shipping-fee/evaluate",
    json={"context": {"customer": {"tier": "vip"}, "order": {"total": 800}, "cart": {"weight": 12}}},
)
print(resp.json()["result"])
```

## 三、典型工作流

1. 业务人员在编辑器里修改决策表（例如把 VIP 的折扣从 0.10 改成 0.15）
2. 用模拟器验证几组测试数据
3. 点击「保存」→ `rules/shipping-fee.json` 更新（可 git 提交留痕）
4. Python 服务重启后加载新规则；或在应用里按需重建 engine 实现热加载
