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

/** Every executable top-level and parent/child command path. */
export function completionCommandPaths(): string[] {
  return registry.flatMap((entry) => [
    entry.name,
    ...entry.subcommands.map((subcommand) => `${entry.name} ${subcommand}`),
  ]);
}

export function renderShellCompletion(shell: CompletionShell): string {
  const words = completionCommands().join(" ");
  const parents = registry.filter((entry) => entry.subcommands.length > 0);
  switch (shell) {
    case "bash": {
      const bashCases = parents
        .map(
          (entry) =>
            `      "${entry.name}") candidates="${entry.subcommands.join(" ")}" ;;`,
        )
        .join("\n");
      return `# Loadout command completion
_loadout() {
  local current="\${COMP_WORDS[COMP_CWORD]}"
  local commands="${words}"
  local candidates=""
  if [[ COMP_CWORD -eq 1 ]]; then
    candidates="$commands"
  elif [[ COMP_CWORD -eq 2 ]]; then
    case "\${COMP_WORDS[1]}" in
${bashCases}
    esac
  fi
  COMPREPLY=( $(compgen -W "$candidates" -- "$current") )
}
complete -F _loadout loadout
`;
    }
    case "zsh": {
      const zshCases = parents
        .map(
          (entry) =>
            `    '${entry.name}') _values '${entry.name} command' ${entry.subcommands.map((command) => `'${command}'`).join(" ")} ;;`,
        )
        .join("\n");
      return `#compdef loadout
typeset -a commands
commands=(${completionCommands()
        .map((command) => `'${command}'`)
        .join(" ")})
if (( CURRENT == 2 )); then
  _describe 'command' commands
elif (( CURRENT == 3 )); then
  case $words[2] in
${zshCases}
  esac
fi
`;
    }
    case "fish":
      return [
        ...completionCommands().map(
          (command) =>
            `complete -c loadout -f -n '__fish_use_subcommand' -a ${command}`,
        ),
        ...parents.flatMap((entry) =>
          entry.subcommands.map(
            (command) =>
              `complete -c loadout -f -n '__fish_seen_subcommand_from ${entry.name}' -a ${command}`,
          ),
        ),
      ]
        .join("\n")
        .concat("\n");
    case "powershell": {
      const powershellCases = parents
        .map(
          (entry, index) =>
            `${index === 0 ? "if" : "elseif"} ($elements.Count -ge 2 -and $elements[1] -eq '${entry.name}') { @(${entry.subcommands.map((command) => `'${command}'`).join(", ")}) }`,
        )
        .join(" ");
      const topLevel = `@(${completionCommands()
        .map((command) => `'${command}'`)
        .join(", ")})`;
      const powershellCandidates = powershellCases
        ? `${powershellCases} else { ${topLevel} }`
        : topLevel;
      return `Register-ArgumentCompleter -Native -CommandName loadout -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $elements = @($commandAst.CommandElements | ForEach-Object { $_.Extent.Text })
  $candidates = ${powershellCandidates}
  $candidates | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }
}
`;
    }
  }
}

export function parseCompletionShell(value: string): CompletionShell {
  if (["bash", "zsh", "fish", "powershell"].includes(value))
    return value as CompletionShell;
  throw new Error("Supported shells: bash, zsh, fish, powershell");
}
