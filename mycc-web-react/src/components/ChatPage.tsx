import { useEffect, useCallback, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeftIcon } from "@heroicons/react/24/outline";
import type {
  ChatRequest,
  ChatMessage,
  PermissionMode,
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
import { HistoryButton } from "./chat/HistoryButton";
import { ChatInput } from "./chat/ChatInput";
import { ChatMessages } from "./chat/ChatMessages";
import { HistoryView } from "./HistoryView";
import { Sidebar } from "./layout/Sidebar";
import { getChatUrl, getAuthHeaders, getSkillsUrl } from "../config/api";
import { KEYBOARD_SHORTCUTS } from "../utils/constants";
import { normalizeWindowsPath } from "../utils/pathUtils";
import type { StreamingContext } from "../hooks/streaming/useMessageProcessor";
import { useAuth } from "../contexts/AuthContext";
import { getCurrentUser } from "../api/auth";
import { getNetworkErrorMessage, parseApiErrorResponse } from "../utils/apiError";
import { setOnboardingBootstrapPending } from "../utils/onboardingBootstrapState";

const ONBOARDING_BOOTSTRAP_TIMEOUT_MS = 120_000;

export function ChatPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { sidebarDefaultOpen } = useSettings();
  // 运行时状态：用户可随时 toggle，不写回设置
  const [isDesktopSidebarVisible, setIsDesktopSidebarVisible] = useState(sidebarDefaultOpen);
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
  const slashSkillsFetchInFlightRef = useRef(false);
  const { token, user, refreshUser } = useAuth();
  const onboardingBootstrapStartedRef = useRef(false);

  const assistantDisplayName = user?.assistant_name?.trim() || "cc";
  const assistantAvatarText = assistantDisplayName.trim().slice(0, 2) || "cc";

  // Extract and normalize working directory from URL
  const workingDirectory = (() => {
    const rawPath = location.pathname.replace("/projects", "");
    if (!rawPath) return undefined;

    // URL decode the path
    const decodedPath = decodeURIComponent(rawPath);

    // Normalize Windows paths (remove leading slash from /C:/... format)
    return normalizeWindowsPath(decodedPath);
  })();

  // Get current view and sessionId from query parameters
  const currentView = searchParams.get("view");
  const sessionId = searchParams.get("sessionId");
  const isHistoryView = currentView === "history";
  const isLoadedConversation = !!sessionId && !isHistoryView;

  const { processStreamLine } = useClaudeStreaming();
  const { abortRequest, createAbortHandler } = useAbortController();

  // Permission mode state management
  const { permissionMode, setPermissionMode } = usePermissionMode();

  // Load conversation history if sessionId is provided
  const {
    messages: historyMessages,
    loading: historyLoading,
    error: historyError,
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

  const sendMessage = useCallback(
    async (
      messageContent?: string,
      tools?: string[],
      hideUserMessage = false,
      overridePermissionMode?: PermissionMode,
    ) => {
      const content = messageContent || input.trim();
      if (!content || isLoading) return;

      const requestId = generateRequestId();

      // Only add user message to chat if not hidden
      if (!hideUserMessage) {
        const userMessage: ChatMessage = {
          type: "chat",
          role: "user",
          content: content,
          timestamp: Date.now(),
        };
        addMessage(userMessage);
      }

      if (!messageContent) clearInput();
      startRequest();

      try {
        let localHasReceivedInit = false;
        let shouldAbort = false;
        let sessionIdForRequest = currentSessionId || undefined;
        let streamCompleted = false;

        for (let attempt = 0; attempt < 2; attempt += 1) {
          const response = await fetch(getChatUrl(), {
            method: "POST",
            headers: getAuthHeaders(token),
            body: JSON.stringify({
              message: content,
              requestId,
              ...(sessionIdForRequest ? { sessionId: sessionIdForRequest } : {}),
              allowedTools: tools || allowedTools,
              ...(workingDirectory ? { workingDirectory } : {}),
              permissionMode: overridePermissionMode || permissionMode,
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
              setCurrentSessionId(null);
              navigate({ search: "" });
              continue;
            }

            throw new Error(parsed.message);
          }

          if (!response.body) throw new Error("No response body");

          const reader = response.body.getReader();
          const decoder = new TextDecoder();

          const streamingContext: StreamingContext = {
            currentAssistantMessage,
            setCurrentAssistantMessage,
            addMessage,
            updateLastMessage,
            onSessionId: setCurrentSessionId,
            shouldShowInitMessage: () => !hasShownInitMessage,
            onInitMessageShown: () => setHasShownInitMessage(true),
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
              await createAbortHandler(requestId)();
            },
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
      } finally {
        resetRequestState();
      }
    },
    [
      input,
      isLoading,
      currentSessionId,
      allowedTools,
      hasShownInitMessage,
      currentAssistantMessage,
      workingDirectory,
      permissionMode,
      token,
      navigate,
      generateRequestId,
      clearInput,
      startRequest,
      addMessage,
      updateLastMessage,
      setCurrentSessionId,
      setHasShownInitMessage,
      setHasReceivedInit,
      setCurrentAssistantMessage,
      resetRequestState,
      processStreamLine,
      handlePermissionError,
      createAbortHandler,
    ],
  );

  const handleAbort = useCallback(() => {
    abortRequest(currentRequestId, isLoading, resetRequestState);
  }, [abortRequest, currentRequestId, isLoading, resetRequestState]);

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
  const permissionData = permissionRequest
    ? {
        patterns: permissionRequest.patterns,
        onAllow: handlePermissionAllow,
        onAllowPermanent: handlePermissionAllowPermanent,
        onDeny: handlePermissionDeny,
      }
    : undefined;

  // Create plan permission data for plan mode interface
  const planPermissionData = planModeRequest
    ? {
        onAcceptWithEdits: handlePlanAcceptWithEdits,
        onAcceptDefault: handlePlanAcceptDefault,
        onKeepPlanning: handlePlanKeepPlanning,
      }
    : undefined;

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
    if (workingDirectory) {
      navigate(`/projects${workingDirectory}`);
    }
  }, [navigate, workingDirectory]);

  const handleNewChat = useCallback(() => {
    navigate({ search: "" });
  }, [navigate]);

  const handleClearChat = useCallback(() => {
    if (!window.confirm("确定清空当前会话？")) return;
    // 先中断进行中的流式请求，防止清空后又冒出新消息
    if (isLoading && currentRequestId) {
      abortRequest(currentRequestId, isLoading, resetRequestState);
    }
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
    isLoading, currentRequestId, abortRequest, resetRequestState,
    setMessages, setCurrentSessionId, setHasShownInitMessage,
    setHasReceivedInit, setCurrentAssistantMessage, clearInput, navigate,
  ]);

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
            throw new Error(json?.error || `skills request failed: ${response.status}`);
          }

          const skills = (json?.data?.skills || []) as Array<{
            id: string;
            name: string;
            trigger?: string;
            description?: string;
            installed?: boolean;
            enabled?: boolean;
          }>;

          setSlashSkills(
            skills.map((skill) => ({
              id: skill.id,
              name: skill.name || skill.id,
              trigger: skill.trigger || `/${skill.id}`,
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
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
  }, [location.pathname, location.search, location.state, navigate, setInput]);

  useEffect(() => {
    if (!sessionId || !historyError) return;
    if (!historyError.includes("403")) return;

    // 新用户或跨账号场景下 URL 里残留旧 sessionId 时，自动回退到新会话
    setCurrentSessionId(null);
    navigate({ search: "" }, { replace: true });
  }, [sessionId, historyError, navigate, setCurrentSessionId]);

  useEffect(() => {
    const state = location.state as { onboardingBootstrapPrompt?: string } | null;
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
    navigate(location.pathname + location.search, { replace: true, state: null });
    addMessage({
      type: "chat",
      role: "assistant",
      content: "正在初始化你的助手配置，请稍候，我会实时汇报进度。",
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
        console.error("[OnboardingBootstrap] send bootstrap prompt failed:", err);
        addMessage({
          type: "chat",
          role: "assistant",
          content: "初始化执行超时或失败，已恢复引导，请重试。",
          timestamp: Date.now(),
        });
        setOnboardingBootstrapPending(false);
        return;
      } finally {
        if (timer) clearTimeout(timer);
      }
      try {
        if (token) {
          const me = await getCurrentUser(token);
          if (me.success && me.data?.is_initialized) {
            await refreshUser();
            setOnboardingBootstrapPending(false);
            return;
          }
        }
      } catch (err) {
        console.error("[OnboardingBootstrap] confirm init status failed:", err);
        addMessage({
          type: "chat",
          role: "assistant",
          content: "初始化状态确认失败，已恢复引导，请重试。",
          timestamp: Date.now(),
        });
        setOnboardingBootstrapPending(false);
        return;
      }
      // 初始化未完成时恢复 onboarding 引导，允许用户重试
      addMessage({
        type: "chat",
        role: "assistant",
        content: "初始化尚未完成，已恢复引导，请重试。",
        timestamp: Date.now(),
      });
      setOnboardingBootstrapPending(false);
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
    token,
    refreshUser,
  ]);

  return (
    <div className="app-shell h-screen flex overflow-hidden">
      <Sidebar
        onNewChat={handleNewChat}
        currentPathLabel={workingDirectory}
        desktopVisible={isDesktopSidebarVisible}
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      <div className="flex-1 min-w-0 p-3 sm:p-6 h-screen flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 sm:mb-8 flex-shrink-0">
          <div className="flex items-center gap-4 min-w-0">
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
                    MyCC
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
                        {isHistoryView
                          ? "历史记录"
                          : "对话"}
                      </h1>
                    </>
                  )}
                </div>
              </nav>
              {workingDirectory && (
                <div className="flex items-center text-sm font-mono mt-1">
                  <button
                    onClick={handleBackToProjectChat}
                    className="text-slate-600 dark:text-slate-400 hover:text-[var(--accent)] transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 dark:focus:ring-offset-slate-900 rounded px-1 -mx-1 cursor-pointer"
                    aria-label={`Return to new chat in ${workingDirectory}`}
                  >
                    {workingDirectory}
                  </button>
                  {sessionId && (
                    <span className="ml-2 text-xs text-slate-600 dark:text-slate-400">
                      Session: {sessionId.substring(0, 8)}...
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* 桌面端侧栏 toggle（仅 lg 以上显示） */}
            <button
              onClick={() => setIsDesktopSidebarVisible(v => !v)}
              className="hidden lg:inline-flex p-2 rounded-lg panel-surface border hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label={isDesktopSidebarVisible ? "收起侧栏" : "展开侧栏"}
            >
              <svg className="w-5 h-5 text-slate-600 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            {/* 移动端汉堡按钮 */}
            <button
              onClick={() => setIsMobileSidebarOpen(true)}
              className="lg:hidden p-2 rounded-lg panel-surface border hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label="打开菜单"
            >
              <svg className="w-5 h-5 text-slate-600 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
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
            {!isHistoryView && <HistoryButton onClick={handleHistoryClick} />}
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
                Loading conversation history...
              </p>
            </div>
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
                Error Loading Conversation
              </h2>
              <p className="text-slate-600 dark:text-slate-400 text-sm mb-4">
                {historyError}
              </p>
              <button
                onClick={() => navigate({ search: "" })}
                className="px-4 py-2 text-[var(--text-inverse)] rounded-lg transition-colors"
                style={{ background: "var(--accent)" }}
              >
                Start New Conversation
              </button>
            </div>
          </div>
        ) : (
          <>
            <ChatMessages
              messages={messages}
              isLoading={isLoading}
              assistantDisplayName={assistantDisplayName}
              assistantAvatarText={assistantAvatarText}
            />
            <ChatInput
              input={input}
              isLoading={isLoading}
              currentRequestId={currentRequestId}
              onInputChange={setInput}
              onSubmit={() => sendMessage()}
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
            />
          </>
        )}

        <SettingsModal isOpen={isSettingsOpen} onClose={handleSettingsClose} />
      </div>

    </div>
  );
}
