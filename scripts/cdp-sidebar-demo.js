// 演示：点标题栏 ☰ 打开 Notion 侧边栏，截图后还原关闭
const fs = require('fs');
const path = require('path');
const port = process.argv[2] || '9222';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function attach(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result || msg.error); pending.delete(msg.id); }
  };
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve({
      send: (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); }),
      close: () => ws.close(),
    });
    ws.onerror = reject;
  });
}

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const tb = await attach(list.find((x) => x.url.includes('titlebar/index.html')).webSocketDebuggerUrl);
  const pg = await attach(list.find((x) => x.type === 'page' && x.url.startsWith('https://www.notion.so')).webSocketDebuggerUrl);
  const evalOn = async (c, expr) => {
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r && r.result ? r.result.value : undefined;
  };

  await evalOn(tb, `document.getElementById('sidebar-toggle').click()`);
  await sleep(2500);
  const open = await evalOn(pg, `!!document.querySelector('.notion-sidebar')`);
  console.log('侧边栏出现:', open);
  await pg.send('Page.enable');
  const shot = await pg.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(__dirname, '..', '.playwright-mcp', 'sidebar-open.png'), Buffer.from(shot.data, 'base64'));
  console.log('written sidebar-open.png');

  // 还原：点 Notion 侧栏里的关闭按钮
  const closed = await evalOn(pg, `(() => {
    const btn = document.querySelector('.notion-close-sidebar');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  await sleep(1500);
  console.log('关闭按钮点击:', closed, '侧边栏已关:', await evalOn(pg, `!document.querySelector('.notion-sidebar')`));
  tb.close();
  pg.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
