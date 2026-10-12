import FormActionBar from "@tokenring-ai/one-frontend/components/ui/FormActionBar.tsx";
import { toastManager } from "@tokenring-ai/one-frontend/components/ui/toast.tsx";
import { cn } from "@tokenring-ai/one-frontend/lib/utils.ts";
import { schedulerRPCClient } from "@tokenring-ai/one-frontend/rpc.ts";
import { Select, TextArea, TextField } from "@tokenring-ai/one-frontend/ui";
import formatError from "@tokenring-ai/utility/error/formatError";
import { CalendarClock, Plus, Save, X } from "lucide-react";
import type { SubmitEvent } from "react";
import { useMemo, useState } from "react";
import { type NextRunPreview, useNextRunPreview } from "../../lib/useNextRunPreview.ts";
import { COMMON_TIMEZONES, formatRelativeTime, formatScheduleTime, REPEAT_PRESETS, WEEKDAY_OPTIONS } from "./formatters.ts";
import { buildTaskFromForm, type ScheduledTaskInput, type TaskFormValues, taskToFormValues } from "./taskForm.ts";

type AddTaskFormProps = {
  agentId: string;
  existingNames: string[];
  /** Edit this task instead of creating one. Its name is fixed; `lastRunTime` is kept by the server. */
  editing?: { name: string; task: ScheduledTaskInput } | undefined;
  /** Called after a successful create or update. */
  onCreated: () => void;
  onCancel: () => void;
};

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function emptyValues(): TaskFormValues {
  return {
    name: "",
    message: "",
    repeatPreset: "1 day",
    customRepeat: "",
    after: "",
    before: "",
    weekdays: [],
    dayOfMonth: "",
    timezone: detectTimezone(),
  };
}

function NextRunLine({ preview, paused }: { preview: NextRunPreview; paused: boolean }) {
  let text: string;
  if (preview.state === "idle") text = "Fill in the task to preview its next run";
  else if (preview.state === "loading") text = "Calculating…";
  else if (preview.state === "error") text = `Unable to preview: ${preview.error}`;
  else if (preview.nextRunTime == null) text = "Not scheduled within the next 30 days";
  else text = `${formatScheduleTime(preview.nextRunTime)} (${formatRelativeTime(preview.nextRunTime)})`;
  return (
    <p className="text-xs text-muted flex items-center gap-1.5" aria-live="polite" data-testid="next-run-preview">
      <CalendarClock className="w-3.5 h-3.5 shrink-0" />
      <span>
        {paused ? "Paused · next run once resumed: " : "Next run: "}
        <span className="text-primary font-medium">{text}</span>
      </span>
    </p>
  );
}

