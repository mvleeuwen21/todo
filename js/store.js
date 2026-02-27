/**
 * store.js — Data layer for Noted
 *
 * All notes and tasks are stored as a flat array of "note" objects in
 * localStorage under the key STORAGE_KEY.  Tasks are simply notes that
 * have `isTask: true` and a populated `task` sub-object.
 *
 * Public API (accessed via the global `Store` constant):
 *   Store.getNotes()
 *   Store.getNote(id)
 *   Store.createNote(data?)   → note
 *   Store.updateNote(id, changes) → note | null
 *   Store.deleteNote(id)
 *   Store.getAllLabels()       → string[]
 *   Store.getAllTags()         → string[]
 *   Store.getBacklinks(noteId)→ note[]
 *   Store.findNoteByTitle(title) → note | null
 *   Store.getDailyNote(dateStr?)  → note | null
 *   Store.search(query)       → note[]
 *   Store.getTasks(filters?)  → note[]
 *   Store.sortNotes(notes, by?) → note[]
 */

const Store = (() => {
  // ── Private ──────────────────────────────────────────────────────────

  const STORAGE_KEY = 'noted_v1';

  /** Generate a short, collision-resistant unique id. */
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /** Read the full data object from localStorage. */
  function getData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.warn('Store: failed to read localStorage', e);
    }
    return { notes: [] };
  }

  /** Persist the full data object to localStorage. */
  function saveData(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Store: failed to write localStorage', e);
    }
  }

  // ── Public API ────────────────────────────────────────────────────────

  return {

    // ──────────────────────────────────────────
    // CRUD — Notes
    // ──────────────────────────────────────────

    /** Return all notes (array, newest-first by default). */
    getNotes() {
      return getData().notes;
    },

    /** Return a single note by id, or null. */
    getNote(id) {
      return getData().notes.find(n => n.id === id) || null;
    },

    /**
     * Create a new note and prepend it to the store.
     *
     * @param {Object} data  Partial note fields to override defaults.
     * @returns {Object}     The newly created note.
     */
    createNote(data = {}) {
      const appData = getData();

      const note = {
        id:        uid(),
        title:     data.title     ?? 'Untitled',
        body:      data.body      ?? '',
        labels:    data.labels    ?? [],
        tags:      data.tags      ?? [],
        isTask:    data.isTask    ?? false,
        /**
         * task sub-object (only when isTask === true):
         *   { dueDate: string, priority: 'none'|'low'|'medium'|'high',
         *     status: 'todo'|'in-progress'|'done' }
         */
        task:      data.task      ?? null,
        isDaily:   data.isDaily   ?? false,
        dailyDate: data.dailyDate ?? null,   // 'YYYY-MM-DD'
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      // Prepend so newest appears at the top of every list
      appData.notes.unshift(note);
      saveData(appData);
      return note;
    },

    /**
     * Apply `changes` to note with `id`, updating `updatedAt`.
     *
     * @param {string} id
     * @param {Object} changes  Partial fields to merge.
     * @returns {Object|null}   Updated note, or null if not found.
     */
    updateNote(id, changes) {
      const appData = getData();
      const idx = appData.notes.findIndex(n => n.id === id);
      if (idx === -1) return null;

      appData.notes[idx] = {
        ...appData.notes[idx],
        ...changes,
        updatedAt: Date.now(),
      };
      saveData(appData);
      return appData.notes[idx];
    },

    /**
     * Permanently remove a note from the store.
     *
     * @param {string} id
     */
    deleteNote(id) {
      const appData = getData();
      appData.notes = appData.notes.filter(n => n.id !== id);
      saveData(appData);
    },

    // ──────────────────────────────────────────
    // Derived / query helpers
    // ──────────────────────────────────────────

    /** Return all distinct labels across every note, sorted A-Z. */
    getAllLabels() {
      const set = new Set();
      getData().notes.forEach(n => (n.labels || []).forEach(l => set.add(l)));
      return [...set].sort((a, b) => a.localeCompare(b));
    },

    /** Return all distinct tags across every note, sorted A-Z. */
    getAllTags() {
      const set = new Set();
      getData().notes.forEach(n => (n.tags || []).forEach(t => set.add(t)));
      return [...set].sort((a, b) => a.localeCompare(b));
    },

    /**
     * Return every note (excluding `noteId` itself) whose body contains
     * a [[link]] pointing to the given note's title.
     *
     * @param {string} noteId
     * @returns {Object[]}
     */
    getBacklinks(noteId) {
      const note = this.getNote(noteId);
      if (!note) return [];

      // Escape special regex characters in the title
      const escaped = note.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`\\[\\[${escaped}\\]\\]`, 'i');

      return getData().notes.filter(
        n => n.id !== noteId && pattern.test(n.body)
      );
    },

    /**
     * Find a note by exact title (case-insensitive).
     *
     * @param {string} title
     * @returns {Object|null}
     */
    findNoteByTitle(title) {
      const lower = title.toLowerCase();
      return getData().notes.find(n => n.title.toLowerCase() === lower) || null;
    },

    /**
     * Return today's daily note, or null if none exists yet.
     *
     * @param {string} [dateStr]  ISO date string 'YYYY-MM-DD'; defaults to today.
     * @returns {Object|null}
     */
    getDailyNote(dateStr) {
      const target = dateStr || new Date().toISOString().split('T')[0];
      return getData().notes.find(n => n.isDaily && n.dailyDate === target) || null;
    },

    /**
     * Full-text search across title, body (stripped of HTML tags),
     * labels and tags.
     *
     * @param {string} query
     * @returns {Object[]}
     */
    search(query) {
      if (!query || !query.trim()) return [];
      const q = query.toLowerCase().trim();

      return getData().notes.filter(n => {
        // Strip HTML tags from body before searching
        const bodyText = n.body.replace(/<[^>]*>/g, ' ').toLowerCase();
        return (
          n.title.toLowerCase().includes(q) ||
          bodyText.includes(q) ||
          (n.labels || []).some(l => l.toLowerCase().includes(q)) ||
          (n.tags   || []).some(t => t.toLowerCase().includes(q))
        );
      });
    },

    /**
     * Return notes that are tasks, optionally filtered.
     *
     * @param {Object} [filters]
     *   filters.status   — 'all' | 'todo' | 'in-progress' | 'done'
     *   filters.priority — 'all' | 'none' | 'low' | 'medium' | 'high'
     *   filters.dueDate  — 'YYYY-MM-DD' string (exact match)
     *   filters.label    — label string
     *   filters.tag      — tag string
     * @returns {Object[]}
     */
    getTasks(filters = {}) {
      let tasks = getData().notes.filter(n => n.isTask);

      if (filters.status && filters.status !== 'all') {
        tasks = tasks.filter(t => t.task?.status === filters.status);
      }
      if (filters.priority && filters.priority !== 'all') {
        tasks = tasks.filter(t => t.task?.priority === filters.priority);
      }
      if (filters.dueDate) {
        tasks = tasks.filter(t => t.task?.dueDate === filters.dueDate);
      }
      if (filters.label) {
        tasks = tasks.filter(t => (t.labels || []).includes(filters.label));
      }
      if (filters.tag) {
        tasks = tasks.filter(t => (t.tags || []).includes(filters.tag));
      }

      return tasks;
    },

    /**
     * Return a sorted copy of `notes`.
     *
     * @param {Object[]} notes
     * @param {'updated'|'created'|'title'} [by='updated']
     * @returns {Object[]}
     */
    sortNotes(notes, by = 'updated') {
      return [...notes].sort((a, b) => {
        if (by === 'title')   return a.title.localeCompare(b.title);
        if (by === 'created') return b.createdAt - a.createdAt;
        return b.updatedAt - a.updatedAt;
      });
    },

  };
})();
