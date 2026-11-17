import type { RPCSchema } from "@tokenring-ai/rpc/types";
import { z } from "zod";
import { ScheduleDefinitionSchema, ScheduleRunSchema, ScheduleTimingSchema } from "../schema.ts";

const ScheduleViewSchema = z.object({
  name: z.string(),
  source: z.enum(["config", "user"]),
  definition: ScheduleDefinitionSchema,
  enabled: z.boolean(),
  state: z.enum(["scheduled", "running", "paused", "done", "missed", "error", "stopped"]),
  lastRunTime: z.number(),
  nextRunTime: z.number().nullable(),
  error: z.string().nullable(),
  currentRun: ScheduleRunSchema.nullable(),
});

const ChangeResultSchema = z.object({ message: z.string() });

export default {
  name: "Scheduler RPC",
  path: "/rpc/scheduler",
  methods: {
    listSchedules: {
      type: "query",
      input: z.object({}),
      result: z.object({ running: z.boolean(), schedules: z.array(ScheduleViewSchema) }),
    },
    addSchedule: {
      type: "mutation",
      input: z.object({ name: z.string(), schedule: ScheduleDefinitionSchema }),
      result: ChangeResultSchema,
    },
    updateSchedule: {
      type: "mutation",
      input: z.object({ name: z.string(), schedule: ScheduleDefinitionSchema }),
      result: ChangeResultSchema,
    },
    removeSchedule: {
      type: "mutation",
      input: z.object({ name: z.string() }),
      result: ChangeResultSchema,
    },
    setScheduleEnabled: {
      type: "mutation",
      input: z.object({ name: z.string(), enabled: z.boolean() }),
      result: ChangeResultSchema,
    },
    runSchedule: {
      type: "mutation",
      input: z.object({ name: z.string() }),
      result: ChangeResultSchema.extend({ run: ScheduleRunSchema }),
    },
    clearHistory: {
      type: "mutation",
      input: z.object({ name: z.string().exactOptional() }),
      result: ChangeResultSchema,
    },
    getHistory: {
      type: "query",
      input: z.object({ name: z.string().exactOptional() }),
      result: z.object({ history: z.record(z.string(), z.array(ScheduleRunSchema)) }),
    },
    previewNextRun: {
      type: "query",
      input: z.object({ timing: ScheduleTimingSchema }),
      result: z.object({ nextRunTime: z.number().nullable(), error: z.string().nullable() }),
    },
    setSchedulerRunning: {
      type: "mutation",
      input: z.object({ running: z.boolean() }),
      result: ChangeResultSchema,
    },
  },
} satisfies RPCSchema;
