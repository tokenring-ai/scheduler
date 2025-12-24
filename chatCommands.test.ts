import { describe, it, expect, beforeEach, vi } from 'vitest';
import chatCommands from './chatCommands';
import scheduleCommand from './commands/schedule';

// Mock the schedule command
vi.mock('./commands/schedule', () => ({
  default: {
    description: '/schedule - Display current schedule and run history.',
    execute: vi.fn(),
    help: '# /schedule\n\n## Description\nDisplay current schedule, next run times, and execution history.\n\n## Usage\n/schedule\n\n## Output\n- Current scheduled tasks with next/last run times\n- Last 50 agent execution runs with status and duration',
  }
}));

describe('chatCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should export the schedule command', () => {
    expect(chatCommands).toHaveProperty('schedule');
    expect(chatCommands.schedule).toBe(scheduleCommand);
  });

  it('should export the schedule command with correct description', () => {
    const { description, execute, help } = chatCommands.schedule;
    
    expect(description).toBe('/schedule - Display current schedule and run history.');
    expect(typeof execute).toBe('function');
    expect(help).toContain('# /schedule');
  });
});