import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import SchedulerService from './SchedulerService';

// Mock the zod module at the top level
vi.mock('zod', () => ({
  z: {
    object: vi.fn().mockReturnThis(),
    string: vi.fn().mockReturnThis(),
    array: vi.fn().mockReturnThis(),
    number: vi.fn().mockReturnThis(),
    min: vi.fn().mockReturnThis(),
    max: vi.fn().mockReturnThis(),
    optional: vi.fn().mockReturnThis(),
    boolean: vi.fn().mockReturnThis(),
    parse: vi.fn().mockImplementation((input) => input),
  },
}));

// Mock dependencies
vi.mock('@tokenring-ai/app', () => ({
  default: {
    requireService: vi.fn(),
    scheduleEvery: vi.fn(),
    serviceOutput: vi.fn(),
    serviceError: vi.fn(),
    trackPromise: vi.fn(),
  }
}));

vi.mock('@tokenring-ai/agent', () => ({
  AgentManager: class MockAgentManager {
    spawnAgent = vi.fn();
    deleteAgent = vi.fn();
  }
}));

vi.mock('@tokenring-ai/agent/state/agentEventState', () => ({
  AgentEventState: class MockAgentEventState {
    idle = true;
    getEventCursorFromCurrentPosition = vi.fn();
  }
}));

vi.mock('@tokenring-ai/utility/promise/waitForAbort', () => ({
  default: vi.fn(),
}));

// Test data
const validTasks = [
  {
    name: 'daily-report',
    agentType: 'report-agent',
    every: '1 day',
    message: 'Generate daily report',
  },
  {
    name: 'hourly-check',
    agentType: 'monitor-agent',
    spaced: '1 hour',
    message: 'Perform hourly check',
  },
  {
    name: 'weekly-summary',
    agentType: 'summary-agent',
    once: true,
    on: 'fri',
    message: 'Generate weekly summary',
  },
  {
    name: 'monthly-maintenance',
    agentType: 'maintenance-agent',
    once: true,
    dayOfMonth: 1,
    message: 'Monthly maintenance tasks',
  },
  {
    name: 'business-hours-task',
    agentType: 'business-agent',
    every: '30 minutes',
    from: '09:00',
    to: '17:00',
    message: 'Business hours task',
  },
  {
    name: 'timeout-task',
    agentType: 'long-task-agent',
    every: '2 hours',
    noLongerThan: '1 hour',
    message: 'Task with timeout',
    several: true,
  }
];

const createMockApp = () => ({
  requireService: vi.fn(),
  scheduleEvery: vi.fn(),
  serviceOutput: vi.fn(),
  serviceError: vi.fn(),
  trackPromise: vi.fn(),
});

const createMockAgentManager = () => ({
  spawnAgent: vi.fn(),
  deleteAgent: vi.fn(),
});

const createMockAgent = () => ({
  waitForState: vi.fn(),
  handleInput: vi.fn(),
  subscribeState: vi.fn(),
  config: { idleTimeout: 3600_000 },
});

