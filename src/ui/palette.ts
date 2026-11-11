// The palette: an input, a ranked result list, a footer with key hints, and
// a slot where tools can mount richer views (chat, color picker, help).
import { Query } from '@/core/query';
import { recordPick, type PickStats } from '@/core/ranking';
import type { ToolRegistry } from '@/core/registry';
import type { Action, ActionContext, BrowserBridge, DataSource, Result, Settings, View, ViewContext } from '@/core/types';
import { fetchJson } from '@/lib/http';
import { clear, h, isMod, modKey } from './dom';
import { glyph, renderIcon } from './icons';

export interface PaletteEnv {
  registry: ToolRegistry;
  data: DataSource;
  bridge: BrowserBridge;
  settings: () => Settings;
  stats: PickStats;
  saveStats(stats: PickStats): void;
  close(): void;
  copy(text: string): Promise<void>;
  open(url: string, newTab: boolean): Promise<void>;
}

interface RowState {
  result: Result;
  el: HTMLElement;
  key: string;
}

export class Palette {
  readonly root: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private readonly viewSlot: HTMLElement;
  private readonly footer: HTMLElement;
  private readonly hints: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly menu: HTMLElement;

  private results: Result[] = [];
  private rows = new Map<string, RowState>();
  private selected = 0;
  private userMoved = false;
  private controller: AbortController | null = null;
  private generation = 0;
  private hydrated = new Map<string, Partial<Result>>();
  private hydrating = new Set<string>();
  private view: { view: View; cleanup?: () => void } | null = null;
  private menuOpen = false;
  private menuIndex = 0;
  private toastTimer = 0;
  private lastPointer = { x: -1, y: -1 };

