// 极简防抖：窗口期内的连续调用合并为最后一次（设置持久化等高频写场景用）
function debounce(fn, ms) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
  wrapped.cancel = () => { clearTimeout(timer); timer = null; };
  return wrapped;
}

module.exports = { debounce };
