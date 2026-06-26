import { useEffect, useCallback, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  ChevronLeftIcon,
  ComputerDesktopIcon,
} from "@heroicons/react/24/outline";
import type {
  AbortMessage,
  ChatImageAttachment,
  ChatRequest,
  ChatMessage,
  PermissionMode,
  AssistantHomeData,
  AssistantDeliverableCard,
  AssistantTaskCard,
} from "../types";
import { useClaudeStreaming } from "../hooks/useClaudeStreaming";
import { useChatState } from "../hooks/chat/useChatState";
import { usePermissions } from "../hooks/chat/usePermissions";
import { usePermissionMode } from "../hooks/chat/usePermissionMode";
import { useAbortController } from "../hooks/chat/useAbortController";
import { useAutoHistoryLoader } from "../hooks/useHistoryLoader";
import { useSettings } from "../hooks/useSettings";
import { SettingsButton } from "./SettingsButton";
import { SettingsModal } from "./SettingsModal";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { ChatInput } from "./chat/ChatInput";
import { ChatMessages } from "./chat/ChatMessages";
import {
  AssistantWorkbenchDock,
  type WorkbenchTab,
} from "./chat/AssistantWorkbenchDock";
import { HistoryView } from "./HistoryView";
import { Sidebar } from "./layout/Sidebar";
import {
  getAssistantHomeUrl,
  getChatUrl,
  getAuthHeaders,
  getSkillsUrl,
} from "../config/api";
import { AssistantHomePanel } from "./assistant/AssistantHomePanel";
import { KEYBOARD_SHORTCUTS } from "../utils/constants";
import { normalizeWindowsPath } from "../utils/pathUtils";
import type { StreamingContext } from "../hooks/streaming/useMessageProcessor";
import { useAuth } from "../contexts/AuthContext";
import {
  getNetworkErrorMessage,
  parseApiErrorResponse,
} from "../utils/apiError";
import { clearOnboardingBootstrapPendingIfInitialized } from "../utils/onboardingBootstrapState";
import { resolveDeliverableOpenTarget } from "../utils/deliverableNavigation";
import { PRODUCT_COPY, toProjectSpaceLabel } from "../utils/productCopy";

const ONBOARDING_BOOTSTRAP_TIMEOUT_MS = 120_000;
const DEFAULT_WORKSPACE_REQUEST_PATH = "~/workspace";
const DEFAULT_WORKSPACE_LABEL = PRODUCT_COPY.defaultProjectSpace;

type ChatSendPayload = {
  content: string;
  tools?: string[];
  hideUserMessage: boolean;
  overridePermissionMode?: PermissionMode;
  displayMessage?: string;
  images?: ChatImageAttachment[];
  showQueueNotice?: boolean;
  queuePreview?: string;
};

function getVisibleQueuedMessagePreviews(queue: ChatSendPayload[]): string[] {
  return queue
    .filter(
      (payload) => payload.showQueueNotice && payload.queuePreview?.trim(),
    )
    .map((payload) => payload.queuePreview as string);
}

function formatWorkspaceDisplayLabel(
  workspacePath?: string,
): string | undefined {
  if (!workspacePath) return undefined;
  const normalized = workspacePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  const name = parts[parts.length - 1];
  return toProjectSpaceLabel(name || DEFAULT_WORKSPACE_LABEL);
}

function useIsDesktopViewport() {
  const [isDesktopViewport, setIsDesktopViewport] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth >= 1024;
  });

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const update = () => setIsDesktopViewport(window.innerWidth >= 1024);
    update();
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
    };
  }, []);

  return isDesktopViewport;
}