  constructor(private readonly env: PaletteEnv) {
    this.input = h('input', {
      class: 'query',
      type: 'text',
      placeholder: 'Search, calculate, or ask anything…',
      autocomplete: 'off',
      spellcheck: 'false',
      role: 'combobox',
      'aria-expanded': 'true',
      'aria-controls': 'mc-results',
      'aria-autocomplete': 'list',
      'aria-label': 'MoonCow',
    });
    this.list = h('div', { class: 'results', id: 'mc-results', role: 'listbox', 'aria-label': 'Results' });
    this.viewSlot = h('div', { class: 'view', hidden: true });
    this.toastEl = h('span', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    this.hints = h('span', { class: 'hints' });
    this.footer = h('footer', { class: 'footer' }, this.toastEl, this.hints);
    this.menu = h('div', { class: 'menu', role: 'menu', tabindex: '-1', hidden: true });

    const searchIcon = h('span', { class: 'bar-icon' }, glyph('search', 18));
    this.root = h(
      'div',
      { class: 'panel', role: 'dialog', 'aria-label': 'MoonCow' },
      h('div', { class: 'bar' }, searchIcon, this.input),
      this.list,
      this.viewSlot,
      this.footer,
      this.menu,
    );

    this.input.addEventListener('input', () => this.run());
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.root.addEventListener('keydown', (e) => this.onRootKey(e));
    this.list.addEventListener('pointermove', (e) => this.onPointer(e));
  }

  /** Called every time the palette is shown. */
  show(): void {
    if (this.view) {
      this.focusView();
      return;
    }
    this.input.focus();
    this.input.select();
    this.run();
  }

  get query(): string {
    return this.input.value;
  }

  setQuery(text: string): void {
    if (this.view) this.closeView();
    this.input.value = text;
    this.input.focus();
    this.input.setSelectionRange(text.length, text.length);
    this.run();
  }

  // ---------------------------------------------------------------- running

  run(): void {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const gen = ++this.generation;
    this.hydrated.clear();
    this.hydrating.clear();
    this.userMoved = false;
    const query = new Query(this.input.value);
    void this.env.registry
      .run(
        query,
        { signal: controller.signal, now: Date.now(), settings: this.env.settings(), data: this.env.data },
        {
          stats: this.env.stats,
          // Scoped modes (">" commands, "@" sites) list everything they have.
          limit: /^[>@]/.test(query.text) ? 50 : undefined,
          onUpdate: (results) => gen === this.generation && this.setResults(results),
        },
      )
      .catch((err) => console.warn('[mooncow] run failed', err));
  }

  private setResults(results: Result[]): void {
    const selectedId = this.results[this.selected]?.id;
    this.results = results.map((r) => ({ ...r, ...(this.hydrated.get(r.id) || {}) }));
    const keep = this.userMoved && selectedId ? this.results.findIndex((r) => r.id === selectedId) : -1;
    this.selected = keep >= 0 ? keep : 0;
    this.render();
    this.startHydration();
  }

  private startHydration(): void {
    const gen = this.generation;
    const signal = this.controller!.signal;
    for (const result of this.results) {
      if (!result.hydrate || this.hydrating.has(result.id)) continue;
      this.hydrating.add(result.id);
      result
        .hydrate({ signal, fetchJson: (url) => fetchJson(url, signal) })
        .then((patch) => {
          if (!patch || gen !== this.generation) return;
          this.hydrated.set(result.id, patch);
          this.results = this.results.map((r) => (r.id === result.id ? { ...r, ...patch } : r));
          this.render();
        })
        .catch((err) => {
          if (gen !== this.generation || (err as Error)?.name === 'AbortError') return;
          const patch: Partial<Result> = { answer: 'Could not load this right now', subtitle: (err as Error)?.message };
          this.hydrated.set(result.id, patch);
          this.results = this.results.map((r) => (r.id === result.id ? { ...r, ...patch } : r));
          this.render();
        });
    }
  }

  // -------------------------------------------------------------- rendering

  private rowKey(r: Result): string {
    const icon = r.icon ? JSON.stringify(r.icon) : '';
    return [r.title, r.subtitle, r.answer, r.accessory, icon, r.kind].join('\u0000');
  }

  private buildRow(r: Result, index: number): HTMLElement {
    const main = h('div', { class: 'main' });
    if (r.kind === 'answer' && r.answer !== undefined) {
      main.append(h('div', { class: 'label' }, r.title), h('div', { class: 'answer' }, r.answer));
      if (r.subtitle) main.append(h('div', { class: 'subtitle' }, r.subtitle));
    } else {
      main.append(h('div', { class: 'title' }, r.title));
      if (r.subtitle) main.append(h('div', { class: 'subtitle' }, r.subtitle));
    }
    const row = h(
      'div',
      { class: `row kind-${r.kind}`, role: 'option', id: `mc-row-${index}`, 'data-id': r.id },
      renderIcon(r.icon),
      main,
      r.accessory ? h('span', { class: 'accessory' }, r.accessory) : null,
    );
    row.addEventListener('click', (e) => {
      const idx = this.results.findIndex((x) => x.id === r.id);
      if (idx >= 0) this.activate(idx, isMod(e) ? 1 : 0);
    });
    return row;
  }

  private render(): void {
    const next = new Map<string, RowState>();
    const fragment: HTMLElement[] = [];
    this.results.forEach((r, i) => {
      const key = this.rowKey(r);
      const prev = this.rows.get(r.id);
      const el = prev && prev.key === key ? prev.el : this.buildRow(r, i);
      el.id = `mc-row-${i}`;
      next.set(r.id, { result: r, el, key });
      fragment.push(el);
    });
    // Only touch the DOM when the order or contents changed.
    const current = Array.from(this.list.children);
    if (current.length !== fragment.length || current.some((el, i) => el !== fragment[i])) {
      this.list.replaceChildren(...fragment);
    }
    this.rows = next;
    this.list.classList.toggle('empty', this.results.length === 0);
    this.paintSelection();
  }

  private paintSelection(): void {
    Array.from(this.list.children).forEach((el, i) => {
      const on = i === this.selected;
      el.classList.toggle('selected', on);
      el.setAttribute('aria-selected', String(on));
    });
    const sel = this.list.children[this.selected] as HTMLElement | undefined;
    if (sel) {
      this.input.setAttribute('aria-activedescendant', sel.id);
      sel.scrollIntoView({ block: 'nearest' });
    } else {
      this.input.removeAttribute('aria-activedescendant');
    }
    this.renderHints();
  }

  private renderHints(): void {
    clear(this.hints);
    const r = this.results[this.selected];
    const hint = (keys: string, label: string) => h('span', { class: 'hint' }, h('kbd', {}, keys), label);
    if (this.view) {
      this.hints.append(hint('esc', 'Back'));
      return;
    }
    if (!r) {
      this.hints.append(h('span', { class: 'hint muted' }, 'Type ? to see everything MoonCow can do'));
      return;
    }
    this.hints.append(hint('↵', r.actions[0]?.title || 'Open'));
    if (r.actions[1]) this.hints.append(hint(`${modKey()}↵`, r.actions[1].title));
    if (r.actions.length > 2) this.hints.append(hint(`${modKey()}K`, 'More'));
  }

  // ---------------------------------------------------------------- keyboard

  private move(delta: number): void {
    if (!this.results.length) return;
    this.userMoved = true;
    this.selected = (this.selected + delta + this.results.length) % this.results.length;
    this.paintSelection();
  }

  private onPointer(e: PointerEvent): void {
    // Ignore synthetic moves caused by the list re-rendering under a still cursor.
    if (e.clientX === this.lastPointer.x && e.clientY === this.lastPointer.y) return;
    this.lastPointer = { x: e.clientX, y: e.clientY };
    const row = (e.target as HTMLElement).closest('.row');
    if (!row) return;
    const idx = Array.from(this.list.children).indexOf(row);
    if (idx >= 0 && idx !== this.selected) {
      this.userMoved = true;
      this.selected = idx;
      this.paintSelection();
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (this.menuOpen) return;
    const ctrlOnly = e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.key === 'ArrowDown' || (ctrlOnly && e.key === 'n')) { e.preventDefault(); this.move(1); }
    else if (e.key === 'ArrowUp' || (ctrlOnly && e.key === 'p')) { e.preventDefault(); this.move(-1); }
    else if (e.key === 'PageDown') { e.preventDefault(); this.move(Math.max(1, this.results.length - 1 - this.selected)); }
    else if (e.key === 'PageUp') { e.preventDefault(); this.move(-this.selected); }
    else if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      this.activate(this.selected, isMod(e) ? 1 : 0);
    } else if (isMod(e) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      this.openMenu();
    } else if (e.key === 'Tab' && !e.shiftKey && this.results[this.selected]?.kind === 'suggestion') {
      // Tab completes a suggestion into the input.
      e.preventDefault();
      this.setQuery(this.results[this.selected].title);
    }
  }

