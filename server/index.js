// index.js：Express 入口，提供模板/设备/工程点位查询、可写回、SSE 实时推送与画面持久化 REST 接口。
// 当前仅覆盖 demo 后端范围，不包含前端静态托管与额外日志中间件。

const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  getTagTemplates,
  getDevices,
  getResolvedTags,
  createSimulator,
  writeValue,
  recordWrite,
  getWrites,
  WRITE_OVERRIDE_TICKS
} = require('./simulator');

const app = express();
const PORT = 3001;
const DATA_DIR = path.join(__dirname, 'data');
// 运行时保存的画面：用户点「保存」后写入，随仓库 .gitignore 忽略。
const SCENE_FILE = path.join(DATA_DIR, 'scene.json');
// 随仓库提交的演示存档：无运行时存档时作为「开箱即演示」的兜底画面，只读不写。
const DEMO_SCENE_FILE = path.join(DATA_DIR, 'scene.demo.json');

// 连接集合用于客户端断开时清理，每连接使用自己的定时器与模拟器。
const connections = new Set();

app.use(express.json({ limit: '2mb' }));

// 请求体已成功解析但并非 JSON 对象（如裸量/数组）时，统一返回 invalid_json。
// 严格模式下的畸形 JSON、裸量会在 express.json 内抛出 entity.parse.failed，由下方错误中间件兜底。
app.use((req, res, next) => {
  const body = req.body;
  if (body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body))) {
    return res.status(400).json({ ok: false, error: 'invalid_json' });
  }
  return next();
});

// 返回点位模板；模板不含设备号与具体地址，只声明地址计算规则与可写性。
app.get('/api/tag-templates', (req, res) => {
  res.status(200).json(getTagTemplates());
});

// 返回组态工程级设备表，供前端设备号下拉与属性面板展示。
app.get('/api/devices', (req, res) => {
  res.status(200).json(getDevices());
});

// 返回由「设备号 + 模板」解析后的工程点位表，地址不接受客户端指定。
app.get('/api/tags', (req, res) => {
  res.status(200).json(getResolvedTags());
});

// 返回最近写入审计记录，数组顺序为新到旧。
app.get('/api/writes', (req, res) => {
  res.status(200).json({ writes: getWrites() });
});

// 错误码到中文提示的固定映射，保证前端 Toast 与接口验收使用同一套语义。
const WRITE_ERROR_MESSAGES = {
  invalid_body: '请求体必须是包含 deviceNo、tagTemplateId 和 value 的对象',
  invalid_value: 'value 必须是有限数',
  unknown_device: '设备号不存在',
  unknown_template: '点位模板不存在',
  not_writable: '该点位模板不可写',
  value_out_of_range: 'value 超出模板量程'
};

// 失败审计：尽可能保留请求上下文与可解析地址，便于前端与接口验收排查。
function auditRejected(body, reason) {
  const request = body !== null && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const deviceNo = Object.prototype.hasOwnProperty.call(request, 'deviceNo') ? request.deviceNo : null;
  const tagTemplateId = Object.prototype.hasOwnProperty.call(request, 'tagTemplateId')
    ? request.tagTemplateId
    : null;
  const tag = getResolvedTags().find(
    (item) => item.deviceNo === deviceNo && item.tagTemplateId === tagTemplateId
  );

  recordWrite({
    deviceNo,
    tagTemplateId,
    address: tag?.address ?? null,
    value: Object.prototype.hasOwnProperty.call(request, 'value') ? request.value : null,
    result: 'rejected',
    reason
  });
}

