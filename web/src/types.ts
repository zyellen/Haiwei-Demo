// types.ts：定义组态画面与运行时数据的前端类型契约，字段严格对齐 TASK-007 v2 结构。
// 仅做类型声明，不含任何运行时代码，供 store、core 与组件共享。

// 点位模板：不含设备号与具体地址，只声明量程、报警阈值与地址递增规则。
export interface TagTemplate {
  tagTemplateId: string;
  name: string;
  unit: string;
  min: number;
  max: number;
  alarmLow: number | null;
  alarmHigh: number | null;
  addressBase: number;
  addressStep: number;
  writable: boolean;
}

// 设备（Device）：组态工程内的一台采集设备，deviceNo 从 1 起且连续。
export interface Device {
  deviceNo: number;
  deviceId: string;
  name: string;
  protocol: string;
  host: string;
  port: number;
  slaveId: number;
  tagCount: number;
}

// 工程点位表（ResolvedTag）：由设备号与模板解析出的只读点位定义。
export interface ResolvedTag {
  key: string;
  deviceNo: number;
  tagTemplateId: string;
  name: string;
  unit: string;
  min: number;
  max: number;
  alarmLow: number | null;
  alarmHigh: number | null;
  address: string;
}

// 图元（Element）：画面上的一个元素，绑定由点位模板与设备号共同决定。
export interface Element {
  id: string;
  type: 'rect' | 'circle' | 'label' | 'button' | 'tank' | 'motor' | 'lamp' | 'trend';
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  text: string;
  tagTemplateId: string | null;
  deviceNo: number | null;
}

// 管道连线（Pipe）：连接两个图元中心，由 fromId 指向 toId。
export interface Pipe {
  id: string;
  fromId: string;
  toId: string;
}

// 画面（Scene）：整个画布的持久化单元，当前版本为 2。
export interface Scene {
  version: 2;
  elements: Element[];
  pipes: Pipe[];
  savedAt: string;
}
