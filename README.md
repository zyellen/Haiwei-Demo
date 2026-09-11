# Mini SCADA 迷你组态监控画面

## 1. 是什么

Mini SCADA 是一个浏览器里的迷你组态监控画面 demo。

- 工程师在画布上拖拽图元即可搭建监控画面，图元支持矩形、圆形与文本三类。
- 图元绑定采用「点位模板 + 设备号」：例如绑定 `tpl.level + 2`，系统自动解析为 `2#液位 / MW12`。
- 一份画面模板可以配合不同设备号实例化为多台设备的监控画面，页面通过 SSE 每秒刷新实时读数，超阈值时图元红色闪烁。
- 画面（图元 + 管道）可保存到服务端 JSON 并在下次打开时自动还原，底部报警栏记录最近 5 条报警。

## 2. 快速启动

```bash
npm install && npm run dev
```

打开 <http://localhost:5173>。

后端 Express 服务监听 `3001`，Vite 开发服务器把 `/api` 代理到后端，前端统一请求相对路径，无需配置 CORS。

**开箱即演示**：仓库随源码提交了一份只读演示存档 `server/data/scene.demo.json`。全新克隆、尚未点过「保存」时，`GET /api/scene` 会自动回退到这份存档，页面首屏即是完整画面（图元 + 管道），无需手工搭图或准备数据。点「保存」后写入的 `server/data/scene.json` 优先级更高，会覆盖演示存档；删掉它即可回到演示存档，详见第 12 节。

## 3. 架构说明

前端 Vue 3 + TypeScript + Pinia，画面用原生 Canvas 2D 渲染；后端 Node.js + Express 负责点位模拟、SSE 推送与画面持久化；两者之间只通过 REST 与 SSE 通信，设备数据全部由服务端模拟器产生，不接真实 PLC。

文字架构图：

```
browser ⇄ HTTP/SSE ⇄ simulator
```

```
┌─────────────┐   HTTP（/api/tag-templates、/api/devices、/api/tags、/api/scene）   ┌──────────────┐
│   browser   │ ⇄ ────────────────────────────────────────────────────────────── ⇄ │  simulator   │
│ Vue3+Canvas │   SSE（/api/stream，每秒推送 values + alarms）                       │ Express 模拟  │
└─────────────┘                                                                  └──────────────┘
```

- 浏览器：CanvasStage 常驻 `requestAnimationFrame` 重绘，读取 Pinia 中的图元/管道与实时值。
- 传输：REST 负责模板/设备/工程点位元数据与画面读写，SSE 负责单向实时推送。
- 模拟器：每个 SSE 连接持有独立模拟器，每秒 tick 一次；内部按 `<deviceNo>.<tagTemplateId>` 独立维护 24 个点位值并注入短时高报警。

## 4. 技术取舍

**为什么用原生 Canvas 2D 而不是 pixi.js。** demo 规模下只有几十个图元，Canvas 2D 足够流畅，且零运行时依赖、代码全部可读。真实组态画面上千图元、需要实时刷新时，应换成 pixi.js 借助 WebGL 做批量渲染与纹理复用。

**为什么用常驻 rAF 重绘。** 每秒都有实时值与报警闪烁需要更新，常驻重绘是最简单可靠的方案，不必手工推导哪一块需要重绘。生产环境应改为脏矩形重绘或分层 Canvas（静态背景层 + 动态数据层）以降低每帧成本。

**为什么用 SSE 而不是 WebSocket。** 本场景是服务端到浏览器的单向数据推送，SSE 基于普通 HTTP、协议更轻、浏览器自带断线重连，实现成本最低；WebSocket 的全双工能力在本 demo 中并没有使用场景。

## 5. 与真实组态软件的差距

真实组态软件还包含协议采集（Modbus、OPC UA 等）、实时数据库、历史趋势与报表、完整报警系统（确认、分级、联动）、脚本引擎、用户权限体系、多画面与工程管理等功能。

本 demo 只演示其中最小的核心闭环：**画面搭建 → 模板/设备绑定 → 地址自动解析 → 实时刷新 → 阈值报警 → 画面持久化**，用于说明数据模型与交互设计思路，不作为生产系统使用。

## 6. 目录结构

