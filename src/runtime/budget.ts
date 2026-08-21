import { EngineError } from "../domain/errors.js";
import { LIMITS } from "./limits.js";

/**
 * The evaluation budget of one public operation.
 *
 * Each node evaluation, each canonicalization step and each program invocation
 * costs one unit. An operation that produces a string, and every
 * canonicalization step, costs one further unit per started slice of 64
 * produced code points. That second charge is what bounds the memory a bundle
 * can make the engine allocate: the code points one operation materialises can
 * never exceed the budget times 64.
 *
 * The budget bounds an interpretation. It exists here because this engine
 * walks the IR at validation time rather than compiling it ahead of time.
 */
export class Budget {
  #remaining: number;

  constructor(steps: number = LIMITS.stepsPerValidation) {
    this.#remaining = steps;
  }

  /** Charges one step. */
  step(): void {
    this.#spend(1);
  }

  /** Charges one step per started slice of 64 produced code points. */
  produced(codePoints: number): void {
    this.#spend(Math.ceil(codePoints / LIMITS.codePointsPerStep));
  }

  #spend(units: number): void {
    this.#remaining -= units;
    if (this.#remaining < 0) {
      throw new EngineError("evaluation budget exhausted");
    }
  }
}
