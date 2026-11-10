import { describe, expect, it, vi } from "vitest";
import { createRateGate, withRetry } from "@/lib/rate-gate";

/** Виртуальные часы: сон не ждёт по-настоящему, а двигает время вперёд. */
function clock(start = 10_000) {
  let t = start;
  const slept: number[] = [];
  return {
    now: () => t,
    slept,
    sleep: async (ms: number) => {
      slept.push(ms);
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("createRateGate", () => {
  it("не пускает две задачи одновременно", async () => {
    const c = clock();
    const gate = createRateGate({ minIntervalMs: 0, sleep: c.sleep, now: c.now });
    let running = 0;
    let maxRunning = 0;
    const task = async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await Promise.resolve();
      running -= 1;
    };
    await Promise.all([gate.run(task), gate.run(task), gate.run(task)]);
    expect(maxRunning).toBe(1);
  });

  it("держит порядок постановки", async () => {
    const c = clock();
    const gate = createRateGate({ minIntervalMs: 0, sleep: c.sleep, now: c.now });
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3].map((n) =>
        gate.run(async () => {
          order.push(n);
        }),
      ),
    );
    expect(order).toEqual([1, 2, 3]);
  });

  it("выжидает остаток интервала между началами запросов", async () => {
    const c = clock();
    const gate = createRateGate({ minIntervalMs: 1_000, sleep: c.sleep, now: c.now });
    await gate.run(async () => {});
    await gate.run(async () => {});
    expect(c.slept).toEqual([1_000]);
  });

  it("не ждёт, если предыдущая задача сама заняла больше интервала", async () => {
    const c = clock();
    const gate = createRateGate({ minIntervalMs: 1_000, sleep: c.sleep, now: c.now });
    await gate.run(async () => {
      c.advance(1_500);
    });
    await gate.run(async () => {});
    expect(c.slept).toEqual([]);
  });

  it("сбой задачи не заклинивает очередь", async () => {
    const c = clock();
    const gate = createRateGate({ minIntervalMs: 0, sleep: c.sleep, now: c.now });
    await expect(gate.run(async () => {
      throw new Error("boom");
    })).rejects.toThrow("boom");
    await expect(gate.run(async () => "ok")).resolves.toBe("ok");
  });

  it("возвращает значение задачи", async () => {
    const c = clock();
    const gate = createRateGate({ minIntervalMs: 0, sleep: c.sleep, now: c.now });
    await expect(gate.run(async () => 42)).resolves.toBe(42);
  });
});

describe("withRetry", () => {
  const retryable = (e: unknown) => e instanceof Error && e.message === "429";

  it("отдаёт первый успех без сна", async () => {
    const c = clock();
    const task = vi.fn(async () => "ok");
    await expect(withRetry(task, { delaysMs: [1_000], retryable, sleep: c.sleep })).resolves.toBe("ok");
    expect(task).toHaveBeenCalledTimes(1);
    expect(c.slept).toEqual([]);
  });

  it("повторяет повторяемый сбой по расписанию задержек", async () => {
    const c = clock();
    let calls = 0;
    const task = async () => {
      calls += 1;
      if (calls < 3) throw new Error("429");
      return "ok";
    };
    await expect(
      withRetry(task, { delaysMs: [1_000, 4_000], retryable, sleep: c.sleep, jitter: () => 0.5 }),
    ).resolves.toBe("ok");
    expect(calls).toBe(3);
    expect(c.slept).toEqual([1_000, 4_000]);
  });

  it("разводит одновременные повторы разбросом задержки", async () => {
    const c = clock();
    const task = async () => {
      throw new Error("429");
    };
    await expect(
      withRetry(task, { delaysMs: [1_000], retryable, sleep: c.sleep, jitter: () => 0 }),
    ).rejects.toThrow("429");
    const low = c.slept[0];

    const c2 = clock();
    await expect(
      withRetry(task, { delaysMs: [1_000], retryable, sleep: c2.sleep, jitter: () => 1 }),
    ).rejects.toThrow("429");
    const high = c2.slept[0];

    expect(low).toBe(500);
    expect(high).toBe(1_500);
  });

  it("не повторяет неповторяемый сбой", async () => {
    const c = clock();
    const task = vi.fn(async () => {
      throw new Error("404");
    });
    await expect(withRetry(task, { delaysMs: [1_000], retryable, sleep: c.sleep })).rejects.toThrow("404");
    expect(task).toHaveBeenCalledTimes(1);
    expect(c.slept).toEqual([]);
  });

  it("пробрасывает последний сбой, когда задержки кончились", async () => {
    const c = clock();
    let calls = 0;
    const task = async () => {
      calls += 1;
      throw new Error("429");
    };
    await expect(
      withRetry(task, { delaysMs: [1_000, 2_000], retryable, sleep: c.sleep, jitter: () => 0.5 }),
    ).rejects.toThrow("429");
    expect(calls).toBe(3);
  });
});