```
mini-scada/
├── package.json              # 根脚本：concurrently 同时启动前后端
├── server/
│   ├── index.js              # Express 入口：SSE + REST
│   ├── simulator.js          # 模板 × 设备号点位模拟器（random walk + 报警注入）
│   └── data/
│       ├── scene.demo.json   # 随仓库提交的只读演示存档（开箱即演示）
│       └── scene.json        # 运行时自动创建，用户点「保存」写入的画面（已被 .gitignore 忽略）
└── web/
    ├── vite.config.ts        # 开发端口 5173 与 /api 代理
    └── src/
        ├── App.vue           # 布局：工具栏 / 画布 / 属性面板 / 报警栏
        ├── main.ts
        ├── types.ts          # TagTemplate / Device / ResolvedTag / Element / Pipe / Scene 类型定义
        ├── stores/
        │   ├── scene.ts      # 图元与管道 CRUD、选中态、保存加载
        │   └── runtime.ts    # 元数据、SSE 连接、实时值、报警状态与报警历史
        ├── core/
        │   ├── draw.ts       # 渲染门面：drawElement 分派、选中框与整幅画面调度
        │   ├── primitives/   # 按图元拆分的绘制实现：base/grid/pipes/tank/motor/lamp/trend
        │   ├── hitTest.ts    # 点击命中检测
        │   └── migrate.ts    # v1 存档到模板 + 设备号的迁移
        └── components/
            ├── Toolbar.vue
            ├── CanvasStage.vue   # canvas + 鼠标交互 + rAF 重绘
            ├── PropertyPanel.vue
            ├── AlarmBar.vue      # 最近 5 条报警（默认按当前设备过滤，可切全部设备）
            └── ToastHost.vue
```

后端接口：

- `GET /api/tag-templates`：获取 8 条点位模板，模板包含地址基数和地址步长，不含具体设备号和地址。
- `GET /api/devices`：获取 3 台设备清单及每台设备的模板点位数（均为 8）。
- `GET /api/tags`：获取由「设备号 + 模板」解析出的 24 条工程点位表，`address` 只读。
- `GET /api/stream`：建立 SSE 连接，接收每秒点位数据与报警状态，key 为 `<deviceNo>.<tagTemplateId>`。
- `POST /api/scene`：保存画面 JSON（body 含 `elements` 与 `pipes`）。
- `GET /api/scene`：读取画面 JSON。优先返回运行时存档 `server/data/scene.json`，无存档或存档损坏时回退到随仓库提交的演示存档 `server/data/scene.demo.json`（响应头 `X-Scene-Source` 为 `saved` / `demo`）；两者都不可用时才返回 404，由前端载入内置预置画面。v1 旧存档由前端迁移后再载入。

## 7. 设备间接层（CN111781890A / CN121349456A）

本 demo 的点位绑定不再直接写死「一台设备 + 一个地址」，而是拆成两层：

1. **点位模板**：只定义名称、单位、量程、报警阈值、地址基数与地址步长。例如 `tpl.level` 的地址基数为 `10`、步长为 `2`。
2. **设备号**：设备表中 `deviceNo` 为 `1/2/3`，分别对应 `dev1/2/3`。图元只记录 `tagTemplateId + deviceNo`，画面数据结构中不保存通讯地址。

系统按以下规则解析：

```text
address = 'MW' + (addressBase + (deviceNo - 1) * addressStep)
key     = `${deviceNo}.${tagTemplateId}`
```

例如 `tpl.level + 1` 解析为 `1#液位 / MW10`，`tpl.level + 2` 解析为 `2#液位 / MW12`。因此同一份画面模板可以通过切换设备号实例化为不同设备的画面，地址由系统计算，画面不出现具体地址。

预置画面是「未指定设备实例的模板画面」，顶栏「设备号」下拉切换即切换整屏点位实例（1#/2#/3#）。报警栏默认只显示当前设备号的报警，可切换到「全部设备」查看所有实例的报警；无设备号的记录在按设备模式下始终显示。

前端绑定示例：

```json
{
  "id": "el_1",
  "type": "rect",
  "text": "1#水箱",
  "tagTemplateId": "tpl.level",
  "deviceNo": 1
}
```

v2 `Scene` 使用 `version: 2`；`web/src/core/migrate.ts` 会把旧版 `tagId`（如 `tank1.level`、`motor1.speed`）迁移为对应的模板和设备号，未知 `tagId` 保留图元但清空绑定。

## 8. 与厦门海为科技（Haiwell）的对齐说明

本 demo 在数据建模与产品形态上参考了公开专利信息，仅作演示性对齐，未使用 Haiwell 任何代码、接口或私有资料，全部为实现方自行设计。

