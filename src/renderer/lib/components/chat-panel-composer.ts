interface ComposerSubmitState {
  isEditing: boolean;
  isGroundingActionBlocked: boolean;
  isStreaming: boolean;
  message: string;
}

interface ComposerEnterState {
  canSubmit: boolean;
  key: string;
  shiftKey: boolean;
}

export function canSubmitComposerMessage(state: ComposerSubmitState): boolean {
  return Boolean(
    state.message.trim()
    && !state.isStreaming
    && !state.isEditing
    && !state.isGroundingActionBlocked
  );
}

export function shouldInterceptComposerEnter(state: ComposerEnterState): boolean {
  return state.key === "Enter" && !state.shiftKey && state.canSubmit;
}
