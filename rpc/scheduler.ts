import type TokenRingApp from "@tokenring-ai/app";
import { createRPCEndpoint } from "@tokenring-ai/rpc/createRPCEndpoint";
import SchedulerService from "../SchedulerService.ts";
import SchedulerRpcSchema from "./schema.ts";

export default createRPCEndpoint(SchedulerRpcSchema, {
  listSchedules(_args, app: TokenRingApp) {
    const scheduler = app.requireService(SchedulerService);
    return { running: scheduler.isRunning(), schedules: scheduler.listSchedules() };
  },

  addSchedule(args, app: TokenRingApp) {
    app.requireService(SchedulerService).addSchedule(args.name, args.schedule);
    return { message: `Schedule "${args.name}" added` };
  },

  updateSchedule(args, app: TokenRingApp) {
    app.requireService(SchedulerService).updateSchedule(args.name, args.schedule);
    return { message: `Schedule "${args.name}" updated` };
  },

  removeSchedule(args, app: TokenRingApp) {
    app.requireService(SchedulerService).removeSchedule(args.name);
    return { message: `Schedule "${args.name}" removed` };
  },

  setScheduleEnabled(args, app: TokenRingApp) {
    app.requireService(SchedulerService).setEnabled(args.name, args.enabled);
    return { message: `Schedule "${args.name}" ${args.enabled ? "resumed" : "paused"}` };
  },

  runSchedule(args, app: TokenRingApp) {
    const run = app.requireService(SchedulerService).runNow(args.name);
    return { message: `Schedule "${args.name}" started`, run };
  },

  clearHistory(args, app: TokenRingApp) {
    app.requireService(SchedulerService).clearHistory(args.name);
    return { message: args.name ? `History cleared for "${args.name}"` : "Run history cleared" };
  },

  getHistory(args, app: TokenRingApp) {
    return { history: app.requireService(SchedulerService).getHistory(args.name) };
  },

  previewNextRun(args, app: TokenRingApp) {
    return app.requireService(SchedulerService).previewNextRun(args.timing);
  },

  setSchedulerRunning(args, app: TokenRingApp) {
    app.requireService(SchedulerService).setRunning(args.running);
    return { message: args.running ? "Scheduler started" : "Scheduler stopped" };
  },
});
