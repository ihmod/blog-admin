(function () {
  const container = document.getElementById('vditor');
  const input = document.getElementById('content_md');
  const form = document.getElementById('post-form');
  const titleInput = document.querySelector('[name=title]');
  const statusText = document.getElementById('autosave-text');
  const wordCount = document.getElementById('word-count');

  setupTags();
  setupStatusPreview();
  setupViewControls();

  function countWords(text) {
    const cjk = (text.match(/[一-鿿]/g) || []).length;
    const latin = (text.replace(/[一-鿿]/g, ' ').match(/[A-Za-z0-9_]+/g) || []).length;
    return cjk + latin;
  }

  function updateCount(text) {
    if (wordCount) wordCount.textContent = countWords(text).toLocaleString() + ' 字';
  }

  updateCount(input ? input.value : '');

  if (!container || !input || typeof Vditor === 'undefined') return;

  const csrf = container.dataset.csrf;
  const postId = container.dataset.postId || '';
  let timer = null;
  let saving = false;

  const vditor = new Vditor(container.id, {
    height: window.matchMedia('(max-width: 760px)').matches
      ? 420
      : Math.max(520, window.innerHeight - 320),
    mode: 'sv',
    theme: 'classic',
    icon: 'ant',
    cdn: '/static/vditor',
    cache: { enable: false },
    counter: { enable: true },
    value: input.value,
    toolbar: [
      'headings', 'bold', 'italic', 'strike', '|',
      'list', 'ordered-list', 'check', '|',
      'quote', 'line', 'code', 'inline-code', '|',
      'upload', 'link', 'table', '|',
      'undo', 'redo',
    ],
    upload: {
      url: '/api/media',
      fieldName: 'file',
      headers: { 'x-csrf-token': csrf },
      accept: 'image/png,image/jpeg,image/gif,image/webp',
      format: function (files, responseText) {
        const res = JSON.parse(responseText);
        const succMap = {};
        succMap[res.originalName || res.name] = res.url;
        return JSON.stringify({
          msg: '',
          code: 0,
          data: { errFiles: [], succMap: succMap },
        });
      },
    },
    input: function (value) {
      input.value = value;
      updateCount(value);
      schedule();
    },
  });

  const previewButton = document.getElementById('toggle-preview');
  let previewOpen = true;
  if (previewButton) {
    previewButton.addEventListener('click', () => {
      previewOpen = !previewOpen;
      vditor.setPreviewMode(previewOpen ? 'both' : 'editor');
      previewButton.textContent = previewOpen ? '关闭预览' : '打开预览';
      previewButton.setAttribute('aria-pressed', String(previewOpen));
    });
  }

  function setStatus(text) {
    if (statusText) statusText.textContent = text;
  }

  async function save() {
    if (!postId || saving) return;
    const value = vditor.getValue();
    input.value = value;
    saving = true;
    try {
      const body = new URLSearchParams();
      body.set('title', titleInput ? titleInput.value : '');
      body.set('content_md', value);
      const res = await fetch('/api/posts/' + encodeURIComponent(postId) + '/autosave', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-csrf-token': csrf,
        },
        body: body.toString(),
      });
      if (!res.ok) throw new Error('autosave failed');
      const data = await res.json();
      if (data.saved) {
        setStatus('已自动保存 ' + new Date().toLocaleTimeString());
      }
    } catch (error) {
      setStatus('自动保存失败');
    } finally {
      saving = false;
    }
  }

  function schedule() {
    if (!postId) return;
    clearTimeout(timer);
    timer = setTimeout(save, 2000);
  }

  if (form) {
    form.addEventListener('submit', function () {
      input.value = vditor.getValue();
      updateCount(input.value);
    });
  }

  window.setInterval(save, 30000);

  function setupViewControls() {
    const shell = document.getElementById('post-form');
    const sideButton = document.getElementById('toggle-side');
    const focusButton = document.getElementById('toggle-focus');
    const fullscreenButton = document.getElementById('toggle-fullscreen');
    if (!shell) return;

    if (sideButton) {
      sideButton.addEventListener('click', () => {
        const collapsed = shell.classList.toggle('side-collapsed');
        sideButton.textContent = collapsed ? '显示设置' : '设置';
        sideButton.setAttribute('aria-pressed', String(collapsed));
      });
    }

    function setFocus(on) {
      shell.classList.toggle('is-focus', on);
      document.body.classList.toggle('editor-focus', on);
      if (focusButton) {
        focusButton.textContent = on ? '退出专注' : '专注';
        focusButton.setAttribute('aria-pressed', String(on));
      }
    }

    if (focusButton) {
      focusButton.addEventListener('click', () => {
        setFocus(!shell.classList.contains('is-focus'));
      });
    }

    if (fullscreenButton) {
      fullscreenButton.addEventListener('click', async () => {
        try {
          if (!document.fullscreenElement) {
            await shell.requestFullscreen();
          } else {
            await document.exitFullscreen();
          }
        } catch {
          // Fullscreen may be unavailable in an embedded preview.
        }
      });
    }

    document.addEventListener('fullscreenchange', () => {
      const on = document.fullscreenElement === shell;
      if (fullscreenButton) {
        fullscreenButton.textContent = on ? '退出全屏' : '全屏';
        fullscreenButton.setAttribute('aria-pressed', String(on));
      }
    });

    document.addEventListener('keydown', (event) => {
      if (
        event.key === 'Escape' &&
        !document.fullscreenElement &&
        shell.classList.contains('is-focus')
      ) {
        setFocus(false);
      }
    });
  }

  function setupStatusPreview() {
    const doc = document.querySelector('.doc-status');
    if (!doc) return;
    document.querySelectorAll('input[name=status]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        const published = radio.value === 'published';
        doc.className = 'doc-status ' + (published ? 'published' : 'draft');
        doc.innerHTML = '<span class="doc-dot"></span>' + (published ? '已发布' : '草稿');
      });
    });
  }

  function setupTags() {
    const hidden = document.getElementById('tags');
    const chips = document.getElementById('tag-chips');
    const tagInput = document.getElementById('tag-input');
    if (!hidden || !chips || !tagInput) return;

    let values = hidden.value
      .split(/[,，]/)
      .map((value) => value.trim())
      .filter(Boolean);

    const render = () => {
      chips.innerHTML = '';
      for (const value of values) {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        const label = document.createElement('span');
        label.textContent = value;
        chip.appendChild(label);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'tag-chip-remove';
        remove.setAttribute('aria-label', '移除标签 ' + value);
        remove.textContent = '×';
        remove.addEventListener('click', () => {
          values = values.filter((item) => item !== value);
          sync();
        });
        chip.appendChild(remove);
        chips.appendChild(chip);
      }
      hidden.value = values.join(', ');
    };

    const sync = () => {
      tagInput.value = '';
      render();
    };

    const add = (raw) => {
      const value = raw.trim();
      if (!value) return;
      if (!values.includes(value)) values.push(value);
      sync();
    };

    tagInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        add(tagInput.value);
      } else if (event.key === 'Backspace' && !tagInput.value && values.length > 0) {
        values.pop();
        render();
      }
    });
    tagInput.addEventListener('blur', () => add(tagInput.value));
    render();
  }
})();
