/* 协作舱布局。运行时真源；assets/rooms/office.json 是它的生成快照（只读）。
   改这里，然后跑 `node scripts/sync-room-layout.cjs` 同步快照。
   x / y 为相对画布的归一化坐标，y 是物体接地线（底边），用来做深度排序。 */
window.__ROOM_LAYOUT = {
  id: 'office-01',
  name: '协作舱',
  wallRatio: 0.24,
  props: [
    { id: 'desk-a', type: 'desk', code: 'PC-01', name: '工位', plateSide: 'right', x: 0.18, y: 0.42, w: 158, flip: false,
      seats: [{ x: 0.18, y: 0.53, role: 'work' }] },
    { id: 'desk-b', type: 'desk', code: 'PC-02', name: '工位', plateSide: 'right', x: 0.38, y: 0.42, w: 158, flip: true,
      seats: [{ x: 0.38, y: 0.53, role: 'work' }] },
    { id: 'plant-a', type: 'plant', code: 'GRN-01', name: '绿植', plateSide: 'right', x: 0.515, y: 0.375, w: 62 },
    { id: 'rack', type: 'rack', code: 'SRV-01', name: '机柜', plateSide: 'center', x: 0.055, y: 0.585, w: 80,
      seats: [{ x: 0.135, y: 0.655, role: 'work' }] },
    { id: 'cafe', type: 'cafe', code: 'BRW-01', name: '咖啡台', plateSide: 'left', x: 0.66, y: 0.44, w: 122,
      seats: [{ x: 0.66, y: 0.55, role: 'rest' }] },
    { id: 'sofa', type: 'sofa', code: 'LNG-01', name: '休息位', plateSide: 'left', x: 0.855, y: 0.60, w: 180,
      seats: [{ x: 0.845, y: 0.69, role: 'rest' }, { x: 0.905, y: 0.665, role: 'rest' }] },
  ],
  fallbackSeats: [
    { x: 0.07, y: 0.70, role: 'any' },
    { x: 0.23, y: 0.70, role: 'any' },
    { x: 0.39, y: 0.70, role: 'any' },
    { x: 0.55, y: 0.70, role: 'any' },
    { x: 0.71, y: 0.70, role: 'any' },
    { x: 0.87, y: 0.70, role: 'any' },
  ],
};
