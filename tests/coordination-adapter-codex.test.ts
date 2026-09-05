import { describe, expect, it } from "vitest";
import {
  CodexAdapter,
  type CodexSdkDriver,
  type CodexThreadDriver,
} from "../src/core/coordination/adapters/codex.js";

class FakeThread implements CodexThreadDriver {
  id: string | null;
  readonly prompts: string[] = [];
  private readonly assignedId: string;
  abort?(): void;

  constructor(id: string | null, assignedId = "codex-thread-1") {
    this.id = id;
    this.assignedId = assignedId;
  }

  async run(prompt: string): Promise<unknown> {
    this.prompts.push(prompt);
    this.id ??= this.assignedId;
    return { finalResponse: `response:${prompt}` };
  }
}

class FakeCodexDriver implements CodexSdkDriver {
  readonly startCalls: Array<{ workingDirectory: string }> = [];
  readonly resumeCalls: Array<{
    sessionId: string;
    options: { workingDirectory: string };
  }> = [];
  readonly startedThread = new FakeThread(null);
  resumedThread: FakeThread | undefined;

  startThread(options: { workingDirectory: string }): CodexThreadDriver {
    this.startCalls.push(options);
    return this.startedThread;
  }

  resumeThread(
    sessionId: string,
    options: { workingDirectory: string },
  ): CodexThreadDriver {
    this.resumeCalls.push({ sessionId, options });
    this.resumedThread = new FakeThread(sessionId);
    return this.resumedThread;
  }
}

describe("CodexAdapter", () => {
  it("starts a thread and runs the initial prompt through the SDK driver", async () => {
    const driver = new FakeCodexDriver();
    const adapter = new CodexAdapter(driver);

    const session = await adapter.start({
      cwd: "/work/project",
      prompt: "Implement the contract",
    });

    expect(driver.startCalls).toEqual([{ workingDirectory: "/work/project" }]);
    expect(driver.startedThread.prompts).toEqual(["Implement the contract"]);
    expect(session).toMatchObject({
      sessionId: "codex-thread-1",
      provider: "codex",
      busy: false,
    });
    expect(adapter.lastResponse?.(session.sessionId)).toBe(
      "response:Implement the contract",
    );
  });

  it("resumes a thread and submits the next turn through run", async () => {
    const driver = new FakeCodexDriver();
    const adapter = new CodexAdapter(driver);

    const session = await adapter.resume("codex-thread-2", "/work/project");
    await expect(
      adapter.submitTurn(session, { message: "Continue" }),
    ).resolves.toBe(true);

    expect(driver.resumeCalls).toEqual([
      {
        sessionId: "codex-thread-2",
        options: { workingDirectory: "/work/project" },
      },
    ]);
    expect(driver.resumedThread?.prompts).toEqual(["Continue"]);
  });

  it("rejects a new thread when the SDK does not return an id", async () => {
    const driver = new FakeCodexDriver();
    driver.startedThread.run = async () => ({});
    const adapter = new CodexAdapter(driver);

    await expect(
      adapter.start({ cwd: "/work", prompt: "First" }),
    ).rejects.toThrow(/valid thread id/i);
  });

  it("denies a concurrent turn while the thread is busy", async () => {
    let finishTurn: (() => void) | undefined;
    const thread = new FakeThread("codex-thread-1");
    thread.run = async () =>
      new Promise((resolve) => {
        finishTurn = () => resolve({});
      });
    const driver: CodexSdkDriver = {
      startThread: () => thread,
      resumeThread: () => thread,
    };
    const adapter = new CodexAdapter(driver);
    const session = await adapter.resume("codex-thread-1", "/work");

    const first = adapter.submitTurn(session, { message: "First" });
    await expect(
      adapter.submitTurn(session, { message: "Second" }),
    ).resolves.toBe(false);
    expect(session.busy).toBe(true);

    finishTurn?.();
    await expect(first).resolves.toBe(true);
    expect(session.busy).toBe(false);
  });

  it("aborts start when signal fires during the initial run", async () => {
    const controller = new AbortController();
    let runResolve: (() => void) | undefined;
    const thread = new FakeThread(null);
    thread.run = () =>
      new Promise((resolve) => {
        runResolve = () => resolve({});
      });
    const abortCalled: boolean[] = [];
    thread.abort = () => {
      abortCalled.push(true);
    };
    const driver: CodexSdkDriver = {
      startThread: () => thread,
      resumeThread: () => thread,
    };
    const adapter = new CodexAdapter(driver);

    const startPromise = adapter.start({
      cwd: "/work",
      prompt: "Build it",
      signal: controller.signal,
    });
    controller.abort();
    await expect(startPromise).rejects.toThrow();
    expect(abortCalled).toHaveLength(1);
    runResolve?.(); // clean up
  });

  it("aborts submitTurn and releases busy state", async () => {
    const driver = new FakeCodexDriver();
    const adapter = new CodexAdapter(driver);
    const session = await adapter.resume("codex-thread-1", "/work");

    const controller = new AbortController();
    let runResolve: (() => void) | undefined;
    const thread = driver.resumedThread!;
    thread.run = (prompt: string) => {
      return new Promise((resolve) => {
        runResolve = () => resolve({ finalResponse: `response:${prompt}` });
      });
    };

    const turnPromise = adapter.submitTurn(session, {
      message: "Do something",
      signal: controller.signal,
    });
    controller.abort();
    const result = await turnPromise;
    expect(result).toBe(false);
    expect(session.busy).toBe(false);
    runResolve?.(); // clean up
  });

  it("rejects start immediately when signal is already aborted", async () => {
    const driver = new FakeCodexDriver();
    const adapter = new CodexAdapter(driver);
    const controller = new AbortController();
    controller.abort();

    await expect(
      adapter.start({ cwd: "/work", prompt: "Hi", signal: controller.signal }),
    ).rejects.toThrow();
    expect(driver.startCalls).toHaveLength(0);
  });

  it("permits a new turn after a cancelled one", async () => {
    const driver = new FakeCodexDriver();
    const adapter = new CodexAdapter(driver);
    const session = await adapter.resume("codex-thread-1", "/work");

    // Cancel first turn
    const controller = new AbortController();
    const thread = driver.resumedThread!;
    thread.run = () => new Promise(() => {}); // never resolves
    const turnPromise = adapter.submitTurn(session, {
      message: "Cancel me",
      signal: controller.signal,
    });
    controller.abort();
    await turnPromise;

    // Session should accept new turn
    expect(session.busy).toBe(false);
    expect(session.active).toBe(true);
    thread.run = async (prompt: string) => ({ finalResponse: `ok:${prompt}` });
    const result = await adapter.submitTurn(session, { message: "Try again" });
    expect(result).toBe(true);
  });
});
