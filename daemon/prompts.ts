export function fillPrompt(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    if (!(name in values)) throw new Error(`The prompt has no value for {{${name}}}`);
    return values[name];
  });
}
