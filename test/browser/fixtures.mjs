// Shapes the replay server serves. Kept in their own module so a contract test
// can compare them with a real capture — a hand-written fixture that drifts
// from the real response renders fine and proves nothing.

export const ITEM = (key, size, days, extra) => ({
  key, path: key, kind: 'scratch', tier: extra && extra.tier || 'safe',
  size, mtime: Date.now() - days * 86400000, ageDays: days,
  refs: 0, uses: 0, failed: false, tracked: false,
  reasons: [extra && extra.reason || '位于 .scratch 的一次性脚本，产生后再没被引用过'],
  session: { id: 'session-1e39c0aa', title: 'P4b mock launch' },
  tool: 'write', turn: 3, step: 2, at: Date.now() - days * 86400000,
})

export const REPORT = {
  generatedAt: 1795278000000,
  token: 'tk-harness',
  trashRoot: 'C:\\Users\\demo\\.dsh\\plugin-data\\dsh-sweeper\\trash',
  ageMs: 1200, durationMs: 9700, weekDays: 7, truncated: false, unreadable: 0,
  lastError: null,
  stats: { sessions: 46, events: 100464, toolCalls: 16400, artifacts: 578, errors: 420, openJobs: 6, ms: 9700 },
  protected: { recent: 66, live: 15, tracked: 0, gone: 92, unsafe: 0 },
  tiers: { safe: { count: 2, bytes: 6003 }, unsure: { count: 1, bytes: 1786 } },
  items: [
    ITEM('D:\\OpenFuture\\.scratch\\launch-p4b.ps1', 896, 12),
    ITEM('D:\\OpenFuture\\.scratch\\probe.sh', 39, 12),
    ITEM('D:\\OpenFuture\\.scratch\\graph-restore.ts', 1786, 9, { tier: 'unsure', reason: '临时文件，但之后被工具读取过一次' }),
  ],
}

export const SESSIONS = [
  { id: 'session-1e39c0aa', title: 'P4b mock launch', cwd: 'D:\\OpenFuture', ageDays: 12, toolCalls: 61, candidates: 5, hidden: 12, estTokens: 994 },
  { id: 'session-aa8200b1', title: 'ICCV figure export', cwd: 'C:\\Users\\demo\\Desktop\\iccv', ageDays: 21, toolCalls: 130, candidates: 3, estTokens: 1180 },
  { id: 'session-458d1c02', title: 'v02a UI smoke', cwd: 'D:\\OpenFuture', ageDays: 8, toolCalls: 22, candidates: 2, estTokens: 640 },
]

export const SWEEP = [
  ITEM('D:\\OpenFuture\\.scratch\\launch-p4b.ps1', 896, 12),
  ITEM('D:\\OpenFuture\\.scratch\\probe.sh', 39, 12),
  ITEM('D:\\OpenFuture\\.scratch\\start-p4b-mock.ps1', 851, 12),
  ITEM('D:\\OpenFuture\\.scratch\\launch-p3.2.ps1', 960, 14),
  ITEM('D:\\OpenFuture\\.scratch\\v02a-ui-test.mjs', 8399, 11),
  ITEM('C:\\Users\\demo\\Desktop\\iccv\\tmp\\figure-32.png', 41210, 20),
  ITEM('C:\\Users\\demo\\Desktop\\iccv\\tmp\\plot_ablation.py', 2210, 20),
]
