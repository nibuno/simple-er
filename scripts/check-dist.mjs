import { execFileSync } from "node:child_process";

const status = execFileSync(
  "git",
  ["status", "--porcelain", "--untracked-files=all", "--", "dist/"],
  { encoding: "utf8" },
);

if (status) {
  process.stderr.write(status);
  console.error(
    "dist/ に差分があります。npm run build を実行し、git add -A -- dist/ で変更を追加してコミットしてください。",
  );
  process.exitCode = 1;
}
