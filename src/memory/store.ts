export function conclusionsNamespace(experimentKey: string): string[] {
  return ["experiments", experimentKey, "conclusions"];
}

export function globalConclusionsNamespace(): string[] {
  return ["experiments", "conclusions"];
}
