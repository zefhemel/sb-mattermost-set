import { system } from "$sb/silverbullet-syscall/mod.ts";
import { asset } from "$sb/plugos-syscall/mod.ts";
import Handlebars from "handlebars";

import {
  findUserByName,
  MattermostUser,
  postMessage,
  resetSETTeam,
  updateChannel,
} from "./mattermost.ts";
import { readSecrets } from "$sb/lib/secrets_page.ts";
import { channelId, opsGenieScheduleUrl } from "./constants.ts";

function parseDate(s: string): Date {
  return new Date(
    `${s.substring(0, 4)}-${s.substring(4, 6)}-${s.substring(6, 8)}`,
  );
}

type Schedule = {
  name: string;
  date: Date;
};

type GroupedSchedule = {
  name: string;
  start: Date;
  end: Date;
};

async function pullSchedule(which: string): Promise<GroupedSchedule[]> {
  const [schedules] = await readSecrets(["setOpsGenieTokens"]);
  const r = await fetch(`${opsGenieScheduleUrl}?${schedules[which]}`);
  const text = await r.text();
  const lines = text.split("\n");
  let lastDate, lastOnCall;
  const schedule: Schedule[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (line.startsWith("DTSTART;")) {
      lastDate = parseDate(line.split(":")[1].split("T")[0]);
    } else if (line.startsWith("SUMMARY:")) {
      let onCall = line.substring("SUMMARY:".length).split("(")[0].trim();
      schedule.push({ name: onCall, date: lastDate });
    }
  }
  let groupedSchedule: GroupedSchedule[] = [];
  let lastName = schedule[0].name;
  let startDate = schedule[0].date,
    endDate = schedule[0].date;
  for (let s of schedule) {
    if (s.name !== lastName) {
      groupedSchedule.push({ name: lastName, start: startDate, end: endDate });
      startDate = s.date;
      lastName = s.name;
    }
    endDate = s.date;
  }
  groupedSchedule.push({ name: lastName, start: startDate, end: endDate });
  return groupedSchedule;
}

type ScheduleObj = {
  date: string;
  lead: MattermostUser;
  primary: MattermostUser[];
  backup: MattermostUser[];
};

async function getScheduleForDate(d = new Date()) {
  const [lead, primary, backup] = await Promise.all([
    pullSchedule("lead"),
    pullSchedule("primary"),
    pullSchedule("backup"),
  ]);
  const firstDayOfWeek = new Date(d.setDate(d.getDate() - d.getDay() + 1));
  const scheduleObj: ScheduleObj = {
    date: firstDayOfWeek.toISOString().split("T")[0],
    lead: await findUserByName(findActive(lead, d)[0].name),
    primary: [],
    backup: [],
  };

  for (const { name } of findActive(primary, d)) {
    scheduleObj.primary.push(await findUserByName(name));
  }
  for (let { name } of findActive(backup, d)) {
    scheduleObj.backup.push(await findUserByName(name));
  }
  return scheduleObj;
}

export async function postOnCall() {
  const scheduleTemplate = await asset.readAsset(
    "templates/message-template.txt",
  );
  try {
    const template = Handlebars.compile(scheduleTemplate, { noEscape: true });
    const schedule = await getScheduleForDate(new Date());
    const rendered = template(schedule);
    await postMessage(rendered);
    await resetSETTeam([
      schedule.lead.id,
      ...schedule.primary.map((user) => user.id),
      ...schedule.backup.map((user) => user.id),
    ]);
    await updateChannelHeader(schedule);
  } catch (e) {
    console.error("Error", e);
    throw e;
  }
}

export async function postOnCallNextWeek() {
  const nextWeekTemplate = await asset.readAsset(
    "templates/next-week-template.txt",
  );
  try {
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const template = Handlebars.compile(nextWeekTemplate, { noEscape: true });
    const schedule = await getScheduleForDate(nextWeek);
    const rendered = template(schedule);
    //console.log("Rendered", rendered);
    await postMessage(rendered);
  } catch (e) {
    console.error("Error", e);
    throw e;
  }
}

async function updateChannelHeader(schedule) {
  const headerTemplate = await asset.readAsset("templates/header.txt");
  // let { text } = await readPage(headerTemplatePage);
  const template = Handlebars.compile(headerTemplate, { noEscape: true });
  const rendered = template(schedule);
  console.log("Updating channel header", channelId, rendered);
  console.log("Response", await updateChannel(channelId, { header: rendered }));
}

function findActive(
  schedules: GroupedSchedule[],
  date: Date,
): GroupedSchedule[] {
  let active: GroupedSchedule[] = [];
  for (let schedule of schedules) {
    if (schedule.start <= date && date <= schedule.end) {
      active.push(schedule);
    }
  }
  return active;
}

export function postOnCallNextWeekCommand() {
  return system.invokeFunction("server", "postOnCallNextWeek");
}

export function postOnCallCommand() {
  console.log("POSTing on call");
  return system.invokeFunction("server", "postOnCall");
}
