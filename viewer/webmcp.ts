type Tool = {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean };
  execute: (input: unknown) => unknown;
};
type ModelContext = {
  registerTool: (
    tool: Tool,
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};

export function assertNoArguments(input: unknown) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length
  )
    throw new Error('This tool accepts an empty object only');
}

export function registerLabTools(
  read: () => unknown,
  evaluate: () => Promise<unknown>,
) {
  const context = (document as Document & { modelContext?: ModelContext })
    .modelContext;
  if (!context?.registerTool) return;
  const controller = new AbortController();
  const schema = {
    type: 'object',
    properties: {},
    additionalProperties: false,
  };
  for (const tool of [
    {
      name: 'read_mechanical_lab',
      description:
        'Read current inputs, physical gauge measurements and the latest evaluation.',
      inputSchema: schema,
      annotations: { readOnlyHint: true },
      execute: (input: unknown) => {
        assertNoArguments(input);
        return read();
      },
    },
    {
      name: 'evaluate_loaded_machine',
      description:
        'Run all 16 nominal input pairs for the loaded machine and show the results. Does not edit the machine.',
      inputSchema: schema,
      annotations: { readOnlyHint: false },
      execute: async (input: unknown) => {
        assertNoArguments(input);
        return await evaluate();
      },
    },
  ]) {
    try {
      void Promise.resolve(
        context.registerTool(tool, { signal: controller.signal }),
      ).catch((error) =>
        console.warn('Optional WebMCP registration failed', error),
      );
    } catch (error) {
      console.warn('Optional WebMCP unavailable', error);
    }
  }
  return () => controller.abort();
}
