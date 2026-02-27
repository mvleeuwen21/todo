/**
 * app.js — Main application module for Noted
 *
 * Responsibilities:
 *   • Application state management
 *   • Rendering the sidebar, list panel, and editor panel
 *   • Handling user interactions (navigation, editing, filtering, search)
 *   • Rich-text editor with wiki-link [[Note Title]] support
 *   • Keyboard shortcuts (Ctrl/Cmd+D for daily note)
 *   • Auto-save with debounce
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// App State
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Central state object.  All rendering reads from here.
 */
const App = {
  /**
   * Current view key.
   * One of: 'notes' | 'tasks' | 'daily' | 'search'
   */
  view: 'notes',

  /**
   * Active filter applied to the list panel.
   * Either null or { type: 'label'|'tag', value: string }
   */
  filter: null,

  /** ID of the currently open note (or null). */
  currentId: null,

  /** Current search query string. */
  searchQuery: '',

  /** Current sort key for the note list. */
  sort: 'updated',

  /** Filters applied when in the tasks view. */
  taskFilters: {
    status:   'all',
    priority: 'all',
    dueDate:  '',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// DOM Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Shorthand for getElementById. */
const $ = id => document.getElementById(id);

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  bindStaticListeners();

  // Seed sample content on first run
  if (Store.getNotes().length === 0) {
    seedSampleData();
  }

  render();
});

// ─────────────────────────────────────────────────────────────────────────────
// Event binding — called once at startup
// ─────────────────────────────────────────────────────────────────────────────

function bindStaticListeners() {
  // Global keyboard shortcuts
  document.addEventListener('keydown', onGlobalKeydown);

  // Search
  $('search-input').addEventListener('input', debounce(onSearchInput, 180));

  // Sidebar primary navigation
  document.querySelectorAll('.nav-item[data-view]').forEach(el =>
    el.addEventListener('click', () => navigateTo(el.dataset.view))
  );

  // New note / new task buttons
  $('btn-new-note').addEventListener('click', createNewNote);
  $('btn-new-task').addEventListener('click', createNewTask);

  // List panel — sort select
  $('sort-select').addEventListener('change', e => {
    App.sort = e.target.value;
    renderListPanel();
  });

  // List panel — task filters
  $('filter-status').addEventListener('change',   e => { App.taskFilters.status   = e.target.value; renderListPanel(); });
  $('filter-priority').addEventListener('change', e => { App.taskFilters.priority = e.target.value; renderListPanel(); });
  $('filter-due-date').addEventListener('change', e => { App.taskFilters.dueDate  = e.target.value; renderListPanel(); });

  // Editor toolbar (mousedown to avoid losing selection)
  $('editor-toolbar').addEventListener('mousedown', onToolbarMousedown);

  // Editor — title changes
  $('note-title').addEventListener('input', debounce(onTitleChange, 250));

  // Editor — body changes + wiki-link detection
  const body = $('editor-body');
  body.addEventListener('input',    debounce(onBodyChange, 300));
  body.addEventListener('input',    onWikiLinkDetect);
  body.addEventListener('click',    onWikiLinkClick);
  body.addEventListener('paste',    onPaste);
  body.addEventListener('keyup',    onToolbarStateUpdate);
  body.addEventListener('mouseup',  onToolbarStateUpdate);

  // Editor — task field changes
  $('task-due-date').addEventListener('change', saveNow);
  $('task-priority').addEventListener('change', saveNow);
  $('task-status').addEventListener('change',   saveNow);

  // Editor — labels / tags chip inputs
  $('labels-input').addEventListener('keydown', e => onChipInput(e, 'labels'));
  $('tags-input').addEventListener('keydown',   e => onChipInput(e, 'tags'));

  // Editor — action buttons
  $('btn-convert-task').addEventListener('click', toggleTaskMode);
  $('btn-delete-note').addEventListener('click',  deleteCurrentNote);
}

// ─────────────────────────────────────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Switch the main view (e.g. 'notes', 'tasks', 'daily').
 * Clears any active filter, search, and open note.
 */
function navigateTo(view, filter = null) {
  App.view      = view;
  App.filter    = filter;
  App.currentId = null;
  App.searchQuery = '';
  $('search-input').value = '';
  render();
}

/**
 * Open a specific note in the editor.
 * Saves any unsaved changes in the previously open note first.
 */
