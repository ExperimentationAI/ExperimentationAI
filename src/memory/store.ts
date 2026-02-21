import { InMemoryStore } from "@langchain/langgraph";

let _store: InMemoryStore | null = null;

export function getStore(): InMemoryStore {
  if (!_store) {
    _store = new InMemoryStore();
  }
  return _store;
}

export function conclusionsNamespace(experimentKey: string): string[] {
  return ["experiments", experimentKey, "conclusions"];
}

export function globalConclusionsNamespace(): string[] {
  return ["experiments", "conclusions"];
}
