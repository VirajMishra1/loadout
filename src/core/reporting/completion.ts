export type CompletionShell = "bash" | "zsh" | "fish" | "powershell";

/**
 * The command list is derived from the live Commander tree rather than kept by
 * hand, because a hand-kept copy drifts: completions advertised `pack`,
 * `publish`, and `sandbox-run` for a release after those commands were removed.
 */
export interface CommandTree {
  name: string;
  subcommands: string[];
}

let registry: CommandTree[] = [];

/** Called once at startup with the assembled program. */
export function registerCompletionCommands(tree: CommandTree[]): void {
  registry = tree
    .filter((entry) => entry.name && entry.name !== "help")
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function completionCommands(): string[] {
  return registry.map((entry) => entry.name);
}

export function completionSubcommands(name: string): string[] {
  return registry.find((entry) => entry.name === name)?.subcommands ?? [];
}

export function renderShellCompletion(shell: CompletionShell): string {
  const words = completionCommands().join(" ");
  switch (shell) {
    case "bash":
      return `# Loadout command completion
_loadout() {
  local current="\${COMP_WORDS[COMP_CWORD]}"
  local commands="${words}"
  if [[ COMP_CWORD -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "$commands" -- "$current") )
  elif [[ COMP_CWORD -eq 2 && "\${COMP_WORDS[1]}" == "models" ]]; then
    COMPREPLY=( $(compgen -W "${completionSubcommands("models").join(" ")}" -- "$current") )
  elif [[ COMP_CWORD -eq 2 && "\${COMP_WORDS[1]}" == "credentials" ]]; then
    COMPREPLY=( $(compgen -W "${completionSubcommands("credentials").join(" ")}" -- "$current") )
  elif [[ COMP_CWORD -eq 2 && "\${COMP_WORDS[1]}" == "candidate" ]]; then
    COMPREPLY=( $(compgen -W "${completionSubcommands("candidate").join(" ")}" -- "$current") )
  fi
}
complete -F _loadout loadout
`;
    case "zsh":
      return `#compdef loadout
typeset -a commands model_commands credential_commands candidate_commands
commands=(${completionCommands()
        .map((command) => `'${command}'`)
        .join(" ")})
model_commands=(${completionSubcommands("models")
        .map((command) => `'${command}'`)
        .join(" ")})
credential_commands=(${completionSubcommands("credentials")
        .map((command) => `'${command}'`)
        .join(" ")})
candidate_commands=(${completionSubcommands("candidate")
        .map((command) => `'${command}'`)
        .join(" ")})
if (( CURRENT == 2 )); then
  _describe 'command' commands
elif (( CURRENT == 3 )) && [[ $words[2] == models ]]; then
  _describe 'models command' model_commands
elif (( CURRENT == 3 )) && [[ $words[2] == credentials ]]; then
  _describe 'credentials command' credential_commands
elif (( CURRENT == 3 )) && [[ $words[2] == candidate ]]; then
  _describe 'candidate command' candidate_commands
fi
`;
    case "fish":
      return [
        ...completionCommands().map(
          (command) =>
            `complete -c loadout -f -n '__fish_use_subcommand' -a ${command}`,
        ),
        ...completionSubcommands("models").map(
          (command) =>
            `complete -c loadout -f -n '__fish_seen_subcommand_from models' -a ${command}`,
        ),
        ...completionSubcommands("credentials").map(
          (command) =>
            `complete -c loadout -f -n '__fish_seen_subcommand_from credentials' -a ${command}`,
        ),
        ...completionSubcommands("candidate").map(
          (command) =>
            `complete -c loadout -f -n '__fish_seen_subcommand_from candidate' -a ${command}`,
        ),
      ]
        .join("\n")
        .concat("\n");
    case "powershell":
      return `Register-ArgumentCompleter -Native -CommandName loadout -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $elements = @($commandAst.CommandElements | ForEach-Object { $_.Extent.Text })
  $candidates = if ($elements.Count -ge 2 -and $elements[1] -eq 'models') { @(${completionSubcommands(
    "models",
  )
    .map((command) => `'${command}'`)
    .join(
      ", ",
    )}) } elseif ($elements.Count -ge 2 -and $elements[1] -eq 'credentials') { @(${completionSubcommands(
    "credentials",
  )
    .map((command) => `'${command}'`)
    .join(
      ", ",
    )}) } elseif ($elements.Count -ge 2 -and $elements[1] -eq 'candidate') { @(${completionSubcommands(
    "candidate",
  )
    .map((command) => `'${command}'`)
    .join(", ")}) } else { @(${completionCommands()
    .map((command) => `'${command}'`)
    .join(", ")}) }
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