function openNote(id) {
  App.currentId = id;
  renderEditor();
  renderListPanel();   // refresh active-state highlight
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level render
// ─────────────────────────────────────────────────────────────────────────────

function render() {
  renderSidebar();
  renderListPanel();

  if (App.currentId && Store.getNote(App.currentId)) {
    renderEditor();
  } else {
    App.currentId = null;
    showPlaceholder();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar
// ─────────────────────────────────────────────────────────────────────────────

function renderSidebar() {
  // Highlight active primary nav item
  document.querySelectorAll('.nav-item[data-view]').forEach(el => {
    el.classList.toggle('active',
      el.dataset.view === App.view && !App.filter
    );
  });

  // ── Labels ──
  const labels    = Store.getAllLabels();
  const labelsNav = $('labels-nav');

  if (labels.length === 0) {
    labelsNav.innerHTML = '<li class="nav-empty-hint">No labels yet</li>';
  } else {
    labelsNav.innerHTML = labels.map(label => {
      const active = App.filter?.type === 'label' && App.filter.value === label;
      return `
        <li class="nav-item ${active ? 'active' : ''}" data-label="${escHtml(label)}">
          <span class="nav-tag label-tag">${escHtml(label)}</span>
        </li>`;
    }).join('');

    labelsNav.querySelectorAll('.nav-item[data-label]').forEach(el =>
      el.addEventListener('click', () =>
        navigateTo('notes', { type: 'label', value: el.dataset.label })
      )
    );
  }

  // ── Tags ──
  const tags    = Store.getAllTags();
  const tagsNav = $('tags-nav');

  if (tags.length === 0) {
    tagsNav.innerHTML = '<li class="nav-empty-hint">No tags yet</li>';
  } else {
    tagsNav.innerHTML = tags.map(tag => {
      const active = App.filter?.type === 'tag' && App.filter.value === tag;
      return `
        <li class="nav-item ${active ? 'active' : ''}" data-tag="${escHtml(tag)}">
          <span class="nav-tag">#${escHtml(tag)}</span>
        </li>`;
    }).join('');

    tagsNav.querySelectorAll('.nav-item[data-tag]').forEach(el =>
      el.addEventListener('click', () =>
        navigateTo('notes', { type: 'tag', value: el.dataset.tag })
      )
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// List Panel
// ─────────────────────────────────────────────────────────────────────────────

function renderListPanel() {
  const titleEl       = $('list-panel-title');
  const listEl        = $('note-list');
  const taskFiltersEl = $('task-filters');
  const sortWrapper   = $('sort-wrapper');

  let notes           = [];
  let title           = 'All Notes';
  let showTaskFilters = false;

  // Determine which notes to show based on current view/filter/search
  if (App.searchQuery) {
    notes = Store.search(App.searchQuery);
    title = `Search: "${App.searchQuery}"`;

  } else if (App.view === 'tasks') {
    notes           = Store.getTasks(App.taskFilters);
    title           = 'Tasks';
    showTaskFilters = true;

  } else if (App.view === 'daily') {
    notes = Store.getNotes().filter(n => n.isDaily);
    title = 'Daily Notes';

  } else if (App.filter?.type === 'label') {
    notes = Store.getNotes().filter(n =>
      (n.labels || []).includes(App.filter.value)
    );
    title = `Label: ${App.filter.value}`;

  } else if (App.filter?.type === 'tag') {
    notes = Store.getNotes().filter(n =>
      (n.tags || []).includes(App.filter.value)
    );
    title = `Tag: #${App.filter.value}`;

  } else {
    // Default: all non-task notes
    notes = Store.getNotes().filter(n => !n.isTask);
    title = 'All Notes';
  }

  // Sort
  notes = Store.sortNotes(notes, App.sort);

  // Update header
  titleEl.textContent            = title;
  taskFiltersEl.style.display    = showTaskFilters ? 'flex' : 'none';
  sortWrapper.style.display      = showTaskFilters ? 'none' : 'block';

  // Render list
  if (notes.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <p>No ${App.view === 'tasks' ? 'tasks' : 'notes'} here yet.</p>
        <button class="btn-link" id="empty-create-btn">
          + Create ${App.view === 'tasks' ? 'a task' : 'a note'}
        </button>
      </div>`;
    const btn = $('empty-create-btn');
    if (btn) {
      btn.addEventListener('click',
        App.view === 'tasks' ? createNewTask : createNewNote
      );
    }
    return;
  }

  listEl.innerHTML = notes.map(noteListItemHTML).join('');

  // Attach click handlers to list items
  listEl.querySelectorAll('.note-list-item').forEach(item => {
    // Open note on click (ignore task-checkbox clicks)
    item.addEventListener('click', e => {
      if (e.target.closest('.task-checkbox-label')) return;
      openNote(item.dataset.id);
    });

    // Quick-complete checkbox for tasks
    const cb = item.querySelector('.task-checkbox');
    if (cb) {
      cb.addEventListener('change', e => {
        e.stopPropagation();
        const note   = Store.getNote(item.dataset.id);
        const status = e.target.checked ? 'done' : 'todo';
        Store.updateNote(item.dataset.id, {
          task: { ...(note.task || {}), status },
        });
        // If editing this task, sync the status select
        if (App.currentId === item.dataset.id) {
          $('task-status').value = status;
        }
        renderListPanel();
      });
    }
  });

  // Refresh active highlight
  listEl.querySelectorAll('.note-list-item').forEach(item =>
    item.classList.toggle('active', item.dataset.id === App.currentId)
  );
}

/** Build the HTML string for a single note list item. */
function noteListItemHTML(note) {
  const active = note.id === App.currentId;

  if (note.isTask) {
    return taskListItemHTML(note, active);
  }

  const preview = stripHtml(note.body).slice(0, 100);
  const ago     = timeAgo(note.updatedAt);
  const tagsHtml = [
    ...(note.labels || []).map(l => `<span class="tag label-tag">${escHtml(l)}</span>`),
    ...(note.tags   || []).map(t => `<span class="tag">#${escHtml(t)}</span>`),
  ].join('');

  return `
    <div class="note-list-item ${active ? 'active' : ''} ${note.isDaily ? 'daily-note-item' : ''}"
         data-id="${note.id}">
      <div class="item-title">${escHtml(note.title)}</div>
      ${preview ? `<div class="item-preview">${escHtml(preview)}</div>` : ''}
      <div class="item-meta">
        <span class="item-time">${ago}</span>
      </div>
      ${tagsHtml ? `<div class="item-tags">${tagsHtml}</div>` : ''}
    </div>`;
}

/** Build HTML for a task list item. */
function taskListItemHTML(note, active) {
  const task      = note.task || {};
  const today     = todayStr();
  const isOverdue = task.dueDate && task.dueDate < today && task.status !== 'done';
  const isDone    = task.status === 'done';

  const tagsHtml = [
    ...(note.labels || []).map(l => `<span class="tag label-tag">${escHtml(l)}</span>`),
    ...(note.tags   || []).map(t => `<span class="tag">#${escHtml(t)}</span>`),
  ].join('');

  const priorityHtml = task.priority && task.priority !== 'none'
    ? `<span class="priority-badge priority-${task.priority}">${task.priority}</span>`
    : '';

  const dueDateHtml = task.dueDate
    ? `<span class="due-date ${isOverdue ? 'overdue' : ''}">${fmtDate(task.dueDate)}</span>`
    : '';

  return `
    <div class="note-list-item task-item ${active ? 'active' : ''}" data-id="${note.id}">
      <div class="task-item-header">
        <label class="task-checkbox-label">
          <input type="checkbox" class="task-checkbox" ${isDone ? 'checked' : ''}>
          <span class="task-title ${isDone ? 'task-done' : ''}">${escHtml(note.title)}</span>
        </label>
        ${priorityHtml}
      </div>
      <div class="task-item-meta">
        ${dueDateHtml}
        <span class="task-status-badge status-${task.status || 'todo'}">${fmtStatus(task.status)}</span>
      </div>
      ${tagsHtml ? `<div class="item-tags">${tagsHtml}</div>` : ''}
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Editor Panel
// ─────────────────────────────────────────────────────────────────────────────

function showPlaceholder() {
  $('editor-placeholder').style.display = 'flex';
  $('editor-main').style.display        = 'none';
}

/** Populate the editor with the note identified by App.currentId. */
function renderEditor() {
  const note = Store.getNote(App.currentId);
  if (!note) { showPlaceholder(); return; }

  $('editor-placeholder').style.display = 'none';
  $('editor-main').style.display        = 'flex';

  // Title
  $('note-title').value = note.title;

  // Task fields
  const taskFields = $('task-fields');
  if (note.isTask && note.task) {
    taskFields.style.display  = 'flex';
    $('task-due-date').value  = note.task.dueDate  || '';
    $('task-priority').value  = note.task.priority || 'none';
    $('task-status').value    = note.task.status   || 'todo';
    $('btn-convert-task').textContent = 'Remove Task';
  } else {
    taskFields.style.display  = 'none';
    $('btn-convert-task').textContent = 'Convert to Task';
  }

  // Labels chips
  renderChips('labels', note.labels || []);
  // Tags chips
  renderChips('tags', note.tags || []);

  // Body — render HTML with [[...]] converted to clickable spans
  $('editor-body').innerHTML = bodyForEdit(note.body || '');

  // Backlinks
  renderBacklinks(note.id);
}

// ── Chips (labels & tags) ──────────────────────────────────────────────────

/** Render chip elements for labels or tags inside the chips-display div. */
function renderChips(type, values) {
  const display = $(`${type}-display`);
  display.innerHTML = values.map(v => `
    <span class="chip ${type === 'labels' ? 'label-chip' : ''}">
      ${type === 'tags' ? '#' : ''}${escHtml(v)}
      <button class="chip-remove"
              data-type="${type}"
              data-value="${escHtml(v)}"
              title="Remove">×</button>
    </span>`
  ).join('');

  display.querySelectorAll('.chip-remove').forEach(btn =>
    btn.addEventListener('click', () => removeChip(btn.dataset.type, btn.dataset.value))
  );
}

/** Add a label or tag chip on Enter/comma keydown. */
function onChipInput(e, type) {
  if (e.key !== 'Enter' && e.key !== ',') return;
  e.preventDefault();

  const input = e.target;
  // Strip leading # for tags, trim whitespace
  const raw   = input.value.trim().replace(/^#/, '').trim();
  if (!raw || !App.currentId) return;

  const note    = Store.getNote(App.currentId);
  if (!note) return;

  const current = note[type] || [];
  if (current.includes(raw)) { input.value = ''; return; } // no duplicates

  const updated = [...current, raw];
  Store.updateNote(App.currentId, { [type]: updated });
  renderChips(type, updated);
  renderSidebar();       // labels/tags nav may have changed
  input.value = '';
}

/** Remove a chip by value. */
function removeChip(type, value) {
  if (!App.currentId) return;
  const note = Store.getNote(App.currentId);
  if (!note) return;

  const updated = (note[type] || []).filter(v => v !== value);
  Store.updateNote(App.currentId, { [type]: updated });
  renderChips(type, updated);
  renderSidebar();
}

// ── Backlinks ──────────────────────────────────────────────────────────────

function renderBacklinks(noteId) {
  const backlinks = Store.getBacklinks(noteId);
  const section   = $('backlinks-section');
  const list      = $('backlinks-list');

  if (backlinks.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  list.innerHTML = backlinks.map(n => `
    <div class="backlink-item" data-id="${n.id}">
      <span class="backlink-title">${escHtml(n.title)}</span>
    </div>`
  ).join('');

  list.querySelectorAll('.backlink-item').forEach(el =>
    el.addEventListener('click', () => openNote(el.dataset.id))
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Wiki-link handling in the editor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert the stored body HTML (which contains raw [[...]] text) into
 * HTML ready for the contenteditable editor, where [[...]] text is
 * wrapped in non-editable, clickable `.wiki-link` spans.
 *
 * @param {string} html  Stored body HTML.
 * @returns {string}     HTML with wiki-link spans injected.
 */
function bodyForEdit(html) {
  if (!html) return '';

  // Work in a detached div so we can walk the DOM safely
  const container = document.createElement('div');
  container.innerHTML = html;

  // Collect text nodes that might contain [[...]]
  const walker    = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    if (node.textContent.includes('[[')) textNodes.push(node);
  }

  // Replace each [[...]] occurrence with a wiki-link span
  textNodes.forEach(textNode => {
    const text    = textNode.textContent;
    const pattern = /\[\[([^\]]+)\]\]/g;
    const parts   = [];
    let lastIdx   = 0;
    let m;

    while ((m = pattern.exec(text)) !== null) {
      if (m.index > lastIdx) {
        parts.push(document.createTextNode(text.slice(lastIdx, m.index)));
      }

      const span            = document.createElement('span');
      span.className        = 'wiki-link';
      span.contentEditable  = 'false';
      span.dataset.title    = m[1];
      span.textContent      = m[0];

      // Mark as broken if the target note doesn't exist
      if (!Store.findNoteByTitle(m[1])) {
        span.classList.add('broken');
        span.title = `Note "${m[1]}" doesn't exist yet — click to create it.`;
      } else {
        span.title = `Open "${m[1]}"`;
      }

      parts.push(span);
      lastIdx = m.index + m[0].length;
    }

    if (parts.length === 0) return;   // no matches in this text node

    if (lastIdx < text.length) {
      parts.push(document.createTextNode(text.slice(lastIdx)));
    }

    const parent = textNode.parentNode;
    parts.forEach(p => parent.insertBefore(p, textNode));
    parent.removeChild(textNode);
  });

  return container.innerHTML;
}

/**
 * Serialize the editor body back to the storage format:
 * wiki-link spans → [[Note Title]] plain text.
 *
 * @returns {string}  HTML string safe to store.
 */
function bodyForSave() {
  const editor = $('editor-body');
  const clone  = editor.cloneNode(true);

  clone.querySelectorAll('.wiki-link').forEach(span => {
    span.replaceWith(document.createTextNode(`[[${span.dataset.title}]]`));
  });

  return clone.innerHTML;
}

/**
 * Detect when the user completes a [[...]] pattern and auto-wrap it.
 * Fires on every `input` event in the editor body.
 */
function onWikiLinkDetect() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;

  const range = sel.getRangeAt(0);
  const node  = range.startContainer;

  // We only process text nodes
  if (node.nodeType !== Node.TEXT_NODE) return;

  const text         = node.textContent;
  const cursorPos    = range.startOffset;
  const beforeCursor = text.slice(0, cursorPos);

  // Check if a complete [[...]] pattern ends at the cursor
  const match = beforeCursor.match(/\[\[([^\]]+)\]\]$/);
  if (!match) return;

  const fullMatch = match[0];       // '[[Note Title]]'
  const title     = match[1];       // 'Note Title'
  const startPos  = cursorPos - fullMatch.length;

  // Build wiki-link span
  const span           = document.createElement('span');
  span.className       = 'wiki-link';
  span.contentEditable = 'false';
  span.dataset.title   = title;
  span.textContent     = fullMatch;

  if (!Store.findNoteByTitle(title)) {
    span.classList.add('broken');
    span.title = `Note "${title}" doesn't exist yet — click to create it.`;
  } else {
    span.title = `Open "${title}"`;
  }

  // Split the text node around the matched text
  const before = startPos > 0 ? document.createTextNode(text.slice(0, startPos)) : null;
  const after  = document.createTextNode(text.slice(cursorPos));

  const parent = node.parentNode;
  if (before) parent.insertBefore(before, node);
  parent.insertBefore(span, node);
  parent.insertBefore(after, node);
  parent.removeChild(node);

  // Move the cursor to just after the new span
  const newRange = document.createRange();
  newRange.setStartAfter(span);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);

  // Trigger a save now that the link is rendered
  onBodyChange();
}