export default function AddTaskForm({ agentId, existingNames, editing, onCreated, onCancel }: AddTaskFormProps) {
  const [values, setValues] = useState<TaskFormValues>(() => (editing ? taskToFormValues(editing.name, editing.task, detectTimezone()) : emptyValues()));
  const [saving, setSaving] = useState(false);
  const isEdit = editing != null;
  const base = useMemo(
    () => ({ lastRunTime: editing?.task.lastRunTime ?? 0, ...(editing?.task.enabled === false ? { enabled: false } : {}) }),
    [editing?.task.lastRunTime, editing?.task.enabled],
  );

  const set = <K extends keyof TaskFormValues>(key: K, value: TaskFormValues[K]) => setValues(prev => ({ ...prev, [key]: value }));

  const timezones = useMemo(() => {
    const set = new Set<string>([...COMMON_TIMEZONES, detectTimezone(), values.timezone]);
    return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [values.timezone]);

  // The preview needs a schedule, not a name or message; fill placeholders so it shows while those are empty.
  const previewTask = useMemo(() => {
    const result = buildTaskFromForm({ ...values, name: values.name || "preview", message: values.message || "preview" }, base);
    return result.ok ? result.task : null;
  }, [values, base]);
  const preview = useNextRunPreview(previewTask);

  const toggleWeekday = (id: string) => {
    set("weekdays", values.weekdays.includes(id) ? values.weekdays.filter(d => d !== id) : [...values.weekdays, id]);
  };

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    const built = buildTaskFromForm(values, base);
    if (!built.ok) {
      toastManager.error(built.error, { duration: 4000 });
      return;
    }
    if (!isEdit && existingNames.includes(built.name)) {
      toastManager.error(`A task named "${built.name}" already exists`, { duration: 4000 });
      return;
    }

    setSaving(true);
    try {
      const result = isEdit
        ? await schedulerRPCClient.updateTask({ agentId, name: editing.name, task: built.task })
        : await schedulerRPCClient.addTask({ agentId, name: built.name, task: built.task });
      if (result.status === "agentNotFound") {
        toastManager.error("Agent no longer exists", { duration: 4000 });
        return;
      }
      toastManager.success(result.message, { duration: 3000 });
      onCreated();
    } catch (err) {
      toastManager.error(formatError(err), { duration: 5000 });
    } finally {
      setSaving(false);
    }
  };

  const timezoneSelect = (
    <Select label="Timezone" value={values.timezone} onChange={v => set("timezone", v)} className={values.repeatPreset === "custom" ? "sm:col-span-2" : ""}>
      {timezones.map(tz => (
        <option key={tz} value={tz}>
          {tz}
        </option>
      ))}
    </Select>
  );

  return (
    <form onSubmit={e => void handleSubmit(e)} className="bg-secondary border border-primary rounded-xl p-4 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-primary">{isEdit ? `Edit "${editing.name}"` : "Add scheduled task"}</h3>
          <p className="text-xs text-muted mt-0.5">
            {isEdit ? "Changes apply from the next run; run history is kept" : "Runs on this agent when the scheduler is active"}
          </p>
        </div>
        <button type="button" onClick={onCancel} className="p-1.5 text-muted hover:text-primary rounded-md focus-ring cursor-pointer" aria-label="Cancel">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField
          label="Task name"
          value={values.name}
          onChange={v => set("name", v)}
          placeholder="Daily standup brief"
          className="sm:col-span-2"
          autoFocus={!isEdit}
          disabled={isEdit}
          required
        />

        <TextArea
          label="Message / prompt"
          value={values.message}
          onChange={v => set("message", v)}
          placeholder="Summarize overnight CI failures and open a draft status update."
          rows={3}
          className="sm:col-span-2"
          autoFocus={isEdit}
          required
        />

        <Select label="Repeat" value={values.repeatPreset} onChange={v => set("repeatPreset", v)}>
          {REPEAT_PRESETS.map(p => (
            <option key={p.value || "once"} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>

        {values.repeatPreset === "custom" ? (
          <TextField
            label="Custom interval"
            value={values.customRepeat}
            onChange={v => set("customRepeat", v)}
            placeholder="2 hours"
            hint="Format: number + unit (e.g. 15 minutes, 2 hours, 1 day)"
          />
        ) : (
          timezoneSelect
        )}

        {values.repeatPreset === "custom" ? timezoneSelect : null}

        <TextField label="Earliest time (HH:mm)" type="time" value={values.after} onChange={v => set("after", v)} />
        <TextField label="Latest time (HH:mm)" type="time" value={values.before} onChange={v => set("before", v)} />

        <div className="sm:col-span-2 space-y-1.5">
          <span className="text-xs font-medium text-muted">Weekdays (optional)</span>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_OPTIONS.map(day => {
              const active = values.weekdays.includes(day.id);
              return (
                <button
                  key={day.id}
                  type="button"
                  onClick={() => toggleWeekday(day.id)}
                  className={cn(
                    "px-2.5 py-1 text-xs font-medium rounded-md border transition-colors focus-ring cursor-pointer",
                    active
                      ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-600 dark:text-indigo-300"
                      : "bg-tertiary border-primary text-muted hover:text-primary",
                  )}
                  aria-pressed={active}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
        </div>

        <TextField
          label="Day of month (optional)"
          type="number"
          min={1}
          max={31}
          value={values.dayOfMonth}
          onChange={v => set("dayOfMonth", v)}
          placeholder="e.g. 1"
        />
      </div>

      <NextRunLine preview={preview} paused={editing?.task.enabled === false} />

      <FormActionBar
        onCancel={onCancel}
        submitLabel={isEdit ? "Save changes" : "Add task"}
        submitIcon={isEdit ? Save : Plus}
        loading={saving}
        variant="indigo"
      />
    </form>
  );
}