- **动态设备与实际设备映射**：对齐 Haiwell 专利 `CN111781890A`《一种组态工程中多设备工程通讯方法及系统》。本 demo 用 `deviceNo` 标识实际设备实例，画面绑定模板而不是具体设备地址。
- **模板 + 序号 + 地址递增规则**：对齐 Haiwell 专利 `CN121349456A` 的思路。`TagTemplate.addressBase/addressStep` 定义地址规则，`ResolvedTag.address` 由后端解析生成。
- **大屏模式**：对齐 Haiwell 大屏控制器产品线（外观设计专利 `CN309478626S`，TVBOX4 Pro），提供网页版入门操作入口「大屏模式」。
- **后续可扩展方向**：可基于 Haiwell 专利 `CN119673146A`（基于语音识别的人机交互系统）为 HMI 增加语音指令能力。

## 9. 声明式画面描述层（JSON 指令）

在 `scene` JSON 之上增加一层声明式画面描述指令（JSON DSL），既支持「AI/文本生成画面」，也支持「一份模板 × N 台设备实例批量生成」。指令由 `web/src/core/describe.ts` 的 `applyOps` 解析为最小写操作，再由 `describeScene` 反向导出，对齐海为专利 `CN121349456A`（组态卡片模板 + 变量地址框 + 按序号批量生成）。

指令类型表：

| op | 语义 |
| --- | --- |
| `add` | 新增一个图元，`id` 由 store 按现有规则生成；尺寸/颜色缺省沿用工具栏 `+矩形/+圆形/+文本` 默认值 |
| `update` | 只覆盖 `patch` 中出现的字段，未涉及字段与对象引用保持不变 |
| `remove` | 删除图元，并删除与其相连的管道 |
| `pipe` | 连接两个已存在图元；端点不存在、自环或同向重复记入 `errors`，不抛异常 |
| `generate` | 按设备号数组批量生成图元实例 |
| `clear` | 清空全部图元与管道 |

`generate` 的设备号批量语义：对 `deviceNos` 中第 `i` 个设备（从 0 开始计数），图元位置为 `origin + gap * i`，同时写入 `deviceNo = deviceNos[i]` 与给定的 `tagTemplateId`；`textTemplate` 中的 `{n}` 会替换为该设备号，未提供时使用调用方传入的模板名。DSL 中禁止出现任何通讯地址字面量（如 `MW10`），地址一律由既有的「模板 + 设备号」解析逻辑计算，对应专利的「地址框自动绑定」。

双向幂等：`describeScene(scene)` 会把当前画面导出为 `clear + 每个图元的 add + 每条管道的 pipe`，对同一份快照再执行 `applyOps` 后，元素数、管道数与绑定字段（`tagTemplateId`、`deviceNo`）完全一致；导出指令本身也是该画面的等价描述，可反复应用。

`DescribePanel.vue` 提供可折叠的 JSON 文本入口，支持应用、导出当前画面、清空文本，并显示 `applied / 新增 / 更新 / 删除 / errors` 结果行。

## 10. 可写回与监控闭环（CN111781890A / CN111859350B）

闭环链路一句话：**画面上点击按钮图元 → `POST /api/write` 按「设备号 × 点位模板」解析地址并写值 → 服务端覆盖表生效 → SSE `/api/stream` 把新值推送回画面 → 数字读数与报警同步刷新**。设备号与模板到实际地址的映射仍由服务端解析（`CN111781890A`），每次写操作都做校验并写入审计留痕（`CN111859350B`）。

`POST /api/write`，请求体 `{ deviceNo: number, tagTemplateId: string, value: number }`：

| 场景 | 请求要点 | HTTP | `error` |
| --- | --- | --- | --- |
| 成功 | 可写模板且 `value` 在量程内 | 200 | 返回 `{ ok: true, deviceNo, tagTemplateId, value, address, expiresInTicks: 10 }` |
| 请求体非法 | body 非对象或缺字段 | 400 | `invalid_body` |
| 数值非法 | `value` 非有限数 | 400 | `invalid_value` |
| 设备不存在 | `deviceNo` 不在设备表 | 400 | `unknown_device` |
| 模板不存在 | `tagTemplateId` 不存在 | 400 | `unknown_template` |
| 模板不可写 | `writable === false` | 400 | `not_writable` |
| 超出量程 | `value` 不在 `[min, max]` 内 | 400 | `value_out_of_range` |

失败响应统一为 `{ ok: false, error: <code>, message: <中文说明> }`。

