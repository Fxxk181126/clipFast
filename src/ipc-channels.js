// IPC 通道名单一真身：main（收/发）从这里 require；
// preload 因沙箱限制无法 require 本地文件，只能内联同名字面量（见 preload.js，两处需同步修改）
module.exports = {
  // 渲染进程 -> 主进程（invoke/handle）
  RECORDS_LIST: 'records:list',
  RECORDS_DELETE: 'records:delete',
  RECORDS_FAVORITE: 'records:favorite',
  RECORDS_PASTE: 'records:paste',
  RECORDS_UNDO_MOVE: 'records:undoMove',
  RECORDS_CLEAR: 'records:clear',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET_SHORTCUT: 'settings:setShortcut',
  // 主进程 -> 渲染进程（send/on 事件）
  EV_NEW: 'records:new',
  EV_MOVED: 'records:moved',
  EV_UNDOED: 'records:undoed',
  EV_PRUNED: 'records:pruned'
}
