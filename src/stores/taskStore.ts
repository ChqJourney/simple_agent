import { create } from 'zustand';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface TaskNode {
  id: string;
  content: string;
  status: TaskStatus;
  subTasks?: TaskNode[];
}

export interface Task extends TaskNode {
  sessionId: string;
  createdAt: string;
}

function isTaskNodeActive(task: TaskNode): boolean {
  if (task.status === 'pending' || task.status === 'in_progress') {
    return true;
  }

  return task.subTasks?.some((subTask) => isTaskNodeActive(subTask)) ?? false;
}

interface TaskState {
  tasks: Task[];
  visibleTaskTabSessionIds: Record<string, boolean>;
  addTask: (task: Task) => void;
  upsertTask: (task: Task) => void;
  updateTaskStatus: (id: string, status: TaskStatus) => void;
  removeTask: (id: string) => void;
  clearSessionTasks: (sessionId: string) => void;
  getTasksBySession: (sessionId: string) => Task[];
  hasActiveTasksBySession: (sessionId: string) => boolean;
  markTaskTabVisible: (sessionId: string) => void;
  hideTaskTab: (sessionId: string) => void;
  isTaskTabVisible: (sessionId: string) => boolean;
  clearTasks: () => void;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  visibleTaskTabSessionIds: {},

  addTask: (task) =>
    set((state) => ({ tasks: [...state.tasks, task] })),

  upsertTask: (task) =>
    set((state) => {
      const index = state.tasks.findIndex((candidate) => candidate.id === task.id);
      if (index < 0) {
        return { tasks: [...state.tasks, task] };
      }

      const nextTasks = [...state.tasks];
      nextTasks[index] = {
        ...nextTasks[index],
        ...task,
        createdAt: nextTasks[index].createdAt,
      };
      return { tasks: nextTasks };
    }),

  updateTaskStatus: (id, status) =>
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, status } : t
      ),
    })),

  removeTask: (id) =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id),
    })),

  clearSessionTasks: (sessionId) =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.sessionId !== sessionId),
      visibleTaskTabSessionIds: Object.fromEntries(
        Object.entries(state.visibleTaskTabSessionIds).filter(([candidateSessionId]) => candidateSessionId !== sessionId)
      ),
    })),

  getTasksBySession: (sessionId) =>
    get().tasks.filter((t) => t.sessionId === sessionId),

  hasActiveTasksBySession: (sessionId) =>
    get().tasks
      .filter((task) => task.sessionId === sessionId)
      .some((task) => isTaskNodeActive(task)),

  markTaskTabVisible: (sessionId) =>
    set((state) => ({
      visibleTaskTabSessionIds: {
        ...state.visibleTaskTabSessionIds,
        [sessionId]: true,
      },
    })),

  hideTaskTab: (sessionId) =>
    set((state) => ({
      visibleTaskTabSessionIds: Object.fromEntries(
        Object.entries(state.visibleTaskTabSessionIds).filter(([candidateSessionId]) => candidateSessionId !== sessionId)
      ),
    })),

  isTaskTabVisible: (sessionId) =>
    Boolean(get().visibleTaskTabSessionIds[sessionId]),

  clearTasks: () => set({ tasks: [], visibleTaskTabSessionIds: {} }),
}));
