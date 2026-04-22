export interface SessionCancelEffectPayload {
  sessionId: string;
  taskId: string;
  dialogTurnId: string;
}

type SessionCancelEffectHandler = (payload: SessionCancelEffectPayload) => Promise<void>;

let sessionCancelEffectHandler: SessionCancelEffectHandler = async () => {};

export function setSessionCancelEffectHandler(handler: SessionCancelEffectHandler): void {
  sessionCancelEffectHandler = handler;
}

export async function runSessionCancelEffects(payload: SessionCancelEffectPayload): Promise<void> {
  await sessionCancelEffectHandler(payload);
}