/**
 * Handle clicks on wiki-link spans inside the editor.
 * Navigates to the linked note or offers to create it.
 */
function onWikiLinkClick(e) {
  const span = e.target.closest('.wiki-link');
  if (!span) return;

  const title  = span.dataset.title;
  const linked = Store.findNoteByTitle(title);

  if (linked) {
    openNote(linked.id);
  } else {
    if (confirm(`"${title}" doesn't exist yet.\nCreate a new note with this title?`)) {
      const newNote = Store.createNote({ title });
      renderSidebar();
      renderListPanel();
      openNote(newNote.id);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Toolbar
// ─────────────────────────────────────────────────────────────────────────────

/** Handle toolbar button clicks without losing the editor selection. */
function onToolbarMousedown(e) {
  const btn = e.target.closest('.toolbar-btn');
  if (!btn) return;

  e.preventDefault();   // don't blur the editor

  const cmd = btn.dataset.cmd;
  const val = btn.dataset.val || null;

  document.execCommand(cmd, false, val);
  onToolbarStateUpdate();
  onBodyChange();
}

/** Update the active state of toolbar buttons based on cursor context. */
function onToolbarStateUpdate() {
  document.querySelectorAll('.toolbar-btn[data-cmd]').forEach(btn => {
    try {
      btn.classList.toggle('active', document.queryCommandState(btn.dataset.cmd));
    } catch (_) {}
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Save logic
// ─────────────────────────────────────────────────────────────────────────────

/** Called when the title input changes. */
function onTitleChange(e) {
  if (!App.currentId) return;
  Store.updateNote(App.currentId, { title: e.target.value.trim() || 'Untitled' });
  renderListPanel();
  renderSidebar();
}

/** Called when the editor body changes. */
function onBodyChange() {
  if (!App.currentId) return;
  Store.updateNote(App.currentId, { body: bodyForSave() });
  renderListPanel();
  renderBacklinks(App.currentId);
}

/** Immediate save (used for task field changes). */
function saveNow() {
  if (!App.currentId) return;
  const note = Store.getNote(App.currentId);
  if (!note) return;

  const changes = { body: bodyForSave(), title: $('note-title').value.trim() || 'Untitled' };

  if (note.isTask) {
    changes.task = {
      dueDate:  $('task-due-date').value,
      priority: $('task-priority').value,
      status:   $('task-status').value,
    };
  }

  Store.updateNote(App.currentId, changes);
  renderListPanel();
  renderSidebar();
}

// ─────────────────────────────────────────────────────────────────────────────
// Create / Delete / Convert
// ─────────────────────────────────────────────────────────────────────────────

/** Create a plain note and open it for editing. */
function createNewNote() {
  const note = Store.createNote({ title: 'Untitled' });
  App.view   = 'notes';
  App.filter = null;
  renderSidebar();
  renderListPanel();
  openNote(note.id);
  focusTitle();
}

/** Create a new task and open it for editing. */
function createNewTask() {
  const note = Store.createNote({
    title:  'New Task',
    isTask: true,
    task:   { dueDate: '', priority: 'none', status: 'todo' },
  });
  App.view   = 'tasks';
  App.filter = null;
  renderSidebar();
  renderListPanel();
  openNote(note.id);
  focusTitle();
}

/**
 * Open (or create) today's daily note and navigate to the Daily Notes view.
 * Bound to Ctrl/Cmd+D.
 */
function openDailyNote() {
  const today = todayStr();
  let daily   = Store.getDailyNote(today);

  if (!daily) {
    daily = Store.createNote({
      title:     today,
      isDaily:   true,
      dailyDate: today,
    });
    renderSidebar();
  }

  App.view   = 'daily';
  App.filter = null;
  renderSidebar();
  renderListPanel();
  openNote(daily.id);
}

/** Delete the currently open note after confirmation. */
function deleteCurrentNote() {
  if (!App.currentId) return;
  const note = Store.getNote(App.currentId);
  if (!note) return;

  if (!confirm(`Delete "${note.title}"?\nThis cannot be undone.`)) return;

  Store.deleteNote(App.currentId);
  App.currentId = null;
  renderSidebar();
  renderListPanel();
  showPlaceholder();
}

/** Toggle task mode for the currently open note. */
function toggleTaskMode() {
  if (!App.currentId) return;
  const note = Store.getNote(App.currentId);
  if (!note) return;

  if (note.isTask) {
    // Remove task properties
    Store.updateNote(App.currentId, { isTask: false, task: null });
  } else {
    // Promote to task
    Store.updateNote(App.currentId, {
      isTask: true,
      task:   { dueDate: '', priority: 'none', status: 'todo' },
    });
  }

  renderSidebar();
  renderListPanel();
  renderEditor();
}

// ─────────────────────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────────────────────

function onSearchInput(e) {
  App.searchQuery = e.target.value.trim();
  App.view        = App.searchQuery ? 'search' : 'notes';
  App.filter      = null;
  renderSidebar();
  renderListPanel();
}

// ─────────────────────────────────────────────────────────────────────────────
// Keyboard shortcuts
// ─────────────────────────────────────────────────────────────────────────────

function onGlobalKeydown(e) {
  const mod = e.ctrlKey || e.metaKey;

  // Ctrl/Cmd+D → open today's daily note
  if (mod && e.key === 'd') {
    e.preventDefault();
    openDailyNote();
    return;
  }

  // Ctrl/Cmd+N → new note (only when editor is not focused to avoid
  // colliding with browser's "new window" shortcut)
  if (mod && e.key === 'n') {
    const active = document.activeElement;
    if (!active || active === document.body) {
      e.preventDefault();
      createNewNote();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Paste handler — strip external formatting
// ─────────────────────────────────────────────────────────────────────────────

function onPaste(e) {
  e.preventDefault();
  const text = e.clipboardData.getData('text/plain');
  document.execCommand('insertText', false, text);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sample data — seeded on first launch
// ─────────────────────────────────────────────────────────────────────────────

function seedSampleData() {
  Store.createNote({
    title:  'Welcome to Noted!',
    body:   '<p>Welcome to <strong>Noted</strong> — a minimalist notes &amp; tasks app that lives entirely in your browser.</p><p>Everything you write is saved automatically in <em>localStorage</em>, so nothing is ever sent to a server.</p><h2>Quick start</h2><ul><li>Click <strong>New Note</strong> in the sidebar to create a note.</li><li>Press <strong>Ctrl+D</strong> (or Cmd+D) to open today\'s daily note.</li><li>Type <code>[[Note Title]]</code> in any note body to link to another note.</li><li>Convert a note to a task with the <em>Convert to Task</em> button.</li><li>Add labels and tags to organise your notes — click them in the sidebar to filter.</li></ul><p>See [[Using Wiki Links]] for more details on bi-directional linking.</p>',
    labels: ['Getting Started'],
    tags:   ['welcome'],
  });

  Store.createNote({
    title:  'Using Wiki Links',
    body:   '<p>You can link any note to another by typing double square brackets around the note title:</p><pre>[[Welcome to Noted!]]</pre><p>When you finish typing the closing <code>]]</code>, the text is automatically converted into a clickable link chip.</p><p><strong>Bi-directional linking</strong>: the referenced note will show a <em>Backlinks</em> section at the bottom listing every note that points to it.</p><p>If the linked note does not exist yet, clicking the chip offers to create it for you.</p>',
    labels: ['Getting Started'],
    tags:   ['links'],
  });

  const today = todayStr();
  Store.createNote({
    title:     today,
    body:      '<p>This is your daily note for today. Press <strong>Ctrl+D</strong> any time to return here.</p>',
    isDaily:   true,
    dailyDate: today,
    labels:    ['Daily'],
  });

  Store.createNote({
    title:  'Try the Tasks feature',
    body:   '<p>Click <em>Convert to Task</em> in the toolbar to turn any note into a task with a due date, priority, and status. Or create standalone tasks with the <em>New Task</em> button.</p>',
    isTask: true,
    task:   { dueDate: today, priority: 'medium', status: 'todo' },
    labels: ['Getting Started'],
    tags:   ['tasks'],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

/** HTML-escape a string to prevent XSS when injecting into innerHTML. */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Strip all HTML tags from a string and return plain text. */
function stripHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || '';
}

/** Return today's date as 'YYYY-MM-DD'. */
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

/** Format a timestamp as a human-readable relative time string. */
function timeAgo(ts) {
  const diff = Date.now() - ts;
  const sec  = Math.floor(diff / 1000);
  if (sec < 60)   return 'just now';
  const min = Math.floor(sec  / 60);
  if (min < 60)   return `${min}m ago`;
  const hr  = Math.floor(min  / 60);
  if (hr  < 24)   return `${hr}h ago`;
  const day = Math.floor(hr   / 24);
  if (day < 7)    return `${day}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Format a 'YYYY-MM-DD' string to a short display date. */
function fmtDate(dateStr) {
  if (!dateStr) return '';
  // Parse as local date (avoid UTC offset issues)
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
  });
}

/** Return a display string for a task status key. */
function fmtStatus(status) {
  const map = { todo: 'To Do', 'in-progress': 'In Progress', done: 'Done' };
  return map[status] || 'To Do';
}

/** Debounce helper — delays fn by `delay` ms after the last call. */
function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/** Focus and select the note title input. */
function focusTitle() {
  setTimeout(() => {
    const el = $('note-title');
    el.focus();
    el.select();
  }, 40);
}
