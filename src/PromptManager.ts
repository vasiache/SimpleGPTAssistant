import * as vscode from 'vscode';

export class PromptManager {
  private readonly STORAGE_KEY = 'simplegpt.prompts';

  constructor(private readonly storage: vscode.Memento) {}

  public getPrompts(): Record<string, string> {
    return this.storage.get<Record<string, string>>(this.STORAGE_KEY, {});
  }

  public addPrompt(name: string, content: string): void {
    const prompts = this.getPrompts();
    prompts[name] = content;
    this.storage.update(this.STORAGE_KEY, prompts);
  }

  public deletePrompt(name: string): void {
    const prompts = this.getPrompts();
    if (prompts[name]) {
      delete prompts[name];
      this.storage.update(this.STORAGE_KEY, prompts);
    }
  }

  public getPromptContent(name: string): string | undefined {
    const prompts = this.getPrompts();
    return prompts[name];
  }
}