`GET /api/writes` 返回 `{ writes: [...] }`，为最近 50 条写入审计（新到旧，内存环形缓冲，不落盘）。每条记录为 `{ seq, ts, deviceNo, tagTemplateId, address, value, result: 'ok' | 'rejected', reason? }`；成功记 `ok`，失败记 `rejected` 且 `reason` 为对应错误码。

按钮图元交互：在运行态单击已绑定可写点位的按钮即触发写值，写入值在 `[min, max]` 内做**闭环切换**（当前值靠上限时切到量程 20%，否则切到量程 80%）；`mousedown → mouseup` 位移达到 4px 视为拖动，只移动图元而不写值；连线模式下也不写值。写值成功后由服务端覆盖表固定推送 **10 个 tick**，之后自动失效并恢复随机游走；写回请求进行中时同一图元再次点击会被忽略，避免重复下发。

## 11. 图元库（按钮、液位、电机、指示灯、趋势图）

在基础图元（矩形、圆形、文本）之外，工具栏提供 5 类面向工控画面的专用图元。它们复用同一套 `Element` 数据结构和「点位模板 + 设备号」绑定方式，只在渲染与交互上增加类型语义；类型联合见 `web/src/types.ts`，绘制实现按图元拆分到 `web/src/core/primitives/`，`web/src/core/draw.ts` 保留为渲染门面（调度 + 向后兼容导出）。

| 图元 | `type` | 默认尺寸 | 运行时表现 | 交互与绑定要点 |
| --- | --- | --- | --- | --- |
| 按钮 | `button` | 120 × 48 | 圆角矩形，绑定值后显示点位名与实时读数 | 只允许选择 `writable: true` 的模板；运行态单击触发写回 |
| 液位 | `tank` | 120 × 160 | 按当前值在量程中的比例从底部填充，并绘制液面高亮线 | 越限时叠加报警描边；无值或未绑定时不填充 |
| 电机 | `motor` | 100 × 100 | 三叶轮旋转，转速与 `value / max` 成正比 | 值为 0、无值或报警时冻结；旋转角只存在于渲染内存 |
| 指示灯 | `lamp` | 60 × 60 | 有值显示绿色光晕，报警时红色闪烁，无值或未绑定显示灰色 | 仅表达点位状态，不产生写操作 |
| 趋势图 | `trend` | 260 × 140 | 绘制最近 60 个采样点，量程取模板 `min/max` 并按越界样本扩展 | 越限线段标红；历史只保存在前端运行时内存 |

所有专用图元都沿用属性面板中的位置、尺寸、填充色、文字、点位模板与设备号字段，并参与选中、拖动、图层顺序、撤销/重做和 `scene.json` 持久化。未显式指定设备号时，运行时读取顶栏当前设备号；因此同一份画面可在 1#、2#、3# 设备实例间切换。

**按钮写回闭环。** 按钮点击不是本地改数，而是调用第 10 节的 `POST /api/write`：前端先按模板量程计算闭环切换值（当前值靠上限时切到量程 20%，否则切到量程 80%），服务端校验并解析地址，SSE 再把覆盖值推回画面。`mousedown → mouseup` 位移达到 4px 视为拖动，只移动图元；连线模式下也不触发写值。写回进行中会忽略同一图元的重复点击。

**趋势图的 60 点窗口。** `runtime.ts` 每秒把 SSE 值追加到按 `<deviceNo>.<tagTemplateId>` 索引的环形历史中，每个点位最多保留 60 点；`draw.ts` 也只绘制最近 60 点。历史窗口有固定内存上界，且不写入 `scene.json`，刷新页面后重新积累。

**报警表现。** 液位和电机在越限时叠加 3px 红色报警描边，电机同时冻结旋转；指示灯按报警闪烁周期切到红色；趋势图把命中报警阈值的相邻线段直接标红。按钮、矩形和圆形仍复用统一的闪烁填充与 3px 红色报警描边；文本图元只叠加红色描边。

**面试时可直接讲的两个设计点：**

1. **数据结构统一，渲染按类型分派。** 新增图元没有引入新的持久化模型，仍是 `Element.type` 的可辨识联合；这样迁移、命中检测、绑定解析与保存逻辑不用为每种图元复制一遍。
2. **高频渲染态与文档态分离。** 电机旋转角和趋势图历史都不进入 `scene.json`，只存在于 Canvas 运行时；场景文件保持可读、稳定，刷新后由实时数据重新驱动视觉状态。

