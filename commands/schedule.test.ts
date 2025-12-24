import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// No zod mock needed, use real zod

// Mock Agent
const createMockAgent = () => ({
  app: {
    getService: vi.fn(),
  },
  infoLine: vi.fn(),
});

const createMockScheduler = () => ({
  getStatus: vi.fn().mockReturnValue({
    tasks: [
      {
        name: 'daily-report',
        agentType: 'report-agent',
        message: 'Generate daily report',
        isRunning: false,
        nextRun: 1703041200, // Dec 20, 2023 1:20 AM UTC
        lastRun: 1702954800, // Dec 19, 2023 1:20 AM UTC
      },
      {
        name: 'hourly-check',
        agentType: 'monitor-agent',
        message: 'Perform hourly check',
        isRunning: true,
        nextRun: 1703044800, // Dec 20, 2023 2:20 AM UTC
        lastRun: 1703041200, // Dec 20, 2023 1:20 AM UTC
      },
    ],
    history: [
      {
        taskName: 'daily-report',
        startTime: 1702954800, // Dec 19, 2023 1:20 AM UTC
        endTime: 1702954860, // Dec 19, 2023 1:21 AM UTC
      },
      {
        taskName: 'hourly-check',
        startTime: 1703041200, // Dec 20, 2023 1:20 AM UTC
        error: 'Connection timeout',
      }
    ]
  })
});

import { execute } from './schedule';

describe('schedule command', () => {
  let mockAgent: any;
  let mockScheduler: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAgent = createMockAgent();
    mockScheduler = createMockScheduler();
    mockAgent.app.getService.mockReturnValue(mockScheduler);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should display message when scheduler service is not available', () => {
    mockAgent.app.getService.mockReturnValue(null);
    
    execute(undefined as any, mockAgent);
    
    expect(mockAgent.app.getService).toHaveBeenCalled();
    expect(mockAgent.infoLine).toHaveBeenCalledWith('Scheduler service is not running.');
    expect(mockAgent.infoLine).not.toHaveBeenCalledWith(expect.stringContaining('=== Scheduled Tasks ==='));
  });

  it('should display scheduled tasks', () => {
    execute(undefined as any, mockAgent);
    
    expect(mockAgent.app.getService).toHaveBeenCalled();
    expect(mockAgent.infoLine).toHaveBeenCalledWith('=== Scheduled Tasks ===\n');
    expect(mockAgent.infoLine).toHaveBeenCalledWith('**daily-report** (report-agent)');
    expect(mockAgent.infoLine).toHaveBeenCalledWith('  Message: Generate daily report');
    expect(mockAgent.infoLine).toHaveBeenCalledWith('  Status: Idle');
    expect(mockAgent.infoLine).toHaveBeenCalledWith(expect.stringContaining('Next Run:'));
    expect(mockAgent.infoLine).toHaveBeenCalledWith(expect.stringContaining('Last Run:'));
  });

  it('should display history section', () => {
    execute(undefined as any, mockAgent);
    
    expect(mockAgent.infoLine).toHaveBeenCalledWith('\n=== Last 2 Runs ===\n');
    expect(mockAgent.infoLine).toHaveBeenCalledWith(expect.stringContaining('daily-report - completed (60s)'));
    expect(mockAgent.infoLine).toHaveBeenCalledWith(expect.stringContaining('hourly-check - failed (running)'));
    expect(mockAgent.infoLine).toHaveBeenCalledWith('  Error: Connection timeout');
  });

  it('should handle tasks without next run times', () => {
    const statusWithNoNextRun = {
      tasks: [
        {
          name: 'one-time-task',
          agentType: 'task-agent',
          message: 'One time task',
          isRunning: false,
          lastRun: 1702954800,
        }
      ],
      history: []
    };
    
    mockScheduler.getStatus.mockReturnValue(statusWithNoNextRun);
    
    execute(undefined as any, mockAgent);
    
    expect(mockAgent.infoLine).toHaveBeenCalledWith('**one-time-task** (task-agent)');
    expect(mockAgent.infoLine).toHaveBeenCalledWith('  Message: One time task');
    expect(mockAgent.infoLine).toHaveBeenCalledWith('  Status: Idle');
    expect(mockAgent.infoLine).not.toHaveBeenCalledWith(expect.stringContaining('Next Run:'));
    expect(mockAgent.infoLine).toHaveBeenCalledWith(expect.stringContaining('Last Run:'));
  });

  it('should handle tasks without last run times', () => {
    const statusWithNoLastRun = {
      tasks: [
        {
          name: 'future-task',
          agentType: 'future-agent',
          message: 'Future task',
          isRunning: false,
          nextRun: 1703044800,
        }
      ],
      history: []
    };
    
    mockScheduler.getStatus.mockReturnValue(statusWithNoLastRun);
    
    execute(undefined as any, mockAgent);
    
    expect(mockAgent.infoLine).toHaveBeenCalledWith('**future-task** (future-agent)');
    expect(mockAgent.infoLine).toHaveBeenCalledWith('  Message: Future task');
    expect(mockAgent.infoLine).toHaveBeenCalledWith('  Status: Idle');
    expect(mockAgent.infoLine).toHaveBeenCalledWith(expect.stringContaining('Next Run:'));
    expect(mockAgent.infoLine).not.toHaveBeenCalledWith(expect.stringContaining('Last Run:'));
  });

  it('should handle empty history', () => {
    const statusWithEmptyHistory = {
      tasks: [
        {
          name: 'test-task',
          agentType: 'test-agent',
          message: 'Test task',
          isRunning: false,
          nextRun: 1703067600,
          lastRun: 1702977600,
        }
      ],
      history: [] // Empty history
    };
    
    mockScheduler.getStatus.mockReturnValue(statusWithEmptyHistory);
    
    execute(undefined as any, mockAgent);
    
    expect(mockAgent.infoLine).not.toHaveBeenCalledWith(expect.stringContaining('=== Last'));
    expect(mockAgent.infoLine).not.toHaveBeenCalledWith(expect.stringContaining('Runs'));
  });

  it('should limit history display to last 50 runs', () => {
    const statusWithManyRuns = {
      tasks: [],
      history: Array.from({ length: 75 }, (_, i) => ({
        taskName: `task-${i}`,
        startTime: 1702977600 + i * 3600, // Each hour apart
        endTime: 1702977600 + i * 3600 + 300, // 5 minute duration
      }))
    };
    
    mockScheduler.getStatus.mockReturnValue(statusWithManyRuns);
    
    execute(undefined as any, mockAgent);
    
    // Should only show last 50 runs
    const historyCalls = mockAgent.infoLine.mock.calls.filter(call => 
      call[0].includes('[') && call[0].includes(']')
    );
    
    expect(historyCalls.length).toBe(50);
  });

  it('should format duration correctly for completed tasks', () => {
    const statusWithCompletedTask = {
      tasks: [],
      history: [
        {
          taskName: 'short-task',
          startTime: 1702954800,
          endTime: 1702954805,
        },
        {
          taskName: 'long-task',
          startTime: 1702954800,
          endTime: 1702955100,
        }
      ]
    };
    
    mockScheduler.getStatus.mockReturnValue(statusWithCompletedTask);
    
    execute(undefined as any, mockAgent);
    
    expect(mockAgent.infoLine).toHaveBeenCalledWith(expect.stringContaining('short-task - completed (5s)'));
    expect(mockAgent.infoLine).toHaveBeenCalledWith(expect.stringContaining('long-task - completed (300s)'));
  });
});