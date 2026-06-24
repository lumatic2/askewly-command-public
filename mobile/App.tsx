import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { ActivityIndicator, AppState, Keyboard, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, Vibration, View } from 'react-native';
import './global.css';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as NavigationBar from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import * as Linking from 'expo-linking';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Session } from '@supabase/supabase-js';
import { Feather } from '@expo/vector-icons';

import { createSessionFromUrl, getRedirectTo, OAuthProvider, signInWithProvider } from './src/lib/auth';
import { hasCloudConfig } from './src/lib/env';
import { supabase } from './src/lib/supabase';
import { archiveTask, createTask, loadTaskSections, moveTask, reorderTask, updateTask } from './src/lib/tasks';
import { Button as UiButton } from './src/components/ui/button';
import { Card } from './src/components/ui/card';
import { Input as UiInput } from './src/components/ui/input';
import { Text as UiText } from './src/components/ui/text';
import { cn } from './src/lib/utils';
import {
  archiveProject,
  archiveProjectLink,
  archiveProjectMilestone,
  createProject,
  createProjectLink,
  createProjectMilestone,
  createProjectTask,
  loadProjects,
  updateProject,
  updateProjectLink,
  updateProjectMilestone
} from './src/lib/projects';
import type { CloudTask, CloudTaskSourceKey, CloudTaskStatus, TaskSection } from './src/domain/tasks';
import type {
  CloudProject,
  CloudProjectLink,
  CloudProjectLinkKind,
  CloudProjectLinkPatch,
  CloudProjectMilestone,
  CloudProjectMilestonePatch,
  CloudProjectMilestoneStatus,
  CloudProjectPatch,
  CloudProjectStatus
} from './src/domain/projects';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type FeatherIconName = ComponentProps<typeof Feather>['name'];
type ProjectStatusFilter = CloudProjectStatus | 'all';
type ProjectSortMode = 'manual' | 'name' | 'status';
type ScheduleViewMode = 'list' | 'board';
type TaskFocusRequest = { sectionKey: CloudTaskSourceKey; taskId: number; nonce: number };
type BoardToastTone = 'success' | 'error';
type BoardToast = {
  id: number;
  message: string;
  tone: BoardToastTone;
  undo?: {
    label: string;
    task: CloudTask;
  };
};
type BoardDragState = {
  taskId: number;
  fromIndex: number;
  targetIndex: number;
  dragY: number;
  statusDropTarget: CloudTaskStatus | null;
};
const CLOUD_REFRESH_INTERVAL_MS = 1000;
const BOTTOM_NAV_ITEM_HEIGHT = 76;
const BOTTOM_NAV_TOP_PADDING = 12;
const BOTTOM_NAV_BOTTOM_GAP = 6;
const DOUBLE_TAP_DELAY_MS = 260;
const BOARD_DRAG_ROW_HEIGHT = 132;
const BOARD_DRAG_ACTIVATION_MS = 180;
const BOARD_STATUS_DROP_THRESHOLD = -82;
const BOARD_TOAST_TIMEOUT_MS = 5200;
const SCHEDULE_VIEW_MODE_STORAGE_KEY = 'askewly.schedule.viewMode';
const BOARD_ACTIVE_STATUS_STORAGE_KEY = 'askewly.schedule.board.activeStatus';
const NAV_ICON_SIZE = 28;
type CommandDomainKey = 'schedule' | 'content' | 'command' | 'projects' | 'obsidian';
const COMMAND_DOMAINS: CommandDomainKey[] = ['schedule', 'content', 'command', 'projects', 'obsidian'];
const SCHEDULE_KEYS: CloudTaskSourceKey[] = ['today', 'deadlines', 'backlog'];
const SCHEDULE_BOARD_COLUMNS: CloudTaskStatus[] = ['todo', 'doing', 'done', 'held', 'delayed'];
const PALETTE = {
  floralWhite: '#171717',
  champagneMist: '#202020',
  paleOak: '#383838',
  camel: '#D3A13F',
  ocean: '#2E6F8F',
  toffee: '#A3A3A3',
  graphite: '#D4D4D4',
  carbon: '#F5F5F5',
  carbonDeep: '#FAFAFA',
  danger: '#E56A5B',
  white: '#262626',
  boardTodo: '#2B2B2B',
  boardDoing: '#1D3346',
  boardDone: '#1C3529',
  boardHeld: '#302A18',
  boardDelayed: '#3B2020',
  boardLine: '#3A3A3A',
  boardMuted: '#8A8A8A',
  paper: '#FAF6EE'
};
const TYPEFACE = Platform.select({ ios: 'System', android: 'sans-serif', default: undefined });
const RADIUS = {
  sm: 6,
  md: 8,
  lg: 10
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const maybeError = error as { message?: unknown; error_description?: unknown; error?: unknown };
    if (typeof maybeError.message === 'string') return maybeError.message;
    if (typeof maybeError.error_description === 'string') return maybeError.error_description;
    if (typeof maybeError.error === 'string') return maybeError.error;
    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown error';
    }
  }
  return String(error);
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [message, setMessage] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceId, setWorkspaceId] = useState<number | null>(null);
  const [sections, setSections] = useState<TaskSection[]>([]);
  const [projects, setProjects] = useState<CloudProject[]>([]);
  const [projectMilestones, setProjectMilestones] = useState<CloudProjectMilestone[]>([]);
  const [projectLinks, setProjectLinks] = useState<CloudProjectLink[]>([]);
  const [activeDomainKey, setActiveDomainKey] = useState<CommandDomainKey>('schedule');
  const [activeSectionKey, setActiveSectionKey] = useState<CloudTaskSourceKey>('today');
  const [scheduleViewMode, setScheduleViewMode] = useState<ScheduleViewMode>('list');
  const [taskFocusRequest, setTaskFocusRequest] = useState<TaskFocusRequest | null>(null);
  const [projectFocusId, setProjectFocusId] = useState<number | null>(null);
  const [boardToast, setBoardToast] = useState<BoardToast | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const refreshInFlight = useRef(false);
  const scheduleViewPreferenceLoaded = useRef(false);
  const boardToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const redirectTo = useMemo(() => getRedirectTo(), []);
  const insets = useSafeAreaInsets();
  const bottomNavHeight = getBottomNavHeight(insets.bottom);
  const activeSection = useMemo(
    () => sections.find((section) => section.key === activeSectionKey) || sections[0] || null,
    [activeSectionKey, sections]
  );
  const commandOverview = useMemo(
    () => buildMobileCommandOverview(sections, projects, projectMilestones, projectLinks),
    [sections, projects, projectMilestones, projectLinks]
  );
  const obsidianHub = useMemo(
    () => buildObsidianHub(projectLinks, projects, projectMilestones),
    [projectLinks, projectMilestones, projects]
  );
  const contentQueue = useMemo(
    () => buildContentQueue(sections, projects, projectMilestones),
    [projectMilestones, projects, sections]
  );

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(PALETTE.floralWhite).catch(() => {});
    if (Platform.OS === 'android') {
      NavigationBar.setStyle('light');
    }
  }, []);

  useEffect(() => () => {
    if (boardToastTimer.current) clearTimeout(boardToastTimer.current);
  }, []);

  const showBoardToast = useCallback((toast: Omit<BoardToast, 'id'>) => {
    if (boardToastTimer.current) clearTimeout(boardToastTimer.current);
    setBoardToast({ ...toast, id: Date.now() });
    boardToastTimer.current = setTimeout(() => {
      setBoardToast(null);
      boardToastTimer.current = null;
    }, BOARD_TOAST_TIMEOUT_MS);
  }, []);

  const clearBoardToast = useCallback(() => {
    if (boardToastTimer.current) {
      clearTimeout(boardToastTimer.current);
      boardToastTimer.current = null;
    }
    setBoardToast(null);
  }, []);

  const openScheduleTaskEditor = useCallback((sectionKey: CloudTaskSourceKey, taskId: number) => {
    Keyboard.dismiss();
    setActiveSectionKey(sectionKey);
    setScheduleViewMode('list');
    setActiveDomainKey('schedule');
    setTaskFocusRequest({ sectionKey, taskId, nonce: Date.now() });
  }, []);

  const openProjectEditor = useCallback((projectId: number) => {
    Keyboard.dismiss();
    setProjectFocusId(projectId);
    setActiveDomainKey('projects');
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(SCHEDULE_VIEW_MODE_STORAGE_KEY)
      .then((value) => {
        if (value === 'list' || value === 'board') {
          setScheduleViewMode(value);
        }
      })
      .catch(() => {})
      .finally(() => {
        scheduleViewPreferenceLoaded.current = true;
      });
  }, []);

  useEffect(() => {
    if (!scheduleViewPreferenceLoaded.current) return;
    AsyncStorage.setItem(SCHEDULE_VIEW_MODE_STORAGE_KEY, scheduleViewMode).catch(() => {});
  }, [scheduleViewMode]);

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardVisible(true);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const refreshTasks = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!session || refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (!options.silent) {
      setLoadState('loading');
      setMessage('');
    }
    try {
      const [taskResult, projectResult] = await Promise.all([
        loadTaskSections(),
        loadProjects()
      ]);
      setWorkspaceName(taskResult.workspace?.name || projectResult.workspace?.name || '');
      setWorkspaceId(taskResult.workspace?.id || projectResult.workspace?.id || null);
      setSections(taskResult.sections);
      setProjects(projectResult.projects);
      setProjectMilestones(projectResult.milestones);
      setProjectLinks(projectResult.links);
      setLoadState('ready');
    } catch (error) {
      if (!options.silent) {
        setMessage(getErrorMessage(error));
        setLoadState('error');
      }
    } finally {
      refreshInFlight.current = false;
    }
  }, [session]);

  const refreshProjects = useCallback(async () => {
    if (!session) return;
    const result = await loadProjects();
    setWorkspaceId(result.workspace?.id || workspaceId);
    setProjects(result.projects);
    setProjectMilestones(result.milestones);
    setProjectLinks(result.links);
  }, [session, workspaceId]);

  const runOptimisticMutation = useCallback(async (
    optimisticUpdate: (current: TaskSection[]) => TaskSection[],
    persist: () => Promise<void>
  ) => {
    const snapshot = sections;
    setSections(optimisticUpdate);
    setMessage('');
    try {
      await persist();
    } catch (error) {
      setSections(snapshot);
      setMessage(getErrorMessage(error));
      setLoadState('error');
    }
  }, [sections]);

  const handleCreateTask = useCallback(async (
    section: TaskSection,
    title: string,
    options: { project_id?: number | null; project_milestone_id?: number | null } = {}
  ) => {
    const projectId = options.project_id ?? null;
    const milestoneId = options.project_milestone_id ?? null;
    const tempTask: CloudTask = {
      id: -Date.now(),
      workspace_id: section.source?.workspace_id || 0,
      source_id: section.source?.id || 0,
      project_id: projectId,
      project_milestone_id: milestoneId,
      title: title.trim(),
      detail: null,
      status: 'todo',
      due_at: section.key === 'deadlines' ? new Date().toISOString() : null,
      scheduled_for: section.key === 'today' ? new Date().toISOString().slice(0, 10) : null,
      sort_order: nextSortOrder(section.tasks)
    };

    await runOptimisticMutation(
      (current) => current.map((candidate) => (
        candidate.key === section.key
          ? { ...candidate, tasks: [...candidate.tasks, tempTask] }
          : candidate
      )),
      async () => {
        const savedTask = await createTask(section, title, {
          project_id: projectId,
          project_milestone_id: milestoneId
        });
        setSections((current) => replaceTask(current, tempTask.id, savedTask));
      }
    );
  }, [runOptimisticMutation]);

  const handleUpdateTask = useCallback(async (task: CloudTask, title: string, detail?: string | null) => {
    const nextDetail = detail === undefined ? task.detail : normalizeNullableText(detail) || null;
    await runOptimisticMutation(
      (current) => replaceTask(current, task.id, { ...task, title: title.trim(), detail: nextDetail }),
      async () => {
        const savedTask = await updateTask(task, { title, detail });
        setSections((current) => replaceTask(current, task.id, savedTask));
      }
    );
  }, [runOptimisticMutation]);

  const handleCreateProject = useCallback(async (name: string) => {
    if (!workspaceId) throw new Error('Workspace is not ready');
    const savedProject = await createProject(workspaceId, name);
    setProjects((current) => [...current, savedProject]);
    return savedProject;
  }, [workspaceId]);

  const handleUpdateProject = useCallback(async (project: CloudProject, patch: CloudProjectPatch) => {
    const savedProject = await updateProject(project, patch);
    setProjects((current) => current.map((candidate) => (candidate.id === savedProject.id ? savedProject : candidate)));
  }, []);

  const handleArchiveProject = useCallback(async (project: CloudProject) => {
    await archiveProject(project);
    setProjects((current) => current.filter((candidate) => candidate.id !== project.id));
    setProjectMilestones((current) => current.filter((candidate) => candidate.project_id !== project.id));
    setProjectLinks((current) => current.filter((candidate) => candidate.project_id !== project.id));
    setSections((current) => current.map((section) => ({
      ...section,
      tasks: section.tasks.map((task) => (task.project_id === project.id ? { ...task, project_id: null, project_milestone_id: null } : task))
    })));
  }, []);

  const handleCreateProjectMilestone = useCallback(async (project: CloudProject, title: string) => {
    const savedMilestone = await createProjectMilestone(project, title);
    setProjectMilestones((current) => [...current, savedMilestone]);
  }, []);

  const handleCreateProjectLink = useCallback(async (
    project: CloudProject,
    input: { title: string; kind: CloudProjectLinkKind; target: string; project_milestone_id?: number | null }
  ) => {
    const savedLink = await createProjectLink(project, input);
    setProjectLinks((current) => [...current, savedLink]);
  }, []);

  const handleUpdateProjectLink = useCallback(async (link: CloudProjectLink, patch: CloudProjectLinkPatch) => {
    const savedLink = await updateProjectLink(link, patch);
    setProjectLinks((current) => current.map((candidate) => (candidate.id === savedLink.id ? savedLink : candidate)));
  }, []);

  const handleArchiveProjectLink = useCallback(async (link: CloudProjectLink) => {
    await archiveProjectLink(link);
    setProjectLinks((current) => current.filter((candidate) => candidate.id !== link.id));
  }, []);

  const handleUpdateProjectMilestone = useCallback(async (
    milestone: CloudProjectMilestone,
    patch: CloudProjectMilestonePatch
  ) => {
    const savedMilestone = await updateProjectMilestone(milestone, patch);
    setProjectMilestones((current) => current.map((candidate) => (
      candidate.id === savedMilestone.id ? savedMilestone : candidate
    )));
  }, []);

  const handleArchiveProjectMilestone = useCallback(async (milestone: CloudProjectMilestone) => {
    await archiveProjectMilestone(milestone);
    setProjectMilestones((current) => current.filter((candidate) => candidate.id !== milestone.id));
    setSections((current) => current.map((section) => ({
      ...section,
      tasks: section.tasks.map((task) => (
        task.project_milestone_id === milestone.id ? { ...task, project_milestone_id: null } : task
      ))
    })));
  }, []);

  const handleCreateTaskForProject = useCallback(async (
    section: TaskSection,
    project: CloudProject,
    title: string,
    milestone?: CloudProjectMilestone | null
  ) => {
    const savedTask = await createProjectTask(section, project, title, milestone);
    setSections((current) => current.map((candidate) => (
      candidate.key === section.key
        ? { ...candidate, tasks: [...candidate.tasks, savedTask] }
        : candidate
    )));
  }, []);

  const handleSetTaskProject = useCallback(async (task: CloudTask, projectId: number | null) => {
    await runOptimisticMutation(
      (current) => replaceTask(current, task.id, { ...task, project_id: projectId, project_milestone_id: null }),
      async () => {
        const savedTask = await updateTask(task, { project_id: projectId, project_milestone_id: null });
        setSections((current) => replaceTask(current, task.id, savedTask));
      }
    );
  }, [runOptimisticMutation]);

  const handleSetTaskMilestone = useCallback(async (task: CloudTask, milestoneId: number | null) => {
    const milestone = milestoneId ? projectMilestones.find((candidate) => candidate.id === milestoneId) || null : null;
    await runOptimisticMutation(
      (current) => replaceTask(current, task.id, {
        ...task,
        project_id: milestone?.project_id ?? task.project_id,
        project_milestone_id: milestoneId
      }),
      async () => {
        const savedTask = await updateTask(task, {
          project_id: milestone?.project_id ?? task.project_id,
          project_milestone_id: milestoneId
        });
        setSections((current) => replaceTask(current, task.id, savedTask));
      }
    );
  }, [projectMilestones, runOptimisticMutation]);

  const handleToggleDone = useCallback(async (task: CloudTask) => {
    const status = task.status === 'done' ? 'todo' : 'done';
    await runOptimisticMutation(
      (current) => replaceTask(current, task.id, { ...task, status }),
      async () => {
        const savedTask = await updateTask(task, { status });
        setSections((current) => replaceTask(current, task.id, savedTask));
      }
    );
  }, [runOptimisticMutation]);

  const handleCycleTaskStatus = useCallback(async (task: CloudTask) => {
    const status = nextTaskStatus(task.status);
    await runOptimisticMutation(
      (current) => replaceTask(current, task.id, { ...task, status }),
      async () => {
        const savedTask = await updateTask(task, { status });
        setSections((current) => replaceTask(current, task.id, savedTask));
      }
    );
  }, [runOptimisticMutation]);

  const handleSetTaskStatus = useCallback(async (task: CloudTask, status: CloudTaskStatus) => {
    if (task.status === status) return;
    await runOptimisticMutation(
      (current) => replaceTask(current, task.id, { ...task, status }),
      async () => {
        const savedTask = await updateTask(task, { status });
        setSections((current) => replaceTask(current, task.id, savedTask));
      }
    );
  }, [runOptimisticMutation]);

  const handleUndoBoardTask = useCallback(async (task: CloudTask) => {
    clearBoardToast();
    await runOptimisticMutation(
      (current) => replaceTask(current, task.id, task),
      async () => {
        const savedTask = await updateTask(task, {
          status: task.status,
          sort_order: task.sort_order
        });
        setSections((current) => replaceTask(current, task.id, savedTask));
      }
    );
    showBoardToast({ message: '되돌렸습니다.', tone: 'success' });
  }, [clearBoardToast, runOptimisticMutation, showBoardToast]);

  const handleCreateNextAction = useCallback(async (title: string, projectId?: number | null) => {
    const todaySection = sections.find((section) => section.key === 'today');
    if (!todaySection) throw new Error('Today section is not available');
    const project = projectId ? projects.find((candidate) => candidate.id === projectId) || null : null;
    const savedTask = project
      ? await createProjectTask(todaySection, project, title, null)
      : await createTask(todaySection, title);
    setSections((current) => current.map((candidate) => (
      candidate.key === todaySection.key
        ? { ...candidate, tasks: [...candidate.tasks, savedTask] }
        : candidate
    )));
  }, [projects, sections]);

  const findTaskById = useCallback((taskId: number) => (
    sections.flatMap((section) => section.tasks).find((task) => task.id === taskId) || null
  ), [sections]);

  const handleStartNextTask = useCallback(async (taskId: number) => {
    const task = findTaskById(taskId);
    if (!task || task.status === 'doing') return;
    await handleCycleTaskStatus(task);
  }, [findTaskById, handleCycleTaskStatus]);

  const handleCompleteCurrentTask = useCallback(async (taskId: number) => {
    const task = findTaskById(taskId);
    if (!task) return;
    await handleToggleDone(task);
  }, [findTaskById, handleToggleDone]);

  const handleMoveTask = useCallback(async (task: CloudTask, targetKey: CloudTaskSourceKey) => {
    const targetSection = sections.find((section) => section.key === targetKey);
    if (!targetSection || task.source_id === targetSection.source?.id) return;

    await runOptimisticMutation(
      (current) => moveTaskLocally(current, task, targetKey),
      async () => {
        const savedTask = await moveTask(task, targetSection);
        setSections((current) => replaceTask(current, task.id, savedTask));
      }
    );
  }, [runOptimisticMutation, sections]);

  const handleReorderTask = useCallback(async (section: TaskSection, task: CloudTask, direction: 'up' | 'down') => {
    const currentIndex = section.tasks.findIndex((candidate) => candidate.id === task.id);
    if (currentIndex === -1) return;
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= section.tasks.length) return;
    const nextTasks = [...section.tasks];
    nextTasks.splice(currentIndex, 1);
    nextTasks.splice(targetIndex, 0, task);
    const nextSortOrder = sortOrderForIndex(nextTasks, targetIndex);

    await runOptimisticMutation(
      (current) => current.map((candidate) => (
        candidate.key === section.key
          ? { ...candidate, tasks: nextTasks.map((nextTask) => (nextTask.id === task.id ? { ...nextTask, sort_order: nextSortOrder } : nextTask)) }
          : candidate
      )),
      async () => {
        const savedTask = await reorderTask(task, nextSortOrder);
        setSections((current) => replaceTask(current, task.id, savedTask));
      }
    );
  }, [runOptimisticMutation]);

  const handleReorderBoardTask = useCallback(async (task: CloudTask, orderedTasks: CloudTask[], targetIndex: number) => {
    const currentIndex = orderedTasks.findIndex((candidate) => candidate.id === task.id);
    if (currentIndex === -1 || currentIndex === targetIndex) return;
    const nextTasks = [...orderedTasks];
    nextTasks.splice(currentIndex, 1);
    nextTasks.splice(targetIndex, 0, task);
    const nextSortOrder = sortOrderForIndex(nextTasks, targetIndex);

    await runOptimisticMutation(
      (current) => replaceTask(current, task.id, { ...task, sort_order: nextSortOrder }),
      async () => {
        const savedTask = await reorderTask(task, nextSortOrder);
        setSections((current) => replaceTask(current, task.id, savedTask));
      }
    );
  }, [runOptimisticMutation]);

  const handleDropBoardTaskStatus = useCallback(async (task: CloudTask, status: CloudTaskStatus) => {
    if (task.status === status) return;
    const targetTasks = buildBoardStatusTasks(sections, status);
    const nextSortOrder = sortOrderForStatusTop(targetTasks);

    await runOptimisticMutation(
      (current) => replaceTask(current, task.id, { ...task, status, sort_order: nextSortOrder }),
      async () => {
        const savedTask = await updateTask(task, { status, sort_order: nextSortOrder });
        setSections((current) => replaceTask(current, task.id, savedTask));
      }
    );
  }, [runOptimisticMutation, sections]);

  const handleDeleteTask = useCallback(async (task: CloudTask) => {
    await runOptimisticMutation(
      (current) => current.map((section) => ({
        ...section,
        tasks: section.tasks.filter((candidate) => candidate.id !== task.id)
      })),
      async () => {
        await archiveTask(task);
      }
    );
  }, [runOptimisticMutation]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoadState(data.session ? 'idle' : 'ready');
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setSections([]);
        setWorkspaceName('');
        setLoadState('ready');
      }
    });

    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) refreshTasks();
  }, [session, refreshTasks]);

  useEffect(() => {
    if (!session) return undefined;

    const refreshIfActive = () => {
      if (AppState.currentState === 'active') {
        refreshTasks({ silent: true });
      }
    };
    const interval = setInterval(refreshIfActive, CLOUD_REFRESH_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') refreshTasks({ silent: true });
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [session, refreshTasks]);

  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      createSessionFromUrl(url).catch((error) => {
        setMessage(getErrorMessage(error));
        setLoadState('error');
      });
    });
    return () => subscription.remove();
  }, []);

  const signIn = async (provider: OAuthProvider) => {
    setLoadState('loading');
    setMessage('');
    try {
      await signInWithProvider(provider);
    } catch (error) {
      setMessage(getErrorMessage(error));
      setLoadState('error');
    }
  };

  const signOut = async () => {
    setLoadState('loading');
    setMessage('');
    const { error } = await supabase.auth.signOut();
    if (error) {
      setMessage(error.message);
      setLoadState('error');
    }
  };

  if (!hasCloudConfig()) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <View style={styles.centerPane}>
          <Text style={styles.title}>Askewly Command</Text>
          <Text style={styles.muted}>EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are required.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          session ? { paddingBottom: bottomNavHeight + 24 } : null
        ]}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={Keyboard.dismiss}
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>Askewly Command</Text>
            <Text style={styles.title}>{session ? workspaceName || 'Personal' : 'Sign in'}</Text>
            {session ? <Text style={styles.accountText}>{session.user.email || session.user.id}</Text> : null}
          </View>
          {session ? (
            <View style={styles.headerActions}>
              <Pressable style={styles.headerButton} onPress={signOut}>
                <Text style={styles.headerButtonText}>로그아웃</Text>
              </Pressable>
              <Pressable
                style={styles.headerButton}
                onPress={() => {
                  Keyboard.dismiss();
                  refreshTasks();
                }}
              >
                <Text style={styles.headerButtonText}>새로고침</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        {!session ? (
          <View style={styles.authPane}>
            <Text style={styles.authTitle}>모바일과 PC 위젯에서 같은 할 일을 봅니다.</Text>
            <Text style={styles.muted}>Redirect URI: {redirectTo}</Text>
            <Pressable style={styles.primaryButton} onPress={() => signIn('google')}>
              <Text style={styles.primaryButtonText}>Google로 계속</Text>
            </Pressable>
            <Pressable style={styles.primaryButton} onPress={() => signIn('kakao')}>
              <Text style={styles.primaryButtonText}>Kakao로 계속</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.sectionStack}>
            {activeDomainKey === 'schedule' ? (
              <>
                <ScheduleViewSwitch
                  activeMode={scheduleViewMode}
                  onChange={(mode) => {
                    Keyboard.dismiss();
                    setScheduleViewMode(mode);
                  }}
                />
                {scheduleViewMode === 'list' ? (
                  <ScheduleSegments
                    activeKey={activeSectionKey}
                    sections={sections}
                    onChange={(key) => {
                      Keyboard.dismiss();
                      setActiveSectionKey(key);
                    }}
                  />
                ) : null}
                {scheduleViewMode === 'board' ? (
                  <ScheduleBoardView
                    sections={sections}
                    onDeleteTask={handleDeleteTask}
                    onMoveTask={handleMoveTask}
                    onCycleTaskStatus={handleCycleTaskStatus}
                    onOpenProjects={() => setActiveDomainKey('projects')}
                    onSetTaskMilestone={handleSetTaskMilestone}
                    onSetTaskProject={handleSetTaskProject}
                onSetTaskStatus={handleSetTaskStatus}
                onDropBoardTaskStatus={handleDropBoardTaskStatus}
                onReorderBoardTask={handleReorderBoardTask}
                onArchiveTask={handleDeleteTask}
                onUndoBoardTask={handleUndoBoardTask}
                onToggleDone={handleToggleDone}
                onUpdateTask={handleUpdateTask}
                boardToast={boardToast}
                clearBoardToast={clearBoardToast}
                showBoardToast={showBoardToast}
                    milestones={projectMilestones}
                    projects={projects}
                  />
                ) : activeSection ? (
                  <TaskSectionView
                    key={activeSection.key}
                    focusRequest={taskFocusRequest?.sectionKey === activeSection.key ? taskFocusRequest : null}
                    section={activeSection}
                    onCreateTask={handleCreateTask}
                    onDeleteTask={handleDeleteTask}
                    onMoveTask={handleMoveTask}
                    onReorderTask={handleReorderTask}
                    onCycleTaskStatus={handleCycleTaskStatus}
                    onOpenProjects={() => setActiveDomainKey('projects')}
                    onSetTaskProject={handleSetTaskProject}
                    onSetTaskMilestone={handleSetTaskMilestone}
                    onToggleDone={handleToggleDone}
                    onUpdateTask={handleUpdateTask}
                    milestones={projectMilestones}
                    projects={projects}
                  />
                ) : (
                  <View style={styles.section}>
                    <Text style={styles.empty}>No task sections</Text>
                  </View>
                )}
              </>
            ) : activeDomainKey === 'content' ? (
              <ContentSurface
                queue={contentQueue}
                onOpenProject={openProjectEditor}
                onOpenSchedule={(sectionKey) => {
                  setActiveSectionKey(sectionKey);
                  setActiveDomainKey('schedule');
                }}
                onOpenTask={openScheduleTaskEditor}
              />
            ) : activeDomainKey === 'command' ? (
              <CommandOverview
                overview={commandOverview}
                onCompleteCurrentTask={handleCompleteCurrentTask}
                onCreateNextAction={handleCreateNextAction}
                onOpenObsidian={(target) => Linking.openURL(target).catch(() => {})}
                onOpenObsidianHub={() => setActiveDomainKey('obsidian')}
                onOpenProjects={() => setActiveDomainKey('projects')}
                onOpenSchedule={(sectionKey) => {
                  setActiveSectionKey(sectionKey);
                  setActiveDomainKey('schedule');
                }}
                onStartNextTask={handleStartNextTask}
              />
            ) : activeDomainKey === 'projects' ? (
              <ProjectsSurface
                focusProjectId={projectFocusId}
                sections={sections}
                links={projectLinks}
                milestones={projectMilestones}
                projects={projects}
                onArchiveProject={handleArchiveProject}
                onArchiveProjectLink={handleArchiveProjectLink}
                onArchiveProjectMilestone={handleArchiveProjectMilestone}
                onCreateProjectLink={handleCreateProjectLink}
                onCreateProjectMilestone={handleCreateProjectMilestone}
                onCreateProject={handleCreateProject}
                onCreateTaskForProject={handleCreateTaskForProject}
                onRefreshProjects={refreshProjects}
                onUpdateProjectLink={handleUpdateProjectLink}
                onUpdateProjectMilestone={handleUpdateProjectMilestone}
                onUpdateProject={handleUpdateProject}
              />
            ) : activeDomainKey === 'obsidian' ? (
              <ObsidianSurface
                hub={obsidianHub}
                onOpenLink={(target) => Linking.openURL(target).catch(() => {})}
                onOpenProject={openProjectEditor}
                onOpenProjects={() => setActiveDomainKey('projects')}
              />
            ) : (
              <CommandPlaceholder domainKey={activeDomainKey} />
            )}
          </View>
        )}

        {loadState === 'loading' ? (
          <View style={styles.statusRow}>
            <ActivityIndicator />
            <Text style={styles.muted}>Loading</Text>
          </View>
        ) : null}
        {message ? <Text style={styles.error}>{message}</Text> : null}
      </ScrollView>
      {session && !keyboardVisible ? (
        <BottomNavigation
          activeKey={activeDomainKey}
          bottomInset={insets.bottom}
          sections={sections}
          onChange={(key) => {
            Keyboard.dismiss();
            setActiveDomainKey(key);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

type BottomNavigationProps = {
  activeKey: CommandDomainKey;
  bottomInset: number;
  sections: TaskSection[];
  onChange: (key: CommandDomainKey) => void;
};

function BottomNavigation({ activeKey, bottomInset, sections, onChange }: BottomNavigationProps) {
  return (
    <View style={[styles.bottomNav, { paddingBottom: getBottomNavBottomPadding(bottomInset) }]}>
      {COMMAND_DOMAINS.map((key) => {
        const isActive = activeKey === key;
        const iconName = iconForDomain(key);
        const iconColor = isActive ? PALETTE.carbonDeep : '#8F9AA3';
        return (
          <UiButton
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            className={cn(
              'min-h-[76px] flex-1 flex-col gap-1 rounded-lg px-1',
              isActive ? 'bg-secondary' : 'bg-transparent'
            )}
            variant="ghost"
            onPress={() => onChange(key)}
          >
            <Feather name={iconName} color={iconColor} size={NAV_ICON_SIZE} />
            <UiText className={cn('text-center text-[10px] font-extrabold leading-4', isActive ? 'text-accent' : 'text-muted-foreground')}>
              {labelForDomain(key)}
            </UiText>
          </UiButton>
        );
      })}
    </View>
  );
}

type ScheduleSegmentsProps = {
  activeKey: CloudTaskSourceKey;
  sections: TaskSection[];
  onChange: (key: CloudTaskSourceKey) => void;
};

function ScheduleSegments({ activeKey, sections, onChange }: ScheduleSegmentsProps) {
  return (
    <View style={styles.segmentBar} accessibilityRole="tablist">
      {SCHEDULE_KEYS.map((key) => {
        const section = sections.find((candidate) => candidate.key === key);
        const isActive = activeKey === key;
        return (
          <UiButton
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            className="min-h-[52px] flex-1 gap-2"
            variant={isActive ? 'default' : 'ghost'}
            onPress={() => onChange(key)}
          >
            <UiText className={cn('text-[15px] font-extrabold', isActive ? 'text-primary-foreground' : 'text-muted-foreground')}>
              {labelForKey(key)}
            </UiText>
            <UiText className={cn('text-[14px] font-extrabold', isActive ? 'text-primary-foreground' : 'text-muted-foreground')}>
              {section?.tasks.length ?? 0}
            </UiText>
          </UiButton>
        );
      })}
    </View>
  );
}

type ScheduleViewSwitchProps = {
  activeMode: ScheduleViewMode;
  onChange: (mode: ScheduleViewMode) => void;
};

function ScheduleViewSwitch({ activeMode, onChange }: ScheduleViewSwitchProps) {
  return (
    <View style={styles.viewSwitch} accessibilityRole="tablist">
      {(['list', 'board'] as ScheduleViewMode[]).map((mode) => {
        const isActive = activeMode === mode;
        return (
          <UiButton
            key={mode}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            className="min-h-[48px] flex-1 flex-row gap-2"
            variant={isActive ? 'default' : 'ghost'}
            onPress={() => onChange(mode)}
          >
            <Feather name={mode === 'list' ? 'list' : 'columns'} color={isActive ? PALETTE.carbonDeep : PALETTE.toffee} size={16} />
            <UiText className={cn('text-[15px] font-extrabold', isActive ? 'text-primary-foreground' : 'text-muted-foreground')}>
              {mode === 'list' ? 'List' : 'Board'}
            </UiText>
          </UiButton>
        );
      })}
    </View>
  );
}

function CommandPlaceholder({ domainKey }: { domainKey: CommandDomainKey }) {
  return (
    <View style={styles.section}>
      <View style={styles.placeholderHeader}>
        <View style={styles.placeholderIcon}>
          <Feather name={iconForDomain(domainKey)} color={PALETTE.carbonDeep} size={22} />
        </View>
        <View style={styles.placeholderCopy}>
          <Text style={styles.sectionTitle}>{labelForDomain(domainKey)}</Text>
          <Text style={styles.placeholderText}>{placeholderTextForDomain(domainKey)}</Text>
        </View>
      </View>
    </View>
  );
}

type ObsidianHubLink = {
  id: number;
  projectId: number;
  title: string;
  target: string;
  projectName: string;
  milestoneTitle: string;
  contextLabel: string;
  score: number;
};

type ObsidianHubGroup = {
  projectId: number;
  projectName: string;
  links: ObsidianHubLink[];
};

type ObsidianHubModel = {
  recent: ObsidianHubLink[];
  groups: ObsidianHubGroup[];
  total: number;
};

function ObsidianSurface({
  hub,
  onOpenLink,
  onOpenProject,
  onOpenProjects
}: {
  hub: ObsidianHubModel;
  onOpenLink: (target: string) => void;
  onOpenProject: (projectId: number) => void;
  onOpenProjects: () => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>옵시디언</Text>
          <Text style={styles.projectRowMeta}>metadata-only note shortcuts</Text>
        </View>
        <Text style={styles.count}>{hub.total}</Text>
      </View>
      {hub.total === 0 ? (
        <View style={styles.placeholderHeader}>
          <View style={styles.placeholderIcon}>
            <Feather name="book-open" color={PALETTE.carbonDeep} size={22} />
          </View>
          <View style={styles.placeholderCopy}>
            <Text style={styles.placeholderText}>프로젝트 링크에 Obsidian URI를 추가하면 여기에 표시됩니다.</Text>
            <Pressable style={styles.actionButton} onPress={onOpenProjects}>
              <Text style={styles.ghostButtonText}>프로젝트에서 추가</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          <View style={styles.projectTaskBox}>
            <Text style={styles.sheetStatusText}>최근 바로가기</Text>
            <View style={styles.milestoneList}>
              {hub.recent.map((link) => (
                <ObsidianLinkRow key={link.id} link={link} onOpenLink={onOpenLink} onOpenProject={onOpenProject} />
              ))}
            </View>
          </View>
          {hub.groups.map((group) => (
            <View key={group.projectId} style={styles.projectTaskBox}>
              <Text style={styles.sheetStatusText}>{group.projectName}</Text>
              <View style={styles.milestoneList}>
                {group.links.map((link) => (
                  <ObsidianLinkRow key={link.id} link={link} onOpenLink={onOpenLink} onOpenProject={onOpenProject} />
                ))}
              </View>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

function ObsidianLinkRow({
  link,
  onOpenLink,
  onOpenProject
}: {
  link: ObsidianHubLink;
  onOpenLink: (target: string) => void;
  onOpenProject: (projectId: number) => void;
}) {
  return (
    <View style={styles.milestoneRow}>
      <View style={styles.milestoneRowHeader}>
        <Text style={styles.projectRowTitle} numberOfLines={1}>{link.title}</Text>
        <Text style={styles.projectRowMeta}>Obsidian</Text>
      </View>
      <Text style={styles.projectRowMeta} numberOfLines={1}>
        {[link.projectName, link.milestoneTitle].filter(Boolean).join(' / ') || '프로젝트 미지정'}
      </Text>
      <Text style={styles.projectRowMeta} numberOfLines={1}>{link.contextLabel}</Text>
      <Text style={styles.projectRowMeta} numberOfLines={1}>{link.target}</Text>
      <View style={styles.actionGrid}>
        <Pressable style={styles.actionButton} onPress={() => onOpenProject(link.projectId)}>
          <Text style={styles.ghostButtonText}>프로젝트</Text>
        </Pressable>
        <Pressable style={styles.actionButton} onPress={() => onOpenLink(link.target)}>
          <Text style={styles.ghostButtonText}>열기</Text>
        </Pressable>
      </View>
    </View>
  );
}

type ContentQueueItem = {
  id: number;
  title: string;
  detail: string;
  status: CloudTask['status'];
  sourceKey: CloudTaskSourceKey;
  projectId: number | null;
  projectName: string;
  milestoneName: string;
  stageLabel: string;
  contextLabel: string;
  score: number;
};

type ContentQueueModel = {
  items: ContentQueueItem[];
  counts: {
    total: number;
    doing: number;
    linked: number;
    today: number;
    unlinked: number;
  };
};

function ContentSurface({
  queue,
  onOpenProject,
  onOpenSchedule,
  onOpenTask
}: {
  queue: ContentQueueModel;
  onOpenProject: (projectId: number) => void;
  onOpenSchedule: (sectionKey: CloudTaskSourceKey) => void;
  onOpenTask: (sectionKey: CloudTaskSourceKey, taskId: number) => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>콘텐츠</Text>
          <Text style={styles.projectRowMeta}>task 기반 작성/운영 큐</Text>
        </View>
        <Text style={styles.count}>{queue.counts.total}</Text>
      </View>
      <View style={styles.overviewStats}>
        <Text style={styles.overviewStat}>{queue.counts.doing} 진행</Text>
        <Text style={styles.overviewStat}>{queue.counts.today} 오늘</Text>
        <Text style={styles.overviewStat}>{queue.counts.linked} 연결</Text>
        <Text style={styles.overviewStat}>{queue.counts.unlinked} 미연결</Text>
      </View>
      {queue.items.length === 0 ? (
        <View style={styles.placeholderHeader}>
          <View style={styles.placeholderIcon}>
            <Feather name="file-text" color={PALETTE.carbonDeep} size={22} />
          </View>
          <View style={styles.placeholderCopy}>
            <Text style={styles.placeholderText}>콘텐츠 관련 task가 아직 없습니다.</Text>
            <Pressable style={styles.actionButton} onPress={() => onOpenSchedule('backlog')}>
              <Text style={styles.ghostButtonText}>Backlog에서 추가</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.milestoneList}>
          {queue.items.map((item) => (
            <View key={item.id} style={styles.milestoneRow}>
              <View style={styles.milestoneRowHeader}>
                <Text style={styles.projectRowTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.projectRowMeta}>{item.stageLabel}</Text>
              </View>
              {item.detail ? (
                <Text style={styles.projectRowMeta} numberOfLines={2}>{item.detail}</Text>
              ) : null}
              <Text style={styles.projectRowMeta} numberOfLines={1}>
                {[labelForKey(item.sourceKey), item.projectName, item.milestoneName].filter(Boolean).join(' / ')}
              </Text>
              <Text style={styles.projectRowMeta} numberOfLines={1}>{item.contextLabel}</Text>
              <View style={styles.actionGrid}>
                <Pressable style={styles.actionButton} onPress={() => onOpenTask(item.sourceKey, item.id)}>
                  <Text style={styles.ghostButtonText}>작성/수정</Text>
                </Pressable>
                {item.projectId ? (
                  <Pressable style={styles.actionButton} onPress={() => onOpenProject(item.projectId as number)}>
                    <Text style={styles.ghostButtonText}>프로젝트</Text>
                  </Pressable>
                ) : null}
                <Pressable style={styles.actionButton} onPress={() => onOpenSchedule(item.sourceKey)}>
                  <Text style={styles.ghostButtonText}>{labelForKey(item.sourceKey)}</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

type CommandOverviewModel = {
  counts: {
    activeTasks: number;
    doingTasks: number;
    todayProjects: number;
    upcomingMilestones: number;
    obsidianLinks: number;
  };
  nextTask: { id: number; title: string; sourceKey: CloudTaskSourceKey; projectName: string } | null;
  actions: {
    canStartNextTask: boolean;
    canCompleteCurrentTask: boolean;
    canCreateNextAction: boolean;
    canOpenObsidian: boolean;
  };
  doingTasks: Array<{ id: number; title: string; projectName: string }>;
  todayProjects: Array<{ id: number; name: string; northStar: string }>;
  upcomingMilestones: Array<{ id: number; title: string; status: CloudProjectMilestoneStatus; projectName: string }>;
  obsidianLinks: Array<{ id: number; title: string; target: string }>;
  review: {
    start: ReviewCardModel[];
    close: ReviewCardModel[];
  };
};

type ReviewActionTarget = 'schedule' | 'projects' | 'obsidian';

type ReviewCardModel = {
  id: string;
  label: string;
  title: string;
  detail: string;
  actionLabel: string;
  target: ReviewActionTarget;
  sourceKey?: CloudTaskSourceKey;
  sectionKey?: CloudTaskSourceKey;
};

type CommandOverviewProps = {
  overview: CommandOverviewModel;
  onCompleteCurrentTask: (taskId: number) => Promise<void>;
  onCreateNextAction: (title: string, projectId?: number | null) => Promise<void>;
  onOpenObsidian: (target: string) => void;
  onOpenObsidianHub: () => void;
  onOpenProjects: () => void;
  onOpenSchedule: (sectionKey: CloudTaskSourceKey) => void;
  onStartNextTask: (taskId: number) => Promise<void>;
};

function CommandOverview({
  overview,
  onCompleteCurrentTask,
  onCreateNextAction,
  onOpenObsidian,
  onOpenObsidianHub,
  onOpenProjects,
  onOpenSchedule,
  onStartNextTask
}: CommandOverviewProps) {
  const [nextActionTitle, setNextActionTitle] = useState('');
  const primaryTask = overview.doingTasks[0];
  const nextTask = overview.nextTask;
  const primaryProject = overview.todayProjects[0];
  const primaryMilestone = overview.upcomingMilestones[0];
  const primaryLink = overview.obsidianLinks[0];
  const canSubmitNextAction = nextActionTitle.trim().length > 0;
  const submitNextAction = async () => {
    const title = nextActionTitle.trim();
    if (!title) return;
    setNextActionTitle('');
    await onCreateNextAction(title, primaryProject?.id ?? null);
  };
  const runReviewAction = (card: ReviewCardModel) => {
    if (card.target === 'projects') {
      onOpenProjects();
      return;
    }
    if (card.target === 'obsidian') {
      onOpenObsidianHub();
      return;
    }
    onOpenSchedule(card.sourceKey || card.sectionKey || 'today');
  };

  return (
    <View style={styles.cockpit}>
      <View style={styles.overviewCard}>
        <View style={styles.overviewHeader}>
          <View>
            <Text style={styles.overviewEyebrow}>오늘의 커맨드</Text>
            <Text style={styles.overviewSubcopy}>지금 할 일과 연결 맥락</Text>
          </View>
          <View style={styles.overviewStats}>
            <Text style={styles.overviewStat}>{overview.counts.doingTasks} 진행</Text>
            <Text style={styles.overviewStat}>{overview.counts.todayProjects} 프로젝트</Text>
            <Text style={styles.overviewStat}>{overview.counts.obsidianLinks} 노트</Text>
          </View>
        </View>
        <View style={styles.cockpitFocus}>
          <Text style={styles.cockpitFocusLabel}>Next</Text>
          <Text style={styles.cockpitFocusTitle} numberOfLines={2}>
            {nextTask?.title || '바로 시작할 task가 없습니다'}
          </Text>
          <Text style={styles.cockpitFocusMeta} numberOfLines={1}>
            {nextTask ? [labelForKey(nextTask.sourceKey), nextTask.projectName].filter(Boolean).join(' · ') : 'Schedule에서 task를 추가하세요'}
          </Text>
          <View style={styles.actionGrid}>
            <Pressable
              accessibilityState={{ disabled: !nextTask || !overview.actions.canStartNextTask }}
              disabled={!nextTask || !overview.actions.canStartNextTask}
              style={[styles.actionButton, (!nextTask || !overview.actions.canStartNextTask) ? styles.actionButtonDisabled : null]}
              onPress={() => nextTask && onStartNextTask(nextTask.id)}
            >
              <Text style={[styles.ghostButtonText, (!nextTask || !overview.actions.canStartNextTask) ? styles.disabledButtonText : null]}>
                진행 시작
              </Text>
            </Pressable>
            <Pressable
              accessibilityState={{ disabled: !primaryTask }}
              disabled={!primaryTask}
              style={[styles.actionButton, !primaryTask ? styles.actionButtonDisabled : null]}
              onPress={() => primaryTask && onCompleteCurrentTask(primaryTask.id)}
            >
              <Text style={[styles.ghostButtonText, !primaryTask ? styles.disabledButtonText : null]}>
                현재 완료
              </Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.nextActionBox}>
          <TextInput
            style={styles.input}
            value={nextActionTitle}
            onChangeText={setNextActionTitle}
            placeholder="Today에 next action 추가"
            placeholderTextColor={PALETTE.toffee}
            returnKeyType="done"
            onSubmitEditing={submitNextAction}
          />
          <Pressable
            accessibilityState={{ disabled: !canSubmitNextAction }}
            disabled={!canSubmitNextAction}
            style={[styles.smallButton, !canSubmitNextAction ? styles.smallButtonDisabled : null]}
            onPress={submitNextAction}
          >
            <Text style={[styles.smallButtonText, !canSubmitNextAction ? styles.disabledButtonText : null]}>추가</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.reviewPanel}>
        <View style={styles.milestoneRowHeader}>
          <View>
            <Text style={styles.overviewEyebrow}>Focus review</Text>
            <Text style={styles.overviewSubcopy}>시작과 마감 체크</Text>
          </View>
          <Text style={styles.overviewStat}>{overview.review.start.length + overview.review.close.length}</Text>
        </View>
        <View style={styles.reviewColumn}>
          <Text style={styles.sheetStatusText}>하루 시작</Text>
          {overview.review.start.map((card) => (
            <ReviewCard key={card.id} card={card} onPress={() => runReviewAction(card)} />
          ))}
        </View>
        <View style={styles.reviewColumn}>
          <Text style={styles.sheetStatusText}>하루 마감</Text>
          {overview.review.close.map((card) => (
            <ReviewCard key={card.id} card={card} onPress={() => runReviewAction(card)} />
          ))}
        </View>
      </View>
      <View style={styles.overviewRows}>
        <OverviewRow label="Now" title={primaryTask?.title || '진행 중 task 없음'} detail={primaryTask?.projectName || 'Schedule에서 진행 상태를 지정하세요.'} />
        <OverviewRow label="Project" title={primaryProject?.name || '오늘 연결된 프로젝트 없음'} detail={primaryProject?.northStar || 'Today task에 프로젝트를 연결하면 표시됩니다.'} onPress={primaryProject ? onOpenProjects : undefined} />
        <OverviewRow label="Milestone" title={primaryMilestone?.title || '활성 마일스톤 없음'} detail={primaryMilestone ? `${primaryMilestone.projectName} · ${statusLabelForMilestone(primaryMilestone.status)}` : 'Project 탭에서 마일스톤을 추가하세요.'} />
        <OverviewRow label="Obsidian" title={primaryLink?.title || '연결된 노트 없음'} detail={primaryLink?.target || 'Project 링크에 Obsidian URI를 추가하세요.'} onPress={primaryLink ? () => onOpenObsidian(primaryLink.target) : undefined} />
      </View>
    </View>
  );
}

function ReviewCard({ card, onPress }: { card: ReviewCardModel; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.reviewCard, pressed ? styles.taskRowPressed : null]} onPress={onPress}>
      <Text style={styles.overviewRowLabel}>{card.label}</Text>
      <View style={styles.overviewRowCopy}>
        <Text style={styles.overviewRowTitle} numberOfLines={1}>{card.title}</Text>
        <Text style={styles.overviewRowDetail} numberOfLines={2}>{card.detail}</Text>
      </View>
      <Text style={styles.reviewActionText}>{card.actionLabel}</Text>
    </Pressable>
  );
}

function OverviewRow({ label, title, detail, onPress }: { label: string; title: string; detail: string; onPress?: () => void }) {
  return (
    <Pressable
      accessibilityState={{ disabled: !onPress }}
      disabled={!onPress}
      style={({ pressed }) => [styles.overviewRow, pressed ? styles.taskRowPressed : null]}
      onPress={onPress}
    >
      <Text style={styles.overviewRowLabel}>{label}</Text>
      <View style={styles.overviewRowCopy}>
        <Text style={styles.overviewRowTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.overviewRowDetail} numberOfLines={1}>{detail}</Text>
      </View>
    </Pressable>
  );
}

type ProjectsSurfaceProps = {
  focusProjectId: number | null;
  links: CloudProjectLink[];
  milestones: CloudProjectMilestone[];
  sections: TaskSection[];
  projects: CloudProject[];
  onArchiveProject: (project: CloudProject) => Promise<void>;
  onArchiveProjectLink: (link: CloudProjectLink) => Promise<void>;
  onArchiveProjectMilestone: (milestone: CloudProjectMilestone) => Promise<void>;
  onCreateProjectLink: (
    project: CloudProject,
    input: { title: string; kind: CloudProjectLinkKind; target: string; project_milestone_id?: number | null }
  ) => Promise<void>;
  onCreateProjectMilestone: (project: CloudProject, title: string) => Promise<void>;
  onCreateProject: (name: string) => Promise<CloudProject>;
  onCreateTaskForProject: (
    section: TaskSection,
    project: CloudProject,
    title: string,
    milestone?: CloudProjectMilestone | null
  ) => Promise<void>;
  onRefreshProjects: () => Promise<void>;
  onUpdateProjectLink: (link: CloudProjectLink, patch: CloudProjectLinkPatch) => Promise<void>;
  onUpdateProjectMilestone: (milestone: CloudProjectMilestone, patch: CloudProjectMilestonePatch) => Promise<void>;
  onUpdateProject: (project: CloudProject, patch: CloudProjectPatch) => Promise<void>;
};

function ProjectsSurface({
  focusProjectId,
  links,
  milestones,
  sections,
  projects,
  onArchiveProject,
  onArchiveProjectLink,
  onArchiveProjectMilestone,
  onCreateProjectLink,
  onCreateProjectMilestone,
  onCreateProject,
  onCreateTaskForProject,
  onRefreshProjects,
  onUpdateProjectLink,
  onUpdateProjectMilestone,
  onUpdateProject
}: ProjectsSurfaceProps) {
  const [newProjectName, setNewProjectName] = useState('');
  const [projectQuery, setProjectQuery] = useState('');
  const [projectStatusFilter, setProjectStatusFilter] = useState<ProjectStatusFilter>('all');
  const [projectSortMode, setProjectSortMode] = useState<ProjectSortMode>('manual');
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(projects[0]?.id ?? null);
  const visibleProjects = useMemo(() => {
    const query = projectQuery.trim().toLowerCase();
    return projects
      .filter((project) => projectStatusFilter === 'all' || project.status === projectStatusFilter)
      .filter((project) => {
        if (!query) return true;
        return [
          project.name,
          project.north_star,
          project.current_horizon,
          project.roadmap_note
        ].some((value) => String(value || '').toLowerCase().includes(query));
      })
      .sort((left, right) => compareProjectsForMode(left, right, projectSortMode));
  }, [projectQuery, projectSortMode, projectStatusFilter, projects]);
  const selectedProject = visibleProjects.find((project) => project.id === selectedProjectId)
    || visibleProjects[0]
    || projects.find((project) => project.id === selectedProjectId)
    || null;

  useEffect(() => {
    if (selectedProject?.id && selectedProject.id !== selectedProjectId) {
      setSelectedProjectId(selectedProject.id);
    } else if (!selectedProject && visibleProjects[0]) {
      setSelectedProjectId(visibleProjects[0].id);
    }
  }, [selectedProject, selectedProjectId, visibleProjects]);

  useEffect(() => {
    if (!focusProjectId) return;
    if (projects.some((project) => project.id === focusProjectId)) {
      setProjectQuery('');
      setProjectStatusFilter('all');
      setSelectedProjectId(focusProjectId);
    }
  }, [focusProjectId, projects]);

  const submitProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;
    setNewProjectName('');
    const savedProject = await onCreateProject(name);
    setSelectedProjectId(savedProject.id);
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>프로젝트</Text>
        <Pressable style={styles.headerButton} onPress={onRefreshProjects}>
          <Text style={styles.headerButtonText}>새로고침</Text>
        </Pressable>
      </View>
      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          value={newProjectName}
          onChangeText={setNewProjectName}
          placeholder="새 프로젝트"
          placeholderTextColor={PALETTE.toffee}
          returnKeyType="done"
          onSubmitEditing={submitProject}
        />
        <Pressable
          disabled={!newProjectName.trim()}
          style={[styles.smallButton, !newProjectName.trim() ? styles.smallButtonDisabled : null]}
          onPress={submitProject}
        >
          <Text style={[styles.smallButtonText, !newProjectName.trim() ? styles.disabledButtonText : null]}>추가</Text>
        </Pressable>
      </View>
      <View style={styles.projectOpsBar}>
        <TextInput
          style={styles.input}
          value={projectQuery}
          onChangeText={setProjectQuery}
          placeholder="프로젝트 검색"
          placeholderTextColor={PALETTE.toffee}
          returnKeyType="search"
        />
        <View style={styles.projectPickerOptions}>
          {(['all', 'active', 'paused'] as ProjectStatusFilter[]).map((value) => {
            const active = projectStatusFilter === value;
            return (
              <Pressable key={value} style={[styles.projectPill, active ? styles.projectPillActive : null]} onPress={() => setProjectStatusFilter(value)}>
                <Text style={[styles.projectPillText, active ? styles.projectPillTextActive : null]}>
                  {labelForProjectStatusFilter(value)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.projectPickerOptions}>
          {(['manual', 'name', 'status'] as ProjectSortMode[]).map((value) => {
            const active = projectSortMode === value;
            return (
              <Pressable key={value} style={[styles.projectPill, active ? styles.projectPillActive : null]} onPress={() => setProjectSortMode(value)}>
                <Text style={[styles.projectPillText, active ? styles.projectPillTextActive : null]}>
                  {labelForProjectSortMode(value)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {projects.length === 0 ? (
        <Text style={styles.empty}>아직 프로젝트가 없습니다</Text>
      ) : visibleProjects.length === 0 ? (
        <Text style={styles.empty}>검색 조건에 맞는 프로젝트가 없습니다</Text>
      ) : (
        <View style={styles.projectList}>
          {visibleProjects.map((project) => {
            const active = selectedProject?.id === project.id;
            return (
              <Pressable
                key={project.id}
                style={[styles.projectRow, active ? styles.projectRowActive : null]}
                onPress={() => setSelectedProjectId(project.id)}
              >
                <Text style={styles.projectRowTitle} numberOfLines={1}>{project.name}</Text>
                <Text style={styles.projectRowMeta} numberOfLines={1}>
                  {statusLabelForProject(project.status)} · {project.north_star || project.current_horizon || '운영 메타데이터 없음'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {selectedProject ? (
        <ProjectDetail
          key={selectedProject.id}
          links={links.filter((link) => link.project_id === selectedProject.id)}
          milestones={milestones.filter((milestone) => milestone.project_id === selectedProject.id)}
          project={selectedProject}
          sections={sections}
          onArchiveProject={onArchiveProject}
          onArchiveProjectLink={onArchiveProjectLink}
          onArchiveProjectMilestone={onArchiveProjectMilestone}
          onCreateProjectLink={onCreateProjectLink}
          onCreateProjectMilestone={onCreateProjectMilestone}
          onCreateTaskForProject={onCreateTaskForProject}
          onUpdateProjectLink={onUpdateProjectLink}
          onUpdateProjectMilestone={onUpdateProjectMilestone}
          onUpdateProject={onUpdateProject}
        />
      ) : null}
    </View>
  );
}

type ProjectDetailProps = {
  links: CloudProjectLink[];
  milestones: CloudProjectMilestone[];
  project: CloudProject;
  sections: TaskSection[];
  onArchiveProject: (project: CloudProject) => Promise<void>;
  onArchiveProjectLink: (link: CloudProjectLink) => Promise<void>;
  onArchiveProjectMilestone: (milestone: CloudProjectMilestone) => Promise<void>;
  onCreateProjectLink: (
    project: CloudProject,
    input: { title: string; kind: CloudProjectLinkKind; target: string; project_milestone_id?: number | null }
  ) => Promise<void>;
  onCreateProjectMilestone: (project: CloudProject, title: string) => Promise<void>;
  onCreateTaskForProject: (
    section: TaskSection,
    project: CloudProject,
    title: string,
    milestone?: CloudProjectMilestone | null
  ) => Promise<void>;
  onUpdateProjectLink: (link: CloudProjectLink, patch: CloudProjectLinkPatch) => Promise<void>;
  onUpdateProjectMilestone: (milestone: CloudProjectMilestone, patch: CloudProjectMilestonePatch) => Promise<void>;
  onUpdateProject: (project: CloudProject, patch: CloudProjectPatch) => Promise<void>;
};

function ProjectDetail({
  links,
  milestones,
  project,
  sections,
  onArchiveProject,
  onArchiveProjectLink,
  onArchiveProjectMilestone,
  onCreateProjectLink,
  onCreateProjectMilestone,
  onCreateTaskForProject,
  onUpdateProjectLink,
  onUpdateProjectMilestone,
  onUpdateProject
}: ProjectDetailProps) {
  const [name, setName] = useState(project.name);
  const [northStar, setNorthStar] = useState(project.north_star || '');
  const [description, setDescription] = useState(project.description || '');
  const [githubUrl, setGithubUrl] = useState(project.github_url || '');
  const [currentHorizon, setCurrentHorizon] = useState(project.current_horizon || '');
  const [roadmapNote, setRoadmapNote] = useState(project.roadmap_note || '');
  const [status, setStatus] = useState<CloudProjectStatus>(project.status);
  const [newMilestoneTitle, setNewMilestoneTitle] = useState('');
  const [newLinkTitle, setNewLinkTitle] = useState('');
  const [newLinkTarget, setNewLinkTarget] = useState('');
  const [newLinkKind, setNewLinkKind] = useState<CloudProjectLinkKind>('obsidian');
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<number | null>(milestones[0]?.id ?? null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskSectionKey, setTaskSectionKey] = useState<CloudTaskSourceKey>('today');
  const selectedMilestone = milestones.find((milestone) => milestone.id === selectedMilestoneId) || milestones[0] || null;
  const targetSection = sections.find((section) => section.key === taskSectionKey) || sections[0] || null;
  const linkedCount = sections.reduce((total, section) => total + section.tasks.filter((task) => task.project_id === project.id).length, 0);
  const milestoneTaskCounts = useMemo(() => new Map(milestones.map((milestone) => [
    milestone.id,
    sections.reduce((total, section) => (
      total + section.tasks.filter((task) => task.project_milestone_id === milestone.id && task.status !== 'archived').length
    ), 0)
  ])), [milestones, sections]);
  const emptyMilestones = useMemo(
    () => milestones.filter((milestone) => (milestoneTaskCounts.get(milestone.id) || 0) === 0),
    [milestoneTaskCounts, milestones]
  );
  const milestoneLinkedCount = selectedMilestone
    ? sections.reduce((total, section) => total + section.tasks.filter((task) => task.project_milestone_id === selectedMilestone.id).length, 0)
    : 0;

  useEffect(() => {
    if (!selectedMilestone && milestones[0]) setSelectedMilestoneId(milestones[0].id);
  }, [milestones, selectedMilestone]);

  const save = async () => {
    await onUpdateProject(project, {
      name,
      north_star: northStar,
      description,
      github_url: githubUrl,
      current_horizon: currentHorizon,
      roadmap_note: roadmapNote,
      status
    });
  };

  const submitTask = async () => {
    const title = taskTitle.trim();
    if (!title || !targetSection) return;
    setTaskTitle('');
    await onCreateTaskForProject(targetSection, project, title, selectedMilestone);
  };

  const submitMilestone = async () => {
    const title = newMilestoneTitle.trim();
    if (!title) return;
    setNewMilestoneTitle('');
    await onCreateProjectMilestone(project, title);
  };

  const openGithub = () => {
    const url = normalizedWebTarget(githubUrl);
    if (!url) return;
    Linking.openURL(url).catch(() => {});
  };

  const submitLink = async () => {
    const title = newLinkTitle.trim();
    const target = newLinkTarget.trim();
    if (!title || !target) return;
    setNewLinkTitle('');
    setNewLinkTarget('');
    await onCreateProjectLink(project, {
      title,
      target,
      kind: newLinkKind,
      project_milestone_id: selectedMilestone?.id ?? null
    });
  };

  return (
    <View style={styles.projectDetail}>
      <View style={styles.sheetDivider} />
      <View style={styles.projectDetailHeader}>
        <Text style={styles.eyebrow}>선택된 프로젝트 · 연결 task {linkedCount}</Text>
        <View style={styles.projectStatusRow}>
          {(['active', 'paused'] as CloudProjectStatus[]).map((value) => (
            <Pressable
              key={value}
              style={[styles.projectPill, status === value ? styles.projectPillActive : null]}
              onPress={() => setStatus(value)}
            >
              <Text style={[styles.projectPillText, status === value ? styles.projectPillTextActive : null]}>
                {statusLabelForProject(value)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.projectMaintenanceBox}>
        <View style={styles.milestoneRowHeader}>
          <Text style={styles.sheetStatusText}>정리 상태</Text>
          <Text style={styles.projectRowMeta}>링크 {links.length}</Text>
        </View>
        <View style={styles.projectPickerOptions}>
          <Text style={styles.overviewStat}>연결 task {linkedCount}</Text>
          <Text style={styles.overviewStat}>마일스톤 {milestones.length}</Text>
          <Text style={styles.overviewStat}>빈 마일스톤 {emptyMilestones.length}</Text>
        </View>
        {emptyMilestones.length > 0 ? (
          <View style={styles.milestoneList}>
            {emptyMilestones.slice(0, 3).map((milestone) => (
              <Pressable
                key={milestone.id}
                style={styles.maintenanceRow}
                onPress={() => setSelectedMilestoneId(milestone.id)}
              >
                <Text style={styles.projectRowTitle} numberOfLines={1}>{milestone.title}</Text>
                <Text style={styles.projectRowMeta}>{statusLabelForMilestone(milestone.status)} · next action 0</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="프로젝트 이름" placeholderTextColor={PALETTE.toffee} />
      <TextInput style={styles.input} value={northStar} onChangeText={setNorthStar} placeholder="북극성" placeholderTextColor={PALETTE.toffee} />
      <TextInput style={[styles.input, styles.sheetDetailInput]} value={description} onChangeText={setDescription} placeholder="설명" placeholderTextColor={PALETTE.toffee} multiline textAlignVertical="top" />
      <TextInput style={styles.input} value={githubUrl} onChangeText={setGithubUrl} placeholder="GitHub URL" placeholderTextColor={PALETTE.toffee} autoCapitalize="none" />
      <TextInput style={styles.input} value={currentHorizon} onChangeText={setCurrentHorizon} placeholder="Current horizon" placeholderTextColor={PALETTE.toffee} />
      <TextInput style={[styles.input, styles.sheetInput]} value={roadmapNote} onChangeText={setRoadmapNote} placeholder="Roadmap note" placeholderTextColor={PALETTE.toffee} multiline textAlignVertical="top" />
      <View style={styles.actionGrid}>
        <Pressable style={[styles.actionButton, styles.actionButtonPrimary]} onPress={save}>
          <Text style={styles.smallButtonText}>저장</Text>
        </Pressable>
        <Pressable
          accessibilityState={{ disabled: !normalizedWebTarget(githubUrl) }}
          disabled={!normalizedWebTarget(githubUrl)}
          style={[styles.actionButton, !normalizedWebTarget(githubUrl) ? styles.actionButtonDisabled : null]}
          onPress={openGithub}
        >
          <Text style={[styles.ghostButtonText, !normalizedWebTarget(githubUrl) ? styles.disabledButtonText : null]}>GitHub 열기</Text>
        </Pressable>
      </View>
      <View style={styles.projectTaskBox}>
        <Text style={styles.sheetStatusText}>마일스톤</Text>
        <View style={styles.addRow}>
          <TextInput
            style={styles.input}
            value={newMilestoneTitle}
            onChangeText={setNewMilestoneTitle}
            placeholder="새 마일스톤"
            placeholderTextColor={PALETTE.toffee}
            onSubmitEditing={submitMilestone}
          />
          <Pressable
            style={[styles.smallButton, !newMilestoneTitle.trim() ? styles.smallButtonDisabled : null]}
            disabled={!newMilestoneTitle.trim()}
            onPress={submitMilestone}
          >
            <Text style={[styles.smallButtonText, !newMilestoneTitle.trim() ? styles.disabledButtonText : null]}>추가</Text>
          </Pressable>
        </View>
        {milestones.length === 0 ? (
          <Text style={styles.projectLinkedEmpty}>아직 마일스톤이 없습니다</Text>
        ) : (
          <View style={styles.milestoneList}>
            {milestones.map((milestone) => {
              const active = selectedMilestone?.id === milestone.id;
              return (
                <Pressable
                  key={milestone.id}
                  style={[styles.milestoneRow, active ? styles.projectRowActive : null]}
                  onPress={() => setSelectedMilestoneId(milestone.id)}
                >
                  <View style={styles.milestoneRowHeader}>
                    <Text style={styles.projectRowTitle} numberOfLines={1}>{milestone.title}</Text>
                    <Text style={styles.projectRowMeta}>{statusLabelForMilestone(milestone.status)}</Text>
                  </View>
                  <Text style={styles.projectRowMeta}>
                    next action {milestoneTaskCounts.get(milestone.id) || 0}
                  </Text>
                  {milestone.description ? (
                    <Text style={styles.projectRowMeta} numberOfLines={2}>{milestone.description}</Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
      {selectedMilestone ? (
        <MilestoneEditor
          linkedCount={milestoneLinkedCount}
          milestone={selectedMilestone}
          onArchiveProjectMilestone={onArchiveProjectMilestone}
          onUpdateProjectMilestone={onUpdateProjectMilestone}
        />
      ) : null}
      <View style={styles.projectTaskBox}>
        <Text style={styles.sheetStatusText}>링크</Text>
        <View style={styles.projectPickerOptions}>
          {(['obsidian', 'github', 'url', 'file'] as CloudProjectLinkKind[]).map((kind) => {
            const active = newLinkKind === kind;
            return (
              <Pressable key={kind} style={[styles.projectPill, active ? styles.projectPillActive : null]} onPress={() => setNewLinkKind(kind)}>
                <Text style={[styles.projectPillText, active ? styles.projectPillTextActive : null]}>{labelForLinkKind(kind)}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.addRow}>
          <TextInput style={styles.input} value={newLinkTitle} onChangeText={setNewLinkTitle} placeholder="링크 이름" placeholderTextColor={PALETTE.toffee} />
        </View>
        <View style={styles.addRow}>
          <TextInput
            style={styles.input}
            value={newLinkTarget}
            onChangeText={setNewLinkTarget}
            placeholder="obsidian:// 또는 URL/path"
            placeholderTextColor={PALETTE.toffee}
            autoCapitalize="none"
            onSubmitEditing={submitLink}
          />
          <Pressable style={[styles.smallButton, (!newLinkTitle.trim() || !newLinkTarget.trim()) ? styles.smallButtonDisabled : null]} disabled={!newLinkTitle.trim() || !newLinkTarget.trim()} onPress={submitLink}>
            <Text style={[styles.smallButtonText, (!newLinkTitle.trim() || !newLinkTarget.trim()) ? styles.disabledButtonText : null]}>추가</Text>
          </Pressable>
        </View>
        {links.length === 0 ? (
          <Text style={styles.projectLinkedEmpty}>연결된 링크 없음</Text>
        ) : (
          <View style={styles.milestoneList}>
            {links.map((link) => (
              <ProjectLinkRow
                key={link.id}
                link={link}
                onArchiveProjectLink={onArchiveProjectLink}
                onUpdateProjectLink={onUpdateProjectLink}
              />
            ))}
          </View>
        )}
      </View>
      <View style={styles.projectTaskBox}>
        <Text style={styles.sheetStatusText}>Next action 추가</Text>
        {selectedMilestone ? (
          <Text style={styles.projectRowMeta}>연결 마일스톤: {selectedMilestone.title}</Text>
        ) : (
          <Text style={styles.projectRowMeta}>마일스톤 없이 프로젝트에 연결됩니다</Text>
        )}
        <View style={styles.projectPickerOptions}>
          {SCHEDULE_KEYS.map((key) => {
            const active = taskSectionKey === key;
            return (
              <Pressable key={key} style={[styles.projectPill, active ? styles.projectPillActive : null]} onPress={() => setTaskSectionKey(key)}>
                <Text style={[styles.projectPillText, active ? styles.projectPillTextActive : null]}>{labelForKey(key)}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.addRow}>
          <TextInput style={styles.input} value={taskTitle} onChangeText={setTaskTitle} placeholder="연결 task" placeholderTextColor={PALETTE.toffee} onSubmitEditing={submitTask} />
          <Pressable style={[styles.smallButton, !taskTitle.trim() ? styles.smallButtonDisabled : null]} disabled={!taskTitle.trim()} onPress={submitTask}>
            <Text style={[styles.smallButtonText, !taskTitle.trim() ? styles.disabledButtonText : null]}>추가</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.projectLinkedTasks}>
        {sections.map((section) => {
          const tasks = section.tasks.filter((task) => (
            selectedMilestone ? task.project_milestone_id === selectedMilestone.id : task.project_id === project.id
          ));
          return (
            <View key={section.key} style={styles.projectLinkedSection}>
              <Text style={styles.projectLinkedTitle}>{labelForKey(section.key)} {tasks.length}</Text>
              {tasks.length === 0 ? (
                <Text style={styles.projectLinkedEmpty}>연결된 task 없음</Text>
              ) : tasks.slice(0, 4).map((task) => (
                <Text key={task.id} style={styles.projectLinkedTask} numberOfLines={1}>- {task.title}</Text>
              ))}
            </View>
          );
        })}
      </View>
      <Pressable style={[styles.actionButton, styles.actionButtonDanger]} onPress={() => onArchiveProject(project)}>
        <Text style={styles.dangerButtonText}>프로젝트 보관</Text>
      </Pressable>
    </View>
  );
}

type MilestoneEditorProps = {
  linkedCount: number;
  milestone: CloudProjectMilestone;
  onArchiveProjectMilestone: (milestone: CloudProjectMilestone) => Promise<void>;
  onUpdateProjectMilestone: (milestone: CloudProjectMilestone, patch: CloudProjectMilestonePatch) => Promise<void>;
};

function MilestoneEditor({
  linkedCount,
  milestone,
  onArchiveProjectMilestone,
  onUpdateProjectMilestone
}: MilestoneEditorProps) {
  const [title, setTitle] = useState(milestone.title);
  const [description, setDescription] = useState(milestone.description || '');
  const [status, setStatus] = useState<CloudProjectMilestoneStatus>(milestone.status);
  const [targetDate, setTargetDate] = useState(milestone.target_date || '');

  useEffect(() => {
    setTitle(milestone.title);
    setDescription(milestone.description || '');
    setStatus(milestone.status);
    setTargetDate(milestone.target_date || '');
  }, [milestone]);

  const save = async () => {
    await onUpdateProjectMilestone(milestone, {
      title,
      description,
      status,
      target_date: targetDate
    });
  };

  return (
    <View style={styles.milestoneEditor}>
      <Text style={styles.eyebrow}>선택된 마일스톤 · next action {linkedCount}</Text>
      <View style={styles.projectStatusRow}>
        {(['planned', 'active', 'done'] as CloudProjectMilestoneStatus[]).map((value) => (
          <Pressable
            key={value}
            style={[styles.projectPill, status === value ? styles.projectPillActive : null]}
            onPress={() => setStatus(value)}
          >
            <Text style={[styles.projectPillText, status === value ? styles.projectPillTextActive : null]}>
              {statusLabelForMilestone(value)}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="마일스톤 제목" placeholderTextColor={PALETTE.toffee} />
      <TextInput style={[styles.input, styles.sheetDetailInput]} value={description} onChangeText={setDescription} placeholder="마일스톤 설명" placeholderTextColor={PALETTE.toffee} multiline textAlignVertical="top" />
      <TextInput style={styles.input} value={targetDate} onChangeText={setTargetDate} placeholder="목표일 YYYY-MM-DD" placeholderTextColor={PALETTE.toffee} />
      <View style={styles.actionGrid}>
        <Pressable style={[styles.actionButton, styles.actionButtonPrimary]} onPress={save}>
          <Text style={styles.smallButtonText}>마일스톤 저장</Text>
        </Pressable>
        <Pressable style={[styles.actionButton, styles.actionButtonDanger]} onPress={() => onArchiveProjectMilestone(milestone)}>
          <Text style={styles.dangerButtonText}>보관</Text>
        </Pressable>
      </View>
    </View>
  );
}

type ProjectLinkRowProps = {
  link: CloudProjectLink;
  onArchiveProjectLink: (link: CloudProjectLink) => Promise<void>;
  onUpdateProjectLink: (link: CloudProjectLink, patch: CloudProjectLinkPatch) => Promise<void>;
};

function ProjectLinkRow({ link, onArchiveProjectLink, onUpdateProjectLink }: ProjectLinkRowProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(link.title);
  const [target, setTarget] = useState(link.target);

  useEffect(() => {
    setTitle(link.title);
    setTarget(link.target);
  }, [link]);

  const openLink = () => {
    if (link.kind === 'file') return;
    const target = normalizedOpenTarget(link);
    if (!target) return;
    Linking.openURL(target).catch(() => {});
  };
  const save = async () => {
    const nextTitle = title.trim();
    const nextTarget = target.trim();
    if (!nextTitle || !nextTarget) return;
    await onUpdateProjectLink(link, { title: nextTitle, target: nextTarget });
    setEditing(false);
  };

  return (
    <View style={styles.milestoneRow}>
      {editing ? (
        <View style={styles.projectLinkEdit}>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="링크 제목" placeholderTextColor={PALETTE.toffee} />
          <TextInput style={styles.input} value={target} onChangeText={setTarget} placeholder="링크 대상" placeholderTextColor={PALETTE.toffee} autoCapitalize="none" />
        </View>
      ) : (
        <>
          <View style={styles.milestoneRowHeader}>
            <Pressable style={styles.linkTitleButton} onPress={openLink}>
              <Text style={styles.projectRowTitle} numberOfLines={1}>{link.title}</Text>
            </Pressable>
            <Text style={styles.projectRowMeta}>{labelForLinkKind(link.kind)}</Text>
          </View>
          <Text style={styles.projectRowMeta} numberOfLines={2}>{link.target}</Text>
        </>
      )}
      <View style={styles.actionGrid}>
        <Pressable style={styles.actionButton} onPress={openLink} disabled={link.kind === 'file' || editing}>
          <Text style={link.kind === 'file' ? styles.disabledButtonText : styles.ghostButtonText}>
            {link.kind === 'file' ? '모바일 표시만' : '열기'}
          </Text>
        </Pressable>
        <Pressable
          accessibilityState={{ disabled: editing && (!title.trim() || !target.trim()) }}
          disabled={editing && (!title.trim() || !target.trim())}
          style={[styles.actionButton, editing && (!title.trim() || !target.trim()) ? styles.actionButtonDisabled : null]}
          onPress={editing ? save : () => setEditing(true)}
        >
          <Text style={[styles.ghostButtonText, editing && (!title.trim() || !target.trim()) ? styles.disabledButtonText : null]}>
            {editing ? '저장' : '수정'}
          </Text>
        </Pressable>
        <Pressable style={[styles.actionButton, styles.actionButtonDanger]} onPress={() => onArchiveProjectLink(link)}>
          <Text style={styles.dangerButtonText}>보관</Text>
        </Pressable>
      </View>
    </View>
  );
}

type TaskSectionViewProps = {
  focusRequest: TaskFocusRequest | null;
  section: TaskSection;
  onCreateTask: (
    section: TaskSection,
    title: string,
    options?: { project_id?: number | null; project_milestone_id?: number | null }
  ) => Promise<void>;
  onDeleteTask: (task: CloudTask) => Promise<void>;
  onMoveTask: (task: CloudTask, targetKey: CloudTaskSourceKey) => Promise<void>;
  onReorderTask: (section: TaskSection, task: CloudTask, direction: 'up' | 'down') => Promise<void>;
  onCycleTaskStatus: (task: CloudTask) => Promise<void>;
  onOpenProjects: () => void;
  onSetTaskMilestone: (task: CloudTask, milestoneId: number | null) => Promise<void>;
  onSetTaskProject: (task: CloudTask, projectId: number | null) => Promise<void>;
  onToggleDone: (task: CloudTask) => Promise<void>;
  onUpdateTask: (task: CloudTask, title: string, detail?: string | null) => Promise<void>;
  milestones: CloudProjectMilestone[];
  projects: CloudProject[];
};

function TaskSectionView({
  focusRequest,
  section,
  onCreateTask,
  onDeleteTask,
  onMoveTask,
  onReorderTask,
  onCycleTaskStatus,
  onOpenProjects,
  onSetTaskMilestone,
  onSetTaskProject,
  onToggleDone,
  onUpdateTask,
  milestones,
  projects
}: TaskSectionViewProps) {
  const [title, setTitle] = useState('');
  const [createProjectId, setCreateProjectId] = useState<number | null>(null);
  const [createMilestoneId, setCreateMilestoneId] = useState<number | null>(null);
  const [showCreateOptions, setShowCreateOptions] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [grabbedTaskId, setGrabbedTaskId] = useState<number | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  const canSubmit = title.trim().length > 0;
  const selectedTask = section.tasks.find((task) => task.id === selectedTaskId) || null;
  const createMilestoneOptions = useMemo(
    () => milestones.filter((milestone) => !createProjectId || milestone.project_id === createProjectId),
    [createProjectId, milestones]
  );
  const displayTasks = useMemo(() => orderTasksForScheduleDisplay(section.tasks), [section.tasks]);
  const displaySection = useMemo(() => ({ ...section, tasks: displayTasks }), [displayTasks, section]);
  useEffect(() => {
    if (createProjectId || createMilestoneId) {
      setShowCreateOptions(true);
    }
  }, [createMilestoneId, createProjectId]);

  useEffect(() => {
    if (!createProjectId) {
      setCreateMilestoneId(null);
      return;
    }
    if (createMilestoneId && !createMilestoneOptions.some((milestone) => milestone.id === createMilestoneId)) {
      setCreateMilestoneId(null);
    }
  }, [createMilestoneId, createMilestoneOptions, createProjectId]);

  useEffect(() => {
    if (!focusRequest) return;
    if (section.tasks.some((task) => task.id === focusRequest.taskId)) {
      setGrabbedTaskId(null);
      setSelectedTaskId(focusRequest.taskId);
    }
  }, [focusRequest, section.tasks]);

  const submit = async () => {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    const selectedMilestone = createMilestoneId
      ? milestones.find((milestone) => milestone.id === createMilestoneId) || null
      : null;
    const projectId = selectedMilestone?.project_id ?? createProjectId ?? null;
    setTitle('');
    await onCreateTask(section, nextTitle, {
      project_id: projectId,
      project_milestone_id: selectedMilestone?.id ?? null
    });
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{section.label}</Text>
        <Text style={styles.count}>{section.tasks.length}</Text>
      </View>
      <View style={styles.addRow}>
        <UiInput
          ref={inputRef}
          className="h-14 flex-1 rounded-md border-border bg-secondary px-4 text-[17px] text-foreground"
          value={title}
          onChangeText={setTitle}
          placeholder={`${labelForKey(section.key)}에 추가`}
          placeholderTextColor={PALETTE.toffee}
          blurOnSubmit={false}
          returnKeyType="done"
          onSubmitEditing={submit}
        />
        <UiButton
          accessibilityState={{ disabled: !canSubmit }}
          disabled={!canSubmit}
          className="h-14 min-w-[72px]"
          variant={canSubmit ? 'default' : 'secondary'}
          onPress={submit}
        >
          <UiText>추가</UiText>
        </UiButton>
      </View>
      {projects.length > 0 && !showCreateOptions ? (
        <View className="mb-2 flex-row">
          <UiButton
            className="h-10 flex-1"
            variant="outline"
            onPress={() => setShowCreateOptions(true)}
          >
            <UiText>프로젝트 연결</UiText>
          </UiButton>
        </View>
      ) : null}
      {projects.length > 0 && showCreateOptions ? (
        <View style={styles.inlineAttachPanel}>
          <View className="flex-row items-center justify-between gap-2">
            <Text style={styles.sheetStatusText}>프로젝트 연결</Text>
            <UiButton
              className="h-9 min-w-[64px]"
              variant="ghost"
              onPress={() => {
                if (!createProjectId && !createMilestoneId) {
                  setShowCreateOptions(false);
                } else {
                  setCreateProjectId(null);
                  setCreateMilestoneId(null);
                  setShowCreateOptions(false);
                }
              }}
            >
              <UiText>{createProjectId || createMilestoneId ? '해제' : '접기'}</UiText>
            </UiButton>
          </View>
          <View style={styles.projectPickerOptions}>
            <Pressable
              style={[styles.projectPill, !createProjectId ? styles.projectPillActive : null]}
              onPress={() => {
                setCreateProjectId(null);
                setCreateMilestoneId(null);
              }}
            >
              <Text style={[styles.projectPillText, !createProjectId ? styles.projectPillTextActive : null]}>없음</Text>
            </Pressable>
            {projects.map((project) => {
              const active = createProjectId === project.id;
              return (
                <Pressable
                  key={project.id}
                  style={[styles.projectPill, active ? styles.projectPillActive : null]}
                  onPress={() => {
                    setCreateProjectId(project.id);
                    setCreateMilestoneId(null);
                  }}
                >
                  <Text style={[styles.projectPillText, active ? styles.projectPillTextActive : null]} numberOfLines={1}>
                    {project.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {createProjectId && createMilestoneOptions.length > 0 ? (
            <View style={styles.projectPickerOptions}>
              <Pressable
                style={[styles.projectPill, !createMilestoneId ? styles.projectPillActive : null]}
                onPress={() => setCreateMilestoneId(null)}
              >
                <Text style={[styles.projectPillText, !createMilestoneId ? styles.projectPillTextActive : null]}>마일스톤 없음</Text>
              </Pressable>
              {createMilestoneOptions.map((milestone) => {
                const active = createMilestoneId === milestone.id;
                return (
                  <Pressable
                    key={milestone.id}
                    style={[styles.projectPill, active ? styles.projectPillActive : null]}
                    onPress={() => setCreateMilestoneId(milestone.id)}
                  >
                    <Text style={[styles.projectPillText, active ? styles.projectPillTextActive : null]} numberOfLines={1}>
                      {milestone.title}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
      ) : null}
      {displayTasks.length === 0 ? (
        <Text style={styles.empty}>아직 항목이 없습니다</Text>
      ) : displayTasks.map((task, index) => (
        <TaskCard
          key={task.id}
          grabbed={grabbedTaskId === task.id}
          isFirst={index === 0}
          isLast={index === displayTasks.length - 1}
          sectionKey={section.key}
          task={task}
          projectName={projectNameForTask(task, projects)}
          milestoneName={milestoneNameForTask(task, milestones)}
          onDoubleTapTask={() => {
            Keyboard.dismiss();
            setGrabbedTaskId(null);
            onToggleDone(task);
          }}
          onGrabTask={() => {
            Keyboard.dismiss();
            setSelectedTaskId(null);
            setGrabbedTaskId((current) => (current === task.id ? null : task.id));
          }}
          onMoveGrabbedTask={(direction) => onReorderTask(displaySection, task, direction)}
          onCycleTaskStatus={() => onCycleTaskStatus(task)}
          onPressTask={() => {
            Keyboard.dismiss();
            if (grabbedTaskId === task.id) {
              setGrabbedTaskId(null);
              return;
            }
            setSelectedTaskId(task.id);
          }}
          onToggleDone={onToggleDone}
        />
      ))}
      <TaskDetailSheet
        sectionKey={section.key}
        task={selectedTask}
        visible={Boolean(selectedTask)}
        onClose={() => {
          Keyboard.dismiss();
          setSelectedTaskId(null);
        }}
        onMoveTask={async (task, targetKey) => {
          await onMoveTask(task, targetKey);
          setSelectedTaskId(null);
        }}
        onCycleTaskStatus={onCycleTaskStatus}
        onOpenProjects={onOpenProjects}
        onSetTaskProject={onSetTaskProject}
        onUpdateTask={onUpdateTask}
        projects={projects}
      />
    </View>
  );
}

type ScheduleBoardTask = {
  task: CloudTask;
  section: TaskSection;
};

type ScheduleBoardViewProps = {
  sections: TaskSection[];
  onDeleteTask: (task: CloudTask) => Promise<void>;
  onMoveTask: (task: CloudTask, targetKey: CloudTaskSourceKey) => Promise<void>;
  onCycleTaskStatus: (task: CloudTask) => Promise<void>;
  onOpenProjects: () => void;
  onSetTaskMilestone: (task: CloudTask, milestoneId: number | null) => Promise<void>;
  onSetTaskProject: (task: CloudTask, projectId: number | null) => Promise<void>;
  onSetTaskStatus: (task: CloudTask, status: CloudTaskStatus) => Promise<void>;
  onDropBoardTaskStatus: (task: CloudTask, status: CloudTaskStatus) => Promise<void>;
  onReorderBoardTask: (task: CloudTask, orderedTasks: CloudTask[], targetIndex: number) => Promise<void>;
  onArchiveTask: (task: CloudTask) => Promise<void>;
  onUndoBoardTask: (task: CloudTask) => Promise<void>;
  onToggleDone: (task: CloudTask) => Promise<void>;
  onUpdateTask: (task: CloudTask, title: string, detail?: string | null) => Promise<void>;
  boardToast: BoardToast | null;
  clearBoardToast: () => void;
  showBoardToast: (toast: Omit<BoardToast, 'id'>) => void;
  milestones: CloudProjectMilestone[];
  projects: CloudProject[];
};

function ScheduleBoardView({
  sections,
  onDeleteTask,
  onMoveTask,
  onCycleTaskStatus,
  onOpenProjects,
  onSetTaskMilestone,
  onSetTaskProject,
  onSetTaskStatus,
  onDropBoardTaskStatus,
  onReorderBoardTask,
  onArchiveTask,
  onUndoBoardTask,
  onToggleDone,
  onUpdateTask,
  boardToast,
  clearBoardToast,
  showBoardToast,
  milestones,
  projects
}: ScheduleBoardViewProps) {
  const { width: windowWidth } = useWindowDimensions();
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [activeBoardColumn, setActiveBoardColumn] = useState<CloudTaskStatus>('doing');
  const [boardDrag, setBoardDrag] = useState<BoardDragState | null>(null);
  const boardDragRef = useRef<typeof boardDrag>(null);
  const activeBoardColumnPreferenceLoaded = useRef(false);
  const boardTasks = useMemo(() => buildScheduleBoardTasks(sections), [sections]);
  const selectedBoardTask = boardTasks.find((item) => item.task.id === selectedTaskId) || null;
  const todoCount = boardTasks.filter((item) => item.task.status === 'todo').length;
  const doingCount = boardTasks.filter((item) => item.task.status === 'doing').length;
  const doneCount = boardTasks.filter((item) => item.task.status === 'done').length;
  const heldCount = boardTasks.filter((item) => item.task.status === 'held').length;
  const delayedCount = boardTasks.filter((item) => item.task.status === 'delayed').length;
  const activeColumnTasks = boardTasks.filter((item) => item.task.status === activeBoardColumn);
  const activePressure = boardColumnPressure(activeBoardColumn, activeColumnTasks.length);
  const activeOrderedTasks = activeColumnTasks.map((item) => item.task);

  useEffect(() => {
    boardDragRef.current = boardDrag;
  }, [boardDrag]);

  useEffect(() => {
    AsyncStorage.getItem(BOARD_ACTIVE_STATUS_STORAGE_KEY)
      .then((value) => {
        if (isBoardStatus(value)) {
          setActiveBoardColumn(value);
        }
      })
      .catch(() => {})
      .finally(() => {
        activeBoardColumnPreferenceLoaded.current = true;
      });
  }, []);

  useEffect(() => {
    if (!activeBoardColumnPreferenceLoaded.current) return;
    AsyncStorage.setItem(BOARD_ACTIVE_STATUS_STORAGE_KEY, activeBoardColumn).catch(() => {});
  }, [activeBoardColumn]);

  const jumpToColumn = (status: CloudTaskStatus) => {
    Keyboard.dismiss();
    setBoardDrag(null);
    setActiveBoardColumn(status);
  };

  const startBoardDrag = (taskId: number, fromIndex: number) => {
    Keyboard.dismiss();
    setSelectedTaskId(null);
    Vibration.vibrate(8);
    setBoardDrag({ taskId, fromIndex, targetIndex: fromIndex, dragY: 0, statusDropTarget: null });
  };

  const updateBoardDrag = (taskId: number, fromIndex: number, dragY: number, pageX: number) => {
    setBoardDrag((current) => {
      if (!current || current.taskId !== taskId) return current;
      const deltaRows = Math.round(dragY / BOARD_DRAG_ROW_HEIGHT);
      const targetIndex = clamp(fromIndex + deltaRows, 0, Math.max(activeColumnTasks.length - 1, 0));
      const statusDropTarget = dragY <= BOARD_STATUS_DROP_THRESHOLD ? statusForScreenX(pageX, windowWidth) : null;
      return { ...current, dragY, targetIndex, statusDropTarget };
    });
  };

  const finishBoardDrag = async (task: CloudTask) => {
    const finalDrag = boardDragRef.current;
    setBoardDrag(null);
    if (!finalDrag || finalDrag.taskId !== task.id) return;
    if (finalDrag.statusDropTarget && finalDrag.statusDropTarget !== task.status) {
      Vibration.vibrate(12);
      setActiveBoardColumn(finalDrag.statusDropTarget);
      await runBoardOperation(
        `${statusLabel(finalDrag.statusDropTarget)}로 이동했습니다.`,
        task,
        () => onDropBoardTaskStatus(task, finalDrag.statusDropTarget as CloudTaskStatus)
      );
      return;
    }
    if (finalDrag.targetIndex === finalDrag.fromIndex) return;
    await runBoardOperation(
      `${finalDrag.targetIndex + 1}번째로 이동했습니다.`,
      task,
      () => onReorderBoardTask(task, activeOrderedTasks, finalDrag.targetIndex)
    );
  };

  const runBoardOperation = async (message: string, task: CloudTask, operation: () => Promise<void>) => {
    try {
      await operation();
      showBoardToast({
        message,
        tone: 'success',
        undo: { label: '되돌리기', task }
      });
    } catch (error) {
      showBoardToast({ message: getErrorMessage(error), tone: 'error' });
    }
  };

  const archiveBoardTask = async (task: CloudTask) => {
    try {
      await onArchiveTask(task);
      showBoardToast({ message: '보관했습니다.', tone: 'success' });
    } catch (error) {
      showBoardToast({ message: getErrorMessage(error), tone: 'error' });
    }
  };

  return (
    <View style={styles.boardSection}>
      <View style={styles.boardHeader}>
        <View style={styles.boardHeaderCopy}>
          <Text style={styles.sectionTitle}>Schedule Board</Text>
          <Text style={styles.boardSubtitle}>
            진행 {doingCount} · 다음 후보 {todoCount} · 완료 {doneCount}
            {heldCount || delayedCount ? ` · 보류 ${heldCount} · 지연 ${delayedCount}` : ''}
          </Text>
        </View>
        <Text style={styles.count}>{boardTasks.length}</Text>
      </View>
      <View style={styles.boardColumnRail}>
        {SCHEDULE_BOARD_COLUMNS.map((status) => {
          const columnTasks = boardTasks.filter((item) => item.task.status === status);
          const isActive = activeBoardColumn === status;
          const isDropTarget = boardDrag?.statusDropTarget === status;
          return (
            <Pressable
              key={status}
              accessibilityState={{ selected: isActive }}
              style={[
                styles.boardColumnRailItem,
                isActive ? styles.boardColumnRailItemActive : null,
                isDropTarget ? styles.boardColumnRailItemDropTarget : null
              ]}
              onPress={() => jumpToColumn(status)}
            >
              <Text style={[styles.boardColumnRailText, isActive || isDropTarget ? styles.boardColumnRailTextActive : null]}>
                {statusLabel(status)}
              </Text>
              <Text style={[styles.boardColumnRailCount, isActive || isDropTarget ? styles.boardColumnRailTextActive : null]}>
                {columnTasks.length}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <BoardOperationToast
        toast={boardToast}
        onDismiss={clearBoardToast}
        onUndo={onUndoBoardTask}
      />
      <View style={styles.boardColumnFocused}>
        <View style={styles.boardColumnHeader}>
          <View style={[styles.statusDot, statusDotStyle(activeBoardColumn)]} />
          <View style={styles.boardColumnCopy}>
            <Text style={styles.boardColumnTitle}>{statusLabel(activeBoardColumn)}</Text>
            <Text style={styles.boardColumnPressure}>{activePressure.label}</Text>
          </View>
          <Text style={[styles.boardColumnCount, activePressure.level === 'high' ? styles.boardColumnCountHigh : null]}>
            {activeColumnTasks.length}
          </Text>
        </View>
        <View style={styles.boardCards}>
          {activeColumnTasks.length === 0 ? (
            <Text style={styles.boardEmpty}>{boardEmptyMessage(activeBoardColumn)}</Text>
          ) : activeColumnTasks.map((item, index) => (
            <ScheduleBoardCard
              key={item.task.id}
              item={item}
              dragState={boardDrag?.taskId === item.task.id ? boardDrag : null}
              dragTargetActive={Boolean(boardDrag && boardDrag.taskId !== item.task.id && boardDrag.targetIndex === index)}
              index={index}
              projectName={projectNameForTask(item.task, projects)}
              milestoneName={milestoneNameForTask(item.task, milestones)}
              onPress={() => {
                Keyboard.dismiss();
                setSelectedTaskId(item.task.id);
              }}
              onDragEnd={() => finishBoardDrag(item.task)}
              onDragMove={(dragY, pageX) => updateBoardDrag(item.task.id, index, dragY, pageX)}
              onDragStart={() => startBoardDrag(item.task.id, index)}
              onArchiveTask={() => archiveBoardTask(item.task)}
              onSetTaskStatus={(task, status) => runBoardOperation(
                `${statusLabel(status)}로 변경했습니다.`,
                task,
                () => onSetTaskStatus(task, status)
              )}
            />
          ))}
        </View>
      </View>
      <TaskDetailSheet
        sectionKey={selectedBoardTask?.section.key || 'today'}
        task={selectedBoardTask?.task || null}
        visible={Boolean(selectedBoardTask)}
        onClose={() => {
          Keyboard.dismiss();
          setSelectedTaskId(null);
        }}
        onMoveTask={async (task, targetKey) => {
          await onMoveTask(task, targetKey);
          setSelectedTaskId(null);
        }}
        onCycleTaskStatus={onCycleTaskStatus}
        onOpenProjects={onOpenProjects}
        onSetTaskProject={onSetTaskProject}
        onUpdateTask={onUpdateTask}
        projects={projects}
      />
    </View>
  );
}

type ScheduleBoardCardProps = {
  item: ScheduleBoardTask;
  dragState: BoardDragState | null;
  dragTargetActive: boolean;
  index: number;
  projectName: string;
  milestoneName: string;
  onArchiveTask: () => Promise<void>;
  onDragEnd: () => Promise<void>;
  onDragMove: (dragY: number, pageX: number) => void;
  onDragStart: () => void;
  onPress: () => void;
  onSetTaskStatus: (task: CloudTask, status: CloudTaskStatus) => Promise<void>;
};

function ScheduleBoardCard({
  item,
  dragState,
  dragTargetActive,
  index,
  projectName,
  milestoneName,
  onArchiveTask,
  onDragEnd,
  onDragMove,
  onDragStart,
  onPress,
  onSetTaskStatus
}: ScheduleBoardCardProps) {
  const { task, section } = item;
  const nextStatus = nextTaskStatus(task.status);
  const dragging = Boolean(dragState);
  const properties = boardCardProperties(task, section.key, index, projectName, milestoneName);
  const dragResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 6,
    onPanResponderGrant: onDragStart,
    onPanResponderMove: (event, gesture) => onDragMove(gesture.dy, event.nativeEvent.pageX),
    onPanResponderRelease: () => {
      onDragEnd();
    },
    onPanResponderTerminate: () => {
      onDragEnd();
    }
  }), [onDragEnd, onDragMove, onDragStart]);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.boardCard,
        task.status === 'done' ? styles.boardCardDone : null,
        dragTargetActive ? styles.boardCardDropTarget : null,
        dragging ? styles.boardCardDragging : null,
        dragging ? { transform: [{ translateY: dragState?.dragY || 0 }] } : null,
        pressed && !dragging ? styles.taskRowPressed : null
      ]}
      onPress={onPress}
    >
      <View style={styles.boardCardHeader}>
        <Pressable
          accessibilityLabel={`우선순위 드래그 ${index + 1}번`}
          delayLongPress={BOARD_DRAG_ACTIVATION_MS}
          hitSlop={8}
          style={styles.boardDragHandle}
          onLongPress={onDragStart}
          onPressOut={() => {
            if (dragging) onDragEnd();
          }}
          {...dragResponder.panHandlers}
        >
          <Feather name="menu" color={PALETTE.boardMuted} size={17} />
        </Pressable>
        <Text style={styles.boardCardSource}>{labelForKey(section.key)}</Text>
        <View style={styles.boardCardStatusPill}>
          <View style={[styles.statusDot, styles.boardCardStatusDot, statusDotStyle(task.status)]} />
          <Text style={styles.boardCardStatus}>{statusLabel(task.status)}</Text>
        </View>
        <Pressable
          accessibilityLabel={`${statusActionLabel(task.status)} action`}
          style={styles.boardStatusIconButton}
          onPress={(event) => {
            event.stopPropagation();
            Keyboard.dismiss();
            onSetTaskStatus(task, nextStatus);
          }}
        >
          <Feather name={statusActionIcon(task.status)} color={PALETTE.floralWhite} size={16} />
          <Text style={styles.boardStatusIconText}>{statusActionLabel(task.status)}</Text>
        </Pressable>
        {task.status === 'done' ? (
          <Pressable
            accessibilityLabel="완료 작업 보관"
            style={styles.boardArchiveIconButton}
            onPress={(event) => {
              event.stopPropagation();
              Keyboard.dismiss();
              onArchiveTask();
            }}
          >
            <Feather name="archive" color={PALETTE.carbonDeep} size={15} />
          </Pressable>
        ) : null}
      </View>
      {dragging ? (
        <Text style={styles.boardDragHint}>
          {boardDragHintText(dragState)}
        </Text>
      ) : null}
      <Text style={[styles.boardCardTitle, task.status === 'done' ? styles.taskTitleDone : null]} numberOfLines={3}>
        {task.title}
      </Text>
      {taskDescription(task) ? (
        <Text style={styles.boardCardDetail} numberOfLines={2}>{taskDescription(task)}</Text>
      ) : null}
      {taskMetaText(task, section.key) ? (
        <Text style={styles.boardCardMeta} numberOfLines={1}>{taskMetaText(task, section.key)}</Text>
      ) : null}
      <View style={styles.boardPropertyGrid}>
        {properties.map((property) => (
          <View key={`${property.label}-${property.value}`} style={styles.boardPropertyRow}>
            <Feather name={property.icon} color={property.tone || PALETTE.boardMuted} size={15} />
            <Text style={styles.boardPropertyLabel}>{property.label}</Text>
            <Text style={[styles.boardPropertyValue, property.strong ? styles.boardPropertyValueStrong : null]} numberOfLines={1}>
              {property.value}
            </Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

type BoardOperationToastProps = {
  toast: BoardToast | null;
  onDismiss: () => void;
  onUndo: (task: CloudTask) => Promise<void>;
};

function BoardOperationToast({ toast, onDismiss, onUndo }: BoardOperationToastProps) {
  if (!toast) return null;
  return (
    <View style={[styles.boardToast, toast.tone === 'error' ? styles.boardToastError : null]}>
      <View style={styles.boardToastCopy}>
        <Text style={styles.boardToastTitle}>{toast.tone === 'error' ? '작업 실패' : '작업 반영'}</Text>
        <Text style={styles.boardToastMessage} numberOfLines={2}>{toast.message}</Text>
      </View>
      {toast.undo ? (
        <Pressable
          style={styles.boardToastButton}
          onPress={() => onUndo(toast.undo!.task)}
        >
          <Text style={styles.boardToastButtonText}>{toast.undo.label}</Text>
        </Pressable>
      ) : null}
      <Pressable accessibilityLabel="알림 닫기" style={styles.boardToastClose} onPress={onDismiss}>
        <Feather name="x" color={PALETTE.carbonDeep} size={16} />
      </Pressable>
    </View>
  );
}

type TaskCardProps = {
  grabbed: boolean;
  isFirst: boolean;
  isLast: boolean;
  sectionKey: CloudTaskSourceKey;
  task: CloudTask;
  projectName: string;
  milestoneName: string;
  onDoubleTapTask: () => void;
  onGrabTask: () => void;
  onMoveGrabbedTask: (direction: 'up' | 'down') => Promise<void>;
  onCycleTaskStatus: () => Promise<void>;
  onPressTask: () => void;
  onToggleDone: (task: CloudTask) => Promise<void>;
};

function TaskCard({
  grabbed,
  isFirst,
  isLast,
  sectionKey,
  task,
  projectName,
  milestoneName,
  onDoubleTapTask,
  onGrabTask,
  onMoveGrabbedTask,
  onCycleTaskStatus,
  onPressTask
}: TaskCardProps) {
  const lastTapAt = useRef(0);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (openTimer.current) clearTimeout(openTimer.current);
  }, []);

  const handlePress = () => {
    const now = Date.now();
    if (now - lastTapAt.current <= DOUBLE_TAP_DELAY_MS) {
      if (openTimer.current) clearTimeout(openTimer.current);
      openTimer.current = null;
      lastTapAt.current = 0;
      onDoubleTapTask();
      return;
    }
    lastTapAt.current = now;
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      onPressTask();
    }, DOUBLE_TAP_DELAY_MS);
  };

  return (
    <Pressable
      style={({ pressed }) => [
        pressed ? styles.taskRowPressed : null
      ]}
      onPress={handlePress}
      onLongPress={onGrabTask}
      delayLongPress={320}
    >
      <Card
        className={cn(
          'mb-2 gap-3 border-border bg-card px-4 py-4',
          task.status === 'done' && 'opacity-70',
          grabbed && 'border-primary bg-secondary'
        )}
      >
        <View className="flex-row items-start gap-3">
          <UiButton
            accessibilityLabel={`${statusLabel(task.status)} 상태`}
            className={cn(
              'h-9 min-w-[72px] flex-row gap-2 px-3',
              task.status === 'doing' && 'border-primary',
              task.status === 'done' && 'bg-accent',
              task.status === 'held' && 'border-primary',
              task.status === 'delayed' && 'border-destructive'
            )}
            variant={task.status === 'done' ? 'default' : 'outline'}
            onPress={(event) => {
              event.stopPropagation();
              Keyboard.dismiss();
              onCycleTaskStatus();
            }}
          >
            <View style={[styles.statusDot, statusDotStyle(task.status)]} />
            <UiText className={cn('text-[11px] font-extrabold', task.status === 'done' ? 'text-primary-foreground' : 'text-muted-foreground')}>
              {statusLabel(task.status)}
            </UiText>
          </UiButton>
          <View className="flex-1 gap-1">
            <UiText
              className={cn(
                'text-[16px] font-bold leading-6 text-foreground',
                task.status === 'done' && 'text-muted-foreground line-through'
              )}
              numberOfLines={2}
            >
              {task.title}
            </UiText>
          {taskDescription(task) ? (
              <UiText className="text-[12px] font-semibold leading-5 text-muted-foreground" numberOfLines={2}>
                {taskDescription(task)}
              </UiText>
          ) : null}
          </View>
        </View>
      {taskMetaText(task, sectionKey) ? (
          <UiText className="pl-[84px] text-[11px] leading-4 text-muted-foreground">
            {taskMetaText(task, sectionKey)}
          </UiText>
      ) : null}
      {projectName || milestoneName ? (
          <UiText className="pl-[84px] text-[11px] font-extrabold leading-4 text-muted-foreground">
            {[projectName, milestoneName].filter(Boolean).join(' / ')}
          </UiText>
      ) : null}
      {grabbed ? (
          <View className="gap-2 pl-[84px] pt-1">
            <UiText className="text-[12px] font-extrabold text-muted-foreground">잡은 상태</UiText>
            <View className="flex-row flex-wrap gap-2">
              <UiButton
              accessibilityState={{ disabled: isFirst }}
              disabled={isFirst}
                className="min-h-11 flex-1"
                variant="outline"
              onPress={(event) => {
                event.stopPropagation();
                onMoveGrabbedTask('up');
              }}
            >
                <UiText>위로</UiText>
              </UiButton>
              <UiButton
              accessibilityState={{ disabled: isLast }}
              disabled={isLast}
                className="min-h-11 flex-1"
                variant="outline"
              onPress={(event) => {
                event.stopPropagation();
                onMoveGrabbedTask('down');
              }}
            >
                <UiText>아래로</UiText>
              </UiButton>
            </View>
          </View>
      ) : null}
      </Card>
    </Pressable>
  );
}

type TaskDetailSheetProps = {
  sectionKey: CloudTaskSourceKey;
  task: CloudTask | null;
  visible: boolean;
  onClose: () => void;
  onMoveTask: (task: CloudTask, targetKey: CloudTaskSourceKey) => Promise<void>;
  onCycleTaskStatus: (task: CloudTask) => Promise<void>;
  onOpenProjects: () => void;
  onSetTaskProject: (task: CloudTask, projectId: number | null) => Promise<void>;
  onUpdateTask: (task: CloudTask, title: string, detail?: string | null) => Promise<void>;
  projects: CloudProject[];
};

function TaskDetailSheet({
  sectionKey,
  task,
  visible,
  onClose,
  onMoveTask,
  onCycleTaskStatus,
  onOpenProjects,
  onSetTaskProject,
  onUpdateTask,
  projects
}: TaskDetailSheetProps) {
  const [title, setTitle] = useState(task?.title || '');
  const [detail, setDetail] = useState(taskDescription(task) || '');
  const insets = useSafeAreaInsets();
  const canSave = title.trim().length > 0;
  const targetKeys = (['today', 'deadlines', 'backlog'] as CloudTaskSourceKey[]).filter((key) => key !== sectionKey);
  const nextStatusText = task ? statusLabel(nextTaskStatus(task.status)) : '상태';
  const sheetBottomGap = Platform.OS === 'android' ? Math.max(insets.bottom, 76) : 0;
  const sheetBottomPadding = Math.max(insets.bottom + 18, 18);

  useEffect(() => {
    setTitle(task?.title || '');
    setDetail(taskDescription(task) || '');
  }, [task]);

  const save = async () => {
    if (!task) return;
    const nextTitle = title.trim();
    if (!nextTitle) return;
    Keyboard.dismiss();
    await onUpdateTask(task, nextTitle, detail);
  };

  return (
    <Modal animationType="slide" transparent visible={visible && Boolean(task)} onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetRoot}
      >
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View style={[styles.sheet, { marginBottom: sheetBottomGap, paddingBottom: sheetBottomPadding }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderCopy}>
              <Text style={styles.eyebrow}>{labelForKey(sectionKey)}</Text>
              <Text style={styles.sheetTitle}>작업 수정</Text>
            </View>
            <UiButton className="h-11 min-w-[72px]" variant="outline" onPress={onClose}>
              <UiText>닫기</UiText>
            </UiButton>
          </View>
          <View style={styles.sheetStatusRow}>
            <View style={[styles.statusDot, task ? statusDotStyle(task.status) : null]} />
            <Text style={styles.sheetStatusText}>
              {task ? statusLabel(task.status) : '기본'}
            </Text>
            {task && taskMetaText(task, sectionKey) ? (
              <Text style={styles.sheetMetaText}>{taskMetaText(task, sectionKey)}</Text>
            ) : null}
          </View>
          <UiInput
            className="min-h-24 rounded-md border-border bg-secondary px-4 py-3 text-[16px] text-foreground"
            value={title}
            onChangeText={setTitle}
            placeholder="작업 제목"
            placeholderTextColor={PALETTE.toffee}
            multiline
            blurOnSubmit={false}
            returnKeyType="done"
            onSubmitEditing={save}
          />
          <UiInput
            className="min-h-[74px] rounded-md border-border bg-secondary px-4 py-3 text-[15px] text-foreground"
            value={detail}
            onChangeText={setDetail}
            placeholder="설명"
            placeholderTextColor={PALETTE.toffee}
            multiline
            textAlignVertical="top"
          />
          <View style={styles.sheetConnectPanel}>
            <View style={styles.milestoneRowHeader}>
              <Text style={styles.sheetStatusText}>프로젝트 연결</Text>
              <Text style={styles.projectRowMeta}>
                {task?.project_id ? '연결됨' : '선택 안 함'}
              </Text>
            </View>
            {projects.length === 0 ? (
              <View style={styles.sheetEmptyConnectBox}>
                <Text style={styles.projectRowMeta}>연결할 프로젝트가 아직 없습니다.</Text>
                <UiButton
                  className="min-h-11"
                  variant="outline"
                  onPress={() => {
                    Keyboard.dismiss();
                    onClose();
                    onOpenProjects();
                  }}
                >
                  <UiText>프로젝트 탭에서 만들기</UiText>
                </UiButton>
              </View>
            ) : (
              <View style={styles.projectPickerOptions}>
                <Pressable
                  style={[styles.projectPill, !task?.project_id ? styles.projectPillActive : null]}
                  onPress={() => task && onSetTaskProject(task, null)}
                >
                  <Text style={[styles.projectPillText, !task?.project_id ? styles.projectPillTextActive : null]}>없음</Text>
                </Pressable>
                {projects.map((project) => {
                  const active = task?.project_id === project.id;
                  return (
                    <Pressable
                      key={project.id}
                      style={[styles.projectPill, active ? styles.projectPillActive : null]}
                      onPress={() => task && onSetTaskProject(task, project.id)}
                    >
                      <Text style={[styles.projectPillText, active ? styles.projectPillTextActive : null]} numberOfLines={1}>
                        {project.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
          <View style={styles.actionGrid}>
            <UiButton
              accessibilityState={{ disabled: !canSave }}
              disabled={!canSave}
              className="min-h-11 flex-1"
              variant={canSave ? 'default' : 'secondary'}
              onPress={save}
            >
              <UiText>저장</UiText>
            </UiButton>
            <UiButton className="min-h-11 flex-1" variant="outline" onPress={onClose}>
              <UiText>취소</UiText>
            </UiButton>
          </View>
          <View style={styles.sheetDivider} />
          <View style={styles.sheetActionStack}>
            <UiButton
              className="min-h-11"
              variant="outline"
              onPress={() => {
                if (!task) return;
                Keyboard.dismiss();
                onCycleTaskStatus(task);
              }}
            >
              <UiText>
                {task ? `${nextStatusText}${nextStatusText.endsWith('됨') ? '으로' : '로'} 변경` : '상태 변경'}
              </UiText>
            </UiButton>
            <View style={styles.sheetMoveGrid}>
              {targetKeys.map((key) => (
                <UiButton
                  key={key}
                  className="min-h-11 flex-1"
                  variant="outline"
                  onPress={() => {
                    if (!task) return;
                    Keyboard.dismiss();
                    onMoveTask(task, key);
                  }}
                >
                  <UiText>{moveActionLabelForKey(key)}</UiText>
                </UiButton>
              ))}
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function replaceTask(sections: TaskSection[], taskId: number, nextTask: CloudTask) {
  return sections.map((section) => ({
    ...section,
    tasks: section.tasks.map((task) => (task.id === taskId ? nextTask : task))
  }));
}

function buildScheduleBoardTasks(sections: TaskSection[]): ScheduleBoardTask[] {
  return sections
    .flatMap((section) => orderTasksForScheduleDisplay(section.tasks).map((task) => ({ task, section })))
    .sort((left, right) => {
      const statusDelta = taskStatusDisplayRank(left.task.status) - taskStatusDisplayRank(right.task.status);
      if (statusDelta !== 0) return statusDelta;
      const sortDelta = left.task.sort_order - right.task.sort_order;
      if (sortDelta !== 0) return sortDelta;
      const sectionDelta = SCHEDULE_KEYS.indexOf(left.section.key) - SCHEDULE_KEYS.indexOf(right.section.key);
      if (sectionDelta !== 0) return sectionDelta;
      return left.task.id - right.task.id;
    });
}

function buildBoardStatusTasks(sections: TaskSection[], status: CloudTaskStatus) {
  return buildScheduleBoardTasks(sections)
    .filter((item) => item.task.status === status)
    .map((item) => item.task);
}

function moveTaskLocally(sections: TaskSection[], task: CloudTask, targetKey: CloudTaskSourceKey) {
  const targetSection = sections.find((section) => section.key === targetKey);
  if (!targetSection?.source) return sections;
  const movedTask = {
    ...task,
    source_id: targetSection.source.id,
    sort_order: nextSortOrder(targetSection.tasks)
  };
  return sections.map((section) => {
    if (section.key === targetKey) return { ...section, tasks: [...section.tasks, movedTask] };
    return { ...section, tasks: section.tasks.filter((candidate) => candidate.id !== task.id) };
  });
}

function nextSortOrder(tasks: CloudTask[]) {
  const minSortOrder = tasks.reduce((min, task) => Math.min(min, task.sort_order), 0);
  return minSortOrder - 10;
}

function sortOrderForIndex(tasks: CloudTask[], index: number) {
  const previous = tasks[index - 1];
  const next = tasks[index + 1];
  if (!previous && !next) return 0;
  if (!previous) return next.sort_order - 10;
  if (!next) return previous.sort_order + 10;
  return (previous.sort_order + next.sort_order) / 2;
}

function sortOrderForStatusTop(tasks: CloudTask[]) {
  if (tasks.length === 0) return 0;
  const minSortOrder = tasks.reduce((min, task) => Math.min(min, task.sort_order), tasks[0].sort_order);
  return minSortOrder - 10;
}

function orderTasksForScheduleDisplay(tasks: CloudTask[]) {
  return [...tasks].sort((left, right) => {
    const statusDelta = taskStatusDisplayRank(left.status) - taskStatusDisplayRank(right.status);
    if (statusDelta !== 0) return statusDelta;
    const sortDelta = left.sort_order - right.sort_order;
    if (sortDelta !== 0) return sortDelta;
    return left.id - right.id;
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function isBoardStatus(value: unknown): value is CloudTaskStatus {
  return value === 'todo' || value === 'doing' || value === 'done' || value === 'held' || value === 'delayed';
}

function statusForScreenX(pageX: number, width: number): CloudTaskStatus {
  const bucket = clamp(Math.floor((pageX / Math.max(width, 1)) * SCHEDULE_BOARD_COLUMNS.length), 0, SCHEDULE_BOARD_COLUMNS.length - 1);
  return SCHEDULE_BOARD_COLUMNS[bucket];
}

function boardDragHintText(dragState: BoardDragState | null) {
  if (!dragState) return '';
  if (dragState.statusDropTarget) return `${statusLabel(dragState.statusDropTarget)}로 이동`;
  if (dragState.targetIndex !== dragState.fromIndex) return `${dragState.targetIndex + 1}번째로 이동`;
  return '위아래는 우선순위, 위쪽 rail은 상태 이동';
}

function isUnlinkedActiveTask(task: CloudTask) {
  return task.status !== 'archived' && !task.project_id;
}

function taskStatusDisplayRank(status: CloudTask['status']) {
  if (status === 'doing') return 0;
  if (status === 'todo') return 1;
  if (status === 'done') return 2;
  if (status === 'held') return 3;
  if (status === 'delayed') return 4;
  return 5;
}

function nextTaskStatus(status: CloudTask['status']): CloudTask['status'] {
  if (status === 'todo') return 'doing';
  if (status === 'doing') return 'done';
  if (status === 'done') return 'todo';
  if (status === 'held') return 'doing';
  if (status === 'delayed') return 'doing';
  return 'todo';
}

function statusLabel(status: CloudTask['status']) {
  if (status === 'doing') return '진행 중';
  if (status === 'done') return '완료됨';
  if (status === 'held') return '보류 중';
  if (status === 'delayed') return '지연됨';
  return '시작 전';
}

function boardColumnPressure(status: CloudTaskStatus, count: number) {
  if (status === 'doing') {
    if (count >= 5) return { level: 'high', label: '줄이기' };
    if (count >= 3) return { level: 'medium', label: '집중 필요' };
    if (count === 0) return { level: 'low', label: '하나 시작' };
    return { level: 'low', label: '집중 적정' };
  }
  if (status === 'todo') {
    if (count >= 25) return { level: 'high', label: '후보 많음' };
    if (count >= 10) return { level: 'medium', label: '추릴 것' };
    if (count === 0) return { level: 'low', label: '후보 없음' };
    return { level: 'low', label: '다음 후보' };
  }
  if (status === 'held') {
    if (count >= 8) return { level: 'medium', label: '보류 정리' };
    if (count === 0) return { level: 'low', label: '보류 없음' };
    return { level: 'low', label: '대기 중' };
  }
  if (status === 'delayed') {
    if (count >= 3) return { level: 'high', label: '즉시 정리' };
    if (count === 0) return { level: 'low', label: '지연 없음' };
    return { level: 'medium', label: '확인 필요' };
  }
  if (count >= 10) return { level: 'low', label: '마감 정리' };
  if (count === 0) return { level: 'low', label: '완료 없음' };
  return { level: 'low', label: '완료 확인' };
}

function boardEmptyMessage(status: CloudTaskStatus) {
  if (status === 'doing') return '진행 중인 작업이 없습니다. 기본에서 하나를 시작하세요.';
  if (status === 'done') return '완료된 작업이 없습니다. 진행 중인 작업을 마감하세요.';
  if (status === 'held') return '보류 중인 작업이 없습니다.';
  if (status === 'delayed') return '지연된 작업이 없습니다.';
  return '다음 후보가 없습니다. List에서 새 작업을 추가하세요.';
}

function statusActionLabel(status: CloudTaskStatus) {
  if (status === 'doing') return '완료';
  if (status === 'done') return '복귀';
  if (status === 'held') return '재개';
  if (status === 'delayed') return '재개';
  return '시작';
}

function statusActionIcon(status: CloudTaskStatus): FeatherIconName {
  if (status === 'doing') return 'check';
  if (status === 'done') return 'rotate-ccw';
  if (status === 'held') return 'play';
  if (status === 'delayed') return 'play';
  return 'play';
}

function statusLabelForProject(status: CloudProjectStatus) {
  if (status === 'paused') return '보류';
  if (status === 'archived') return '보관';
  return '진행';
}

function labelForProjectStatusFilter(value: ProjectStatusFilter) {
  if (value === 'active') return '진행';
  if (value === 'paused') return '보류';
  if (value === 'archived') return '보관';
  return '전체';
}

function labelForProjectSortMode(value: ProjectSortMode) {
  if (value === 'name') return '이름순';
  if (value === 'status') return '상태순';
  return '정렬순';
}

function compareProjectsForMode(left: CloudProject, right: CloudProject, mode: ProjectSortMode) {
  if (mode === 'name') return left.name.localeCompare(right.name, 'ko');
  if (mode === 'status') {
    const statusDelta = projectStatusRank(left.status) - projectStatusRank(right.status);
    if (statusDelta !== 0) return statusDelta;
  }
  const sortDelta = left.sort_order - right.sort_order;
  if (sortDelta !== 0) return sortDelta;
  return left.name.localeCompare(right.name, 'ko');
}

function projectStatusRank(status: CloudProjectStatus) {
  if (status === 'active') return 0;
  if (status === 'paused') return 1;
  return 2;
}

function statusLabelForMilestone(status: CloudProjectMilestoneStatus) {
  if (status === 'active') return '진행';
  if (status === 'done') return '완료';
  if (status === 'archived') return '보관';
  return '계획';
}

type TaskContextCandidate = {
  task: CloudTask;
  sectionKey: CloudTaskSourceKey;
  project: CloudProject | null;
  milestone: CloudProjectMilestone | null;
  score: number;
  contextLabel: string;
};

type ContentRelevance = {
  score: number;
  matched: string[];
};

const CONTENT_KEYWORDS = [
  '콘텐츠',
  'content',
  'blog',
  '블로그',
  'youtube',
  '유튜브',
  '글쓰기',
  'post',
  'article',
  '영상',
  '원고',
  'draft',
  'write',
  'edit',
  'publish',
  '발행',
  '작성',
  '리서치'
];

function buildTaskContextCandidates(
  sections: TaskSection[],
  projects: CloudProject[],
  milestones: CloudProjectMilestone[]
): TaskContextCandidate[] {
  return sections.flatMap((section) => section.tasks.map((task) => {
    const project = task.project_id ? projects.find((candidate) => candidate.id === task.project_id) || null : null;
    const milestone = task.project_milestone_id
      ? milestones.find((candidate) => candidate.id === task.project_milestone_id) || null
      : null;
    const scored = scoreTaskContext(task, section.key, project, milestone);
    return {
      task,
      sectionKey: section.key,
      project,
      milestone,
      score: scored.score,
      contextLabel: scored.reasons.slice(0, 3).join(' · ')
    };
  }));
}

function compareTaskContexts(left: TaskContextCandidate, right: TaskContextCandidate) {
  const scoreDelta = right.score - left.score;
  if (scoreDelta !== 0) return scoreDelta;
  const statusDelta = taskStatusDisplayRank(left.task.status) - taskStatusDisplayRank(right.task.status);
  if (statusDelta !== 0) return statusDelta;
  return left.task.sort_order - right.task.sort_order;
}

function scoreTaskContext(
  task: CloudTask,
  sectionKey: CloudTaskSourceKey,
  project: CloudProject | null,
  milestone: CloudProjectMilestone | null
) {
  let score = 0;
  const reasons: string[] = [];
  if (task.status === 'doing') {
    score += 80;
    reasons.push('진행 중');
  } else if (task.status === 'todo') {
    score += 45;
    reasons.push('대기');
  } else if (task.status === 'done') {
    score += 8;
    reasons.push('완료됨');
  }

  const sectionScore = scoreScheduleSection(sectionKey);
  score += sectionScore.score;
  reasons.push(sectionScore.label);

  const dueScore = scoreDateSignal(task.due_at || task.scheduled_for);
  score += dueScore.score;
  if (dueScore.label) reasons.push(dueScore.label);

  if (project) {
    score += 18;
    reasons.push(project.status === 'active' ? '활성 프로젝트' : statusLabelForProject(project.status));
    if (project.status === 'active') score += 14;
    if (project.status === 'paused') score -= 8;
    if (project.status === 'archived') score -= 24;
  } else {
    score -= 4;
    reasons.push('프로젝트 미연결');
  }

  if (milestone) {
    score += 12 + scoreMilestoneContext(milestone);
    reasons.push(`${statusLabelForMilestone(milestone.status)} 마일스톤`);
  }

  return { score, reasons };
}

function scoreScheduleSection(sectionKey: CloudTaskSourceKey) {
  if (sectionKey === 'today') return { score: 36, label: 'Today' };
  if (sectionKey === 'deadlines') return { score: 28, label: 'Deadline' };
  return { score: 10, label: 'Backlog' };
}

function scoreDateSignal(value: string | null | undefined) {
  if (!value) return { score: 0, label: '' };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { score: 0, label: '' };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const dayDelta = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (dayDelta < 0) return { score: 30, label: '기한 지남' };
  if (dayDelta === 0) return { score: 34, label: '오늘 기한' };
  if (dayDelta <= 2) return { score: 24, label: `${dayDelta}일 내` };
  if (dayDelta <= 7) return { score: 12, label: '이번 주' };
  return { score: 2, label: '' };
}

function scoreMilestoneContext(milestone: CloudProjectMilestone) {
  let score = 0;
  if (milestone.status === 'active') score += 24;
  if (milestone.status === 'planned') score += 12;
  if (milestone.status === 'done') score += 2;
  if (milestone.status === 'archived') score -= 24;
  score += scoreDateSignal(milestone.target_date).score;
  return score;
}

function contentRelevanceScore(value: string): ContentRelevance {
  const haystack = value.toLowerCase();
  const matched = CONTENT_KEYWORDS.filter((keyword) => haystack.includes(keyword.toLowerCase()));
  const uniqueMatched = [...new Set(matched)];
  return {
    score: uniqueMatched.length * 24,
    matched: uniqueMatched
  };
}

function contentStageLabel(task: CloudTask, matched: string[]) {
  const haystack = `${task.title} ${taskDescription(task)}`.toLowerCase();
  if (task.status === 'doing') return '작성 중';
  if (task.status === 'done') return '완료 확인';
  if (haystack.includes('publish') || haystack.includes('발행')) return '발행 준비';
  if (haystack.includes('edit') || haystack.includes('수정')) return '편집';
  if (haystack.includes('research') || haystack.includes('리서치')) return '리서치';
  if (matched.length > 0) return '초안';
  return statusLabel(task.status);
}

function buildContentContextLabel(context: TaskContextCandidate, matched: string[]) {
  const parts = [
    context.contextLabel,
    matched.length > 0 ? `키워드 ${matched.slice(0, 2).join(', ')}` : '',
    context.project ? '프로젝트 연결됨' : '연결 필요'
  ].filter(Boolean);
  return parts.slice(0, 3).join(' · ');
}

function buildScoredObsidianLinks(
  links: CloudProjectLink[],
  projects: CloudProject[],
  milestones: CloudProjectMilestone[]
) {
  return links
    .filter((link) => link.kind === 'obsidian' && !link.archived_at)
    .map((link) => {
      const project = projects.find((candidate) => candidate.id === link.project_id) || null;
      const milestone = link.project_milestone_id
        ? milestones.find((candidate) => candidate.id === link.project_milestone_id) || null
        : null;
      const scored = scoreObsidianLinkContext(link, project, milestone);
      return { link, project, milestone, score: scored.score, contextLabel: scored.reasons.slice(0, 3).join(' · ') };
    })
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) return scoreDelta;
      return left.link.sort_order - right.link.sort_order;
    });
}

function scoreObsidianLinkContext(
  link: CloudProjectLink,
  project: CloudProject | null,
  milestone: CloudProjectMilestone | null
) {
  let score = 20;
  const reasons = ['Obsidian'];
  if (project) {
    score += 20;
    reasons.push(project.status === 'active' ? '활성 프로젝트' : statusLabelForProject(project.status));
    if (project.status === 'active') score += 20;
    if (project.status === 'paused') score -= 6;
    if (project.status === 'archived') score -= 24;
  }
  if (milestone) {
    score += 10 + scoreMilestoneContext(milestone);
    reasons.push(`${statusLabelForMilestone(milestone.status)} 마일스톤`);
  }
  score -= Math.max(link.sort_order, 0) / 1000;
  return { score, reasons };
}

function buildMobileCommandOverview(
  sections: TaskSection[],
  projects: CloudProject[],
  milestones: CloudProjectMilestone[],
  links: CloudProjectLink[]
): CommandOverviewModel {
  const taskContexts = buildTaskContextCandidates(sections, projects, milestones);
  const activeTaskContexts = taskContexts.filter((context) => context.task.status !== 'archived');
  const sortedActiveTaskContexts = activeTaskContexts.slice().sort(compareTaskContexts);
  const unlinkedTaskContexts = activeTaskContexts.filter((context) => !context.task.project_id && context.task.status !== 'done');
  const doingTaskContexts = sortedActiveTaskContexts.filter((context) => context.task.status === 'doing');
  const delayedTaskContexts = sortedActiveTaskContexts.filter((context) => context.task.status === 'delayed');
  const heldTaskContexts = sortedActiveTaskContexts.filter((context) => context.task.status === 'held');
  const dueSoonTaskContexts = sortedActiveTaskContexts.filter(isDueSoonTaskContext);
  const nextTaskContext = doingTaskContexts[0]
    || sortedActiveTaskContexts.find((context) => context.sectionKey === 'today' && context.task.status === 'todo')
    || sortedActiveTaskContexts.find((context) => context.sectionKey === 'deadlines' && context.task.status === 'todo')
    || sortedActiveTaskContexts.find((context) => context.sectionKey === 'backlog' && context.task.status === 'todo')
    || sortedActiveTaskContexts[0]
    || null;
  const doingTasks = doingTaskContexts
    .slice(0, 3)
    .map((context) => ({ id: context.task.id, title: context.task.title, projectName: context.project?.name || context.contextLabel }));
  const projectScores = new Map<number, number>();
  activeTaskContexts.forEach((context) => {
    if (!context.project) return;
    const existing = projectScores.get(context.project.id) || 0;
    projectScores.set(context.project.id, Math.max(existing, context.score));
  });
  const todayProjects = projects
    .filter((project) => projectScores.has(project.id))
    .sort((left, right) => {
      const scoreDelta = (projectScores.get(right.id) || 0) - (projectScores.get(left.id) || 0);
      if (scoreDelta !== 0) return scoreDelta;
      return compareProjectsForMode(left, right, 'manual');
    })
    .slice(0, 3)
    .map((project) => ({ id: project.id, name: project.name, northStar: project.north_star || project.current_horizon || '' }));
  const upcomingMilestones = milestones
    .filter((milestone) => milestone.status === 'active' || milestone.status === 'planned')
    .sort((left, right) => {
      const scoreDelta = scoreMilestoneContext(right) - scoreMilestoneContext(left);
      if (scoreDelta !== 0) return scoreDelta;
      return left.sort_order - right.sort_order;
    })
    .slice(0, 3)
    .map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      status: milestone.status,
      projectName: projects.find((project) => project.id === milestone.project_id)?.name || ''
    }));
  const obsidianLinks = buildScoredObsidianLinks(links, projects, milestones)
    .slice(0, 3)
    .map(({ link }) => ({ id: link.id, title: link.title, target: link.target }));
  const review = buildFocusReviewCards({
    nextTaskContext,
    dueSoonContext: dueSoonTaskContexts[0] || null,
    delayedContext: delayedTaskContexts[0] || null,
    heldContext: heldTaskContexts[0] || null,
    doingContext: doingTaskContexts[0] || null,
    unlinkedContext: unlinkedTaskContexts.slice().sort(compareTaskContexts)[0] || null,
    doingTaskCount: doingTaskContexts.length,
    delayedTaskCount: delayedTaskContexts.length
  });

  return {
    counts: {
      activeTasks: activeTaskContexts.length,
      doingTasks: doingTasks.length,
      todayProjects: todayProjects.length,
      upcomingMilestones: upcomingMilestones.length,
      obsidianLinks: obsidianLinks.length
    },
    nextTask: nextTaskContext ? {
      id: nextTaskContext.task.id,
      title: nextTaskContext.task.title,
      sourceKey: nextTaskContext.sectionKey,
      projectName: nextTaskContext.project?.name || nextTaskContext.contextLabel
    } : null,
    actions: {
      canStartNextTask: Boolean(nextTaskContext && nextTaskContext.task.status !== 'doing'),
      canCompleteCurrentTask: doingTasks.length > 0,
      canCreateNextAction: todayProjects.length > 0 || projects.length > 0,
      canOpenObsidian: obsidianLinks.length > 0
    },
    doingTasks,
    todayProjects,
    upcomingMilestones,
    obsidianLinks,
    review
  };
}

function buildFocusReviewCards(input: {
  nextTaskContext: TaskContextCandidate | null;
  dueSoonContext: TaskContextCandidate | null;
  delayedContext: TaskContextCandidate | null;
  heldContext: TaskContextCandidate | null;
  doingContext: TaskContextCandidate | null;
  unlinkedContext: TaskContextCandidate | null;
  doingTaskCount: number;
  delayedTaskCount: number;
}) {
  const nextTask = input.nextTaskContext;
  const dueTask = input.dueSoonContext;
  const blockerTask = input.delayedContext || input.heldContext;
  const doingTask = input.doingContext;
  const unlinkedTask = input.unlinkedContext;
  const start: ReviewCardModel[] = [
    {
      id: 'start-next',
      label: 'Next',
      title: nextTask?.task.title || 'No next task selected',
      detail: nextTask ? reviewContextDetail(nextTask) || 'Ready to start' : 'Add or promote a task in Schedule',
      actionLabel: 'Schedule',
      target: 'schedule',
      sourceKey: nextTask?.sectionKey || 'today'
    }
  ];
  if (dueTask) {
    start.push({
      id: 'start-due',
      label: 'Due soon',
      title: dueTask.task.title,
      detail: reviewContextDetail(dueTask),
      actionLabel: 'Review',
      target: 'schedule',
      sourceKey: dueTask.sectionKey
    });
  }
  start.push(
    {
      id: 'start-blockers',
      label: 'Held / delayed',
      title: blockerTask?.task.title || 'No held or delayed task',
      detail: blockerTask ? 'Decide whether to resume, keep held, or defer.' : 'No recovery decision needed right now.',
      actionLabel: blockerTask ? 'Board' : 'Schedule',
      target: 'schedule',
      sourceKey: blockerTask?.sectionKey || 'today'
    }
  );
  const close: ReviewCardModel[] = [
    {
      id: 'close-current',
      label: 'Current',
      title: doingTask?.task.title || 'No active doing task',
      detail: doingTask ? 'Complete, hold, or delay before ending the day.' : 'Nothing is marked as in progress.',
      actionLabel: 'Review',
      target: 'schedule',
      sourceKey: doingTask?.sectionKey || 'today'
    },
    {
      id: 'close-done',
      label: 'Carry-over',
      title: `${input.doingTaskCount} doing · ${input.delayedTaskCount} delayed`,
      detail: 'Clear what should remain active tomorrow.',
      actionLabel: 'Board',
      target: 'schedule',
      sourceKey: 'today'
    },
    {
      id: 'close-links',
      label: 'Context',
      title: unlinkedTask?.task.title || 'No unlinked task sample',
      detail: unlinkedTask ? 'Attach project or milestone context while it is fresh.' : 'Task graph looks clean enough.',
      actionLabel: unlinkedTask ? 'Projects' : 'Schedule',
      target: unlinkedTask ? 'projects' : 'schedule',
      sourceKey: unlinkedTask?.sectionKey || 'today'
    }
  ];
  return { start, close };
}

function isDueSoonTaskContext(context: TaskContextCandidate) {
  if (context.task.status === 'archived') return false;
  const raw = context.task.due_at || (context.sectionKey === 'deadlines' ? context.task.scheduled_for : null);
  if (!raw) return false;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const dayDelta = Math.round((target.getTime() - today.getTime()) / 86400000);
  return dayDelta <= 2;
}

function reviewContextDetail(context: TaskContextCandidate) {
  return [labelForKey(context.sectionKey), context.project?.name || '', statusLabel(context.task.status)]
    .filter(Boolean)
    .join(' · ');
}

function buildObsidianHub(
  links: CloudProjectLink[],
  projects: CloudProject[],
  milestones: CloudProjectMilestone[]
): ObsidianHubModel {
  const obsidianLinks = buildScoredObsidianLinks(links, projects, milestones)
    .map(({ link, project, milestone, score, contextLabel }) => ({
      id: link.id,
      projectId: link.project_id,
      title: link.title,
      target: link.target,
      projectName: project?.name || '',
      milestoneTitle: milestone?.title || '',
      contextLabel,
      score
    }));
  const groups = projects
    .map((project) => {
      const groupLinks = obsidianLinks.filter((link) => link.projectName === project.name);
      return {
      projectId: project.id,
      projectName: project.name,
        links: groupLinks
      };
    })
    .filter((group) => group.links.length > 0);
  groups.sort((left, right) => {
    const leftScore = Math.max(...left.links.map((link) => link.score));
    const rightScore = Math.max(...right.links.map((link) => link.score));
    return rightScore - leftScore;
  });

  return {
    recent: obsidianLinks.slice(0, 3),
    groups,
    total: obsidianLinks.length
  };
}

function buildContentQueue(sections: TaskSection[], projects: CloudProject[], milestones: CloudProjectMilestone[]): ContentQueueModel {
  const items = buildTaskContextCandidates(sections, projects, milestones)
    .filter((context) => context.task.status !== 'archived')
    .map((context) => {
      const detail = taskDescription(context.task);
      const relevance = contentRelevanceScore(`${context.task.title} ${detail} ${context.project?.name || ''} ${context.milestone?.title || ''}`);
      return {
        context,
        relevance,
        item: {
          id: context.task.id,
          title: context.task.title,
          detail,
          status: context.task.status,
          sourceKey: context.sectionKey,
          projectId: context.project?.id ?? null,
          projectName: context.project?.name || '',
          milestoneName: context.milestone?.title || '',
          stageLabel: contentStageLabel(context.task, relevance.matched),
          contextLabel: buildContentContextLabel(context, relevance.matched),
          score: context.score + relevance.score
        }
      };
    })
    .filter(({ relevance }) => relevance.score > 0)
    .sort((left, right) => {
      const scoreDelta = right.item.score - left.item.score;
      if (scoreDelta !== 0) return scoreDelta;
      return left.context.task.sort_order - right.context.task.sort_order;
    })
    .map(({ item }) => item);

  return {
    items: items.slice(0, 12),
    counts: {
      total: items.length,
      doing: items.filter((item) => item.status === 'doing').length,
      linked: items.filter((item) => item.projectId).length,
      today: items.filter((item) => item.sourceKey === 'today').length,
      unlinked: items.filter((item) => !item.projectId).length
    }
  };
}

function labelForLinkKind(kind: CloudProjectLinkKind) {
  if (kind === 'github') return 'GitHub';
  if (kind === 'url') return 'URL';
  if (kind === 'file') return '파일';
  return 'Obsidian';
}

function normalizedOpenTarget(link: CloudProjectLink) {
  const target = link.target.trim();
  if (!target || link.kind === 'file') return '';
  if (link.kind === 'github' || link.kind === 'url') {
    return normalizedWebTarget(target);
  }
  return target;
}

function normalizedWebTarget(value: string | null | undefined) {
  const target = String(value || '').trim();
  if (!target) return '';
  return /^https?:\/\//i.test(target) ? target : `https://${target}`;
}

type BoardCardProperty = {
  icon: FeatherIconName;
  label: string;
  value: string;
  tone?: string;
  strong?: boolean;
};

function boardCardProperties(
  task: CloudTask,
  sectionKey: CloudTaskSourceKey,
  index: number,
  projectName: string,
  milestoneName: string
): BoardCardProperty[] {
  const dueText = task.due_at ? formatTaskDate(task.due_at) : '';
  const projectText = [projectName, milestoneName].filter(Boolean).join(' / ');
  const properties: BoardCardProperty[] = [
    {
      icon: 'folder',
      label: '카테고리',
      value: labelForKey(sectionKey),
      tone: sourceTone(sectionKey),
      strong: true
    },
    {
      icon: 'chevrons-up',
      label: '우선순위',
      value: `#${index + 1}`,
      tone: PALETTE.camel,
      strong: true
    },
    {
      icon: 'activity',
      label: '진행 상황',
      value: taskProgressLabel(task),
      tone: statusTone(task.status),
      strong: task.status === 'done'
    }
  ];

  if (dueText) {
    properties.splice(1, 0, {
      icon: 'calendar',
      label: '마감',
      value: dueText,
      tone: PALETTE.danger,
      strong: sectionKey === 'deadlines'
    });
  }

  properties.push({
    icon: 'git-branch',
    label: '프로젝트',
    value: projectText || '비어 있음',
    tone: projectText ? PALETTE.ocean : PALETTE.boardMuted,
    strong: Boolean(projectText)
  });

  return properties;
}

function taskProgressLabel(task: CloudTask) {
  if (task.status === 'done') return '100%';
  return '0%';
}

function sourceTone(sectionKey: CloudTaskSourceKey) {
  if (sectionKey === 'deadlines') return PALETTE.danger;
  if (sectionKey === 'backlog') return PALETTE.camel;
  return PALETTE.ocean;
}

function statusTone(status: CloudTask['status']) {
  if (status === 'doing') return '#4DA3D9';
  if (status === 'done') return '#62B783';
  if (status === 'held') return PALETTE.camel;
  if (status === 'delayed') return PALETTE.danger;
  return PALETTE.boardMuted;
}

function statusButtonStyle(status: CloudTask['status']) {
  if (status === 'doing') return styles.statusButtonDoing;
  if (status === 'done') return styles.statusButtonDone;
  if (status === 'held') return styles.statusButtonHeld;
  if (status === 'delayed') return styles.statusButtonDelayed;
  return null;
}

function statusDotStyle(status: CloudTask['status']) {
  if (status === 'doing') return styles.statusDotDoing;
  if (status === 'done') return styles.statusDotDone;
  if (status === 'held') return styles.statusDotHeld;
  if (status === 'delayed') return styles.statusDotDelayed;
  return null;
}

function labelForKey(key: CloudTaskSourceKey) {
  if (key === 'deadlines') return 'Deadlines';
  if (key === 'backlog') return 'Backlog';
  return 'Today';
}

function labelForDomain(key: CommandDomainKey) {
  if (key === 'content') return '콘텐츠';
  if (key === 'command') return '커맨드';
  if (key === 'projects') return '프로젝트';
  if (key === 'obsidian') return '옵시디언';
  return '스케쥴';
}

function iconForDomain(key: CommandDomainKey): FeatherIconName {
  if (key === 'content') return 'file-text';
  if (key === 'command') return 'grid';
  if (key === 'projects') return 'folder';
  if (key === 'obsidian') return 'book-open';
  return 'calendar';
}

function placeholderTextForDomain(key: CommandDomainKey) {
  if (key === 'content') return '콘텐츠 허브는 다음 마일스톤에서 연결합니다.';
  if (key === 'command') return '오늘의 운영 맥락을 요약합니다.';
  if (key === 'projects') return '프로젝트 로드맵과 next action을 관리합니다.';
  if (key === 'obsidian') return 'Obsidian 연결은 cloud schedule 안정화 후 붙입니다.';
  return '';
}

function projectNameForTask(task: CloudTask, projects: CloudProject[]) {
  if (!task.project_id) return '';
  return projects.find((project) => project.id === task.project_id)?.name || '';
}

function moveActionLabelForKey(key: CloudTaskSourceKey) {
  if (key === 'today') return 'Today로 이동';
  if (key === 'deadlines') return '데드라인으로 이동';
  return '백로그로 이동';
}

function milestoneNameForTask(task: CloudTask, milestones: CloudProjectMilestone[]) {
  if (!task.project_milestone_id) return '';
  return milestones.find((milestone) => milestone.id === task.project_milestone_id)?.title || '';
}

function taskMetaText(task: CloudTask, sectionKey: CloudTaskSourceKey) {
  if (sectionKey === 'deadlines' && task.due_at) return formatTaskDate(task.due_at);
  return '';
}

function formatTaskDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}-${day}`;
}

function taskDescription(task: CloudTask | null) {
  if (!task?.detail) return '';
  const value = task.detail.trim();
  if (!value) return '';
  if (value.startsWith('{')) {
    try {
      JSON.parse(value);
      return '';
    } catch {
      return '';
    }
  }
  return value;
}

function normalizeNullableText(value: string | null | undefined) {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function getBottomNavBottomPadding(bottomInset: number) {
  return Math.max(bottomInset + BOTTOM_NAV_BOTTOM_GAP, BOTTOM_NAV_BOTTOM_GAP);
}

function getBottomNavHeight(bottomInset: number) {
  return BOTTOM_NAV_TOP_PADDING + BOTTOM_NAV_ITEM_HEIGHT + getBottomNavBottomPadding(bottomInset);
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: PALETTE.floralWhite
  },
  content: {
    gap: 18,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 36
  },
  centerPane: {
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    padding: 24
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    paddingTop: 4
  },
  headerCopy: {
    flex: 1
  },
  headerActions: {
    alignItems: 'stretch',
    gap: 8,
    minWidth: 86
  },
  headerButton: {
    alignItems: 'center',
    backgroundColor: PALETTE.champagneMist,
    borderColor: PALETTE.paleOak,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 34,
    paddingHorizontal: 10
  },
  headerButtonText: {
    color: PALETTE.carbon,
    fontFamily: TYPEFACE,
    fontSize: 12,
    fontWeight: '800'
  },
  eyebrow: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 13,
    fontWeight: '700'
  },
  title: {
    color: PALETTE.carbonDeep,
    fontFamily: TYPEFACE,
    fontSize: 28,
    fontWeight: '800',
    marginTop: 4
  },
  accountText: {
    color: PALETTE.graphite,
    fontFamily: TYPEFACE,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
    flexShrink: 1
  },
  authPane: {
    gap: 14,
    paddingTop: 16
  },
  authTitle: {
    color: PALETTE.carbonDeep,
    fontFamily: TYPEFACE,
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 27
  },
  muted: {
    color: PALETTE.graphite,
    fontFamily: TYPEFACE,
    fontSize: 14,
    lineHeight: 20
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: PALETTE.camel,
    borderRadius: RADIUS.md,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 16
  },
  primaryButtonText: {
    color: PALETTE.white,
    fontFamily: TYPEFACE,
    fontSize: 16,
    fontWeight: '700'
  },
  sectionStack: {
    gap: 12
  },
  cockpit: {
    gap: 10
  },
  overviewCard: {
    backgroundColor: PALETTE.white,
    borderColor: PALETTE.paleOak,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: 10,
    padding: 12
  },
  overviewHeader: {
    alignItems: 'flex-start',
    gap: 8
  },
  overviewSubcopy: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2
  },
  overviewEyebrow: {
    color: PALETTE.carbonDeep,
    fontFamily: TYPEFACE,
    fontSize: 18,
    fontWeight: '800'
  },
  overviewStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6
  },
  overviewStat: {
    backgroundColor: PALETTE.ocean,
    borderRadius: RADIUS.sm,
    color: PALETTE.white,
    fontFamily: TYPEFACE,
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  overviewRows: {
    gap: 8
  },
  reviewPanel: {
    backgroundColor: PALETTE.white,
    borderColor: PALETTE.paleOak,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: 10,
    padding: 10
  },
  reviewColumn: {
    gap: 8
  },
  reviewCard: {
    alignItems: 'center',
    backgroundColor: PALETTE.champagneMist,
    borderColor: PALETTE.paleOak,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 64,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  reviewActionText: {
    color: PALETTE.carbonDeep,
    fontFamily: TYPEFACE,
    fontSize: 11,
    fontWeight: '900'
  },
  cockpitFocus: {
    backgroundColor: PALETTE.white,
    borderColor: PALETTE.paleOak,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: 6,
    padding: 12
  },
  cockpitFocusLabel: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 11,
    fontWeight: '900'
  },
  cockpitFocusTitle: {
    color: PALETTE.carbonDeep,
    fontFamily: TYPEFACE,
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 24
  },
  cockpitFocusMeta: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 12,
    fontWeight: '700'
  },
  nextActionBox: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8
  },
  overviewRow: {
    alignItems: 'center',
    backgroundColor: PALETTE.champagneMist,
    borderColor: PALETTE.paleOak,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  overviewRowLabel: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    flexBasis: 68,
    fontSize: 11,
    fontWeight: '800'
  },
  overviewRowCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0
  },
  overviewRowTitle: {
    color: PALETTE.carbonDeep,
    fontFamily: TYPEFACE,
    fontSize: 14,
    fontWeight: '800'
  },
  overviewRowDetail: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 11,
    fontWeight: '600'
  },
  segmentBar: {
    alignItems: 'center',
    backgroundColor: PALETTE.champagneMist,
    borderColor: PALETTE.paleOak,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    padding: 6
  },
  segmentItem: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 7
  },
  segmentItemActive: {
    backgroundColor: PALETTE.camel
  },
  segmentLabel: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16
  },
  segmentLabelActive: {
    color: PALETTE.white
  },
  segmentCount: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16
  },
  segmentCountActive: {
    color: PALETTE.white
  },
  viewSwitch: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: PALETTE.champagneMist,
    borderColor: PALETTE.paleOak,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    padding: 5
  },
  viewSwitchItem: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 8
  },
  viewSwitchItemActive: {
    backgroundColor: PALETTE.camel
  },
  viewSwitchText: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 16
  },
  viewSwitchTextActive: {
    color: PALETTE.white
  },
  section: {
    backgroundColor: PALETTE.white,
    borderColor: PALETTE.paleOak,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 12
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 0
  },
  sectionTitle: {
    color: PALETTE.carbonDeep,
    fontFamily: TYPEFACE,
    fontSize: 22,
    fontWeight: '800'
  },
  count: {
    backgroundColor: PALETTE.ocean,
    borderRadius: RADIUS.sm,
    color: PALETTE.carbonDeep,
    fontFamily: TYPEFACE,
    fontSize: 13,
    fontWeight: '800',
    minWidth: 34,
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 4,
    textAlign: 'center'
  },
  boardSection: {
    backgroundColor: PALETTE.floralWhite,
    borderColor: PALETTE.boardLine,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: 12,
    paddingHorizontal: 10,
    paddingTop: 14,
    paddingBottom: 10
  },
  boardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between'
  },
  boardHeaderCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0
  },
  boardSubtitle: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17
  },
  boardColumnRail: {
    flexDirection: 'row',
    gap: 6
  },
  boardColumnRailItem: {
    alignItems: 'center',
    backgroundColor: PALETTE.champagneMist,
    borderColor: PALETTE.boardLine,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 34,
    paddingHorizontal: 6
  },
  boardColumnRailItemActive: {
    backgroundColor: PALETTE.boardDoing,
    borderColor: PALETTE.ocean
  },
  boardColumnRailItemDropTarget: {
    backgroundColor: PALETTE.boardHeld,
    borderColor: PALETTE.camel
  },
  boardColumnRailText: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 15
  },
  boardColumnRailCount: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 15
  },
  boardColumnRailTextActive: {
    color: PALETTE.carbonDeep
  },
  boardToast: {
    alignItems: 'center',
    backgroundColor: PALETTE.champagneMist,
    borderColor: PALETTE.camel,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 9,
    paddingVertical: 8
  },
  boardToastError: {
    borderColor: PALETTE.danger
  },
  boardToastCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0
  },
  boardToastTitle: {
    color: PALETTE.carbonDeep,
    fontFamily: TYPEFACE,
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 14
  },
  boardToastMessage: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 15
  },
  boardToastButton: {
    backgroundColor: PALETTE.camel,
    borderRadius: RADIUS.md,
    minHeight: 30,
    justifyContent: 'center',
    paddingHorizontal: 9
  },
  boardToastButtonText: {
    color: PALETTE.white,
    fontFamily: TYPEFACE,
    fontSize: 11,
    fontWeight: '900'
  },
  boardToastClose: {
    alignItems: 'center',
    height: 30,
    justifyContent: 'center',
    width: 30
  },
  boardColumnFocused: {
    backgroundColor: PALETTE.champagneMist,
    borderColor: PALETTE.boardLine,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: 8,
    minHeight: 260,
    padding: 9
  },
  boardColumnHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    minHeight: 32
  },
  boardColumnCopy: {
    flex: 1,
    gap: 1,
    minWidth: 0
  },
  boardColumnTitle: {
    color: PALETTE.carbonDeep,
    fontFamily: TYPEFACE,
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 18
  },
  boardColumnPressure: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 13
  },
  boardColumnCount: {
    backgroundColor: PALETTE.floralWhite,
    borderRadius: RADIUS.sm,
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 12,
    fontWeight: '900',
    minWidth: 30,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4,
    textAlign: 'center'
  },
  boardColumnCountHigh: {
    backgroundColor: PALETTE.camel,
    color: PALETTE.white
  },
  boardCards: {
    gap: 8
  },
  boardEmpty: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 12,
    fontWeight: '700',
    paddingVertical: 8,
    textAlign: 'center'
  },
  boardDragHandle: {
    alignItems: 'center',
    backgroundColor: PALETTE.floralWhite,
    borderColor: PALETTE.boardLine,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    width: 30
  },
  boardDragHint: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 10,
    fontWeight: '900',
    lineHeight: 13
  },
  boardCard: {
    backgroundColor: PALETTE.boardTodo,
    borderColor: PALETTE.boardLine,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: 6,
    minHeight: 154,
    padding: 9
  },
  boardCardDragging: {
    borderColor: PALETTE.camel,
    elevation: 3,
    opacity: 0.93,
    shadowColor: PALETTE.carbonDeep,
    shadowOpacity: 0.12,
    shadowRadius: 8,
    zIndex: 5
  },
  boardCardDropTarget: {
    borderTopColor: PALETTE.camel,
    borderTopWidth: 3
  },
  boardCardDone: {
    backgroundColor: PALETTE.boardDone,
    opacity: 0.82
  },
  boardCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'space-between'
  },
  boardCardSource: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    flex: 1,
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 15
  },
  boardCardStatus: {
    color: PALETTE.carbonDeep,
    fontFamily: TYPEFACE,
    fontSize: 10,
    fontWeight: '900',
    lineHeight: 14
  },
  boardCardStatusPill: {
    alignItems: 'center',
    backgroundColor: PALETTE.champagneMist,
    borderColor: PALETTE.boardLine,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    minHeight: 24,
    paddingHorizontal: 6
  },
  boardCardStatusDot: {
    height: 9,
    width: 9
  },
  boardStatusIconButton: {
    alignItems: 'center',
    backgroundColor: PALETTE.camel,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'center',
    minHeight: 30,
    minWidth: 64,
    paddingHorizontal: 8
  },
  boardArchiveIconButton: {
    alignItems: 'center',
    backgroundColor: PALETTE.champagneMist,
    borderColor: PALETTE.boardLine,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    width: 34
  },
  boardStatusIconText: {
    color: PALETTE.white,
    fontFamily: TYPEFACE,
    fontSize: 10,
    fontWeight: '900',
    lineHeight: 13
  },
  boardCardTitle: {
    color: PALETTE.carbonDeep,
    fontFamily: TYPEFACE,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 19
  },
  boardCardDetail: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 15
  },
  boardCardMeta: {
    color: PALETTE.graphite,
    fontFamily: TYPEFACE,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 14
  },
  boardCardProject: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 10,
    fontWeight: '900',
    lineHeight: 14
  },
  boardPropertyGrid: {
    borderTopColor: PALETTE.boardLine,
    borderTopWidth: 1,
    gap: 8,
    marginTop: 3,
    paddingTop: 8
  },
  boardPropertyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    minHeight: 22
  },
  boardPropertyLabel: {
    color: PALETTE.boardMuted,
    fontFamily: TYPEFACE,
    fontSize: 11,
    fontWeight: '800',
    minWidth: 62
  },
  boardPropertyValue: {
    color: PALETTE.toffee,
    flex: 1,
    fontFamily: TYPEFACE,
    fontSize: 12,
    fontWeight: '700'
  },
  boardPropertyValueStrong: {
    color: PALETTE.carbonDeep,
    fontWeight: '900'
  },
  placeholderHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 86
  },
  placeholderIcon: {
    alignItems: 'center',
    backgroundColor: PALETTE.camel,
    borderRadius: RADIUS.lg,
    height: 46,
    justifyContent: 'center',
    width: 46
  },
  placeholderCopy: {
    flex: 1,
    gap: 4
  },
  placeholderText: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19
  },
  projectList: {
    gap: 8,
    marginBottom: 12
  },
  projectOpsBar: {
    gap: 8
  },
  projectRow: {
    backgroundColor: PALETTE.white,
    borderColor: PALETTE.paleOak,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  projectRowActive: {
    borderColor: PALETTE.camel
  },
  projectRowTitle: {
    color: PALETTE.carbonDeep,
    fontFamily: TYPEFACE,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20
  },
  projectRowMeta: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17
  },
  projectDetail: {
    gap: 10,
    paddingTop: 6
  },
  projectDetailHeader: {
    gap: 8
  },
  projectStatusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  projectPicker: {
    gap: 8
  },
  projectPickerOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  projectPill: {
    alignItems: 'center',
    backgroundColor: PALETTE.white,
    borderColor: PALETTE.paleOak,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 34,
    paddingHorizontal: 10
  },
  projectPillActive: {
    backgroundColor: PALETTE.camel,
    borderColor: PALETTE.camel
  },
  projectPillText: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16
  },
  projectPillTextActive: {
    color: PALETTE.white
  },
  projectTaskBox: {
    gap: 8
  },
  projectMaintenanceBox: {
    backgroundColor: PALETTE.white,
    borderColor: PALETTE.paleOak,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: 8,
    padding: 10
  },
  milestoneList: {
    gap: 8
  },
  milestoneRow: {
    backgroundColor: PALETTE.white,
    borderColor: PALETTE.paleOak,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  milestoneRowHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between'
  },
  linkTitleButton: {
    flex: 1
  },
  milestoneEditor: {
    backgroundColor: PALETTE.white,
    borderColor: PALETTE.paleOak,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: 8,
    padding: 10
  },
  projectLinkedTasks: {
    gap: 8
  },
  projectLinkedSection: {
    backgroundColor: PALETTE.white,
    borderColor: PALETTE.paleOak,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: 4,
    padding: 10
  },
  projectLinkedTitle: {
    color: PALETTE.carbonDeep,
    fontFamily: TYPEFACE,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16
  },
  projectLinkedEmpty: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17
  },
  projectLinkEdit: {
    gap: 8
  },
  projectLinkedTask: {
    color: PALETTE.graphite,
    fontFamily: TYPEFACE,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17
  },
  empty: {
    color: PALETTE.graphite,
    fontFamily: TYPEFACE,
    fontSize: 14,
    paddingBottom: 12
  },
  addRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 2
  },
  inlineAttachPanel: {
    backgroundColor: PALETTE.champagneMist,
    borderColor: PALETTE.paleOak,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: 8,
    marginBottom: 8,
    padding: 10
  },
  maintenancePanel: {
    backgroundColor: PALETTE.white,
    borderColor: PALETTE.paleOak,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: 8,
    marginBottom: 8,
    padding: 10
  },
  maintenanceRow: {
    backgroundColor: PALETTE.champagneMist,
    borderColor: PALETTE.paleOak,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    gap: 4,
    minHeight: 52,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  input: {
    backgroundColor: PALETTE.white,
    borderColor: PALETTE.paleOak,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    color: PALETTE.carbonDeep,
    flex: 1,
    fontFamily: TYPEFACE,
    fontSize: 15,
    minHeight: 46,
    paddingHorizontal: 12
  },
  smallButton: {
    alignItems: 'center',
    backgroundColor: PALETTE.camel,
    borderRadius: RADIUS.md,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14
  },
  smallButtonDisabled: {
    backgroundColor: PALETTE.paleOak,
    opacity: 0.65
  },
  smallButtonText: {
    color: PALETTE.white,
    fontFamily: TYPEFACE,
    fontSize: 13,
    fontWeight: '800'
  },
  disabledButtonText: {
    color: PALETTE.toffee
  },
  taskRow: {
    borderTopColor: PALETTE.paleOak,
    borderTopWidth: 1,
    gap: 4,
    paddingVertical: 11
  },
  taskRowDone: {
    opacity: 0.68
  },
  taskRowGrabbed: {
    backgroundColor: PALETTE.white,
    borderColor: PALETTE.camel,
    borderRadius: RADIUS.lg,
    borderTopColor: PALETTE.camel,
    borderWidth: 1,
    marginTop: 6,
    paddingHorizontal: 10
  },
  taskRowPressed: {
    opacity: 0.68
  },
  taskTopRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 8
  },
  taskCopy: {
    flex: 1,
    gap: 3
  },
  statusButton: {
    alignItems: 'center',
    backgroundColor: PALETTE.white,
    borderColor: PALETTE.paleOak,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'center',
    minHeight: 30,
    minWidth: 50,
    paddingHorizontal: 6
  },
  statusButtonDoing: {
    backgroundColor: PALETTE.champagneMist,
    borderColor: PALETTE.camel
  },
  statusButtonDone: {
    backgroundColor: PALETTE.floralWhite,
    borderColor: PALETTE.camel
  },
  statusButtonHeld: {
    backgroundColor: PALETTE.boardHeld,
    borderColor: PALETTE.camel
  },
  statusButtonDelayed: {
    backgroundColor: PALETTE.boardDelayed,
    borderColor: PALETTE.danger
  },
  statusDot: {
    backgroundColor: 'transparent',
    borderColor: PALETTE.toffee,
    borderRadius: RADIUS.sm,
    borderWidth: 2,
    height: 13,
    width: 13
  },
  statusDotDoing: {
    backgroundColor: PALETTE.camel,
    borderColor: PALETTE.camel
  },
  statusDotDone: {
    backgroundColor: PALETTE.ocean,
    borderColor: PALETTE.ocean
  },
  statusDotHeld: {
    backgroundColor: PALETTE.camel,
    borderColor: PALETTE.camel
  },
  statusDotDelayed: {
    backgroundColor: PALETTE.danger,
    borderColor: PALETTE.danger
  },
  statusButtonText: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 10,
    fontWeight: '800'
  },
  statusButtonTextDone: {
    color: PALETTE.carbonDeep
  },
  taskTitle: {
    color: PALETTE.carbonDeep,
    fontFamily: TYPEFACE,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21
  },
  taskDescription: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17
  },
  taskTitleDone: {
    color: PALETTE.toffee,
    textDecorationLine: 'line-through'
  },
  taskMeta: {
    color: PALETTE.graphite,
    fontFamily: TYPEFACE,
    fontSize: 11,
    lineHeight: 16,
    paddingLeft: 58
  },
  taskProjectMeta: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 16,
    paddingLeft: 58
  },
  grabPanel: {
    gap: 8,
    paddingLeft: 58,
    paddingTop: 8
  },
  grabHint: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 12,
    fontWeight: '800'
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  actionButton: {
    alignItems: 'center',
    backgroundColor: PALETTE.champagneMist,
    borderColor: PALETTE.paleOak,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexBasis: '48%',
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 10
  },
  actionButtonPrimary: {
    backgroundColor: PALETTE.camel,
    borderColor: PALETTE.camel
  },
  actionButtonDisabled: {
    backgroundColor: PALETTE.paleOak,
    borderColor: PALETTE.paleOak,
    opacity: 0.65
  },
  ghostButtonText: {
    color: PALETTE.carbon,
    fontFamily: TYPEFACE,
    fontSize: 12,
    fontWeight: '700'
  },
  actionButtonDanger: {
    backgroundColor: PALETTE.white,
    borderColor: 'rgba(180, 35, 24, 0.28)',
    flexBasis: '100%'
  },
  dangerButtonText: {
    color: PALETTE.danger,
    fontFamily: TYPEFACE,
    fontSize: 12,
    fontWeight: '800'
  },
  sheetRoot: {
    flex: 1,
    justifyContent: 'flex-end'
  },
  sheetBackdrop: {
    backgroundColor: 'rgba(15, 23, 42, 0.38)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0
  },
  sheet: {
    backgroundColor: PALETTE.white,
    borderColor: PALETTE.paleOak,
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
    borderWidth: 1,
    gap: 12,
    maxHeight: '86%',
    paddingBottom: 18,
    paddingHorizontal: 18,
    paddingTop: 10
  },
  sheetHandle: {
    alignSelf: 'center',
    backgroundColor: PALETTE.paleOak,
    borderRadius: RADIUS.sm,
    height: 4,
    width: 46
  },
  sheetHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between'
  },
  sheetHeaderCopy: {
    flex: 1
  },
  sheetTitle: {
    color: PALETTE.carbonDeep,
    fontFamily: TYPEFACE,
    fontSize: 22,
    fontWeight: '800',
    marginTop: 2
  },
  sheetStatusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    marginTop: -2
  },
  sheetStatusText: {
    color: PALETTE.carbon,
    fontFamily: TYPEFACE,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18
  },
  sheetMetaText: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18
  },
  sheetInput: {
    minHeight: 96,
    paddingTop: 12,
    textAlignVertical: 'top'
  },
  sheetDetailInput: {
    minHeight: 74,
    paddingTop: 12
  },
  sheetConnectPanel: {
    backgroundColor: PALETTE.champagneMist,
    borderColor: PALETTE.paleOak,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    gap: 10,
    padding: 10
  },
  sheetEmptyConnectBox: {
    gap: 8
  },
  sheetDivider: {
    backgroundColor: PALETTE.paleOak,
    height: 1,
    opacity: 0.8
  },
  sheetActionStack: {
    gap: 8
  },
  sheetMoveGrid: {
    flexDirection: 'row',
    gap: 8
  },
  sheetDangerButton: {
    flexBasis: 'auto',
    flexGrow: 0,
    marginTop: 2
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10
  },
  error: {
    color: PALETTE.danger,
    fontFamily: TYPEFACE,
    fontSize: 14,
    lineHeight: 20
  },
  bottomNav: {
    alignItems: 'center',
    backgroundColor: PALETTE.white,
    borderTopColor: PALETTE.paleOak,
    borderTopWidth: 1,
    bottom: 0,
    flexDirection: 'row',
    gap: 2,
    justifyContent: 'space-between',
    left: 0,
    paddingHorizontal: 8,
    paddingTop: BOTTOM_NAV_TOP_PADDING,
    position: 'absolute',
    right: 0
  },
  bottomNavItem: {
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    flex: 1,
    gap: 2,
    justifyContent: 'center',
    minHeight: BOTTOM_NAV_ITEM_HEIGHT,
    paddingHorizontal: 2
  },
  bottomNavItemActive: {
    backgroundColor: PALETTE.champagneMist
  },
  bottomNavLabel: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 14,
    textAlign: 'center'
  },
  bottomNavLabelActive: {
    color: PALETTE.ocean
  },
  bottomNavCount: {
    color: PALETTE.toffee,
    fontFamily: TYPEFACE,
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 15
  },
  bottomNavCountActive: {
    color: PALETTE.ocean
  }
});
