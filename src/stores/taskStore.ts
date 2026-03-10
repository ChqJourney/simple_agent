import { create } from 'zustand';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface Task {
  id: string;
  sessionId: string;
  content: string;
  status: TaskStatus;
  subTasks?: Task[];
  createdAt: string;
}

interface TaskState {
  tasks: Task[];
  
  addTask: (task: Task) => void;
  updateTaskStatus: (id: string, status: TaskStatus) => void;
  removeTask: (id: string) => void;
  getTasksBySession: (sessionId: string) => Task[];
  clearTasks: () => void;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],

  addTask: (task) =>
    set((state) => ({ tasks: [...state.tasks, task] })),

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