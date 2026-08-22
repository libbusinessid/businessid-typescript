/**
 * The constant pool of the emitted module.
 *
 * Weights, code point arrays and remainder tables are read only static data:
 * the specification's design targets put them at module scope and keep control
 * flow in code. Identical constants are emitted once and shared, which is safe
 * because nothing ever mutates them.
 */
export class ConstantPool {
  readonly #names = new Map<string, string>();
  readonly #lines: string[] = [];

  #intern(prefix: string, type: string, literal: string): string {
    const key = `${prefix}:${literal}`;
    const existing = this.#names.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const name = `${prefix}${String(this.#names.size)}`;
    this.#names.set(key, name);
    this.#lines.push(`const ${name}: ${type} = ${literal};`);
    return name;
  }

  /** A constant string, as the code points the IR counts in. */
  codePoints(points: readonly number[]): string {
    return this.#intern("K", "readonly number[]", `[${points.join(", ")}]`);
  }

  /** A weight sequence. */
  weights(values: readonly bigint[]): string {
    return this.#intern(
      "W",
      "readonly bigint[]",
      `[${values.map((value) => `${value.toString()}n`).join(", ")}]`,
    );
  }

  /** A remainder table. */
  remainders(values: readonly bigint[]): string {
    return this.#intern(
      "R",
      "readonly bigint[]",
      `[${values.map((value) => `${value.toString()}n`).join(", ")}]`,
    );
  }

  /** An accepted length list. */
  lengths(values: readonly number[]): string {
    return this.#intern("L", "readonly number[]", `[${values.join(", ")}]`);
  }

  /** A list of prefixes, each already interned as code points. */
  prefixes(names: readonly string[]): string {
    return this.#intern("X", "readonly (readonly number[])[]", `[${names.join(", ")}]`);
  }

  /** Every declaration, in the order it was interned. */
  declarations(): readonly string[] {
    return this.#lines;
  }
}

/**
 * The helper functions the emitted module carries: character sets and custom
 * alphabets.
 *
 * Both are emitted as switches rather than as sets or maps built when the
 * module loads, so nothing is constructed before the first call.
 */
export class HelperPool {
  readonly #names = new Map<string, string>();
  readonly #blocks: string[] = [];

  /** A predicate over the code points of a character set. */
  charset(points: readonly number[]): string {
    const sorted = [...new Set(points)].sort((left, right) => left - right);
    const key = `S:${sorted.join(",")}`;
    const existing = this.#names.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const name = `S${String(this.#names.size)}`;
    this.#names.set(key, name);
    this.#blocks.push(
      [
        `function ${name}(point: number): boolean {`,
        `  switch (point) {`,
        ...sorted.map((point) => `    case ${String(point)}:`),
        `      return true;`,
        `    default:`,
        `      return false;`,
        `  }`,
        `}`,
      ].join("\n"),
    );
    return name;
  }

  /**
   * A mapper from a code point to its index in a declared alphabet.
   *
   * The loader proved the alphabet lists no code point twice, so each case is
   * reachable and the value it yields is the only one it could be.
   */
  alphabet(points: readonly number[]): string {
    const key = `A:${points.join(",")}`;
    const existing = this.#names.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const name = `A${String(this.#names.size)}`;
    this.#names.set(key, name);
    this.#blocks.push(
      [
        `function ${name}(point: number): number | undefined {`,
        `  switch (point) {`,
        ...points.flatMap((point, index) => [
          `    case ${String(point)}:`,
          `      return ${String(index)};`,
        ]),
        `    default:`,
        `      return undefined;`,
        `  }`,
        `}`,
      ].join("\n"),
    );
    return name;
  }

  /** Every helper, in the order it was interned. */
  declarations(): readonly string[] {
    return this.#blocks;
  }
}
