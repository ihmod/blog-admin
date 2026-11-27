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
  setupPostFilter();
  setupTopImg();
  setupCategoryCreate();

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
      : Math.max(420, window.innerHeight - 380),
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
    if (typeof vditor.setPreviewMode === 'function') {
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
    }
    modeButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    });
  }

  modeButtons.forEach((button) => {
    button.addEventListener('click', () => applyViewMode(button.dataset.mode));
  });

  applyViewMode(postId ? 'both' : 'editor');

  function setupPostFilter() {
    const filter = document.getElementById('post-filter');
    const categoryFilter = document.getElementById('post-category-filter');
    const tagFilter = document.getElementById('post-tag-filter');
    const list = document.getElementById('post-list');
    if (!list) return;

    const allTagOptions = tagFilter
      ? Array.from(tagFilter.options).map((option) => ({
          value: option.value,
          label: option.textContent || option.value,
        }))
      : [];

    function updateTagOptions() {
      if (!tagFilter) return;
      const category = categoryFilter?.value || '';
      const allowed = new Set();
      list.querySelectorAll('li').forEach((item) => {
        if (category && (item.dataset.category || '') !== category) return;
        (item.dataset.tags || '')
          .split('|')
          .filter(Boolean)
          .forEach((tag) => allowed.add(tag));
      });
      const current = tagFilter.value;
      tagFilter.innerHTML = '';
      allTagOptions.forEach((option) => {
        if (option.value && !allowed.has(option.value)) return;
        const element = document.createElement('option');
        element.value = option.value;
        element.textContent = option.label;
        tagFilter.appendChild(element);
      });
      tagFilter.value = current && allowed.has(current) ? current : '';
    }

    function apply() {
      const query = (filter?.value || '').trim().toLowerCase();
      const category = categoryFilter?.value || '';
      const tag = tagFilter?.value || '';
      list.querySelectorAll('li').forEach((item) => {
        const title = (item.dataset.title || '').toLowerCase();
        const itemCategory = item.dataset.category || '';
        const itemTags = (item.dataset.tags || '').split('|');
        const matchesQuery = !query || title.includes(query);
        const matchesCategory = !category || itemCategory === category;
        const matchesTag = !tag || itemTags.includes(tag);
        item.hidden = !(matchesQuery && matchesCategory && matchesTag);
      });
    }

    filter?.addEventListener('input', apply);
    categoryFilter?.addEventListener('change', () => {
      updateTagOptions();
      apply();
    });
    tagFilter?.addEventListener('change', apply);
    updateTagOptions();
    apply();
  }

  function setStatus(text) {
    if (statusText) statusText.textContent = text;
  }

  async function save() {
    if (!postId || saving) return false;
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
      return true;
    } catch (error) {
      setStatus('自动保存失败');
      return false;
    } finally {
      saving = false;
    }
  }

  function showToast(message) {
    const toast = document.createElement('p');
    toast.className = 'notice';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('is-hiding');
      setTimeout(() => toast.remove(), 280);
    }, 2200);
  }

  async function saveBeforeNavigate(href) {
    if (!dirty || !postId) {
      window.location.href = href;
      return;
    }
    const saved = await save();
    showToast(saved ? '已自动保存，正在切换…' : '自动保存失败，请手动保存');
    setTimeout(() => {
      window.location.href = href;
    }, saved ? 500 : 1000);
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
    const leftButton = document.getElementById('toggle-left');
    const leftReopenButton = document.getElementById('toggle-left-open');
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

    function setLeftCollapsed(collapsed) {
      shell.classList.toggle('left-collapsed', collapsed);
      if (leftButton) {
        leftButton.setAttribute('aria-expanded', String(!collapsed));
        leftButton.setAttribute('aria-label', collapsed ? '展开文章列表' : '收起文章列表');
        leftButton.title = collapsed ? '展开文章列表' : '收起文章列表';
      }
    }

    if (leftButton) {
      leftButton.addEventListener('click', () => {
        setLeftCollapsed(!shell.classList.contains('left-collapsed'));
      });
    }

    if (leftReopenButton) {
      leftReopenButton.addEventListener('click', () => setLeftCollapsed(false));
    }

    function setFullscreenButton(on) {
      if (!fullscreenButton) return;
      fullscreenButton.setAttribute('aria-pressed', String(on));
      fullscreenButton.setAttribute('aria-label', on ? '退出全屏' : '全屏');
      fullscreenButton.title = on ? '退出全屏' : '全屏';
    }

    function setCssFullscreen(on) {
      shell.classList.toggle('is-fullscreen', on);
      document.body.classList.toggle('editor-fullscreen', on);
      setFullscreenButton(on);
    }

    async function toggleFullscreen() {
      if (document.fullscreenElement) {
        try {
          await document.exitFullscreen();
        } catch {
          // ignore
        }
        setFullscreenButton(false);
        return;
      }
      if (shell.classList.contains('is-fullscreen')) {
        setCssFullscreen(false);
        return;
      }
      try {
        if (typeof shell.requestFullscreen === 'function') {
          await shell.requestFullscreen();
          setFullscreenButton(true);
          return;
        }
      } catch {
        // Fall back to the CSS fullscreen mode below.
      }
      setCssFullscreen(true);
    }

    if (fullscreenButton) {
      fullscreenButton.addEventListener('click', () => {
        void toggleFullscreen();
      });
    }

    document.addEventListener('fullscreenchange', () => {
      setFullscreenButton(document.fullscreenElement === shell);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !document.fullscreenElement && shell.classList.contains('is-fullscreen')) {
        setCssFullscreen(false);
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
        link.addEventListener('click', (event) => {
          if (!dirty || !postId) return;
          event.preventDefault();
          void saveBeforeNavigate(link.href);
        });
      });
      const add = document.createElement('a');
      add.className = 'editor-tab-add';
      add.href = '/posts/new';
      add.setAttribute('aria-label', '新建文章');
      add.title = '新建文章';
      add.textContent = '+';
      add.addEventListener('click', (event) => {
        if (!dirty || !postId) return;
        event.preventDefault();
        void saveBeforeNavigate(add.href);
      });
      bar.appendChild(add);
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
      link.addEventListener('click', (event) => {
        if (!dirty || !postId) return;
        event.preventDefault();
        void saveBeforeNavigate(link.href);
      });
    });

    document.querySelectorAll('.editor-back, .editor-bar-actions .btn-ghost').forEach((link) => {
      link.addEventListener('click', (event) => {
        if (!dirty || !postId) return;
        event.preventDefault();
        void saveBeforeNavigate(link.href);
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

    const ignoredIds = new Set(['post-filter', 'post-category-filter', 'post-tag-filter']);
    document.addEventListener('input', (event) => {
      if (!form || !form.contains(event.target) || ignoredIds.has(event.target.id)) return;
      dirty = true;
    });
    document.addEventListener('change', (event) => {
      if (!form || !form.contains(event.target) || ignoredIds.has(event.target.id)) return;
      dirty = true;
    });
    if (form) {
      form.addEventListener('submit', () => {
        dirty = false;
      });
    }
    const saveOnUnload = () => {
      if (!dirty || !postId) return;
      const value = vditor.getValue();
      const body = new URLSearchParams();
      body.set('title', titleInput ? titleInput.value : '');
      body.set('content_md', value);
      fetch('/api/posts/' + encodeURIComponent(postId) + '/autosave', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-csrf-token': csrf,
        },
        body: body.toString(),
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener('beforeunload', saveOnUnload);
    window.addEventListener('pagehide', saveOnUnload);
  }

  function setupTopImg() {
    const toggle = document.getElementById('top_img_enabled');
    const hidden = document.getElementById('top_img');
    if (!toggle || !hidden) return;
    const custom = hidden.value && hidden.value !== 'false' && hidden.value !== 'true' ? hidden.value : '';
    toggle.addEventListener('change', () => {
      hidden.value = toggle.checked ? custom || 'true' : 'false';
    });
  }

  function setupCategoryCreate() {
    const select = document.getElementById('category_id');
    const input = document.getElementById('new-category-name');
    const button = document.getElementById('create-category');
    const error = document.getElementById('category-create-error');
    if (!select || !input || !button) return;
    const csrfToken =
      (container && container.dataset.csrf) ||
      document.querySelector('input[name=_csrf]')?.value ||
      '';

    async function create() {
      const name = input.value.trim();
      if (!name) return;
      button.disabled = true;
      if (error) {
        error.hidden = true;
        error.textContent = '';
      }
      try {
        const response = await fetch('/api/categories', {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'x-csrf-token': csrfToken,
          },
          body: new URLSearchParams({ name }).toString(),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || '创建分类失败');
        let option = Array.from(select.options).find((item) => item.value === String(data.id));
        if (!option) {
          option = document.createElement('option');
          option.value = String(data.id);
          select.appendChild(option);
        }
        option.textContent = data.name;
        select.value = String(data.id);
        select.dispatchEvent(new Event('change', { bubbles: true }));
        input.value = '';
      } catch (err) {
        if (error) {
          error.hidden = false;
          error.textContent = err instanceof Error ? err.message : '创建分类失败';
        }
      } finally {
        button.disabled = false;
      }
    }

    button.addEventListener('click', () => {
      void create();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void create();
      }
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
