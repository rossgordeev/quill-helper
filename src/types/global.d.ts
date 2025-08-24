// This file primaraly exists to preload the API for the renderer
export {};

declare global {
  interface Window {
    llm: {
      ask(message: string, model: string): Promise<any>;
      stream(message: string, model: string, onChunk: (s: string) => void): void;
    };
  }
}
