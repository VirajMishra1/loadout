import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname, win32, join } from "node:path";
import { promisify } from "node:util";
import { writeFileAtomically } from "./atomic-file.js";
import { ensureDirectory, loadoutHome, userHome } from "./paths.js";
import { createSnapshot } from "./snapshot.js";
import {
  beginTransaction,
  completeTransaction,
  markTransactionCommitting,
  recoverPendingTransactions,
  rollbackTransaction,
} from "./transaction.js";

const execFileAsync = promisify(execFile);

export type SchedulerPlatform = "darwin" | "linux" | "win32";
export type SchedulerAction = "schedule" | "unschedule";
export type SchedulerJob = "updates" | "discovery";

export interface SchedulerFile {
  path: string;
  content: string;
}

export interface NativeSchedulerPlan {
  action: SchedulerAction;
  job: SchedulerJob;
  platform: SchedulerPlatform;
  time: string;
  command: string[];
  directories: string[];
  files: SchedulerFile[];
  applyCommands: Array<{
    command: string;
    args: string[];
    allowFailure?: boolean;
  }>;
  rollbackCommands: Array<{
    command: string;
    args: string[];
    allowFailure?: boolean;
  }>;
  guarantee: "read-only-checks-only";
}

export type SchedulerRunner = (
  command: string,
  args: string[],
) => Promise<void>;

function parseTime(value: string): {
  hour: number;
  minute: number;
  text: string;
} {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  if (!match || hour > 23 || minute > 59)
    throw new Error("--time must use 24-hour HH:MM");
  return { hour, minute, text: value };
}

