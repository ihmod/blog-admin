(function () {
  const form = document.getElementById('media-upload');
  if (!form) return;
  const input = form.querySelector('input[type=file]');
  const status = document.getElementById('media-status');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!input.files || input.files.length === 0) return;
    const data = new FormData();
    data.append('file', input.files[0]);
    if (status) status.textContent = '上传中…';
    try {
      const res = await fetch('/api/media', {
        method: 'POST',
        headers: { 'x-csrf-token': form.dataset.csrf },
        body: data,
      });
      if (!res.ok) throw new Error('upload failed');
      if (status) status.textContent = '上传成功';
      setTimeout(() => window.location.reload(), 400);
    } catch (error) {
      if (status) status.textContent = '上传失败';
    }
  });
})();
