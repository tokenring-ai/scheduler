import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import chatCommands from "./chatCommands";
import plugin from "./plugin";
import SchedulerService from './SchedulerService';

// No zod mock needed, use real zod

// Mock the app ecosystem
vi.mock('@tokenring-ai/app', () => ({
  default: {
    requireService: vi.fn(),
    scheduleEvery: vi.fn(),
    serviceOutput: vi.fn(),
    serviceError: vi.fn(),
    trackPromise: vi.fn(),
    getConfigSlice: vi.fn(),
    addServices: vi.fn(),
    waitForService: vi.fn(),
    getService: vi.fn(),
  }
}));

vi.mock('@tokenring-ai/agent', () => ({
  AgentManager: class MockAgentManager {
    spawnAgent = vi.fn();
    deleteAgent = vi.fn();
  },
  AgentCommandService: class MockAgentCommandService {
    addAgentCommands = vi.fn();
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

const createMockApp = () => ({
  requireService: vi.fn(),
  scheduleEvery: vi.fn(),
  serviceOutput: vi.fn(),
  serviceError: vi.fn(),
  trackPromise: vi.fn(),
  getConfigSlice: vi.fn(),
  addServices: vi.fn(),
  waitForService: vi.fn(),
  getService: vi.fn(),
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

const createMockAgentEventState = () => ({
  idle: true,
  getEventCursorFromCurrentPosition: vi.fn().mockReturnValue('cursor'),
});

describe('Scheduler Integration Tests', () => {
  let mockApp: any;
  let mockAgentManager: any;
  let mockAgentCommandService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApp = createMockApp();
    mockAgentManager = createMockAgentManager();
    mockAgentCommandService = {
      addAgentCommands: vi.fn(),
    };
    
    mockApp.requireService.mockReturnValue(mockAgentManager);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('end-to-end scheduling workflow', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-20T10:00:00Z')); // Friday
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should handle task execution with timeout constraints', async () => {
      const tasks = [
        {
          name: 'timeout-task',
          agentType: 'timeout-agent',
          every: '2 hours',
          noLongerThan: '30 minutes',
          message: 'Task with timeout',
        }
      ];

      const scheduler = new SchedulerService(mockApp, tasks);
      
      // Mock agent creation
      const mockAgent = createMockAgent();
      const mockEventState = createMockAgentEventState();
      
      mockAgent.waitForState.mockResolvedValue(mockEventState);
      mockAgent.handleInput.mockReturnValue('request-123');
      mockAgentManager.spawnAgent.mockResolvedValue(mockAgent);
      
      mockAgent.subscribeState.mockImplementation((state, callback) => {
        callback({
          yieldEventsByCursor: () => [
            { type: 'input.handled', requestId: 'request-123' }
          ]
        });
        return vi.fn();
      });

      await scheduler.runTask(0);

      const state = scheduler.taskStates.get(0);
      expect(state).toBeDefined();
      if (state?.maxRunTime) {
        expect(state.maxRunTime).toBeGreaterThan(Date.now() / 1000);
      }
    });

    it('should handle agent execution errors gracefully', async () => {
      
      
      const tasks = [
        {
          name: 'failing-task',
          agentType: 'failing-agent',
          every: '1 hour',
          message: 'Task that fails',
        }
      ];

      const scheduler = new SchedulerService(mockApp, tasks);
      
      // Mock agent creation to fail
      const error = new Error('Agent creation failed');
      mockAgentManager.spawnAgent.mockRejectedValue(error);

      // Execute the task
      await scheduler.runTask(0);

      // Verify error was logged
      expect(mockApp.serviceError).toHaveBeenCalledWith(
        '[SchedulerService] Error running task failing-task:', 
        error
      );

      // Verify history includes error
      const status = scheduler.getStatus();
      expect(status.history).toHaveLength(1);
      expect(status.history[0].error).toBe('Error: Agent creation failed');
    });
  });

  describe('plugin integration', () => {
    it('should integrate with app plugin system', async () => {
      const validTasks = [
        {
          name: 'plugin-test-task',
          agentType: 'plugin-agent',
          every: '1 day',
          message: 'Plugin test task',
        }
      ];
      
      mockApp.getConfigSlice.mockReturnValue({ tasks: validTasks });
      
      plugin.install(mockApp);
      
      // Verify plugin integration
      expect(mockApp.getConfigSlice).toHaveBeenCalledWith('scheduler', expect.any(Object));
      expect(mockApp.waitForService).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Function)
      );
      expect(mockApp.addServices).toHaveBeenCalled();
    });

    it('should register chat commands through plugin', async () => {
      const validTasks = [
        {
          name: 'chat-test-task',
          agentType: 'chat-agent',
          every: '1 hour',
          message: 'Chat test task',
        }
      ];
      
      mockApp.getConfigSlice.mockReturnValue({ tasks: validTasks });
      plugin.install(mockApp);
      
      // Get the callback and execute it
      const callback = mockApp.waitForService.mock.calls[0][1];
      callback(mockAgentCommandService);
      
      expect(mockAgentCommandService.addAgentCommands).toHaveBeenCalledWith(chatCommands);
    });
  });

  describe('status and monitoring integration', () => {
    it('should provide comprehensive status across all tasks', () => {
      const tasks = [
        {
          name: 'status-task-1',
          agentType: 'status-agent-1',
          every: '1 hour',
          message: 'Status task 1',
        },
        {
          name: 'status-task-2',
          agentType: 'status-agent-2',
          spaced: '2 hours',
          message: 'Status task 2',
          several: true,
        }
      ];

      const scheduler = new SchedulerService(mockApp, tasks);
      const status = scheduler.getStatus();
      
      expect(status.tasks).toHaveLength(2);
      expect(status.history).toHaveLength(0);
      
      // Verify all task properties are present
      status.tasks.forEach((task: any, index: number) => {
        expect(task).toHaveProperty('name');
        expect(task).toHaveProperty('agentType');
        expect(task).toHaveProperty('message');
        expect(task).toHaveProperty('isRunning');
        expect(task).toHaveProperty('nextRun');
        expect(task).toHaveProperty('lastRun');
      });
    });

    it('should track execution history correctly', async () => {
      const tasks = [
        {
          name: 'history-task',
          agentType: 'history-agent',
          every: '1 hour',
          message: 'History task',
        }
      ];

      const scheduler = new SchedulerService(mockApp, tasks);
      
      // Mock successful execution
      const mockAgent = createMockAgent();
      const mockEventState = createMockAgentEventState();
      
      mockAgent.waitForState.mockResolvedValue(mockEventState);
      mockAgent.handleInput.mockReturnValue('request-123');
      mockAgentManager.spawnAgent.mockResolvedValue(mockAgent);
      
      mockAgent.subscribeState.mockImplementation((state, callback) => {
        callback({
          yieldEventsByCursor: () => [
            { type: 'input.handled', requestId: 'request-123' }
          ]
        });
        return vi.fn();
      });

      await scheduler.runTask(0);

      const status = scheduler.getStatus();
      expect(status.history).toHaveLength(1);
      expect(status.history[0]).toHaveProperty('taskName');
      expect(status.history[0]).toHaveProperty('startTime');
      expect(status.history[0]).toHaveProperty('endTime');
      expect(status.history[0].taskName).toBe('history-task');
    });
  });

  describe('time-based scheduling integration', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should handle weekday-based scheduling', () => {
      // Set to Friday
      vi.setSystemTime(new Date('2024-12-20T10:00:00Z')); // Friday
      
      const tasks = [
        {
          name: 'weekday-task',
          agentType: 'weekday-agent',
          once: true,
          on: 'fri',
          message: 'Friday task',
        }
      ];

      const scheduler = new SchedulerService(mockApp, tasks);
      scheduler.retimeTask(0);
      
      const state = scheduler.taskStates.get(0);
      expect(state?.nextRun).toBeDefined();
    });

    it('should handle day-of-month scheduling', () => {
      // Set to 1st of month
      vi.setSystemTime(new Date('2024-12-01T10:00:00Z'));
      
      const tasks = [
        {
          name: 'monthly-task',
          agentType: 'monthly-agent',
          once: true,
          dayOfMonth: 1,
          message: 'Monthly task',
        }
      ];

      const scheduler = new SchedulerService(mockApp, tasks);
      scheduler.retimeTask(0);
      
      const state = scheduler.taskStates.get(0);
      expect(state?.nextRun).toBeDefined();
    });

    it('should respect time window constraints', () => {
      // Set to business hours
      vi.setSystemTime(new Date('2024-12-20T14:00:00Z')); // 2 PM, within 9-5
      
      const tasks = [
        {
          name: 'business-task',
          agentType: 'business-agent',
          every: '1 hour',
          from: '09:00',
          to: '17:00',
          message: 'Business hours task',
        }
      ];

      const scheduler = new SchedulerService(mockApp, tasks);
      scheduler.retimeTask(0);
      
      const state = scheduler.taskStates.get(0);
      expect(state?.nextRun).toBeDefined();
    });
  });
});