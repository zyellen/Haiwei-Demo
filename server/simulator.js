// simulator.js：按「点位模板 × 设备号」维护 24 个模拟点位，执行 random walk 并注入短时高报警。
// 对外提供当前值、报警状态与单次 tick 能力，供 SSE 连接独立驱动；写值覆盖表由各实例独立消费。

// 写入覆盖有效 tick 数与审计环形缓冲容量。
const WRITE_OVERRIDE_TICKS = 10;
// 覆盖表按 tick 语义生效，另给 1 个 tick 的宽限；超过窗口的写入视为已自动失效，
// 防止写入很久之后才新建的 SSE 连接把历史写值重放出来。
const WRITE_OVERRIDE_TTL_MS = WRITE_OVERRIDE_TICKS * 1000 + 1000;
const WRITE_AUDIT_LIMIT = 50;

// 点位模板不含设备号与具体地址，只声明量程、报警阈值、地址递增规则与可写性。
const TAG_TEMPLATES = [
  {
    tagTemplateId: 'tpl.level',
    name: '液位',
    unit: '%',
    min: 0,
    max: 100,
    alarmLow: 10,
    alarmHigh: 90,
    addressBase: 10,
    addressStep: 2,
    writable: false
  },
  {
    tagTemplateId: 'tpl.temp',
    name: '温度',
    unit: '℃',
    min: 20,
    max: 90,
    alarmLow: null,
    alarmHigh: 80,
    addressBase: 20,
    addressStep: 2,
    writable: false
  },
  {
    tagTemplateId: 'tpl.pressure',
    name: '出口压力',
    unit: 'MPa',
    min: 0,
    max: 2.5,
    alarmLow: 0.2,
    alarmHigh: 2,
    addressBase: 30,
    addressStep: 2,
    writable: false
  },
  {
    tagTemplateId: 'tpl.speed',
    name: '转速',
    unit: 'rpm',
    min: 0,
    max: 3000,
    alarmLow: 200,
    alarmHigh: 2500,
    addressBase: 40,
    addressStep: 2,
    writable: false
  },
  {
    tagTemplateId: 'tpl.current',
    name: '电流',
    unit: 'A',
    min: 0,
    max: 50,
    alarmLow: null,
    alarmHigh: 40,
    addressBase: 50,
    addressStep: 2,
    writable: false
  },
  {
    tagTemplateId: 'tpl.valve',
    name: '阀门开度',
    unit: '%',
    min: 0,
    max: 100,
    alarmLow: null,
    alarmHigh: null,
    addressBase: 60,
    addressStep: 2,
    writable: true
  },
  {
    tagTemplateId: 'tpl.flow',
    name: '流量',
    unit: 'm³/h',
    min: 0,
    max: 200,
    alarmLow: null,
    alarmHigh: 180,
    addressBase: 70,
    addressStep: 2,
    writable: false
  },
  {
    tagTemplateId: 'tpl.setpoint',
    name: '设定值',
    unit: '%',
    min: 0,
    max: 100,
    alarmLow: null,
    alarmHigh: null,
    addressBase: 80,
    addressStep: 2,
    writable: true
  }
];

// 组态工程内的 3 台模拟 Modbus TCP 从站设备。
const DEVICES = [
  {
    deviceNo: 1,
    deviceId: 'dev1',
    name: '1号锅炉PLC',
    protocol: 'Modbus TCP',
    host: '192.168.1.11',
    port: 502,
    slaveId: 1,
    tagCount: TAG_TEMPLATES.length
  },
  {
    deviceNo: 2,
    deviceId: 'dev2',
    name: '2号空压机PLC',
    protocol: 'Modbus TCP',
    host: '192.168.1.12',
    port: 502,
    slaveId: 1,
    tagCount: TAG_TEMPLATES.length
  },
  {
    deviceNo: 3,
    deviceId: 'dev3',
    name: '3号水处理PLC',
    protocol: 'Modbus TCP',
    host: '192.168.1.13',
    port: 502,
    slaveId: 1,
    tagCount: TAG_TEMPLATES.length
  }
];

// 工程点位表由模板和设备号解析生成，地址始终在服务端按规则计算。
const RESOLVED_TAGS = DEVICES.flatMap((device) =>
  TAG_TEMPLATES.map((template) => ({
    key: `${device.deviceNo}.${template.tagTemplateId}`,
    deviceNo: device.deviceNo,
    tagTemplateId: template.tagTemplateId,
    name: `${device.deviceNo}#${template.name}`,
    unit: template.unit,
    min: template.min,
    max: template.max,
    alarmLow: template.alarmLow,
    alarmHigh: template.alarmHigh,
    address: `MW${template.addressBase + (device.deviceNo - 1) * template.addressStep}`,
    writable: template.writable
  }))
);

// 模板初值固定且各设备独立持有；该映射不属于点位模板公开字段。
const INITIAL_VALUES_BY_TEMPLATE = {
  'tpl.level': 65,
  'tpl.temp': 45,
  'tpl.pressure': 1.2,
  'tpl.speed': 1450,
  'tpl.current': 22,
  'tpl.valve': 60,
  'tpl.flow': 80,
  'tpl.setpoint': 50
};

// 写入覆盖表在模块级共享，SSE 连接各自持有模拟器时都能看到最新写入。
const WRITE_OVERRIDES = new Map();
let writeOverrideVersion = 0;

// 审计记录只保存在内存中，最多保留最近 50 条。
const WRITE_AUDIT = [];
let writeAuditSequence = 0;

// 返回工程级设备表副本，避免调用方修改模块级定义。
function getDevices() {
  return DEVICES.map((device) => ({ ...device }));
}

