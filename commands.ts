import loop from "./commands/loop.ts";
import add from "./commands/schedule/add.ts";
import history from "./commands/schedule/history.ts";
import remove from "./commands/schedule/remove.ts";
import show from "./commands/schedule/show.ts";
import start from "./commands/schedule/start.ts";
import stop from "./commands/schedule/stop.ts";

export default [loop, start, stop, show, add, remove, history];
