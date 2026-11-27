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
  let currentMode = 'both';

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
      updateToc(value);
      schedule();
    },
  });

  const modeButtons = document.querySelectorAll('.mode-btn');

  function applyViewMode(mode) {
    if (!form) return;
    currentMode = mode;
    if (mode === 'editor') {
      vditor.setPreviewMode('editor');
      form.classList.remove('preview-only');
    } else if (mode === 'preview') {
      vditor.setPreviewMode('both');
      form.classList.add('preview-only');
    } else {
      vditor.setPreviewMode('both');
      form.classList.remove('preview-only');
    }
    modeButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    });
  }

  modeButtons.forEach((button) => {
    button.addEventListener('click', () => applyViewMode(button.dataset.mode));
  });

  applyViewMode('both');
  setupPostFilter();
  updateToc(input.value);

  function parseHeadings(markdown) {
    const headings = [];
    let inFence = false;
    for (const rawLine of markdown.split('\n')) {
      const line = rawLine.trimStart();
      if (/^(```|~~~)/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (match) headings.push({ level: match[1].length, text: match[2] });
    }
    return headings;
  }

  function scrollToHeading(index) {
    if (currentMode === 'editor') applyViewMode('both');
    window.setTimeout(() => {
      const nodes = document.querySelectorAll(
        '.vditor-preview h1, .vditor-preview h2, .vditor-preview h3, .vditor-preview h4, .vditor-preview h5, .vditor-preview h6',
      );
      const node = nodes[index];
      if (!node) return;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      node.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }, 60);
  }

  function updateToc(markdown) {
    const list = document.getElementById('toc-list');
    const count = document.getElementById('toc-count');
    if (!list) return;
    const headings = parseHeadings(markdown);
    if (count) count.textContent = headings.length > 0 ? String(headings.length) : '';
    list.innerHTML = '';
    if (headings.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'toc-empty';
      empty.textContent = '暂无标题';
      list.appendChild(empty);
      return;
    }
    headings.forEach((heading, index) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'toc-item toc-level-' + heading.level;
      button.textContent = heading.text;
      button.addEventListener('click', () => scrollToHeading(index));
      item.appendChild(button);
      list.appendChild(item);
    });
  }

  function setupPostFilter() {
    const filter = document.getElementById('post-filter');
    const list = document.getElementById('post-list');
    if (!filter || !list) return;
    filter.addEventListener('input', () => {
      const query = filter.value.trim().toLowerCase();
      list.querySelectorAll('li').forEach((item) => {
        const title = (item.dataset.title || '').toLowerCase();
        item.hidden = Boolean(query) && !title.includes(query);
      });
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
    const reopenButton = document.getElementById('toggle-side-open');
    const fullscreenButton = document.getElementById('toggle-fullscreen');
    if (!shell) return;

    function setSideCollapsed(collapsed) {
      shell.classList.toggle('side-collapsed', collapsed);
      if (sideButton) {
        sideButton.setAttribute('aria-expanded', String(!collapsed));
        sideButton.setAttribute('aria-label', collapsed ? '展开设置栏' : '收起设置栏');
        sideButton.title = collapsed ? '展开设置栏' : '收起设置栏';
      }
    }

    if (sideButton) {
      sideButton.addEventListener('click', () => {
        setSideCollapsed(!shell.classList.contains('side-collapsed'));
      });
    }

    if (reopenButton) {
      reopenButton.addEventListener('click', () => setSideCollapsed(false));
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
        fullscreenButton.setAttribute('aria-pressed', String(on));
        fullscreenButton.setAttribute('aria-label', on ? '退出全屏' : '全屏');
        fullscreenButton.title = on ? '退出全屏' : '全屏';
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
