// 标签拖拽落点计算（纯逻辑）：浏览器挂 window.tabDrag，Node 测试走 exports
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.tabDrag = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // 指针越过了多少个兄弟标签的中点，就插入到第几位
  function dropIndex(rects, pointerX) {
    let i = 0;
    for (const r of rects) {
      if (pointerX > r.left + r.width / 2) i++;
    }
    return i;
  }
  return { dropIndex };
});
