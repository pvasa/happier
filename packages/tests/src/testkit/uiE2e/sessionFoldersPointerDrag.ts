import type { Page } from '@playwright/test';

export type DragDispatchResult = Readonly<{
  ok: boolean;
  scrollTopBefore: number | null;
  scrollTopAfter: number | null;
  error?: string;
}>;

async function dispatchSessionTreePointerDrag(page: Page, params: Readonly<{
  sourceTestId: string;
  sourceChildTestId?: string;
  targetTestId: string;
  targetEdge: 'top' | 'middle' | 'bottom';
  scrollDuringDrag?: 'target-into-view' | 'autoscroll-bottom';
}>): Promise<DragDispatchResult> {
  await page.getByTestId(params.sourceTestId).scrollIntoViewIfNeeded();
  await page.getByTestId(params.sourceTestId).hover();

  if (!params.scrollDuringDrag) {
    await page.getByTestId(params.targetTestId).scrollIntoViewIfNeeded();
  }

  const result = await page.evaluate(async ({
    sourceTestId,
    sourceChildTestId,
    targetTestId,
    targetEdge,
    scrollDuringDrag,
  }) => {
    const byTestId = (testId: string): HTMLElement | null => (
      document.querySelector<HTMLElement>(`[data-testid="${CSS.escape(testId)}"]`)
    );
    const findScrollableAncestor = (element: HTMLElement): HTMLElement | null => {
      let current: HTMLElement | null = element.parentElement;
      while (current) {
        if (current.scrollHeight > current.clientHeight + 8) return current;
        current = current.parentElement;
      }
      return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
    };
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const dispatchPointer = (
      target: EventTarget,
      type: string,
      point: Readonly<{ x: number; y: number }>,
      buttons: number,
    ) => {
      target.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 77,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        buttons,
        clientX: point.x,
        clientY: point.y,
        screenX: point.x,
        screenY: point.y,
      }));
    };
    const pointForTarget = (element: HTMLElement, edge: 'top' | 'middle' | 'bottom') => {
      const rect = element.getBoundingClientRect();
      const y = edge === 'top'
        ? rect.top + 4
        : edge === 'bottom'
          ? rect.bottom - 4
          : rect.top + rect.height / 2;
      return {
        x: rect.left + Math.min(Math.max(rect.width * 0.5, 8), Math.max(rect.width - 8, 8)),
        y,
      };
    };

    const sourceContainer = byTestId(sourceTestId);
    if (!sourceContainer) return { ok: false, scrollTopBefore: null, scrollTopAfter: null, error: `missing ${sourceTestId}` };
    const source = sourceChildTestId
      ? sourceContainer.querySelector<HTMLElement>(`[data-testid="${CSS.escape(sourceChildTestId)}"]`)
      : sourceContainer;
    if (!source) return { ok: false, scrollTopBefore: null, scrollTopAfter: null, error: `missing ${sourceChildTestId ?? sourceTestId}` };

    const scrollable = findScrollableAncestor(sourceContainer);
    const scrollTopBefore = scrollable?.scrollTop ?? null;
    const sourcePoint = pointForTarget(source, 'middle');
    dispatchPointer(source, 'pointerdown', sourcePoint, 1);
    await wait(35);
    dispatchPointer(window, 'pointermove', { x: sourcePoint.x + 2, y: sourcePoint.y + 10 }, 1);
    await wait(35);

    if (scrollDuringDrag === 'target-into-view') {
      const targetBeforeScroll = byTestId(targetTestId);
      targetBeforeScroll?.scrollIntoView({ block: 'center', inline: 'nearest' });
      await wait(80);
    } else if (scrollDuringDrag === 'autoscroll-bottom' && scrollable) {
      const rect = scrollable.getBoundingClientRect();
      dispatchPointer(window, 'pointermove', { x: rect.left + rect.width / 2, y: rect.bottom - 6 }, 1);
      await wait(900);
    }

    const target = byTestId(targetTestId);
    if (!target) {
      dispatchPointer(window, 'pointerup', sourcePoint, 0);
      return { ok: false, scrollTopBefore, scrollTopAfter: scrollable?.scrollTop ?? null, error: `missing ${targetTestId}` };
    }
    const targetPoint = pointForTarget(target, targetEdge);
    for (const fraction of [0.35, 0.7, 1]) {
      dispatchPointer(window, 'pointermove', {
        x: sourcePoint.x + (targetPoint.x - sourcePoint.x) * fraction,
        y: sourcePoint.y + (targetPoint.y - sourcePoint.y) * fraction,
      }, 1);
      await wait(45);
    }
    dispatchPointer(window, 'pointerup', targetPoint, 0);
    await wait(160);
    return { ok: true, scrollTopBefore, scrollTopAfter: scrollable?.scrollTop ?? null };
  }, params);

  if (!result.ok) throw new Error(result.error ?? 'drag dispatch failed');
  await page.waitForTimeout(250);
  return result;
}

export async function dragSessionToTarget(page: Page, params: Readonly<{
  sessionId: string;
  targetTestId: string;
  targetEdge: 'top' | 'middle' | 'bottom';
  scrollDuringDrag?: 'target-into-view' | 'autoscroll-bottom';
}>): Promise<DragDispatchResult> {
  return dispatchSessionTreePointerDrag(page, {
    sourceTestId: `session-list-item-${params.sessionId}`,
    sourceChildTestId: 'session-item-reorder-handle',
    targetTestId: params.targetTestId,
    targetEdge: params.targetEdge,
    scrollDuringDrag: params.scrollDuringDrag,
  });
}

export async function dragFolderToTarget(page: Page, params: Readonly<{
  sourceFolderId: string;
  targetTestId: string;
  targetEdge: 'top' | 'middle' | 'bottom';
}>): Promise<void> {
  await dispatchSessionTreePointerDrag(page, {
    sourceTestId: `session-folder-header-${params.sourceFolderId}`,
    targetTestId: params.targetTestId,
    targetEdge: params.targetEdge,
  });
}
