export type CompletionShell = "bash" | "zsh" | "fish" | "powershell";

const commands = [
  "setup",
  "init",
  "lock",
  "export",
  "import",
  "audit",
  "create",
  "pack",
  "publish",
  "registry-serve",
  "search",
  "add",
  "unadd",
  "list",
  "demo",
  "test-drive",
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
  "credentials",
  "schedule",
  "unschedule",
  "report",
  "share",
  "head-to-head",
  "keygen",
  "catalog-sign",
  "catalog-verify",
  "inspect",
  "evaluate",
  "watch",
  "sandbox-run",
  "codex-mcp-config",
  "plan",
  "install",
  "convert",
  "canary",
  "capabilities",
  "catalog",
  "profiles",
  "recommend",
  "improve",
  "improve-feedback",
  "sync",
  "outcome",
  "outcomes",
  "remove",
  "dashboard",
  "serve",
  "completion",
];

const modelCommands = ["status", "set", "verify"];
const credentialCommands = ["status", "set", "check", "delete"];

export function renderShellCompletion(shell: CompletionShell): string {
  const words = commands.join(" ");
  switch (shell) {
    case "bash":
      return `# Loadout command completion
_loadout() {
  local current="\${COMP_WORDS[COMP_CWORD]}"
  local commands="${words}"
  if [[ COMP_CWORD -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "$commands" -- "$current") )
  elif [[ COMP_CWORD -eq 2 && "\${COMP_WORDS[1]}" == "models" ]]; then
    COMPREPLY=( $(compgen -W "${modelCommands.join(" ")}" -- "$current") )
  elif [[ COMP_CWORD -eq 2 && "\${COMP_WORDS[1]}" == "credentials" ]]; then
    COMPREPLY=( $(compgen -W "${credentialCommands.join(" ")}" -- "$current") )
  fi
}
complete -F _loadout loadout
`;
    case "zsh":
      return `#compdef loadout
typeset -a commands model_commands credential_commands
commands=(${commands.map((command) => `'${command}'`).join(" ")})
model_commands=(${modelCommands.map((command) => `'${command}'`).join(" ")})
credential_commands=(${credentialCommands.map((command) => `'${command}'`).join(" ")})
if (( CURRENT == 2 )); then
  _describe 'command' commands
elif (( CURRENT == 3 )) && [[ $words[2] == models ]]; then
  _describe 'models command' model_commands
elif (( CURRENT == 3 )) && [[ $words[2] == credentials ]]; then
  _describe 'credentials command' credential_commands
fi
`;
    case "fish":
      return [
        ...commands.map(
          (command) =>
            `complete -c loadout -f -n '__fish_use_subcommand' -a ${command}`,
        ),
        ...modelCommands.map(
          (command) =>
            `complete -c loadout -f -n '__fish_seen_subcommand_from models' -a ${command}`,
        ),
        ...credentialCommands.map(
          (command) =>
            `complete -c loadout -f -n '__fish_seen_subcommand_from credentials' -a ${command}`,
        ),
      ]
        .join("\n")
        .concat("\n");
    case "powershell":
      return `Register-ArgumentCompleter -Native -CommandName loadout -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $elements = @($commandAst.CommandElements | ForEach-Object { $_.Extent.Text })
  $candidates = if ($elements.Count -ge 2 -and $elements[1] -eq 'models') { @(${modelCommands.map((command) => `'${command}'`).join(", ")}) } elseif ($elements.Count -ge 2 -and $elements[1] -eq 'credentials') { @(${credentialCommands.map((command) => `'${command}'`).join(", ")}) } else { @(${commands.map((command) => `'${command}'`).join(", ")}) }
  $candidates | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }
}
`;
  }
}

export function parseCompletionShell(value: string): CompletionShell {
  if (["bash", "zsh", "fish", "powershell"].includes(value))
    return value as CompletionShell;
  throw new Error("Supported shells: bash, zsh, fish, powershell");
}
