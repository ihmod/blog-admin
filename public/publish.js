(function () {
  const form = document.getElementById('publish-form');
  const live = document.getElementById('publish-live');
  const status = document.getElementById('publish-live-status');
  const log = document.getElementById('publish-live-log');
  if (!form || !live || !status || !log) return;

  const button = form.querySelector('button[type=submit]');
  let timer = null;
  let finished = false;

  function stop() {
    finished = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (button) button.disabled = false;
  }

  async function poll() {
    try {
      const res = await fetch('/api/publish/runs/latest', {
        headers: { accept: 'application/json' },
      });
      if (!res.ok) return;
      const run = await res.json();
      if (!run || !run.id) return;
      log.textContent = run.log || '';
      log.scrollTop = log.scrollHeight;
      if (run.status === 'success') {
        status.textContent = '发布成功';
        stop();
        setTimeout(() => window.location.reload(), 900);
      } else if (run.status === 'error') {
        status.textContent = '发布失败';
        stop();
      } else {
        status.textContent = '发布中…';
      }
    } catch {
      // A transient polling failure should not stop the progress display.
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const csrf = form.querySelector('input[name=_csrf]')?.value || '';
    live.hidden = false;
    status.textContent = '正在启动发布…';
    log.textContent = '';
    finished = false;
    if (button) button.disabled = true;
    try {
      const res = await fetch('/publish', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-csrf-token': csrf,
          'x-requested-with': 'fetch',
          accept: 'application/json',
        },
        body: new URLSearchParams({ _csrf: csrf }).toString(),
      });
      if (res.status === 409) {
        status.textContent = '已有发布正在进行';
      } else if (!res.ok) {
        throw new Error('start failed');
      } else {
        status.textContent = '发布中…';
      }
      await poll();
      if (!finished && !timer) timer = setInterval(poll, 1000);
    } catch {
      status.textContent = '启动发布失败';
      if (button) button.disabled = false;
    }
  });
})();
