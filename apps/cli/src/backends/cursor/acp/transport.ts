import { DefaultTransport } from '@/agent/transport';

export class CursorTransport extends DefaultTransport {
  constructor() {
    super('cursor');
  }

  override getToolCallTimeout(_toolCallId?: string, _toolKind?: string): number | null {
    return null;
  }
}

export const cursorTransport = new CursorTransport();
