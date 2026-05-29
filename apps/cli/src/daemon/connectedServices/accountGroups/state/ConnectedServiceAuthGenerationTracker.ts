type GenerationTargetKey = Readonly<{
  serviceId: string;
  groupId: string;
  targetId: string;
}>;

type GenerationApplyToken = GenerationTargetKey & Readonly<{
  generation: number;
  status: 'applying' | 'stale';
}>;

type GenerationApplyResult = Readonly<{
  status: 'applied' | 'stale';
  currentGeneration: number;
}>;

function keyOf(key: GenerationTargetKey): string {
  return `${key.serviceId}\0${key.groupId}\0${key.targetId}`;
}

export class ConnectedServiceAuthGenerationTracker {
  private readonly generationsByKey = new Map<string, number>();

  beginApply(input: GenerationTargetKey & Readonly<{ generation: number }>): GenerationApplyToken {
    const key = keyOf(input);
    const currentGeneration = this.generationsByKey.get(key) ?? 0;
    if (input.generation < currentGeneration) {
      return { ...input, status: 'stale' };
    }
    if (input.generation > currentGeneration) {
      this.generationsByKey.set(key, input.generation);
    }
    return { ...input, status: 'applying' };
  }

  completeApply(token: GenerationApplyToken): GenerationApplyResult {
    const currentGeneration = this.generationsByKey.get(keyOf(token)) ?? 0;
    if (token.status === 'stale' || token.generation !== currentGeneration) {
      return { status: 'stale', currentGeneration };
    }
    return { status: 'applied', currentGeneration };
  }

  getAppliedGeneration(key: GenerationTargetKey): number {
    return this.generationsByKey.get(keyOf(key)) ?? 0;
  }
}