function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function systemd(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function planNativeScheduler(
  action: SchedulerAction,
  options: {
    time?: string;
    platform?: NodeJS.Platform;
    home?: string;
    stateHome?: string;
    nodePath?: string;
    cliPath?: string;
    uid?: number;
    job?: SchedulerJob;
  } = {},
): NativeSchedulerPlan {
  const platform = options.platform ?? process.platform;
  if (!["darwin", "linux", "win32"].includes(platform))
    throw new Error(
      `Native scheduling is unsupported on '${platform}'. Supported: macOS, Windows, Linux.`,
    );
  const selectedPlatform = platform as SchedulerPlatform;
  const time = parseTime(options.time ?? "09:00");
  const home = options.home ?? userHome(process.env, platform);
  const stateHome = options.stateHome ?? loadoutHome(process.env, platform);
  const nodePath = options.nodePath ?? process.execPath;
  const cliPath = options.cliPath ?? process.argv[1];
  const job = options.job ?? "updates";
  const nativeId = `loadout-daily-${job}`;
  const command =
    job === "updates"
      ? [nodePath, cliPath, "watch", "--once", "--json"]
      : [nodePath, cliPath, "discover", "--source", "all", "--queue", "--json"];
  if (selectedPlatform === "darwin") {
    const label = `com.loadout.daily.${job}`;
    const path = join(home, "Library", "LaunchAgents", `${label}.plist`);
    const log = join(stateHome, "logs", `daily-${job}.log`);
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${command.map((item) => `<string>${xml(item)}</string>`).join("")}</array>
<key>StartCalendarInterval</key><dict><key>Hour</key><integer>${time.hour}</integer><key>Minute</key><integer>${time.minute}</integer></dict>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>${xml(log)}</string>
<key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>
`;
    const domain = `gui/${options.uid ?? process.getuid?.() ?? 0}`;
    return {
      action,
      job,
      platform: selectedPlatform,
      time: time.text,
      command,
      directories: [join(stateHome, "logs")],
      files: [{ path, content }],
      applyCommands:
        action === "schedule"
          ? [
              {
                command: "launchctl",
                args: ["bootout", domain, path],
                allowFailure: true,
              },
              { command: "launchctl", args: ["bootstrap", domain, path] },
            ]
          : [
              {
                command: "launchctl",
                args: ["bootout", domain, path],
                allowFailure: true,
              },
            ],
      rollbackCommands:
        action === "schedule"
          ? [{ command: "launchctl", args: ["bootout", domain, path] }]
          : [],
      guarantee: "read-only-checks-only",
    };
  }
  if (selectedPlatform === "linux") {
    const service = join(
      home,
      ".config",
      "systemd",
      "user",
      `${nativeId}.service`,
    );
    const timer = join(home, ".config", "systemd", "user", `${nativeId}.timer`);
    return {
      action,
      job,
      platform: selectedPlatform,
      time: time.text,
      command,
      directories: [],
      files: [
        {
          path: service,
          content: `[Unit]
Description=Loadout read-only ${job === "updates" ? "update check" : "candidate discovery"}

[Service]
Type=oneshot
ExecStart=${command.map(systemd).join(" ")}
`,
        },
        {
          path: timer,
          content: `[Unit]
Description=Daily Loadout read-only ${job === "updates" ? "update check" : "candidate discovery"}

[Timer]
OnCalendar=*-*-* ${time.text}:00
Persistent=true

[Install]
WantedBy=timers.target
`,
        },
      ],
      applyCommands:
        action === "schedule"
          ? [
              { command: "systemctl", args: ["--user", "daemon-reload"] },
              {
                command: "systemctl",
                args: ["--user", "enable", "--now", `${nativeId}.timer`],
              },
            ]
          : [
              {
                command: "systemctl",
                args: ["--user", "disable", "--now", `${nativeId}.timer`],
                allowFailure: true,
              },
              { command: "systemctl", args: ["--user", "daemon-reload"] },
            ],
      rollbackCommands:
        action === "schedule"
          ? [
              {
                command: "systemctl",
                args: ["--user", "disable", "--now", `${nativeId}.timer`],
              },
            ]
          : [],
      guarantee: "read-only-checks-only",
    };
  }
  const path = win32.join(stateHome, "scheduler", `${nativeId}.xml`);
  const taskName = `LoadoutDaily${job === "updates" ? "Updates" : "Discovery"}`;
  const argumentsValue = command
    .slice(1)
    .map((item) => `"${item.replace(/"/g, '\\"')}"`)
    .join(" ");
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<Triggers><CalendarTrigger><StartBoundary>2000-01-01T${time.text}:00</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger></Triggers>
<Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT10M</ExecutionTimeLimit></Settings>
<Actions Context="Author"><Exec><Command>${xml(command[0])}</Command><Arguments>${xml(argumentsValue)}</Arguments></Exec></Actions>
</Task>
`;
  return {
    action,
    job,
    platform: selectedPlatform,
    time: time.text,
    command,
    directories: [],
    files: [{ path, content }],
    applyCommands:
      action === "schedule"
        ? [
            {
              command: "schtasks",
              args: ["/Create", "/TN", taskName, "/XML", path, "/F"],
            },
          ]
        : [
            {
              command: "schtasks",
              args: ["/Delete", "/TN", taskName, "/F"],
              allowFailure: true,
            },
          ],
    rollbackCommands:
      action === "schedule"
        ? [
            {
              command: "schtasks",
              args: ["/Delete", "/TN", taskName, "/F"],
            },
          ]
        : [],
    guarantee: "read-only-checks-only",
  };
}

const defaultRunner: SchedulerRunner = async (command, args) => {
  await execFileAsync(command, args);
};

export async function applyNativeScheduler(
  plan: NativeSchedulerPlan,
  runner: SchedulerRunner = defaultRunner,
): Promise<string> {
  await recoverPendingTransactions();
  const paths = plan.files.map((file) => file.path);
  const snapshot = await createSnapshot(paths);
  const transaction = await beginTransaction(snapshot, paths);
  try {
    await markTransactionCommitting(transaction);
    if (plan.action === "schedule") {
      for (const directory of plan.directories)
        await ensureDirectory(directory);
      for (const file of plan.files) {
        await ensureDirectory(dirname(file.path));
        await writeFileAtomically(file.path, file.content);
      }
    }
    for (const item of plan.applyCommands)
      try {
        await runner(item.command, item.args);
      } catch (error) {
        if (!item.allowFailure) throw error;
      }
    if (plan.action === "unschedule")
      for (const file of plan.files) await rm(file.path, { force: true });
    await completeTransaction(transaction);
  } catch (error) {
    for (const item of plan.rollbackCommands)
      try {
        await runner(item.command, item.args);
      } catch {
        /* filesystem/state rollback remains authoritative */
      }
    await rollbackTransaction(transaction);
    throw error;
  }
  return snapshot.id;
}

export function formatNativeScheduler(plan: NativeSchedulerPlan): string {
  return [
    `${plan.action === "schedule" ? "Schedule" : "Unschedule"} daily read-only ${plan.job === "updates" ? "update check" : "candidate discovery"} — ${plan.platform} at ${plan.time}`,
    `Command: ${plan.command.join(" ")}`,
    ...plan.files.map((file) => `File: ${file.path}`),
    ...plan.applyCommands.map(
      (item) => `Native action: ${item.command} ${item.args.join(" ")}`,
    ),
    `Guarantee: the scheduled command is ${plan.command.slice(2).join(" ")}; it can only report updates or queue candidates and cannot apply changes.`,
  ].join("\n");
}
