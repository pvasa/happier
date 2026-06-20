import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeState = vi.hoisted(() => ({
    instances: [] as Array<any>,
    seedMarkdown: vi.fn((editor: any, markdown: string) => {
        editor.markdown = markdown;
    }),
}));

vi.mock('@tiptap/core', () => ({
    Editor: class FakeEditor {
        markdown = '';
        state = { selection: { from: 1, to: 1 } };
        view = {
            coordsAtPos: () => ({ left: 0, top: 0, bottom: 10 }),
        };
        commands = {};

        constructor(public options: Record<string, unknown>) {
            runtimeState.instances.push(this);
        }

        getMarkdown() {
            return this.markdown;
        }

        setEditable() {}

        isActive() {
            return false;
        }

        chain() {
            return {
                focus: () => ({
                    deleteRange: () => ({ run: () => true }),
                }),
            };
        }

        destroy() {}
    },
}));

vi.mock('../../core/tiptap/createMarkdownEditorExtensions', () => ({
    createMarkdownEditorExtensions: () => [],
}));

vi.mock('../../core/tiptap/seedMarkdown', () => ({
    seedMarkdown: runtimeState.seedMarkdown,
}));

vi.mock('../../core/tiptap/markdownEditorCommands', () => ({
    readSelectionState: () => ({
        marks: { bold: false, italic: false, strike: false, code: false },
        blockType: 'paragraph',
        isLinkActive: false,
        canUndo: false,
        canRedo: false,
    }),
    runMarkdownEditorCommand: vi.fn(),
    readActiveLinkHref: () => undefined,
}));

describe('tiptapWebViewRuntime', () => {
    beforeEach(() => {
        vi.resetModules();
        runtimeState.instances = [];
        runtimeState.seedMarkdown.mockClear();
    });

    it('preserves editor view state when applying host setDoc updates after initialization', async () => {
        const { tiptapWebViewApi } = await import('../tiptapWebViewEntry');
        const runtime = tiptapWebViewApi.createRuntime({
            root: {} as HTMLElement,
            postEnvelope: vi.fn(),
            config: { changeDebounceMs: 0, readOnly: false },
        });

        runtime.onEnvelope({ v: 1, type: 'init', payload: { doc: 'initial', readOnly: false } });
        expect(runtimeState.seedMarkdown).toHaveBeenLastCalledWith(runtimeState.instances[0], 'initial');

        runtimeState.seedMarkdown.mockClear();
        runtimeState.instances[0].markdown = 'initial';

        runtime.onEnvelope({ v: 1, type: 'setDoc', payload: { doc: 'external update' } });

        expect(runtimeState.seedMarkdown).toHaveBeenCalledWith(
            runtimeState.instances[0],
            'external update',
            { preserveViewState: true },
        );
    });

    it('cancels pending docChanged when the host applies setDoc before debounce elapses', async () => {
        vi.useFakeTimers();
        try {
            const postEnvelope = vi.fn();
            const { tiptapWebViewApi } = await import('../tiptapWebViewEntry');
            const runtime = tiptapWebViewApi.createRuntime({
                root: {} as HTMLElement,
                postEnvelope,
                config: { changeDebounceMs: 100, readOnly: false },
            });

            runtime.onEnvelope({ v: 1, type: 'init', payload: { doc: 'initial', readOnly: false } });
            const editor = runtimeState.instances[0];
            editor.markdown = 'local edit';

            const onUpdate = editor.options.onUpdate;
            if (typeof onUpdate !== 'function') throw new Error('expected fake editor onUpdate');
            onUpdate();

            runtime.onEnvelope({ v: 1, type: 'setDoc', payload: { doc: 'external update' } });

            vi.advanceTimersByTime(100);

            expect(editor.markdown).toBe('external update');
            expect(postEnvelope.mock.calls.filter(([envelope]) => envelope.type === 'docChanged')).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });
});