## P1 编辑能力（相对开发文档 §8 的扩展）

开发文档 §8 的负面清单默认不做以下交互；本节记录用户明确点名的扩展项，范围仅限点名项，其余清单项仍保持不做。

- **撤销/重做**：`Cmd/Ctrl+Z` 撤销、`Cmd/Ctrl+Shift+Z` 重做，历史栈上限 50 条（`web/src/stores/scene.ts` 的 `HISTORY_LIMIT`）。`scene.json` 不记录历史。
- **图层上移/下移**：属性面板提供「上移一层 / 下移一层」，`elements` 数组顺序即图层，末尾最上层（`web/src/stores/scene.ts` 的 `bringForward/sendBackward`）。
- **缩放/平移**：缩放范围 0.5–2；滚轮向上放大、向下缩小（1.1 步进），中键拖拽或按住空格 + 左键拖拽平移，按 `0` 重置视图（`web/src/stores/view.ts`、`web/src/components/CanvasStage.vue`）。视图状态不写入 `scene.json`。
- **网格吸附**：吸附间距 10px，工具栏「吸附」开关默认开启（`web/src/stores/view.ts` 的 `GRID`、`web/src/components/Toolbar.vue`）；开启时拖动落点与新增图元的初始落点均吸附到最近的 10 的倍数。
- **框选多选**：空白处按住左键拖拽画出橡皮筋选框，与选择框相交的图元全部选中；`Shift + 点击` 追加/移除单选；拖动任一已选图元整组同一位移移动；`Delete/Backspace` 删除全部选中；属性面板在多选时显示「已选中 N 个图元」与「删除选中」（`web/src/components/CanvasStage.vue`、`web/src/components/PropertyPanel.vue`）。

以上仅为用户点名的扩展；开发文档 §8 负面清单中的其余项（图元缩放手柄、复制粘贴、对齐辅助线、右键菜单等）仍不做。

## 12. 演示存档与仓库卫生（发版准备）

为了让克隆下来的仓库「开箱即演示」，同时不把本地运行痕迹带上 GitHub，画面数据分成两份、忽略规则分成三组。

### 12.1 两份画面文件

| 文件 | 是否提交 | 写入方 | 作用 |
| --- | --- | --- | --- |
| `server/data/scene.demo.json` | 提交（随源码固化） | 只读，服务端与用户都不写 | 全新克隆时的兜底画面，保证首屏就有完整画面 |
| `server/data/scene.json` | 不提交（`.gitignore` 忽略） | 用户点「保存」时写入 | 本地运行时存档，反映当前编辑结果 |

读取优先级：`GET /api/scene` 先读 `scene.json`，读不到或文件损坏时回退 `scene.demo.json`；两者都没有才返回 404，前端再载入内置预置画面。响应头 `X-Scene-Source` 会标明本次画面来自 `saved` 还是 `demo`，便于排查「我看到的到底是哪一份」。

演示存档里的图元是「未指定设备实例的模板画面」（`deviceNo: null`），因此顶栏切换设备号时整屏点位实例照常联动，不带任何硬编码的通讯地址。演示存档包含全部 8 类图元（10 个）与 6 条管道，覆盖液位、电机、指示灯、趋势图与两个可写按钮。

### 12.2 如何复位演示

要回到「开箱即演示」的初始画面，删除运行时存档再刷新即可：

```bash
rm -f server/data/scene.json    # 删除后 GET /api/scene 自动回退 scene.demo.json
```

不要手改 `scene.demo.json` 来保存画面——它随仓库提交、只读；所有编辑结果应通过界面「保存」写入 `scene.json`。若确实要更新固化的演示画面，改完后需连同仓库一起提交。

### 12.3 `.gitignore` 覆盖范围

| 分组 | 规则 | 原因 |
| --- | --- | --- |
| 依赖目录 | `node_modules/` | 由 `npm install` 生成，不入库 |
| 构建产物 | `web/dist/`、`web/tsconfig.tsbuildinfo` | `npm run build` 与 `vue-tsc -b` 的产物，可随时重建 |
| 运行时数据 | `server/data/scene.json` | 用户保存的本地画面；演示存档 `scene.demo.json` 不受影响 |
| 日志与系统杂物 | `*.log`、`npm-debug.log*`、`.DS_Store` | 日志与 macOS 元数据文件 |

`scene.demo.json` 特意不匹配 `server/data/scene.json` 这条规则，所以它会被正常提交；`.gitignore` 中对该例外也写了注释说明。