// 返回点位模板副本，供前端属性面板与外部接口只读使用。
function getTagTemplates() {
  return TAG_TEMPLATES.map((template) => ({ ...template }));
}

// 返回解析后的工程点位表副本。
function getResolvedTags() {
  return RESOLVED_TAGS.map((tag) => ({ ...tag }));
}

// 写入覆盖：按模板量程兜底钳制，并返回解析后的地址与钳制值。
function writeValue(deviceNo, tagTemplateId, value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const tag = RESOLVED_TAGS.find(
    (item) => item.deviceNo === deviceNo && item.tagTemplateId === tagTemplateId
  );
  if (tag === undefined) {
    return null;
  }

  const clampedValue = Math.min(tag.max, Math.max(tag.min, value));
  writeOverrideVersion += 1;
  WRITE_OVERRIDES.set(tag.key, {
    value: clampedValue,
    version: writeOverrideVersion,
    expiresAt: Date.now() + WRITE_OVERRIDE_TTL_MS
  });
  return {
    value: clampedValue,
    address: tag.address
  };
}

// 追加一条审计记录；无论成功或失败，路由层都通过此函数留痕。
function recordWrite({ deviceNo, tagTemplateId, address, value, result, reason }) {
  writeAuditSequence += 1;
  const record = {
    seq: writeAuditSequence,
    ts: Date.now(),
    deviceNo,
    tagTemplateId,
    address,
    value,
    result
  };
  if (reason !== undefined) {
    record.reason = reason;
  }
  WRITE_AUDIT.push(record);
  if (WRITE_AUDIT.length > WRITE_AUDIT_LIMIT) {
    WRITE_AUDIT.shift();
  }
}

// 返回最近写入记录副本，数组顺序为新到旧。
function getWrites() {
  return WRITE_AUDIT.slice().reverse().map((record) => ({ ...record }));
}

// 创建一个独立模拟器实例；写值覆盖的剩余 tick 由实例自行持有。
function createSimulator() {
  const values = Object.fromEntries(
    RESOLVED_TAGS.map((tag) => [tag.key, INITIAL_VALUES_BY_TEMPLATE[tag.tagTemplateId]])
  );
  const alarmTicks = Object.fromEntries(RESOLVED_TAGS.map((tag) => [tag.key, 0]));
  // key -> { version, remaining }；新写入会通过 version 变化重新计满 10 tick。
  const writeTicks = new Map();
  let alarms = {};

  // 消费一个覆盖 tick：同一次写入在每个 SSE 模拟器中各持续 10 tick。
  function consumeWriteOverride(key) {
    const override = WRITE_OVERRIDES.get(key);
    if (override === undefined) {
      return undefined;
    }
    // 超过 TTL 的写入自动失效并从覆盖表移除，之后恢复随机游走。
    if (Date.now() >= override.expiresAt) {
      WRITE_OVERRIDES.delete(key);
      writeTicks.delete(key);
      return undefined;
    }

    let state = writeTicks.get(key);
    if (state === undefined || state.version !== override.version) {
      state = { version: override.version, remaining: WRITE_OVERRIDE_TICKS };
      writeTicks.set(key, state);
    }
    if (state.remaining <= 0) {
      return undefined;
    }
    state.remaining -= 1;
    return override.value;
  }

  // 执行一次同步更新：先应用写值覆盖，再推进普通点位、持续报警与新报警注入。
  function tick() {
    const nextAlarms = {};

    for (const tag of RESOLVED_TAGS) {
      const { key, min, max, alarmHigh } = tag;

      // 写值覆盖期间固定推送写入值，不参与随机游走或报警注入。
      const overrideValue = consumeWriteOverride(key);
      if (overrideValue !== undefined) {
        values[key] = overrideValue;
        continue;
      }

      // 已处于报警态时强制保持高报警值，并消耗一个持续 tick，不重复掷骰子。
      if (alarmTicks[key] > 0) {
        values[key] = alarmHigh + (max - min) * 0.06;
        nextAlarms[key] = 'high';
        alarmTicks[key] -= 1;
        continue;
      }

      // 普通状态按范围比例做 random walk，并限制在量程内。
      let value = values[key] + (Math.random() - 0.5) * (max - min) * 0.04;
      value = Math.min(max, Math.max(min, value));
      values[key] = value;

      // 仅 alarmHigh 非 null 的点位参与高报警注入，alarmLow 本次只保留定义。
      if (alarmHigh !== null && Math.random() < 0.04) {
        values[key] = alarmHigh + (max - min) * 0.06;
        // ASSUMPTION: 进入报警的当前 tick 计为第 1 次，因此剩余计数设为 2，共持续 3 个 tick。
        alarmTicks[key] = 2;
        nextAlarms[key] = 'high';
      }
    }

    alarms = nextAlarms;
  }

  // 推送前统一保留 1 位小数，返回浅拷贝避免调用方修改内部状态。
  function getValues() {
    const roundedValues = {};
    for (const tag of RESOLVED_TAGS) {
      roundedValues[tag.key] = Math.round(values[tag.key] * 10) / 10;
    }
    return roundedValues;
  }

  // 正常点位不进入 alarms，无报警时返回空对象。
  function getAlarms() {
    return { ...alarms };
  }

  return {
    tick,
    getValues,
    getAlarms,
    writeValue
  };
}

module.exports = {
  TAG_TEMPLATES,
  DEVICES,
  RESOLVED_TAGS,
  WRITE_OVERRIDE_TICKS,
  getDevices,
  getResolvedTags,
  getTagTemplates,
  createSimulator,
  writeValue,
  recordWrite,
  getWrites
};
