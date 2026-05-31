export type ConversationVisibilityInput = {
  title?: string | null;
  messageCount?: number | null;
  totalTokens?: number | null;
};

const CONTROL_TITLES = new Set([
  'accept',
  'continue',
  '继续',
]);

const HIDDEN_TITLE_MARKERS = [
  '你正在执行用户工作区首次初始化',
  '初始化票据',
  '初始化尚未完成',
  '初始化流程执行失败',
  'BOOTSTRAP.md',
  'onboarding bootstrap',
];

export function isUserVisibleConversation(conversation: ConversationVisibilityInput): boolean {
  const title = (conversation.title || '').trim();
  const normalizedTitle = title.toLowerCase();
  const compactTitle = normalizedTitle.replace(/[\s.。!！?？]+/g, '');

  if (!title) return false;
  if (CONTROL_TITLES.has(compactTitle)) return false;
  if (HIDDEN_TITLE_MARKERS.some((marker) => normalizedTitle.includes(marker.toLowerCase()))) {
    return false;
  }

  return true;
}
