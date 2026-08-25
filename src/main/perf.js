// 启动/加载里程碑观测：ND_PERF=1 时输出相对耗时，默认零开销
function createPerf({ enabled = false, now = () => Date.now(), log = (m) => console.log(m) } = {}) {
  const t0 = now();
  return {
    mark(name) {
      if (enabled) log(`[perf] ${name} +${now() - t0}ms`);
    },
  };
}

module.exports = { createPerf };
