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

interface TaskState {
  tasks: Task[];
  addTask: (task: Task) => void;
  upsertTask: (task: Task) => void;
  updateTaskStatus: (id: string, status: TaskStatus) => void;
  removeTask: (id: string) => void;
  getTasksBySession: (sessionId: string) => Task[];
  clearTasks: () => void;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],

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

  getTasksBySession: (sessionId) =>
    get().tasks.filter((t) => t.sessionId === sessionId),

  clearTasks: () => set({ tasks: [] }),
}));
