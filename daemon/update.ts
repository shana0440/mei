import checkbox from "@inquirer/checkbox";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { runCommand } from "./client.ts";
import { home, templateDir } from "./paths.ts";

type Change = { file: string; state: "missing" | "differs" };

function changes(): Change[] {
  return readdirSync(templateDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(templateDir, join(entry.parentPath, entry.name)))
    .sort()
    .flatMap((file): Change[] => {
      const homeFile = join(home, file);
      if (!existsSync(homeFile)) return [{ file, state: "missing" }];
      const same = readFileSync(homeFile).equals(readFileSync(join(templateDir, file)));
      return same ? [] : [{ file, state: "differs" }];
    });
}

await runCommand(async () => {
  if (process.argv.length > 2) throw new Error("Usage: mei update");
  const found = changes();
  if (found.length === 0) {
    console.log(`${home} matches the template`);
    return;
  }
  if (!process.stdin.isTTY) {
    for (const { file, state } of found) console.log(`${state}  ${file}`);
    throw new Error("Run mei update in a terminal to choose which files to replace");
  }
  const chosen = await checkbox({
    message: `Replace with the template's version (your changes to a file are lost)`,
    choices: found.map(({ file, state }) => ({ name: `${file}  (${state})`, value: file })),
    pageSize: 20,
  });
  for (const file of chosen) {
    mkdirSync(dirname(join(home, file)), { recursive: true });
    copyFileSync(join(templateDir, file), join(home, file));
    console.log(`Updated ${file}`);
  }
  if (chosen.includes("config.toml")) console.log("Run mei reload to apply config.toml");
});
