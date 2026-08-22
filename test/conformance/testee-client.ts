import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  type TesteeRequest,
  TesteeRequestSchema,
  type TesteeResponse,
  TesteeResponseSchema,
} from "../../generated/libbusinessid/testee/v1/testee_pb.js";

interface Waiter {
  resolve: (frame: Buffer) => void;
  reject: (error: Error) => void;
}

/**
 * Drives a testee over the protocol of `testee.proto`.
 *
 * This is the runner side of the exchange, and the only side that ever holds an
 * expected result. The testee runs as a separate process and receives nothing
 * but the request, so it cannot adapt its answer to the case it is given.
 *
 * The exchange is strictly synchronous: one request is written, exactly one
 * response is read, and only then is the next request sent. Overlapping two
 * exchanges desynchronizes the channel, so they are queued here rather than
 * left to the caller's discipline.
 */
export class TesteeClient {
  readonly #child: ChildProcessWithoutNullStreams;
  #pending: Buffer = Buffer.alloc(0);
  #waiter: Waiter | undefined;
  #queue: Promise<void> = Promise.resolve();
  #stderr = "";
  #exited: Error | undefined;

  constructor(command: string, args: readonly string[]) {
    this.#child = spawn(command, [...args], { stdio: ["pipe", "pipe", "pipe"] });

    this.#child.stderr.on("data", (chunk: Buffer) => {
      this.#stderr += chunk.toString();
    });
    this.#child.stdout.on("data", (chunk: Buffer) => {
      this.#pending = Buffer.concat([this.#pending, chunk]);
      this.#drain();
    });
    // One exit handler for the process, not one per exchange: a listener added
    // per request would leak, and the warning it raises would drown the run.
    this.#child.once("exit", (code) => {
      this.#exited = new Error(
        `testee exited with code ${String(code)} before answering\n${this.#stderr}`,
      );
      this.#waiter?.reject(this.#exited);
      this.#waiter = undefined;
    });
  }

  #drain(): void {
    while (this.#waiter !== undefined && this.#pending.length >= 4) {
      const length = this.#pending.readUInt32LE(0);
      if (this.#pending.length < 4 + length) {
        return;
      }
      const body = this.#pending.subarray(4, 4 + length);
      this.#pending = this.#pending.subarray(4 + length);
      const waiter = this.#waiter;
      this.#waiter = undefined;
      waiter.resolve(body);
    }
  }

  /** Sends one request and waits for exactly one response. */
  async exchange(request: TesteeRequest): Promise<TesteeResponse> {
    const turn = this.#queue.then(async () => this.#exchange(request));
    this.#queue = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn;
  }

  async #exchange(request: TesteeRequest): Promise<TesteeResponse> {
    if (this.#exited !== undefined) {
      throw this.#exited;
    }
    const body = toBinary(TesteeRequestSchema, request);
    const frame = Buffer.alloc(4 + body.length);
    frame.writeUInt32LE(body.length, 0);
    Buffer.from(body).copy(frame, 4);

    const answer = new Promise<Buffer>((resolve, reject) => {
      this.#waiter = { resolve, reject };
    });
    this.#child.stdin.write(frame);
    this.#drain();
    return fromBinary(TesteeResponseSchema, await answer);
  }

  /** Closes standard input and waits for the testee to exit. */
  async close(): Promise<void> {
    this.#child.stdin.end();
    if (this.#exited !== undefined) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.#child.once("exit", () => {
        resolve();
      });
      this.#child.once("error", () => {
        resolve();
      });
    });
  }
}
