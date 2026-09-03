import { closeMainWindow, environment, open } from "@raycast/api";
import { join } from "node:path";

export default async function Practice() {
  await open(join(environment.assetsPath, "web", "index.html"));
  await closeMainWindow();
}