export function ChatPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isDesktopViewport = useIsDesktopViewport();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { sidebarDefaultOpen } = useSettings();
  // 运行时状态：用户可随时 toggle，不写回设置
  const [isDesktopSidebarVisible, setIsDesktopSidebarVisible] =
    useState(sidebarDefaultOpen);
  const [isWorkbenchDockOpen, setIsWorkbenchDockOpen] = useState(false);
  const [hasWorkbenchDockMounted, setHasWorkbenchDockMounted] = useState(false);
  const [workbenchDockTab, setWorkbenchDockTab] =
    useState<WorkbenchTab>("browser");
  const [workbenchDockRequestId, setWorkbenchDockRequestId] = useState(0);
  const [
    workbenchBrowserAutoOpenRequestId,
    setWorkbenchBrowserAutoOpenRequestId,
  ] = useState(0);
  // 移动端抽屉：始终默认关闭
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [slashSkills, setSlashSkills] = useState<
    Array<{
      id: string;
      name: string;
      trigger: string;
      description?: string;
      installed?: boolean;
      enabled?: boolean;
    }>
  >([]);
  const [slashSkillsLoading, setSlashSkillsLoading] = useState(false);
  const [slashSkillsLoaded, setSlashSkillsLoaded] = useState(false);
  const [assistantHome, setAssistantHome] = useState<AssistantHomeData | null>(
    null,
  );
  const [assistantHomeLoading, setAssistantHomeLoading] = useState(false);
  const [assistantHomeError, setAssistantHomeError] = useState<string | null>(
    null,
  );
  const [clearChatConfirmOpen, setClearChatConfirmOpen] = useState(false);
  const slashSkillsFetchInFlightRef = useRef(false);
  const { token, user, refreshUser } = useAuth();
  const onboardingBootstrapStartedRef = useRef(false);

  const assistantDisplayName =
    user?.assistant_name?.trim() || PRODUCT_COPY.assistantNameFallback;
  const assistantAvatarText =
    assistantDisplayName.trim().slice(0, 2) ||
    PRODUCT_COPY.assistantNameFallback;

  // Extract and normalize project directory from URL.
  const routeWorkingDirectory = (() => {
    const rawPath = location.pathname.replace("/projects", "");
    if (!rawPath || rawPath === "/") return undefined;

    // URL decode the path
    const decodedPath = decodeURIComponent(rawPath);

    // Normalize Windows paths (remove leading slash from /C:/... format)
    return normalizeWindowsPath(decodedPath);
  })();
  const requestWorkingDirectory =
    routeWorkingDirectory ?? DEFAULT_WORKSPACE_REQUEST_PATH;
  const workspaceDisplayLabel =
    formatWorkspaceDisplayLabel(routeWorkingDirectory) ??
    DEFAULT_WORKSPACE_LABEL;
  const workspaceHeadlineName = routeWorkingDirectory
    ? workspaceDisplayLabel
    : undefined;

  // Get current view and sessionId from query parameters
  const currentView = searchParams.get("view");
  const sessionId = searchParams.get("sessionId");
  const isHistoryView = currentView === "history";
  const isLoadedConversation = !!sessionId && !isHistoryView;

  const { processStreamLine } = useClaudeStreaming();
  const { abortRequest, createAbortHandler } = useAbortController(token);

  // Permission mode state management
  const { permissionMode, setPermissionMode } = usePermissionMode();

  // Load conversation history if sessionId is provided
  const {
    messages: historyMessages,
    loading: historyLoading,
    error: historyError,
    errorStatus: historyErrorStatus,
    sessionId: loadedSessionId,
  } = useAutoHistoryLoader(sessionId || undefined);

  // Initialize chat state with loaded history
  const {
    messages,
    input,
    isLoading,
    currentSessionId,
    currentRequestId,
    hasShownInitMessage,
    currentAssistantMessage,
    setMessages,
    setInput,
    setCurrentSessionId,
    setHasShownInitMessage,
    setHasReceivedInit,
    setCurrentAssistantMessage,
    addMessage,
    updateLastMessage,
    clearInput,
    generateRequestId,
    resetRequestState,
    startRequest,
  } = useChatState({
    initialMessages: historyMessages,
    initialSessionId: loadedSessionId || undefined,
  });
  const [queuedMessagePreviews, setQueuedMessagePreviews] = useState<string[]>(
    [],
  );
  const queuedMessagesRef = useRef<ChatSendPayload[]>([]);
  const isRequestActiveRef = useRef(isLoading);
  const activeRequestIdRef = useRef<string | null>(currentRequestId);
  const currentSessionIdRef = useRef<string | null>(currentSessionId);
  const currentAssistantMessageRef = useRef(currentAssistantMessage);
  const hasShownInitMessageRef = useRef(hasShownInitMessage);
  const allowedToolsRef = useRef<string[]>([]);
  const permissionModeRef = useRef(permissionMode);
  const requestWorkingDirectoryRef = useRef(requestWorkingDirectory);
  const drainQueuedMessageRef = useRef<() => void>(() => undefined);

  const {
    allowedTools,
    permissionRequest,
    showPermissionRequest,
    closePermissionRequest,
    allowToolTemporary,
    allowToolPermanent,
    isPermissionMode,
    planModeRequest,
    showPlanModeRequest,
    closePlanModeRequest,
    updatePermissionMode,
  } = usePermissions({
    onPermissionModeChange: setPermissionMode,
  });

  useEffect(() => {
    isRequestActiveRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    activeRequestIdRef.current = currentRequestId;
  }, [currentRequestId]);

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    currentAssistantMessageRef.current = currentAssistantMessage;
  }, [currentAssistantMessage]);

  useEffect(() => {
    hasShownInitMessageRef.current = hasShownInitMessage;
  }, [hasShownInitMessage]);

  useEffect(() => {
    allowedToolsRef.current = allowedTools;
  }, [allowedTools]);

  useEffect(() => {
    permissionModeRef.current = permissionMode;
  }, [permissionMode]);

  useEffect(() => {
    requestWorkingDirectoryRef.current = requestWorkingDirectory;
  }, [requestWorkingDirectory]);

  useEffect(() => {
    if (isWorkbenchDockOpen) {
      setIsDesktopSidebarVisible(false);
      setIsMobileSidebarOpen(false);
      return;
    }

    if (hasWorkbenchDockMounted) {
      setIsDesktopSidebarVisible(true);
    }
  }, [hasWorkbenchDockMounted, isWorkbenchDockOpen]);

  const handlePermissionError = useCallback(
    (toolName: string, patterns: string[], toolUseId: string) => {
      // Check if this is an ExitPlanMode permission error
      if (patterns.includes("ExitPlanMode")) {
        // For ExitPlanMode, show plan permission interface instead of regular permission
        showPlanModeRequest(""); // Empty plan content since it was already displayed
      } else {
        showPermissionRequest(toolName, patterns, toolUseId);
      }
    },
    [showPermissionRequest, showPlanModeRequest],
  );

  useEffect(() => {
    setAssistantHome(null);
    setAssistantHomeError(null);
    if (!token) {
      setAssistantHomeLoading(false);
      return;
    }
    let cancelled = false;

    const loadAssistantHome = async () => {
      setAssistantHomeLoading(true);
      setAssistantHomeError(null);
      try {
        const response = await fetch(getAssistantHomeUrl(), {
          headers: getAuthHeaders(token),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json?.success) {
          throw new Error(json?.error || "助理首页加载失败");
        }
        if (!cancelled) {
          setAssistantHome(json.data as AssistantHomeData);
        }
      } catch (err) {
        if (!cancelled) {
          setAssistantHomeError(
            err instanceof Error ? err.message : "助理首页加载失败",
          );
        }
      } finally {
        if (!cancelled) {
          setAssistantHomeLoading(false);
        }
      }
    };

    void loadAssistantHome();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const openWorkbenchDock = useCallback(
    (
      tab: WorkbenchTab = "browser",
      options: { autoStartBrowser?: boolean } = {},
    ) => {
      setWorkbenchDockTab(tab);
      setWorkbenchDockRequestId((requestId) => requestId + 1);
      if (tab === "browser" && options.autoStartBrowser) {
        setWorkbenchBrowserAutoOpenRequestId((requestId) => requestId + 1);
      }
      setHasWorkbenchDockMounted(true);
      setIsWorkbenchDockOpen(true);
    },
    [],
  );

  const handleStreamWorkbenchOpen = useCallback(
    (tab: WorkbenchTab | "preview") => {
      const nextTab = tab === "preview" ? "files" : tab;
      openWorkbenchDock(nextTab, { autoStartBrowser: nextTab === "browser" });
    },
    [openWorkbenchDock],
  );

  const setCurrentSessionIdNow = useCallback(
    (nextSessionId: string | null) => {
      currentSessionIdRef.current = nextSessionId;
      setCurrentSessionId(nextSessionId);
    },
    [setCurrentSessionId],
  );

  const setCurrentAssistantMessageNow = useCallback(
    (message: ChatMessage | null) => {
      currentAssistantMessageRef.current = message;
      setCurrentAssistantMessage(message);
    },
    [setCurrentAssistantMessage],
  );

  const setHasShownInitMessageNow = useCallback(
    (shown: boolean) => {
      hasShownInitMessageRef.current = shown;
      setHasShownInitMessage(shown);
    },
    [setHasShownInitMessage],
  );

  const finishActiveRequest = useCallback(
    (requestId: string) => {
      if (activeRequestIdRef.current !== requestId) return;
      activeRequestIdRef.current = null;
      isRequestActiveRef.current = false;
      resetRequestState();
      Promise.resolve().then(() => drainQueuedMessageRef.current());
    },
    [resetRequestState],
  );

  const runMessage = useCallback(
    async (payload: ChatSendPayload) => {
      const {
        content,
        tools,
        hideUserMessage,
        overridePermissionMode,
        displayMessage,
        images,
      } = payload;
      const requestId = generateRequestId();
      activeRequestIdRef.current = requestId;
      isRequestActiveRef.current = true;
      currentAssistantMessageRef.current = null;

      if (!hideUserMessage) {
        addMessage({
          type: "chat",
          role: "user",
          content: displayMessage || content,
          timestamp: Date.now(),
        });
      }

      startRequest();

      try {
        let localHasReceivedInit = false;
        let shouldAbort = false;
        let sessionIdForRequest = currentSessionIdRef.current || undefined;
        let streamCompleted = false;
        const requestPermissionMode =
          overridePermissionMode || permissionModeRef.current;
        const requestAllowedTools = tools || allowedToolsRef.current;

        for (let attempt = 0; attempt < 2; attempt += 1) {
          const response = await fetch(getChatUrl(), {
            method: "POST",
            headers: getAuthHeaders(token),
            body: JSON.stringify({
              message: content,
              requestId,
              ...(sessionIdForRequest
                ? { sessionId: sessionIdForRequest }
                : {}),
              allowedTools: requestAllowedTools,
              workingDirectory: requestWorkingDirectoryRef.current,
              permissionMode: requestPermissionMode,
              ...(images && images.length > 0 ? { images } : {}),
            } as ChatRequest),
          });

          if (!response.ok) {
            const parsed = await parseApiErrorResponse(response);
            const sessionDenied =
              parsed.status === 403 &&
              parsed.backendError.includes("会话") &&
              Boolean(sessionIdForRequest) &&
              attempt === 0;

            if (sessionDenied) {
              // 旧会话跨账号/权限变化时自动切到新会话重试一次，减少用户手动刷新成本
              sessionIdForRequest = undefined;
              setCurrentSessionIdNow(null);
              navigate({ search: "" });
              continue;
            }

            throw new Error(parsed.message);
          }

          if (!response.body) throw new Error("No response body");

          const reader = response.body.getReader();
          const decoder = new TextDecoder();

          const streamingContext: StreamingContext = {
            currentAssistantMessage: currentAssistantMessageRef.current,
            setCurrentAssistantMessage: setCurrentAssistantMessageNow,
            addMessage,
            updateLastMessage,
            onSessionId: setCurrentSessionIdNow,
            shouldShowInitMessage: () => !hasShownInitMessageRef.current,
            onInitMessageShown: () => setHasShownInitMessageNow(true),
            get hasReceivedInit() {
              return localHasReceivedInit;
            },
            setHasReceivedInit: (received: boolean) => {
              localHasReceivedInit = received;
              setHasReceivedInit(received);
            },
            onPermissionError: handlePermissionError,
            onAbortRequest: async () => {
              shouldAbort = true;
              try {
                await createAbortHandler(requestId)();
              } catch (error) {
                console.error("Failed to abort request:", error);
              }
            },
            permissionMode: requestPermissionMode,
            onWorkbenchOpen: handleStreamWorkbenchOpen,
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done || shouldAbort) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split("\n").filter((line) => line.trim());

            for (const line of lines) {
              if (shouldAbort) break;
              processStreamLine(line, streamingContext);
            }

            if (shouldAbort) break;
          }

          streamCompleted = true;
          break;
        }

        if (!streamCompleted) {
          throw new Error("发送失败，请稍后重试。");
        }
      } catch (error) {
        console.error("Failed to send message:", error);
        if (activeRequestIdRef.current === requestId) {
          const userMessage = getNetworkErrorMessage(
            error,
            "发送失败，请稍后重试。",
          );
          addMessage({
            type: "chat",
            role: "assistant",
            content: userMessage,
            timestamp: Date.now(),
          });
        }
      } finally {
        finishActiveRequest(requestId);
      }
    },
    [
      token,
      navigate,
      generateRequestId,
      startRequest,
      addMessage,
      updateLastMessage,
      setCurrentSessionIdNow,
      setHasShownInitMessageNow,
      setHasReceivedInit,
      setCurrentAssistantMessageNow,
      finishActiveRequest,
      processStreamLine,
      handlePermissionError,
      createAbortHandler,
      handleStreamWorkbenchOpen,
    ],
  );

  const drainQueuedMessage = useCallback(() => {
    if (isRequestActiveRef.current) return;
    const nextPayload = queuedMessagesRef.current.shift();
    setQueuedMessagePreviews(
      getVisibleQueuedMessagePreviews(queuedMessagesRef.current),
    );
    if (!nextPayload) return;
    void runMessage(nextPayload);
  }, [runMessage]);

  useEffect(() => {
    drainQueuedMessageRef.current = drainQueuedMessage;
  }, [drainQueuedMessage]);

  const sendMessage = useCallback(
    async (
      messageContent?: string,
      tools?: string[],
      hideUserMessage = false,
      overridePermissionMode?: PermissionMode,
      displayMessage?: string,
      images?: ChatImageAttachment[],
    ) => {
      const content = messageContent || input.trim();
      if (!content) return;

      if (!messageContent) clearInput();

      const payload: ChatSendPayload = {
        content,
        tools,
        hideUserMessage,
        overridePermissionMode,
        displayMessage,
        images,
      };

      if (isRequestActiveRef.current) {
        if (!hideUserMessage) {
          addMessage({
            type: "chat",
            role: "user",
            content: displayMessage || content,
            timestamp: Date.now(),
          });
        }
        queuedMessagesRef.current.push({
          ...payload,
          hideUserMessage: true,
          showQueueNotice: !hideUserMessage,
          queuePreview: !hideUserMessage
            ? displayMessage || content
            : undefined,
        });
        setQueuedMessagePreviews(
          getVisibleQueuedMessagePreviews(queuedMessagesRef.current),
        );
        return;
      }

      await runMessage(payload);
    },
    [input, clearInput, addMessage, runMessage],
  );

  const handleAbort = useCallback(() => {
    void (async () => {
      const abortingRequestId = currentRequestId;
      try {
        const result = await abortRequest(currentRequestId, isLoading);
        if (!result) return;
        const abortMessage: AbortMessage = {
          type: "system",
          subtype: "abort",
          message: result.message,
          status: result.active ? "paused" : "ended",
          timestamp: Date.now(),
        };
        addMessage(abortMessage);
      } catch (error) {
        console.error("Failed to abort request:", error);
        const abortMessage: AbortMessage = {
          type: "system",
          subtype: "abort",
          message: "暂停请求失败，请稍后再试",
          status: "failed",
          timestamp: Date.now(),
        };
        addMessage(abortMessage);
      } finally {
        if (
          abortingRequestId &&
          activeRequestIdRef.current === abortingRequestId
        ) {
          activeRequestIdRef.current = null;
          isRequestActiveRef.current = false;
          resetRequestState();
          Promise.resolve().then(() => drainQueuedMessageRef.current());
        }
      }
    })();
  }, [
    abortRequest,
    currentRequestId,
    isLoading,
    addMessage,
    resetRequestState,
  ]);

  // Permission request handlers
  const handlePermissionAllow = useCallback(() => {
    if (!permissionRequest) return;

    // Add all patterns temporarily
    let updatedAllowedTools = allowedTools;
    permissionRequest.patterns.forEach((pattern) => {
      updatedAllowedTools = allowToolTemporary(pattern, updatedAllowedTools);
    });

    closePermissionRequest();

    if (currentSessionId) {
      sendMessage("continue", updatedAllowedTools, true);
    }
  }, [
    permissionRequest,
    currentSessionId,
    sendMessage,
    allowedTools,
    allowToolTemporary,
    closePermissionRequest,
  ]);

  const handlePermissionAllowPermanent = useCallback(() => {
    if (!permissionRequest) return;

    // Add all patterns permanently
    let updatedAllowedTools = allowedTools;
    permissionRequest.patterns.forEach((pattern) => {
      updatedAllowedTools = allowToolPermanent(pattern, updatedAllowedTools);
    });

    closePermissionRequest();

    if (currentSessionId) {
      sendMessage("continue", updatedAllowedTools, true);
    }
  }, [
    permissionRequest,
    currentSessionId,
    sendMessage,
    allowedTools,
    allowToolPermanent,
    closePermissionRequest,
  ]);

  const handlePermissionDeny = useCallback(() => {
    closePermissionRequest();
  }, [closePermissionRequest]);

  // Plan mode request handlers
  const handlePlanAcceptWithEdits = useCallback(() => {
    updatePermissionMode("acceptEdits");
    closePlanModeRequest();
    if (currentSessionId) {
      sendMessage("accept", allowedTools, true, "acceptEdits");
    }
  }, [
    updatePermissionMode,
    closePlanModeRequest,
    currentSessionId,
    sendMessage,
    allowedTools,
  ]);

  const handlePlanAcceptDefault = useCallback(() => {
    updatePermissionMode("default");
    closePlanModeRequest();
    if (currentSessionId) {
      sendMessage("accept", allowedTools, true, "default");
    }
  }, [
    updatePermissionMode,
    closePlanModeRequest,
    currentSessionId,
    sendMessage,
    allowedTools,
  ]);

  const handlePlanKeepPlanning = useCallback(() => {
    updatePermissionMode("plan");
    closePlanModeRequest();
  }, [updatePermissionMode, closePlanModeRequest]);

  // Create permission data for inline permission interface
  const permissionData = useMemo(() => {
    if (!permissionRequest) return undefined;
    return {
      patterns: permissionRequest.patterns,
      onAllow: handlePermissionAllow,
      onAllowPermanent: handlePermissionAllowPermanent,
      onDeny: handlePermissionDeny,
    };
  }, [
    handlePermissionAllow,
    handlePermissionAllowPermanent,
    handlePermissionDeny,
    permissionRequest,
  ]);

  // Create plan permission data for plan mode interface
  const planPermissionData = useMemo(() => {
    if (!planModeRequest) return undefined;
    return {
      onAcceptWithEdits: handlePlanAcceptWithEdits,
      onAcceptDefault: handlePlanAcceptDefault,
      onKeepPlanning: handlePlanKeepPlanning,
    };
  }, [
    handlePlanAcceptDefault,
    handlePlanAcceptWithEdits,
    handlePlanKeepPlanning,
    planModeRequest,
  ]);

  const handleHistoryClick = useCallback(() => {
    const searchParams = new URLSearchParams();
    searchParams.set("view", "history");
    navigate({ search: searchParams.toString() });
  }, [navigate]);

  const handleSettingsClick = useCallback(() => {
    setIsSettingsOpen(true);
  }, []);

  const handleSettingsClose = useCallback(() => {
    setIsSettingsOpen(false);
  }, []);

  const handleOpenDeliverable = useCallback(
    (deliverable: AssistantDeliverableCard) => {
      const target = resolveDeliverableOpenTarget(deliverable);
      if (target.kind === "navigate") {
        if (target.to.startsWith("/workspace")) {
          openWorkbenchDock("files");
          return;
        }
        navigate(target.to);
        return;
      }
      window.open(target.url, "_blank", "noopener,noreferrer");
    },
    [navigate, openWorkbenchDock],
  );

  const handleContinueTask = useCallback(
    (task: AssistantTaskCard) => {
      if (task.source !== "conversation" || !task.id) {
        setInput(`继续：${task.title}`);
        return;
      }

      const nextSearchParams = new URLSearchParams();
      nextSearchParams.set("sessionId", task.id);
      navigate({ search: nextSearchParams.toString() });
    },
    [navigate, setInput],
  );

  const handleBackToChat = useCallback(() => {
    navigate({ search: "" });
  }, [navigate]);

  const handleBackToHistory = useCallback(() => {
    const searchParams = new URLSearchParams();
    searchParams.set("view", "history");
    navigate({ search: searchParams.toString() });
  }, [navigate]);

  const handleBackToProjects = useCallback(() => {
    navigate("/");
  }, [navigate]);

  const handleBackToProjectChat = useCallback(() => {
    if (routeWorkingDirectory) {
      navigate(`/projects${routeWorkingDirectory}`);
    }
  }, [navigate, routeWorkingDirectory]);

  const handleNewChat = useCallback(() => {
    navigate({ search: "" });
  }, [navigate]);

  const clearCurrentChat = useCallback(() => {
    // 先中断进行中的流式请求，防止清空后又冒出新消息
    if (isLoading && currentRequestId) {
      abortRequest(currentRequestId, isLoading, resetRequestState);
    }
    queuedMessagesRef.current = [];
    setQueuedMessagePreviews([]);
    activeRequestIdRef.current = null;
    isRequestActiveRef.current = false;
    // 直接重置聊天 state，不依赖 URL 变化
    setMessages([]);
    setCurrentSessionId(null);
    setHasShownInitMessage(false);
    setHasReceivedInit(false);
    setCurrentAssistantMessage(null);
    clearInput();
    // 同时清 URL query（确保 sessionId 参数被移除）
    navigate({ search: "" });
  }, [
    isLoading,
    currentRequestId,
    abortRequest,
    resetRequestState,
    setMessages,
    setCurrentSessionId,
    setHasShownInitMessage,
    setHasReceivedInit,
    setCurrentAssistantMessage,
    clearInput,
    navigate,
  ]);

  const handleClearChat = useCallback(() => {
    setClearChatConfirmOpen(true);
  }, []);

  const confirmClearChat = useCallback(() => {
    setClearChatConfirmOpen(false);
    clearCurrentChat();
  }, [clearCurrentChat]);

  const loadSlashSkills = useCallback(async () => {
    if (!token || slashSkillsFetchInFlightRef.current) {
      return;
    }

    slashSkillsFetchInFlightRef.current = true;
    setSlashSkillsLoading(true);
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch(getSkillsUrl(), {
            headers: getAuthHeaders(token),
          });
          const json = await response.json().catch(() => ({}));
          if (!response.ok || !json?.success) {
            throw new Error(
              json?.error || `skills request failed: ${response.status}`,
            );
          }

          const skills = (json?.data?.skills || []) as Array<{
            id: string;
            name: string;
            trigger?: string;
            triggers?: string[];
            description?: string;
            installed?: boolean;
            enabled?: boolean;
          }>;

          setSlashSkills(
            skills.map((skill) => ({
              id: skill.id,
              name: skill.name || skill.id,
              trigger: skill.trigger || `/${skill.id}`,
              triggers: skill.triggers,
              description: skill.description || "",
              installed: skill.installed,
              enabled: skill.enabled,
            })),
          );
          setSlashSkillsLoaded(true);
          return;
        } catch (error) {
          if (attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 300));
            continue;
          }
          console.warn("加载 slash 技能失败", error);
        }
      }
    } finally {
      setSlashSkillsLoading(false);
      slashSkillsFetchInFlightRef.current = false;
    }
  }, [token]);

  const renderChatInput = useCallback(
    (variant: "default" | "hero" = "default") => (
      <ChatInput
        input={input}
        isLoading={isLoading}
        currentRequestId={currentRequestId}
        onInputChange={setInput}
        onSubmit={(messageOverride, displayMessage, images) =>
          sendMessage(
            messageOverride,
            undefined,
            false,
            undefined,
            displayMessage,
            images,
          )
        }
        onAbort={handleAbort}
        permissionMode={permissionMode}
        onPermissionModeChange={setPermissionMode}
        showPermissions={isPermissionMode}
        permissionData={permissionData}
        planPermissionData={planPermissionData}
        slashSkills={slashSkills}
        slashSkillsLoaded={slashSkillsLoaded}
        slashSkillsLoading={slashSkillsLoading}
        onSlashRequestRefresh={loadSlashSkills}
        queuedMessages={queuedMessagePreviews}
        variant={variant}
        showPermissionModeControl={false}
        placeholder={
          variant === "hero"
            ? "描述你想完成的事，MyCC 会帮你拆解并执行…"
            : undefined
        }
      />
    ),
    [
      currentRequestId,
      handleAbort,
      input,
      isLoading,
      isPermissionMode,
      loadSlashSkills,
      permissionData,
      permissionMode,
      planPermissionData,
      queuedMessagePreviews,
      sendMessage,
      setInput,
      setPermissionMode,
      slashSkills,
      slashSkillsLoaded,
      slashSkillsLoading,
    ],
  );

  const handleReEditMessage = useCallback(
    (content: string) => {
      setInput(content);
      window.dispatchEvent(new CustomEvent("mycc:focus-chat-input"));
    },
    [setInput],
  );

  const handleRetryMessage = useCallback(
    (content: string) => {
      void sendMessage(content);
    },
    [sendMessage],
  );

  useEffect(() => {
    if (!token) {
      setSlashSkills([]);
      setSlashSkillsLoaded(false);
      setSlashSkillsLoading(false);
      return;
    }
    loadSlashSkills();
  }, [token, loadSlashSkills]);

  // Handle global keyboard shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === KEYBOARD_SHORTCUTS.ABORT && isLoading && currentRequestId) {
        e.preventDefault();
        handleAbort();
      }
    };

    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [isLoading, currentRequestId, handleAbort]);

  useEffect(() => {
    const prefill = (location.state as { prefill?: string } | null)?.prefill;
    if (prefill) {
      setInput(prefill);
      navigate(location.pathname + location.search, {
        replace: true,
        state: null,
      });
    }
  }, [location.pathname, location.search, location.state, navigate, setInput]);

  useEffect(() => {
    if (!sessionId || !historyError) return;
    if (historyErrorStatus !== 403) return;

    // 新用户或跨账号场景下 URL 里残留旧 sessionId 时，自动回退到新会话
    setCurrentSessionId(null);
    navigate({ search: "" }, { replace: true });
  }, [
    sessionId,
    historyError,
    historyErrorStatus,
    navigate,
    setCurrentSessionId,
  ]);

  useEffect(() => {
    if (!sessionId || !historyError) return;
    if (historyErrorStatus === 403) return;

    // 旧对话正文读不出来时，保留上下文入口，但后续发送从新会话接上。
    setCurrentSessionId(null);
  }, [sessionId, historyError, historyErrorStatus, setCurrentSessionId]);

  useEffect(() => {
    const state = location.state as {
      onboardingBootstrapPrompt?: string;
    } | null;
    const bootstrapPrompt =
      typeof state?.onboardingBootstrapPrompt === "string"
        ? state.onboardingBootstrapPrompt.trim()
        : "";
    if (!bootstrapPrompt) return;
    if (onboardingBootstrapStartedRef.current) return;
    if (isHistoryView || historyLoading || isLoading) return;
    if (sessionId || currentSessionId) return;
    if (messages.length > 0) return;

    onboardingBootstrapStartedRef.current = true;
    navigate(location.pathname + location.search, {
      replace: true,
      state: null,
    });
    addMessage({
      type: "chat",
      role: "assistant",
      content:
        "正在为你启动初始化流程。你现在可以继续对话，我会在这个会话里完成配置。",
      timestamp: Date.now(),
    });
    void (async () => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      try {
        await Promise.race([
          sendMessage(bootstrapPrompt, undefined, true),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error("onboarding_bootstrap_timeout"));
            }, ONBOARDING_BOOTSTRAP_TIMEOUT_MS);
          }),
        ]);
      } catch (err) {
        console.error(
          "[OnboardingBootstrap] send bootstrap prompt failed:",
          err,
        );
        addMessage({
          type: "chat",
          role: "assistant",
          content:
            "初始化提示发送超时或失败，但你可以继续对话；只要 CLAUDE.md 里的初始化标识还在，助手会继续完成初始化。",
          timestamp: Date.now(),
        });
        return;
      } finally {
        if (timer) clearTimeout(timer);
      }
      void refreshUser()
        .then(clearOnboardingBootstrapPendingIfInitialized)
        .catch((err) => {
          console.error(
            "[OnboardingBootstrap] refresh user after initialize failed:",
            err,
          );
        });
    })();
  }, [
    location.state,
    location.pathname,
    location.search,
    navigate,
    isHistoryView,
    historyLoading,
    isLoading,
    sessionId,
    currentSessionId,
    messages.length,
    addMessage,
    sendMessage,
    refreshUser,
  ]);

  const isAssistantHomeView =
    !isHistoryView && messages.length === 0 && !isLoadedConversation;
  const isLoadedConversationEmpty =
    isLoadedConversation &&
    !historyLoading &&
    !historyError &&
    messages.length === 0;
  const isLoadedConversationRecoverableError =
    isLoadedConversation &&
    !historyLoading &&
    Boolean(historyError) &&
    historyErrorStatus !== 403;
  const isMobileWorkbenchOverlay = isWorkbenchDockOpen && !isDesktopViewport;

  return (
    <div className="app-shell h-screen flex overflow-hidden">
      <Sidebar
        onNewChat={handleNewChat}
        currentPathLabel={workspaceDisplayLabel}
        desktopVisible={isDesktopSidebarVisible}
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onShowHistory={handleHistoryClick}
      />

      <div className="flex-1 min-w-0 h-screen flex overflow-hidden">
        <main
          className="flex-1 min-w-0 p-3 sm:p-6 h-screen flex flex-col"
          aria-hidden={isMobileWorkbenchOverlay ? true : undefined}
          data-mobile-workbench-overlay={
            isMobileWorkbenchOverlay ? "hidden" : undefined
          }
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-4 sm:mb-8 flex-shrink-0">
            <div className="flex items-center gap-4 min-w-0">
              <button
                onClick={() => {
                  if (isDesktopViewport) {
                    setIsDesktopSidebarVisible((v) => !v);
                  } else {
                    setIsMobileSidebarOpen(true);
                  }
                }}
                className="p-2 rounded-lg panel-surface border hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
                aria-label="切换侧栏"
              >
                <svg
                  className="w-5 h-5 text-slate-600 dark:text-slate-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <rect
                    x="3"
                    y="4"
                    width="18"
                    height="16"
                    rx="2"
                    strokeWidth={2}
                  />
                  <path strokeWidth={2} strokeLinecap="round" d="M9 4v16" />
                </svg>
              </button>
              {isHistoryView && (
                <button
                  onClick={handleBackToChat}
                  className="p-2 rounded-lg panel-surface border hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 shadow-sm hover:shadow-md"
                  aria-label="Back to chat"
                >
                  <ChevronLeftIcon className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                </button>
              )}
              {isLoadedConversation && (
                <button
                  onClick={handleBackToHistory}
                  className="p-2 rounded-lg panel-surface border hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200 shadow-sm hover:shadow-md"
                  aria-label="Back to history"
                >
                  <ChevronLeftIcon className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                </button>
              )}
              <div className="min-w-0">
                <nav aria-label="Breadcrumb">
                  <div className="flex items-center">
                    <button
                      onClick={handleBackToProjects}
                      className="text-slate-800 dark:text-slate-100 text-lg sm:text-xl font-bold tracking-tight hover:text-[var(--accent)] transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 dark:focus:ring-offset-slate-900 rounded-md px-1 -mx-1 truncate"
                      aria-label="Back to project selection"
                    >
                      {PRODUCT_COPY.brandName}
                    </button>
                    {(isHistoryView || sessionId) && (
                      <>
                        <span
                          className="text-slate-800 dark:text-slate-100 text-lg sm:text-xl font-bold tracking-tight mx-3 select-none"
                          aria-hidden="true"
                        >
                          {" "}
                          ›{" "}
                        </span>
                        <h1
                          className="text-slate-800 dark:text-slate-100 text-lg sm:text-xl font-bold tracking-tight"
                          aria-current="page"
                        >
                          {isHistoryView ? "历史记录" : "对话"}
                        </h1>
                      </>
                    )}
                  </div>
                </nav>
                {workspaceDisplayLabel && (
                  <div className="flex items-center text-sm font-mono mt-1">
                    {routeWorkingDirectory ? (
                      <button
                        onClick={handleBackToProjectChat}
                        className="text-slate-600 dark:text-slate-400 hover:text-[var(--accent)] transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 dark:focus:ring-offset-slate-900 rounded px-1 -mx-1 cursor-pointer"
                        aria-label={`Return to new chat in ${workspaceDisplayLabel}`}
                      >
                        {workspaceDisplayLabel}
                      </button>
                    ) : (
                      <span className="text-slate-600 dark:text-slate-400">
                        {workspaceDisplayLabel}
                      </span>
                    )}
                    {sessionId && (
                      <span className="ml-2 text-xs text-slate-600 dark:text-slate-400">
                        继续之前的对话
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => openWorkbenchDock("browser")}
                className="inline-flex items-center gap-2 rounded-lg border panel-surface px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                aria-label={`打开右侧${PRODUCT_COPY.resultsSpace}`}
              >
                <ComputerDesktopIcon className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">
                  {PRODUCT_COPY.resultsSpace}
                </span>
              </button>
              {/* 移动端技能入口 */}
              <button
                onClick={() => navigate("/skills")}
                className="lg:hidden px-3 py-2 rounded-lg panel-surface border text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                技能
              </button>
              {messages.length > 0 && !isHistoryView && (
                <button
                  onClick={handleClearChat}
                  className="px-3 py-2 rounded-lg panel-surface border text-sm text-slate-600 dark:text-slate-300 hover:bg-red-50 hover:text-red-600 hover:border-red-200 dark:hover:bg-red-900/20 dark:hover:text-red-400 transition-colors"
                >
                  清空
                </button>
              )}
              <SettingsButton onClick={handleSettingsClick} />
            </div>
          </div>

          {/* Main Content */}
          {isHistoryView ? (
            <HistoryView onBack={handleBackToChat} />
          ) : historyLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin mx-auto mb-4"></div>
                <p className="text-slate-600 dark:text-slate-400">
                  正在读取旧对话...
                </p>
              </div>
            </div>
          ) : isLoadedConversationRecoverableError ? (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center max-w-lg px-6">
                  <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-amber-100 dark:bg-amber-900/25 flex items-center justify-center">
                    <svg
                      className="w-8 h-8 text-amber-600 dark:text-amber-300"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 7h8M8 11h5m-7 8 3-3h7a4 4 0 0 0 4-4V7a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v5a4 4 0 0 0 4 4"
                      />
                    </svg>
                  </div>
                  <h2 className="text-slate-800 dark:text-slate-100 text-xl font-semibold mb-2">
                    旧对话暂时没读出来
                  </h2>
                  <p className="text-slate-600 dark:text-slate-400 text-sm leading-6 mb-5">
                    {historyError}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      onClick={handleBackToHistory}
                      className="px-4 py-2 rounded-lg border panel-surface text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      回到历史记录
                    </button>
                    <button
                      onClick={() => navigate({ search: "" })}
                      className="px-4 py-2 text-[var(--text-inverse)] rounded-lg text-sm transition-colors"
                      style={{ background: "var(--accent)" }}
                    >
                      开始新对话
                    </button>
                  </div>
                </div>
              </div>
              {renderChatInput()}
            </div>
          ) : historyError ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center max-w-md">
                <div className="w-16 h-16 mx-auto mb-4 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center">
                  <svg
                    className="w-8 h-8 text-red-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <h2 className="text-slate-800 dark:text-slate-100 text-xl font-semibold mb-2">
                  旧对话暂时没读出来
                </h2>
                <p className="text-slate-600 dark:text-slate-400 text-sm mb-4">
                  {historyError}
                </p>
                <button
                  onClick={() => navigate({ search: "" })}
                  className="px-4 py-2 text-[var(--text-inverse)] rounded-lg transition-colors"
                  style={{ background: "var(--accent)" }}
                >
                  回到新对话
                </button>
              </div>
            </div>
          ) : isLoadedConversationEmpty ? (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center max-w-lg px-6">
                  <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-amber-100 dark:bg-amber-900/25 flex items-center justify-center">
                    <svg
                      className="w-8 h-8 text-amber-600 dark:text-amber-300"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 7h8M8 11h5m-7 8 3-3h7a4 4 0 0 0 4-4V7a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v5a4 4 0 0 0 4 4"
                      />
                    </svg>
                  </div>
                  <h2 className="text-slate-800 dark:text-slate-100 text-xl font-semibold mb-2">
                    旧对话暂无可显示内容
                  </h2>
                  <p className="text-slate-600 dark:text-slate-400 text-sm leading-6 mb-5">
                    原记录不会被删除，只是这段旧对话的正文暂时没读出来。你可以直接继续提问，
                    {PRODUCT_COPY.brandName}
                    会从这里接上。
                  </p>
                  <button
                    onClick={handleBackToHistory}
                    className="px-4 py-2 rounded-lg border panel-surface text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    回到历史记录
                  </button>
                </div>
              </div>
              {renderChatInput()}
            </div>
          ) : (
            <>
              {isAssistantHomeView ? (
                <div className="flex-1 overflow-y-auto">
                  <AssistantHomePanel
                    assistantName={assistantDisplayName}
                    data={assistantHome}
                    loading={assistantHomeLoading}
                    error={assistantHomeError}
                    onStartPrompt={setInput}
                    onContinueTask={handleContinueTask}
                    onOpenWorkspace={() => openWorkbenchDock("files")}
                    onOpenDeliverable={handleOpenDeliverable}
                    inputSlot={renderChatInput("hero")}
                    workspaceName={workspaceHeadlineName}
                    workspaceLabel={workspaceDisplayLabel}
                  />
                </div>
              ) : (
                <>
                  <ChatMessages
                    messages={messages}
                    isLoading={isLoading}
                    assistantDisplayName={assistantDisplayName}
                    assistantAvatarText={assistantAvatarText}
                    onReEditMessage={handleReEditMessage}
                    onRetryMessage={handleRetryMessage}
                  />
                  {renderChatInput()}
                </>
              )}
            </>
          )}

          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={handleSettingsClose}
          />

          <ConfirmDialog
            isOpen={clearChatConfirmOpen}
            title="清空当前会话？"
            description="当前页面里的消息、排队中的补充和正在生成的回复都会从界面中移除。"
            confirmLabel="清空会话"
            variant="destructive"
            onConfirm={confirmClearChat}
            onCancel={() => setClearChatConfirmOpen(false)}
          />
        </main>

        <div
          className="shrink-0 max-lg:!w-0 lg:overflow-hidden lg:transition-[width] lg:duration-200 lg:ease-in-out"
          style={{
            width: isWorkbenchDockOpen ? "clamp(640px, 52vw, 880px)" : "0px",
          }}
        >
          {hasWorkbenchDockMounted && (
            <AssistantWorkbenchDock
              token={token}
              isOpen={isWorkbenchDockOpen}
              initialTab={workbenchDockTab}
              tabRequestId={workbenchDockRequestId}
              autoOpenBrowserRequestId={workbenchBrowserAutoOpenRequestId}
              onClose={() => setIsWorkbenchDockOpen(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