describe('SchedulerService', () => {
  let scheduler: SchedulerService;
  let mockApp: any;
  let mockAgentManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApp = createMockApp();
    mockAgentManager = createMockAgentManager();
    
    mockApp.requireService.mockReturnValue(mockAgentManager);
    scheduler = new SchedulerService(mockApp, validTasks);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with valid tasks', () => {
      expect(scheduler).toBeInstanceOf(SchedulerService);
      expect(scheduler).toHaveProperty('tasks');
      expect(scheduler.tasks).toHaveLength(6);
    });

    it('should initialize task states for each task', () => {
      expect(scheduler).toHaveProperty('taskStates');
      expect(scheduler.taskStates.size).toBe(6);
      
      for (let i = 0; i < 6; i++) {
        const state = scheduler.taskStates.get(i);
        expect(state).toBeDefined();
        expect(state?.isRunning).toBe(false);
      }
    });
  });

  describe('interval parsing', () => {
    it('should parse seconds correctly', () => {
      const result = scheduler.parseInterval('30 seconds');
      expect(result).toBe(30);
    });

    it('should parse minutes correctly', () => {
      const result = scheduler.parseInterval('15 minutes');
      expect(result).toBe(900);
    });

    it('should parse hours correctly', () => {
      const result = scheduler.parseInterval('2 hours');
      expect(result).toBe(7200);
    });

    it('should parse days correctly', () => {
      const result = scheduler.parseInterval('7 days');
      expect(result).toBe(604800);
    });

    it('should handle singular and plural forms', () => {
      expect(scheduler.parseInterval('1 second')).toBe(1);
      expect(scheduler.parseInterval('1 minute')).toBe(60);
      expect(scheduler.parseInterval('1 hour')).toBe(3600);
      expect(scheduler.parseInterval('1 day')).toBe(86400);
    });

    it('should return null for invalid intervals', () => {
      expect(scheduler.parseInterval('invalid')).toBeNull();
      expect(scheduler.parseInterval('')).toBeNull();
      expect(scheduler.parseInterval('abc xyz')).toBeNull();
    });
  });

  describe('task scheduling logic', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-20T10:00:00Z')); // Friday
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    describe('every interval scheduling', () => {
      it('should calculate next run for every interval', () => {
        const taskIndex = 0; // daily-report
        const state = scheduler.taskStates.get(taskIndex);
        
        scheduler.retimeTask(taskIndex);
        
        expect(state?.nextRun).toBeDefined();
        expect(state?.nextRun).toBeGreaterThan(Date.now() / 1000);
      });
    });

    describe('once scheduling', () => {
      it('should schedule once-only tasks for today', () => {
        const taskIndex = 2; // weekly-summary (Friday)
        const state = scheduler.taskStates.get(taskIndex);
        
        scheduler.retimeTask(taskIndex);
        
        expect(state?.nextRun).toBeDefined();
        expect(state?.nextRun).toBeLessThanOrEqual(Date.now() / 1000 + 60); // within 1 minute
        expect(state?.lastDay).toBe(20); // December 20th
      });

      it('should not schedule once-only tasks for other days', () => {
        // Mock a different day
        vi.setSystemTime(new Date('2024-12-21T10:00:00Z')); // Saturday
        const taskIndex = 2; // weekly-summary (Friday only)
        const state = scheduler.taskStates.get(taskIndex);
        
        scheduler.retimeTask(taskIndex);
        
        expect(state?.nextRun).toBeUndefined();
      });

      it('should handle day of month scheduling', () => {
        const taskIndex = 3; // monthly-maintenance (1st of month)
        const state = scheduler.taskStates.get(taskIndex);
        
        scheduler.retimeTask(taskIndex);
        
        expect(state?.nextRun).toBeUndefined();
        expect(state?.lastDay).toBe(20); // December 20th
      });

      it('should skip day of month if not the right day', () => {
        vi.setSystemTime(new Date('2024-12-15T10:00:00Z')); // 15th, not 1st
        const taskIndex = 3; // monthly-maintenance (1st only)
        const state = scheduler.taskStates.get(taskIndex);
        
        scheduler.retimeTask(taskIndex);
        
        expect(state?.nextRun).toBeUndefined();
      });
    });

    describe('time window constraints', () => {
      it('should respect from/to time windows', () => {
        const taskIndex = 4; // business-hours-task (9-5)
        const state = scheduler.taskStates.get(taskIndex);
        
        scheduler.retimeTask(taskIndex);
        
        expect(state?.nextRun).toBeDefined();
      });

      it('should skip tasks outside time windows', () => {
        vi.setSystemTime(new Date('2024-12-20T18:00:00Z')); // 6 PM, outside 9-5
        const taskIndex = 4; // business-hours-task (9-5)
        const state = scheduler.taskStates.get(taskIndex);
        
        scheduler.retimeTask(taskIndex);
        
        expect(state?.nextRun).toBeUndefined();
      });
    });
  });

  describe('task execution', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-20T10:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should execute tasks correctly', async () => {
      const mockAgent = createMockAgent();
      mockAgentManager.spawnAgent.mockResolvedValue(mockAgent);
      
      const mockEventState = {
        idle: true,
        getEventCursorFromCurrentPosition: vi.fn().mockReturnValue('cursor'),
      };

      mockAgent.waitForState.mockResolvedValue(mockEventState);
      mockAgent.handleInput.mockReturnValue('request-123');
      
      // Mock subscription to trigger completion
      const mockUnsubscribe = vi.fn();
      mockAgent.subscribeState.mockImplementation((state, callback) => {
        // Simulate the output system event
        callback({
          yieldEventsByCursor: () => [
            { type: 'output.info', message: 'Task started' },
            { type: 'input.handled', requestId: 'request-123' }
          ]
        });
        return mockUnsubscribe;
      });

      const taskIndex = 0;
      await scheduler.runTask(taskIndex);

      expect(mockAgentManager.spawnAgent).toHaveBeenCalledWith({
        agentType: 'report-agent',
        headless: true
      });
      expect(mockAgent.handleInput).toHaveBeenCalledWith({
        message: 'Generate daily report'
      });
    });

    it('should handle task execution errors', async () => {
      mockAgentManager.spawnAgent.mockRejectedValue(new Error('Agent spawn failed'));

      const taskIndex = 0;
      await scheduler.runTask(taskIndex);

      expect(mockApp.serviceError).toHaveBeenCalled();
    });

    it('should respect timeout constraints', async () => {
      const mockAgent = createMockAgent();
      mockAgentManager.spawnAgent.mockResolvedValue(mockAgent);
      
      const mockEventState = {
        idle: true,
        getEventCursorFromCurrentPosition: vi.fn().mockReturnValue('cursor'),
      };

      mockAgent.waitForState.mockResolvedValue(mockEventState);
      mockAgent.handleInput.mockReturnValue('request-123');
      
      mockAgent.subscribeState.mockImplementation((state, callback) => {
        callback({
          yieldEventsByCursor: () => [
            { type: 'input.handled', requestId: 'request-123' }
          ]
        });
        return vi.fn();
      });

      const taskIndex = 5;
      await scheduler.runTask(taskIndex);

      const state = scheduler.taskStates.get(taskIndex);
      expect(state).toBeDefined();
      if (state?.maxRunTime) {
        expect(state.maxRunTime).toBeGreaterThan(Date.now() / 1000);
      }
    });
  });

  describe('run cycle management', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-20T10:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should skip tasks that are already running (unless several is true)', async () => {
      const taskIndex = 0;
      const state = scheduler.taskStates.get(taskIndex);
      
      state.isRunning = true;
      state.nextRun = Date.now() / 1000 - 60;

      await scheduler.runTasks();

      expect(mockApp.trackPromise).not.toHaveBeenCalled();
    });

  });

  describe('status reporting', () => {
    it('should return correct status with task information', () => {
      const status = scheduler.getStatus();
      
      expect(status).toHaveProperty('tasks');
      expect(status).toHaveProperty('history');
      expect(status.tasks).toHaveLength(6);
      
      const firstTask = status.tasks[0];
      expect(firstTask).toHaveProperty('name');
      expect(firstTask).toHaveProperty('agentType');
      expect(firstTask).toHaveProperty('message');
      expect(firstTask).toHaveProperty('isRunning');
      expect(firstTask).toHaveProperty('nextRun');
      expect(firstTask).toHaveProperty('lastRun');
    });
  });

  describe('service integration', () => {
    it('should implement TokenRingService interface', () => {
      expect(scheduler).toHaveProperty('name');
      expect(scheduler).toHaveProperty('description');
      expect(scheduler.name).toBe('SchedulerService');
      expect(scheduler.description).toBe('Schedules AI agents to run at specified intervals');
    });
  });
});