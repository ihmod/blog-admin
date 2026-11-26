(function () {
  const container = document.getElementById('vditor');
  const input = document.getElementById('content_md');
  const form = document.getElementById('post-form');
  const titleInput = document.querySelector('[name=title]');
  const statusText = document.getElementById('autosave-text');
  const wordCount = document.getElementById('word-count');

  setupTags();
  setupStatusPreview();

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
    height: window.matchMedia('(max-width: 760px)').matches ? 420 : 600,
    mode: 'sv',
    theme: 'classic',
    icon: 'material',
    cdn: '/static/vditor',
    cache: { enable: false },
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
