(function () {
  const container = document.getElementById('vditor');
  const input = document.getElementById('content_md');
  const form = document.getElementById('post-form');
  const titleInput = document.querySelector('[name=title]');
  const statusText = document.getElementById('autosave-text');
  const wordCount = document.getElementById('word-count');
  let dirty = false;

  setupTags();
  setupViewControls();
  setupTabs();

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
      dirty = true;
      schedule();
    },
  });

  const modeButtons = document.querySelectorAll('.mode-btn');

  function applyViewMode(mode) {
    if (!form) return;
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

  function setupTabs() {
    const bar = document.getElementById('editor-tabs');
    const pageId = container ? container.dataset.postId || 'new' : 'new';
    const currentStatus = form && form.dataset.status === 'published' ? 'published' : 'draft';
    const titleField = document.querySelector('[name=title]');
    if (!bar) return;

    const STORAGE = 'ihmod.editor.tabs';

    function readTabs() {
      try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE) || '[]');
        return Array.isArray(parsed)
          ? parsed.filter((tab) => tab && tab.id && typeof tab.title === 'string')
          : [];
      } catch {
        return [];
      }
    }

    function saveTabs() {
      try {
        localStorage.setItem(STORAGE, JSON.stringify(tabs));
      } catch {
        // ignore private-mode/quota errors
      }
    }

    function tabHref(id) {
      return id === 'new' ? '/posts/new' : '/posts/' + encodeURIComponent(id);
    }

    function closeTab(id) {
      tabs = tabs.filter((tab) => tab.id !== id);
      saveTabs();
      if (id === pageId) {
        const next = tabs[0];
        window.location.href = next ? tabHref(next.id) : '/posts';
      } else {
        render();
      }
    }

    function render() {
      bar.innerHTML = '';
      tabs.forEach((tab) => {
        const item = document.createElement('div');
        item.className = 'editor-tab' + (tab.id === pageId ? ' active' : '');
        const dot = document.createElement('span');
        dot.className = 'editor-tab-dot' + (tab.status === 'published' ? ' published' : '');
        item.appendChild(dot);
        const link = document.createElement('a');
        link.className = 'editor-tab-link';
        link.href = tabHref(tab.id);
        link.textContent = tab.title;
        link.setAttribute('role', 'tab');
        link.setAttribute('aria-selected', String(tab.id === pageId));
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'editor-tab-close';
        close.setAttribute('aria-label', '关闭 ' + tab.title);
        close.textContent = '×';
        close.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          closeTab(tab.id);
        });
        item.append(link, close);
        bar.appendChild(item);
      });
      const active = bar.querySelector('.editor-tab.active');
      if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    let tabs = readTabs();
    const currentTitle =
      titleField && titleField.value.trim()
        ? titleField.value.trim()
        : pageId === 'new'
          ? '新建文章'
          : '未命名';
    const existing = tabs.find((tab) => tab.id === pageId);
    if (existing) {
      existing.title = currentTitle;
      existing.status = currentStatus;
    } else {
      tabs.unshift({ id: pageId, title: currentTitle, status: currentStatus });
    }
    tabs = tabs.slice(0, 12);
    saveTabs();
    render();

    if (titleField) {
      titleField.addEventListener('input', () => {
        const active = tabs.find((tab) => tab.id === pageId);
        if (!active) return;
        active.title = titleField.value.trim() || (pageId === 'new' ? '新建文章' : '未命名');
        saveTabs();
        const activeLink = bar.querySelector('.editor-tab.active .editor-tab-link');
        if (activeLink) activeLink.textContent = active.title;
      });
    }

    document.querySelectorAll('.post-link').forEach((link) => {
      link.addEventListener('click', () => {
        const href = link.getAttribute('href') || '';
        const match = href.match(/^\/posts\/([^/?#]+)$/);
        if (!match) return;
        const id = match[1];
        const title = (link.querySelector('.post-title')?.textContent || '未命名').trim();
        const status = link.querySelector('.post-dot')?.classList.contains('published')
          ? 'published'
          : 'draft';
        if (!tabs.some((tab) => tab.id === id)) {
          tabs.unshift({ id, title, status });
          tabs = tabs.slice(0, 12);
          saveTabs();
        }
      });
    });

    document.querySelectorAll('input[name=status]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        const active = tabs.find((tab) => tab.id === pageId);
        if (!active) return;
        active.status = radio.value === 'published' ? 'published' : 'draft';
        saveTabs();
        render();
      });
    });

    document.addEventListener('input', (event) => {
      if (!form || !form.contains(event.target) || event.target.id === 'post-filter') return;
      dirty = true;
    });
    document.addEventListener('change', (event) => {
      if (!form || !form.contains(event.target) || event.target.id === 'post-filter') return;
      dirty = true;
    });
    if (form) {
      form.addEventListener('submit', () => {
        dirty = false;
      });
    }
    window.addEventListener('beforeunload', (event) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
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
      dirty = true;
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
