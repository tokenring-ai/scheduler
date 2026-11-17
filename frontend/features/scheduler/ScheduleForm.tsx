import JobLimitsFields, { JobPolicyNote } from "@tokenring-ai/one-frontend/components/JobLimitsFields.tsx";
import FormActionBar from "@tokenring-ai/one-frontend/components/ui/FormActionBar.tsx";
import { toastManager } from "@tokenring-ai/one-frontend/components/ui/toast.tsx";
import { cn } from "@tokenring-ai/one-frontend/lib/utils.ts";
import { schedulerRPCClient, useAgentList, useAgentTypes, useQueues, useWorkflows } from "@tokenring-ai/one-frontend/rpc.ts";
import { Select, TextArea, TextField } from "@tokenring-ai/one-frontend/ui";
import formatError from "@tokenring-ai/utility/error/formatError";
import { CalendarClock, Plus, Save, X } from "lucide-react";
import type { SubmitEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import type { ScheduleActionKind, ScheduleDefinition } from "../../../schema.ts";
import { type NextRunPreview, useNextRunPreview } from "../../lib/useNextRunPreview.ts";
import { COMMON_TIMEZONES, formatRelativeTime, formatScheduleTime, REPEAT_PRESETS, WEEKDAY_OPTIONS } from "./formatters.ts";
import { ACTION_KINDS, buildScheduleFromForm, emptyFormValues, type ScheduleFormValues, scheduleToFormValues, timingOf } from "./scheduleForm.ts";

type ScheduleFormProps = {
  existingNames: string[];
  /** Edit this schedule instead of creating one. Its name is fixed; when it last ran is kept by the server. */
  editing?: { name: string; schedule: ScheduleDefinition } | undefined;
  /** Called after a successful create or update. */
  onSaved: () => void;
  onCancel: () => void;
};

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function NextRunLine({ preview, paused }: { preview: NextRunPreview; paused: boolean }) {
  let text: string;
  if (preview.state === "idle") text = "Fill in the schedule to preview its next run";
  else if (preview.state === "loading") text = "Calculating…";
  else if (preview.state === "error") text = `Unable to preview: ${preview.error}`;
  else if (preview.error) text = preview.error;
  else if (preview.nextRunTime == null) text = "Not scheduled";
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

/** What the schedule does: the fields of the chosen action kind. */
function ActionFields({
  values,
  set,
}: {
  values: ScheduleFormValues;
  set: <K extends keyof ScheduleFormValues>(key: K, value: ScheduleFormValues[K]) => void;
}) {
  const agentTypes = useAgentTypes();
  const agents = useAgentList();
  const queues = useQueues();
  const workflows = useWorkflows();
  const kind = values.actionKind;
  const promptField = (
    <TextArea
      label="Prompt"
      value={values.prompt}
      onChange={v => set("prompt", v)}
      placeholder="Summarize overnight CI failures and open a draft status update."
      rows={3}
      className="sm:col-span-2"
      required
    />
  );
  if (kind === "job") {
    return (
      <>
        <Select label="Agent type" value={values.agentType} onChange={v => set("agentType", v)} className="sm:col-span-2">
          <option value="">Choose an agent type…</option>
          {(agentTypes.data ?? []).map(type => (
            <option key={type.type} value={type.type}>
              {type.displayName}
            </option>
          ))}
        </Select>
        {promptField}
      </>
    );
  }
  if (kind === "agent") {
    return (
      <>
        <Select label="Agent" value={values.agentId} onChange={v => set("agentId", v)} className="sm:col-span-2">
          <option value="">Choose an agent…</option>
          {values.agentId && !(agents.data ?? []).some(agent => agent.id === values.agentId) ? (
            <option value={values.agentId}>{values.agentId} (gone)</option>
          ) : null}
          {(agents.data ?? []).map(agent => (
            <option key={agent.id} value={agent.id}>
              {agent.displayName}
            </option>
          ))}
        </Select>
        {promptField}
      </>
    );
  }
  if (kind === "queue") {
    return (
      <>
        <Select label="Queue" value={values.queue} onChange={v => set("queue", v)}>
          <option value="">Choose a queue…</option>
          {Object.keys(queues.data?.queues ?? {}).map(name => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
        <TextField label="Item name" value={values.itemName} onChange={v => set("itemName", v)} placeholder="Weekly docs refresh" />
        {promptField}
      </>
    );
  }
  if (kind === "workflow") {
    return (
      <Select label="Workflow" value={values.workflow} onChange={v => set("workflow", v)} className="sm:col-span-2">
        <option value="">Choose a workflow…</option>
        {(workflows.data ?? []).map(workflow => (
          <option key={workflow.name} value={workflow.name}>
            {workflow.displayName || workflow.name}
          </option>
        ))}
      </Select>
    );
  }
  if (kind === "tool") {
    return (
      <>
        <Select label="Agent type" value={values.agentType} onChange={v => set("agentType", v)}>
          <option value="">Choose an agent type…</option>
          {(agentTypes.data ?? []).map(type => (
            <option key={type.type} value={type.type}>
              {type.displayName}
            </option>
          ))}
        </Select>
        <TextField label="Tool" value={values.tool} onChange={v => set("tool", v)} placeholder="x_createPost" />
        <TextArea label="Tool input (JSON)" value={values.toolInput} onChange={v => set("toolInput", v)} rows={4} className="sm:col-span-2" />
      </>
    );
  }
  return (
    <>
      <TextField label="Board id" value={values.board} onChange={v => set("board", v)} placeholder="eng" />
      <TextField label="Task id" value={values.taskId} onChange={v => set("taskId", v)} placeholder="ENG-12" />
      <TextField label="Assignment id" value={values.assignmentId} onChange={v => set("assignmentId", v)} className="sm:col-span-2" />
    </>
  );
}

export default function ScheduleForm({ existingNames, editing, onSaved, onCancel }: ScheduleFormProps) {
  const [values, setValues] = useState<ScheduleFormValues>(() =>
    editing ? scheduleToFormValues(editing.name, editing.schedule, detectTimezone()) : emptyFormValues(detectTimezone()),
  );
  const [saving, setSaving] = useState(false);
  const isEdit = editing != null;

  // A new schedule starts a coding agent by default (or the first type there is).
  const agentTypes = useAgentTypes();
  useEffect(() => {
    const types = agentTypes.data ?? [];
    if (types.length === 0) return;
    setValues(prev => (prev.agentType ? prev : { ...prev, agentType: (types.find(type => type.type === "code") ?? types[0]!).type }));
  }, [agentTypes.data]);
  const paused = editing?.schedule.enabled === false;

  const set = <K extends keyof ScheduleFormValues>(key: K, value: ScheduleFormValues[K]) =>
    setValues(prev => ({
      ...prev,
      [key]: value,
      // Picking Repeat or Timezone commits that field. Until then an implicit daily schedule and a
      // missing timezone stay omitted on preview and save.
      ...(key === "repeatPreset" ? { implicitDaily: false } : {}),
      ...(key === "timezone" ? { omitTimezone: false } : {}),
    }));

  const timezones = useMemo(() => {
    const zones = new Set<string>([...COMMON_TIMEZONES, detectTimezone(), values.timezone]);
    return [...zones].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [values.timezone]);

  // The preview needs a timing, not a name or an action; fill placeholders so it shows while those are empty.
  const previewTiming = useMemo(() => {
    const result = buildScheduleFromForm({ ...values, name: "preview", actionKind: "workflow", workflow: "preview" });
    return result.ok ? timingOf(result.schedule) : null;
  }, [values]);
  const preview = useNextRunPreview(previewTiming);

  const toggleWeekday = (id: string) => {
    set("weekdays", values.weekdays.includes(id) ? values.weekdays.filter(d => d !== id) : [...values.weekdays, id]);
  };

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    const built = buildScheduleFromForm(values, { enabled: editing?.schedule.enabled });
    if (!built.ok) {
      toastManager.error(built.error, { duration: 4000 });
      return;
    }
    if (!isEdit && existingNames.includes(built.name)) {
      toastManager.error(`A schedule named "${built.name}" already exists`, { duration: 4000 });
      return;
    }

    setSaving(true);
    try {
      const result = isEdit
        ? await schedulerRPCClient.updateSchedule({ name: editing.name, schedule: built.schedule })
        : await schedulerRPCClient.addSchedule({ name: built.name, schedule: built.schedule });
      toastManager.success(result.message, { duration: 3000 });
      onSaved();
    } catch (err) {
      toastManager.error(formatError(err), { duration: 5000 });
    } finally {
      setSaving(false);
    }
  };

  const actionHint = ACTION_KINDS.find(kind => kind.value === values.actionKind)?.hint;

  return (
    <form onSubmit={e => void handleSubmit(e)} className="bg-secondary border border-primary rounded-xl p-4 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-primary">{isEdit ? `Edit "${editing.name}"` : "Add schedule"}</h3>
          <p className="text-xs text-muted mt-0.5">{isEdit ? "Changes apply from the next run; run history is kept" : "Runs while the scheduler is started"}</p>
        </div>
        <button type="button" onClick={onCancel} className="p-1.5 text-muted hover:text-primary rounded-md focus-ring cursor-pointer" aria-label="Cancel">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField
          label="Schedule name"
          value={values.name}
          onChange={v => set("name", v)}
          placeholder="Daily standup brief"
          className="sm:col-span-2"
          autoFocus={!isEdit}
          disabled={isEdit}
          required
        />

        <Select label="Action" value={values.actionKind} onChange={v => set("actionKind", v as ScheduleActionKind)} className="sm:col-span-2" hint={actionHint}>
          {ACTION_KINDS.map(kind => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </Select>

        <ActionFields values={values} set={set} />

        {values.actionKind === "job" || values.actionKind === "workflow" || values.actionKind === "tool" ? (
          <>
            <JobLimitsFields
              maxCostUsd={values.maxCostUsd}
              onMaxCostUsd={v => set("maxCostUsd", v)}
              maxApprovalLevel={values.maxApprovalLevel}
              onMaxApprovalLevel={v => set("maxApprovalLevel", v)}
            />
            <div className="sm:col-span-2">
              <JobPolicyNote maxApprovalLevel={values.maxApprovalLevel} />
            </div>
          </>
        ) : null}

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
            hint="Number + unit, from 1 minute to 12 months (e.g. 15 minutes, 2 hours, 1 month)"
          />
        ) : null}

        {values.repeatPreset === "at" ? (
          <TextField
            label={`Run at (${detectTimezone()})`}
            type="datetime-local"
            value={values.at}
            onChange={v => set("at", v)}
            hint="In your browser's time zone; stored as an exact moment. It runs once, then is done."
            required
          />
        ) : null}

        {values.repeatPreset !== "at" ? (
          <>
            <Select
              label="Timezone"
              value={values.timezone}
              onChange={v => set("timezone", v)}
              className={values.repeatPreset === "custom" ? "sm:col-span-2" : ""}
            >
              {timezones.map(tz => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>

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
          </>
        ) : null}
      </div>

      <NextRunLine preview={preview} paused={paused} />

      <FormActionBar
        onCancel={onCancel}
        submitLabel={isEdit ? "Save changes" : "Add schedule"}
        submitIcon={isEdit ? Save : Plus}
        loading={saving}
        variant="indigo"
      />
    </form>
  );
}