  private onRootKey(e: KeyboardEvent): void {
    // The open shortcut also closes, even while focus is inside the panel.
    if (isMod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      this.env.close();
      return;
    }
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (this.menuOpen) this.closeMenu();
    else if (this.view) this.closeView();
    else this.env.close();
  }

  // ----------------------------------------------------------------- actions

  private actionContext(): ActionContext {
    return {
      close: () => this.env.close(),
      copy: (text) => this.env.copy(text),
      open: async (url, options) => {
        await this.env.open(url, !!options?.newTab);
        this.env.close();
      },
      showView: (view) => this.showView(view),
      setQuery: (text) => this.setQuery(text),
      refresh: () => this.run(),
      toast: (message) => this.toast(message),
      browser: this.env.bridge,
    };
  }

  async runAction(result: Result, action: Action): Promise<void> {
    if (result.toolId && this.query.trim()) {
      this.env.stats = recordPick(this.env.stats, this.query, result.toolId);
      this.env.saveStats(this.env.stats);
    }
    try {
      await action.run(this.actionContext());
    } catch (err) {
      console.warn('[mooncow] action failed', err);
      this.toast((err as Error)?.message || 'That did not work');
    }
  }

  private activate(index: number, actionIndex: number): void {
    const result = this.results[index];
    if (!result) return;
    const action = result.actions[actionIndex] || result.actions[0];
    if (!action) {
      this.toast(result.hydrate ? 'Still loading…' : 'Nothing to do here');
      return;
    }
    void this.runAction(result, action);
  }

  toast(message: string): void {
    this.toastEl.textContent = message;
    this.footer.classList.add('has-toast');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.footer.classList.remove('has-toast'), 1800);
  }

  // -------------------------------------------------------------- action menu

  private openMenu(): void {
    const result = this.results[this.selected];
    if (!result || !result.actions.length) return;
    this.menuOpen = true;
    this.menuIndex = 0;
    clear(this.menu);
    this.menu.append(h('div', { class: 'menu-title' }, result.title));
    result.actions.forEach((action, i) => {
      const keys = i === 0 ? '↵' : i === 1 ? `${modKey()}↵` : '';
      const item = h('div', { class: 'menu-item', role: 'menuitem', tabindex: '-1' }, h('span', {}, action.title), keys ? h('kbd', {}, keys) : null);
      item.addEventListener('click', () => { this.closeMenu(); void this.runAction(result, action); });
      item.addEventListener('pointermove', () => { this.menuIndex = i; this.paintMenu(); });
      this.menu.append(item);
    });
    this.menu.hidden = false;
    this.paintMenu();
    this.menu.focus();
    const onKey = (e: KeyboardEvent) => {
      if (!this.menuOpen) return;
      const items = result.actions.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); this.menuIndex = (this.menuIndex + 1) % items; this.paintMenu(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.menuIndex = (this.menuIndex - 1 + items) % items; this.paintMenu(); }
      else if (e.key === 'Enter') { e.preventDefault(); const a = result.actions[this.menuIndex]; this.closeMenu(); void this.runAction(result, a); }
      else if (isMod(e) && e.key.toLowerCase() === 'k') { e.preventDefault(); this.closeMenu(); }
    };
    this.menu.onkeydown = onKey;
  }

  private paintMenu(): void {
    this.menu.querySelectorAll('.menu-item').forEach((el, i) => el.classList.toggle('selected', i === this.menuIndex));
  }

  private closeMenu(): void {
    this.menuOpen = false;
    this.menu.hidden = true;
    this.input.focus();
  }

  // -------------------------------------------------------------------- views

  showView(view: View): void {
    this.closeView(false);
    clear(this.viewSlot);
    this.list.hidden = true;
    this.viewSlot.hidden = false;
    this.root.classList.add('has-view');
    const ctx: ViewContext = {
      ...this.actionContext(),
      back: () => this.closeView(),
      tools: this.env.registry.list(),
      settings: this.env.settings(),
    };
    const cleanup = view.mount(this.viewSlot, ctx) || undefined;
    this.view = { view, cleanup };
    this.renderHints();
    this.focusView();
  }

  private focusView(): void {
    const target = this.viewSlot.querySelector<HTMLElement>('[autofocus], textarea, input, button');
    (target || this.viewSlot).focus();
  }

  closeView(focus = true): void {
    if (!this.view) return;
    this.view.cleanup?.();
    this.view = null;
    clear(this.viewSlot);
    this.viewSlot.hidden = true;
    this.list.hidden = false;
    this.root.classList.remove('has-view');
    this.renderHints();
    if (focus) {
      this.input.focus();
      this.run();
    }
  }
}
