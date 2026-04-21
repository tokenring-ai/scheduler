import type {RPCSchema} from "@tokenring-ai/rpc/types";
import {z} from "zod";
import {AgentNotFoundSchema} from "@tokenring-ai/agent/schema";

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
      result: z.discriminatedUnion("status", [
        z.object({
          status: z.literal('success'),
          tasks: z.record(z.string(), ScheduledTaskSchema),
          count: z.number(),
        }),
        AgentNotFoundSchema
      ]),
    },
    addTask: {
      type: "mutation",
      input: z.object({
        agentId: z.string(),
        name: z.string(),
        task: ScheduledTaskSchema,
      }),
      result: z.discriminatedUnion("status", [
        z.object({
          status: z.literal('success'),
          success: z.boolean(),
          message: z.string(),
        }),
        AgentNotFoundSchema
      ]),
    },
    removeTask: {
      type: "mutation",
      input: z.object({
        agentId: z.string(),
        name: z.string(),
      }),
      result: z.discriminatedUnion("status", [
        z.object({
          status: z.literal('success'),
          success: z.boolean(),
          message: z.string(),
        }),
        AgentNotFoundSchema
      ]),
    },
    getStatus: {
      type: "query",
      input: z.object({
        agentId: z.string(),
      }),
      result: z.discriminatedUnion("status", [
        z.object({
          status: z.literal('success'),
          running: z.boolean(),
          autoStart: z.boolean(),
          executions: z.record(z.string(), ExecutionEntrySchema),
        }),
        AgentNotFoundSchema
      ]),
    },
    startScheduler: {
      type: "mutation",
      input: z.object({
        agentId: z.string(),
      }),
      result: z.discriminatedUnion("status", [
        z.object({
          status: z.literal('success'),
          success: z.boolean(),
          message: z.string(),
        }),
        AgentNotFoundSchema
      ]),
    },
    stopScheduler: {
      type: "mutation",
      input: z.object({
        agentId: z.string(),
      }),
      result: z.discriminatedUnion("status", [
        z.object({
          status: z.literal('success'),
          success: z.boolean(),
          message: z.string(),
        }),
        AgentNotFoundSchema
      ]),
    },
    getHistory: {
      type: "query",
      input: z.object({
        agentId: z.string(),
        taskName: z.string().optional(),
      }),
      result: z.discriminatedUnion("status", [
        z.object({
          status: z.literal('success'),
          history: z.record(z.string(), z.array(TaskRunHistorySchema)),
        }),
        AgentNotFoundSchema
      ]),
    },
  },
} satisfies RPCSchema;
