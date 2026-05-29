type JsonLineHandler = (rawLine: string) => void;

export function createCodexAppServerJsonLineReader(onLine: JsonLineHandler): Readonly<{
    push: (chunk: string) => void;
}> {
    let chunks: string[] = [];

    const appendSegment = (segment: string): void => {
        if (segment.length === 0) return;
        chunks.push(segment);
    };

    const consumeBufferedLine = (): string => {
        if (chunks.length === 0) return '';
        if (chunks.length === 1) {
            const only = chunks[0] ?? '';
            chunks = [];
            return only;
        }
        const line = chunks.join('');
        chunks = [];
        return line;
    };

    const emitLine = (): void => {
        const rawLine = consumeBufferedLine();
        if (rawLine.length === 0) return;
        if (rawLine.length <= 256 && rawLine.trim().length === 0) return;
        onLine(rawLine);
    };

    return {
        push: (chunk: string): void => {
            let startIndex = 0;
            for (;;) {
                const newlineIndex = chunk.indexOf('\n', startIndex);
                if (newlineIndex === -1) {
                    appendSegment(chunk.slice(startIndex));
                    return;
                }

                appendSegment(chunk.slice(startIndex, newlineIndex));
                emitLine();
                startIndex = newlineIndex + 1;
                if (startIndex >= chunk.length) {
                    return;
                }
            }
        },
    };
}
