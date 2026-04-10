import type {RPCSchema} from "@tokenring-ai/rpc/types";
import {z} from "zod";

const ScheduledTaskSchema = z.object({
  repeat: z.string().optional(),
  after: z.string().optional(),
  before: z.string().optional(),
  weekdays: z.string().optional(),
  dayOfMonth: z.number().min(1).max(31).optional(),
  lastRunTime: z.number(),
  timezone: z.string().optional(),
  message: z.string(),
});

const TaskRunHistorySchema = z.object({
  startTime: z.number(),
  endTime: z.number(),
  status: z.enum(["completed", "failed"]),
  message: z.string(),
});

const ExecutionEntrySchema = z.object({
  nextRunTime: z.number().nullable(),
  status: z.enum(["pending", "running"]),
  startTime: z.number().optional(),
});

export default {
  name: "Scheduler RPC",
  path: "/rpc/scheduler",
  methods: {
    getTasks: {
      type: "query",
      input: z.object({
        agentId: z.string(),
      }),
      result: z.object({
        tasks: z.record(z.string(), ScheduledTaskSchema),
        count: z.number(),
      }),
    },
    addTask: {
      type: "mutation",
      input: z.object({
        agentId: z.string(),
        name: z.string(),
        task: ScheduledTaskSchema,
      }),
      result: z.object({
        success: z.boolean(),
        message: z.string(),
      }),
    },
    removeTask: {
      type: "mutation",
      input: z.object({
        agentId: z.string(),
        name: z.string(),
      }),
      result: z.object({
        success: z.boolean(),
        message: z.string(),
      }),
    },
    getStatus: {
      type: "query",
      input: z.object({
        agentId: z.string(),
      }),
      result: z.object({
        running: z.boolean(),
        autoStart: z.boolean(),
        executions: z.record(z.string(), ExecutionEntrySchema),
      }),
    },
    startScheduler: {
      type: "mutation",
      input: z.object({
        agentId: z.string(),
      }),
      result: z.object({
        success: z.boolean(),
        message: z.string(),
      }),
    },
    stopScheduler: {
      type: "mutation",
      input: z.object({
        agentId: z.string(),
      }),
      result: z.object({
        success: z.boolean(),
        message: z.string(),
      }),
    },
    getHistory: {
      type: "query",
      input: z.object({
        agentId: z.string(),
        taskName: z.string().optional(),
      }),
      result: z.object({
        history: z.record(z.string(), z.array(TaskRunHistorySchema)),
      }),
    },
  },
} satisfies RPCSchema;
