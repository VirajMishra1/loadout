import { emit } from "../../src/core/coordination/coordinator.js";

const [projectRoot, writer, rawCount] = process.argv.slice(2);
if (!projectRoot || !writer || !rawCount) {
  throw new Error("usage: coordination-writer <project-root> <writer> <count>");
}

const count = Number.parseInt(rawCount, 10);
for (let index = 0; index < count; index += 1) {
  await emit(projectRoot, {
    from: writer,
    to: "*",
    type: "task",
    description: `${writer}-${index}`,
  });
}