// 写入路径统一返回错误码与中文说明；无论成功失败都写审计记录。
app.post('/api/write', (req, res) => {
  const body = req.body;
  const isBodyObject = body !== null && typeof body === 'object' && !Array.isArray(body);
  if (
    !isBodyObject ||
    !Object.prototype.hasOwnProperty.call(body, 'deviceNo') ||
    !Object.prototype.hasOwnProperty.call(body, 'tagTemplateId') ||
    !Object.prototype.hasOwnProperty.call(body, 'value')
  ) {
    auditRejected(body, 'invalid_body');
    return res.status(400).json({
      ok: false,
      error: 'invalid_body',
      message: WRITE_ERROR_MESSAGES.invalid_body
    });
  }

  const { deviceNo, tagTemplateId, value } = body;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    auditRejected(body, 'invalid_value');
    return res.status(400).json({
      ok: false,
      error: 'invalid_value',
      message: WRITE_ERROR_MESSAGES.invalid_value
    });
  }

  const device = getDevices().find((item) => item.deviceNo === deviceNo);
  if (device === undefined) {
    auditRejected(body, 'unknown_device');
    return res.status(400).json({
      ok: false,
      error: 'unknown_device',
      message: WRITE_ERROR_MESSAGES.unknown_device
    });
  }

  const template = getTagTemplates().find((item) => item.tagTemplateId === tagTemplateId);
  if (template === undefined) {
    auditRejected(body, 'unknown_template');
    return res.status(400).json({
      ok: false,
      error: 'unknown_template',
      message: WRITE_ERROR_MESSAGES.unknown_template
    });
  }

  const tag = getResolvedTags().find(
    (item) => item.deviceNo === deviceNo && item.tagTemplateId === tagTemplateId
  );
  if (tag === undefined) {
    auditRejected(body, 'unknown_template');
    return res.status(400).json({
      ok: false,
      error: 'unknown_template',
      message: WRITE_ERROR_MESSAGES.unknown_template
    });
  }

  if (template.writable !== true) {
    auditRejected(body, 'not_writable');
    return res.status(400).json({
      ok: false,
      error: 'not_writable',
      message: WRITE_ERROR_MESSAGES.not_writable
    });
  }

  if (value < template.min || value > template.max) {
    auditRejected(body, 'value_out_of_range');
    return res.status(400).json({
      ok: false,
      error: 'value_out_of_range',
      message: WRITE_ERROR_MESSAGES.value_out_of_range
    });
  }

  const result = writeValue(deviceNo, tagTemplateId, value);
  if (result === null) {
    auditRejected(body, 'unknown_template');
    return res.status(400).json({
      ok: false,
      error: 'unknown_template',
      message: WRITE_ERROR_MESSAGES.unknown_template
    });
  }

  recordWrite({
    deviceNo,
    tagTemplateId,
    address: result.address,
    value: result.value,
    result: 'ok'
  });

  return res.status(200).json({
    ok: true,
    deviceNo,
    tagTemplateId,
    value: result.value,
    address: result.address,
    expiresInTicks: WRITE_OVERRIDE_TICKS
  });
});

// SSE 端点：每个连接独立 tick，不共享全局 interval，避免多客户端相互影响。
// 写值覆盖表在 simulator 模块级共享，因此 POST 会作用于所有活动与后续 SSE 连接。
app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders();

  const simulator = createSimulator();
  connections.add(res);

  const tickTimer = setInterval(() => {
    simulator.tick();
    const payload = {
      ts: Date.now(),
      values: simulator.getValues(),
      alarms: simulator.getAlarms()
    };

    res.write(`event: tags\ndata: ${JSON.stringify(payload)}\n\n`);
  }, 1000);

  // 每 15 秒发送 SSE 注释心跳，减少代理或浏览器主动断开连接的概率。
  const heartbeatTimer = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);

  // 客户端断开时同时清理两个定时器与连接集合，避免内存和任务泄漏。
  req.on('close', () => {
    clearInterval(tickTimer);
    clearInterval(heartbeatTimer);
    connections.delete(res);
  });
});

// 保存完整 Scene JSON；仅做最小结构校验，具体图元校验由前端编辑器负责。
app.post('/api/scene', (req, res) => {
  const scene = req.body;
  const isValidScene = scene && typeof scene === 'object' && !Array.isArray(scene) && Array.isArray(scene.elements);

  if (!isValidScene) {
    return res.status(400).json({ error: 'invalid scene' });
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SCENE_FILE, JSON.stringify(scene, null, 2), 'utf8');
  return res.status(200).json({ ok: true });
});

// 读取画面：优先返回运行时保存的 scene.json；若无（如全新克隆），回退到随仓库提交的
// scene.demo.json，保证「开箱即演示」。两者都不存在时才返回 404，由前端载入内置预置画面。
// version 1 旧存档原样返回，由前端负责迁移；响应头 X-Scene-Source 标明画面来源。
app.get('/api/scene', (req, res) => {
  // 运行时存档优先；解析失败按「无存档」处理并继续回退，避免损坏文件挡住演示。
  if (fs.existsSync(SCENE_FILE)) {
    try {
      const scene = JSON.parse(fs.readFileSync(SCENE_FILE, 'utf8'));
      res.set('X-Scene-Source', 'saved');
      return res.status(200).json(scene);
    } catch (error) {
      console.warn('[scene] 运行时存档解析失败，回退演示存档:', error.message);
    }
  }

  // 演示存档是只读兜底，永不写回；缺失或损坏则视为无存档。
  try {
    const demoScene = JSON.parse(fs.readFileSync(DEMO_SCENE_FILE, 'utf8'));
    res.set('X-Scene-Source', 'demo');
    return res.status(200).json(demoScene);
  } catch (error) {
    return res.status(404).json({ error: 'no scene saved' });
  }
});

// 统一 JSON 解析错误：body-parser 解析失败时返回 JSON 400，替代 Express 默认 HTML 错误页。
// 其余错误继续交给后续错误处理（此处仅收敛 entity.parse.failed）。
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, error: 'invalid_json' });
  }
  return next(err);
});

// 直接运行时才监听端口；被 require 时只导出 app，便于在无网络环境下做路由级校验。
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[server] Mini SCADA 后端已启动: http://localhost:${PORT}`);
  });
}

module.exports = app;
