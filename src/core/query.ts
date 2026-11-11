// Query: the text the user typed, plus matching helpers.
//
// The helpers deliberately only match at fixed positions (whole query, leading
// trigger, trailing trigger). There is no "contains keyword" helper: a word
// appearing somewhere in a sentence is not a command.

const normalize = (s: string) => s.trim().replace(/\s+/g, ' ');

export class Query {
  /** Exactly what was typed. */
  readonly raw: string;
  /** Trimmed, whitespace collapsed. */
  readonly text: string;
  /** `text`, lower-cased. */
  readonly lower: string;
  readonly words: readonly string[];

  constructor(raw: string) {
    this.raw = raw;
    this.text = normalize(raw);
    this.lower = this.text.toLowerCase();
    this.words = this.text ? this.text.split(' ') : [];
  }

  get isEmpty(): boolean {
    return this.text.length === 0;
  }

  /**
   * If the query starts with one of `triggers` followed by a space (or is
   * exactly the trigger), return the remainder with its original casing.
   * `command('define', 'def')` turns "define serendipity" into "serendipity".
   * Returns null when no trigger leads the query.
   */
  command(...triggers: string[]): string | null {
    for (const trigger of triggers) {
      const t = normalize(trigger).toLowerCase();
      if (this.lower === t) return '';
      if (this.lower.startsWith(t + ' ')) return this.text.slice(t.length + 1);
    }
    return null;
  }

  /** Like `command`, but requires something after the trigger. */
  commandWithArg(...triggers: string[]): string | null {
    const rest = this.command(...triggers);
    return rest ? rest : null;
  }

  /** If the query ends with " <trigger>", return the part before it. */
  suffix(...triggers: string[]): { rest: string; trigger: string } | null {
    for (const trigger of triggers) {
      const t = normalize(trigger).toLowerCase();
      if (this.lower.endsWith(' ' + t) && this.lower.length > t.length + 1) {
        return { rest: this.text.slice(0, this.text.length - t.length - 1), trigger: t };
      }
    }
    return null;
  }

  /** True when the whole query is one of `phrases` (case and spacing ignored). */
  is(...phrases: string[]): boolean {
    return phrases.some((p) => normalize(p).toLowerCase() === this.lower);
  }

  /**
   * Command-palette matching: true when the whole query is a prefix of one of
   * `phrases` and at least `min` characters long. "dupl" matches
   * "duplicate tab"; "back to the future" does not match "go back".
   */
  prefixOf(phrases: string[], min = 3): boolean {
    if (this.lower.length < min) return false;
    return phrases.some((p) => normalize(p).toLowerCase().startsWith(this.lower));
  }

  /** Run a regex against the whole trimmed query. Anchor your pattern with ^…$. */
  match(re: RegExp): RegExpMatchArray | null {
    return this.text.match(re);
  }
}
