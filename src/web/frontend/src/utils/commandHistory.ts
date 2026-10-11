/**
 * Shell-style recall for the console composer: Up walks back through sent
 * commands, Down walks forward and finally returns the line that was being
 * typed before recall started.
 */
export class CommandHistory {
  private readonly entries: string[] = [];
  /** Index into entries while recalling; entries.length means "not recalling". */
  private cursor = 0;
  private draft = "";

  constructor(private readonly limit = 50) {}

  record(command: string): void {
    const text = command.trim();
    if (text && this.entries[this.entries.length - 1] !== text) {
      this.entries.push(text);
      if (this.entries.length > this.limit) this.entries.shift();
    }
    this.cursor = this.entries.length;
    this.draft = "";
  }

  /** The older command, or null when there is none (keep the input as is). */
  previous(current: string): string | null {
    if (this.cursor === 0) return null;
    if (this.cursor === this.entries.length) this.draft = current;
    this.cursor -= 1;
    return this.entries[this.cursor] ?? null;
  }

  /** The newer command, the draft once past the newest, or null when not recalling. */
  next(): string | null {
    if (this.cursor >= this.entries.length) return null;
    this.cursor += 1;
    return this.cursor === this.entries.length ? this.draft : (this.entries[this.cursor] ?? null);
  }
}
