import type { TokenRingToolDefinition } from "@tokenring-ai/chat";
import addScheduledTask from "./tools/addScheduledTask.ts";
import getSchedule from "./tools/getSchedule.ts";
import removeScheduledTask from "./tools/removeScheduledTask.ts";

export default [addScheduledTask, removeScheduledTask, getSchedule] satisfies TokenRingToolDefinition<any>[];
