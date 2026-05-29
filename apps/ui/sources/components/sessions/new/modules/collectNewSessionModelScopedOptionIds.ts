type NewSessionModelOptionWithScopedConfigOptions = Readonly<{
    modelOptions?: ReadonlyArray<Readonly<{ id: string }>>;
}>;

export function collectNewSessionModelScopedOptionIds(
    modelOptions: ReadonlyArray<NewSessionModelOptionWithScopedConfigOptions>,
): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const modelOption of modelOptions) {
        for (const option of modelOption.modelOptions ?? []) {
            const id = option.id.trim();
            if (id) ids.add(id);
        }
    }
    return ids;
}
