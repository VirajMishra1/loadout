export type CompletionShell = "bash" | "zsh" | "fish" | "powershell";

const commands = [
  "setup",
  "scan",
  "status",
  "doctor",
  "health",
  "compare",
  "optimize",
  "activate",
  "enable",
  "disable",
  "adopt",
  "library",
  "update",
  "rollback",
  "discover",
  "review-queue",
  "review",
  "alerts",
  "alert-ignore",
  "alert-pin",
  "alert-unpin",
  "alert-pins",
  "mcp",
  "mcp-recipe",
  "mcp-config",
  "models",
  "schedule",
  "unschedule",
  "report",
  "share",
  "head-to-head",
  "completion",
];

export function renderShellCompletion(shell: CompletionShell): string {
  const words = commands.join(" ");
  switch (shell) {
    case "bash":
      return `# Loadout command completion\n_loadout() {\n  local commands="${words}"\n  COMPREPLY=( $(compgen -W "$commands" -- "\${COMP_WORDS[1]}") )\n}\ncomplete -F _loadout loadout\n`;
    case "zsh":
      return `#compdef loadout\n_typeset -a commands\ncommands=(${commands.map((command) => `'${command}'`).join(" ")})\n_arguments '1:command:($commands)'\n`;
    case "fish":
      return commands
        .map((command) => `complete -c loadout -f -a ${command}`)
        .join("\n")
        .concat("\n");
    case "powershell":
      return `Register-ArgumentCompleter -Native -CommandName loadout -ScriptBlock {\n  param($wordToComplete, $commandAst, $cursorPosition)\n  @(${commands.map((command) => `'${command}'`).join(", ")}) | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }\n}\n`;
  }
}

export function parseCompletionShell(value: string): CompletionShell {
  if (["bash", "zsh", "fish", "powershell"].includes(value))
    return value as CompletionShell;
  throw new Error("Supported shells: bash, zsh, fish, powershell");
}
