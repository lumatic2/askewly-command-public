import { useCallback, useEffect, useState } from "react";
import {
  addTaskToSection,
  toggleTaskDone,
  toggleTaskDoing,
  moveTaskToSection,
  updateTaskFields,
  type Section,
  type TaskRow,
} from "../google";
import { useToast } from "./useToast";

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function tempId(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Optimistic task-list state for one tab (오늘/백로그), ported from the
 * widget's `handleQuickAdd`/`handleToggle`/`handleDefer`/`handleToggleDoing`
 * (widget/renderer/app.js): mutate local state immediately, call the Google
 * write op, and roll back + toast on failure. `serverTasks` (from
 * `useFetched`) reseeds local state whenever a fetch/refresh completes.
 */
export function useTaskList(section: Section, serverTasks: TaskRow[]) {
  const [tasks, setTasks] = useState<TaskRow[]>(serverTasks);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { toast, show } = useToast();

  useEffect(() => {
    setTasks(serverTasks);
  }, [serverTasks]);

  const quickAdd = useCallback(
    async (title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      const id = tempId();
      const temp: TaskRow = {
        id,
        title: trimmed,
        detail: "",
        status: "todo",
        due_at: null,
        scheduled_for: null,
        section,
        project_name: null,
        tasklist_id: "temp",
        tasklist_title: "",
        updated_at: null,
      };
      setTasks((prev) => [temp, ...prev]);
      try {
        const created = await addTaskToSection(section, { title: trimmed });
        setTasks((prev) => prev.map((t) => (t.id === id ? created : t)));
      } catch (err) {
        setTasks((prev) => prev.filter((t) => t.id !== id));
        show(`추가 실패: ${errMsg(err)}`, true);
      }
    },
    [section, show],
  );

  const toggleDone = useCallback(
    async (row: TaskRow) => {
      if (row.tasklist_id === "temp") return;
      const nextStatus = row.status === "done" ? "todo" : "done";
      setTasks((prev) => prev.map((t) => (t.id === row.id ? { ...t, status: nextStatus } : t)));
      try {
        const updated = await toggleTaskDone(row);
        setTasks((prev) => prev.map((t) => (t.id === row.id ? updated : t)));
      } catch (err) {
        setTasks((prev) => prev.map((t) => (t.id === row.id ? { ...t, status: row.status } : t)));
        show(`완료 처리 실패: ${errMsg(err)}`, true);
      }
    },
    [show],
  );

  const toggleDoing = useCallback(
    async (row: TaskRow) => {
      if (row.tasklist_id === "temp") return;
      const nextStatus = row.status === "doing" ? "todo" : "doing";
      setTasks((prev) => prev.map((t) => (t.id === row.id ? { ...t, status: nextStatus } : t)));
      try {
        const updated = await toggleTaskDoing(row);
        setTasks((prev) => prev.map((t) => (t.id === row.id ? updated : t)));
      } catch (err) {
        setTasks((prev) => prev.map((t) => (t.id === row.id ? { ...t, status: row.status } : t)));
        show(`진행 상태 변경 실패: ${errMsg(err)}`, true);
      }
    },
    [show],
  );

  const moveTo = useCallback(
    async (row: TaskRow, targetSection: Section) => {
      if (row.tasklist_id === "temp") return;
      const index = tasks.findIndex((t) => t.id === row.id);
      setTasks((prev) => prev.filter((t) => t.id !== row.id));
      try {
        await moveTaskToSection(row, targetSection);
      } catch (err) {
        setTasks((prev) => {
          const next = [...prev];
          next.splice(Math.min(index, next.length), 0, row);
          return next;
        });
        show(`이동 실패: ${errMsg(err)}`, true);
      }
    },
    [tasks, show],
  );

  const startEdit = useCallback((id: string) => setEditingId(id), []);
  const cancelEdit = useCallback(() => setEditingId(null), []);

  const submitEdit = useCallback(
    async (row: TaskRow, nextTitle: string) => {
      setEditingId(null);
      const trimmed = nextTitle.trim();
      if (!trimmed || trimmed === row.title || row.tasklist_id === "temp") return;
      setTasks((prev) => prev.map((t) => (t.id === row.id ? { ...t, title: trimmed } : t)));
      try {
        const updated = await updateTaskFields(row, { title: trimmed });
        setTasks((prev) => prev.map((t) => (t.id === row.id ? updated : t)));
      } catch (err) {
        setTasks((prev) => prev.map((t) => (t.id === row.id ? { ...t, title: row.title } : t)));
        show(`수정 실패: ${errMsg(err)}`, true);
      }
    },
    [show],
  );

  return { tasks, toast, editingId, quickAdd, toggleDone, toggleDoing, moveTo, startEdit, cancelEdit, submitEdit };
}
