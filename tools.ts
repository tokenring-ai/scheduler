import type { TokenRingToolDefinition } from "@tokenring-ai/chat";
import addScheduledTask from "./tools/addScheduledTask.ts";
import getSchedule from "./tools/getSchedule.ts";
import removeScheduledTask from "./tools/removeScheduledTask.ts";
import setScheduledTaskEnabled from "./tools/setScheduledTaskEnabled.ts";
import updateScheduledTask from "./tools/updateScheduledTask.ts";

export default [addScheduledTask, removeScheduledTask, getSchedule, updateScheduledTask, setScheduledTaskEnabled] satisfies TokenRingToolDefinition<any>[];
